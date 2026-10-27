(() => {
  // Tabs on the homepage action console
  document.querySelectorAll('[data-tabs]').forEach((box) => {
    const tabs = box.querySelectorAll('[role="tab"]');
    tabs.forEach((t) => t.addEventListener('click', () => {
      tabs.forEach((x) => { x.setAttribute('aria-selected', x === t ? 'true' : 'false'); document.getElementById(x.getAttribute('aria-controls')).hidden = x !== t; });
    }));
  });

  // Close open dropdowns when clicking elsewhere
  document.addEventListener('click', (e) => {
    document.querySelectorAll('details.nav__drop[open], details.burger[open]').forEach((d) => { if (!d.contains(e.target)) d.open = false; });
  });

  // First-touch attribution, carried into quote forms
  try {
    const p = new URLSearchParams(location.search);
    if (p.get('utm_source') && !localStorage.getItem('lansar_attr')) {
      localStorage.setItem('lansar_attr', JSON.stringify({ utm_source: p.get('utm_source'), utm_medium: p.get('utm_medium') || '', utm_campaign: p.get('utm_campaign') || '', landing: location.pathname, referrer: document.referrer }));
    } else if (!localStorage.getItem('lansar_attr') && document.referrer && !document.referrer.includes(location.host)) {
      localStorage.setItem('lansar_attr', JSON.stringify({ landing: location.pathname, referrer: document.referrer }));
    }
    const a = JSON.parse(localStorage.getItem('lansar_attr') || '{}');
    Object.entries(a).forEach(([k, v]) => document.querySelectorAll(`input[type=hidden][name="${k}"]`).forEach((i) => { if (!i.value) i.value = v || ''; }));
  } catch (_) { /* storage unavailable */ }

  // Conversion events on key CTAs
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-evt]'); if (!el) return;
    const name = el.dataset.evt;
    if (window.gtag) gtag('event', name);
    if (window.plausible) plausible(name);
  });

  // Click reference box to copy
  document.querySelectorAll('[data-copy]').forEach((el) => el.addEventListener('click', () => {
    navigator.clipboard?.writeText(el.textContent.trim()).then(() => { const t = el.textContent; el.textContent = 'Copied ✓'; setTimeout(() => (el.textContent = t), 1200); });
  }));
})();
