import { h, raw } from '../lib/core.js';
import { config, company, services, destinations } from '../config.js';

const FONTS = 'https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@100..125,500..800&family=IBM+Plex+Mono:wght@500;600&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;1,400&display=swap';

function analytics() {
  const out = [];
  if (config.analytics.ga4) {
    out.push(`<script async src="https://www.googletagmanager.com/gtag/js?id=${config.analytics.ga4}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${config.analytics.ga4}');</script>`);
  }
  if (config.analytics.plausibleDomain) out.push(`<script defer data-domain="${config.analytics.plausibleDomain}" src="https://plausible.io/js/script.js"></script>`);
  return raw(out.join('\n'));
}

const icon = (name) => raw({
  phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 10.8a15.5 15.5 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.6a1 1 0 0 1-.25 1z" fill="currentColor"/></svg>',
  chat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3z" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
}[name]);
export { icon };

export function layout(ctx, { title, description, body, canonical, noindex = false, bodyClass = '', ogImage = '/img/hero-sm.webp', jsonLd = null }) {
  const fullTitle = title ? `${title} | ${company.name}` : `${company.name} — U.S. to Africa Freight Forwarding`;
  const desc = description || 'LANSAR Freight Shipping Corp is a Bronx, New York freight forwarder shipping containers, vehicles and cargo from the United States to Africa since 2015. Request a freight quote or track your shipment.';
  const path = canonical ?? ctx.url.pathname;
  const org = {
    '@context': 'https://schema.org', '@type': 'Organization', name: company.name, url: company.website,
    logo: `${company.website}/brand/icon.png`, telephone: company.phone, foundingDate: String(company.established),
    address: { '@type': 'PostalAddress', addressLocality: 'Bronx', addressRegion: 'NY', addressCountry: 'US' },
  };
  return h`<!doctype html>
<html lang="en" class="no-js">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${fullTitle}</title>
<meta name="description" content="${desc}">
${noindex || config.noindex ? raw('<meta name="robots" content="noindex">') : ''}
<link rel="canonical" href="${company.website}${path}">
<meta property="og:type" content="website"><meta property="og:title" content="${fullTitle}"><meta property="og:description" content="${desc}">
<meta property="og:image" content="${company.website}${ogImage}"><meta property="og:url" content="${company.website}${path}">
<meta name="theme-color" content="#0b2340">
<link rel="icon" href="/favicon.ico"><link rel="apple-touch-icon" href="/brand/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<link rel="stylesheet" href="/css/site.css?v=1">
<script>document.documentElement.classList.replace('no-js','js')</script>
<script type="application/ld+json">${raw(JSON.stringify(jsonLd ? [org, jsonLd] : org).replace(/</g, '\\u003c'))}</script>
${analytics()}
</head>
<body class="${bodyClass}">
<a class="skip" href="#main">Skip to content</a>
${header(ctx)}
<main id="main">${body}</main>
${footer()}
<script src="/js/site.js?v=1" defer></script>
</body></html>`;
}

function header(ctx) {
  const p = ctx.url.pathname;
  const cur = (pre) => (p === pre || (pre !== '/' && p.startsWith(pre)) ? raw(' aria-current="page"') : '');
  return h`
<div class="utility"><div class="wrap utility__in">
  <span>U.S. → Africa freight forwarding · Since ${company.established} · ${company.city}</span>
  <span class="utility__links"><a href="tel:${company.phoneHref}">${icon('phone')} ${company.phone}</a><a href="${company.whatsappHref}" rel="noopener" target="_blank">${icon('chat')} WhatsApp</a></span>
</div></div>
<header class="hdr"><div class="wrap hdr__in">
  <a class="hdr__logo" href="/" aria-label="LANSAR Freight Shipping Corp — home"><img src="/brand/logo.png" alt="LANSAR Freight Shipping Corp" width="190" height="56"></a>
  <nav class="nav" aria-label="Main">
    <details class="nav__drop"><summary${cur('/services')}>Services</summary>
      <div class="nav__menu">${services.map((s) => h`<a href="/services/${s.slug}"><strong>${s.name}</strong><span>${s.short}</span></a>`)}<a href="/services" class="nav__all">All services →</a></div>
    </details>
    <details class="nav__drop"><summary${cur('/shipping-to')}>Destinations</summary>
      <div class="nav__menu nav__menu--cols">${destinations.map((d) => h`<a href="/shipping-to/${d.slug}"><strong>${d.country}</strong></a>`)}<a href="/shipping-to" class="nav__all">All destinations →</a></div>
    </details>
    <a href="/business"${cur('/business')}>Business accounts</a>
    <a href="/support"${cur('/support')}>Support</a>
    <a href="/track"${cur('/track')}>Track</a>
  </nav>
  <div class="hdr__cta">
    <a class="btn btn--primary" href="/quote">Get a quote</a>
  </div>
  <details class="burger"><summary aria-label="Open menu"><span></span><span></span><span></span></summary>
    <div class="burger__panel">
      <a href="/quote" class="btn btn--primary btn--block">Request a freight quote</a>
      <a href="/track" class="btn btn--ghost-dark btn--block">Track your shipment</a>
      <p class="burger__h">Services</p>${services.map((s) => h`<a href="/services/${s.slug}">${s.name}</a>`)}
      <p class="burger__h">Company</p>
      <a href="/shipping-to">Destinations</a><a href="/business">Business accounts</a><a href="/support">Customer support</a><a href="/about">About LANSAR</a><a href="/contact">Contact</a>
      <a class="burger__phone" href="tel:${company.phoneHref}">${icon('phone')} ${company.phone}</a>
    </div>
  </details>
</div></header>`;
}

function footer() {
  return h`
<footer class="ftr"><div class="wrap">
  <div class="ftr__grid">
    <div class="ftr__brand">
      <img src="/brand/logo-white.png" alt="LANSAR Freight Shipping Corp" width="230" height="46" loading="lazy">
      <p>Freight forwarding from the United States to Africa. Ocean freight, vehicle shipping, inland trucking and documentation, handled from ${company.city} since ${company.established}.</p>
      <a class="ftr__phone" href="tel:${company.phoneHref}">${company.phone}</a>
    </div>
    <div><h3>Ship</h3><a href="/quote">Request a quote</a><a href="/track">Track a shipment</a><a href="/quote?repeat=1">Repeat a shipment</a><a href="/business">Business accounts</a></div>
    <div><h3>Services</h3>${services.map((s) => h`<a href="/services/${s.slug}">${s.name}</a>`)}</div>
    <div><h3>Destinations</h3>${destinations.slice(0, 6).map((d) => h`<a href="/shipping-to/${d.slug}">${d.country}</a>`)}<a href="/shipping-to">All destinations</a></div>
    <div><h3>Company</h3><a href="/about">About</a><a href="/support">Customer support</a><a href="/contact">Contact</a><a href="/privacy">Privacy</a><a href="/terms">Terms of use</a></div>
  </div>
  <div class="ftr__base"><span>© ${new Date().getFullYear()} ${company.name}. All rights reserved.</span><span>${company.city}, United States</span></div>
</div></footer>`;
}

export function pageHero({ kicker, title, lead, img, actions = '' }) {
  return h`<section class="phero${img ? ' phero--img' : ''}">${img ? h`<img class="phero__bg" src="/img/${img}.webp" alt="" aria-hidden="true">` : ''}
  <div class="wrap phero__in">${kicker ? h`<p class="kicker kicker--light">${kicker}</p>` : ''}<h1>${title}</h1>${lead ? h`<p class="phero__lead">${lead}</p>` : ''}${actions}</div></section>`;
}

export function errorPage(status, message, ctx) {
  const titles = { 404: 'We couldn’t find that page', 403: 'Access denied', 413: 'Upload too large', 429: 'Too many attempts' };
  return layout(ctx, {
    title: titles[status] || 'Something went wrong', noindex: true,
    body: h`<section class="section"><div class="wrap narrow center">
      <p class="mono muted">Error ${status}</p><h1 class="h2">${titles[status] || 'Something went wrong'}</h1><p class="lead">${message}</p>
      <p class="btn-row center"><a class="btn btn--primary" href="/">Go to homepage</a><a class="btn btn--ghost-dark" href="/support">Customer support</a></p>
    </div></section>`,
  });
}
