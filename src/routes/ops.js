import { router } from '../router.js';
import { h, raw, html, redirect, parseForm, str, rateLimit, clientIp, HttpError, fmtDate, fmtDateTime, fmtMoney, nowIso } from '../lib/core.js';
import { verifyPassword, createSession, destroySession, requireStaff } from '../lib/auth.js';
import { one, all, run, logActivity } from '../db.js';
import { opsLayout, csrf, staffPost, badge, userOptions, go } from '../views/ops-layout.js';
import { quoteStatuses, shipmentStatuses, caseStatuses, caseTypes, shippingModes } from '../config.js';
import { streamFile } from '../lib/files.js';

export const staffUsers = () => all("SELECT id, name FROM users WHERE role IN ('owner','staff') AND active=1 ORDER BY name");

// ——— Authentication ———
function loginPage(ctx, error = '', email = '') {
  return h`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign in · LANSAR Operations</title><meta name="robots" content="noindex">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&display=swap"><link rel="stylesheet" href="/css/ops.css?v=1"></head>
<body class="login"><form class="login__card" method="post" action="/ops/login">
  <img src="/brand/logo.png" alt="LANSAR Freight Shipping Corp" width="220"><h1>Operations sign in</h1>
  ${error ? h`<p class="alert">${error}</p>` : ''}
  <input type="hidden" name="next" value="${ctx.query.get('next') || '/ops'}">
  <label>Email<input type="email" name="email" required autocomplete="username" value="${email}"></label>
  <label>Password<input type="password" name="password" required autocomplete="current-password"></label>
  <button>Sign in</button><p class="muted"><a href="/">← Back to lansarfs.com</a></p>
</form></body></html>`;
}

router.get('/ops/login', (ctx) => (ctx.user && ctx.user.role !== 'customer' ? redirect(ctx.res, '/ops') : html(ctx.res, loginPage(ctx))));
router.post('/ops/login', async (ctx) => {
  const { fields } = await parseForm(ctx.req);
  const email = str(fields.email).toLowerCase();
  if (!rateLimit(`login:${clientIp(ctx.req)}`, 10, 900_000) || !rateLimit(`login:${email}`, 10, 900_000)) return html(ctx.res, loginPage(ctx, 'Too many attempts. Try again in 15 minutes.', email), 429);
  const u = one("SELECT * FROM users WHERE email=? AND active=1 AND role IN ('owner','staff')", email);
  if (!u || !verifyPassword(str(fields.password, 200), u.password_hash)) return html(ctx.res, loginPage(ctx, 'Email or password is incorrect.', email), 401);
  createSession(ctx.res, u, ctx.req);
  const next = str(fields.next);
  redirect(ctx.res, next.startsWith('/ops') ? next : '/ops');
});
router.post('/ops/logout', async (ctx) => { await parseForm(ctx.req); destroySession(ctx.res, ctx); redirect(ctx.res, '/ops/login'); });

// ——— Dashboard ———
router.get('/ops', (ctx) => {
  if (!requireStaff(ctx)) return;
  const since = (d) => new Date(Date.now() - d * 864e5).toISOString();
  const k = {
    new7: one('SELECT COUNT(*) n FROM quotes WHERE created_at>=?', since(7)).n,
    new30: one('SELECT COUNT(*) n FROM quotes WHERE created_at>=?', since(30)).n,
    open: one("SELECT COUNT(*) n FROM quotes WHERE status IN ('new','reviewing','quoted','negotiating')").n,
    pipeline: one("SELECT COALESCE(SUM(quoted_total),0) v FROM quotes WHERE status IN ('quoted','negotiating')").v,
    won90: one("SELECT COUNT(*) n FROM quotes WHERE status='won' AND updated_at>=?", since(90)).n,
    closed90: one("SELECT COUNT(*) n FROM quotes WHERE status IN ('won','lost') AND updated_at>=?", since(90)).n,
    active: one("SELECT COUNT(*) n FROM shipments WHERE status NOT IN ('delivered','cancelled')").n,
    cases: one("SELECT COUNT(*) n FROM cases WHERE status IN ('open','escalated','in_progress')").n,
    escalated: one("SELECT COUNT(*) n FROM cases WHERE status='escalated'").n,
  };
  const stages = all("SELECT status, COUNT(*) n FROM quotes WHERE status NOT IN ('spam') GROUP BY status");
  const st = Object.fromEntries(stages.map((s) => [s.status, s.n]));
  const recent = all('SELECT q.*, u.name assignee FROM quotes q LEFT JOIN users u ON u.id=q.assigned_to ORDER BY q.id DESC LIMIT 8');
  const myTasks = all("SELECT * FROM tasks WHERE status='open' AND (assigned_to=? OR assigned_to IS NULL) ORDER BY COALESCE(due_date,'9999') LIMIT 8", ctx.user.id);
  const needCases = all("SELECT * FROM cases WHERE status IN ('open','escalated') ORDER BY CASE priority WHEN 'high' THEN 0 ELSE 1 END, id DESC LIMIT 6");
  const winRate = k.closed90 ? Math.round((k.won90 / k.closed90) * 100) : null;
  html(ctx.res, opsLayout(ctx, {
    title: 'Dashboard', active: 'dashboard', actions: h`<a class="btn" href="/ops/quotes/new">+ New quote</a>`,
    body: h`
    <div class="kpis">
      <div class="kpi"><span>New quote requests</span><strong>${k.new7}</strong><small>last 7 days · ${k.new30} in 30 days</small></div>
      <div class="kpi"><span>Open quotes</span><strong>${k.open}</strong><small>new, reviewing, sent, negotiating</small></div>
      <div class="kpi"><span>Quoted pipeline</span><strong>${fmtMoney(k.pipeline)}</strong><small>sell value of sent quotes</small></div>
      <div class="kpi"><span>Win rate</span><strong>${winRate === null ? '—' : `${winRate}%`}</strong><small>closed quotes, last 90 days</small></div>
      <div class="kpi"><span>Active shipments</span><strong>${k.active}</strong><small>not delivered or cancelled</small></div>
      <div class="kpi${k.escalated ? ' kpi--alert' : ''}"><span>Open service cases</span><strong>${k.cases}</strong><small>${k.escalated} escalated</small></div>
    </div>
    <section class="card"><h2>Lead pipeline</h2><div class="pipe">${['new', 'reviewing', 'quoted', 'negotiating', 'won', 'lost'].map((s) => h`<a class="pipe__s pipe__s--${s}" href="/ops/quotes?status=${s}"><strong>${st[s] || 0}</strong><span>${quoteStatuses[s]}</span></a>`)}</div></section>
    <div class="cols">
      <section class="card"><h2>Latest quote requests <a href="/ops/quotes">All →</a></h2>
        ${recent.length ? h`<table class="tbl"><thead><tr><th>Ref</th><th>Customer</th><th>Lane</th><th>Status</th><th>Received</th></tr></thead><tbody>${recent.map((q) => h`<tr><td><a class="mono" href="/ops/quotes/${q.id}">${q.ref}</a></td><td>${q.contact_name}${q.company ? h`<br><small>${q.company}</small>` : ''}</td><td>${shippingModes[q.mode]?.replace('Ocean — ', '')}<br><small>→ ${q.dest_country}</small></td><td>${badge(q.status, quoteStatuses[q.status])}</td><td><small>${fmtDateTime(q.created_at)}</small></td></tr>`)}</tbody></table>` : h`<p class="empty">No quote requests yet. They’ll appear here as soon as someone submits the website form.</p>`}
      </section>
      <div>
        <section class="card"><h2>Cases needing a response <a href="/ops/cases">All →</a></h2>
          ${needCases.length ? h`<ul class="list">${needCases.map((c) => h`<li><a href="/ops/cases/${c.id}"><span class="mono">${c.ref}</span> ${c.subject}</a>${badge(c.status, caseStatuses[c.status])}</li>`)}</ul>` : h`<p class="empty">No open cases.</p>`}</section>
        <section class="card"><h2>My tasks <a href="/ops/tasks">All →</a></h2>
          ${myTasks.length ? h`<ul class="list">${myTasks.map((t) => h`<li><span>${t.title}</span><small>${t.due_date ? `Due ${fmtDate(t.due_date)}` : ''}</small></li>`)}</ul>` : h`<p class="empty">Nothing assigned.</p>`}</section>
      </div>
    </div>`,
  }));
});

// ——— Customers ———
router.get('/ops/customers', (ctx) => {
  if (!requireStaff(ctx)) return;
  const q = str(ctx.query.get('q'));
  const like = `%${q}%`;
  const rows = all(`SELECT c.*, (SELECT COUNT(*) FROM quotes WHERE customer_id=c.id) nq, (SELECT COUNT(*) FROM shipments WHERE customer_id=c.id) ns
    FROM customers c WHERE (?='' OR c.name LIKE ? OR c.email LIKE ? OR c.company LIKE ? OR c.phone LIKE ?) ORDER BY c.updated_at DESC LIMIT 200`, q, like, like, like, like);
  html(ctx.res, opsLayout(ctx, {
    title: 'Customers', active: 'customers',
    body: h`<form class="filters"><input name="q" value="${q}" placeholder="Search name, email, company, phone"><button class="btn btn--sec">Search</button></form>
    <section class="card">${rows.length ? h`<table class="tbl"><thead><tr><th>Name</th><th>Company</th><th>Email</th><th>Phone</th><th>Quotes</th><th>Shipments</th><th>Type</th></tr></thead><tbody>
    ${rows.map((c) => h`<tr><td><a href="/ops/customers/${c.id}">${c.name}</a></td><td>${c.company || '—'}</td><td>${c.email}</td><td>${c.phone || '—'}</td><td>${c.nq}</td><td>${c.ns}</td><td>${c.kind || '—'}</td></tr>`)}</tbody></table>` : h`<p class="empty">No customers yet.</p>`}</section>`,
  }));
});
router.get('/ops/customers/:id', (ctx) => {
  if (!requireStaff(ctx)) return;
  const c = one('SELECT * FROM customers WHERE id=?', Number(ctx.params.id));
  if (!c) throw new HttpError(404, 'Customer not found');
  const quotes = all('SELECT * FROM quotes WHERE customer_id=? ORDER BY id DESC', c.id);
  const ships = all('SELECT * FROM shipments WHERE customer_id=? ORDER BY id DESC', c.id);
  const cases = all('SELECT * FROM cases WHERE customer_id=? ORDER BY id DESC', c.id);
  html(ctx.res, opsLayout(ctx, {
    title: c.name, active: 'customers',
    body: h`<div class="cols cols--side"><div>
      <section class="card"><h2>Quotes (${quotes.length})</h2>${quotes.length ? h`<table class="tbl"><tbody>${quotes.map((q) => h`<tr><td><a class="mono" href="/ops/quotes/${q.id}">${q.ref}</a></td><td>${shippingModes[q.mode]}</td><td>→ ${q.dest_country}</td><td>${badge(q.status, quoteStatuses[q.status])}</td><td>${fmtMoney(q.quoted_total)}</td><td><small>${fmtDate(q.created_at)}</small></td></tr>`)}</tbody></table>` : h`<p class="empty">None</p>`}</section>
      <section class="card"><h2>Shipments (${ships.length})</h2>${ships.length ? h`<table class="tbl"><tbody>${ships.map((s) => h`<tr><td><a class="mono" href="/ops/shipments/${s.id}">${s.ref}</a></td><td>${s.origin} → ${s.destination}</td><td>${badge(s.status, shipmentStatuses[s.status])}</td></tr>`)}</tbody></table>` : h`<p class="empty">None</p>`}</section>
      <section class="card"><h2>Service cases (${cases.length})</h2>${cases.length ? h`<table class="tbl"><tbody>${cases.map((x) => h`<tr><td><a class="mono" href="/ops/cases/${x.id}">${x.ref}</a></td><td>${x.subject}</td><td>${badge(x.status, caseStatuses[x.status])}</td></tr>`)}</tbody></table>` : h`<p class="empty">None</p>`}</section>
    </div><div>
      <section class="card"><h2>Contact</h2><dl class="dl"><dt>Email</dt><dd><a href="mailto:${c.email}">${c.email}</a></dd><dt>Phone</dt><dd>${c.phone || '—'}</dd><dt>WhatsApp</dt><dd>${c.whatsapp || '—'}</dd><dt>Company</dt><dd>${c.company || '—'}</dd><dt>Type</dt><dd>${c.kind || '—'}</dd><dt>Since</dt><dd>${fmtDate(c.created_at)}</dd></dl></section>
      <form class="card" method="post" action="/ops/customers/${c.id}">${csrf(ctx)}<h2>Internal notes</h2><textarea name="notes" rows="6">${c.notes || ''}</textarea><button class="btn">Save notes</button></form>
    </div></div>`,
  }));
});
router.post('/ops/customers/:id', async (ctx) => {
  const p = await staffPost(ctx); if (!p) return;
  run('UPDATE customers SET notes=?, updated_at=? WHERE id=?', str(p.f.notes, 5000), nowIso(), Number(ctx.params.id));
  go(ctx, `/ops/customers/${ctx.params.id}`, 'Notes saved');
});

// ——— Tasks ———
router.get('/ops/tasks', (ctx) => {
  if (!requireStaff(ctx)) return;
  const show = ctx.query.get('show') || 'open';
  const rows = all(`SELECT t.*, u.name assignee FROM tasks t LEFT JOIN users u ON u.id=t.assigned_to WHERE t.status=? ORDER BY COALESCE(t.due_date,'9999'), t.id DESC`, show === 'done' ? 'done' : 'open');
  const link = (t) => (t.entity_type ? h` <a class="mono small" href="/ops/${t.entity_type}s/${t.entity_id}">${t.entity_type} #${t.entity_id}</a>` : '');
  html(ctx.res, opsLayout(ctx, {
    title: 'Tasks', active: 'tasks',
    body: h`<form class="card inline-form" method="post" action="/ops/tasks">${csrf(ctx)}
      <input name="title" required placeholder="New task, e.g. Call customer about title documents" class="grow">
      <select name="assigned_to">${userOptions(staffUsers(), ctx.user.id)}</select><input type="date" name="due_date"><button class="btn">Add task</button></form>
    <nav class="tabs"><a href="?show=open"${show !== 'done' ? raw(' aria-current="page"') : ''}>Open</a><a href="?show=done"${show === 'done' ? raw(' aria-current="page"') : ''}>Completed</a></nav>
    <section class="card">${rows.length ? h`<table class="tbl"><thead><tr><th>Task</th><th>Assigned</th><th>Due</th><th></th></tr></thead><tbody>${rows.map((t) => h`<tr class="${t.due_date && t.due_date < nowIso().slice(0, 10) && t.status === 'open' ? 'overdue' : ''}"><td>${t.title}${link(t)}</td><td>${t.assignee || 'Unassigned'}</td><td>${t.due_date ? fmtDate(t.due_date) : '—'}</td><td>${t.status === 'open' ? h`<form method="post" action="/ops/tasks/${t.id}/done">${csrf(ctx)}<button class="btn btn--sm btn--sec">Mark done</button></form>` : h`<small>${fmtDate(t.done_at)}</small>`}</td></tr>`)}</tbody></table>` : h`<p class="empty">No ${show === 'done' ? 'completed' : 'open'} tasks.</p>`}</section>`,
  }));
});
router.post('/ops/tasks', async (ctx) => {
  const p = await staffPost(ctx); if (!p) return;
  const f = p.f;
  const et = ['quote', 'shipment', 'case'].includes(f.entity_type) ? f.entity_type : null;
  run('INSERT INTO tasks (title, entity_type, entity_id, assigned_to, due_date, created_by, created_at) VALUES (?,?,?,?,?,?,?)',
    str(f.title), et, et ? Number(f.entity_id) : null, Number(f.assigned_to) || null, str(f.due_date) || null, ctx.user.id, nowIso());
  if (et) logActivity(et, Number(f.entity_id), ctx.user.id, 'task_added', str(f.title));
  go(ctx, str(f.back) || '/ops/tasks', 'Task added');
});
router.post('/ops/tasks/:id/done', async (ctx) => {
  const p = await staffPost(ctx); if (!p) return;
  run("UPDATE tasks SET status='done', done_at=? WHERE id=?", nowIso(), Number(ctx.params.id));
  go(ctx, str(p.f.back) || '/ops/tasks', 'Task completed');
});

// ——— Reports ———
router.get('/ops/reports', (ctx) => {
  if (!requireStaff(ctx)) return;
  const months = all("SELECT substr(created_at,1,7) m, COUNT(*) n, SUM(status='won') won FROM quotes GROUP BY m ORDER BY m DESC LIMIT 12").reverse();
  const byMode = all('SELECT mode, COUNT(*) n, SUM(status=\'won\') won FROM quotes GROUP BY mode ORDER BY n DESC');
  const byDest = all('SELECT dest_country, COUNT(*) n, SUM(status=\'won\') won FROM quotes GROUP BY dest_country ORDER BY n DESC LIMIT 12');
  const margin = one(`SELECT COALESCE(SUM(l.qty*l.unit_sell),0) sell, COALESCE(SUM(l.qty*l.unit_cost),0) cost FROM quote_lines l JOIN quotes q ON q.id=l.quote_id WHERE q.status='won'`);
  const sources = all("SELECT COALESCE(NULLIF(json_extract(utm_json,'$.source'),''), CASE WHEN source IS NULL OR source='' THEN 'Direct / unknown' ELSE source END) src, COUNT(*) n FROM quotes GROUP BY src ORDER BY n DESC LIMIT 10");
  const events = all("SELECT name, COUNT(*) n FROM events WHERE created_at>=? GROUP BY name", new Date(Date.now() - 30 * 864e5).toISOString());
  const max = Math.max(1, ...months.map((m) => m.n));
  const bars = (rows, label, maxv = Math.max(1, ...rows.map((r) => r.n))) => h`<table class="tbl bars"><thead><tr><th>${label}</th><th>Requests</th><th>Won</th><th class="w50"></th></tr></thead><tbody>${rows.map((r) => h`<tr><td>${r.k}</td><td>${r.n}</td><td>${r.won || 0}</td><td><span class="bar" style="--w:${Math.round((r.n / maxv) * 100)}%"><i style="--w:${r.n ? Math.round(((r.won || 0) / r.n) * 100) : 0}%"></i></span></td></tr>`)}</tbody></table>`;
  html(ctx.res, opsLayout(ctx, {
    title: 'Reports', active: 'reports',
    body: h`<div class="kpis">
      <div class="kpi"><span>Won revenue (sell)</span><strong>${fmtMoney(margin.sell)}</strong><small>from quote lines on won quotes</small></div>
      <div class="kpi"><span>Gross margin</span><strong>${fmtMoney(margin.sell - margin.cost)}</strong><small>${margin.sell ? Math.round(((margin.sell - margin.cost) / margin.sell) * 100) : 0}% of sell</small></div>
      ${events.map((e) => h`<div class="kpi"><span>${e.name.replace(/_/g, ' ')}</span><strong>${e.n}</strong><small>last 30 days</small></div>`)}
    </div>
    <section class="card"><h2>Quote requests by month</h2>${months.length ? h`<div class="vbars">${months.map((m) => h`<div class="vbar"><span style="--h:${Math.round((m.n / max) * 100)}%"><i style="--h:${m.n ? Math.round(((m.won || 0) / m.n) * 100) : 0}%"></i></span><b>${m.n}</b><small>${m.m}</small></div>`)}</div><p class="legend"><i class="lg1"></i> Requests <i class="lg2"></i> Won</p>` : h`<p class="empty">No data yet.</p>`}</section>
    <div class="cols cols--even">
      <section class="card"><h2>By shipment type</h2>${bars(byMode.map((r) => ({ ...r, k: shippingModes[r.mode] })), 'Type')}</section>
      <section class="card"><h2>By destination</h2>${bars(byDest.map((r) => ({ ...r, k: r.dest_country })), 'Country')}</section>
    </div>
    <section class="card"><h2>Lead sources</h2>${bars(sources.map((r) => ({ ...r, k: r.src })), 'Source')}</section>`,
  }));
});

// ——— Authenticated file download ———
router.get('/ops/files/:id', (ctx) => {
  if (!requireStaff(ctx)) return;
  if (!streamFile(ctx.res, Number(ctx.params.id), { inline: ctx.query.get('view') === '1' })) throw new HttpError(404, 'File not found');
});
router.post('/ops/files/:id/visibility', async (ctx) => {
  const p = await staffPost(ctx); if (!p) return;
  run('UPDATE files SET customer_visible=? WHERE id=?', p.f.visible === '1' ? 1 : 0, Number(ctx.params.id));
  go(ctx, str(p.f.back) || '/ops', 'Document visibility updated');
});

void caseTypes; void fmtDateTime;
