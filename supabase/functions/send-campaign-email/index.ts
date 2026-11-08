// Supabase Edge Function: send-campaign-email
// Sends personalised campaign emails through Brevo, then logs each one in the CRM.
//
// Deploy: Supabase Dashboard → Edge Functions → Deploy a new function → Via Editor
//         name: send-campaign-email → paste this file → Deploy
// Secrets (Edge Functions → Secrets):
//   BREVO_API_KEY  — Brevo → SMTP & API → API Keys
//   SENDER_EMAIL   — a sender address verified in Brevo (Senders, Domains & Dedicated IPs)
//   SENDER_NAME    — e.g. Experience Media
//
// Request body: { campaign_id: number|null, messages: [{ school_id, subject, text }], video?: { url, thumb } }
// Recipient addresses are read from the database, never from the request.

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const MAX_MESSAGES = 100;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const isHttps = (u: unknown): u is string => typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/i.test(u);

function toHtml(text: string, video: { url: string; thumb?: string } | null): string {
  const body = esc(text)
    .replace(/(https:\/\/[^\s<]+)/g, '<a href="$1" style="color:#2563eb">$1</a>')
    .replace(/\*([^*\n]+)\*/g, '<b>$1</b>') // WhatsApp-style *bold*
    .replace(/\n/g, '<br>');
  const videoBlock = video
    ? `<p style="margin:24px 0;text-align:center">
         <a href="${esc(video.url)}" style="text-decoration:none">
           ${isHttps(video.thumb) ? `<img src="${esc(video.thumb)}" alt="شاهد الفيديو التعريفي" width="560" style="max-width:100%;border-radius:12px;border:0;display:block;margin:0 auto">` : ''}
           <span style="display:inline-block;margin-top:12px;padding:10px 18px;border-radius:10px;background:#16a34a;color:#fff;font-weight:bold">▶️ شاهد الفيديو التعريفي (35 ثانية)</span>
         </a>
       </p>`
    : '';
  return `<!doctype html><html lang="ar" dir="rtl"><body style="margin:0;background:#f1f5f9">
    <div style="max-width:640px;margin:0 auto;padding:24px 16px;font-family:Tahoma,Arial,sans-serif;font-size:15px;line-height:1.9;color:#0f172a">
      <div style="background:#fff;border-radius:14px;padding:24px;border:1px solid #e2e8f0">${body}${videoBlock}</div>
    </div></body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // Provider: your Gmail (Apps Script) when configured, otherwise Brevo
  const gmailUrl = Deno.env.get('GMAIL_SCRIPT_URL');
  const gmailSecret = Deno.env.get('GMAIL_SCRIPT_SECRET');
  const brevoKey = Deno.env.get('BREVO_API_KEY');
  const senderEmail = Deno.env.get('SENDER_EMAIL');
  const senderName = Deno.env.get('SENDER_NAME') || 'Experience Media';
  const provider = gmailUrl && gmailSecret ? 'gmail' : (brevoKey && senderEmail ? 'brevo' : null);
  if (!provider) {
    return json({ error: 'خدمة البريد غير مهيأة: أضف GMAIL_SCRIPT_URL و GMAIL_SCRIPT_SECRET (أو BREVO_API_KEY و SENDER_EMAIL) في أسرار الدالة' }, 500);
  }
  if (gmailUrl && !/^https:\/\/script\.google(usercontent)?\.com\//.test(gmailUrl)) {
    return json({ error: 'GMAIL_SCRIPT_URL يجب أن يكون رابط Web app من script.google.com' }, 500);
  }

  // Act as the signed-in user so Row Level Security applies to every read and write
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }
  });
  const { data: auth } = await supabase.auth.getUser();
  const email = auth.user?.email?.toLowerCase();
  if (!email) return json({ error: 'يجب تسجيل الدخول' }, 401);
  const { data: member } = await supabase.from('team_members').select('email').eq('email', email).maybeSingle();
  if (!member) return json({ error: 'هذا الحساب ليس من فريق العمل' }, 403);

  let payload: { campaign_id?: number | null; messages?: { school_id: number; subject: string; text: string }[]; video?: { url: string; thumb?: string } | null };
  try { payload = await req.json(); } catch { return json({ error: 'طلب غير صالح' }, 400); }
  const messages = Array.isArray(payload.messages) ? payload.messages.slice(0, MAX_MESSAGES) : [];
  if (!messages.length) return json({ error: 'لا توجد رسائل' }, 400);
  const campaignId = Number(payload.campaign_id) || null;
  const video = payload.video && isHttps(payload.video.url) ? payload.video : null;

  const ids = [...new Set(messages.map((m) => Number(m.school_id)).filter(Boolean))];
  const { data: schools, error: schoolsErr } = await supabase.from('schools').select('id, name, email').in('id', ids);
  if (schoolsErr) return json({ error: schoolsErr.message }, 500);
  const byId = new Map((schools ?? []).map((s) => [Number(s.id), s]));

  // Build every email first (recipient always comes from the database)
  type Outgoing = { school_id: number; name: string; to: string; subject: string; text: string; html: string };
  const results: { school_id: number; ok: boolean; error?: string }[] = [];
  const outgoing: Outgoing[] = [];
  for (const m of messages) {
    const school = byId.get(Number(m.school_id));
    const to = String(school?.email ?? '').trim();
    if (!school || !/^\S+@\S+\.\S+$/.test(to)) {
      results.push({ school_id: Number(m.school_id), ok: false, error: 'لا يوجد بريد صالح' });
      continue;
    }
    const subject = String(m.subject || '').slice(0, 250) || senderName;
    const text = String(m.text || '').slice(0, 20000);
    outgoing.push({
      school_id: Number(school.id), name: school.name, to, subject,
      text: text + (video ? `\n\n▶️ ${video.url}` : ''),
      html: toHtml(text, video)
    });
  }

  const sentOk: Outgoing[] = [];
  if (provider === 'gmail') {
    // One call to the Apps Script web app; it sends from the owner's Gmail
    try {
      const res = await fetch(gmailUrl!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secret: gmailSecret,
          sender_name: senderName,
          messages: outgoing.map((o) => ({ id: o.school_id, to: o.to, subject: o.subject, text: o.text, html: o.html }))
        }),
        redirect: 'follow'
      });
      const raw = await res.text();
      let out: { ok?: boolean; error?: string; results?: { id: number; ok: boolean; error?: string }[] } = {};
      try { out = JSON.parse(raw); } catch { out = { ok: false, error: `Gmail script ${res.status}: ${raw.slice(0, 160)}` }; }
      if (!out.ok) {
        const err = out.error === 'unauthorized' ? 'المفتاح السري لسكربت Gmail غير مطابق (GMAIL_SCRIPT_SECRET)' : (out.error || 'فشل سكربت Gmail');
        outgoing.forEach((o) => results.push({ school_id: o.school_id, ok: false, error: err }));
      } else {
        const byResult = new Map((out.results ?? []).map((r) => [Number(r.id), r]));
        for (const o of outgoing) {
          const r = byResult.get(o.school_id);
          if (r?.ok) { sentOk.push(o); results.push({ school_id: o.school_id, ok: true }); }
          else results.push({ school_id: o.school_id, ok: false, error: r?.error || 'لم يُرسل' });
        }
      }
    } catch (e) {
      outgoing.forEach((o) => results.push({ school_id: o.school_id, ok: false, error: String(e).slice(0, 200) }));
    }
  } else {
    for (const o of outgoing) {
      try {
        const res = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: { 'api-key': brevoKey!, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            sender: { email: senderEmail, name: senderName },
            to: [{ email: o.to, name: o.name }],
            subject: o.subject,
            htmlContent: o.html,
            textContent: o.text
          })
        });
        if (!res.ok) {
          results.push({ school_id: o.school_id, ok: false, error: `Brevo ${res.status}: ${(await res.text()).slice(0, 200)}` });
        } else {
          sentOk.push(o);
          results.push({ school_id: o.school_id, ok: true });
        }
      } catch (e) {
        results.push({ school_id: o.school_id, ok: false, error: String(e).slice(0, 200) });
      }
      await new Promise((r) => setTimeout(r, 120)); // stay well under Brevo's rate limit
    }
  }

  // Record what was actually sent
  for (const o of sentOk) {
    await supabase.from('interactions').insert({
      school_id: o.school_id, type: 'email', direction: 'out',
      summary: `إرسال بريد الحملة (${provider === 'gmail' ? 'Gmail' : 'Brevo'}): ${o.subject}`
    });
    if (campaignId) {
      await supabase.from('campaign_targets').update({ status: 'sent' })
        .eq('campaign_id', campaignId).eq('school_id', o.school_id).eq('status', 'pending');
    }
  }

  return json({ provider, sent: sentOk.length, results });
});
