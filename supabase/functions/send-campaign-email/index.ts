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

  const apiKey = Deno.env.get('BREVO_API_KEY');
  const senderEmail = Deno.env.get('SENDER_EMAIL');
  const senderName = Deno.env.get('SENDER_NAME') || 'Experience Media';
  if (!apiKey || !senderEmail) return json({ error: 'خدمة البريد غير مهيأة: أضف BREVO_API_KEY و SENDER_EMAIL في أسرار الدالة' }, 500);

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

  const results: { school_id: number; ok: boolean; error?: string }[] = [];
  for (const m of messages) {
    const school = byId.get(Number(m.school_id));
    const to = String(school?.email ?? '').trim();
    if (!school || !/^\S+@\S+\.\S+$/.test(to)) {
      results.push({ school_id: m.school_id, ok: false, error: 'لا يوجد بريد صالح' });
      continue;
    }
    const subject = String(m.subject || '').slice(0, 250) || 'Experience Media';
    const text = String(m.text || '').slice(0, 20000);
    try {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          sender: { email: senderEmail, name: senderName },
          to: [{ email: to, name: school.name }],
          subject,
          htmlContent: toHtml(text, video),
          textContent: text + (video ? `\n\n▶️ ${video.url}` : '')
        })
      });
      if (!res.ok) {
        const detail = await res.text();
        results.push({ school_id: school.id, ok: false, error: `Brevo ${res.status}: ${detail.slice(0, 200)}` });
        continue;
      }
      results.push({ school_id: school.id, ok: true });
      await supabase.from('interactions').insert({
        school_id: school.id, type: 'email', direction: 'out', summary: `إرسال بريد الحملة: ${subject}`
      });
      if (campaignId) {
        await supabase.from('campaign_targets').update({ status: 'sent' })
          .eq('campaign_id', campaignId).eq('school_id', school.id).eq('status', 'pending');
      }
    } catch (e) {
      results.push({ school_id: school.id, ok: false, error: String(e).slice(0, 200) });
    }
    await new Promise((r) => setTimeout(r, 120)); // stay well under Brevo's rate limit
  }

  return json({ sent: results.filter((r) => r.ok).length, results });
});
