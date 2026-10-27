import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './src/config.js';
import './src/db.js';
import './src/bootstrap.js';
import { parseCookies, html, HttpError, send } from './src/lib/core.js';
import { loadSession } from './src/lib/auth.js';
import { errorPage } from './src/views/layout.js';
import { router } from './src/router.js';
import './src/routes/public.js';
import './src/routes/quote.js';
import './src/routes/track.js';
import './src/routes/support.js';
import './src/routes/ops.js';
import './src/routes/ops-quotes.js';
import './src/routes/ops-shipments.js';
import './src/routes/ops-cases.js';
import './src/routes/ops-admin.js';

const PUBLIC = path.join(config.root, 'public');
const TYPES = {
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2',
};

function serveStatic(req, res, pathname) {
  const p = path.normalize(path.join(PUBLIC, decodeURIComponent(pathname)));
  if (!p.startsWith(PUBLIC + path.sep)) return false;
  let st; try { st = fs.statSync(p); } catch { return false; }
  if (!st.isFile()) return false;
  const ext = path.extname(p).toLowerCase();
  const immutable = /\/(img|brand)\//.test(pathname);
  res.writeHead(200, {
    'Content-Type': TYPES[ext] || 'application/octet-stream', 'Content-Length': st.size,
    'Cache-Control': immutable ? 'public, max-age=2592000' : 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') return res.end(), true;
  fs.createReadStream(p).pipe(res);
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, config.baseUrl);
  const ctx = { req, res, url, query: url.searchParams, cookies: parseCookies(req.headers.cookie) };
  try {
    if ((req.method === 'GET' || req.method === 'HEAD') && /\.[a-z0-9]{2,5}$/i.test(url.pathname) && serveStatic(req, res, url.pathname)) return;

    // Cross-site POST protection: reject form posts whose Origin is another site.
    if (req.method === 'POST') {
      const origin = req.headers.origin;
      if (origin && origin !== 'null' && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'Cross-site request blocked.');
    }

    const session = loadSession(ctx.cookies);
    ctx.session = session; ctx.user = session?.user || null;

    const match = router.match(req.method === 'HEAD' ? 'GET' : req.method, url.pathname);
    if (!match) throw new HttpError(404, 'Page not found');
    ctx.params = match.params;
    await match.handler(ctx);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    if (res.headersSent) return res.end();
    if (url.pathname.startsWith('/api/')) return send(res, status, JSON.stringify({ error: e.message }), 'application/json');
    html(res, errorPage(status, status === 500 ? 'Something went wrong on our side. Please try again or call us.' : e.message, ctx), status);
  }
});

server.requestTimeout = 120_000;
server.listen(config.port, () => console.log(`LANSAR platform running on ${config.baseUrl} (port ${config.port})`));
