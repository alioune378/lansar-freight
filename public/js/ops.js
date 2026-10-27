(() => {
  // Confirmation for destructive / outbound actions
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-confirm]');
    if (b && !window.confirm(b.dataset.confirm)) e.preventDefault();
  });

  // Quote builder: live line totals, margin, add rows
  const qb = document.querySelector('[data-quote-builder]'); if (!qb) return;
  const cur = qb.querySelector('[name=currency]');
  const fmt = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: cur.value || 'USD' }).format(n);
  const body = qb.querySelector('[data-lines]');
  function recalc() {
    let cost = 0, sell = 0;
    body.querySelectorAll('tr').forEach((tr) => {
      const q = Number(tr.querySelector('[name=qty]').value || 0), c = Number(tr.querySelector('[name=unit_cost]').value || 0), s = Number(tr.querySelector('[name=unit_sell]').value || 0);
      const has = tr.querySelector('[name=description]').value.trim();
      tr.querySelector('[data-line-sell]').textContent = has ? fmt(q * s) : '';
      const m = tr.querySelector('[data-line-margin]');
      m.textContent = has && s ? `${Math.round(((s - c) / s) * 100)}%` : '';
      m.classList.toggle('neg', has && s > 0 && s < c);
      if (has) { cost += q * c; sell += q * s; }
    });
    qb.querySelector('[data-total-cost]').textContent = fmt(cost);
    qb.querySelector('[data-total-sell]').textContent = fmt(sell);
    qb.querySelector('[data-total-margin]').textContent = sell ? `${(((sell - cost) / sell) * 100).toFixed(1)}%` : '—';
    qb.querySelector('[data-total-gp]').textContent = fmt(sell - cost);
  }
  qb.addEventListener('input', recalc); cur.addEventListener('change', recalc);
  qb.querySelector('[data-add-line]').addEventListener('click', () => {
    const tr = body.lastElementChild.cloneNode(true);
    tr.querySelectorAll('input').forEach((i) => (i.value = i.name === 'qty' ? '1' : ''));
    tr.querySelectorAll('select').forEach((s) => (s.selectedIndex = 0));
    body.appendChild(tr); tr.querySelector('[name=description]').focus(); recalc();
  });
  recalc();
})();
