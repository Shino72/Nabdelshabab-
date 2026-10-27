'use strict';
/*
 * التشغيل كما على Vercel: الدالة المصدَّرة من server.js تستقبل الطلبات مباشرة (بدون start)،
 * والصور تُحفظ في Supabase Storage (خادم وهمي محلي يحاكي واجهته).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { fork } = require('node:child_process');
const { testDatabase, Client, csrfOf, PNG } = require('./helpers');

const testDb = testDatabase();
const storage = fork(path.join(__dirname, 'fake-storage.js'));
const ask = (msg) => new Promise((resolve) => { storage.once('message', resolve); storage.send(msg); });
const storageCalls = async () => (await ask('calls')).calls.map((c) => ({ ...c, body: Buffer.from(c.body, 'base64') }));

let app, appServer, base, storageUrl;
const admin = new Client(() => base);

before(async () => {
  const { port } = await new Promise((resolve) => storage.once('message', resolve));
  storageUrl = `http://127.0.0.1:${port}`;
  await testDb.create();
  Object.assign(process.env, {
    SKIP_ENV_FILE: '1', DATABASE_URL: testDb.url, VERCEL: '1', NODE_ENV: 'production', COOKIE_SECURE: 'false',
    SUPABASE_URL: storageUrl, SUPABASE_SERVICE_ROLE_KEY: 'eyJ.test-service-key', SEED_DEMO: 'false',
    ADMIN_EMAIL: 'Owner@Test.local', ADMIN_PASSWORD: 'StrongPass123', SITE_URL: 'https://nabd.example',
  });
  app = require('../server');
  appServer = http.createServer(app);
  await new Promise((r) => appServer.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${appServer.address().port}`;
});
after(async () => {
  await new Promise((r) => appServer.close(r));
  await app.stop();
  await testDb.drop();
  storage.disconnect();
});

test('الدالة المصدَّرة تهيئ قاعدة البيانات عند أول طلب وتعرض الموقع', async () => {
  assert.equal(typeof app, 'function');
  const r = await new Client(() => base).get('/');
  assert.equal(r.status, 200);
  assert.match(r.text, /نبض الشباب/);
  assert.ok(r.headers.get('content-security-policy').includes(`img-src 'self' data: blob: ${storageUrl}`));
  const db = require('../src/db');
  assert.equal(db.get('SELECT version FROM nabd_schema').version, 1);
  assert.equal(db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").n, 1);
  assert.equal(db.get('SELECT COUNT(*) AS n FROM categories').n > 5, true);
  const secret = require('../src/config').secret;
  assert.ok(secret.length >= 32);
  assert.equal(db.get("SELECT value FROM settings WHERE key = '_secret'").value, secret, 'مفتاح التوقيع محفوظ في قاعدة البيانات');
  // كل الجداول محمية بـ RLS حتى لا تُقرأ عبر واجهة Supabase العامة
  assert.equal(db.get("SELECT COUNT(*) AS n FROM pg_tables WHERE schemaname = current_schema() AND NOT rowsecurity").n, 0);
});

test('الدخول بالبريد بغض النظر عن حالة الأحرف', async () => {
  const r = await admin.login('owner@test.local', 'StrongPass123');
  assert.equal(r.status, 303);
  assert.ok(admin.jar.sid);
});

test('رفع صورة يحفظها في Supabase Storage وينشئ المساحة تلقائيًا', async () => {
  const page = await admin.get('/admin/media');
  assert.match(page.text, /data-max-request-mb="4.5"/);
  const csrf = csrfOf(page.text);
  const fd = new FormData();
  fd.append('_csrf', csrf);
  fd.append('file', new Blob([PNG], { type: 'image/png' }), 'pic.png');
  const r = await admin.post('/admin/media/upload', { body: fd, headers: { accept: 'application/json' } });
  assert.equal(r.status, 200, r.text);
  const { items } = JSON.parse(r.text);
  assert.match(items[0].path, /^\/uploads\/\d{4}\/\d{2}\/[a-f0-9]{24}\.png$/);

  const calls = await storageCalls();
  const uploads = calls.filter((c) => c.method === 'POST' && c.url.includes('/object/'));
  assert.equal(uploads.length, 2, 'محاولة أولى، ثم إنشاء المساحة، ثم إعادة الرفع');
  assert.ok(calls.some((c) => c.url === '/storage/v1/bucket' && JSON.parse(c.body).public === true));
  const last = uploads[1];
  assert.equal(last.url, `/storage/v1/object/nabd-media/${items[0].path.slice('/uploads/'.length)}`);
  assert.equal(last.headers.apikey, 'eyJ.test-service-key');
  assert.equal(last.headers.authorization, 'Bearer eyJ.test-service-key');
  assert.equal(last.headers['content-type'], 'image/png');
  assert.deepEqual(last.body, PNG);

  // رابط الصورة على الموقع يحوّل إلى رابطها العام في التخزين
  const img = await new Client(() => base).get(items[0].path);
  assert.equal(img.status, 301);
  assert.equal(img.location, `${storageUrl}/storage/v1/object/public/nabd-media/${items[0].path.slice('/uploads/'.length)}`);
  assert.equal((await new Client(() => base).get('/uploads/2026/01/not-a-real-file.png')).status, 404);

  // حذف الصورة من المكتبة يحذفها من التخزين
  const db = require('../src/db');
  const media = db.get('SELECT id FROM media WHERE path = ?', items[0].path);
  const del = await admin.post(`/admin/media/${media.id}/delete`, { form: { _csrf: csrf } });
  assert.equal(del.status, 303);
  assert.ok((await storageCalls()).some((c) => c.method === 'DELETE' && c.url === `/storage/v1/object/nabd-media/${items[0].path.slice('/uploads/'.length)}`));
});

test('فشل التخزين يظهر كرسالة خطأ ولا يحفظ سجلًا ناقصًا', async () => {
  const page = await admin.get('/admin/media');
  const csrf = csrfOf(page.text);
  const before = require('../src/db').get('SELECT COUNT(*) AS n FROM media').n;
  await ask('fail');
  const fd = new FormData();
  fd.append('_csrf', csrf);
  fd.append('file', new Blob([PNG], { type: 'image/png' }), 'pic.png');
  const r = await admin.post('/admin/media/upload', { body: fd, headers: { accept: 'application/json' } });
  assert.equal(r.status, 400);
  assert.match(JSON.parse(r.text).errors[0], /تعذر حفظ الصورة/);
  assert.equal(require('../src/db').get('SELECT COUNT(*) AS n FROM media').n, before);
});

test('محاولات الدخول الخاطئة تُحسب في قاعدة البيانات (مشتركة بين نسخ الموقع)', async () => {
  const c = new Client(() => base);
  for (let i = 0; i < 6; i++) assert.equal((await c.login('owner@test.local', 'wrong-password-1')).status, 401);
  assert.equal((await c.login('owner@test.local', 'wrong-password-1')).status, 429);
  const db = require('../src/db');
  assert.ok(db.get('SELECT COUNT(*) AS n FROM rate_limits').n >= 2);
  assert.equal(db.get("SELECT COUNT(*) AS n FROM rate_limits WHERE key LIKE '%owner%'").n, 0, 'المفاتيح مخزنة كبصمة لا كنص');
});

test('انقطاع اتصالات قاعدة البيانات الخاملة لا يُسقط الطلب التالي', async () => {
  const { Client: PgClient } = require('pg');
  const c = new PgClient({ connectionString: testDb.url });
  await c.connect();
  const { rowCount } = await c.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()');
  await c.end();
  assert.ok(rowCount >= 1);
  await new Promise((r) => setTimeout(r, 200));
  const r = await new Client(() => base).get('/');
  assert.equal(r.status, 200);
});
