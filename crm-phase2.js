// Phase 2 UI: sales pipeline (Kanban), follow-ups, campaign manager, audit log.
// Uses globals from index.html: schoolsData, CLOUD, CRMDB, renderCRM, saveState,
// openModalForEdit, showToast, escapeHtml, renderCampaignQueue.
(function () {
  const STATUSES = [
    { key: 'لم يتم التواصل', icon: '⚪', head: 'bg-slate-100 text-slate-700 border-slate-300' },
    { key: 'تم إرسال عرض', icon: '🔵', head: 'bg-blue-50 text-blue-800 border-blue-200' },
    { key: 'مهتم / متابعة', icon: '🟡', head: 'bg-amber-50 text-amber-800 border-amber-200' },
    { key: 'تم التعاقد', icon: '🟢', head: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
    { key: 'غير مهتم', icon: '🔴', head: 'bg-rose-50 text-rose-800 border-rose-200' }
  ];
  const INTERACTION_ICONS = {
    note: '📝', call: '📞', whatsapp: '💬', email: '✉️', visit: '🏫', meeting: '🤝', status_change: '📌', other: '•'
  };
  const TARGET_STATUSES = {
    pending: { label: 'لم تُرسل', cls: 'bg-slate-100 text-slate-700 border-slate-200' },
    sent: { label: 'أُرسلت', cls: 'bg-blue-50 text-blue-800 border-blue-200' },
    replied: { label: 'ردّت', cls: 'bg-violet-50 text-violet-800 border-violet-200' },
    interested: { label: 'مهتمة', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
    not_interested: { label: 'غير مهتمة', cls: 'bg-rose-50 text-rose-800 border-rose-200' }
  };

  const $ = (id) => document.getElementById(id);
  const schoolById = (id) => schoolsData.find((s) => s.id === Number(id));
  const localDate = (d) => d.toLocaleDateString('en-CA'); // YYYY-MM-DD in the viewer's time zone
  const fmtDateTime = (v) => (v ? new Date(v).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('ar-EG', { dateStyle: 'medium' }) : '—');

  function setSchoolStatus(school, status) {
    if (!school || school.status === status) return;
    school.status = status;
    saveState();
    renderCRM();
    showToast(`«${school.name}» ← ${status}`, '📌');
  }

  // =====================================================================
  // 1) SALES PIPELINE (works in local and cloud mode)
  // =====================================================================
  let draggedId = null;

  window.renderPipeline = function renderPipeline() {
    const board = $('pipelineBoard');
    if (!board) return;
    const term = ($('pipelineSearch').value || '').trim().toLowerCase();
    const visible = schoolsData.filter((s) =>
      !term || [s.name, s.zone, s.address].some((v) => String(v || '').toLowerCase().includes(term)));

    board.innerHTML = STATUSES.map((st) => {
      const items = visible.filter((s) => (s.status || 'لم يتم التواصل') === st.key);
      const cards = items.map((s) => `
        <article draggable="true" data-pipe-id="${Number(s.id)}"
          class="pipe-card bg-white rounded-lg border border-slate-200 p-2.5 shadow-sm cursor-grab active:cursor-grabbing space-y-1.5">
          <button type="button" data-pipe-open="${Number(s.id)}" class="text-right font-bold text-slate-900 text-xs sm:text-sm hover:text-emerald-700 hover:underline leading-snug">${escapeHtml(s.name)}</button>
          <div class="text-[11px] text-slate-500">📍 ${escapeHtml(s.zone)}</div>
          ${s.notes ? `<div class="text-[11px] text-slate-600 bg-slate-50 rounded p-1 line-clamp-2">📝 ${escapeHtml(s.notes)}</div>` : ''}
          <select data-pipe-status="${Number(s.id)}" aria-label="تغيير المرحلة" class="w-full rounded border border-slate-200 px-1.5 py-1 text-[11px] bg-white">
            ${STATUSES.map((o) => `<option value="${escapeHtml(o.key)}" ${o.key === st.key ? 'selected' : ''}>${o.icon} ${escapeHtml(o.key)}</option>`).join('')}
          </select>
        </article>`).join('');
      return `
        <div data-pipe-col="${escapeHtml(st.key)}" class="pipe-col snap-start shrink-0 w-64 sm:w-72 bg-slate-100/70 rounded-xl border border-slate-200 flex flex-col max-h-[70vh]">
          <div class="px-3 py-2 rounded-t-xl border-b font-bold text-xs sm:text-sm flex items-center justify-between ${st.head}">
            <span>${st.icon} ${escapeHtml(st.key)}</span>
            <span class="px-2 py-0.5 rounded-full bg-white/70 text-[11px]">${items.length}</span>
          </div>
          <div class="p-2 space-y-2 overflow-y-auto flex-1 min-h-[120px]">${cards || '<div class="text-center text-[11px] text-slate-400 py-6">اسحب مدرسة إلى هنا</div>'}</div>
        </div>`;
    }).join('');
  };

  function initPipeline() {
    const board = $('pipelineBoard');
    $('pipelineSearch').addEventListener('input', window.renderPipeline);

    board.addEventListener('dragstart', (e) => {
      const card = e.target.closest('[data-pipe-id]');
      if (!card) return;
      draggedId = Number(card.getAttribute('data-pipe-id'));
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(draggedId));
      card.classList.add('opacity-50');
    });
    board.addEventListener('dragend', (e) => {
      const card = e.target.closest('[data-pipe-id]');
      if (card) card.classList.remove('opacity-50');
      board.querySelectorAll('.pipe-col').forEach((c) => c.classList.remove('ring-2', 'ring-emerald-400'));
    });
    board.addEventListener('dragover', (e) => {
      const col = e.target.closest('[data-pipe-col]');
      if (!col || draggedId == null) return;
      e.preventDefault();
      board.querySelectorAll('.pipe-col').forEach((c) => c.classList.toggle('ring-2', c === col));
      col.classList.add('ring-emerald-400');
    });
    board.addEventListener('drop', (e) => {
      const col = e.target.closest('[data-pipe-col]');
      if (!col) return;
      e.preventDefault();
      const id = Number(e.dataTransfer.getData('text/plain') || draggedId);
      draggedId = null;
      setSchoolStatus(schoolById(id), col.getAttribute('data-pipe-col'));
    });
    board.addEventListener('change', (e) => {
      const sel = e.target.closest('[data-pipe-status]');
      if (sel) setSchoolStatus(schoolById(sel.getAttribute('data-pipe-status')), sel.value);
    });
    board.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-pipe-open]');
      if (btn) openModalForEdit(Number(btn.getAttribute('data-pipe-open')));
    });
    window.renderPipeline();
  }

  // =====================================================================
  // 2) FOLLOW-UPS (cloud)
  // =====================================================================
  let followUps = [];

  function renderFollowUps() {
    const box = $('followupsContainer');
    const today = localDate(new Date());
    const groups = [
      { title: '🔴 متأخرة', cls: 'border-rose-200 bg-rose-50/60', items: followUps.filter((f) => f.next_follow_up < today) },
      { title: '🟠 اليوم', cls: 'border-amber-200 bg-amber-50/60', items: followUps.filter((f) => f.next_follow_up === today) },
      { title: '🗓️ الأيام السبعة القادمة', cls: 'border-slate-200 bg-white', items: followUps.filter((f) => f.next_follow_up > today) }
    ];
    const due = groups[0].items.length + groups[1].items.length;
    const badge = $('followupsBadge');
    badge.textContent = String(due);
    badge.classList.toggle('hidden', due === 0);

    if (!followUps.length) {
      box.innerHTML = '<div class="text-center py-10 text-slate-400">لا توجد متابعات مستحقة. أضف موعد متابعة من «سجل التواصل» داخل ملف أي مدرسة.</div>';
      return;
    }
    box.innerHTML = groups.filter((g) => g.items.length).map((g) => `
      <div class="space-y-2">
        <h3 class="font-bold text-slate-800">${g.title} <span class="text-slate-400 font-normal">(${g.items.length})</span></h3>
        ${g.items.map((f) => {
          const s = schoolById(f.school_id);
          return `
          <div class="rounded-xl border ${g.cls} p-3 flex flex-wrap items-start justify-between gap-2">
            <div class="space-y-1 min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-mono text-[11px] px-1.5 py-0.5 rounded bg-white border border-slate-200" dir="ltr">${escapeHtml(f.next_follow_up)}</span>
                <button type="button" data-fu-open="${Number(f.school_id)}" class="font-bold text-slate-900 hover:text-emerald-700 hover:underline text-right">${escapeHtml(s ? s.name : 'مدرسة #' + f.school_id)}</button>
              </div>
              <div class="text-slate-700">${INTERACTION_ICONS[f.type] || '•'} ${escapeHtml(f.summary)}</div>
              ${f.outcome ? `<div class="text-[11px] text-slate-500">النتيجة: ${escapeHtml(f.outcome)}</div>` : ''}
              <div class="text-[11px] text-slate-400">سجّلها <span class="font-mono" dir="ltr">${escapeHtml(f.created_by)}</span> — ${escapeHtml(fmtDate(f.created_at))}</div>
            </div>
            <button type="button" data-fu-complete="${Number(f.id)}" class="shrink-0 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold">✔ تمت</button>
          </div>`;
        }).join('')}
      </div>`).join('');
  }

  window.refreshFollowUps = async function refreshFollowUps() {
    if (!CLOUD) return;
    const until = new Date();
    until.setDate(until.getDate() + 7);
    try {
      followUps = await CRMDB.listFollowUps(localDate(until));
      renderFollowUps();
    } catch (err) {
      $('followupsContainer').innerHTML = `<div class="text-rose-600">تعذر تحميل المتابعات: ${escapeHtml(err.message)}</div>`;
    }
  };

  function initFollowUps() {
    $('navFollowups').classList.remove('hidden');
    $('navFollowups').addEventListener('click', window.refreshFollowUps);
    $('btnRefreshFollowups').addEventListener('click', window.refreshFollowUps);
    $('followupsContainer').addEventListener('click', async (e) => {
      const open = e.target.closest('[data-fu-open]');
      if (open) { openModalForEdit(Number(open.getAttribute('data-fu-open'))); return; }
      const done = e.target.closest('[data-fu-complete]');
      if (!done) return;
      done.disabled = true;
      try {
        await CRMDB.completeFollowUp(Number(done.getAttribute('data-fu-complete')), true);
        await window.refreshFollowUps();
        showToast('تم تسجيل المتابعة كمنجزة', '✅');
      } catch (err) {
        done.disabled = false;
        showToast('تعذر التحديث: ' + err.message, '⚠️');
      }
    });
    window.refreshFollowUps().then(() => {
      const due = followUps.filter((f) => f.next_follow_up <= localDate(new Date())).length;
      if (due) showToast(`لديك ${due} متابعة مستحقة اليوم أو متأخرة — راجع تبويب «المتابعات»`, '⏰');
    });
  }

  // =====================================================================
  // 3) CAMPAIGN MANAGER (cloud)
  // =====================================================================
  const ACTIVE_KEY = 'sudanese_schools_active_campaign_v1';
  let campaigns = [];
  let activeId = null;
  let targets = new Map(); // school_id -> target row

  const readActive = () => { try { return Number(localStorage.getItem(ACTIVE_KEY)) || null; } catch (e) { return null; } };
  const writeActive = (id) => { try { id ? localStorage.setItem(ACTIVE_KEY, String(id)) : localStorage.removeItem(ACTIVE_KEY); } catch (e) { /* ignore */ } };

  window.campaignBadgeFor = function (schoolId) {
    if (!activeId) return '';
    const t = targets.get(Number(schoolId));
    if (!t) return '<span class="text-[10px] text-slate-400">خارج الحملة</span>';
    const meta = TARGET_STATUSES[t.status] || TARGET_STATUSES.pending;
    return `<span class="px-1.5 py-0.5 rounded border text-[10px] font-bold ${meta.cls}">📣 ${meta.label}</span>`;
  };

  function renderCampaignSelect() {
    const sel = $('activeCampaignSelect');
    sel.innerHTML = '<option value="">— بدون حملة نشطة —</option>' + campaigns.map((c) =>
      `<option value="${Number(c.id)}">${escapeHtml(c.name)} (${c.counts.sent + c.counts.replied + c.counts.interested + c.counts.not_interested}/${c.counts.total})</option>`).join('');
    sel.value = activeId ? String(activeId) : '';
    $('btnArchiveCampaign').classList.toggle('hidden', !activeId);
  }

  function renderCampaignBody() {
    const stats = $('campaignStats');
    const wrap = $('campaignTargetsWrap');
    if (!activeId) {
      stats.innerHTML = '';
      wrap.classList.add('hidden');
      return;
    }
    const rows = [...targets.values()];
    const count = (k) => rows.filter((t) => t.status === k).length;
    const replied = count('replied') + count('interested') + count('not_interested');
    const sentAll = rows.length - count('pending');
    const rate = sentAll ? Math.round((replied / sentAll) * 100) : 0;
    stats.innerHTML = [
      ['🎯 المستهدفة', rows.length, 'bg-slate-100 text-slate-800 border-slate-200'],
      ...Object.entries(TARGET_STATUSES).map(([k, m]) => [m.label, count(k), m.cls]),
      ['📈 نسبة الرد', rate + '%', 'bg-indigo-50 text-indigo-800 border-indigo-200']
    ].map(([l, v, c]) => `<span class="px-2.5 py-1 rounded-lg border font-bold ${c}">${l}: ${v}</span>`).join('');

    $('campaignTargetsBody').innerHTML = rows
      .map((t) => ({ t, s: schoolById(t.school_id) }))
      .sort((a, b) => (a.s ? a.s.id : 0) - (b.s ? b.s.id : 0))
      .map(({ t, s }) => `
        <tr class="hover:bg-slate-50">
          <td class="py-2 px-3"><button type="button" data-camp-open="${Number(t.school_id)}" class="font-bold text-slate-900 hover:text-emerald-700 hover:underline text-right">${escapeHtml(s ? s.name : '#' + t.school_id)}</button></td>
          <td class="py-2 px-3 text-slate-600">${escapeHtml(s ? s.zone : '')}</td>
          <td class="py-2 px-3">
            <select data-camp-status="${Number(t.school_id)}" class="rounded-lg border px-2 py-1 text-xs font-bold ${(TARGET_STATUSES[t.status] || TARGET_STATUSES.pending).cls}">
              ${Object.entries(TARGET_STATUSES).map(([k, m]) => `<option value="${k}" ${k === t.status ? 'selected' : ''}>${m.label}</option>`).join('')}
            </select>
          </td>
          <td class="py-2 px-3 text-slate-500 whitespace-nowrap">${escapeHtml(fmtDate(t.sent_at))}</td>
          <td class="py-2 px-3 text-slate-500 whitespace-nowrap">${escapeHtml(fmtDate(t.replied_at))}</td>
        </tr>`).join('');
    wrap.classList.remove('hidden');
  }

  async function loadTargets() {
    targets = new Map();
    if (activeId) {
      const rows = await CRMDB.listCampaignTargets(activeId);
      rows.forEach((r) => targets.set(Number(r.school_id), r));
    }
    renderCampaignBody();
    renderCampaignQueue();
  }

  async function refreshCampaigns() {
    try {
      campaigns = await CRMDB.listCampaigns();
      if (activeId && !campaigns.some((c) => Number(c.id) === activeId)) {
        activeId = null;
        writeActive(null);
      }
      renderCampaignSelect();
      await loadTargets();
    } catch (err) {
      showToast('تعذر تحميل الحملات: ' + err.message, '⚠️');
    }
  }

  async function updateTarget(schoolId, status) {
    const t = targets.get(Number(schoolId));
    if (!t || !activeId || t.status === status) return;
    const prev = t.status;
    t.status = status;
    if (status !== 'pending' && !t.sent_at) t.sent_at = new Date().toISOString();
    if (['replied', 'interested', 'not_interested'].includes(status) && !t.replied_at) t.replied_at = new Date().toISOString();
    renderCampaignBody();
    renderCampaignQueue();
    try {
      await CRMDB.setTargetStatus(activeId, Number(schoolId), status);
      // Keep the school's sales stage in step with a positive reply
      const s = schoolById(schoolId);
      if (status === 'interested' && s && ['لم يتم التواصل', 'تم إرسال عرض'].includes(s.status)) {
        setSchoolStatus(s, 'مهتم / متابعة');
      }
      const c = campaigns.find((x) => Number(x.id) === activeId);
      if (c) { c.counts[prev]--; c.counts[status]++; renderCampaignSelect(); }
    } catch (err) {
      t.status = prev;
      renderCampaignBody();
      renderCampaignQueue();
      showToast('تعذر تحديث حالة الحملة: ' + err.message, '⚠️');
    }
  }

  // Called by the WhatsApp / email buttons
  window.onCampaignContact = function (schoolId) {
    const t = targets.get(Number(schoolId));
    if (t && t.status === 'pending') updateTarget(schoolId, 'sent');
  };

  function updateNewCampaignCount() {
    $('newCampaignCount').textContent = String(schoolsData.filter((s) => s.selected).length);
  }

  function initCampaigns() {
    $('campaignManager').classList.remove('hidden');
    activeId = readActive();
    updateNewCampaignCount();
    document.body.addEventListener('change', (e) => {
      // Defer: the main page's handler updates `selected` after this listener runs
      if (e.target.closest('[data-action="toggle-select"]')) setTimeout(updateNewCampaignCount, 0);
    });
    ['btnSelectAllWhatsappSchools', 'btnClearSelection', 'selectAllVisible'].forEach((id) => {
      const el = $(id);
      if (el) el.addEventListener(id === 'selectAllVisible' ? 'change' : 'click', () => setTimeout(updateNewCampaignCount, 0));
    });
    document.querySelector('[data-tab="tab-campaigns"]').addEventListener('click', () => { updateNewCampaignCount(); refreshCampaigns(); });

    $('activeCampaignSelect').addEventListener('change', async (e) => {
      activeId = Number(e.target.value) || null;
      writeActive(activeId);
      $('btnArchiveCampaign').classList.toggle('hidden', !activeId);
      const c = campaigns.find((x) => Number(x.id) === activeId);
      if (c && (c.subject || c.body)) {
        if (c.subject) $('emailSubjectInput').value = c.subject;
        if (c.body) $('campaignBodyInput').value = c.body;
      }
      try { await loadTargets(); } catch (err) { showToast('تعذر تحميل مدارس الحملة: ' + err.message, '⚠️'); }
    });

    $('newCampaignForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const ids = schoolsData.filter((s) => s.selected).map((s) => s.id);
      if (!ids.length) { showToast('حدّد مدرسة واحدة على الأقل قبل حفظ الحملة', 'ℹ️'); return; }
      const btn = $('btnCreateCampaign');
      btn.disabled = true;
      try {
        await CRMDB.syncSchools(schoolsData); // make sure newly added schools exist first
        const id = await CRMDB.createCampaign({
          name: $('newCampaignName').value.trim(),
          channel: $('newCampaignChannel').value,
          subject: $('emailSubjectInput').value,
          body: $('campaignBodyInput').value,
          schoolIds: schoolsData.filter((s) => s.selected).map((s) => s.id)
        });
        activeId = id;
        writeActive(id);
        $('newCampaignForm').reset();
        await refreshCampaigns();
        showToast(`تم إنشاء الحملة بـ ${ids.length} مدرسة وأصبحت الحملة النشطة`, '📣');
      } catch (err) {
        showToast('تعذر إنشاء الحملة: ' + err.message, '⚠️');
      } finally {
        btn.disabled = false;
      }
    });

    $('btnArchiveCampaign').addEventListener('click', async () => {
      const c = campaigns.find((x) => Number(x.id) === activeId);
      if (!c || !confirm(`أرشفة حملة «${c.name}»؟ ستختفي من القائمة وتبقى بياناتها محفوظة.`)) return;
      try {
        await CRMDB.archiveCampaign(activeId);
        activeId = null;
        writeActive(null);
        await refreshCampaigns();
        showToast('تمت أرشفة الحملة', '🗄️');
      } catch (err) {
        showToast('تعذرت الأرشفة: ' + err.message, '⚠️');
      }
    });

    $('campaignTargetsBody').addEventListener('change', (e) => {
      const sel = e.target.closest('[data-camp-status]');
      if (sel) updateTarget(sel.getAttribute('data-camp-status'), sel.value);
    });
    $('campaignTargetsBody').addEventListener('click', (e) => {
      const b = e.target.closest('[data-camp-open]');
      if (b) openModalForEdit(Number(b.getAttribute('data-camp-open')));
    });

    refreshCampaigns();
  }

  // =====================================================================
  // 4) AUDIT LOG (cloud, admins)
  // =====================================================================
  const FIELD_LABELS = {
    name: 'الاسم', zone: 'المنطقة', category: 'التصنيف', address: 'العنوان', phones: 'الهواتف', whatsapp: 'واتساب',
    email: 'البريد', links: 'الروابط', stages: 'المراحل', status: 'الحالة', notes: 'الملاحظات',
    summary: 'الملخص', outcome: 'النتيجة', next_follow_up: 'موعد المتابعة', follow_up_done: 'تمت المتابعة',
    type: 'النوع', direction: 'الاتجاه', subject: 'العنوان', body: 'النص', archived: 'مؤرشفة', channel: 'القناة'
  };
  const SKIP = new Set(['updated_at', 'updated_by', 'created_at', 'created_by', 'id', 'follow_up_done_at', 'follow_up_done_by', 'sent_at', 'replied_at']);
  const TABLE_LABELS = { schools: '🏫 مدرسة', interactions: '🗒️ سجل تواصل', campaigns: '📣 حملة', campaign_targets: '🎯 مدرسة في حملة' };
  const ACTION_LABELS = { INSERT: 'إضافة', UPDATE: 'تعديل', DELETE: 'حذف' };
  const short = (v) => {
    const t = v == null ? '—' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
    return t.length > 120 ? t.slice(0, 117) + '…' : t;
  };

  function auditDetails(r) {
    if (r.action === 'UPDATE' && r.old_data && r.new_data) {
      const changed = Object.keys(r.new_data).filter((k) => !SKIP.has(k) && JSON.stringify(r.old_data[k]) !== JSON.stringify(r.new_data[k]));
      if (!changed.length) return '<span class="text-slate-400">لا تغيير في الحقول</span>';
      return changed.map((k) => `<div><span class="font-bold">${escapeHtml(FIELD_LABELS[k] || k)}:</span>
        <span class="text-rose-700 line-through">${escapeHtml(short(r.old_data[k]))}</span> ←
        <span class="text-emerald-700">${escapeHtml(short(r.new_data[k]))}</span></div>`).join('');
    }
    const d = r.new_data || r.old_data || {};
    return escapeHtml(short(d.summary || d.name || d.status || ''));
  }

  async function refreshAudit() {
    const body = $('auditTableBody');
    body.innerHTML = '<tr><td colspan="5" class="py-6 text-center text-slate-400">⏳ جاري التحميل...</td></tr>';
    try {
      const rows = await CRMDB.listAudit(200);
      if (!rows.length) {
        body.innerHTML = '<tr><td colspan="5" class="py-6 text-center text-slate-400">لا توجد تعديلات مسجلة.</td></tr>';
        return;
      }
      body.innerHTML = rows.map((r) => {
        const d = r.new_data || r.old_data || {};
        const sid = r.table_name === 'schools' ? r.row_id : d.school_id;
        const s = sid ? schoolById(sid) : null;
        return `<tr class="align-top hover:bg-slate-50">
          <td class="py-2 px-2 whitespace-nowrap text-slate-500">${escapeHtml(fmtDateTime(r.changed_at))}</td>
          <td class="py-2 px-2 font-mono text-[11px]" dir="ltr">${escapeHtml(r.changed_by || 'system')}</td>
          <td class="py-2 px-2 whitespace-nowrap">${TABLE_LABELS[r.table_name] || escapeHtml(r.table_name)} — ${ACTION_LABELS[r.action] || escapeHtml(r.action)}</td>
          <td class="py-2 px-2">${s ? escapeHtml(s.name) : (sid ? '#' + Number(sid) : '—')}</td>
          <td class="py-2 px-2 space-y-0.5">${auditDetails(r)}</td>
        </tr>`;
      }).join('');
    } catch (err) {
      body.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-rose-600">تعذر التحميل: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function initAudit() {
    $('navAudit').classList.remove('hidden');
    $('navAudit').addEventListener('click', refreshAudit);
    $('btnRefreshAudit').addEventListener('click', refreshAudit);
  }

  // =====================================================================
  window.onCrmReady = function () {
    initPipeline();
    if (!CLOUD) return;
    initFollowUps();
    initCampaigns();
    if (CRMDB.me && CRMDB.me.role === 'admin') initAudit();
  };
})();
