import { h, raw, parseForm } from '../lib/core.js';
import { requireStaff, checkCsrf } from '../lib/auth.js';
import { one } from '../db.js';

export const csrf = (ctx) => h`<input type="hidden" name="_csrf" value="${ctx.session?.csrf || ''}">`;

/** Parse + authorize + CSRF-check a staff form post. Returns null if redirected to login. */
export async function staffPost(ctx, roles) {
  if (!requireStaff(ctx, roles)) return null;
  const { fields, files } = await parseForm(ctx.req);
  checkCsrf(ctx, fields);
  return { f: fields, files };
}

const NAV = [
  ['dashboard', '/ops', 'Dashboard'],
  ['quotes', '/ops/quotes', 'Quotes & leads'],
  ['shipments', '/ops/shipments', 'Shipments'],
  ['cases', '/ops/cases', 'Service cases'],
  ['customers', '/ops/customers', 'Customers'],
  ['tasks', '/ops/tasks', 'Tasks'],
  ['reports', '/ops/reports', 'Reports'],
  ['outbox', '/ops/outbox', 'Email log'],
  ['team', '/ops/team', 'Team', 'owner'],
];

export function opsLayout(ctx, { title, docTitle, active, body, actions = '' }) {
  const u = ctx.user;
  const counts = {
    quotes: one("SELECT COUNT(*) n FROM quotes WHERE status='new'").n,
    cases: one("SELECT COUNT(*) n FROM cases WHERE status IN ('open','escalated')").n,
    tasks: u ? one("SELECT COUNT(*) n FROM tasks WHERE status='open' AND assigned_to=?", u.id).n : 0,
  };
  const msg = ctx.query.get('msg');
  return h`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${docTitle || title} · LANSAR Operations</title><meta name="robots" content="noindex">
<link rel="icon" href="/favicon.ico">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="/css/ops.css?v=1"></head>
<body class="ops">
<aside class="side">
  <a class="side__logo" href="/ops"><img src="/brand/logo-white.png" alt="LANSAR"><span>Operations</span></a>
  <nav>${NAV.filter((n) => !n[3] || u?.role === n[3]).map(([k, href, label]) => h`<a href="${href}"${k === active ? raw(' aria-current="page"') : ''}>${label}${counts[k] ? h`<b>${counts[k]}</b>` : ''}</a>`)}</nav>
  <div class="side__foot"><a href="/" target="_blank">View website ↗</a></div>
</aside>
<div class="main">
  <header class="top"><h1>${title}</h1><div class="top__r">${actions}<span class="top__user">${u?.name} · ${u?.role}</span><a href="/ops/account">Account</a>
    <form method="post" action="/ops/logout">${csrf(ctx)}<button class="linkbtn">Sign out</button></form></div></header>
  ${msg ? h`<div class="flash" role="status">${msg}</div>` : ''}
  <div class="content">${body}</div>
</div>
<script src="/js/ops.js?v=1" defer></script>
</body></html>`;
}

export const badge = (status, label) => h`<span class="badge badge--${status}">${label || status}</span>`;
export const userOptions = (users, cur) => h`<option value="">Unassigned</option>${users.map((x) => h`<option value="${x.id}"${String(cur) === String(x.id) ? raw(' selected') : ''}>${x.name}</option>`)}`;
export const optionList = (obj, cur) => Object.entries(obj).map(([k, v]) => h`<option value="${k}"${String(cur) === k ? raw(' selected') : ''}>${v}</option>`);
export const go = (ctx, path, msg) => {
  if (!/^\/ops(\/|$|\?)/.test(path)) path = '/ops'; ctx.res.writeHead(303, { Location: `${path}${msg ? `${path.includes('?') ? '&' : '?'}msg=${encodeURIComponent(msg)}` : ''}` }); ctx.res.end(); };
