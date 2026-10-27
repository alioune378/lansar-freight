// Minimal HTTP toolkit: safe HTML templating, cookies, body parsing, responses.
import crypto from 'node:crypto';
import { config } from '../config.js';

// ——— HTML templating with automatic escaping ———
export class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(String(s ?? ''));
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
function render(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return esc(v);
}
export function h(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += render(vals[i]) + strings[i + 1];
  return new Raw(out);
}

// ——— Cookies ———
export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore malformed */ }
  }
  return out;
}
export function setCookie(res, name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${opts.path || '/'}`, 'SameSite=Lax'];
  if (opts.httpOnly !== false) parts.push('HttpOnly');
  if (config.production) parts.push('Secure');
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', [...(Array.isArray(prev) ? prev : prev ? [prev] : []), parts.join('; ')]);
}

// ——— Body parsing (urlencoded + multipart via the built-in Fetch API) ———
export class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

export async function readBody(req, limit = config.uploads.maxRequestBytes) {
  const chunks = []; let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError(413, 'Upload too large');
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

/** Returns { fields: {name: string | string[]}, files: {name: File[]} } */
export async function parseForm(req) {
  const ct = req.headers['content-type'] || '';
  const buf = await readBody(req, ct.startsWith('multipart/') ? config.uploads.maxRequestBytes : 1024 * 1024);
  const fields = {}; const files = {};
  if (!buf.length) return { fields, files };
  const fd = await new Request('http://local/', { method: 'POST', headers: { 'content-type': ct }, body: buf }).formData();
  for (const [k, v] of fd.entries()) {
    if (typeof v === 'string') {
      if (k in fields) fields[k] = [].concat(fields[k], v); else fields[k] = v;
    } else if (v && v.size > 0) {
      (files[k] ||= []).push(v);
    }
  }
  return { fields, files };
}

// Field helpers
export const str = (v, max = 500) => String(Array.isArray(v) ? v[0] ?? '' : v ?? '').trim().slice(0, max);
export const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []).map((x) => String(x));
export const num = (v) => { const n = Number(String(v ?? '').replace(/[, ]/g, '')); return Number.isFinite(n) ? n : null; };
export const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);

// ——— Responses ———
const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};
export function send(res, status, body, type = 'text/html; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, ...SEC_HEADERS, ...extra });
  res.end(body instanceof Raw ? body.s : body);
}
export const html = (res, body, status = 200, extra = {}) => send(res, status, body, 'text/html; charset=utf-8', { 'Cache-Control': 'no-store', ...extra });
export const json = (res, obj, status = 200) => send(res, status, JSON.stringify(obj), 'application/json');
export function redirect(res, to, status = 303) { res.writeHead(status, { Location: to, ...SEC_HEADERS }); res.end(); }

// ——— Crypto helpers ———
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const hmac = (s) => crypto.createHmac('sha256', config.secret).update(String(s)).digest('base64url');
export function safeEqual(a, b) {
  const A = Buffer.from(String(a)); const B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

// ——— Simple in-memory rate limiter (per process) ———
const buckets = new Map();
export function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) { buckets.set(key, { n: 1, reset: now + windowMs }); return true; }
  b.n += 1;
  return b.n <= max;
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k); }, 60_000).unref();

export function clientIp(req) {
  return (config.production && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '';
}

// ——— Formatting ———
export const fmtDate = (d, opts = { dateStyle: 'medium' }) => (d ? new Intl.DateTimeFormat('en-US', { timeZone: /^\d{4}-\d{2}-\d{2}$/.test(d) ? 'UTC' : 'America/New_York', ...opts }).format(new Date(d)) : '—');
export const fmtDateTime = (d) => fmtDate(d, { dateStyle: 'medium', timeStyle: 'short' });
export const fmtMoney = (n, cur = 'USD') => (n === null || n === undefined || n === '' ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: cur || 'USD' }).format(Number(n)));
export const nowIso = () => new Date().toISOString();

// Staff enter times in New York local time regardless of server timezone.
const nyOffsetMin = (d) => (new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' })) - new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }))) / 6e4;
export const nyLocalNow = () => new Date(Date.now() + nyOffsetMin(new Date()) * 6e4).toISOString().slice(0, 16);
export function nyToIso(local) {
  const d = new Date(`${local}Z`);
  if (Number.isNaN(d.getTime())) return new Date().toISOString();
  return new Date(d.getTime() - nyOffsetMin(d) * 6e4).toISOString();
}
