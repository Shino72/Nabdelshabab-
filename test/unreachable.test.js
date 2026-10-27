'use strict';
// قاعدة بيانات لا يمكن الوصول إليها: الصفحة تعرض سببًا مختصرًا بدون رابط الاتصال أو كلمة المرور
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

let server, base;
before(async () => {
  Object.assign(process.env, { SKIP_ENV_FILE: '1', VERCEL: '1', DATABASE_URL: 'postgres://user:SuperSecretPw@127.0.0.1:1/db' });
  server = http.createServer(require('../server'));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => server.close(r)));

test('خطأ الاتصال يظهر كسبب مختصر دون كشف بيانات الاتصال', async () => {
  const r = await fetch(base + '/');
  assert.equal(r.status, 503);
  const text = await r.text();
  assert.match(text, /تعذر الاتصال بقاعدة البيانات/);
  assert.match(text, /ECONNREFUSED/);
  assert.ok(!text.includes('SuperSecretPw'));
});
