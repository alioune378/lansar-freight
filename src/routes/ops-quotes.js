import { router } from '../router.js';
import { h, raw, html, str, arr, num, isEmail, HttpError, fmtDate, fmtDateTime, fmtMoney, nowIso, esc } from '../lib/core.js';
import { requireStaff } from '../lib/auth.js';
import { one, all, run, tx, upsertCustomer, logActivity } from '../db.js';
import { opsLayout, csrf, staffPost, badge, userOptions, optionList, go } from '../views/ops-layout.js';
import { quoteStatuses, shippingModes, optionalServices, company, config } from '../config.js';
import { newRef } from '../lib/refs.js';
import { fmtSize, storeFiles, validateFiles } from '../lib/files.js';
import { sendMail, emailLayout, emailButton } from '../lib/mail.js';
import { staffUsers } from './ops.js';

const LINE_CATS = ['Ocean freight', 'Inland trucking', 'Origin charges', 'Documentation', 'Warehousing', 'Insurance', 'Destination charges', 'Other'];
const CARGO_LABELS = {
  container_type: 'Container type', container_qty: 'Containers', container_weight: 'Weight / container', container_weight_unit: 'Unit',
  pieces: 'Pieces', packaging: 'Packaging', total_weight: 'Total weight', weight_unit: 'Unit', dims: 'Dimensions', total_volume: 'Volume', volume_unit: 'Volume unit',
  veh_year: 'Year', veh_make: 'Make', veh_model: 'Model', veh_vin: 'VIN', veh_qty: 'Vehicles', veh_condition: 'Condition', veh_method: 'Method', veh_title: 'Title', veh_more: 'More vehicles',
};
const totals = (lines) => lines.reduce((t, l) => ({ cost: t.cost + l.qty * l.unit_cost, sell: t.sell + l.qty * l.unit_sell }), { cost: 0, sell: 0 });
export const routeOf = (q) => ({
  origin: [q.origin_city, q.origin_state, q.origin_country].filter(Boolean).join(', '),
  dest: [q.dest_city || q.dest_port, q.dest_country].filter(Boolean).join(', '),
});

router.get('/ops/quotes', (ctx) => {
  if (!requireStaff(ctx)) return;
  const status = ctx.query.get('status') || 'open';
  const q = str(ctx.query.get('q')); const like = `%${q}%`;
  const mine = ctx.query.get('mine') === '1';
  const where = status === 'open' ? "status IN ('new','reviewing','quoted','negotiating')" : status === 'all' ? '1=1' : 'status=?';
  const params = status === 'open' || status === 'all' ? [] : [status];
  const rows = all(`SELECT q.*, u.name assignee FROM quotes q LEFT JOIN users u ON u.id=q.assigned_to
    WHERE ${where} AND (?='' OR q.ref LIKE ? OR q.contact_name LIKE ? OR q.email LIKE ? OR q.company LIKE ? OR q.dest_country LIKE ?) ${mine ? 'AND q.assigned_to=' + Number(ctx.user.id) : ''}
    ORDER BY q.id DESC LIMIT 300`, ...params, q, like, like, like, like, like);
  const counts = Object.fromEntries(all('SELECT status, COUNT(*) n FROM quotes GROUP BY status').map((r) => [r.status, r.n]));
  const tabs = [['open', 'Open'], ...Object.entries(quoteStatuses), ['all', 'All']];
  html(ctx.res, opsLayout(ctx, {
    title: 'Quotes & leads', active: 'quotes', actions: h`<a class="btn" href="/ops/quotes/new">+ New quote</a>`,
    body: h`<nav class="tabs">${tabs.map(([k, l]) => h`<a href="?status=${k}"${k === status ? raw(' aria-current="page"') : ''}>${l}${counts[k] ? h` <b>${counts[k]}</b>` : ''}</a>`)}</nav>
    <form class="filters"><input type="hidden" name="status" value="${status}"><input name="q" value="${q}" placeholder="Search ref, name, email, company, country"><label class="chk"><input type="checkbox" name="mine" value="1"${mine ? raw(' checked') : ''}> Assigned to me</label><button class="btn btn--sec">Filter</button></form>
    <section class="card">${rows.length ? h`<table class="tbl"><thead><tr><th>Ref</th><th>Customer</th><th>Type</th><th>Route</th><th>Status</th><th>Owner</th><th>Quoted</th><th>Received</th></tr></thead><tbody>
    ${rows.map((r) => { const rt = routeOf(r); return h`<tr><td><a class="mono" href="/ops/quotes/${r.id}">${r.ref}</a>${r.repeat_of ? h`<br><small class="tag">repeat</small>` : ''}</td><td>${r.contact_name}${r.company ? h`<br><small>${r.company}</small>` : ''}</td><td>${shippingModes[r.mode]?.replace('Ocean — ', '')}</td><td><small>${rt.origin}<br>→ ${rt.dest}</small></td><td>${badge(r.status, quoteStatuses[r.status])}</td><td>${r.assignee || h`<span class="muted">—</span>`}</td><td>${r.quoted_total ? fmtMoney(r.quoted_total, r.currency) : '—'}</td><td><small>${fmtDateTime(r.created_at)}</small></td></tr>`; })}
    </tbody></table>` : h`<p class="empty">No quotes match.</p>`}</section>`,
  }));
});

// Manual quote entry (phone, WhatsApp, walk-in leads)
router.get('/ops/quotes/new', (ctx) => {
  if (!requireStaff(ctx)) return;
  html(ctx.res, opsLayout(ctx, {
    title: 'New quote', active: 'quotes',
    body: h`<form class="card form-grid" method="post" action="/ops/quotes/new">${csrf(ctx)}
      <p class="muted span2">For leads received by phone, WhatsApp or in person. Website requests are created automatically.</p>
      <label>Customer name *<input name="contact_name" required></label><label>Company<input name="company"></label>
      <label>Email *<input type="email" name="email" required></label><label>Phone *<input name="phone" required></label>
      <label>Shipment type *<select name="mode">${optionList(shippingModes, 'fcl')}</select></label><label>Lead source<select name="source"><option>Phone</option><option>WhatsApp</option><option>Walk-in</option><option>Referral</option><option>Email</option><option>Other</option></select></label>
      <label>Origin city / state<input name="origin_city"></label><label>Destination country *<input name="dest_country" required></label>
      <label class="span2">Cargo description<textarea name="commodity" rows="3"></textarea></label>
      <label class="span2">Notes<textarea name="notes" rows="3"></textarea></label>
      <div class="span2"><button class="btn">Create quote</button></div></form>`,
  }));
});
router.post('/ops/quotes/new', async (ctx) => {
  const p = await staffPost(ctx); if (!p) return;
  const f = Object.fromEntries(Object.entries(p.f).map(([k, v]) => [k, str(v, 4000)]));
  if (!f.contact_name || !isEmail(f.email) || !f.dest_country || !shippingModes[f.mode]) throw new HttpError(422, 'Name, valid email, shipment type and destination are required.');
  const now = nowIso(); const email = f.email.toLowerCase();
  const id = tx(() => {
    const cid = upsertCustomer({ email, name: f.contact_name, company: f.company, phone: f.phone });
    const id = Number(run(`INSERT INTO quotes (ref,status,customer_id,contact_name,company,email,phone,mode,origin_country,origin_city,dest_country,commodity,notes,source,assigned_to,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, newRef('LQ'), 'reviewing', cid, f.contact_name, f.company || null, email, f.phone, f.mode, 'United States', f.origin_city || null,
    f.dest_country, f.commodity || null, f.notes || null, `staff:${f.source}`, ctx.user.id, now, now).lastInsertRowid);
    logActivity('quote', id, ctx.user.id, 'created', `Entered manually (${f.source})`);
    return id;
  });
  go(ctx, `/ops/quotes/${id}`, 'Quote created');
});

function getQuote(id) {
  const q = one('SELECT * FROM quotes WHERE id=?', Number(id));
  if (!q) throw new HttpError(404, 'Quote not found');
  return q;
}

router.get('/ops/quotes/:id', (ctx) => {
  if (!requireStaff(ctx)) return;
  const q = getQuote(ctx.params.id);
  const lines = all('SELECT * FROM quote_lines WHERE quote_id=? ORDER BY sort, id', q.id);
  const files = all("SELECT * FROM files WHERE owner_type='quote' AND owner_id=? ORDER BY id", q.id);
  const acts = all('SELECT a.*, u.name FROM activity a LEFT JOIN users u ON u.id=a.user_id WHERE entity_type=? AND entity_id=? ORDER BY a.id DESC', 'quote', q.id);
  const tasks = all("SELECT t.*, u.name assignee FROM tasks t LEFT JOIN users u ON u.id=t.assigned_to WHERE entity_type='quote' AND entity_id=? ORDER BY t.status, t.id DESC", q.id);
  const shp = one('SELECT id, ref FROM shipments WHERE quote_id=?', q.id);
  const prev = q.repeat_of ? one('SELECT id, ref FROM shipments WHERE ref=?', q.repeat_of) || one('SELECT id, ref FROM quotes WHERE ref=?', q.repeat_of) : null;
  const cargo = JSON.parse(q.cargo_json || '{}'); const svcs = JSON.parse(q.services_json || '[]');
  const t = totals(lines); const marginPct = t.sell ? ((t.sell - t.cost) / t.sell) * 100 : 0;
  const rt = routeOf(q); const users = staffUsers();
  const blank = Array.from({ length: lines.length ? 2 : 4 }, () => ({ id: '', category: '', description: '', qty: 1, unit_cost: '', unit_sell: '' }));
  const back = `/ops/quotes/${q.id}`;
  const utm = JSON.parse(q.utm_json || '{}');

  html(ctx.res, opsLayout(ctx, {
    title: h`<span class="mono">${q.ref}</span> ${badge(q.status, quoteStatuses[q.status])}`, docTitle: q.ref, active: 'quotes',
    actions: shp ? h`<a class="btn btn--sec" href="/ops/shipments/${shp.id}">Shipment ${shp.ref} →</a>` : h`<a class="btn btn--sec" href="/ops/shipments/new?quote=${q.id}">Convert to shipment</a>`,
    body: h`<div class="cols cols--side"><div>
      <section class="card"><h2>Request</h2>
        <div class="route"><div><small>Origin</small><strong>${rt.origin || '—'}</strong><span>${q.origin_zip || ''} ${q.origin_type ? `· ${q.origin_type}` : ''}</span></div><div class="route__arrow">→</div><div><small>Destination</small><strong>${rt.dest || '—'}</strong><span>${q.dest_port ? `Port: ${q.dest_port}` : ''} ${q.dest_type ? `· ${q.dest_type}` : ''}</span></div></div>
        <dl class="dl dl--grid"><dt>Type</dt><dd>${shippingModes[q.mode]}</dd><dt>Ready date</dt><dd>${q.ready_date ? fmtDate(q.ready_date) : '—'}</dd>
        ${Object.entries(cargo).map(([k, v]) => h`<dt>${CARGO_LABELS[k] || k}</dt><dd>${String(v)}</dd>`)}
        <dt>Cargo</dt><dd>${q.commodity || '—'}</dd><dt>Value</dt><dd>${q.cargo_value ? fmtMoney(q.cargo_value, q.cargo_currency) : '—'}</dd>
        <dt>Hazardous</dt><dd>${['No', h`<strong class="warn">Yes</strong>`, 'Not sure'][q.hazardous || 0]}</dd>
        <dt>Services</dt><dd>${svcs.length ? svcs.map((s) => optionalServices[s]).join(', ') : '—'}</dd>
        ${q.repeat_of ? h`<dt>Repeat of</dt><dd>${prev ? h`<a class="mono" href="/ops/${prev.ref.startsWith('LFS') ? 'shipments' : 'quotes'}/${prev.id}">${q.repeat_of}</a>` : h`<span class="mono">${q.repeat_of}</span> <small class="muted">(not found)</small>`}</dd>` : ''}
        </dl>
        ${q.notes ? h`<h3>Customer notes</h3><p class="pre">${q.notes}</p>` : ''}
        <h3>Documents (${files.length})</h3>${files.length ? h`<ul class="files">${files.map((x) => h`<li><a href="/ops/files/${x.id}?view=1" target="_blank">${x.original_name}</a> <small>${fmtSize(x.size)} · ${x.uploaded_by}</small></li>`)}</ul>` : h`<p class="muted">None attached.</p>`}
        <form method="post" action="/ops/quotes/${q.id}/files" enctype="multipart/form-data" class="inline-form">${csrf(ctx)}<input type="file" name="documents" multiple><button class="btn btn--sec btn--sm">Upload</button></form>
      </section>

    </div>
    <div>
      <form class="card" method="post" action="/ops/quotes/${q.id}/status">${csrf(ctx)}<h2>Status &amp; owner</h2>
        <label>Status<select name="status">${optionList(quoteStatuses, q.status)}</select></label>
        <label>Assigned to<select name="assigned_to">${userOptions(users, q.assigned_to)}</select></label>
        <label>Lost reason (if lost)<input name="lost_reason" value="${q.lost_reason || ''}" placeholder="Price, timing, went elsewhere…"></label>
        <button class="btn btn--block">Update</button></form>
      <section class="card"><h2>Customer</h2><dl class="dl">
        <dt>Name</dt><dd>${q.customer_id ? h`<a href="/ops/customers/${q.customer_id}">${q.contact_name}</a>` : q.contact_name}</dd>${q.company ? h`<dt>Company</dt><dd>${q.company}</dd>` : ''}
        <dt>Email</dt><dd><a href="mailto:${q.email}?subject=${encodeURIComponent(`Your LANSAR quote ${q.ref}`)}">${q.email}</a></dd>
        <dt>Phone</dt><dd><a href="tel:${q.phone}">${q.phone}</a></dd>${q.whatsapp ? h`<dt>WhatsApp</dt><dd>${q.whatsapp}</dd>` : ''}
        <dt>Prefers</dt><dd>${q.preferred_contact || '—'}</dd><dt>Type</dt><dd>${q.customer_kind || '—'}</dd>
        <dt>Received</dt><dd>${fmtDateTime(q.created_at)}</dd><dt>Source</dt><dd><small>${[utm.source, utm.medium, utm.campaign].filter(Boolean).join(' / ') || q.source || 'Direct'}${utm.landing ? h`<br>Landing: ${utm.landing}` : ''}</small></dd></dl>
        <p><a class="btn btn--sec btn--block" href="https://wa.me/${String(q.whatsapp || q.phone || '').replace(/\D/g, '')}" target="_blank" rel="noopener">Open WhatsApp chat</a></p></section>
      <section class="card"><h2>Tasks</h2>
        ${tasks.length ? h`<ul class="list">${tasks.map((x) => h`<li class="${x.status}"><span>${x.title}<br><small>${x.assignee || 'Unassigned'}${x.due_date ? ` · due ${fmtDate(x.due_date)}` : ''}</small></span>${x.status === 'open' ? h`<form method="post" action="/ops/tasks/${x.id}/done">${csrf(ctx)}<input type="hidden" name="back" value="${back}"><button class="btn btn--sm btn--sec">Done</button></form>` : h`<small>✓</small>`}</li>`)}</ul>` : ''}
        <form method="post" action="/ops/tasks" class="stack">${csrf(ctx)}<input type="hidden" name="entity_type" value="quote"><input type="hidden" name="entity_id" value="${q.id}"><input type="hidden" name="back" value="${back}">
          <input name="title" required placeholder="Follow-up task"><div class="row"><select name="assigned_to">${userOptions(users, ctx.user.id)}</select><input type="date" name="due_date"></div><button class="btn btn--sec btn--sm">Add task</button></form></section>
    </div>
      <form class="card span-all" method="post" action="/ops/quotes/${q.id}/lines" data-quote-builder>${csrf(ctx)}
        <h2>Quote builder <small class="muted">Costs stay internal. Customers only see sell prices.</small></h2>
        <div class="tbl-wrap"><table class="tbl qb"><thead><tr><th>Category</th><th>Description</th><th class="n">Qty</th><th class="n">Unit cost</th><th class="n">Unit sell</th><th class="n">Line sell</th><th class="n">Margin</th></tr></thead>
        <tbody data-lines>${[...lines, ...blank].map((l) => h`<tr>
          <td><select name="category"><option value="">—</option>${LINE_CATS.map((c) => h`<option${c === l.category ? raw(' selected') : ''}>${c}</option>`)}</select></td>
          <td><input name="description" value="${l.description}" placeholder="e.g. Ocean freight 40′ HC, New York → Dakar"></td>
          <td class="n"><input name="qty" type="number" step="any" min="0" value="${l.qty}"></td>
          <td class="n"><input name="unit_cost" type="number" step="0.01" min="0" value="${l.unit_cost}"></td>
          <td class="n"><input name="unit_sell" type="number" step="0.01" min="0" value="${l.unit_sell}"></td>
          <td class="n mono" data-line-sell>${l.description ? fmtMoney(l.qty * l.unit_sell, q.currency) : ''}</td>
          <td class="n mono" data-line-margin>${l.description && l.unit_sell ? `${Math.round(((l.unit_sell - l.unit_cost) / l.unit_sell) * 100)}%` : ''}</td></tr>`)}</tbody>
        <tfoot><tr><td colspan="3"><button type="button" class="btn btn--sec btn--sm" data-add-line>+ Add line</button></td><td class="n mono" data-total-cost>${fmtMoney(t.cost, q.currency)}</td><td></td><td class="n mono"><strong data-total-sell>${fmtMoney(t.sell, q.currency)}</strong></td><td class="n mono" data-total-margin>${t.sell ? `${marginPct.toFixed(1)}%` : '—'}</td></tr>
        <tr><td colspan="7" class="muted small">Gross profit: <strong data-total-gp>${fmtMoney(t.sell - t.cost, q.currency)}</strong></td></tr></tfoot></table></div>
        <div class="form-grid">
          <label>Currency<select name="currency">${['USD', 'EUR', 'XOF'].map((c) => h`<option${c === q.currency ? raw(' selected') : ''}>${c}</option>`)}</select></label>
          <label>Valid until<input type="date" name="valid_until" value="${q.valid_until || ''}"></label>
          <label class="span2">Message to customer (included in the quotation email)<textarea name="customer_message" rows="4" placeholder="Inclusions, exclusions, routing, conditions…">${q.customer_message || ''}</textarea></label>
        </div>
        <div class="btn-row"><button class="btn btn--sec" name="action" value="save">Save quote</button><button class="btn" name="action" value="send" data-confirm="Email this quotation to ${q.email}?">Save &amp; send to customer</button>
        ${q.quoted_at ? h`<small class="muted">Last sent ${fmtDateTime(q.quoted_at)} · ${fmtMoney(q.quoted_total, q.currency)}</small>` : ''}</div>
      </form>

      <section class="card"><h2>Activity</h2>
        <form method="post" action="/ops/quotes/${q.id}/note" class="inline-form">${csrf(ctx)}<input name="note" class="grow" placeholder="Add an internal note (call summary, carrier option, etc.)" required><button class="btn btn--sec">Add note</button></form>
        <ol class="acts">${acts.map((a) => h`<li><strong>${a.name || 'Website'}</strong> ${a.action.replace(/_/g, ' ')}${a.detail ? h` — <span class="pre">${a.detail}</span>` : ''}<small>${fmtDateTime(a.created_at)}</small></li>`)}</ol>
      </section>
    
    `,
  }));
});

router.post('/ops/quotes/:id/status', async (ctx) => {
  const p = await staffPost(ctx); if (!p) return;
  const q = getQuote(ctx.params.id);
  const status = quoteStatuses[p.f.status] ? p.f.status : q.status;
  const assigned = Number(p.f.assigned_to) || null;
  run('UPDATE quotes SET status=?, assigned_to=?, lost_reason=?, updated_at=? WHERE id=?', status, assigned, str(p.f.lost_reason) || null, nowIso(), q.id);
  if (status !== q.status) logActivity('quote', q.id, ctx.user.id, 'status_changed', `${quoteStatuses[q.status]} → ${quoteStatuses[status]}`);
  if (assigned !== q.assigned_to) {
    const u = assigned ? one('SELECT name, email FROM users WHERE id=?', assigned) : null;
    logActivity('quote', q.id, ctx.user.id, 'assigned', u?.name || 'Unassigned');
    if (u && assigned !== ctx.user.id) sendMail({ to: u.email, subject: `Quote ${q.ref} assigned to you`, html: emailLayout(`Quote ${q.ref} assigned to you`, `<p>${esc(ctx.user.name)} assigned you ${esc(q.ref)} (${esc(q.contact_name)} → ${esc(q.dest_country)}).</p>${emailButton(`${config.baseUrl}/ops/quotes/${q.id}`, 'Open quote')}`) });
  }
  go(ctx, `/ops/quotes/${q.id}`, 'Quote updated');
});

router.post('/ops/quotes/:id/note', async (ctx) => {
  const p = await staffPost(ctx); if (!p) return;
  const q = getQuote(ctx.params.id);
  logActivity('quote', q.id, ctx.user.id, 'note', str(p.f.note, 3000));
  go(ctx, `/ops/quotes/${q.id}`);
});

router.post('/ops/quotes/:id/files', async (ctx) => {
  const p = await staffPost(ctx); if (!p) return;
  const q = getQuote(ctx.params.id);
  const docs = p.files.documents || [];
  const errs = validateFiles(docs); if (errs.length) throw new HttpError(422, errs.join(' '));
  await storeFiles(docs, 'quote', q.id, `staff:${ctx.user.name}`);
  logActivity('quote', q.id, ctx.user.id, 'files_uploaded', `${docs.length} file(s)`);
  go(ctx, `/ops/quotes/${q.id}`, 'Uploaded');
});

router.post('/ops/quotes/:id/lines', async (ctx) => {
  const p = await staffPost(ctx); if (!p) return;
  const q = getQuote(ctx.params.id);
  const f = p.f;
  const cat = arr(f.category), desc = arr(f.description), qty = arr(f.qty), cost = arr(f.unit_cost), sell = arr(f.unit_sell);
  const lines = desc.map((d, i) => ({ category: str(cat[i]), description: str(d), qty: num(qty[i]) ?? 1, unit_cost: num(cost[i]) ?? 0, unit_sell: num(sell[i]) ?? 0 })).filter((l) => l.description);
  const currency = ['USD', 'EUR', 'XOF'].includes(f.currency) ? f.currency : 'USD';
  const t = totals(lines);
  tx(() => {
    run('DELETE FROM quote_lines WHERE quote_id=?', q.id);
    lines.forEach((l, i) => run('INSERT INTO quote_lines (quote_id,category,description,qty,unit_cost,unit_sell,sort) VALUES (?,?,?,?,?,?,?)', q.id, l.category || null, l.description, l.qty, l.unit_cost, l.unit_sell, i));
    run('UPDATE quotes SET currency=?, valid_until=?, customer_message=?, updated_at=? WHERE id=?', currency, str(f.valid_until) || null, str(f.customer_message, 5000) || null, nowIso(), q.id);
  });
  if (f.action !== 'send') { logActivity('quote', q.id, ctx.user.id, 'quote_saved', `${lines.length} lines · sell ${fmtMoney(t.sell, currency)}`); return go(ctx, `/ops/quotes/${q.id}`, 'Quote saved'); }

  if (!lines.length || t.sell <= 0) return go(ctx, `/ops/quotes/${q.id}`, 'Add at least one priced line before sending.');
  if (!str(f.valid_until)) return go(ctx, `/ops/quotes/${q.id}`, 'Set a “valid until” date before sending.');
  const rt = routeOf(q);
  const rows = lines.map((l) => `<tr><td style="padding:8px 0;border-bottom:1px solid #e5eaf1;font-size:14px">${esc(l.description)}${l.qty !== 1 ? ` <span style="color:#5b6b80">× ${l.qty}</span>` : ''}</td><td style="padding:8px 0;border-bottom:1px solid #e5eaf1;text-align:right;font-size:14px;white-space:nowrap">${fmtMoney(l.qty * l.unit_sell, currency)}</td></tr>`).join('');
  sendMail({
    to: q.email, replyTo: ctx.user.email,
    subject: `Your LANSAR freight quotation ${q.ref}`,
    html: emailLayout(`Freight quotation ${q.ref}`, `<p style="font-size:15px;line-height:1.6">Hello ${esc(q.contact_name.split(' ')[0])},</p>
      <p style="font-size:15px;line-height:1.6">Thank you for your request. Here is our quotation for <strong>${esc(shippingModes[q.mode])}</strong> from <strong>${esc(rt.origin)}</strong> to <strong>${esc(rt.dest)}</strong>.</p>
      <table role="presentation" width="100%" style="border-collapse:collapse;margin:16px 0">${rows}
      <tr><td style="padding:12px 0;font-weight:bold;font-size:15px">Total</td><td style="padding:12px 0;text-align:right;font-weight:bold;font-size:15px">${fmtMoney(t.sell, currency)}</td></tr></table>
      <p style="font-size:14px">Valid until <strong>${fmtDate(f.valid_until)}</strong>. Subject to carrier space, equipment availability and the cargo details provided.</p>
      ${f.customer_message ? `<p style="font-size:14px;line-height:1.6;white-space:pre-wrap">${esc(f.customer_message)}</p>` : ''}
      <p style="font-size:14px">To book, reply to this email or call ${esc(company.phone)} and mention <strong>${q.ref}</strong>.</p>
      ${emailButton(`${config.baseUrl}/track?ref=${q.ref}`, 'View request status')}
      <p style="font-size:13px;color:#5b6b80">${esc(ctx.user.name)} · ${esc(company.name)}</p>`),
    text: `LANSAR quotation ${q.ref}: total ${fmtMoney(t.sell, currency)}, valid until ${f.valid_until}. Reply or call ${company.phone} to book.`,
  });
  run("UPDATE quotes SET status=CASE WHEN status IN ('new','reviewing') THEN 'quoted' ELSE status END, quoted_total=?, quoted_at=?, updated_at=? WHERE id=?", t.sell, nowIso(), nowIso(), q.id);
  logActivity('quote', q.id, ctx.user.id, 'quote_sent', `${fmtMoney(t.sell, currency)} to ${q.email}, valid until ${f.valid_until}`);
  go(ctx, `/ops/quotes/${q.id}`, `Quotation emailed to ${q.email}`);
});
