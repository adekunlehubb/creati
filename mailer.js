/**
 * mailer.js — CreatiHub email delivery module
 * --------------------------------------------
 * Sends real transactional + marketing emails via the Resend API.
 *
 * HOW IT WORKS:
 *  - If RESEND_API_KEY is set in environment → emails are sent for real via Resend.
 *  - If no API key → emails gracefully fall back to queue-only (saved to DB outbox),
 *    so the app never crashes and the admin can see queued mail in the dashboard.
 *  - Every email is ALSO saved to the DB outbox (d.emails) with a 'sent' or 'failed'
 *    status, so there's always a record.
 *
 * SETUP (one-time, for the admin):
 *   1. Sign up at https://resend.com (free — 100 emails/day)
 *   2. Add + verify your sending domain (e.g. creatihub.com.ng) in Resend dashboard
 *      — Resend will give you DNS records to add in Cloudflare (SPF, DKIM, DMARC).
 *   3. Create an API key in Resend → copy it.
 *   4. In Railway → your project → Variables → add:  RESEND_API_KEY=re_xxxxx
 *   5. Redeploy. Done — emails now send for real.
 *
 * Until step 4 is done, emails are queued but not delivered (safe fallback).
 */

// We use Node's built-in fetch (Node 18+) to call Resend's REST API directly.
// No external npm package needed — keeps the deploy lightweight.

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const RESEND_ENDPOINT = 'https://api.resend.com/emails';

// Sender address. Can be overridden via env. Default uses onboarding@resend.dev
// which works out-of-the-box for testing before you verify your own domain.
const FROM_EMAIL = process.env.MAIL_FROM || 'CreatiHub <noreply@creatihub.com.ng>';
const REPLY_TO = process.env.MAIL_REPLY_TO || 'admin@creatihub.com.ng';

/**
 * Actually send an email via Resend.
 * @param {string} to       — recipient email address
 * @param {string} subject  — email subject line
 * @param {string} body     — plain-text body (we also generate a simple HTML version)
 * @returns {Promise<{ok:boolean, id?:string, error?:string}>}
 */
async function sendViaResend(to, subject, body) {
  if (!RESEND_API_KEY) {
    return { ok: false, error: 'No RESEND_API_KEY set — email queued but not sent' };
  }

  // Convert plain-text body to simple HTML for nicer rendering in email clients
  const htmlBody = body
    .split('\n')
    .map(line => line.trim())
    .map(line => line === '' ? '<br>' : `<p style="margin:0 0 12px;line-height:1.6;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1a1a2e;">${escapeHtml(line)}</p>`)
    .join('\n');

  const payload = {
    from: FROM_EMAIL,
    to: to,
    reply_to: REPLY_TO,
    subject: subject,
    text: body,
    html: `<!DOCTYPE html><html><body style="background:#f4f4f8;padding:20px;margin:0;">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px 28px;border:1px solid #e8e8f0;">
<div style="text-align:center;margin-bottom:24px;">
<span style="font-size:24px;font-weight:800;color:#4f46e5;font-family:Arial,Helvetica,sans-serif;letter-spacing:-0.5px;">CreatiHub</span>
</div>
${htmlBody}
<div style="margin-top:32px;padding-top:20px;border-top:1px solid #e8e8f0;text-align:center;">
<p style="font-size:13px;color:#888;font-family:Arial,Helvetica,sans-serif;margin:0;">
CreatiHub — Nigeria's Creative Services Marketplace<br>
<a href="https://creatihub.com.ng" style="color:#4f46e5;text-decoration:none;">creatihub.com.ng</a>
</p>
</div>
</div>
</body></html>`
  };

  try {
    const resp = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + RESEND_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await resp.json().catch(() => ({}));

    if (resp.ok && (data.id || data.data)) {
      return { ok: true, id: data.id || (data.data && data.data.id) || 'sent' };
    } else {
      return { ok: false, error: (data.message || data.error || JSON.stringify(data)).slice(0, 300) };
    }
  } catch (err) {
    return { ok: false, error: String(err.message || err).slice(0, 300) };
  }
}

/**
 * Send an email to a SINGLE recipient.
 * Returns an object with status info so callers can record it in the outbox.
 */
async function sendOne(to, subject, body) {
  const result = await sendViaResend(to, subject, body);
  return {
    status: result.ok ? 'sent' : 'failed',
    messageId: result.id || null,
    error: result.ok ? null : result.error
  };
}

/**
 * Send a marketing/broadcast email to MULTIPLE recipients.
 * Resend's API accepts an array of up to 50 addresses in the "to" field
 * for batch sends (same content). We chunk to stay within limits.
 *
 * @param {string[]} recipients — array of email addresses
 * @param {string} subject
 * @param {string} body
 * @returns {Promise<{sent:number, failed:number, errors:string[]}>}
 */
async function sendBroadcast(recipients, subject, body) {
  if (!RESEND_API_KEY) {
    return { sent: 0, failed: recipients.length, errors: ['No RESEND_API_KEY set'] };
  }

  // De-duplicate and validate email addresses
  const clean = [...new Set(recipients.filter(e => e && /\S+@\S+\.\S+/.test(e)))];
  if (clean.length === 0) {
    return { sent: 0, failed: 0, errors: ['No valid recipient addresses'] };
  }

  // Build a simple HTML version (reuse logic)
  const htmlBody = body
    .split('\n')
    .map(line => line.trim())
    .map(line => line === '' ? '<br>' : `<p style="margin:0 0 12px;line-height:1.6;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1a1a2e;">${escapeHtml(line)}</p>`)
    .join('\n');

  let sent = 0;
  let failed = 0;
  const errors = [];

  // Resend allows up to 50 recipients per "to" array in a single API call
  const CHUNK_SIZE = 50;
  for (let i = 0; i < clean.length; i += CHUNK_SIZE) {
    const chunk = clean.slice(i, i + CHUNK_SIZE);
    try {
      const resp = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + RESEND_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: chunk,               // array — batch send
          reply_to: REPLY_TO,
          subject: subject,
          text: body,
          html: `<!DOCTYPE html><html><body style="background:#f4f4f8;padding:20px;margin:0;">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px 28px;border:1px solid #e8e8f0;">
<div style="text-align:center;margin-bottom:24px;">
<span style="font-size:24px;font-weight:800;color:#4f46e5;font-family:Arial,Helvetica,sans-serif;letter-spacing:-0.5px;">CreatiHub</span>
</div>
${htmlBody}
<div style="margin-top:32px;padding-top:20px;border-top:1px solid #e8e8f0;text-align:center;">
<p style="font-size:13px;color:#888;font-family:Arial,Helvetica,sans-serif;margin:0;">
CreatiHub — Nigeria's Creative Services Marketplace<br>
<a href="https://creatihub.com.ng" style="color:#4f46e5;text-decoration:none;">creatihub.com.ng</a>
</p>
<p style="font-size:11px;color:#bbb;font-family:Arial,Helvetica,sans-serif;margin:8px 0 0;">
You received this email because you have a CreatiHub account.
</p>
</div>
</div>
</body></html>`
        })
      });

      const data = await resp.json().catch(() => ({}));
      if (resp.ok) {
        sent += chunk.length;
      } else {
        failed += chunk.length;
        errors.push((data.message || data.error || 'Unknown error').slice(0, 200));
      }
    } catch (err) {
      failed += chunk.length;
      errors.push(String(err.message || err).slice(0, 200));
    }
  }

  return { sent, failed, errors };
}

/**
 * Check if real email sending is configured.
 * Useful for the admin dashboard to show a status indicator.
 */
function isConfigured() {
  return !!RESEND_API_KEY;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { sendOne, sendBroadcast, isConfigured, FROM_EMAIL, REPLY_TO };
