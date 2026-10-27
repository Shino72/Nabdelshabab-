'use strict';
// موجّه بسيط: يدعم المعاملات بصيغة /news/:id
const routes = [];
function add(method, pattern, handler) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/\/:(\w+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, handler });
}
function match(method, path) {
  for (const r of routes) {
    if (r.method !== method && !(method === 'HEAD' && r.method === 'GET')) continue;
    const m = r.re.exec(path);
    if (!m) continue;
    const params = {};
    r.keys.forEach((k, i) => { try { params[k] = decodeURIComponent(m[i + 1]); } catch { params[k] = m[i + 1]; } });
    return { handler: r.handler, params };
  }
  return null;
}
const get = (p, h) => add('GET', p, h);
const post = (p, h) => add('POST', p, h);
const put = (p, h) => add('PUT', p, h);
const del = (p, h) => add('DELETE', p, h);
module.exports = { add, match, get, post, put, del };
