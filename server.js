'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const { isMainThread } = require('node:worker_threads');
const config = require('./src/config');
const db = require('./src/db');
const { parseCookies, serveFile, sendHtml, send } = require('./src/http');
const router = require('./src/router');
const seed = require('./src/seed');
const { cleanupSessions } = require('./src/security');
const storage = require('./src/storage');
const { UPLOAD_PATH } = require('./src/uploads');
const { THEME_SCRIPT } = require('./src/views/layout');
const { esc } = require('./src/util');

require('./src/routes/public');
require('./src/routes/admin');
require('./src/routes/api');
const pub = require('./src/routes/public');
const pages = require('./src/views/pages');

const themeHash = crypto.createHash('sha256').update(THEME_SCRIPT).digest('base64');
const CSP = [
  "default-src 'self'", `script-src 'self' 'sha256-${themeHash}'`, "style-src 'self' https://fonts.googleapis.com", "font-src 'self' https://fonts.gstatic.com",
  `img-src 'self' data: blob:${storage.origin() ? ` ${storage.origin()}` : ''}`, 'frame-src https://www.youtube-nocookie.com', "connect-src 'self'", "form-action 'self'", "base-uri 'self'", "object-src 'none'",
].join('; ');
const BOT = /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|telegram|preview|monitor|curl|wget|python|httpclient|headless|lighthouse/i;

function clientIp(req) {
  if (config.trustProxy) {
    const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (xff) return xff.slice(0, 64);
  }
  return String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;
  const ctx = { req, res, url, path, query: url.searchParams, method: req.method, params: {}, cookies: parseCookies(req.headers.cookie), ip: clientIp(req), isBot: BOT.test(req.headers['user-agent'] || '') };
  const isAdmin = path === '/admin' || path.startsWith('/admin/');
  res.setHeader('Content-Security-Policy', CSP + (isAdmin ? "; frame-ancestors 'none'" : "; frame-ancestors 'self'") + (config.cookieSecure ? '; upgrade-insecure-requests' : ''));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (isAdmin) res.setHeader('X-Frame-Options', 'DENY');
  if (config.cookieSecure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  try {
    if (!['GET', 'HEAD', 'POST', 'PUT', 'DELETE'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD, POST, PUT, DELETE' }); return res.end(); }
    if (path.startsWith('/static/')) {
      const versioned = url.searchParams.has('v');
      if (serveFile(ctx, config.publicDir, path.slice(8), { maxAge: versioned ? 31536000 : 3600 })) return;
      return pub.notFound(ctx);
    }
    if (path.startsWith('/uploads/')) {
      // الصور محفوظة في Supabase Storage: تحويل دائم إلى رابطها العام (أسماء الملفات عشوائية ولا تتغير)
      if (storage.enabled()) {
        const m = UPLOAD_PATH.exec(path);
        if (!m) return pub.notFound(ctx);
        res.writeHead(301, { Location: storage.publicUrl(m[1]), 'Cache-Control': 'public, max-age=31536000, immutable', 'Content-Length': 0 });
        return res.end();
      }
      if (serveFile(ctx, config.uploadsDir, path.slice(9), { allowed: ['.jpg', '.jpeg', '.png', '.webp', '.gif'], maxAge: 2592000, extraHeaders: { 'Content-Security-Policy': "default-src 'none'", 'Content-Disposition': 'inline' } })) return;
      return pub.notFound(ctx);
    }
    if (path === '/favicon.ico') { res.writeHead(301, { Location: '/static/img/favicon.svg' }); return res.end(); }
    const m = router.match(req.method, path);
    if (!m) return pub.notFound(ctx);
    ctx.params = m.params;
    await m.handler(ctx);
  } catch (err) {
    if (res.headersSent) { res.end(); return; }
    const status = err.status || 500;
    if (status >= 500) console.error(`[${new Date().toISOString()}] ${req.method} ${path}`, err);
    const msg = status === 413 ? 'حجم الملفات أو البيانات المرسلة أكبر من الحد المسموح.' : status === 400 ? 'الطلب غير صالح.' : undefined;
    sendHtml(ctx, status, pages.errorPage(msg), { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'", 'Cache-Control': 'no-store' });
  }
}

/* ---------- التهيئة: إنشاء الجداول والبيانات الأساسية (مرة لكل تشغيل) ---------- */
async function init() {
  const { fresh } = db.open();
  seed.seedBase();
  let adm;
  try { adm = await seed.ensureAdminFromEnv(); } catch (e) {
    console.error('تعذر إنشاء حساب المدير من متغيرات البيئة:', e.message);
    adm = { created: false, error: e.message };
  }
  let demo = 0;
  if (fresh && config.seedDemo) demo = await seed.seedDemo();
  cleanupSessions();
  return { adm, demo };
}
let ready = null;
function ensureReady() {
  ready ||= init().catch((e) => { ready = null; throw e; });
  return ready;
}

const SETUP_ERROR = (msg) => `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>الموقع غير جاهز</title>
<body style="font-family:Tahoma,sans-serif;max-width:640px;margin:10vh auto;padding:0 16px;line-height:1.8"><h1>الموقع غير جاهز بعد</h1><p>${msg}</p></body></html>`;

// نقطة الدخول على Vercel: دالة تستقبل كل الطلبات
async function vercelHandler(req, res) {
  try {
    await ensureReady();
  } catch (e) {
    console.error('تعذرت تهيئة الموقع:', e);
    const known = e.code === 'NO_DATABASE' || e.code === 'FOREIGN_DATABASE';
    // سبب مختصر يساعد صاحب الموقع على الإصلاح دون الرجوع للسجلات (بعد حذف أي روابط اتصال)
    const reason = String(`${e.code ? `${e.code}: ` : ''}${e.message || ''}`).replace(/\b\w+:\/\/\S+/g, '[url]').slice(0, 200);
    const msg = known ? esc(e.message) : `تعذر الاتصال بقاعدة البيانات. راجع إعدادات Supabase ثم أعد المحاولة.<br><small dir="ltr">${esc(reason)}</small>`;
    res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '30' });
    return res.end(SETUP_ERROR(msg));
  }
  return handle(req, res);
}

let server = null;
async function start({ port = config.port, host = config.host, quiet = false } = {}) {
  const { adm, demo } = await ensureReady();
  server = http.createServer((req, res) => { handle(req, res); });
  server.keepAliveTimeout = 65000;
  server.requestTimeout = 60000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  if (!quiet) {
    const p = server.address().port;
    console.log(`✔ الموقع يعمل على http://localhost:${p}  (لوحة التحكم: /admin)`);
    if (demo) console.log(`✔ أُضيفت ${demo} مادة تجريبية (يمكن حذفها من الإعدادات في لوحة التحكم)`);
    if (adm.created) console.log('✔ أُنشئ حساب المدير من متغيرات البيئة. يُفضّل حذف ADMIN_PASSWORD من ملف .env الآن.');
    if (adm.missing) console.log('⚠ لا يوجد حساب مدير بعد. أنشئه بالأمر: npm run create-admin');
  }
  return server;
}
async function stop() {
  if (server) await new Promise((r) => server.close(r));
  server = null;
  ready = null;
  db.close();
}

if (require.main === module && isMainThread) {
  start().catch((e) => { console.error('تعذر تشغيل الخادم:', e.message); process.exit(1); });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stop().finally(() => process.exit(0)); });
}

module.exports = vercelHandler;
Object.assign(module.exports, { start, stop, handle, init: ensureReady });
