'use strict';
// إعدادات الاتصال كما تصل من Vercel/Supabase
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

function load(env) {
  const out = execFileSync(process.execPath, ['-e', "const c = require('./src/config'); console.log(JSON.stringify({ db: c.db, storage: c.storage, siteUrl: c.siteUrl, maxUploadMb: c.maxUploadMb, trustProxy: c.trustProxy, cookieSecure: c.cookieSecure }))"], {
    cwd: path.join(__dirname, '..'), env: { PATH: process.env.PATH, SKIP_ENV_FILE: '1', ...env },
  });
  return JSON.parse(out);
}

test('رابط Supabase من Vercel: SSL مشفّر بدون إعدادات الرابط التي تتجاوزه', () => {
  const c = load({ POSTGRES_URL: 'postgres://postgres.abc:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require&supa=base-pooler.x', VERCEL: '1', VERCEL_PROJECT_PRODUCTION_URL: 'nabd.vercel.app' });
  assert.deepEqual(c.db.ssl, { rejectUnauthorized: false });
  assert.ok(!c.db.connectionString.includes('sslmode'));
  assert.ok(c.db.connectionString.includes('supa=base-pooler.x'));
  assert.equal(c.siteUrl, 'https://nabd.vercel.app');
  assert.equal(c.maxUploadMb, 4);
  assert.equal(c.trustProxy, true);
  assert.equal(c.cookieSecure, true);
});

test('DATABASE_URL مقدَّم على POSTGRES_URL، والتحقق من الشهادة عند توفرها', () => {
  const c = load({ DATABASE_URL: 'postgres://u:p@db.example.com:5432/x', POSTGRES_URL: 'postgres://other/y', DATABASE_CA_CERT: '-----BEGIN CERTIFICATE-----\\nabc\\n-----END CERTIFICATE-----' });
  assert.ok(c.db.connectionString.startsWith('postgres://u:p@db.example.com'));
  assert.deepEqual(c.db.ssl, { ca: '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----', rejectUnauthorized: true });
});

test('قاعدة محلية أو sslmode=disable بدون SSL', () => {
  assert.equal(load({ DATABASE_URL: 'postgres://u:p@localhost/x' }).db.ssl, false);
  assert.equal(load({ DATABASE_URL: 'postgres://u:p@db:5432/x?sslmode=disable' }).db.ssl, false);
});

test('التخزين يعمل بالمفتاح القديم أو الجديد، ولا يعمل بدون مفتاح', () => {
  assert.deepEqual(load({ SUPABASE_URL: 'https://abc.supabase.co/', SUPABASE_SECRET_KEY: 'sb_secret_x' }).storage, { url: 'https://abc.supabase.co', key: 'sb_secret_x', bucket: 'nabd-media' });
  assert.equal(load({ SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'eyJ.k' }).storage.key, 'eyJ.k');
  assert.equal(load({ SUPABASE_URL: 'https://abc.supabase.co' }).storage, null);
  assert.equal(load({}).db, null);
});

test('متغيرات Supabase ببادئة (مثل STORAGE_) تُقرأ أيضًا', () => {
  const c = load({ STORAGE_POSTGRES_URL: 'postgres://u:p@pooler.supabase.com:6543/postgres', STORAGE_POSTGRES_URL_NON_POOLING: 'postgres://u:p@direct/postgres',
    STORAGE_SUPABASE_URL: 'https://abc.supabase.co', STORAGE_SUPABASE_SERVICE_ROLE_KEY: 'eyJ.k' });
  assert.ok(c.db.connectionString.includes('pooler.supabase.com'));
  assert.equal(c.storage.url, 'https://abc.supabase.co');
});
