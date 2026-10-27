#!/usr/bin/env node
'use strict';
/*
 * نسخة احتياطية آمنة من قاعدة البيانات أثناء عمل الموقع (VACUUM INTO).
 *   npm run backup
 * يحتفظ بآخر 14 نسخة (BACKUP_KEEP). الصور في مجلد uploads تُنسخ بأمر منفصل (انظر README).
 */
const fs = require('node:fs');
const path = require('node:path');
const config = require('../src/config');
const db = require('../src/db');

const dir = path.resolve(config.rootDir, process.env.BACKUP_DIR || 'backups');
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
const file = path.join(dir, `news-${stamp}.db`);
db.open(config.dbFile);
db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
db.close();
const keep = Math.max(1, parseInt(process.env.BACKUP_KEEP || '14', 10));
const old = fs.readdirSync(dir).filter((f) => /^news-.*\.db$/.test(f)).sort().reverse().slice(keep);
for (const f of old) fs.unlinkSync(path.join(dir, f));
console.log(`✔ تم حفظ النسخة: ${file} (${(fs.statSync(file).size / 1024).toFixed(0)} ك.ب)`);
console.log(`ℹ لا تنسَ نسخ مجلد الصور أيضًا: ${config.uploadsDir}`);
