import { router } from '../router.js';
import { h, raw, html, str, isEmail, HttpError, fmtDate, fmtDateTime, nowIso, esc, hmac, nyLocalNow, nyToIso } from '../lib/core.js';
import { requireStaff } from '../lib/auth.js';
import { one, all, run, tx, upsertCustomer, logActivity } from '../db.js';
import { opsLayout, csrf, staffPost, badge, userOptions, optionList, go } from '../views/ops-layout.js';
import { shipmentStatuses, shippingModes, milestoneCatalog, config, company } from '../config.js';
import { newRef } from '../lib/refs.js';
import { fmtSize, storeFiles, validateFiles } from '../lib/files.js';
import { sendMail, emailLayout, emailButton, emailRow } from '../lib/mail.js';
import { staffUsers } from './ops.js';
import { routeOf } from './ops-quotes.js';

const MS = Object.fromEntries(milestoneCatalog);
const AUTO_STATUS = { cargo_picked_up: 'in_progress', received_warehouse: 'in_progress', departed: 'in_transit', loaded: 'in_transit', transshipment: 'in_transit', arrived: 'arrived', discharged: 'arrived', delivered: 'delivered', on_hold: 'on_hold' };
const FIELDS = ['mode', 'origin', 'destination', 'cargo_summary', 'carrier', 'booking_no', 'container_no', 'bl_no', 'vessel', 'voyage', 'etd', 'eta', 'eta_note'];

function shipmentFields(s = {}) {
  return h`
    <label>Customer email (used for tracking) *<input type="email" name="contact_email" required value="${s.contact_email || ''}"></label>
    <label>Shipment type<select name="mode">${optionList(shippingModes, s.mode || 'fcl')}</select></label>
    <label>Origin *<input name="origin" required value="${s.origin || ''}" placeholder="e.g. Bronx, NY, United States"></label>
    <label>Destination *<input name="destination" required value="${s.destination || ''}" placeholder="e.g. Dakar, Senegal"></label>
    <label class="span2">Cargo summary (customer-visible)<input name="cargo_summary" value="${s.cargo_summary || ''}" placeholder="e.g. 1 × 40′ HC — household goods"></label>
    <label>Carrier (as booked)<input name="carrier" value="${s.carrier || ''}"></label>
    <label>Carrier booking no.<input name="booking_no" value="${s.booking_no || ''}" class="mono"></label>
    <label>Container no.<input name="container_no" value="${s.container_no || ''}" class="mono"></label>
    <label>Bill of lading no.<input name="bl_no" value="${s.bl_no || ''}" class="mono"></label>
    <label>Vessel<input name="vessel" value="${s.vessel || ''}"></label>
    <label>Voyage<input name="voyage" value="${s.voyage || ''}"></label>
    <label>Estimated departure (ETD)<input type="date" name="etd" value="${s.etd || ''}"></label>
    <label>Estimated arrival (ETA)<input type="date" name="eta" value="${s.eta || ''}"></label>
    <label class="span2">ETA note (customer-visible)<input name="eta_note" value="${s.eta_note || ''}" placeholder="e.g. per carrier schedule; subject to change"></label>`;
}

router.get('/ops/shipments', (ctx) => {
  if (!requireStaff(ctx)) return;
  const status = ctx.query.get('status') || 'active';
  const q = str(ctx.query.get('q')); const like = `%${q}%`;
  const where = status === 'active' ? "status NOT IN ('delivered','cancelled')" : status === 'all' ? '1=1' : 'status=?';
  const rows = all(`SELECT s.*, c.name cname, u.name assignee, (SELECT label || '|' || occurred_at FROM milestones m WHERE m.shipment_id=s.id ORDER BY occurred_at DESC, id DESC LIMIT 1) last
    FROM shipments s LEFT JOIN customers c ON c.id=s.customer_id LEFT JOIN users u ON u.id=s.assigned_to
    WHERE ${where} AND (?='' OR s.ref LIKE ? OR s.container_no LIKE ? OR s.bl_no LIKE ? OR c.name LIKE ? OR s.destination LIKE ?) ORDER BY s.id DESC LIMIT 300`,
  ...(status === 'active' || status === 'all' ? [] : [status]), q, like, like, like, like, like);
  const tabs = [['active', 'Active'], ...Object.entries(shipmentStatuses), ['all', 'All']];
  html(ctx.res, opsLayout(ctx, {
    title: 'Shipments', active: 'shipments', actions: h`<a class="btn" href="/ops/shipments/new">+ New shipment</a>`,
    body: h`<nav class="tabs">${tabs.map(([k, l]) => h`<a href="?status=${k}"${k === status ? raw(' aria-current="page"') : ''}>${l}</a>`)}</nav>
    <form class="filters"><input type="hidden" name="status" value="${status}"><input name="q" value="${q}" placeholder="Search ref, container, B/L, customer, destination"><button class="btn btn--sec">Search</button></form>
    <section class="card">${rows.length ? h`<table class="tbl"><thead><tr><th>Ref</th><th>Customer</th><th>Route</th><th>Status</th><th>Latest milestone</th><th>ETA</th><th>Owner</th></tr></thead><tbody>
    ${rows.map((s) => { const [ml, mt] = (s.last || '').split('|'); return h`<tr><td><a class="mono" href="/ops/shipments/${s.id}">${s.ref}</a>${s.container_no ? h`<br><small class="mono">${s.container_no}</small>` : ''}</td><td>${s.cname || s.contact_email}</td><td><small>${s.origin}<br>→ ${s.destination}</small></td><td>${badge(s.status, shipmentStatuses[s.status])}</td><td>${ml ? h`${ml}<br><small>${fmtDateTime(mt)}</small>` : h`<span class="muted">None yet</span>`}</td><td>${s.eta ? fmtDate(s.eta) : '—'}</td><td>${s.assignee || '—'}</td></tr>`; })}
    </tbody></table>` : h`<p class="empty">No shipments here. Convert a won quote or create one manually.</p>`}</section>`,
  }));
});

router.get('/ops/shipments/new', (ctx) => {
  if (!requireStaff(ctx)) return;
  const q = ctx.query.get('quote') ? one('SELECT * FROM quotes WHERE id=?', Number(ctx.query.get('quote'))) : null;
  if (q) { const ex = one('SELECT id FROM shipments WHERE quote_id=?', q.id); if (ex) return go(ctx, `/ops/shipments/${ex.id}`, 'This quote already has a shipment'); }
  const cargo = q ? JSON.parse(q.cargo_json || '{}') : {};
  const summary = q ? (q.mode === 'vehicle' ? `${cargo.veh_qty > 1 ? `${cargo.veh_qty} vehicles: ` : ''}${cargo.veh_year || ''} ${cargo.veh_make || ''} ${cargo.veh_model || ''}`.trim() : q.mode === 'fcl' ? `${cargo.container_qty || 1} × ${cargo.container_type || 'container'} — ${q.commodity || ''}` : q.commodity || '') : '';
  const rt = q ? routeOf(q) : {};
  html(ctx.res, opsLayout(ctx, {
    title: q ? `New shipment from ${q.ref}` : 'New shipment', active: 'shipments',
    body: h`<form class="card form-grid" method="post" action="/ops/shipments/new">${csrf(ctx)}
      ${q ? h`<input type="hidden" name="quote_id" value="${q.id}"><p class="span2 muted">Creating this shipment marks quote <span class="mono">${q.ref}</span> as <strong>Won — booked</strong>.</p>` : h`<label>Customer name *<input name="customer_name" required></label><label>Customer phone<input name="customer_phone"></label>`}
      ${shipmentFields({ contact_email: q?.email, mode: q?.mode, origin: rt.origin, destination: rt.dest, cargo_summary: summary })}
      <label>Assigned to<select name="assigned_to">${userOptions(staffUsers(), q?.assigned_to || ctx.user.id)}</select></label><span></span>
      <label class="chk span2"><input type="checkbox" name="first_milestone" value="1" checked> Post “Booking confirmed” as the first milestone</label>
      <label class="chk span2"><input type="checkbox" name="notify" value="1" checked> Email the customer their shipment reference and tracking link</label>
      <div class="span2"><button class="btn">Create shipment</button></div></form>`,
  }));
});

function trackingEmail(s, title, intro, extraRows = '') {
  return emailLayout(title, `<p style="font-size:15px;line-height:1.6">${intro}</p>
    <table role="presentation">${emailRow('Shipment reference', s.ref)}${emailRow('Route', `${s.origin} → ${s.destination}`)}${extraRows}</table>
    ${emailButton(`${config.baseUrl}/track?ref=${s.ref}`, 'Track your shipment')}
    <p style="font-size:13px;color:#5b6b80">Use your reference and this email address to track. Questions? Call ${esc(company.phone)}.</p>`);
}

router.post('/ops/shipments/new', async (ctx) => {
  const p = await staffPost(ctx); if (!p) return;
  const f = Object.fromEntries(Object.entries(p.f).map(([k, v]) => [k, str(v, 1000)]));
  if (!isEmail(f.contact_email) || !f.origin || !f.destination) throw new HttpError(422, 'Customer email, origin and destination are required.');
  const q = f.quote_id ? one('SELECT * FROM quotes WHERE id=?', Number(f.quote_id)) : null;
  const email = f.contact_email.toLowerCase(); const now = nowIso();
  const s = tx(() => {
    const cid = q?.customer_id || upsertCustomer({ email, name: f.customer_name || email, phone: f.customer_phone });
    const ref = newRef('LFS');
    const id = Number(run(`INSERT INTO shipments (ref,quote_id,customer_id,contact_email,status,${FIELDS.join(',')},assigned_to,created_at,updated_at)
      VALUES (?,?,?,?,?,${FIELDS.map(() => '?').join(',')},?,?,?)`, ref, q?.id || null, cid, email, 'booked', ...FIELDS.map((k) => f[k] || null), Number(f.assigned_to) || null, now, now).lastInsertRowid);
    if (f.first_milestone) run('INSERT INTO milestones (shipment_id,code,label,occurred_at,visible,created_by,created_at) VALUES (?,?,?,?,1,?,?)', id, 'booking_confirmed', MS.booking_confirmed, now, ctx.user.id, now);
    if (q) { run("UPDATE quotes SET status='won', updated_at=? WHERE id=?", now, q.id); logActivity('quote', q.id, ctx.user.id, 'converted', `Shipment ${ref}`); }
    logActivity('shipment', id, ctx.user.id, 'created', q ? `From quote ${q.ref}` : 'Manual');
    return { id, ref, origin: f.origin, destination: f.destination };
  });
  if (f.notify) sendMail({ to: email, subject: `Your LANSAR shipment ${s.ref} is booked`, html: trackingEmail(s, 'Your shipment is booked', 'Thank you for shipping with LANSAR. Your shipment is booked. We’ll post each confirmed milestone to your shipment reference.') });
  go(ctx, `/ops/shipments/${s.id}`, `Shipment ${s.ref} created`);
});

function getShipment(id) { const s = one('SELECT * FROM shipments WHERE id=?', Number(id)); if (!s) throw new HttpError(404, 'Shipment not found'); return s; }

router.get('/ops/shipments/:id', (ctx) => {
  if (!requireStaff(ctx)) return;
  const s = getShipment(ctx.params.id);
  const ms = all('SELECT m.*, u.name uname FROM milestones m LEFT JOIN users u ON u.id=m.created_by WHERE shipment_id=? ORDER BY occurred_at DESC, m.id DESC', s.id);
  const files = all("SELECT * FROM files WHERE owner_type='shipment' AND owner_id=? ORDER BY id DESC", s.id);
  const acts = all('SELECT a.*, u.name FROM activity a LEFT JOIN users u ON u.id=a.user_id WHERE entity_type=? AND entity_id=? ORDER BY a.id DESC LIMIT 50', 'shipment', s.id);
  const q = s.quote_id ? one('SELECT id, ref FROM quotes WHERE id=?', s.quote_id) : null;
  const c = s.customer_id ? one('SELECT * FROM customers WHERE id=?', s.customer_id) : null;
  const back = `/ops/shipments/${s.id}`;
  const local = nyLocalNow();
  html(ctx.res, opsLayout(ctx, {
    title: h`<span class="mono">${s.ref}</span> ${badge(s.status, shipmentStatuses[s.status])}`, docTitle: s.ref, active: 'shipments',
    actions: h`<a class="btn btn--sec" href="/quote?repeat=1&repeat_of=${s.ref}" target="_blank">Repeat-shipment form ↗</a>`,
    body: h`<div class="cols cols--side"><div>
      <section class="card"><h2>Milestones <small class="muted">Post only events you have confirmed. Customers see visible milestones on the tracking page.</small></h2>
        <form class="form-grid ms-form" method="post" action="/ops/shipments/${s.id}/milestones">${csrf(ctx)}
          <label>Milestone<select name="code" data-ms-code>${milestoneCatalog.map(([k, l]) => h`<option value="${k}">${l}</option>`)}</select></label>
          <label>Custom label (for “Other update”)<input name="label" placeholder="e.g. Customs inspection completed"></label>
          <label>Date &amp; time (New York)<input type="datetime-local" name="occurred_at" value="${local}" required></label>
          <label>Location<input name="location" placeholder="e.g. Port Newark, NJ"></label>
          <label class="span2">Note to customer (optional)<input name="note"></label>
          <label class="chk"><input type="checkbox" name="visible" value="1" checked> Visible to customer</label>
          <label class="chk"><input type="checkbox" name="notify" value="1"> Email customer about this update</label>
          <div class="span2"><button class="btn">Post milestone</button></div></form>
        ${ms.length ? h`<ol class="ms">${ms.map((m) => h`<li class="${m.visible ? '' : 'is-hidden'}"><div><strong>${m.label}</strong>${m.visible ? '' : h` <small class="tag">internal</small>`}<br><small>${fmtDateTime(m.occurred_at)}${m.location ? ` · ${m.location}` : ''} · by ${m.uname || '—'}</small>${m.note ? h`<p>${m.note}</p>` : ''}</div>
          <div class="ms__act"><form method="post" action="/ops/milestones/${m.id}/toggle">${csrf(ctx)}<button class="btn btn--sm btn--sec">${m.visible ? 'Hide' : 'Show'}</button></form>
          <form method="post" action="/ops/milestones/${m.id}/delete">${csrf(ctx)}<button class="btn btn--sm btn--danger" data-confirm="Delete this milestone?">Delete</button></form></div></li>`)}</ol>` : h`<p class="empty">No milestones yet.</p>`}
      </section>
      <form class="card form-grid" method="post" action="/ops/shipments/${s.id}">${csrf(ctx)}<h2 class="span2">Shipment details</h2>
        <label>Status<select name="status">${optionList(shipmentStatuses, s.status)}</select></label><label>Assigned to<select name="assigned_to">${userOptions(staffUsers(), s.assigned_to)}</select></label>
        ${shipmentFields(s)}<div class="span2"><button class="btn">Save details</button></div></form>
    </div><div>
      <section class="card"><h2>Customer</h2><dl class="dl"><dt>Name</dt><dd>${c ? h`<a href="/ops/customers/${c.id}">${c.name}</a>` : '—'}</dd><dt>Tracking email</dt><dd>${s.contact_email}</dd>${c?.phone ? h`<dt>Phone</dt><dd><a href="tel:${c.phone}">${c.phone}</a></dd>` : ''}${q ? h`<dt>From quote</dt><dd><a class="mono" href="/ops/quotes/${q.id}">${q.ref}</a></dd>` : ''}</dl></section>
      <section class="card"><h2>Documents</h2>
        ${files.length ? h`<ul class="files">${files.map((x) => h`<li><a href="/ops/files/${x.id}?view=1" target="_blank">${x.original_name}</a><small>${fmtSize(x.size)} · ${x.customer_visible ? 'shared with customer' : 'internal'}</small>
          <form method="post" action="/ops/files/${x.id}/visibility">${csrf(ctx)}<input type="hidden" name="back" value="${back}"><input type="hidden" name="visible" value="${x.customer_visible ? '0' : '1'}"><button class="linkbtn">${x.customer_visible ? 'Make internal' : 'Share with customer'}</button></form></li>`)}</ul>` : h`<p class="muted">No documents yet.</p>`}
        <form method="post" action="/ops/shipments/${s.id}/files" enctype="multipart/form-data" class="stack">${csrf(ctx)}<input type="file" name="documents" multiple required><label class="chk"><input type="checkbox" name="share" value="1"> Share with customer (downloadable from tracking page)</label><button class="btn btn--sec btn--sm">Upload</button></form></section>
      <section class="card"><h2>Activity</h2><ol class="acts">${acts.map((a) => h`<li><strong>${a.name || 'System'}</strong> ${a.action.replace(/_/g, ' ')}${a.detail ? ` — ${a.detail}` : ''}<small>${fmtDateTime(a.created_at)}</small></li>`)}</ol></section>
    </div></div>`,
  }));
});

router.post('/ops/shipments/:id', async (ctx) => {
  const p = await staffPost(ctx); if (!p) return;
  const s = getShipment(ctx.params.id);
  const f = Object.fromEntries(Object.entries(p.f).map(([k, v]) => [k, str(v, 1000)]));
  if (!isEmail(f.contact_email)) throw new HttpError(422, 'A valid customer email is required for tracking.');
  const status = shipmentStatuses[f.status] ? f.status : s.status;
  run(`UPDATE shipments SET contact_email=?, status=?, assigned_to=?, ${FIELDS.map((k) => `${k}=?`).join(',')}, updated_at=? WHERE id=?`,
    f.contact_email.toLowerCase(), status, Number(f.assigned_to) || null, ...FIELDS.map((k) => f[k] || null), nowIso(), s.id);
  const changed = FIELDS.filter((k) => (s[k] || '') !== (f[k] || '')).concat(status !== s.status ? ['status'] : []);
  logActivity('shipment', s.id, ctx.user.id, 'updated', changed.join(', ') || 'no changes');
  go(ctx, `/ops/shipments/${s.id}`, 'Shipment saved');
});

router.post('/ops/shipments/:id/milestones', async (ctx) => {
  const p = await staffPost(ctx); if (!p) return;
  const s = getShipment(ctx.params.id);
  const code = MS[p.f.code] ? p.f.code : 'custom';
  const label = code === 'custom' ? str(p.f.label) || 'Shipment update' : MS[code];
  const when = str(p.f.occurred_at); const at = when ? nyToIso(when) : nowIso();
  const visible = p.f.visible === '1' ? 1 : 0;
  run('INSERT INTO milestones (shipment_id,code,label,location,occurred_at,note,visible,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    s.id, code, label, str(p.f.location) || null, at, str(p.f.note, 1000) || null, visible, ctx.user.id, nowIso());
  if (AUTO_STATUS[code] && s.status !== 'cancelled') run('UPDATE shipments SET status=?, updated_at=? WHERE id=?', AUTO_STATUS[code], nowIso(), s.id);
  logActivity('shipment', s.id, ctx.user.id, 'milestone', `${label}${visible ? '' : ' (internal)'}`);
  if (visible && p.f.notify === '1') {
    sendMail({ to: s.contact_email, subject: `Update on shipment ${s.ref}: ${label}`, html: trackingEmail(s, label, `There’s a new update on your LANSAR shipment.`, emailRow('Update', label) + emailRow('When', fmtDateTime(at)) + (p.f.location ? emailRow('Location', str(p.f.location)) : '') + (p.f.note ? emailRow('Note', str(p.f.note)) : '')) });
  }
  go(ctx, `/ops/shipments/${s.id}`, 'Milestone posted');
});

router.post('/ops/milestones/:id/toggle', async (ctx) => {
  const p = await staffPost(ctx); if (!p) return;
  const m = one('SELECT * FROM milestones WHERE id=?', Number(ctx.params.id)); if (!m) throw new HttpError(404, 'Not found');
  run('UPDATE milestones SET visible=? WHERE id=?', m.visible ? 0 : 1, m.id);
  logActivity('shipment', m.shipment_id, ctx.user.id, m.visible ? 'milestone_hidden' : 'milestone_shown', m.label);
  go(ctx, `/ops/shipments/${m.shipment_id}`);
});
router.post('/ops/milestones/:id/delete', async (ctx) => {
  const p = await staffPost(ctx); if (!p) return;
  const m = one('SELECT * FROM milestones WHERE id=?', Number(ctx.params.id)); if (!m) throw new HttpError(404, 'Not found');
  run('DELETE FROM milestones WHERE id=?', m.id);
  logActivity('shipment', m.shipment_id, ctx.user.id, 'milestone_deleted', m.label);
  go(ctx, `/ops/shipments/${m.shipment_id}`, 'Milestone deleted');
});
router.post('/ops/shipments/:id/files', async (ctx) => {
  const p = await staffPost(ctx); if (!p) return;
  const s = getShipment(ctx.params.id);
  const docs = p.files.documents || [];
  const errs = validateFiles(docs); if (errs.length) throw new HttpError(422, errs.join(' '));
  await storeFiles(docs, 'shipment', s.id, `staff:${ctx.user.name}`, p.f.share === '1' ? 1 : 0);
  logActivity('shipment', s.id, ctx.user.id, 'files_uploaded', `${docs.length} file(s)${p.f.share === '1' ? ', shared' : ''}`);
  go(ctx, `/ops/shipments/${s.id}`, 'Uploaded');
});
void hmac;
