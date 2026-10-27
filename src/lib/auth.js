// Password hashing (scrypt), database-backed sessions, CSRF, and role checks.
import crypto from 'node:crypto';
import { one, run } from '../db.js';
import { randomToken, sha256, setCookie, safeEqual, redirect, HttpError } from './core.js';

const COOKIE = 'lansar_sid';
const SESSION_DAYS = 14;

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}
export function verifyPassword(pw, stored) {
  const [alg, salt, key] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const test = crypto.scryptSync(pw, Buffer.from(salt, 'base64'), 64, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(test, Buffer.from(key, 'base64'));
}

export function createSession(res, user, req) {
  const token = randomToken();
  const now = new Date();
  const exp = new Date(now.getTime() + SESSION_DAYS * 864e5);
  run('INSERT INTO sessions (id,user_id,csrf,expires_at,created_at,ip,ua) VALUES (?,?,?,?,?,?,?)',
    sha256(token), user.id, randomToken(24), exp.toISOString(), now.toISOString(), req.socket.remoteAddress || '', String(req.headers['user-agent'] || '').slice(0, 200));
  run('UPDATE users SET last_login_at=? WHERE id=?', now.toISOString(), user.id);
  setCookie(res, COOKIE, token, { maxAge: SESSION_DAYS * 86400 });
}

export function loadSession(cookies) {
  const token = cookies[COOKIE];
  if (!token) return null;
  const s = one(`SELECT s.id sid, s.csrf, s.expires_at, u.id, u.email, u.name, u.role, u.active
                 FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`, sha256(token));
  if (!s || !s.active || new Date(s.expires_at) < new Date()) return null;
  return { user: { id: s.id, email: s.email, name: s.name, role: s.role }, csrf: s.csrf, sid: s.sid };
}

export function destroySession(res, ctx) {
  if (ctx.session) run('DELETE FROM sessions WHERE id=?', ctx.session.sid);
  setCookie(res, COOKIE, '', { maxAge: 0 });
}

/** Guard for staff-only routes. Returns false (and responds) if not allowed. */
export function requireStaff(ctx, roles = ['owner', 'staff']) {
  if (!ctx.user || !roles.includes(ctx.user.role)) {
    if (ctx.user) throw new HttpError(403, 'You do not have access to this area.');
    redirect(ctx.res, `/ops/login?next=${encodeURIComponent(ctx.url.pathname + ctx.url.search)}`);
    return false;
  }
  return true;
}

export function checkCsrf(ctx, fields) {
  if (!ctx.session || !safeEqual(fields._csrf || '', ctx.session.csrf)) throw new HttpError(403, 'Your session expired. Please reload the page and try again.');
}
