'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const config = require('./config');

/* ---------- ملفات تعريف الارتباط ---------- */
function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { out[k] = part.slice(i + 1).trim(); }
  }
  return out;
}
function setCookie(res, name, value, { maxAge, httpOnly = true, sameSite = 'Lax', path: p = '/' } = {}) {
  let c = `${name}=${encodeURIComponent(value)}; Path=${p}; SameSite=${sameSite}`;
  if (maxAge !== undefined) c += `; Max-Age=${maxAge}`;
  if (httpOnly) c += '; HttpOnly';
  if (config.cookieSecure) c += '; Secure';
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', prev ? [].concat(prev, c) : [c]);
}

/* ---------- قراءة جسم الطلب ---------- */
function httpError(status, message) { return Object.assign(new Error(message), { status }); }
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const len = parseInt(req.headers['content-length'] || '0', 10);
    if (len > limit) { req.resume(); return reject(httpError(413, 'حجم البيانات المرسلة أكبر من المسموح')); }
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(httpError(413, 'حجم البيانات المرسلة أكبر من المسموح')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function parseUrlEncoded(buf) {
  const out = {};
  for (const [k, v] of new URLSearchParams(buf.toString('utf8'))) {
    if (k in out) out[k] = [].concat(out[k], v); else out[k] = v;
  }
  return out;
}
function parseMultipart(buf, boundary) {
  const fields = {}, files = {};
  const delim = Buffer.from(`--${boundary}`);
  const sep = Buffer.from(`\r\n--${boundary}`);
  let pos = buf.indexOf(delim);
  if (pos < 0) return { fields, files };
  pos += delim.length;
  for (let guard = 0; guard < 200; guard++) {
    if (buf[pos] === 45 && buf[pos + 1] === 45) break; // "--" نهاية
    pos += 2;
    const headEnd = buf.indexOf('\r\n\r\n', pos);
    if (headEnd < 0) break;
    const head = buf.subarray(pos, headEnd).toString('utf8');
    const next = buf.indexOf(sep, headEnd + 4);
    if (next < 0) break;
    const data = buf.subarray(headEnd + 4, next);
    const cd = /content-disposition:\s*form-data;([^\r\n]*)/i.exec(head);
    const name = cd && /\bname="([^"]*)"/i.exec(cd[1]);
    const filename = cd && /\bfilename="([^"]*)"/i.exec(cd[1]);
    const ct = /content-type:\s*([^\r\n;]+)/i.exec(head);
    if (name) {
      const k = name[1];
      if (filename) {
        if (data.length) (files[k] ||= []).push({ filename: path.basename(filename[1]).slice(0, 200), type: ct ? ct[1].trim() : '', data: Buffer.from(data) });
      } else {
        const v = data.toString('utf8');
        if (k in fields) fields[k] = [].concat(fields[k], v); else fields[k] = v;
      }
    }
    pos = next + sep.length;
  }
  return { fields, files };
}

class Form {
  constructor(fields = {}, files = {}) { this.fields = fields; this.files = files; }
  raw(k) { const v = this.fields[k]; return Array.isArray(v) ? v[v.length - 1] : v; }
  str(k, max = 500) {
    let v = this.raw(k);
    v = typeof v === 'string' ? v : '';
    v = v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
    return v.slice(0, max);
  }
  int(k) { const n = parseInt(this.str(k, 20), 10); return Number.isFinite(n) ? n : null; }
  num(k) { const n = parseFloat(this.str(k, 30)); return Number.isFinite(n) ? n : null; }
  bool(k) { return ['1', 'on', 'true', 'yes'].includes(this.str(k, 10)); }
  file(k) { return (this.files[k] || [])[0] || null; }
  fileList(k) { return this.files[k] || []; }
}

async function parseBody(req) {
  const type = String(req.headers['content-type'] || '');
  if (type.startsWith('multipart/form-data')) {
    const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(type);
    if (!m) throw httpError(400, 'طلب غير صالح');
    const buf = await readBody(req, (config.maxUploadMb * 6 + 1) * 1024 * 1024);
    const { fields, files } = parseMultipart(buf, m[1] || m[2]);
    return new Form(fields, files);
  }
  const buf = await readBody(req, 2 * 1024 * 1024);
  if (type.startsWith('application/json')) {
    try { return new Form(JSON.parse(buf.toString('utf8') || '{}')); } catch { throw httpError(400, 'طلب غير صالح'); }
  }
  return new Form(parseUrlEncoded(buf));
}

/* ---------- الاستجابات ---------- */
const COMPRESSIBLE = /text\/|json|xml|javascript|svg/;
function send(ctx, status, body, type = 'text/html; charset=utf-8', headers = {}) {
  const { req, res } = ctx;
  let buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ''));
  const h = { 'Content-Type': type, ...headers };
  if (buf.length > 1024 && COMPRESSIBLE.test(type) && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    buf = zlib.gzipSync(buf, { level: 6 });
    h['Content-Encoding'] = 'gzip';
    h.Vary = 'Accept-Encoding';
  }
  h['Content-Length'] = buf.length;
  res.writeHead(status, h);
  res.end(req.method === 'HEAD' ? undefined : buf);
}
const sendHtml = (ctx, status, body, headers) => send(ctx, status, body, 'text/html; charset=utf-8', headers);
const sendJson = (ctx, status, obj) => send(ctx, status, JSON.stringify(obj), 'application/json; charset=utf-8', { 'Cache-Control': 'no-store' });
function redirect(ctx, location, status = 302) {
  ctx.res.writeHead(status, { Location: location, 'Content-Length': 0 });
  ctx.res.end();
}

/* ---------- الملفات الثابتة ---------- */
const MIME = {
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2', '.json': 'application/json',
};
function serveFile(ctx, root, rel, { allowed, maxAge = 3600, extraHeaders = {} } = {}) {
  let decoded;
  try { decoded = decodeURIComponent(rel); } catch { return false; }
  if (decoded.includes('\0') || decoded.includes('\\')) return false;
  const full = path.resolve(root, '.' + path.posix.normalize('/' + decoded));
  if (!full.startsWith(root + path.sep)) return false;
  const ext = path.extname(full).toLowerCase();
  if (!MIME[ext] || (allowed && !allowed.includes(ext))) return false;
  let st;
  try { st = fs.statSync(full); } catch { return false; }
  if (!st.isFile()) return false;
  const etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
  const headers = { ETag: etag, 'Cache-Control': `public, max-age=${maxAge}`, ...extraHeaders };
  if (ctx.req.headers['if-none-match'] === etag) { ctx.res.writeHead(304, headers); ctx.res.end(); return true; }
  send(ctx, 200, fs.readFileSync(full), MIME[ext], headers);
  return true;
}

module.exports = { parseCookies, setCookie, parseBody, Form, send, sendHtml, sendJson, redirect, serveFile, httpError, parseMultipart };
