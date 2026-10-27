import { router } from '../router.js';
import { h, raw, html, redirect, parseForm, str, isEmail, rateLimit, clientIp, HttpError, nowIso, fmtDateTime, hmac, safeEqual, esc } from '../lib/core.js';
import { layout, pageHero, icon } from '../views/layout.js';
import { company, config, caseTypes, caseStatuses } from '../config.js';
import { one, all, run, tx, upsertCustomer, logActivity, trackEvent } from '../db.js';
import { newRef, normalizeRef } from '../lib/refs.js';
import { validateFiles, storeFiles, streamFile } from '../lib/files.js';
import { sendMail, emailLayout, emailRow, emailButton, staffRecipients } from '../lib/mail.js';

const caseToken = (c) => hmac(`case:${c.id}:${c.email.toLowerCase()}`);

router.get('/support', (ctx) => {
  html(ctx.res, layout(ctx, {
    title: 'Customer support center', description: 'Get help with a LANSAR quote or shipment: track by reference, open a support case, send documents securely, or speak to a freight expert.',
    body: h`${pageHero({ kicker: 'Customer service center', title: 'How can we help?', lead: 'Every request gets a case reference and a named owner on our team. Urgent problems are escalated to a senior team member.', img: 'customer_support' })}
    <section class="section"><div class="wrap">
      <div class="help-grid">
        <a class="help" href="/track"><span class="mono">01</span><h2 class="h4">Track a shipment or quote</h2><p>Use your LFS- or LQ- reference and email.</p></a>
        <a class="help" href="/contact?type=shipment"><span class="mono">02</span><h2 class="h4">Question about a shipment</h2><p>Delays, pickup, delivery or paperwork on a booked shipment.</p></a>
        <a class="help" href="/contact?type=documents"><span class="mono">03</span><h2 class="h4">Send documents securely</h2><p>Titles, invoices, IDs and packing lists, attached to a case.</p></a>
        <a class="help" href="/contact?type=billing"><span class="mono">04</span><h2 class="h4">Billing &amp; invoices</h2><p>Payments, invoice copies and charges.</p></a>
        <a class="help" href="/contact?type=expert"><span class="mono">05</span><h2 class="h4">Speak to a freight expert</h2><p>Planning a shipment? Ask for a callback.</p></a>
        <a class="help help--alert" href="/contact?type=complaint"><span class="mono">06</span><h2 class="h4">Escalate a problem</h2><p>Goes straight to a senior team member.</p></a>
      </div>
      <div class="split split--top" style="margin-top:3rem">
        <form class="panel" method="post" action="/support/case"><h2 class="h4">Check an existing case</h2>
          <label class="fld"><span>Case reference</span><input name="ref" class="mono" required placeholder="LC-2610-XXXXX" autocapitalize="characters"></label>
          <label class="fld"><span>Email</span><input name="email" type="email" required autocomplete="email"></label>
          <button class="btn btn--primary">View case</button></form>
        <div class="panel panel--navy"><h2 class="h4">Talk to us now</h2><p>Our team is in ${company.city}.</p>
          <a class="btn btn--ghost btn--block" href="tel:${company.phoneHref}">${icon('phone')} ${company.phone}</a>
          <a class="btn btn--link-light btn--block" href="${company.whatsappHref}" target="_blank" rel="noopener">${icon('chat')} WhatsApp</a></div>
      </div>
    </div></section>`,
  }));
});

function contactForm(ctx, v = {}, errors = [], { business = false } = {}) {
  const type = business ? 'business_account' : (caseTypes[v.type] ? v.type : 'general');
  return h`<form class="panel cform" method="post" action="${business ? '/business' : '/contact'}" enctype="multipart/form-data">
    ${errors.length ? h`<div class="alert alert--err" role="alert"><ul>${errors.map((e) => h`<li>${e}</li>`)}</ul></div>` : ''}
    <div class="qgrid">
      ${business ? h`<input type="hidden" name="type" value="business_account">` : h`<label class="fld fld--full"><span>What do you need help with?</span><select name="type">${Object.entries(caseTypes).map(([k, l]) => h`<option value="${k}"${k === type ? raw(' selected') : ''}>${l}</option>`)}</select></label>`}
      <label class="fld"><span>Full name <b>*</b></span><input name="name" required value="${v.name || ''}" autocomplete="name"></label>
      <label class="fld"><span>Company${business ? h` <b>*</b>` : ' (optional)'}</span><input name="company" ${business ? raw('required') : ''} value="${v.company || ''}" autocomplete="organization"></label>
      <label class="fld"><span>Email <b>*</b></span><input type="email" name="email" required value="${v.email || ''}" autocomplete="email"></label>
      <label class="fld"><span>Phone / WhatsApp</span><input type="tel" name="phone" value="${v.phone || ''}" autocomplete="tel"></label>
      ${business ? h`
        <label class="fld"><span>Typical shipments per month</span><select name="volume">${['1–2', '3–5', '6–10', '10+', 'Seasonal / project-based'].map((o) => h`<option${v.volume === o ? raw(' selected') : ''}>${o}</option>`)}</select></label>
        <label class="fld"><span>Main destinations</span><input name="lanes" value="${v.lanes || ''}" placeholder="e.g. Dakar, Abidjan, Lagos"></label>
        <label class="fld fld--full"><span>What do you ship?</span><input name="cargo" value="${v.cargo || ''}" placeholder="e.g. vehicles, auto parts, building materials, food products"></label>`
    : h`<label class="fld"><span>Related reference (if any)</span><input name="related_ref" class="mono" value="${v.related_ref || v.ref || ''}" placeholder="LQ-… or LFS-…" autocapitalize="characters"></label>`}
      <label class="fld fld--full"><span>${business ? 'Tell us about your business' : 'How can we help?'} <b>*</b></span><textarea name="message" rows="5" required>${v.message || ''}</textarea></label>
      ${business ? '' : h`<label class="fld fld--full"><span>Attach documents (optional)</span><input type="file" name="documents" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx,.xls,.xlsx,.csv,.txt"><small>Up to ${config.uploads.maxFiles} files, 10 MB each. Stored privately.</small></label>`}
      <label class="check fld--full"><input type="checkbox" name="callback" value="1"${v.callback || type === 'expert' ? raw(' checked') : ''}><span>Please call me back</span></label>
      <label class="hp" aria-hidden="true">Website <input name="website" tabindex="-1" autocomplete="off"></label>
    </div>
    <button class="btn btn--primary btn--lg">${business ? 'Send business inquiry' : 'Send request'}</button>
  </form>`;
}

function contactPage(ctx, v, errors, status = 200) {
  html(ctx.res, layout(ctx, {
    title: v.type === 'expert' ? 'Speak to a freight expert' : 'Contact LANSAR',
    description: `Contact LANSAR Freight Shipping Corp in ${company.city}. Call ${company.phone}, message us on WhatsApp, or send a request and receive a case reference.`,
    body: h`${pageHero({ kicker: 'Contact', title: v.type === 'expert' ? 'Speak to a freight expert' : 'Contact LANSAR', lead: 'Send your request and you’ll get a case reference right away. A team member will reply by email or phone.' })}
    <section class="section section--tight"><div class="wrap qwrap">${contactForm(ctx, v, errors)}
      <aside class="qside"><div class="panel panel--navy"><h2 class="h4">Call or message</h2><p>${company.name}<br>${company.city}</p>
        <a class="btn btn--ghost btn--block" href="tel:${company.phoneHref}">${icon('phone')} ${company.phone}</a>
        <a class="btn btn--link-light btn--block" href="${company.whatsappHref}" target="_blank" rel="noopener">${icon('chat')} WhatsApp</a>
        ${company.email ? h`<p><a class="light-link" href="mailto:${company.email}">${company.email}</a></p>` : ''}</div>
        <div class="panel"><h2 class="h4">Need a price?</h2><p>The quote form collects everything we need to price your shipment.</p><a class="btn btn--primary btn--block" href="/quote">Request a quote</a></div></aside>
    </div></section>`,
  }), status);
}

router.get('/contact', (ctx) => contactPage(ctx, Object.fromEntries(ctx.query.entries()), []));

router.get('/business', (ctx) => {
  html(ctx.res, layout(ctx, {
    title: 'Business shipping accounts', description: 'Business accounts for exporters, dealers and distributors shipping regularly from the United States to Africa: a dedicated contact, repeat bookings and consolidated documentation.',
    body: h`${pageHero({ kicker: 'For companies', title: 'Business shipping accounts', lead: 'For exporters, dealers, distributors and project buyers who ship from the U.S. to Africa regularly.', img: 'client_consultation' })}
    <section class="section section--tight"><div class="wrap qwrap">${contactForm(ctx, {}, [], { business: true })}
      <aside class="qside"><div class="panel"><h2 class="h4">What a business account includes</h2><ul class="ticks"><li>A dedicated LANSAR contact</li><li>Repeat bookings from past shipments</li><li>Consolidated documentation per shipment</li><li>All your quotes and shipments under one customer record</li></ul></div></aside>
    </div></section>`,
  }));
});

async function createCase(ctx, business) {
  const ip = clientIp(ctx.req);
  const { fields, files } = await parseForm(ctx.req);
  const v = Object.fromEntries(Object.entries(fields).map(([k, x]) => [k, str(x, k === 'message' ? 5000 : 300)]));
  if (v.website) return redirect(ctx.res, '/support');
  if (!rateLimit(`case:${ip}`, 10, 3600_000)) throw new HttpError(429, 'Too many requests from this connection. Please call us.');
  const docs = files.documents || [];
  const errors = [];
  if (!v.name) errors.push('Enter your name.');
  if (!isEmail(v.email || '')) errors.push('Enter a valid email address.');
  if (!v.message) errors.push('Tell us how we can help.');
  if (business && !v.company) errors.push('Enter your company name.');
  errors.push(...validateFiles(docs));
  if (errors.length) {
    if (business) return html(ctx.res, layout(ctx, { title: 'Business shipping accounts', body: h`<section class="section"><div class="wrap narrow">${contactForm(ctx, v, errors, { business: true })}</div></section>` }), 422);
    return contactPage(ctx, v, errors, 422);
  }
  const type = business ? 'business_account' : (caseTypes[v.type] ? v.type : 'general');
  const email = v.email.toLowerCase();
  const priority = type === 'complaint' ? 'high' : 'normal';
  const status = type === 'complaint' ? 'escalated' : 'open';
  const subject = business ? `Business account: ${v.company}` : `${caseTypes[type]}${v.related_ref ? ` — ${normalizeRef(v.related_ref)}` : ''}`;
  const extra = business ? { volume: v.volume, lanes: v.lanes, cargo: v.cargo } : null;
  const now = nowIso();
  const c = tx(() => {
    const ref = newRef('LC');
    const customerId = upsertCustomer({ email, name: v.name, company: v.company, phone: v.phone, kind: business ? 'business' : '' });
    const id = Number(run(`INSERT INTO cases (ref,type,subject,name,email,phone,company,related_ref,callback,extra_json,status,priority,customer_id,ip,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, ref, type, subject, v.name, email, v.phone || null, v.company || null, normalizeRef(v.related_ref) || null,
    v.callback ? 1 : 0, extra ? JSON.stringify(extra) : null, status, priority, customerId, ip, now, now).lastInsertRowid);
    run('INSERT INTO case_messages (case_id,author,body,created_at) VALUES (?,?,?,?)', id, 'customer', v.message, now);
    logActivity('case', id, null, 'created', `Website · ${caseTypes[type]}`);
    return { id, ref, email };
  });
  await storeFiles(docs, 'case', c.id, 'customer', 1);
  trackEvent(business ? 'business_inquiry' : 'case_created', ctx.url.pathname, c.ref);
  const link = `${config.baseUrl}/support/case/${c.ref}?t=${caseToken(c)}`;
  sendMail({
    to: email, subject: `We received your request — ${c.ref}`,
    html: emailLayout('Your request is in', `<p style="font-size:15px;line-height:1.6">Hello ${esc(v.name.split(' ')[0])}, thank you for contacting LANSAR. Your case reference is <strong>${c.ref}</strong>. A team member will reply soon.</p>
      <table role="presentation">${emailRow('Topic', caseTypes[type])}${emailRow('Reference', c.ref)}</table>${emailButton(link, 'View or reply to your case')}`),
    text: `Your LANSAR case reference is ${c.ref}. View or reply: ${link}`,
  });
  if (staffRecipients().length) {
    sendMail({
      to: staffRecipients(), subject: `${priority === 'high' ? '[ESCALATED] ' : ''}New case ${c.ref}: ${subject}`, replyTo: email,
      html: emailLayout(`New case ${c.ref}`, `<table role="presentation">${emailRow('Type', caseTypes[type])}${emailRow('From', `${v.name} <${email}>`)}${emailRow('Phone', v.phone)}${emailRow('Callback', v.callback ? 'Yes' : 'No')}</table><p style="white-space:pre-wrap">${esc(v.message)}</p>${emailButton(`${config.baseUrl}/ops/cases/${c.id}`, 'Open case')}`),
    });
  }
  redirect(ctx.res, `/support/case/${c.ref}?t=${caseToken(c)}&new=1`);
}
router.post('/contact', (ctx) => createCase(ctx, false));
router.post('/business', (ctx) => createCase(ctx, true));

function caseView(ctx, c, isNew = false) {
  const msgs = all("SELECT * FROM case_messages WHERE case_id=? AND author IN ('customer','staff') ORDER BY id", c.id);
  const docs = all("SELECT id, original_name, uploaded_by FROM files WHERE owner_type='case' AND owner_id=? AND customer_visible=1 ORDER BY id", c.id);
  const t = caseToken(c);
  html(ctx.res, layout(ctx, {
    title: `Case ${c.ref}`, noindex: true,
    body: h`<section class="qhero"><div class="wrap"><p class="kicker kicker--light">Support case</p><h1 class="h2 mono">${c.ref}</h1><p class="lead lead--light">${c.subject}</p></div></section>
    <section class="section section--tight"><div class="wrap narrow">
      ${isNew ? h`<div class="alert alert--ok"><strong>Request received.</strong> Save this reference: <span class="mono">${c.ref}</span>. We emailed you a private link to this page.</div>` : ''}
      <p>Status: <span class="badge badge--${c.status}">${caseStatuses[c.status]}</span></p>
      <ol class="thread">${msgs.map((m) => h`<li class="thread__msg thread__msg--${m.author}"><header><strong>${m.author === 'staff' ? 'LANSAR team' : c.name}</strong><span class="muted small">${fmtDateTime(m.created_at)}</span></header><p>${m.body}</p></li>`)}</ol>
      ${docs.length ? h`<h2 class="h4">Documents on this case</h2><ul class="filelist">${docs.map((d) => h`<li><a href="/support/case/${c.ref}/file/${d.id}?t=${t}">${d.original_name}</a> <span class="muted small">${d.uploaded_by === 'customer' ? 'from you' : 'from LANSAR'}</span></li>`)}</ul>` : ''}
      ${c.status !== 'resolved' ? h`<form class="panel" method="post" action="/support/case/${c.ref}/reply" enctype="multipart/form-data">
        <input type="hidden" name="t" value="${t}"><h2 class="h4">Reply or add documents</h2>
        <label class="fld"><span>Message</span><textarea name="message" rows="4" required></textarea></label>
        <label class="fld"><span>Attach documents</span><input type="file" name="documents" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx,.xls,.xlsx,.csv,.txt"></label>
        <button class="btn btn--primary">Send</button></form>` : h`<p class="muted">This case is resolved. <a href="/contact?ref=${c.ref}">Open a new request</a> if you need more help.</p>`}
    </div></section>`,
  }));
}

function loadCaseByToken(ref, token) {
  const c = one('SELECT * FROM cases WHERE ref=?', normalizeRef(ref));
  if (!c || !safeEqual(token || '', caseToken(c))) throw new HttpError(403, 'This case link is not valid. Look the case up with your reference and email.');
  return c;
}

router.post('/support/case', async (ctx) => {
  if (!rateLimit(`caselookup:${clientIp(ctx.req)}`, 30, 3600_000)) throw new HttpError(429, 'Too many attempts. Please wait and try again.');
  const { fields } = await parseForm(ctx.req);
  const c = one('SELECT * FROM cases WHERE ref=? AND email=?', normalizeRef(fields.ref), str(fields.email).toLowerCase());
  if (!c) throw new HttpError(404, 'No case matches that reference and email.');
  redirect(ctx.res, `/support/case/${c.ref}?t=${caseToken(c)}`);
});
router.get('/support/case/:ref', (ctx) => caseView(ctx, loadCaseByToken(ctx.params.ref, ctx.query.get('t')), ctx.query.get('new') === '1'));
router.get('/support/case/:ref/file/:id', (ctx) => {
  const c = loadCaseByToken(ctx.params.ref, ctx.query.get('t'));
  const f = one("SELECT id FROM files WHERE id=? AND owner_type='case' AND owner_id=? AND customer_visible=1", Number(ctx.params.id), c.id);
  if (!f || !streamFile(ctx.res, f.id)) throw new HttpError(404, 'Document not found.');
});
router.post('/support/case/:ref/reply', async (ctx) => {
  const { fields, files } = await parseForm(ctx.req);
  const c = loadCaseByToken(ctx.params.ref, str(fields.t));
  const msg = str(fields.message, 5000);
  const docs = files.documents || [];
  const fe = validateFiles(docs);
  if (fe.length) throw new HttpError(422, fe.join(' '));
  if (!msg && !docs.length) return redirect(ctx.res, `/support/case/${c.ref}?t=${caseToken(c)}`);
  const now = nowIso();
  run('INSERT INTO case_messages (case_id,author,body,created_at) VALUES (?,?,?,?)', c.id, 'customer', msg || `(Attached ${docs.length} document${docs.length > 1 ? 's' : ''})`, now);
  run("UPDATE cases SET updated_at=?, status=CASE WHEN status='waiting_customer' THEN 'open' ELSE status END WHERE id=?", now, c.id);
  await storeFiles(docs, 'case', c.id, 'customer', 1);
  logActivity('case', c.id, null, 'customer_reply', docs.length ? `${docs.length} file(s)` : '');
  if (staffRecipients().length) sendMail({ to: staffRecipients(), subject: `Customer replied on ${c.ref}`, html: emailLayout(`Reply on ${c.ref}`, `<p style="white-space:pre-wrap">${esc(msg)}</p>${emailButton(`${config.baseUrl}/ops/cases/${c.id}`, 'Open case')}`) });
  redirect(ctx.res, `/support/case/${c.ref}?t=${caseToken(c)}`);
});
