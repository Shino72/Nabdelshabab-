#!/usr/bin/env node
'use strict';
/*
 * نسخة احتياطية من كل جداول قاعدة البيانات في ملف JSON.
 *   npm run backup
 * يحتفظ بآخر 14 نسخة (BACKUP_KEEP). الملف يحتوي بيانات حساسة (بصمات كلمات المرور ومفتاح التوقيع): احفظه في مكان آمن.
 * الصور محفوظة في Supabase Storage (أو مجلد uploads عند التشغيل بدون Supabase) وتُنسخ بشكل منفصل.
 */
const fs = require('node:fs');
const path = require('node:path');
const config = require('../src/config');
const db = require('../src/db');

const dir = path.resolve(config.rootDir, process.env.BACKUP_DIR || 'backups');
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
const file = path.join(dir, `nabd-${stamp}.json`);
async function main() {
  await db.connect();
  db.open();
  const tables = {};
  for (const { tablename } of db.all('SELECT tablename FROM pg_tables WHERE schemaname = current_schema() ORDER BY tablename')) {
    tables[tablename] = db.all(`SELECT * FROM "${tablename.replace(/"/g, '""')}"`);
  }
  db.close();
  fs.writeFileSync(file, JSON.stringify({ created_at: new Date().toISOString(), tables }), { mode: 0o600 });
  const keep = Math.max(1, parseInt(process.env.BACKUP_KEEP || '14', 10));
  const old = fs.readdirSync(dir).filter((f) => /^nabd-.*\.json$/.test(f)).sort().reverse().slice(keep);
  for (const f of old) fs.unlinkSync(path.join(dir, f));
  const rows = Object.values(tables).reduce((n, t) => n + t.length, 0);
  console.log(`✔ تم حفظ النسخة: ${file} (${Object.keys(tables).length} جدول، ${rows} صف)`);
}
main().catch((e) => { console.error('✖', e.message); process.exit(1); });
