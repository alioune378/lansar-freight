import { router } from '../router.js';
import { h, raw, html, send } from '../lib/core.js';
import { layout, pageHero, icon } from '../views/layout.js';
import { company, services, destinations, shippingModes, africanCountries, config } from '../config.js';
import { HttpError } from '../lib/core.js';

const countryOptions = (sel = '') => h`<option value="">Select country…</option>${destinations.map((d) => h`<option${d.country === sel ? raw(' selected') : ''}>${d.country}</option>`)}<option disabled>──────────</option>${africanCountries.filter((c) => !destinations.some((d) => d.country === c)).map((c) => h`<option${c === sel ? raw(' selected') : ''}>${c}</option>`)}<option value="Other">Other (outside Africa)</option>`;
export { countryOptions };

// ——— Signature element: the U.S. → Africa corridor diagram ———
function corridor() {
  const pts = [['Dakar', 'Senegal', 600, 70], ['Conakry', 'Guinea', 618, 118], ['Abidjan', "Côte d'Ivoire", 650, 166], ['Tema', 'Ghana', 680, 214], ['Lomé', 'Togo', 700, 262], ['Lagos', 'Nigeria', 724, 310], ['Douala', 'Cameroon', 756, 358]];
  const coast = `M ${pts[0][2] - 18} 30 ` + pts.map(([, , x, y]) => `L ${x - 18} ${y}`).join(' ') + ` L ${pts[6][2] - 30} 410`;
  return h`<svg class="corridor" viewBox="0 0 960 420" role="img" aria-labelledby="corrT">
  <title id="corrT">Diagram: shipping lanes from New York across the Atlantic to ports in Senegal, Guinea, Côte d'Ivoire, Ghana, Togo, Nigeria and Cameroon</title>
  <defs><linearGradient id="cg" x1="0" x2="1"><stop offset="0" stop-color="#6cbcf3"/><stop offset="1" stop-color="#b48ad6"/></linearGradient></defs>
  <g class="corridor__grid">${Array.from({ length: 11 }, (_, i) => h`<line x1="${i * 96}" y1="0" x2="${i * 96}" y2="420"/>`)}${Array.from({ length: 6 }, (_, i) => h`<line x1="0" y1="${i * 84}" x2="960" y2="${i * 84}"/>`)}</g>
  <path class="corridor__coast" d="${coast}"/>
  <text class="corridor__lbl corridor__lbl--sea" x="300" y="330">ATLANTIC OCEAN</text>
  ${pts.map(([, , x, y], i) => h`<path class="corridor__route" style="--d:${i * 0.25}s" d="M110 150 C 300 ${60 + i * 8}, 440 ${y - 40}, ${x} ${y}"/>`)}
  <g class="corridor__origin"><circle cx="110" cy="150" r="9"/><circle class="pulse" cx="110" cy="150" r="9"/>
    <text class="corridor__lbl" x="110" y="120" text-anchor="middle">NEW YORK</text>
    <text class="corridor__sub" x="110" y="182" text-anchor="middle">LANSAR · Bronx HQ</text></g>
  ${pts.map(([n, c, x, y]) => h`<g class="corridor__port"><circle cx="${x}" cy="${y}" r="5.5"/><text class="corridor__pt" x="${x + 16}" y="${y + 4}">${n}<tspan class="corridor__ct" dx="8">${c}</tspan></text></g>`)}
</svg>`;
}

router.get('/', (ctx) => {
  const body = h`
<section class="hero">
  <picture><source media="(max-width: 700px)" srcset="/img/hero-sm.webp"><img class="hero__bg" src="/img/hero.webp" alt="Container ship at a port terminal with the New York skyline at sunset" fetchpriority="high"></picture>
  <div class="hero__shade"></div>
  <div class="wrap hero__in">
    <p class="kicker kicker--light">U.S. → Africa freight forwarding · Since ${company.established}</p>
    <h1 class="hero__h">Your Cargo.<br>Our Commitment.<br><em>Across Borders.</em></h1>
    <p class="hero__lead">Containers, vehicles and commercial cargo shipped from the United States to Africa — quoted by a specialist, documented carefully, and tracked under one LANSAR reference from pickup to delivery.</p>
    <div class="btn-row">
      <a class="btn btn--primary btn--lg" href="/quote" data-evt="cta_quote_hero">Request a Freight Quote ${icon('arrow')}</a>
      <a class="btn btn--ghost btn--lg" href="/track">Track Your Shipment</a>
      <a class="btn btn--link-light btn--lg" href="/contact?type=expert">${icon('phone')} Speak to an Expert</a>
    </div>
  </div>
</section>

<section class="console-wrap"><div class="wrap">
  <div class="console" data-tabs>
    <div class="console__tabs" role="tablist">
      <button role="tab" aria-selected="true" aria-controls="tab-quote" id="t-quote">Get a freight quote</button>
      <button role="tab" aria-selected="false" aria-controls="tab-track" id="t-track">Track a shipment</button>
    </div>
    <form id="tab-quote" role="tabpanel" aria-labelledby="t-quote" class="console__panel" method="get" action="/quote">
      <label class="fld"><span>Shipping from (U.S. city or ZIP)</span><input name="origin_city" placeholder="e.g. Bronx, NY or 10451" autocomplete="address-level2"></label>
      <label class="fld"><span>Shipping to</span><select name="dest_country">${countryOptions()}</select></label>
      <label class="fld"><span>What are you shipping?</span><select name="mode">${Object.entries(shippingModes).map(([k, v]) => h`<option value="${k}">${v}</option>`)}</select></label>
      <button class="btn btn--primary console__go">Continue ${icon('arrow')}</button>
    </form>
    <form id="tab-track" role="tabpanel" aria-labelledby="t-track" class="console__panel" method="post" action="/track" hidden>
      <label class="fld"><span>LANSAR reference</span><input name="ref" required placeholder="LFS-2610-XXXXXX or LQ-2610-XXXXX" class="mono" autocapitalize="characters"></label>
      <label class="fld"><span>Email on the booking</span><input name="email" type="email" required autocomplete="email" placeholder="you@example.com"></label>
      <button class="btn btn--primary console__go">Track ${icon('arrow')}</button>
    </form>
  </div>
  <ul class="facts">
    <li><strong>${company.established}</strong><span>Established in New York</span></li>
    <li><strong>Bronx, NY</strong><span>Headquarters and operations desk</span></li>
    <li><strong>U.S. → Africa</strong><span>The corridor we specialize in</span></li>
    <li><strong>One reference</strong><span>For your quote, booking and tracking</span></li>
  </ul>
</div></section>

<section class="section"><div class="wrap">
  <div class="sec-head"><p class="kicker">What we move</p><h2 class="h2">Freight services built around the U.S.–Africa lane</h2>
  <p class="lead">Pick the service, or tell us about the cargo and we’ll recommend the right way to ship it.</p></div>
  <div class="svc-grid">
    ${services.map((s, i) => h`<a class="svc" href="/services/${s.slug}">
      <img src="/img/${s.img}.webp" alt="" loading="lazy" width="460" height="260">
      <div class="svc__body"><span class="svc__tag mono">${String(i + 1).padStart(2, '0')} · ${s.short}</span><h3>${s.name}</h3><p>${s.lead}</p><span class="svc__more">Learn more ${icon('arrow')}</span></div>
    </a>`)}
    <a class="svc svc--cta" href="/quote"><div class="svc__body"><span class="svc__tag mono">Not sure?</span><h3>Describe your cargo. We’ll advise.</h3><p>Choose “Not sure — advise me” in the quote form and a specialist will recommend the best way to ship.</p><span class="svc__more">Start a quote ${icon('arrow')}</span></div></a>
  </div>
</div></section>

<section class="section section--navy corridor-sec"><div class="wrap">
  <div class="corridor-grid">
    <div>
      <p class="kicker kicker--light">The corridor</p>
      <h2 class="h2">From U.S. ports to the coast of Africa</h2>
      <p class="lead lead--light">Most of our work runs across the Atlantic, from the United States to West and Central African ports. Choose a destination to see what to prepare, or ask us about any African country.</p>
      <div class="chips">${destinations.map((d) => h`<a class="chip" href="/shipping-to/${d.slug}">${d.country}</a>`)}</div>
    </div>
    <div class="corridor-box">${corridor()}<p class="corridor-note">Illustrative diagram of major destination ports. Routing and carriers are confirmed per booking.</p></div>
  </div>
</div></section>

<section class="section"><div class="wrap">
  <div class="sec-head"><p class="kicker">How it works</p><h2 class="h2">A real person on your quote. Real milestones on your shipment.</h2></div>
  <ol class="steps">
    <li><span class="mono">01</span><h3>Tell us about the cargo</h3><p>Origin, destination, what you’re shipping and when it’s ready. Attach invoices, titles or packing lists if you have them.</p></li>
    <li><span class="mono">02</span><h3>Get a written quote</h3><p>A LANSAR specialist reviews your request and sends a written quotation. No automated guesses and no hidden line items.</p></li>
    <li><span class="mono">03</span><h3>Book and document</h3><p>We confirm the booking, arrange pickup, and check the export paperwork before your cargo moves.</p></li>
    <li><span class="mono">04</span><h3>Track every milestone</h3><p>Our team posts each confirmed milestone to your LANSAR reference, from pickup and loading through arrival and delivery.</p></li>
  </ol>
</div></section>

<section class="section section--paper"><div class="wrap split">
  <div class="split__media"><img src="/img/vehicle_roro_shipping.webp" alt="Vehicles being loaded onto a roll-on/roll-off vessel" loading="lazy" width="407" height="253"></div>
  <div>
    <p class="kicker">Vehicle shipping</p>
    <h2 class="h2">Shipping a car, SUV or truck to Africa?</h2>
    <p class="lead">Vehicle exports from the U.S. need the right documents filed with U.S. Customs before departure. We check them with you up front so your vehicle isn’t held at the port.</p>
    <ul class="ticks"><li>Original certificate of title (or the required lienholder release)</li><li>Bill of sale or purchase invoice</li><li>Photo ID of the shipper and consignee details</li><li>Pickup from dealers, auctions or a home address</li></ul>
    <p class="btn-row"><a class="btn btn--primary" href="/quote?mode=vehicle">Quote a vehicle shipment</a><a class="btn btn--ghost-dark" href="/services/vehicle-shipping">Vehicle shipping details</a></p>
  </div>
</div></section>

<section class="section"><div class="wrap duo">
  <article class="panel panel--biz">
    <p class="kicker">For companies</p><h2 class="h3">Business accounts</h2>
    <p>Exporters, dealers and distributors shipping regularly get a dedicated contact, consolidated paperwork, and repeat bookings without re-entering details every time.</p>
    <a class="btn btn--primary" href="/business">Open a business account inquiry</a>
  </article>
  <article class="panel panel--support">
    <img src="/img/customer_support.webp" alt="" loading="lazy" width="465" height="259">
    <div><p class="kicker">Customer support</p><h2 class="h3">Talk to a person who knows your file</h2>
    <p>Open a case with a reference number, send documents securely, or ask for a callback. Urgent issues go straight to a senior team member.</p>
    <p class="btn-row"><a class="btn btn--ghost-dark" href="/support">Support center</a><a class="btn btn--link" href="tel:${company.phoneHref}">${icon('phone')} ${company.phone}</a></p></div>
  </article>
</div></section>

<section class="cta-band"><img src="/img/ocean_freight_aerial.webp" alt="" aria-hidden="true" loading="lazy"><div class="wrap cta-band__in">
  <div><h2 class="h2">Ready to ship?</h2><p class="lead lead--light">Send the details now. A specialist will review your request and reply with a written quote.</p></div>
  <div class="btn-row"><a class="btn btn--primary btn--lg" href="/quote" data-evt="cta_quote_footer">Request a Freight Quote</a><a class="btn btn--ghost btn--lg" href="/contact?type=expert">Speak to an Expert</a></div>
</div></section>`;
  html(ctx.res, layout(ctx, { body, bodyClass: 'home' }));
});

// ——— Services ———
router.get('/services', (ctx) => {
  html(ctx.res, layout(ctx, {
    title: 'Freight services', description: 'Ocean freight (FCL and LCL), vehicle shipping, inland trucking, warehousing and export documentation from the United States to Africa.',
    body: h`${pageHero({ kicker: 'Services', title: 'Freight services', lead: 'Everything it takes to move cargo from a U.S. address to an African port or door.', img: 'port_operations' })}
    <section class="section"><div class="wrap"><div class="svc-grid">${services.map((s, i) => h`<a class="svc" href="/services/${s.slug}"><img src="/img/${s.img}.webp" alt="" loading="lazy"><div class="svc__body"><span class="svc__tag mono">${String(i + 1).padStart(2, '0')} · ${s.short}</span><h3>${s.name}</h3><p>${s.lead}</p><span class="svc__more">Learn more ${icon('arrow')}</span></div></a>`)}</div></div></section>`,
  }));
});

router.get('/services/:slug', (ctx) => {
  const s = services.find((x) => x.slug === ctx.params.slug);
  if (!s) throw new HttpError(404, 'That service page does not exist.');
  const modeFor = { 'ocean-freight': 'fcl', 'vehicle-shipping': 'vehicle', 'inland-trucking': 'trucking' }[s.slug] || 'unsure';
  html(ctx.res, layout(ctx, {
    title: `${s.name} to Africa`, description: s.lead,
    jsonLd: { '@context': 'https://schema.org', '@type': 'Service', name: s.name, provider: { '@type': 'Organization', name: company.name }, areaServed: 'Africa', description: s.lead },
    body: h`${pageHero({ kicker: 'Service', title: s.name, lead: s.lead, img: s.img, actions: h`<p class="btn-row"><a class="btn btn--primary btn--lg" href="/quote?mode=${modeFor}">Request a quote</a><a class="btn btn--ghost btn--lg" href="/contact?type=expert">Speak to an expert</a></p>` })}
    <section class="section"><div class="wrap split split--top">
      <div><h2 class="h3">What’s included</h2><ul class="ticks ticks--lg">${s.points.map((p) => h`<li>${p}</li>`)}</ul></div>
      <aside class="panel"><h2 class="h4">Before you request a quote</h2><p>Have these ready for the most accurate quotation:</p>
      <ul class="dots"><li>Pickup ZIP code or origin port</li><li>Destination country and city</li><li>What the cargo is, with weight and dimensions (or vehicle year, make and model)</li><li>When the cargo will be ready</li></ul>
      <a class="btn btn--primary btn--block" href="/quote?mode=${modeFor}">Start your quote</a></aside>
    </div></section>
    <section class="section section--paper"><div class="wrap"><h2 class="h3">Other services</h2><div class="mini-grid">${services.filter((x) => x !== s).map((x) => h`<a class="mini" href="/services/${x.slug}"><strong>${x.name}</strong><span>${x.short}</span></a>`)}</div></div></section>`,
  }));
});

// ——— Destination SEO pages ———
router.get('/shipping-to', (ctx) => {
  html(ctx.res, layout(ctx, {
    title: 'Shipping from the USA to Africa — destinations', description: 'Ship containers, vehicles and cargo from the United States to Senegal, Côte d’Ivoire, Ghana, Nigeria, Guinea, Mali, Togo, Cameroon and other African countries.',
    body: h`${pageHero({ kicker: 'Destinations', title: 'Shipping from the USA to Africa', lead: 'Choose a destination for port information and what to prepare. We also quote shipments to other African countries.', img: 'african_port' })}
    <section class="section"><div class="wrap"><div class="dest-grid">${destinations.map((d) => h`<a class="dest" href="/shipping-to/${d.slug}"><span class="mono">USA →</span><strong>${d.country}</strong><span>${d.ports.join(' · ')}</span></a>`)}</div>
    <p class="center" style="margin-top:2rem"><a class="btn btn--primary" href="/quote">Shipping somewhere else in Africa? Request a quote</a></p></div></section>`,
  }));
});

router.get('/shipping-to/:slug', (ctx) => {
  const d = destinations.find((x) => x.slug === ctx.params.slug);
  if (!d) throw new HttpError(404, 'That destination page does not exist.');
  const q = encodeURIComponent(d.country);
  html(ctx.res, layout(ctx, {
    title: `Shipping from the USA to ${d.country}`,
    description: `Ship containers, vehicles and cargo from the United States to ${d.country} with LANSAR Freight Shipping Corp. Request a written freight quote and track your shipment by reference.`,
    jsonLd: { '@context': 'https://schema.org', '@type': 'Service', name: `Freight shipping from the USA to ${d.country}`, provider: { '@type': 'Organization', name: company.name }, areaServed: d.country },
    body: h`${pageHero({ kicker: `USA → ${d.country}`, title: `Shipping from the USA to ${d.country}`, lead: `Containers, vehicles and commercial cargo from the United States to ${d.country}, quoted by a specialist and tracked under one LANSAR reference.`, img: 'african_port', actions: h`<p class="btn-row"><a class="btn btn--primary btn--lg" href="/quote?dest_country=${q}">Quote a shipment to ${d.country}</a><a class="btn btn--ghost btn--lg" href="/quote?mode=vehicle&dest_country=${q}">Ship a vehicle</a></p>` })}
    <section class="section"><div class="wrap split split--top">
      <div>
        <h2 class="h3">Ports of discharge</h2><ul class="ticks ticks--lg">${d.ports.map((p) => h`<li>${p}</li>`)}</ul>
        <h2 class="h3" style="margin-top:2rem">What we can ship to ${d.country}</h2>
        <div class="mini-grid">${services.map((s) => h`<a class="mini" href="/services/${s.slug}"><strong>${s.name}</strong><span>${s.short}</span></a>`)}</div>
        <h2 class="h3" style="margin-top:2rem">Delivering beyond the port</h2>
        <p>Common delivery cities include ${d.cities.join(', ')}. Ask for destination delivery in your quote request and we’ll confirm what can be arranged for your address.</p>
      </div>
      <aside class="panel"><h2 class="h4">Get an accurate quote for ${d.country}</h2>
        <p>Rates and schedules change with carrier space, cargo type and season, so we quote each shipment individually instead of publishing estimates.</p>
        <a class="btn btn--primary btn--block" href="/quote?dest_country=${q}">Request a quote</a>
        <a class="btn btn--ghost-dark btn--block" href="/contact?type=expert">Ask a ${d.country} shipping question</a></aside>
    </div></section>`,
  }));
});

// ——— Company pages ———
router.get('/about', (ctx) => {
  html(ctx.res, layout(ctx, {
    title: 'About LANSAR', description: `LANSAR Freight Shipping Corp is a freight forwarder headquartered in ${company.city}, established in ${company.established}, specializing in shipments from the United States to Africa.`,
    body: h`${pageHero({ kicker: 'About', title: 'A New York freight forwarder with Africa at the other end', lead: `Founded in ${company.established} and based in ${company.city}, LANSAR Freight Shipping Corp moves cargo, vehicles and containers from the United States to Africa.`, img: 'homepage_hero_port' })}
    <section class="section"><div class="wrap split split--top">
      <div class="prose"><h2 class="h3">What we stand for</h2>
        <p>Shipping to Africa involves many hand-offs: truckers, terminals, ocean carriers, customs on both sides, and the people waiting for the cargo. Our job is to coordinate those hand-offs and tell you the truth about where your shipment stands.</p>
        <p>That is why every LANSAR shipment carries a single reference number, every quote is written by a person, and every tracking milestone is posted only after our team has confirmed it.</p></div>
      <aside class="panel"><h2 class="h4">Company facts</h2><dl class="facts-dl"><dt>Legal name</dt><dd>${company.name}</dd><dt>Established</dt><dd>${company.established}</dd><dt>Headquarters</dt><dd>${company.city}</dd><dt>Telephone</dt><dd><a href="tel:${company.phoneHref}">${company.phone}</a></dd><dt>Focus</dt><dd>U.S. to Africa freight forwarding</dd></dl></aside>
    </div></section>`,
  }));
});

router.get('/privacy', (ctx) => html(ctx.res, layout(ctx, {
  title: 'Privacy notice', body: h`${pageHero({ title: 'Privacy notice' })}<section class="section"><div class="wrap narrow prose">
  <p><em>Draft for legal review before launch.</em></p>
  <h2>What we collect</h2><p>When you request a quote, open a support case, or book a shipment, we collect the contact details, shipment details and documents you provide.</p>
  <h2>How we use it</h2><p>To prepare quotations, arrange and document shipments, provide tracking updates, answer support requests, and meet legal and customs obligations. We do not sell personal information.</p>
  <h2>Documents</h2><p>Uploaded documents are stored privately and accessible only to authorized LANSAR staff and to you through your reference.</p>
  <h2>Contact</h2><p>For privacy questions call ${company.phone} or <a href="/contact">contact us</a>.</p></div></section>`,
})));
router.get('/terms', (ctx) => html(ctx.res, layout(ctx, {
  title: 'Terms of use', body: h`${pageHero({ title: 'Terms of use' })}<section class="section"><div class="wrap narrow prose">
  <p><em>Draft for legal review before launch.</em></p>
  <p>Quotations are provided on request, are valid only for the period stated on the quotation, and are subject to carrier space, equipment availability and the accuracy of the cargo information supplied. Bookings are governed by the terms provided at booking and the applicable carrier bill of lading.</p>
  <p>Tracking information reflects milestones confirmed by LANSAR staff and may not reflect real-time vessel positions.</p></div></section>`,
})));

router.get('/robots.txt', (ctx) => send(ctx.res, 200, config.noindex ? 'User-agent: *\nDisallow: /\n' : `User-agent: *\nDisallow: /ops\nDisallow: /track\nAllow: /\nSitemap: ${company.website}/sitemap.xml\n`, 'text/plain; charset=utf-8'));
router.get('/sitemap.xml', (ctx) => {
  const urls = ['/', '/quote', '/services', ...services.map((s) => `/services/${s.slug}`), '/shipping-to', ...destinations.map((d) => `/shipping-to/${d.slug}`), '/business', '/support', '/contact', '/about'];
  send(ctx.res, 200, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${company.website}${u}</loc></url>`).join('')}</urlset>`, 'application/xml');
});
router.get('/healthz', (ctx) => send(ctx.res, 200, 'ok', 'text/plain'));
void config;
