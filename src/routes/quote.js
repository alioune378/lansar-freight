import { router } from '../router.js';
import { h, raw, html, redirect, parseForm, str, arr, num, isEmail, rateLimit, clientIp, HttpError, nowIso, esc } from '../lib/core.js';
import { layout, icon } from '../views/layout.js';
import { countryOptions } from './public.js';
import { company, config, shippingModes, containerTypes, optionalServices } from '../config.js';
import { one, run, tx, upsertCustomer, logActivity, trackEvent } from '../db.js';
import { newRef, normalizeRef } from '../lib/refs.js';
import { validateFiles, storeFiles } from '../lib/files.js';
import { sendMail, emailLayout, emailRow, emailButton, staffRecipients } from '../lib/mail.js';

const US_STATES = 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR'.split(' ');

const sel = (cur, val) => (String(cur ?? '') === String(val) ? raw(' selected') : '');
const chk = (cur, val) => ((Array.isArray(cur) ? cur.includes(val) : String(cur ?? '') === String(val)) ? raw(' checked') : '');

function radioCards(name, options, cur, required = true) {
  return h`<div class="rcards">${Object.entries(options).map(([k, label], i) => h`<label class="rcard"><input type="radio" name="${name}" value="${k}"${chk(cur, k)}${required && i === 0 ? raw(' required') : ''}><span>${label}</span></label>`)}</div>`;
}

function quoteForm(ctx, v = {}, errors = []) {
  const startStep = v._step || 1;
  const modeIcons = { fcl: 'Full container', lcl: 'Shared container', vehicle: 'Car, SUV, truck, equipment', trucking: 'Pickup & delivery in the U.S.', unsure: 'We’ll recommend' };
  return h`
<section class="qhero"><div class="wrap">
  <p class="kicker kicker--light">Freight quotation</p>
  <h1 class="h2">Request a freight quote</h1>
  <p class="lead lead--light">About 3 minutes. A LANSAR specialist reviews every request and replies with a written quotation. No automated pricing.</p>
</div></section>
<section class="section section--tight"><div class="wrap qwrap">
<form class="qform" method="post" action="/quote" enctype="multipart/form-data" novalidate data-wizard data-start="${startStep}">
  <ol class="qsteps" aria-label="Progress">
    <li data-for="1">Route</li><li data-for="2">Cargo</li><li data-for="3">Services &amp; documents</li><li data-for="4">Contact</li><li data-for="5">Review</li>
  </ol>
  ${errors.length ? h`<div class="alert alert--err" role="alert" tabindex="-1" id="qerrors"><strong>Please check the following:</strong><ul>${errors.map((e) => h`<li>${e}</li>`)}</ul></div>` : ''}

  <fieldset class="qstep" data-step="1"><legend>Where is the cargo going?</legend>
    <div class="qgrid">
      <h3 class="qsub">Origin</h3>
      <label class="fld"><span>Origin country</span><select name="origin_country"><option${sel(v.origin_country, 'United States')}>United States</option><option${sel(v.origin_country, 'Canada')}>Canada</option><option${sel(v.origin_country, 'Other')}>Other</option></select></label>
      <label class="fld"><span>State</span><select name="origin_state"><option value="">—</option>${US_STATES.map((s) => h`<option${sel(v.origin_state, s)}>${s}</option>`)}</select></label>
      <label class="fld"><span>City</span><input name="origin_city" value="${v.origin_city || ''}" autocomplete="address-level2"></label>
      <label class="fld"><span>ZIP code</span><input name="origin_zip" value="${v.origin_zip || ''}" inputmode="numeric" autocomplete="postal-code" maxlength="10"></label>
      <div class="fld fld--full"><span>How will the cargo reach the port?</span>${radioCards('origin_type', { pickup: 'Pick it up from my address', dropoff: 'I’ll deliver it to the terminal / warehouse', unsure: 'Not sure yet' }, v.origin_type || 'pickup', false)}</div>
      <h3 class="qsub">Destination</h3>
      <label class="fld"><span>Destination country <b>*</b></span><select name="dest_country" required>${countryOptions(v.dest_country)}</select></label>
      <label class="fld"><span>City</span><input name="dest_city" value="${v.dest_city || ''}"></label>
      <label class="fld"><span>Preferred port (if known)</span><input name="dest_port" value="${v.dest_port || ''}" placeholder="e.g. Dakar, Tema, Lagos"></label>
      <div class="fld fld--full"><span>Delivery at destination</span>${radioCards('dest_type', { port: 'Port only — I’ll handle collection', door: 'Delivered to an address', unsure: 'Not sure yet' }, v.dest_type || 'port', false)}</div>
      <label class="fld"><span>Cargo ready date</span><input type="date" name="ready_date" value="${v.ready_date || ''}"></label>
    </div>
  </fieldset>

  <fieldset class="qstep" data-step="2"><legend>What are you shipping?</legend>
    <div class="fld fld--full"><span>Shipment type <b>*</b></span>
      <div class="rcards rcards--modes">${Object.entries(shippingModes).map(([k, label]) => h`<label class="rcard rcard--mode"><input type="radio" name="mode" value="${k}" required${chk(v.mode, k)}><span><strong>${label.replace('Ocean — ', '')}</strong><small>${modeIcons[k]}</small></span></label>`)}</div>
    </div>
    <div class="qgrid" data-show="fcl">
      <h3 class="qsub">Container details</h3>
      <label class="fld"><span>Container type <b>*</b></span><select name="container_type" data-req="fcl"><option value="">Select…</option>${containerTypes.map((c) => h`<option${sel(v.container_type, c)}>${c}</option>`)}<option${sel(v.container_type, 'Not sure')}>Not sure</option></select></label>
      <label class="fld"><span>Number of containers <b>*</b></span><input type="number" min="1" max="200" name="container_qty" value="${v.container_qty || '1'}" data-req="fcl"></label>
      <label class="fld"><span>Approx. weight per container</span><span class="unit"><input type="number" min="0" step="any" name="container_weight" value="${v.container_weight || ''}"><select name="container_weight_unit"><option${sel(v.container_weight_unit, 'lb')}>lb</option><option${sel(v.container_weight_unit, 'kg')}>kg</option></select></span></label>
    </div>
    <div class="qgrid" data-show="lcl trucking unsure">
      <h3 class="qsub">Pieces, weight &amp; size</h3>
      <label class="fld"><span>Number of pieces <b>*</b></span><input type="number" min="1" name="pieces" value="${v.pieces || ''}" data-req="lcl trucking"></label>
      <label class="fld"><span>Packaging</span><select name="packaging"><option value="">Select…</option>${['Pallets', 'Crates', 'Cartons / boxes', 'Barrels / drums', 'Loose / unpacked', 'Other'].map((p) => h`<option${sel(v.packaging, p)}>${p}</option>`)}</select></label>
      <label class="fld"><span>Total weight <b>*</b></span><span class="unit"><input type="number" min="0" step="any" name="total_weight" value="${v.total_weight || ''}" data-req="lcl trucking"><select name="weight_unit"><option${sel(v.weight_unit, 'lb')}>lb</option><option${sel(v.weight_unit, 'kg')}>kg</option></select></span></label>
      <label class="fld"><span>Dimensions per piece (L × W × H)</span><span class="unit unit--dims"><input type="number" min="0" step="any" name="dim_l" placeholder="L" value="${v.dim_l || ''}" aria-label="Length"><input type="number" min="0" step="any" name="dim_w" placeholder="W" value="${v.dim_w || ''}" aria-label="Width"><input type="number" min="0" step="any" name="dim_h" placeholder="H" value="${v.dim_h || ''}" aria-label="Height"><select name="dim_unit" aria-label="Dimension unit"><option${sel(v.dim_unit, 'in')}>in</option><option${sel(v.dim_unit, 'cm')}>cm</option></select></span></label>
      <label class="fld"><span>Or total volume</span><span class="unit"><input type="number" min="0" step="any" name="total_volume" value="${v.total_volume || ''}"><select name="volume_unit"><option${sel(v.volume_unit, 'cbm')}>cbm</option><option${sel(v.volume_unit, 'cu ft')}>cu ft</option></select></span></label>
    </div>
    <div class="qgrid" data-show="vehicle">
      <h3 class="qsub">Vehicle details</h3>
      <label class="fld"><span>Year <b>*</b></span><input type="number" min="1950" max="2030" name="veh_year" value="${v.veh_year || ''}" data-req="vehicle"></label>
      <label class="fld"><span>Make <b>*</b></span><input name="veh_make" value="${v.veh_make || ''}" placeholder="e.g. Toyota" data-req="vehicle"></label>
      <label class="fld"><span>Model <b>*</b></span><input name="veh_model" value="${v.veh_model || ''}" placeholder="e.g. Highlander" data-req="vehicle"></label>
      <label class="fld"><span>VIN (optional)</span><input name="veh_vin" value="${v.veh_vin || ''}" maxlength="17" class="mono" autocapitalize="characters"></label>
      <label class="fld"><span>Number of vehicles</span><input type="number" min="1" max="50" name="veh_qty" value="${v.veh_qty || '1'}"></label>
      <label class="fld"><span>Condition</span><select name="veh_condition"><option${sel(v.veh_condition, 'Runs and drives')}>Runs and drives</option><option${sel(v.veh_condition, 'Does not run')}>Does not run</option><option${sel(v.veh_condition, 'Not sure')}>Not sure</option></select></label>
      <div class="fld fld--full"><span>Preferred shipping method</span>${radioCards('veh_method', { roro: 'RoRo (roll-on/roll-off)', shared: 'Shared container', exclusive: 'Exclusive container', unsure: 'Advise me' }, v.veh_method || 'unsure', false)}</div>
      <label class="fld"><span>Title status</span><select name="veh_title"><option${sel(v.veh_title, 'Clean title in hand')}>Clean title in hand</option><option${sel(v.veh_title, 'Title with lien / lienholder')}>Title with lien / lienholder</option><option${sel(v.veh_title, 'Title not yet received')}>Title not yet received</option><option${sel(v.veh_title, 'Salvage title')}>Salvage title</option></select></label>
      <label class="fld fld--full"><span>Additional vehicles (year, make, model for each)</span><textarea name="veh_more" rows="2">${v.veh_more || ''}</textarea></label>
    </div>
    <div class="qgrid">
      <h3 class="qsub">Cargo description</h3>
      <label class="fld fld--full"><span>What is the cargo? <b data-hide="vehicle">*</b></span><textarea name="commodity" rows="2" data-req="fcl lcl trucking unsure" placeholder="e.g. used household goods, auto parts, construction materials, packaged food">${v.commodity || ''}</textarea></label>
      <label class="fld"><span>Declared cargo value</span><span class="unit"><input type="number" min="0" step="any" name="cargo_value" value="${v.cargo_value || ''}"><select name="cargo_currency"><option${sel(v.cargo_currency, 'USD')}>USD</option><option${sel(v.cargo_currency, 'EUR')}>EUR</option><option${sel(v.cargo_currency, 'XOF')}>XOF</option></select></span></label>
      <div class="fld"><span>Hazardous materials?</span>${radioCards('hazardous', { no: 'No', yes: 'Yes', unsure: 'Not sure' }, v.hazardous || 'no', false)}</div>
    </div>
  </fieldset>

  <fieldset class="qstep" data-step="3"><legend>Extra services and documents</legend>
    <div class="fld fld--full"><span>Services you’d like included</span>
      <div class="checks">${Object.entries(optionalServices).map(([k, label]) => h`<label class="check"><input type="checkbox" name="services" value="${k}"${chk(arr(v.services), k)}><span>${label}</span></label>`)}</div>
    </div>
    <label class="fld fld--full drop"><span>Attach documents (optional)</span>
      <input type="file" name="documents" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx,.xls,.xlsx,.csv,.txt">
      <small>Commercial invoice, packing list, vehicle title, photos. Up to ${config.uploads.maxFiles} files, 10 MB each. Files are stored privately.</small>
      <ul class="drop__list" data-filelist></ul>
    </label>
    <label class="fld fld--full"><span>Anything else we should know?</span><textarea name="notes" rows="4" placeholder="Deadlines, special handling, consignee details, questions…">${v.notes || ''}</textarea></label>
  </fieldset>

  <fieldset class="qstep" data-step="4"><legend>Who should we send the quote to?</legend>
    <div class="qgrid">
      <label class="fld"><span>Full name <b>*</b></span><input name="contact_name" required value="${v.contact_name || ''}" autocomplete="name"></label>
      <label class="fld"><span>Company (optional)</span><input name="company" value="${v.company || ''}" autocomplete="organization"></label>
      <label class="fld"><span>Email <b>*</b></span><input type="email" name="email" required value="${v.email || ''}" autocomplete="email"></label>
      <label class="fld"><span>Phone <b>*</b></span><input type="tel" name="phone" required value="${v.phone || ''}" autocomplete="tel"></label>
      <label class="fld"><span>WhatsApp (if different)</span><input type="tel" name="whatsapp" value="${v.whatsapp || ''}"></label>
      <label class="fld"><span>Preferred contact</span><select name="preferred_contact"><option value="email"${sel(v.preferred_contact, 'email')}>Email</option><option value="phone"${sel(v.preferred_contact, 'phone')}>Phone call</option><option value="whatsapp"${sel(v.preferred_contact, 'whatsapp')}>WhatsApp</option></select></label>
      <div class="fld fld--full"><span>I’m shipping as</span>${radioCards('customer_kind', { individual: 'An individual / family', business: 'A business' }, v.customer_kind || 'individual', false)}</div>
      <label class="fld"><span>Repeating a past shipment? Previous reference</span><input name="repeat_of" value="${v.repeat_of || ''}" class="mono" placeholder="LFS-…" autocapitalize="characters"></label>
      <label class="hp" aria-hidden="true">Website <input name="website" tabindex="-1" autocomplete="off"></label>
      <label class="check fld--full"><input type="checkbox" name="consent" value="1" required${chk(v.consent, '1')}><span>I agree that LANSAR may contact me about this request by email, phone or WhatsApp. <a href="/privacy" target="_blank">Privacy notice</a> <b>*</b></span></label>
    </div>
    ${['utm_source', 'utm_medium', 'utm_campaign', 'landing', 'referrer'].map((k) => h`<input type="hidden" name="${k}" value="${v[k] || ''}">`)}
  </fieldset>

  <fieldset class="qstep" data-step="5"><legend>Review and submit</legend>
    <div class="review" data-review><p class="muted">Check your details below, then submit.</p></div>
    <p class="muted small">By submitting you request a quotation, not a booking. Nothing is charged.</p>
  </fieldset>

  <div class="qnav">
    <button type="button" class="btn btn--ghost-dark" data-prev>Back</button>
    <span class="qnav__count mono" data-count></span>
    <button type="button" class="btn btn--primary" data-next>Continue ${icon('arrow')}</button>
    <button type="submit" class="btn btn--primary" data-submit>Submit quote request</button>
  </div>
</form>
<aside class="qside">
  <div class="panel"><h2 class="h4">What happens next</h2>
    <ol class="mini-steps"><li>You get a reference number right away, by email too.</li><li>A specialist reviews your cargo and route.</li><li>You receive a written quotation with its validity date.</li></ol></div>
  <div class="panel panel--navy"><h2 class="h4">Prefer to talk?</h2><p>Call our team in ${company.city}.</p><a class="btn btn--ghost btn--block" href="tel:${company.phoneHref}">${icon('phone')} ${company.phone}</a><a class="btn btn--link-light btn--block" href="${company.whatsappHref}" target="_blank" rel="noopener">${icon('chat')} Message on WhatsApp</a></div>
</aside>
</div></section>
<script src="/js/quote.js?v=1" defer></script>`;
}

router.get('/quote', (ctx) => {
  const v = Object.fromEntries(ctx.query.entries());
  if (v.mode && !shippingModes[v.mode]) delete v.mode;
  if (v.dest_country || v.mode || v.origin_city) v._step = 1;
  html(ctx.res, layout(ctx, {
    title: 'Request a freight quote', bodyClass: 'quote-page',
    description: 'Request a written freight quote for containers, vehicles or cargo shipping from the United States to Africa. A LANSAR specialist reviews every request.',
    body: quoteForm(ctx, v),
  }));
});

function validate(f, files) {
  const e = []; let step = 99;
  const need = (cond, msg, s) => { if (!cond) { e.push(msg); step = Math.min(step, s); } };
  need(f.dest_country, 'Choose a destination country.', 1);
  need(shippingModes[f.mode], 'Choose a shipment type.', 2);
  if (f.mode === 'fcl') { need(f.container_type, 'Choose a container type.', 2); need(num(f.container_qty) >= 1, 'Enter the number of containers.', 2); }
  if (f.mode === 'lcl' || f.mode === 'trucking') { need(num(f.pieces) >= 1, 'Enter the number of pieces.', 2); need(num(f.total_weight) > 0, 'Enter the total weight.', 2); }
  if (f.mode === 'vehicle') { need(f.veh_year && f.veh_make && f.veh_model, 'Enter the vehicle year, make and model.', 2); }
  if (f.mode && f.mode !== 'vehicle') need(f.commodity, 'Describe the cargo.', 2);
  const fe = validateFiles(files); if (fe.length) { e.push(...fe); step = Math.min(step, 3); }
  need(f.contact_name, 'Enter your full name.', 4);
  need(isEmail(f.email), 'Enter a valid email address.', 4);
  need(f.phone && f.phone.replace(/\D/g, '').length >= 7, 'Enter a phone number we can reach you on.', 4);
  need(f.consent === '1', 'Please agree to be contacted about this request.', 4);
  return { errors: e, step: step === 99 ? 1 : step };
}

router.post('/quote', async (ctx) => {
  const ip = clientIp(ctx.req);
  const { fields, files } = await parseForm(ctx.req);
  const f = {};
  for (const [k, v] of Object.entries(fields)) f[k] = k === 'services' ? arr(v) : str(v, k === 'notes' || k === 'commodity' || k === 'veh_more' ? 4000 : 300);
  const docs = files.documents || [];

  if (f.website) return redirect(ctx.res, '/quote/received/thank-you'); // honeypot: pretend success
  if (!rateLimit(`quote:${ip}`, 8, 3600_000)) throw new HttpError(429, 'Too many quote requests from this connection. Please call us instead.');

  const { errors, step } = validate(f, docs);
  if (errors.length) {
    return html(ctx.res, layout(ctx, { title: 'Request a freight quote', bodyClass: 'quote-page', noindex: true, body: quoteForm(ctx, { ...f, _step: step }, docs.length && !errors.some((x) => x.includes('file')) ? [...errors, 'Please re-attach your documents.'] : errors) }), 422);
  }

  const m = f.mode;
  const cargo = { packaging: f.packaging };
  if (m === 'fcl') Object.assign(cargo, { container_type: f.container_type, container_qty: num(f.container_qty), container_weight: num(f.container_weight), container_weight_unit: f.container_weight_unit });
  if (['lcl', 'trucking', 'unsure'].includes(m)) Object.assign(cargo, { pieces: num(f.pieces), total_weight: num(f.total_weight), weight_unit: f.weight_unit, dims: [num(f.dim_l), num(f.dim_w), num(f.dim_h)].some(Boolean) ? `${f.dim_l || '?'} × ${f.dim_w || '?'} × ${f.dim_h || '?'} ${f.dim_unit}` : '', total_volume: num(f.total_volume), volume_unit: f.volume_unit });
  if (m === 'vehicle') Object.assign(cargo, { veh_year: f.veh_year, veh_make: f.veh_make, veh_model: f.veh_model, veh_vin: f.veh_vin.toUpperCase(), veh_qty: num(f.veh_qty) || 1, veh_condition: f.veh_condition, veh_method: f.veh_method, veh_title: f.veh_title, veh_more: f.veh_more });
  for (const k of Object.keys(cargo)) if (cargo[k] === null || cargo[k] === '' || cargo[k] === undefined) delete cargo[k];
  const services = (f.services || []).filter((s) => optionalServices[s]);
  const email = f.email.toLowerCase();
  const now = nowIso();

  const { id, ref } = tx(() => {
    const ref = newRef('LQ');
    const customerId = upsertCustomer({ email, name: f.contact_name, company: f.company, phone: f.phone, whatsapp: f.whatsapp, country: f.origin_country, kind: f.customer_kind });
    const id = Number(run(`INSERT INTO quotes (ref,status,customer_id,contact_name,company,email,phone,whatsapp,preferred_contact,customer_kind,mode,
        origin_country,origin_state,origin_city,origin_zip,origin_type,dest_country,dest_city,dest_port,dest_type,ready_date,cargo_json,services_json,
        commodity,cargo_value,cargo_currency,hazardous,notes,source,utm_json,ip,repeat_of,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ref, 'new', customerId, f.contact_name, f.company || null, email, f.phone, f.whatsapp || null, f.preferred_contact || 'email', f.customer_kind || null, m,
    f.origin_country || 'United States', f.origin_state || null, f.origin_city || null, f.origin_zip || null, f.origin_type || null,
    f.dest_country, f.dest_city || null, f.dest_port || null, f.dest_type || null, f.ready_date || null, JSON.stringify(cargo), JSON.stringify(services),
    f.commodity || null, num(f.cargo_value), f.cargo_currency || 'USD', f.hazardous === 'yes' ? 1 : f.hazardous === 'unsure' ? 2 : 0, f.notes || null,
    f.referrer || null, JSON.stringify({ source: f.utm_source, medium: f.utm_medium, campaign: f.utm_campaign, landing: f.landing }), ip,
    normalizeRef(f.repeat_of) || null, now, now).lastInsertRowid);
    logActivity('quote', id, null, 'created', 'Submitted via website');
    return { id, ref };
  });
  await storeFiles(docs, 'quote', id, 'customer');
  trackEvent('quote_submitted', '/quote', ref);

  // Notifications
  const route = `${[f.origin_city, f.origin_state, f.origin_country].filter(Boolean).join(', ')} → ${[f.dest_city, f.dest_country].filter(Boolean).join(', ')}`;
  const cargoLine = m === 'vehicle' ? `${f.veh_year} ${f.veh_make} ${f.veh_model}${num(f.veh_qty) > 1 ? ` (+${num(f.veh_qty) - 1} more)` : ''}` : m === 'fcl' ? `${f.container_qty} × ${f.container_type} — ${f.commodity}` : f.commodity;
  const rows = emailRow('Reference', ref) + emailRow('Shipment type', shippingModes[m]) + emailRow('Route', route) + emailRow('Cargo', cargoLine) + emailRow('Ready date', f.ready_date || 'Not specified');
  sendMail({
    to: email, subject: `We received your quote request — ${ref}`,
    html: emailLayout('Your quote request is in', `<p style="font-size:15px;line-height:1.6">Hello ${esc(f.contact_name.split(' ')[0])},</p>
      <p style="font-size:15px;line-height:1.6">Thank you for choosing LANSAR. A freight specialist will review your request and send you a written quotation. Keep your reference number. You can use it to check the status of your request at any time.</p>
      <table role="presentation" style="margin:16px 0;border-collapse:collapse">${rows}</table>
      ${emailButton(`${config.baseUrl}/track?ref=${ref}`, 'Check request status')}
      <p style="font-size:13px;color:#5b6b80">Questions? Call ${esc(company.phone)} and mention ${ref}.</p>`),
    text: `Thank you. Your LANSAR quote reference is ${ref}. Route: ${route}. A specialist will reply with a written quotation. Call ${company.phone} with questions.`,
  });
  if (staffRecipients().length) {
    sendMail({
      to: staffRecipients(), subject: `New quote request ${ref}: ${shippingModes[m]} to ${f.dest_country}`, replyTo: email,
      html: emailLayout(`New quote request ${ref}`, `<table role="presentation" style="border-collapse:collapse">${rows}${emailRow('Customer', `${f.contact_name}${f.company ? ` (${f.company})` : ''}`)}${emailRow('Email', email)}${emailRow('Phone', f.phone)}${emailRow('Documents', String(docs.length))}</table>${emailButton(`${config.baseUrl}/ops/quotes/${id}`, 'Open in dashboard')}`),
      text: `New quote ${ref} from ${f.contact_name} <${email}> ${f.phone}. ${route}. ${config.baseUrl}/ops/quotes/${id}`,
    });
  }
  redirect(ctx.res, `/quote/received/${ref}`);
});

router.get('/quote/received/:ref', (ctx) => {
  const ref = normalizeRef(ctx.params.ref);
  const q = one('SELECT ref FROM quotes WHERE ref=?', ref);
  const shown = q?.ref || null;
  html(ctx.res, layout(ctx, {
    title: 'Quote request received', noindex: true,
    body: h`<section class="section"><div class="wrap narrow center confirm">
      <div class="confirm__mark" aria-hidden="true">✓</div>
      <p class="kicker">Request received</p>
      <h1 class="h2">Thank you. Your quote request is in.</h1>
      ${shown ? h`<p class="lead">Your reference number</p><p class="refbox mono" data-copy>${shown}</p>
      <p>We’ve emailed a confirmation. A LANSAR specialist will review your request and reply with a written quotation.</p>` : h`<p class="lead">We’ve emailed a confirmation. A LANSAR specialist will be in touch.</p>`}
      <div class="btn-row center"><a class="btn btn--primary" href="/track${shown ? `?ref=${shown}` : ''}">Check request status</a><a class="btn btn--ghost-dark" href="/">Back to homepage</a></div>
      <p class="muted small">Need it urgently? Call <a href="tel:${company.phoneHref}">${company.phone}</a>${shown ? ` and mention ${shown}` : ''}.</p>
    </div></section>
    ${shown ? raw(`<script>window.gtag&&gtag('event','generate_lead',{quote_ref:'${shown}'});window.plausible&&plausible('Quote Submitted');</script>`) : ''}`,
  }));
});
