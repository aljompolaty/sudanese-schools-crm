/**
 * Gmail sender for the Sudanese Schools CRM (Google Apps Script).
 * Sends campaign emails from YOUR Gmail account. Only the CRM's Supabase function can call it
 * (it must present the secret stored in this script's properties).
 *
 * Setup (once):
 *   1. https://script.google.com → New project → paste this file → Save.
 *   2. Choose the function "setup" in the toolbar → Run → allow the permissions.
 *      Then View → Logs (or "Execution log"): copy the secret it prints.
 *   3. Deploy → New deployment → type "Web app" →
 *        Execute as: Me    |    Who has access: Anyone   → Deploy → copy the Web app URL.
 *   4. In Supabase → Edge Functions → Secrets add:
 *        GMAIL_SCRIPT_URL    = the Web app URL
 *        GMAIL_SCRIPT_SECRET = the secret from step 2
 *
 * Uses MailApp (permission: "Send email as you" only — it cannot read your inbox).
 * Free Gmail accounts can send to about 100 recipients per day this way.
 */

/** Run once from the editor: creates the shared secret and prints it to the log. */
function setup() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('SHARED_SECRET');
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
    props.setProperty('SHARED_SECRET', secret);
  }
  // Touch MailApp so the "send email" permission is requested now, not on the first campaign
  const remaining = MailApp.getRemainingDailyQuota();
  Logger.log('GMAIL_SCRIPT_SECRET = ' + secret);
  Logger.log('Emails you can still send today: ' + remaining);
}

/** Run if the secret ever leaks: makes a new one (update GMAIL_SCRIPT_SECRET in Supabase after). */
function rotateSecret() {
  PropertiesService.getScriptProperties().deleteProperty('SHARED_SECRET');
  setup();
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return reply({ ok: false, error: 'invalid JSON' });
  }

  const secret = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');
  if (!secret || body.secret !== secret) {
    return reply({ ok: false, error: 'unauthorized' });
  }

  if (body.action === 'quota') {
    return reply({ ok: true, remaining: MailApp.getRemainingDailyQuota() });
  }

  const messages = Array.isArray(body.messages) ? body.messages.slice(0, 100) : [];
  const senderName = String(body.sender_name || 'Experience Media').slice(0, 100);
  const results = [];

  messages.forEach(function (m) {
    const to = String(m.to || '').trim();
    if (!/^\S+@\S+\.\S+$/.test(to)) {
      results.push({ id: m.id, ok: false, error: 'invalid address' });
      return;
    }
    if (MailApp.getRemainingDailyQuota() < 1) {
      results.push({ id: m.id, ok: false, error: 'تم الوصول إلى حد Gmail اليومي — أكمل غداً' });
      return;
    }
    try {
      MailApp.sendEmail({
        to: to,
        subject: String(m.subject || '').slice(0, 250),
        body: String(m.text || ''),
        htmlBody: m.html ? String(m.html) : undefined,
        name: senderName
      });
      results.push({ id: m.id, ok: true });
    } catch (err) {
      results.push({ id: m.id, ok: false, error: String(err).slice(0, 200) });
    }
  });

  return reply({ ok: true, results: results, remaining: MailApp.getRemainingDailyQuota() });
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
