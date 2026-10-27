// Transactional email. Every message is written to the outbox table first, then
// delivered through the configured provider (Resend or Postmark over HTTPS).
// With MAIL_PROVIDER=outbox (default in development) messages stay in the outbox,
// visible at /ops/outbox, so nothing is silently lost.
import { config, company } from '../config.js';
import { run } from '../db.js';
import { esc } from './core.js';

export async function sendMail({ to, subject, html, text, replyTo }) {
  const recipients = [].concat(to).filter(Boolean);
  for (const addr of recipients) {
    const id = Number(run('INSERT INTO outbox (to_addr,subject,html,text,status,provider,created_at) VALUES (?,?,?,?,?,?,?)',
      addr, subject, html, text || '', 'queued', config.mail.provider, new Date().toISOString()).lastInsertRowid);
    deliver(id, { to: addr, subject, html, text, replyTo: replyTo || config.mail.replyTo }).catch(() => {});
  }
}

async function deliver(id, m) {
  const p = config.mail.provider;
  try {
    if (p === 'resend' && config.mail.resendKey) {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.mail.resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: config.mail.from, to: [m.to], subject: m.subject, html: m.html, text: m.text, reply_to: m.replyTo || undefined }),
      });
      if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 300)}`);
    } else if (p === 'postmark' && config.mail.postmarkToken) {
      const r = await fetch('https://api.postmarkapp.com/email', {
        method: 'POST',
        headers: { 'X-Postmark-Server-Token': config.mail.postmarkToken, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ From: config.mail.from, To: m.to, Subject: m.subject, HtmlBody: m.html, TextBody: m.text, ReplyTo: m.replyTo || undefined, MessageStream: 'outbound' }),
      });
      if (!r.ok) throw new Error(`Postmark ${r.status}: ${(await r.text()).slice(0, 300)}`);
    } else {
      run("UPDATE outbox SET status='held' WHERE id=?", id);
      if (!config.production) console.log(`[mail:outbox] → ${m.to} | ${m.subject}`);
      return;
    }
    run("UPDATE outbox SET status='sent', sent_at=? WHERE id=?", new Date().toISOString(), id);
  } catch (e) {
    run("UPDATE outbox SET status='failed', error=? WHERE id=?", String(e.message).slice(0, 500), id);
    console.error('[mail] delivery failed', e.message);
  }
}

export const staffRecipients = () => config.mail.staff;

/** Branded, email-client-safe wrapper. `body` is trusted HTML built with esc(). */
export function emailLayout(title, body) {
  return `<!doctype html><html><body style="margin:0;background:#eef2f7;font-family:Arial,Helvetica,sans-serif;color:#13233b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;padding:24px 0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:10px;overflow:hidden">
<tr><td style="background:#0b2340;padding:22px 28px"><img src="${config.baseUrl}/brand/logo-white.png" alt="LANSAR Freight Shipping Corp" height="40" style="display:block;height:40px"></td></tr>
<tr><td style="padding:28px"><h1 style="margin:0 0 16px;font-size:20px;color:#102B4E">${esc(title)}</h1>${body}</td></tr>
<tr><td style="padding:18px 28px;background:#f6f8fb;font-size:12px;color:#5b6b80">${esc(company.name)} · ${esc(company.city)} · ${esc(company.phone)}<br>
This message relates to a request you or your company submitted at ${esc(company.website.replace('https://', ''))}.</td></tr>
</table></td></tr></table></body></html>`;
}

export const emailRow = (k, v) => `<tr><td style="padding:6px 12px 6px 0;color:#5b6b80;font-size:13px;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:6px 0;font-size:14px">${esc(v ?? '—')}</td></tr>`;
export const emailButton = (href, label) => `<p style="margin:24px 0"><a href="${esc(href)}" style="background:#0878C9;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:bold;display:inline-block">${esc(label)}</a></p>`;
