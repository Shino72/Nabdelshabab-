'use strict';
// قاعدة بيانات تخص تطبيقًا آخر (مثل لحظة): يرفض الموقع العمل فوقها ولا يضيف إليها جداول
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { Client: PgClient } = require('pg');
const { testDatabase } = require('./helpers');

const testDb = testDatabase();
let app, server, base;

before(async () => {
  await testDb.create();
  const c = new PgClient({ connectionString: testDb.url });
  await c.connect();
  await c.query('CREATE TABLE staff_profiles (user_id uuid PRIMARY KEY)');
  await c.end();
  Object.assign(process.env, { SKIP_ENV_FILE: '1', DATABASE_URL: testDb.url, VERCEL: '1', SEED_DEMO: 'false' });
  app = require('../server');
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((r) => server.close(r));
  await app.stop();
  await testDb.drop();
});

test('قاعدة بيانات تطبيق آخر: رسالة واضحة ولا تُنشأ أي جداول', async () => {
  const r = await fetch(base + '/');
  assert.equal(r.status, 503);
  assert.match(await r.text(), /تخص تطبيقًا آخر/);
  const c = new PgClient({ connectionString: testDb.url });
  await c.connect();
  const { rows } = await c.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1");
  await c.end();
  assert.deepEqual(rows.map((x) => x.tablename), ['staff_profiles']);
});
