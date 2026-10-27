'use strict';
/*
 * اختبارات شاملة تعمل على خادم حقيقي وقاعدة بيانات مؤقتة.
 * تشغيل: npm test
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const { testDatabase } = require('./helpers');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nabd-test-'));
const testDb = testDatabase();
Object.assign(process.env, {
  SKIP_ENV_FILE: '1', DATABASE_URL: testDb.url, UPLOADS_DIR: path.join(tmp, 'uploads'), NODE_ENV: 'test',
  ADMIN_EMAIL: 'admin@test.local', ADMIN_PASSWORD: 'StrongPass123', ADMIN_NAME: 'مدير الاختبار',
  SEED_DEMO: 'true', FEEDS_ALLOW_PRIVATE: 'true', FORM_MIN_SECONDS: '0',
});
const app = require('../server');
const db = require('../src/db');
const U = require('../src/util');

let base;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

class Client {
  constructor() { this.jar = {}; }
  async req(method, url, { form, body, json, headers = {} } = {}) {
    const h = { 'user-agent': 'Mozilla/5.0 (TestSuite)', ...headers };
    const cookie = Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookie) h.cookie = cookie;
    let payload = body;
    if (form) { payload = new URLSearchParams(form).toString(); h['content-type'] = 'application/x-www-form-urlencoded'; }
    if (json) { payload = JSON.stringify(json); h['content-type'] = 'application/json'; }
    const res = await fetch(base + url, { method, headers: h, body: payload, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const i = kv.indexOf('=');
      const k = kv.slice(0, i), v = kv.slice(i + 1);
      if (/Max-Age=0/i.test(c)) delete this.jar[k]; else this.jar[k] = v;
    }
    const text = await res.text();
    return { status: res.status, headers: res.headers, text, location: res.headers.get('location'), json: () => JSON.parse(text) };
  }
  get(u, o) { return this.req('GET', u, o); }
  post(u, o) { return this.req('POST', u, o); }
}
const csrfOf = (html) => (html.match(/name="_csrf" value="([^"]+)"/) || [])[1];
async function login(c, email, password) {
  const page = await c.get('/admin/login');
  const lcsrf = page.text.match(/name="_lcsrf" value="([^"]+)"/)[1];
  return c.post('/admin/login', { form: { _lcsrf: lcsrf, email, password, next: '' } });
}
const catId = (slug) => db.get('SELECT id FROM categories WHERE slug = ?', slug).id;

const admin = new Client();
let adminCsrf, publishedId, publishedUrl, scheduledId, writerId, campaignId, uploadedPath;

before(async () => {
  await testDb.create();
  const s = await app.start({ port: 0, host: '127.0.0.1', quiet: true });
  base = `http://127.0.0.1:${s.address().port}`;
});
after(async () => { await app.stop(); await testDb.drop(); fs.rmSync(tmp, { recursive: true, force: true }); });

/* ===================== الواجهة العامة ===================== */
test('بيانات التواصل الافتراضية: الهاتف وواتساب والبريد', async () => {
  for (const page of ['/advertise', '/about']) {
    const r = await new Client().get(page);
    assert.equal(r.status, 200);
    assert.match(r.text, /href="tel:01101135785"/, page);
    assert.match(r.text, /href="https:\/\/wa\.me\/201101135785"/, page);
    assert.match(r.text, /mailto:Seifkhaledamer6@gmail\.com/, page);
    assert.ok(!r.text.includes('example.com'), page);
  }
});
test('الصفحة الرئيسية تعمل مع RTL وشريط العاجل وترويسات الأمان', async () => {
  const r = await new Client().get('/');
  assert.equal(r.status, 200);
  assert.match(r.text, /<html lang="ar" dir="rtl">/);
  assert.match(r.text, /نبض الشباب/);
  assert.match(r.text, /class="ticker"/);
  assert.match(r.text, /يعرض الموقع حاليًا محتوى تجريبيًا/);
  assert.match(r.text, /سيف خالد عامر/);
  assert.ok(r.headers.get('content-security-policy').includes("default-src 'self'"));
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
});

test('كل الصفحات العامة والروابط الأساسية تعمل بدون روابط معطلة', async () => {
  const c = new Client();
  const home = await c.get('/');
  const links = new Set([...home.text.matchAll(/href="(\/[^"#?]*)"/g)].map((m) => m[1]).filter((h) => !h.startsWith('/go/')));
  assert.ok(links.size > 40, `عدد الروابط ${links.size}`);
  for (const link of links) {
    const r = await c.get(link);
    assert.ok([200, 301].includes(r.status), `${link} => ${r.status}`);
  }
  for (const p of ['/about', '/contact', '/privacy', '/terms', '/advertise', '/archive', '/multimedia', '/search']) assert.equal((await c.get(p)).status, 200, p);
  const about = await c.get('/about');
  for (const name of ['رئيس مجلس الإدارة', 'سيف خالد عامر', 'دكتور فاطمة الزهراء', 'دكتور حمدان', 'مشروع جامعي']) assert.ok(about.text.includes(name), name);
  const nf = await c.get('/no-such-page');
  assert.equal(nf.status, 404);
  assert.match(nf.text, /الصفحة غير موجودة/);
  assert.equal((await c.get('/category/no-such')).status, 404);
});

test('ملفات SEO: robots وsitemap وRSS', async () => {
  const c = new Client();
  const robots = await c.get('/robots.txt');
  assert.match(robots.text, /Disallow: \/admin/);
  assert.match(robots.text, /Sitemap: /);
  const sm = await c.get('/sitemap.xml');
  assert.match(sm.text, /^<\?xml/);
  assert.match(sm.text, /\/category\/politics/);
  assert.ok(!sm.text.includes('demo'), 'المحتوى التجريبي مستبعد من خريطة الموقع');
  assert.match((await c.get('/rss.xml')).text, /<rss version="2.0">/);
  assert.match((await c.get('/news-sitemap.xml')).text, /sitemap-news/);
});

test('صفحة الخبر: رابط موحّد وبيانات منظمة ومشاركة واحتساب مشاهدة', async () => {
  const a = db.get('SELECT id, slug, views FROM articles WHERE is_demo = 1 ORDER BY published_at DESC LIMIT 1');
  const c = new Client();
  const wrong = await c.get(`/news/${a.id}/wrong-slug`);
  assert.equal(wrong.status, 301);
  assert.equal(wrong.location, U.articleUrl(a));
  const r = await c.get(U.articleUrl(a));
  assert.equal(r.status, 200);
  assert.match(r.text, /application\/ld\+json/);
  assert.match(r.text, /"@type":"NewsArticle"/);
  assert.match(r.text, /noindex/, 'المواد التجريبية لا تُفهرس');
  assert.match(r.text, /wa\.me/);
  assert.match(r.text, /data-print/);
});

test('البحث بالعربي يتجاهل اختلاف الهمزات ويدعم التصفية بالقسم', async () => {
  const c = new Client();
  const r1 = await c.get(`/search?q=${encodeURIComponent('إقتصاد')}`);
  assert.match(r1.text, /عدد النتائج: \d+/);
  const r2 = await c.get(`/search?q=${encodeURIComponent('مهرجان')}&category=culture`);
  assert.match(r2.text, /مهرجان سينمائي/);
  const r3 = await c.get(`/search?q=${encodeURIComponent('مهرجان')}&category=sports`);
  assert.match(r3.text, /لا توجد نتائج/);
});

test('الأرشيف حسب التاريخ', async () => {
  const a = db.get("SELECT title, published_at FROM articles WHERE status = 'published' ORDER BY published_at DESC LIMIT 1");
  const day = U.utcToLocalInput(a.published_at).slice(0, 10);
  const r = await new Client().get(`/archive?date=${day}`);
  assert.equal(r.status, 200);
  assert.ok(r.text.includes(U.esc(a.title)));
});

/* ===================== تسجيل الدخول والحماية ===================== */
test('لوحة التحكم محمية ولا تفتح بدون تسجيل دخول', async () => {
  const c = new Client();
  for (const p of ['/admin', '/admin/articles', '/admin/users', '/admin/ads', '/admin/settings']) {
    const r = await c.get(p);
    assert.equal(r.status, 302, p);
    assert.match(r.location, /^\/admin\/login/);
  }
  const api = await c.get('/api/v1/admin/articles');
  assert.equal(api.status, 401);
});

test('تسجيل الدخول: رفض البيانات الخاطئة ونموذج بلا رمز حماية، ثم دخول ناجح بجلسة آمنة', async () => {
  const c = new Client();
  const noToken = await c.post('/admin/login', { form: { email: 'admin@test.local', password: 'StrongPass123' } });
  assert.equal(noToken.status, 403);
  const bad = await login(c, 'admin@test.local', 'WrongPass999');
  assert.equal(bad.status, 401);
  assert.match(bad.text, /غير صحيحة/);
  const page = await admin.get('/admin/login');
  const lcsrf = page.text.match(/name="_lcsrf" value="([^"]+)"/)[1];
  const res = await fetch(base + '/admin/login', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: `lcsrf=${admin.jar.lcsrf}` }, body: new URLSearchParams({ _lcsrf: lcsrf, email: 'admin@test.local', password: 'StrongPass123' }) });
  assert.equal(res.status, 303);
  const sid = res.headers.getSetCookie().find((x) => x.startsWith('sid='));
  assert.match(sid, /HttpOnly/);
  assert.match(sid, /SameSite=Lax/);
  admin.jar.sid = sid.split(';')[0].slice(4);
  const dash = await admin.get('/admin');
  assert.equal(dash.status, 200);
  assert.match(dash.text, /لوحة المعلومات/);
  adminCsrf = csrfOf(dash.text);
  assert.ok(adminCsrf);
});

test('رفض أي عملية بدون رمز CSRF صحيح', async () => {
  const r = await admin.post('/admin/articles/new', { form: { title: 'محاولة بدون رمز', category_id: catId('politics'), action: 'publish' } });
  assert.equal(r.status, 403);
  const r2 = await admin.post('/admin/articles/new', { form: { _csrf: 'wrong', title: 'محاولة برمز خاطئ', category_id: catId('politics'), action: 'publish' } });
  assert.equal(r2.status, 403);
});

/* ===================== إدارة الأخبار ===================== */
test('إضافة خبر مع رفع صورة ونشره: يظهر في الموقع مع حماية من XSS', async () => {
  const fd = new FormData();
  fd.append('_csrf', adminCsrf);
  fd.append('title', 'خبر اختبار منشور <script>alert(1)</script>');
  fd.append('excerpt', 'مقدمة خبر الاختبار');
  fd.append('body', 'فقرة أولى مع **نص غامق** و[رابط](https://example.com).\n\n<img src=x onerror=alert(1)>\n\n## عنوان فرعي\n\n- بند أول');
  fd.append('category_id', String(catId('politics')));
  fd.append('type', 'news');
  fd.append('tags', 'اختبار، وسم تجريبي');
  fd.append('sources', 'مصدر الاختبار | https://example.org/source');
  fd.append('allow_comments', '1');
  fd.append('action', 'publish');
  fd.append('cover_file', new Blob([PNG], { type: 'image/png' }), 'cover.png');
  const r = await admin.post('/admin/articles/new', { body: fd });
  assert.equal(r.status, 303, r.text.slice(0, 300));
  assert.match(r.location, /\/admin\/articles\/(\d+)\/edit\?ok=published/);
  publishedId = +r.location.match(/articles\/(\d+)/)[1];
  const row = db.get('SELECT * FROM articles WHERE id = ?', publishedId);
  assert.equal(row.status, 'published');
  assert.match(row.cover_image, /^\/uploads\/\d{4}\/\d{2}\/[a-f0-9]{24}\.png$/);
  uploadedPath = row.cover_image;
  publishedUrl = U.articleUrl(row);

  const home = await new Client().get('/');
  assert.ok(home.text.includes('خبر اختبار منشور &lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!home.text.includes('<script>alert(1)</script>'));
  const page = await new Client().get(publishedUrl);
  assert.equal(page.status, 200);
  assert.equal(db.get('SELECT views FROM articles WHERE id = ?', publishedId).views, 1, 'احتساب المشاهدة');
  await new Client().get(publishedUrl);
  assert.equal(db.get('SELECT views FROM articles WHERE id = ?', publishedId).views, 1, 'لا تُحتسب إعادة التحميل من نفس الزائر خلال 30 دقيقة');
  assert.match(page.text, /<strong>نص غامق<\/strong>/);
  assert.match(page.text, /<h2>عنوان فرعي<\/h2>/);
  assert.ok(!page.text.includes('<img src=x'), 'لا يُسمح بـ HTML خام داخل النص');
  assert.match(page.text, /مصدر الاختبار/);
  const img = await new Client().get(uploadedPath);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.equal(img.headers.get('content-security-policy'), "default-src 'none'");
  assert.ok(db.get('SELECT 1 AS x FROM media WHERE path = ?', uploadedPath), 'الصورة مسجلة في مكتبة الوسائط');
});

test('تعديل الخبر ينعكس على الموقع، والمسودة تخفيه، ثم الحذف يزيله', async () => {
  const fd = new URLSearchParams({ _csrf: adminCsrf, title: 'عنوان خبر معدّل للاختبار', excerpt: 'مقدمة', body: 'نص بعد التعديل', category_id: catId('economy'), type: 'news', cover_image: uploadedPath, allow_comments: '1', action: 'publish' });
  const r = await admin.post(`/admin/articles/${publishedId}/edit`, { form: Object.fromEntries(fd) });
  assert.equal(r.status, 303);
  const row = db.get('SELECT * FROM articles WHERE id = ?', publishedId);
  publishedUrl = U.articleUrl(row);
  const page = await new Client().get(publishedUrl);
  assert.match(page.text, /عنوان خبر معدّل للاختبار/);
  assert.match(page.text, /\/category\/economy/);

  // إنشاء خبر مؤقت ثم إلغاء نشره ثم حذفه
  const tmpRes = await admin.post('/admin/articles/new', { form: { _csrf: adminCsrf, title: 'خبر مؤقت سيُحذف', body: 'نص', category_id: catId('sports'), type: 'news', action: 'publish' } });
  const tmpId = +tmpRes.location.match(/articles\/(\d+)/)[1];
  const tmpUrl = U.articleUrl(db.get('SELECT * FROM articles WHERE id = ?', tmpId));
  assert.equal((await new Client().get(tmpUrl)).status, 200);
  await admin.post(`/admin/articles/${tmpId}/edit`, { form: { _csrf: adminCsrf, title: 'خبر مؤقت سيُحذف', body: 'نص', category_id: catId('sports'), type: 'news', action: 'draft' } });
  assert.equal((await new Client().get(tmpUrl)).status, 404, 'المسودة لا تظهر للزوار');
  const prev = await admin.get(`/admin/articles/${tmpId}/preview`);
  assert.equal(prev.status, 200);
  assert.match(prev.text, /معاينة: هذه المادة غير منشورة/);
  const del = await admin.post(`/admin/articles/${tmpId}/delete`, { form: { _csrf: adminCsrf } });
  assert.equal(del.status, 303);
  assert.equal(db.get('SELECT COUNT(*) AS n FROM articles WHERE id = ?', tmpId).n, 0);
});

test('جدولة النشر: لا يظهر الخبر قبل موعده، ورفض موعد في الماضي', async () => {
  const future = U.utcToLocalInput(new Date(Date.now() + 2 * 3600000).toISOString());
  const r = await admin.post('/admin/articles/new', { form: { _csrf: adminCsrf, title: 'خبر مجدول للمستقبل', body: 'نص', category_id: catId('tech'), type: 'news', action: 'schedule', publish_at: future } });
  assert.equal(r.status, 303);
  assert.match(r.location, /ok=scheduled/);
  scheduledId = +r.location.match(/articles\/(\d+)/)[1];
  const row = db.get('SELECT * FROM articles WHERE id = ?', scheduledId);
  assert.ok(row.published_at > U.nowIso());
  assert.equal((await new Client().get(U.articleUrl(row))).status, 404);
  assert.ok(!(await new Client().get('/')).text.includes('خبر مجدول للمستقبل'));
  const list = await admin.get('/admin/articles?status=scheduled');
  assert.match(list.text, /خبر مجدول للمستقبل/);
  const past = U.utcToLocalInput(new Date(Date.now() - 3600000).toISOString());
  const bad = await admin.post('/admin/articles/new', { form: { _csrf: adminCsrf, title: 'جدولة بموعد ماضٍ', body: 'نص', category_id: catId('tech'), action: 'schedule', publish_at: past } });
  assert.equal(bad.status, 400);
  assert.match(bad.text, /موعد نشر صحيحًا في المستقبل/);
});

test('التحقق من المدخلات: عنوان قصير وقسم مفقود وروابط غير صالحة', async () => {
  const r = await admin.post('/admin/articles/new', { form: { _csrf: adminCsrf, title: 'قص', body: '', video_url: 'https://evil.example/video', sources: 'مصدر | javascript:alert(1)', cover_image: '/etc/passwd', action: 'publish' } });
  assert.equal(r.status, 400);
  for (const m of ['العنوان قصير', 'اختر القسم', 'رابط الفيديو غير صالح', 'رابط المصدر غير صالح', 'رابط صورة الغلاف غير صالح']) assert.ok(r.text.includes(m), m);
});

test('رفع الصور: قبول صورة حقيقية ورفض ملف مزيف', async () => {
  const fake = new FormData();
  fake.append('_csrf', adminCsrf);
  fake.append('file', new Blob(['<?php echo 1; ?>'], { type: 'image/png' }), 'shell.png');
  const r = await admin.post('/admin/media/upload', { body: fake, headers: { accept: 'application/json' } });
  assert.equal(r.status, 400);
  assert.match(r.json().errors[0], /نوع الملف غير مدعوم/);
  const ok = new FormData();
  ok.append('_csrf', adminCsrf);
  ok.append('file', new Blob([PNG], { type: 'image/png' }), 'ad.png');
  const r2 = await admin.post('/admin/media/upload', { body: ok, headers: { accept: 'application/json' } });
  assert.equal(r2.status, 200);
  assert.equal(r2.json().items.length, 1);
  const lib = await admin.get('/admin/media.json');
  assert.ok(lib.json().items.length >= 2);
  // لا يمكن حذف صورة مستخدمة كغلاف
  const media = db.get('SELECT id FROM media WHERE path = ?', uploadedPath);
  const del = await admin.post(`/admin/media/${media.id}/delete`, { form: { _csrf: adminCsrf } });
  assert.match(del.location, /err=in_use/);
});

/* ===================== المستخدمون والصلاحيات ===================== */
test('الصلاحيات: الكاتب يرسل للمراجعة فقط، والمحرر ينشر', async () => {
  const create = await admin.post('/admin/users/new', { form: { _csrf: adminCsrf, name: 'كاتب الاختبار', email: 'writer@test.local', role: 'writer', password: 'WriterPass123' } });
  assert.equal(create.status, 303);
  writerId = db.get("SELECT id FROM users WHERE email = 'writer@test.local'").id;
  const weak = await admin.post('/admin/users/new', { form: { _csrf: adminCsrf, name: 'ضعيف', email: 'weak@test.local', role: 'writer', password: '123' } });
  assert.equal(weak.status, 400);

  const w = new Client();
  assert.equal((await login(w, 'writer@test.local', 'WriterPass123')).status, 303);
  const wDash = await w.get('/admin');
  const wCsrf = csrfOf(wDash.text);
  for (const p of ['/admin/users', '/admin/ads', '/admin/settings', '/admin/comments']) assert.equal((await w.get(p)).status, 403, p);
  const tryPublish = await w.post('/admin/articles/new', { form: { _csrf: wCsrf, title: 'مادة من الكاتب', body: 'نص الكاتب', category_id: catId('society'), type: 'news', action: 'publish', is_featured: '1' } });
  const wid = +tryPublish.location.match(/articles\/(\d+)/)[1];
  let row = db.get('SELECT * FROM articles WHERE id = ?', wid);
  assert.equal(row.status, 'draft', 'الكاتب لا يستطيع النشر المباشر');
  assert.equal(row.is_featured, 0);
  await w.post(`/admin/articles/${wid}/edit`, { form: { _csrf: wCsrf, title: 'مادة من الكاتب', body: 'نص الكاتب', category_id: catId('society'), type: 'news', action: 'submit' } });
  assert.equal(db.get('SELECT status FROM articles WHERE id = ?', wid).status, 'pending');
  assert.equal((await new Client().get(U.articleUrl(row))).status, 404);
  const queue = await admin.get('/admin/articles?status=pending');
  assert.match(queue.text, /مادة من الكاتب/);
  await admin.post(`/admin/articles/${wid}/edit`, { form: { _csrf: adminCsrf, title: 'مادة من الكاتب', body: 'نص الكاتب', category_id: catId('society'), type: 'news', author_id: writerId, action: 'publish' } });
  row = db.get('SELECT * FROM articles WHERE id = ?', wid);
  assert.equal(row.status, 'published');
  assert.equal((await new Client().get(U.articleUrl(row))).status, 200);
  const edit = await w.post(`/admin/articles/${wid}/edit`, { form: { _csrf: wCsrf, title: 'محاولة تعديل بعد النشر', body: 'x', category_id: catId('society'), action: 'draft' } });
  assert.equal(edit.status, 403, 'الكاتب لا يعدّل مادة منشورة');
});

test('لا يمكن إزالة صلاحية آخر مدير', async () => {
  const me = db.get("SELECT id FROM users WHERE email = 'admin@test.local'");
  const r = await admin.post(`/admin/users/${me.id}/edit`, { form: { _csrf: adminCsrf, name: 'مدير الاختبار', email: 'admin@test.local', role: 'writer', active: '1' } });
  assert.equal(r.status, 400);
  assert.match(r.text, /آخر مدير نشط/);
});

/* ===================== الإعلانات ===================== */
test('حملة إعلانية: الظهور في مكانها واحتساب الظهور والنقرات وتقرير CSV', async () => {
  const img = db.get("SELECT path FROM media WHERE path != ? ORDER BY id DESC LIMIT 1", uploadedPath).path;
  const slot = db.get("SELECT id FROM ad_slots WHERE key = 'home_leaderboard'").id;
  const today = U.localDay();
  const r = await admin.post('/admin/ads/new', { form: { _csrf: adminCsrf, title: 'حملة اختبار', slot_id: slot, start: today, end: U.addDays(today, 7), target_url: 'https://example.com/landing', image: img, advertiser_name: 'شركة الاختبار', contact_phone: '01000000000', status: 'active', payment_status: 'paid', amount: '1500' } });
  assert.equal(r.status, 303, r.text.slice(0, 300));
  campaignId = +r.location.match(/ads\/(\d+)/)[1];
  const home = await new Client().get('/');
  assert.ok(home.text.includes(`/go/ad/${campaignId}`));
  assert.ok(db.get('SELECT impressions FROM ad_campaigns WHERE id = ?', campaignId).impressions >= 1);
  const click = await new Client().get(`/go/ad/${campaignId}`);
  assert.equal(click.status, 302);
  assert.equal(click.location, 'https://example.com/landing');
  assert.equal(db.get('SELECT clicks FROM ad_campaigns WHERE id = ?', campaignId).clicks, 1);
  const csv = await admin.get(`/admin/ads/${campaignId}/report.csv`);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.text, /مرات الظهور/);
  // إيقاف الحملة يخفي الإعلان
  await admin.post(`/admin/ads/${campaignId}/toggle`, { form: { _csrf: adminCsrf } });
  assert.ok(!(await new Client().get('/')).text.includes(`/go/ad/${campaignId}`));
  await admin.post(`/admin/ads/${campaignId}/toggle`, { form: { _csrf: adminCsrf } });
  const badUrl = await admin.post('/admin/ads/new', { form: { _csrf: adminCsrf, title: 'رابط خطير', slot_id: slot, start: today, end: today, target_url: 'javascript:alert(1)', image: img, advertiser_name: 'x x' } });
  assert.equal(badUrl.status, 400);
});

test('حملة منتهية لا تظهر، وتعديل أسعار المساحات ينعكس على صفحة «أعلن معنا»', async () => {
  const slot = db.get("SELECT id FROM ad_slots WHERE key = 'article_top'");
  const r = await admin.post(`/admin/ads/slots/${slot.id}`, { form: { _csrf: adminCsrf, name: 'أعلى صفحة الخبر', price: '9999', price_unit: 'month', active: '1' } });
  assert.equal(r.status, 303);
  const adv = await new Client().get('/advertise');
  assert.match(adv.text, /9,999 ج\.م \/ شهر/);
});

test('طلب حجز إعلان من صفحة «أعلن معنا» يصل إلى لوحة التحكم', async () => {
  const c = new Client();
  const page = await c.get('/advertise');
  const token = page.text.match(/name="token" value="([^"]+)"/)[1];
  const bad = await c.post('/advertise', { form: { token, company: 'شركة', contact_name: 'أحمد', phone: 'abc' } });
  assert.equal(bad.status, 400);
  const ok = await c.post('/advertise', { form: { token, company: 'شركة المعلن التجريبية', contact_name: 'أحمد علي', phone: '+20 100 000 0000', email: 'ads@client.test', duration: 'شهر', message: 'نريد حملة' } });
  assert.equal(ok.status, 303);
  const reqs = await admin.get('/admin/ads/requests');
  assert.match(reqs.text, /شركة المعلن التجريبية/);
});

/* ===================== التعليقات والتواصل ===================== */
test('التعليقات: مراجعة قبل النشر ثم موافقة وإبلاغ', async () => {
  const c = new Client();
  const page = await c.get(publishedUrl);
  const token = page.text.match(/name="article_id" value="\d+"><input type="hidden" name="token" value="([^"]+)"/)[1];
  const r = await c.post('/comments', { form: { article_id: publishedId, token, name: 'قارئ', body: 'تعليق اختبار <b>مهم</b>', website: '' } });
  assert.equal(r.status, 303);
  assert.match(r.location, /comment=pending/);
  assert.ok(!(await c.get(publishedUrl)).text.includes('تعليق اختبار'));
  const cm = db.get('SELECT id FROM comments WHERE article_id = ?', publishedId);
  await admin.post(`/admin/comments/${cm.id}/approve`, { form: { _csrf: adminCsrf } });
  const after = await c.get(publishedUrl);
  assert.ok(after.text.includes('تعليق اختبار &lt;b&gt;مهم&lt;/b&gt;'));
  const rtoken = after.text.match(new RegExp(`/comments/${cm.id}/report"><input type="hidden" name="token" value="([^"]+)"`))[1];
  await c.post(`/comments/${cm.id}/report`, { form: { token: rtoken, reason: 'إساءة أو ألفاظ خارجة' } });
  const reported = await admin.get('/admin/comments?tab=reported');
  assert.match(reported.text, /تعليق اختبار/);
  const spam = await c.post('/comments', { form: { article_id: publishedId, token, name: 'روبوت', body: 'رسالة مزعجة', website: 'http://spam' } });
  assert.equal(spam.status, 303);
  assert.equal(db.get("SELECT COUNT(*) AS n FROM comments WHERE name = 'روبوت'").n, 0, 'حقل المصيدة يمنع الحفظ');
});

test('نموذج «اتصل بنا» يحفظ الرسالة وتظهر في لوحة التحكم', async () => {
  const c = new Client();
  const page = await c.get('/contact');
  const token = page.text.match(/name="token" value="([^"]+)"/)[1];
  const bad = await c.post('/contact', { form: { token, name: 'سارة', message: 'قصيرة' } });
  assert.equal(bad.status, 400);
  const ok = await c.post('/contact', { form: { token, name: 'سارة محمود', email: 'sara@test.local', subject: 'تصحيح معلومة في خبر', message: 'هناك خطأ في تاريخ الخبر المنشور اليوم.' } });
  assert.equal(ok.status, 303);
  const inbox = await admin.get('/admin/messages');
  assert.match(inbox.text, /سارة محمود/);
});

test('الأخبار العاجلة من لوحة التحكم تظهر في الشريط', async () => {
  const r = await admin.post('/admin/breaking', { form: { _csrf: adminCsrf, text: 'عاجل اختباري من لوحة التحكم', hours: '3', article_id: publishedId } });
  assert.equal(r.status, 303);
  const home = await new Client().get('/');
  assert.match(home.text, /عاجل اختباري من لوحة التحكم/);
});

test('الإعدادات: تغيير الاسم وبيانات الإدارة ينعكس على الموقع', async () => {
  const s = require('../src/models/settings').getAll();
  const form = { ...s, _csrf: adminCsrf, site_name: 'نبض الشباب', site_tagline: 'شعار معدّل للاختبار', masthead_credits: `${s.masthead_credits}\nرئيس التحرير: اسم للاختبار`, comments_enabled: '1', show_empty_ad_slots: '1' };
  const r = await admin.post('/admin/settings', { form });
  assert.equal(r.status, 303);
  const home = await new Client().get('/');
  assert.match(home.text, /شعار معدّل للاختبار/);
  assert.match(home.text, /اسم للاختبار/);
  assert.match(home.text, /سيف خالد عامر/);
  const bad = await admin.post('/admin/settings', { form: { ...form, social_facebook: 'javascript:alert(1)' } });
  assert.equal(bad.status, 400);
});

/* ===================== واجهة API ===================== */
test('API عامة: قائمة الأخبار وتفاصيل خبر والأقسام', async () => {
  const c = new Client();
  const list = (await c.get('/api/v1/articles?category=economy&per_page=5')).json();
  assert.ok(list.data.length >= 1);
  assert.ok(list.data.every((a) => a.category.slug === 'economy'));
  const one = await c.get(`/api/v1/articles/${publishedId}`);
  assert.equal(one.status, 200);
  assert.match(one.json().data.body_html, /<p>/);
  assert.equal((await c.get(`/api/v1/articles/${scheduledId}`)).status, 404, 'المجدول لا يظهر في الـ API العامة');
  assert.ok((await c.get('/api/v1/categories')).json().data.length >= 11);
});

test('API للمحررين: دخول ثم إضافة وتعديل وحذف مع الحماية', async () => {
  const c = new Client();
  const bad = await c.post('/api/v1/auth/login', { json: { email: 'admin@test.local', password: 'nope-nope-1' } });
  assert.equal(bad.status, 401);
  const login = await c.post('/api/v1/auth/login', { json: { email: 'admin@test.local', password: 'StrongPass123' } });
  assert.equal(login.status, 200);
  const token = login.json().csrf_token;
  const noCsrf = await c.post('/api/v1/admin/articles', { json: { title: 'بدون رمز', category_id: catId('world') } });
  assert.equal(noCsrf.status, 403);
  const invalid = await c.post('/api/v1/admin/articles', { json: { title: 'قص' }, headers: { 'x-csrf-token': token } });
  assert.equal(invalid.status, 422);
  const created = await c.post('/api/v1/admin/articles', { json: { title: 'خبر عبر الواجهة البرمجية', excerpt: 'ملخص', body: 'نص الخبر', category_id: catId('world'), tags: ['api', 'اختبار'], action: 'publish' }, headers: { 'x-csrf-token': token } });
  assert.equal(created.status, 201, created.text);
  const id = created.json().data.id;
  assert.equal(created.json().data.status, 'published');
  const upd = await c.req('PUT', `/api/v1/admin/articles/${id}`, { json: { title: 'خبر عبر الواجهة البرمجية بعد التعديل' }, headers: { 'x-csrf-token': token } });
  assert.equal(upd.status, 200, upd.text);
  const pub = (await new Client().get(`/api/v1/articles/${id}`)).json().data;
  assert.equal(pub.title, 'خبر عبر الواجهة البرمجية بعد التعديل');
  assert.equal(pub.body, 'نص الخبر', 'التعديل الجزئي يحافظ على باقي الحقول');
  assert.deepEqual(pub.tags.sort(), ['api', 'اختبار'].sort());
  const del = await c.req('DELETE', `/api/v1/admin/articles/${id}`, { headers: { 'x-csrf-token': token } });
  assert.equal(del.status, 200);
  assert.equal((await new Client().get(`/api/v1/articles/${id}`)).status, 404);
});

/* ===================== مصادر RSS ===================== */
test('استيراد RSS: يجلب العناوين فقط ولا ينشر شيئًا تلقائيًا', async () => {
  const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>مصدر</title>
    <item><title>عنوان من المصدر الأول</title><link>https://source.example/1</link><guid>s-1</guid><pubDate>Mon, 26 Oct 2026 10:00:00 GMT</pubDate><description><![CDATA[<p>ملخص <b>أول</b></p>]]></description></item>
    <item><title>عنوان من المصدر الثاني &amp; الأخير</title><link>https://source.example/2</link><guid>s-2</guid></item></channel></rss>`;
  const srv = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'application/rss+xml' }); s.end(rss); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const url = `http://127.0.0.1:${srv.address().port}/feed.xml`;
    assert.equal((await admin.post('/admin/feeds', { form: { _csrf: adminCsrf, name: 'مصدر مرخّص للاختبار', url, category_id: catId('world') } })).status, 303);
    const src = db.get('SELECT id FROM feed_sources WHERE url = ?', url);
    const f = await admin.post(`/admin/feeds/${src.id}/fetch`, { form: { _csrf: adminCsrf } });
    assert.match(f.location, /ok=fetched/);
    const items = db.all('SELECT * FROM feed_items WHERE source_id = ? ORDER BY id', src.id);
    assert.equal(items.length, 2);
    assert.equal(items[0].summary, 'ملخص أول');
    assert.equal(items[1].title, 'عنوان من المصدر الثاني & الأخير');
    assert.equal(db.get("SELECT COUNT(*) AS n FROM articles WHERE title LIKE 'عنوان من المصدر%'").n, 0);
    const d = await admin.post(`/admin/feeds/items/${items[0].id}/draft`, { form: { _csrf: adminCsrf } });
    const aid = +d.location.match(/articles\/(\d+)/)[1];
    const art = db.get('SELECT status FROM articles WHERE id = ?', aid);
    assert.equal(art.status, 'draft');
    assert.equal(db.get('SELECT url FROM article_sources WHERE article_id = ?', aid).url, 'https://source.example/1');
  } finally { srv.close(); }
});

/* ===================== أمان إضافي ===================== */
test('منع الوصول للملفات خارج المجلدات العامة', async () => {
  const c = new Client();
  for (const p of ['/static/../server.js', '/static/%2e%2e/server.js', '/uploads/..%2f..%2fserver.js', '/uploads/%2e%2e/data/news.db', '/static/..%5cserver.js']) {
    const r = await c.get(p);
    assert.equal(r.status, 404, p);
    assert.ok(!r.text.includes('require('), p);
  }
});

test('تحديد عدد محاولات الدخول الخاطئة', async () => {
  const c = new Client();
  let last;
  for (let i = 0; i < 7; i++) last = await login(c, 'nobody@test.local', 'WrongPass999');
  assert.equal(last.status, 429);
});

test('التقارير ولوحة المعلومات تعرض الإحصاءات', async () => {
  const rep = await admin.get('/admin/reports');
  assert.equal(rep.status, 200);
  assert.match(rep.text, /أكثر المواد مشاهدة/);
  assert.match(rep.text, /حملة اختبار/);
  const dash = await admin.get('/admin');
  assert.match(dash.text, /مشاهدات اليوم/);
});

/* ===================== الاستمرارية ===================== */
test('البيانات والصور تبقى محفوظة بعد إعادة تشغيل الخادم', async () => {
  await app.stop();
  const s = await app.start({ port: 0, host: '127.0.0.1', quiet: true });
  base = `http://127.0.0.1:${s.address().port}`;
  const page = await new Client().get(publishedUrl);
  assert.equal(page.status, 200);
  assert.match(page.text, /عنوان خبر معدّل للاختبار/);
  assert.equal((await new Client().get(uploadedPath)).status, 200);
  assert.equal((await admin.get('/admin')).status, 200, 'الجلسة محفوظة في قاعدة البيانات');
});

test('حذف المحتوى التجريبي يبقي المحتوى الحقيقي', async () => {
  const r = await admin.post('/admin/settings/delete-demo', { form: { _csrf: adminCsrf } });
  assert.equal(r.status, 303);
  assert.equal(db.get('SELECT COUNT(*) AS n FROM articles WHERE is_demo = 1').n, 0);
  const home = await new Client().get('/');
  assert.ok(!home.text.includes('يعرض الموقع حاليًا محتوى تجريبيًا'));
  assert.match(home.text, /عنوان خبر معدّل للاختبار/);
});

test('تسجيل الخروج ينهي الجلسة', async () => {
  const r = await admin.post('/admin/logout', { form: { _csrf: adminCsrf } });
  assert.equal(r.status, 303);
  assert.equal((await admin.get('/admin')).status, 302);
});
