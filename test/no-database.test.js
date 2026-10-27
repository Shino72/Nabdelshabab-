'use strict';
// بدون رابط قاعدة بيانات: صفحة توضح المطلوب بدل خطأ غامض
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

let server, base;
before(async () => {
  for (const k of Object.keys(process.env)) if (/POSTGRES|SUPABASE|DATABASE/.test(k)) delete process.env[k];
  Object.assign(process.env, { SKIP_ENV_FILE: '1', VERCEL: '1' });
  server = http.createServer(require('../server'));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => server.close(r)));

test('بدون DATABASE_URL يعرض الموقع رسالة إعداد واضحة', async () => {
  const r = await fetch(base + '/');
  assert.equal(r.status, 503);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const text = await r.text();
  assert.match(text, /DATABASE_URL/);
  assert.match(text, /لا يوجد أي متغير لقاعدة البيانات/);
});
