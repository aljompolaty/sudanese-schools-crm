// Data layer for the CRM: Supabase when configured, otherwise browser-local mode.
(function () {
  const cfg = window.CRM_CONFIG || {};
  const enabled = Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);
  const client = enabled ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

  const SELECTION_KEY = 'sudanese_schools_crm_selection_v1';
  const FIELDS = ['name', 'zone', 'category', 'address', 'phones', 'whatsapp', 'email', 'links', 'stages', 'status', 'notes'];

  // id -> JSON of the persisted fields, as last known to be in the database
  const snapshot = new Map();
  let queue = Promise.resolve();
  let onError = () => {};
  let onIdsChanged = () => {};

  const pick = (s) => {
    const o = {};
    FIELDS.forEach((f) => {
      let v = s[f];
      if (f === 'phones') v = Array.isArray(v) ? v : [];
      else if (f === 'links') v = Array.isArray(v) ? v : [];
      else if (v === undefined || v === '') v = null;
      o[f] = v;
    });
    if (!o.status) o.status = 'لم يتم التواصل';
    return o;
  };

  function readSelection() {
    try {
      const raw = localStorage.getItem(SELECTION_KEY);
      return raw ? new Set(JSON.parse(raw)) : null;
    } catch (e) { return null; }
  }

  function writeSelection(schools) {
    try {
      localStorage.setItem(SELECTION_KEY, JSON.stringify(schools.filter((s) => s.selected).map((s) => s.id)));
    } catch (e) { /* storage unavailable */ }
  }

  async function getSession() {
    const { data } = await client.auth.getSession();
    return data.session || null;
  }

  async function signIn(email, password) {
    const { data, error } = await client.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error) throw error;
    return data.session;
  }

  async function signOut() {
    await client.auth.signOut();
  }

  async function checkMembership() {
    const { data, error } = await client.from('team_members').select('email, full_name, role');
    if (error) throw error;
    return data && data.length ? data : null;
  }

  // defaultsById: { id: selectedBoolean } used the first time, before the user has saved a selection
  async function fetchSchools(defaultsById) {
    const { data, error } = await client.from('schools').select('*').order('id');
    if (error) throw error;
    const sel = readSelection();
    snapshot.clear();
    return data.map((row) => {
      const s = {
        id: Number(row.id),
        ...pick(row),
        phones: row.phones || [],
        links: row.links || [],
        updated_at: row.updated_at,
        updated_by: row.updated_by,
        selected: sel ? sel.has(Number(row.id)) : Boolean(defaultsById && defaultsById[row.id])
      };
      snapshot.set(s.id, JSON.stringify(pick(s)));
      return s;
    });
  }

  async function doSync(schools) {
    const known = new Set(snapshot.keys());
    let idsChanged = false;
    for (const s of schools) {
      const body = pick(s);
      const json = JSON.stringify(body);
      if (!known.has(s.id)) {
        const { data, error } = await client.from('schools').insert(body).select('id').single();
        if (error) { onError('تعذر حفظ المدرسة الجديدة: ' + error.message); continue; }
        s.id = Number(data.id);
        snapshot.set(s.id, json);
        idsChanged = true;
      } else if (snapshot.get(s.id) !== json) {
        // Send only the fields that changed, so parallel edits to other fields are not overwritten
        const before = JSON.parse(snapshot.get(s.id));
        const changes = {};
        FIELDS.forEach((f) => {
          if (JSON.stringify(before[f]) !== JSON.stringify(body[f])) changes[f] = body[f];
        });
        const { error } = await client.from('schools').update(changes).eq('id', s.id);
        if (error) { onError('تعذر حفظ التعديل: ' + error.message); continue; }
        snapshot.set(s.id, json);
      }
    }
    writeSelection(schools);
    if (idsChanged) onIdsChanged();
  }

  // Saves only what changed since the last sync; calls are serialized.
  function syncSchools(schools) {
    writeSelection(schools);
    queue = queue.then(() => doSync(schools)).catch((e) => onError(e.message || String(e)));
    return queue;
  }

  async function listInteractions(schoolId) {
    const { data, error } = await client
      .from('interactions')
      .select('*')
      .eq('school_id', schoolId)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    return data;
  }

  async function addInteraction(entry) {
    const { error } = await client.from('interactions').insert({
      school_id: entry.school_id,
      type: entry.type || 'note',
      direction: entry.direction || null,
      summary: entry.summary,
      outcome: entry.outcome || null,
      next_follow_up: entry.next_follow_up || null
    });
    if (error) throw error;
  }

  // Fire-and-forget log (e.g. a WhatsApp click). Waits for pending saves so the school exists.
  function logInteraction(entry) {
    queue = queue.then(() => addInteraction(entry)).catch((e) => onError('تعذر تسجيل التواصل: ' + (e.message || e)));
    return queue;
  }

  // ---------- Follow-ups ----------
  // Open follow-ups due on or before `untilDate` (YYYY-MM-DD)
  async function listFollowUps(untilDate) {
    const { data, error } = await client
      .from('interactions')
      .select('id, school_id, type, summary, outcome, next_follow_up, created_by, created_at')
      .not('next_follow_up', 'is', null)
      .eq('follow_up_done', false)
      .lte('next_follow_up', untilDate)
      .order('next_follow_up', { ascending: true })
      .limit(500);
    if (error) throw error;
    return data;
  }

  async function completeFollowUp(id, done = true) {
    const { error } = await client.rpc('complete_follow_up', { p_id: id, p_done: done });
    if (error) throw error;
  }

  // ---------- Campaigns ----------
  async function listCampaigns() {
    const { data, error } = await client
      .from('campaigns')
      .select('id, name, channel, subject, body, archived, created_at, created_by, campaign_targets(status)')
      .eq('archived', false)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data.map((c) => {
      const counts = { total: 0, pending: 0, sent: 0, replied: 0, interested: 0, not_interested: 0 };
      (c.campaign_targets || []).forEach((t) => { counts.total++; counts[t.status] = (counts[t.status] || 0) + 1; });
      const { campaign_targets, ...rest } = c;
      return { ...rest, counts };
    });
  }

  async function createCampaign({ name, channel, subject, body, schoolIds }) {
    const { data, error } = await client
      .from('campaigns')
      .insert({ name, channel: channel || 'whatsapp', subject: subject || null, body: body || null })
      .select('id')
      .single();
    if (error) throw error;
    if (schoolIds && schoolIds.length) {
      const rows = schoolIds.map((sid) => ({ campaign_id: data.id, school_id: sid }));
      const { error: e2 } = await client.from('campaign_targets').insert(rows);
      if (e2) throw e2;
    }
    return Number(data.id);
  }

  async function archiveCampaign(id) {
    const { error } = await client.from('campaigns').update({ archived: true }).eq('id', id);
    if (error) throw error;
  }

  async function listCampaignTargets(campaignId) {
    const { data, error } = await client
      .from('campaign_targets')
      .select('school_id, status, sent_at, replied_at, updated_by, updated_at')
      .eq('campaign_id', campaignId);
    if (error) throw error;
    return data;
  }

  async function setTargetStatus(campaignId, schoolId, status) {
    const { error } = await client
      .from('campaign_targets')
      .update({ status })
      .eq('campaign_id', campaignId)
      .eq('school_id', schoolId);
    if (error) throw error;
  }

  // ---------- Audit log (admins only; RLS returns nothing to others) ----------
  async function listAudit(limit = 200) {
    const { data, error } = await client
      .from('audit_log')
      .select('id, table_name, row_id, action, old_data, new_data, changed_by, changed_at')
      .order('changed_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data;
  }

  window.CRMDB = {
    enabled,
    me: null, // { email, role } — set after sign-in
    listFollowUps,
    completeFollowUp,
    listCampaigns,
    createCampaign,
    archiveCampaign,
    listCampaignTargets,
    setTargetStatus,
    listAudit,
    getSession,
    signIn,
    signOut,
    checkMembership,
    fetchSchools,
    syncSchools,
    listInteractions,
    addInteraction,
    logInteraction,
    setHandlers(h) {
      if (h.onError) onError = h.onError;
      if (h.onIdsChanged) onIdsChanged = h.onIdsChanged;
    }
  };
})();
