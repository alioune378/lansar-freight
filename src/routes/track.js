import { router } from '../router.js';
import { h, html, parseForm, str, rateLimit, clientIp, fmtDate, fmtDateTime, HttpError, hmac, safeEqual } from '../lib/core.js';
import { streamFile } from '../lib/files.js';
import { layout, icon } from '../views/layout.js';
import { company, shippingModes, quoteStatuses, shipmentStatuses } from '../config.js';
import { one, all, trackEvent } from '../db.js';
import { normalizeRef } from '../lib/refs.js';

const customerQuoteStatus = {
  new: ['Received', 'Your request is in our queue. A specialist will review it shortly.'],
  reviewing: ['Under review', 'A specialist is reviewing your cargo and route and checking options.'],
  quoted: ['Quotation sent', 'We emailed your written quotation. Reply or call us to book.'],
  negotiating: ['In discussion', 'We are finalizing the details of your quotation with you.'],
  won: ['Booked', 'Your quotation was accepted. Your shipment has a LANSAR shipment reference.'],
  lost: ['Closed', 'This request is closed. Contact us if you would like a fresh quotation.'],
  spam: ['Closed', 'This request is closed. Contact us if you would like a fresh quotation.'],
};

function trackForm(v = {}, error = '') {
  return h`<form class="trackform panel" method="post" action="/track">
    ${error ? h`<div class="alert alert--err" role="alert">${error}</div>` : ''}
    <label class="fld"><span>LANSAR reference</span><input name="ref" required class="mono" value="${v.ref || ''}" placeholder="LFS-2610-XXXXXX or LQ-2610-XXXXX" autocapitalize="characters"></label>
    <label class="fld"><span>Email used for the booking or quote</span><input type="email" name="email" required value="${v.email || ''}" autocomplete="email"></label>
    <button class="btn btn--primary btn--block">Track ${icon('arrow')}</button>
    <p class="muted small">For your security, we only show shipment details when the reference and email match our records.</p>
  </form>`;
}

function page(ctx, inner, title = 'Track your shipment') {
  return layout(ctx, {
    title, noindex: true, description: 'Track your LANSAR shipment or quote request using your LANSAR reference number.',
    body: h`<section class="qhero"><div class="wrap"><p class="kicker kicker--light">Shipment tracking</p><h1 class="h2">${title}</h1>
      <p class="lead lead--light">Milestones are posted by the LANSAR operations team once they are confirmed.</p></div></section>
      <section class="section section--tight"><div class="wrap">${inner}</div></section>`,
  });
}

router.get('/track', (ctx) => {
  html(ctx.res, page(ctx, h`<div class="track-grid">${trackForm({ ref: normalizeRef(ctx.query.get('ref')) })}
    <div class="panel panel--soft"><h2 class="h4">Where is my reference?</h2><p>Quote requests start with <span class="mono">LQ-</span> and booked shipments with <span class="mono">LFS-</span>. You’ll find both in the emails we send you.</p>
    <p>Can’t find it? <a href="/support">Open a support case</a> or call <a href="tel:${company.phoneHref}">${company.phone}</a>.</p></div></div>`));
});

router.post('/track', async (ctx) => {
  const ip = clientIp(ctx.req);
  const { fields } = await parseForm(ctx.req);
  const ref = normalizeRef(fields.ref);
  const email = str(fields.email).toLowerCase();
  if (!rateLimit(`track:${ip}`, 30, 3600_000)) throw new HttpError(429, 'Too many tracking attempts. Please wait a while or call us.');
  const notFound = () => html(ctx.res, page(ctx, h`<div class="track-grid">${trackForm({ ref, email }, 'We couldn’t find a shipment or quote with that reference and email. Check both and try again.')}</div>`), 404);
  if (!ref || !email) return notFound();
  trackEvent('track_lookup', '/track', ref);

  if (ref.startsWith('LQ-')) {
    const q = one('SELECT * FROM quotes WHERE ref=? AND email=?', ref, email);
    if (!q) return notFound();
    const shp = one('SELECT ref FROM shipments WHERE quote_id=?', q.id);
    const [label, text] = customerQuoteStatus[q.status] || ['Received', ''];
    const order = ['new', 'reviewing', 'quoted', 'won'];
    const idx = q.status === 'negotiating' ? 2 : order.indexOf(q.status);
    return html(ctx.res, page(ctx, h`<div class="tcard">
      <header class="tcard__head"><div><p class="muted small">Quote request</p><p class="tcard__ref mono">${q.ref}</p></div><span class="badge badge--${q.status}">${label}</span></header>
      <div class="tcard__route"><div><small>From</small><strong>${[q.origin_city, q.origin_state, q.origin_country].filter(Boolean).join(', ')}</strong></div><span class="tcard__arrow">${icon('arrow')}</span><div><small>To</small><strong>${[q.dest_city, q.dest_country].filter(Boolean).join(', ')}</strong></div></div>
      <p>${text}</p>
      ${idx >= 0 ? h`<ol class="qprog">${['Received', 'Under review', 'Quotation sent', 'Booked'].map((s, i) => h`<li class="${i <= idx ? 'done' : ''}">${s}</li>`)}</ol>` : ''}
      <dl class="tcard__dl"><dt>Shipment type</dt><dd>${shippingModes[q.mode]}</dd><dt>Submitted</dt><dd>${fmtDate(q.created_at)}</dd>${q.valid_until && q.status === 'quoted' ? h`<dt>Quotation valid until</dt><dd>${fmtDate(q.valid_until)}</dd>` : ''}</dl>
      ${shp ? h`<p class="alert alert--ok">Booked as shipment <strong class="mono">${shp.ref}</strong>. Track it with that reference.</p>` : ''}
      <p class="btn-row"><a class="btn btn--ghost-dark" href="/contact?type=general&ref=${q.ref}">Ask about this request</a><a class="btn btn--link" href="tel:${company.phoneHref}">${icon('phone')} ${company.phone}</a></p>
    </div>`, 'Quote request status'));
  }

  const s = one('SELECT * FROM shipments WHERE ref=? AND lower(contact_email)=?', ref, email);
  if (!s) return notFound();
  const ms = all('SELECT * FROM milestones WHERE shipment_id=? AND visible=1 ORDER BY occurred_at DESC, id DESC', s.id);
  const docs = all('SELECT id, original_name FROM files WHERE owner_type=? AND owner_id=? AND customer_visible=1 ORDER BY id DESC', 'shipment', s.id);
  html(ctx.res, page(ctx, h`<div class="tcard">
    <header class="tcard__head"><div><p class="muted small">Shipment</p><p class="tcard__ref mono">${s.ref}</p></div><span class="badge badge--${s.status}">${shipmentStatuses[s.status] || s.status}</span></header>
    <div class="tcard__route"><div><small>From</small><strong>${s.origin || '—'}</strong></div><span class="tcard__arrow">${icon('arrow')}</span><div><small>To</small><strong>${s.destination || '—'}</strong></div></div>
    <dl class="tcard__dl">
      ${s.cargo_summary ? h`<dt>Cargo</dt><dd>${s.cargo_summary}</dd>` : ''}
      ${s.container_no ? h`<dt>Container</dt><dd class="mono">${s.container_no}</dd>` : ''}
      ${s.bl_no ? h`<dt>Bill of lading</dt><dd class="mono">${s.bl_no}</dd>` : ''}
      ${s.vessel ? h`<dt>Vessel / voyage</dt><dd>${s.vessel}${s.voyage ? ` / ${s.voyage}` : ''}</dd>` : ''}
      ${s.etd ? h`<dt>Estimated departure</dt><dd>${fmtDate(s.etd)}</dd>` : ''}
      ${s.eta ? h`<dt>Estimated arrival</dt><dd>${fmtDate(s.eta)}${s.eta_note ? h` <small class="muted">— ${s.eta_note}</small>` : ''}</dd>` : ''}
    </dl>
    <h2 class="h4">Milestones</h2>
    ${ms.length ? h`<ol class="timeline">${ms.map((m, i) => h`<li class="${i === 0 ? 'is-latest' : ''}"><span class="timeline__dot"></span><div><strong>${m.label}</strong><span class="muted small">${fmtDateTime(m.occurred_at)}${m.location ? ` · ${m.location}` : ''}</span>${m.note ? h`<p>${m.note}</p>` : ''}</div></li>`)}</ol>` : h`<p class="muted">No milestones have been posted yet. We’ll add the first one as soon as it is confirmed.</p>`}
    ${docs.length ? h`<h2 class="h4">Documents shared with you</h2><ul class="filelist">${docs.map((d) => h`<li><a href="/track/file/${d.id}?e=${encodeURIComponent(email)}&t=${hmac(`file:${d.id}:${email}`)}">${d.original_name}</a></li>`)}</ul>` : ''}
    <p class="muted small">Estimated dates come from the carrier booking and can change. Milestones reflect events confirmed by LANSAR operations.</p>
    <p class="btn-row"><a class="btn btn--ghost-dark" href="/contact?type=shipment&ref=${s.ref}">Question about this shipment</a><a class="btn btn--link" href="/quote?repeat=1&repeat_of=${s.ref}">Ship this again</a></p>
  </div>`, `Shipment ${s.ref}`));
});
void quoteStatuses;

// Signed download link for documents staff have shared with the customer.
router.get('/track/file/:id', (ctx) => {
  const id = Number(ctx.params.id); const email = String(ctx.query.get('e') || '').toLowerCase();
  if (!safeEqual(ctx.query.get('t') || '', hmac(`file:${id}:${email}`))) throw new HttpError(403, 'This download link is not valid.');
  const f = one(`SELECT f.id FROM files f JOIN shipments s ON f.owner_type='shipment' AND s.id=f.owner_id
                 WHERE f.id=? AND f.customer_visible=1 AND lower(s.contact_email)=?`, id, email);
  if (!f || !streamFile(ctx.res, f.id)) throw new HttpError(404, 'Document not found.');
});
