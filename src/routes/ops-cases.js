import { router } from '../router.js';
import { h, raw, html, str, HttpError, fmtDateTime, nowIso, esc, hmac } from '../lib/core.js';
import { requireStaff } from '../lib/auth.js';
import { one, all, run, logActivity } from '../db.js';
import { opsLayout, csrf, staffPost, badge, userOptions, optionList, go } from '../views/ops-layout.js';
import { caseTypes, caseStatuses, config, company } from '../config.js';
import { fmtSize, storeFiles, validateFiles } from '../lib/files.js';
import { sendMail, emailLayout, emailButton } from '../lib/mail.js';
import { staffUsers } from './ops.js';

const PRIORITIES = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' };
const caseLink = (c) => `${config.baseUrl}/support/case/${c.ref}?t=${hmac(`case:${c.id}:${c.email.toLowerCase()}`)}`;

router.get('/ops/cases', (ctx) => {
  if (!requireStaff(ctx)) return;
  const status = ctx.query.get('status') || 'open';
  const where = status === 'open' ? "c.status IN ('open','in_progress','waiting_customer','escalated')" : status === 'all' ? '1=1' : 'c.status=?';
  const rows = all(`SELECT c.*, u.name assignee, (SELECT author FROM case_messages m WHERE m.case_id=c.id AND author!='note' ORDER BY id DESC LIMIT 1) last_author
    FROM cases c LEFT JOIN users u ON u.id=c.assigned_to WHERE ${where}
    ORDER BY CASE c.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, c.updated_at DESC LIMIT 300`, ...(status === 'open' || status === 'all' ? [] : [status]));
  const tabs = [['open', 'Open'], ...Object.entries(caseStatuses), ['all', 'All']];
  html(ctx.res, opsLayout(ctx, {
    title: 'Service cases', active: 'cases',
    body: h`<nav class="tabs">${tabs.map(([k, l]) => h`<a href="?status=${k}"${k === status ? raw(' aria-current="page"') : ''}>${l}</a>`)}</nav>
    <section class="card">${rows.length ? h`<table class="tbl"><thead><tr><th>Ref</th><th>Subject</th><th>From</th><th>Status</th><th>Priority</th><th>Owner</th><th>Updated</th></tr></thead><tbody>
    ${rows.map((c) => h`<tr><td><a class="mono" href="/ops/cases/${c.id}">${c.ref}</a></td><td>${c.subject}${c.callback ? h` <small class="tag">callback</small>` : ''}${c.last_author === 'customer' && c.status !== 'resolved' ? h` <small class="tag tag--warn">awaiting reply</small>` : ''}</td><td>${c.name}${c.company ? h`<br><small>${c.company}</small>` : ''}</td><td>${badge(c.status, caseStatuses[c.status])}</td><td>${badge(c.priority, PRIORITIES[c.priority])}</td><td>${c.assignee || '—'}</td><td><small>${fmtDateTime(c.updated_at)}</small></td></tr>`)}
    </tbody></table>` : h`<p class="empty">No cases here.</p>`}</section>`,
  }));
});

function getCase(id) { const c = one('SELECT * FROM cases WHERE id=?', Number(id)); if (!c) throw new HttpError(404, 'Case not found'); return c; }

router.get('/ops/cases/:id', (ctx) => {
  if (!requireStaff(ctx)) return;
  const c = getCase(ctx.params.id);
  const msgs = all('SELECT m.*, u.name uname FROM case_messages m LEFT JOIN users u ON u.id=m.user_id WHERE case_id=? ORDER BY m.id', c.id);
  const files = all("SELECT * FROM files WHERE owner_type='case' AND owner_id=? ORDER BY id", c.id);
  const extra = c.extra_json ? JSON.parse(c.extra_json) : null;
  const related = c.related_ref ? (one('SELECT id, ref FROM shipments WHERE ref=?', c.related_ref) || one('SELECT id, ref FROM quotes WHERE ref=?', c.related_ref)) : null;
  const back = `/ops/cases/${c.id}`;
  html(ctx.res, opsLayout(ctx, {
    title: h`<span class="mono">${c.ref}</span> ${badge(c.status, caseStatuses[c.status])}`, docTitle: c.ref, active: 'cases',
    body: h`<div class="cols cols--side"><div>
      <section class="card"><h2>${c.subject}</h2>
        <ol class="thread">${msgs.map((m) => h`<li class="thread__msg thread__msg--${m.author}"><header><strong>${m.author === 'customer' ? c.name : m.uname || 'Staff'}</strong>${m.author === 'note' ? h` <small class="tag">internal note</small>` : ''}<small>${fmtDateTime(m.created_at)}</small></header><p class="pre">${m.body}</p></li>`)}</ol>
        <form method="post" action="/ops/cases/${c.id}/reply" enctype="multipart/form-data" class="stack">${csrf(ctx)}
          <textarea name="body" rows="5" required placeholder="Write a reply to ${c.name}, or an internal note"></textarea>
          <input type="file" name="documents" multiple>
          <div class="row"><select name="next_status">${optionList(caseStatuses, c.status === 'open' ? 'in_progress' : c.status)}</select>
          <button class="btn" name="kind" value="reply">Send reply to customer</button><button class="btn btn--sec" name="kind" value="note">Save internal note</button></div>
          <small class="muted">Replies are emailed to ${c.email} with a private link to the case. Attachments on replies are shared with the customer; on notes they stay internal.</small></form>
      </section>
    </div><div>
      <form class="card" method="post" action="/ops/cases/${c.id}/update">${csrf(ctx)}<h2>Case</h2>
        <label>Status<select name="status">${optionList(caseStatuses, c.status)}</select></label>
        <label>Priority<select name="priority">${optionList(PRIORITIES, c.priority)}</select></label>
        <label>Assigned to<select name="assigned_to">${userOptions(staffUsers(), c.assigned_to)}</select></label>
        <button class="btn btn--block">Update</button>
        ${c.status !== 'escalated' ? h`<button class="btn btn--danger btn--block" name="status" value="escalated" formaction="/ops/cases/${c.id}/update">Escalate to owner</button>` : ''}</form>
      <section class="card"><h2>Contact</h2><dl class="dl"><dt>Type</dt><dd>${caseTypes[c.type]}</dd><dt>Name</dt><dd>${c.customer_id ? h`<a href="/ops/customers/${c.customer_id}">${c.name}</a>` : c.name}</dd>${c.company ? h`<dt>Company</dt><dd>${c.company}</dd>` : ''}
        <dt>Email</dt><dd><a href="mailto:${c.email}">${c.email}</a></dd>${c.phone ? h`<dt>Phone</dt><dd><a href="tel:${c.phone}">${c.phone}</a></dd>` : ''}<dt>Callback</dt><dd>${c.callback ? h`<strong>Requested</strong>` : 'No'}</dd>
        ${c.related_ref ? h`<dt>Related</dt><dd>${related ? h`<a class="mono" href="/ops/${related.ref.startsWith('LFS') ? 'shipments' : 'quotes'}/${related.id}">${c.related_ref}</a>` : h`<span class="mono">${c.related_ref}</span>`}</dd>` : ''}
        ${extra ? Object.entries(extra).map(([k, v]) => h`<dt>${k}</dt><dd>${v || '—'}</dd>`) : ''}<dt>Opened</dt><dd>${fmtDateTime(c.created_at)}</dd></dl></section>
      <section class="card"><h2>Documents</h2>${files.length ? h`<ul class="files">${files.map((x) => h`<li><a href="/ops/files/${x.id}?view=1" target="_blank">${x.original_name}</a><small>${fmtSize(x.size)} · ${x.uploaded_by} · ${x.customer_visible ? 'shared' : 'internal'}</small>
        <form method="post" action="/ops/files/${x.id}/visibility">${csrf(ctx)}<input type="hidden" name="back" value="${back}"><input type="hidden" name="visible" value="${x.customer_visible ? '0' : '1'}"><button class="linkbtn">${x.customer_visible ? 'Make internal' : 'Share'}</button></form></li>`)}</ul>` : h`<p class="muted">None.</p>`}</section>
    </div></div>`,
  }));
});

router.post('/ops/cases/:id/reply', async (ctx) => {
  const p = await staffPost(ctx); if (!p) return;
  const c = getCase(ctx.params.id);
  const body = str(p.f.body, 8000); if (!body) return go(ctx, `/ops/cases/${c.id}`);
  const isNote = p.f.kind === 'note';
  const docs = p.files.documents || [];
  const errs = validateFiles(docs); if (errs.length) throw new HttpError(422, errs.join(' '));
  const next = caseStatuses[p.f.next_status] ? p.f.next_status : c.status;
  run('INSERT INTO case_messages (case_id,author,user_id,body,created_at) VALUES (?,?,?,?,?)', c.id, isNote ? 'note' : 'staff', ctx.user.id, body, nowIso());
  run('UPDATE cases SET status=?, assigned_to=COALESCE(assigned_to,?), updated_at=? WHERE id=?', next, ctx.user.id, nowIso(), c.id);
  await storeFiles(docs, 'case', c.id, `staff:${ctx.user.name}`, isNote ? 0 : 1);
  logActivity('case', c.id, ctx.user.id, isNote ? 'note' : 'replied', next !== c.status ? `status → ${caseStatuses[next]}` : '');
  if (!isNote) {
    sendMail({ to: c.email, replyTo: ctx.user.email, subject: `Re: ${c.subject} [${c.ref}]`,
      html: emailLayout(`Update on your request ${c.ref}`, `<p style="font-size:15px;line-height:1.6;white-space:pre-wrap">${esc(body)}</p><p style="font-size:13px;color:#5b6b80">${esc(ctx.user.name)} · ${esc(company.name)}</p>${emailButton(caseLink(c), 'View or reply')}`),
      text: `${body}\n\n${ctx.user.name}, ${company.name}\nView or reply: ${caseLink(c)}` });
  }
  go(ctx, `/ops/cases/${c.id}`, isNote ? 'Note saved' : `Reply sent to ${c.email}`);
});

router.post('/ops/cases/:id/update', async (ctx) => {
  const p = await staffPost(ctx); if (!p) return;
  const c = getCase(ctx.params.id);
  const status = caseStatuses[p.f.status] ? p.f.status : c.status;
  const priority = PRIORITIES[p.f.priority] ? p.f.priority : c.priority;
  const finalPriority = status === 'escalated' && priority === 'normal' ? 'high' : priority;
  run('UPDATE cases SET status=?, priority=?, assigned_to=?, updated_at=? WHERE id=?', status, finalPriority, Number(p.f.assigned_to) || null, nowIso(), c.id);
  logActivity('case', c.id, ctx.user.id, 'updated', `${caseStatuses[status]} · ${PRIORITIES[finalPriority]}`);
  if (status === 'escalated' && c.status !== 'escalated') {
    const owners = all("SELECT email FROM users WHERE role='owner' AND active=1").map((u) => u.email);
    if (owners.length) sendMail({ to: owners, subject: `[ESCALATED] ${c.ref}: ${c.subject}`, html: emailLayout(`Case ${c.ref} escalated`, `<p>${esc(ctx.user.name)} escalated this case.</p>${emailButton(`${config.baseUrl}/ops/cases/${c.id}`, 'Open case')}`) });
  }
  go(ctx, `/ops/cases/${c.id}`, 'Case updated');
});
