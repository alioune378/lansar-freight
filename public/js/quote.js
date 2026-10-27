// Progressive multi-step quote wizard. Without JavaScript the form is one long page that still submits.
(() => {
  const form = document.querySelector('[data-wizard]'); if (!form) return;
  const steps = [...form.querySelectorAll('.qstep')];
  const pills = [...form.querySelectorAll('.qsteps li')];
  const nav = form.querySelector('.qnav');
  const count = form.querySelector('[data-count]');
  let cur = Math.min(Math.max(Number(form.dataset.start) || 1, 1), steps.length) - 1;
  let maxSeen = cur;

  const mode = () => form.querySelector('input[name="mode"]:checked')?.value || '';

  function applyMode() {
    const m = mode();
    form.querySelectorAll('[data-show]').forEach((g) => g.classList.toggle('is-shown', g.dataset.show.split(' ').includes(m)));
    form.querySelectorAll('[data-req]').forEach((el) => { el.required = el.dataset.req.split(' ').includes(m); });
    form.querySelectorAll('[data-hide]').forEach((el) => { el.hidden = el.dataset.hide.split(' ').includes(m); });
  }

  function visibleFields(step) {
    return [...step.querySelectorAll('input, select, textarea')].filter((el) => !el.closest('[data-show]:not(.is-shown)') && el.type !== 'hidden' && !el.closest('.hp'));
  }

  function validateStep(i) {
    let ok = true; let first = null;
    visibleFields(steps[i]).forEach((el) => {
      const fld = el.closest('.fld') || el.closest('.check');
      const valid = el.checkValidity();
      if (fld) fld.classList.toggle('is-invalid', !valid);
      if (!valid && !first) first = el;
      ok = ok && valid;
    });
    if (first) { first.reportValidity(); first.focus({ preventScroll: false }); }
    return ok;
  }

  function show(i, focus = true) {
    cur = i; maxSeen = Math.max(maxSeen, i);
    steps.forEach((s, k) => s.classList.toggle('is-active', k === i));
    pills.forEach((p, k) => { p.classList.toggle('is-current', k === i); p.classList.toggle('is-done', k < i || (k <= maxSeen && k !== i)); });
    nav.classList.toggle('on-first', i === 0);
    nav.classList.toggle('on-last', i === steps.length - 1);
    count.textContent = `Step ${i + 1} of ${steps.length}`;
    if (i === steps.length - 1) buildReview();
    if (focus) { form.scrollIntoView({ behavior: 'smooth', block: 'start' }); steps[i].querySelector('legend')?.setAttribute('tabindex', '-1'); steps[i].querySelector('legend')?.focus({ preventScroll: true }); }
  }

  form.querySelector('[data-next]').addEventListener('click', () => { if (validateStep(cur)) show(cur + 1); });
  form.querySelector('[data-prev]').addEventListener('click', () => show(Math.max(0, cur - 1)));
  pills.forEach((p, k) => p.addEventListener('click', () => { if (k <= maxSeen) show(k); }));
  form.addEventListener('change', (e) => {
    if (e.target.name === 'mode') applyMode();
    const fld = e.target.closest('.is-invalid'); if (fld && e.target.checkValidity()) fld.classList.remove('is-invalid');
  });
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT' && cur < steps.length - 1) { e.preventDefault(); form.querySelector('[data-next]').click(); }
  });
  form.addEventListener('submit', (e) => {
    for (let i = 0; i < steps.length - 1; i++) { if (!validateStep(i)) { e.preventDefault(); show(i); return; } }
    const btn = form.querySelector('[data-submit]'); btn.disabled = true; btn.textContent = 'Submitting…';
  });

  // File list preview
  const fileInput = form.querySelector('input[type=file]'); const fileList = form.querySelector('[data-filelist]');
  fileInput?.addEventListener('change', () => {
    fileList.innerHTML = '';
    [...fileInput.files].forEach((f) => { const li = document.createElement('li'); li.textContent = `📎 ${f.name} (${Math.max(1, Math.round(f.size / 1024))} KB)${f.size > 10485760 ? ' — too large' : ''}`; fileList.appendChild(li); });
  });

  // Review summary
  function val(name) {
    const els = form.querySelectorAll(`[name="${name}"]`);
    if (!els.length) return '';
    const el = els[0];
    if (el.type === 'radio') { const c = form.querySelector(`[name="${name}"]:checked`); return c ? c.closest('label').innerText.split('\n')[0].trim() : ''; }
    if (el.type === 'checkbox') return [...form.querySelectorAll(`[name="${name}"]:checked`)].map((c) => c.closest('label').innerText.trim()).join(', ');
    if (el.tagName === 'SELECT') return el.value ? el.options[el.selectedIndex].text : '';
    return el.value.trim();
  }
  function section(title, step, rows) {
    const s = document.createElement('section');
    const h = document.createElement('h4'); h.textContent = title;
    const b = document.createElement('button'); b.type = 'button'; b.textContent = 'Edit'; b.addEventListener('click', () => show(step)); h.appendChild(b);
    const dl = document.createElement('dl');
    rows.filter(([, v]) => v).forEach(([k, v]) => { const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.textContent = v; dl.append(dt, dd); });
    s.append(h, dl); return s;
  }
  function buildReview() {
    const box = form.querySelector('[data-review]'); box.innerHTML = '';
    const m = mode();
    const from = [val('origin_city'), val('origin_state'), val('origin_zip'), val('origin_country')].filter(Boolean).join(', ');
    const to = [val('dest_city'), val('dest_country')].filter(Boolean).join(', ');
    box.append(section('Route', 0, [['From', from], ['To', to], ['Port preference', val('dest_port')], ['Origin', val('origin_type')], ['Destination', val('dest_type')], ['Ready date', val('ready_date')]]));
    const cargo = [['Shipment type', val('mode')]];
    if (m === 'fcl') cargo.push(['Containers', `${val('container_qty')} × ${val('container_type')}`], ['Weight / container', val('container_weight') && `${val('container_weight')} ${val('container_weight_unit')}`]);
    if (['lcl', 'trucking', 'unsure'].includes(m)) cargo.push(['Pieces', val('pieces') && `${val('pieces')} ${val('packaging')}`], ['Total weight', val('total_weight') && `${val('total_weight')} ${val('weight_unit')}`], ['Dimensions', val('dim_l') && `${val('dim_l')} × ${val('dim_w')} × ${val('dim_h')} ${val('dim_unit')}`], ['Volume', val('total_volume') && `${val('total_volume')} ${val('volume_unit')}`]);
    if (m === 'vehicle') cargo.push(['Vehicle', `${val('veh_year')} ${val('veh_make')} ${val('veh_model')}`], ['VIN', val('veh_vin')], ['Vehicles', val('veh_qty')], ['Condition', val('veh_condition')], ['Method', val('veh_method')], ['Title', val('veh_title')], ['More vehicles', val('veh_more')]);
    cargo.push(['Description', val('commodity')], ['Value', val('cargo_value') && `${val('cargo_value')} ${val('cargo_currency')}`], ['Hazardous', val('hazardous')]);
    box.append(section('Cargo', 1, cargo));
    box.append(section('Services & documents', 2, [['Services', val('services') || 'None selected'], ['Documents', fileInput?.files.length ? `${fileInput.files.length} file(s)` : 'None'], ['Notes', val('notes')]]));
    box.append(section('Contact', 3, [['Name', val('contact_name')], ['Company', val('company')], ['Email', val('email')], ['Phone', val('phone')], ['WhatsApp', val('whatsapp')], ['Preferred contact', val('preferred_contact')], ['Previous reference', val('repeat_of')]]));
  }

  applyMode();
  show(cur, false);
  const err = document.getElementById('qerrors'); if (err) err.focus();
})();
