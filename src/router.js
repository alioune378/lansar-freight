const routes = [];
function add(method, pattern, handler) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/\/:(\w+)/g, (_, k) => (keys.push(k), '/([^/]+)')) + '/?$');
  routes.push({ method, re, keys, handler });
}
export const router = {
  get: (p, h) => add('GET', p, h),
  post: (p, h) => add('POST', p, h),
  match(method, pathname) {
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = r.re.exec(pathname);
      if (m) return { handler: r.handler, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
    }
    return null;
  },
};
