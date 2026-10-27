import { router } from '../router.js';
import { h, html, str, isEmail, HttpError, fmtDateTime, nowIso, randomToken, esc } from '../lib/core.js';
import { requireStaff, hashPassword, verifyPassword } from '../lib/auth.js';
import { one, all, run } from '../db.js';
import { opsLayout, csrf, staffPost, badge, go } from '../views/ops-layout.js';
import { config } from '../config.js';
import { sendMail, emailLayout, emailButton } from '../lib/mail.js';

// ——— Team management (owner only) ———
router.get('/ops/team', (ctx) => {
  if (!requireStaff(ctx, ['owner'])) return;
  const users = all("SELECT * FROM users WHERE role IN ('owner','staff') ORDER BY active DESC, name");
  html(ctx.res, opsLayout(ctx, {
    title: 'Team', active: 'team',
    body: h`<section class="card"><table class="tbl"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last sign-in</th><th></th></tr></thead><tbody>
      ${users.map((u) => h`<tr><td>${u.name}</td><td>${u.email}</td><td>${u.role}</td><td>${badge(u.active ? 'active' : 'inactive', u.active ? 'Active' : 'Deactivated')}</td><td><small>${u.last_login_at ? fmtDateTime(u.last_login_at) : 'Never'}</small></td>
      <td>${u.id !== ctx.user.id ? h`<form method="post" action="/ops/team/${u.id}/toggle">${csrf(ctx)}<button class="btn btn--sm btn--sec">${u.active ? 'Deactivate' : 'Reactivate'}</button></form>` : ''}</td></tr>`)}
    </tbody></table></section>
    <form class="card form-grid" method="post" action="/ops/team">${csrf(ctx)}<h2 class="span2">Add a team member</h2>
      <label>Name<input name="name" required></label><label>Email<input type="email" name="email" required></label>
      <label>Role<select name="role"><option value="staff">Staff: quotes, shipments, cases</option><option value="owner">Owner: also manages the team</option></select></label><span></span>
      <p class="span2 muted">A temporary password is generated and emailed to the new team member. They should change it after signing in.</p>
      <div class="span2"><button class="btn">Add team member</button></div></form>`,
  }));
});
router.post('/ops/team', async (ctx) => {
  const p = await staffPost(ctx, ['owner']); if (!p) return;
  const email = str(p.f.email).toLowerCase(); const name = str(p.f.name);
  if (!isEmail(email) || !name) throw new HttpError(422, 'Name and a valid email are required.');
  if (one('SELECT 1 FROM users WHERE email=?', email)) throw new HttpError(422, 'A user with that email already exists.');
  const temp = randomToken(9);
  run('INSERT INTO users (email,name,password_hash,role,created_at) VALUES (?,?,?,?,?)', email, name, hashPassword(temp), p.f.role === 'owner' ? 'owner' : 'staff', nowIso());
  sendMail({ to: email, subject: 'Your LANSAR operations account', html: emailLayout('Welcome to LANSAR Operations', `<p>${esc(ctx.user.name)} created an operations account for you.</p><p>Email: <strong>${email}</strong><br>Temporary password: <strong style="font-family:monospace">${temp}</strong></p>${emailButton(`${config.baseUrl}/ops/login`, 'Sign in')}<p>Please change your password under Account after signing in.</p>`) });
  go(ctx, '/ops/team', `Added ${name}. Temporary password: ${temp} (also emailed)`);
});
router.post('/ops/team/:id/toggle', async (ctx) => {
  const p = await staffPost(ctx, ['owner']); if (!p) return;
  const id = Number(ctx.params.id);
  if (id === ctx.user.id) throw new HttpError(422, 'You cannot deactivate yourself.');
  run('UPDATE users SET active=1-active WHERE id=?', id);
  run('DELETE FROM sessions WHERE user_id=?', id);
  go(ctx, '/ops/team', 'Updated');
});

// ——— Own account ———
router.get('/ops/account', (ctx) => {
  if (!requireStaff(ctx)) return;
  html(ctx.res, opsLayout(ctx, {
    title: 'Account', active: '',
    body: h`<form class="card form-grid narrow" method="post" action="/ops/account">${csrf(ctx)}<h2 class="span2">Change password</h2>
      <label class="span2">Current password<input type="password" name="current" required autocomplete="current-password"></label>
      <label class="span2">New password (min. 10 characters)<input type="password" name="next" required minlength="10" autocomplete="new-password"></label>
      <div class="span2"><button class="btn">Update password</button></div></form>`,
  }));
});
router.post('/ops/account', async (ctx) => {
  const p = await staffPost(ctx); if (!p) return;
  const u = one('SELECT * FROM users WHERE id=?', ctx.user.id);
  if (!verifyPassword(str(p.f.current, 200), u.password_hash)) return go(ctx, '/ops/account', 'Current password is incorrect');
  const next = str(p.f.next, 200);
  if (next.length < 10) return go(ctx, '/ops/account', 'New password must be at least 10 characters');
  run('UPDATE users SET password_hash=? WHERE id=?', hashPassword(next), u.id);
  run('DELETE FROM sessions WHERE user_id=? AND id!=?', u.id, ctx.session.sid);
  go(ctx, '/ops/account', 'Password updated');
});

// ——— Email log ———
router.get('/ops/outbox', (ctx) => {
  if (!requireStaff(ctx)) return;
  const id = Number(ctx.query.get('id'));
  if (id) {
    const m = one('SELECT * FROM outbox WHERE id=?', id); if (!m) throw new HttpError(404, 'Not found');
    return html(ctx.res, opsLayout(ctx, { title: m.subject, active: 'outbox', body: h`<p><a href="/ops/outbox">← Email log</a> · To ${m.to_addr} · ${badge(m.status)} ${m.error ? h`<code>${m.error}</code>` : ''}</p><iframe class="mailframe" sandbox srcdoc="${m.html}"></iframe>` }));
  }
  const rows = all('SELECT id,to_addr,subject,status,provider,error,created_at FROM outbox ORDER BY id DESC LIMIT 200');
  html(ctx.res, opsLayout(ctx, {
    title: 'Email log', active: 'outbox',
    body: h`<p class="muted">Every transactional email is recorded here. Provider: <strong>${config.mail.provider}</strong>${config.mail.provider === 'outbox' ? ' (delivery is off: messages are held here until a provider is configured)' : ''}.</p>
    <section class="card">${rows.length ? h`<table class="tbl"><thead><tr><th>When</th><th>To</th><th>Subject</th><th>Status</th></tr></thead><tbody>${rows.map((m) => h`<tr><td><small>${fmtDateTime(m.created_at)}</small></td><td>${m.to_addr}</td><td><a href="?id=${m.id}">${m.subject}</a></td><td>${badge(m.status)}${m.error ? h`<br><small>${m.error}</small>` : ''}</td></tr>`)}</tbody></table>` : h`<p class="empty">No emails yet.</p>`}</section>`,
  }));
});
