'use strict';
// قاعدة بيانات PostgreSQL مؤقتة لكل ملف اختبار.
// TEST_DATABASE_URL: اتصال بقاعدة إدارية يمكنها إنشاء قواعد بيانات (افتراضيًا postgres المحلية)
const crypto = require('node:crypto');
const pg = require('pg');

function testDatabase() {
  const admin = process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/postgres';
  const name = `nabd_test_${crypto.randomBytes(5).toString('hex')}`;
  const url = new URL(admin);
  url.pathname = `/${name}`;
  const adminQuery = async (sql) => {
    const c = new pg.Client({ connectionString: admin });
    await c.connect();
    try { await c.query(sql); } finally { await c.end(); }
  };
  return {
    url: url.toString(),
    // ترتيب النصوص مثل Supabase (en-US) لاكتشاف أي اختلاف في المقارنات
    create: () => adminQuery(`CREATE DATABASE ${name} TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'en-US' LOCALE 'C.UTF-8'`)
      .catch(() => adminQuery(`CREATE DATABASE ${name}`)),
    drop: () => adminQuery(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`),
  };
}


// عميل HTTP بسيط يحتفظ بملفات تعريف الارتباط
class Client {
  constructor(base) { this.base = base; this.jar = {}; }
  async req(method, url, { form, body, headers = {} } = {}) {
    const h = { 'user-agent': 'Mozilla/5.0 (TestSuite)', ...headers };
    const cookie = Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookie) h.cookie = cookie;
    let payload = body;
    if (form) { payload = new URLSearchParams(form).toString(); h['content-type'] = 'application/x-www-form-urlencoded'; }
    const res = await fetch(this.base() + url, { method, headers: h, body: payload, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const i = kv.indexOf('=');
      if (/Max-Age=0/i.test(c)) delete this.jar[kv.slice(0, i)]; else this.jar[kv.slice(0, i)] = kv.slice(i + 1);
    }
    return { status: res.status, headers: res.headers, text: await res.text(), location: res.headers.get('location') };
  }
  get(u, o) { return this.req('GET', u, o); }
  post(u, o) { return this.req('POST', u, o); }
  async login(email, password) {
    const page = await this.get('/admin/login');
    const lcsrf = page.text.match(/name="_lcsrf" value="([^"]+)"/)[1];
    return this.post('/admin/login', { form: { _lcsrf: lcsrf, email, password, next: '' } });
  }
}
const csrfOf = (html) => (html.match(/name="_csrf" value="([^"]+)"/) || [])[1];
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

module.exports = { testDatabase, Client, csrfOf, PNG };
