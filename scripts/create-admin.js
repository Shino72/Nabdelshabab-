#!/usr/bin/env node
'use strict';
/*
 * إنشاء حساب مدير (أو إعادة تعيين كلمة مرور مدير موجود) بأمان من سطر الأوامر.
 *   npm run create-admin
 *   npm run create-admin -- --email=admin@site.com --name="مدير الموقع"
 * كلمة المرور تُكتب مخفية، أو تُمرَّر عبر متغير البيئة ADMIN_PASSWORD.
 */
const readline = require('node:readline');
const config = require('../src/config');
const db = require('../src/db');
const seed = require('../src/seed');
const Users = require('../src/models/users');
const { hashPassword, validatePassword } = require('../src/security');

function ask(rl, question, hidden = false) {
  return new Promise((resolve) => {
    let muted = false;
    rl._writeToOutput = (s) => { if (!muted) rl.output.write(s); else if (/[\r\n]/.test(s)) rl.output.write('\n'); };
    rl.question(question, (answer) => { muted = false; resolve(answer.trim()); });
    muted = hidden;
  });
}

async function main() {
  db.open(config.dbFile);
  seed.seedBase();
  const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=')]; }));
  // بدون شاشة تفاعلية (مثل السكربتات الآلية) تُقرأ القيم من المعاملات ومتغير البيئة فقط
  const interactive = !!process.stdin.isTTY;
  const rl = interactive ? readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true }) : null;
  const name = args.name || (interactive ? await ask(rl, 'الاسم الظاهر: ') : '') || 'مدير الموقع';
  const email = (args.email || (interactive ? await ask(rl, 'البريد الإلكتروني: ') : '')).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('البريد الإلكتروني غير صالح أو غير موجود (استخدم --email=...)');
  const password = process.env.ADMIN_PASSWORD || (interactive ? await ask(rl, 'كلمة المرور (10 أحرف على الأقل، حروف وأرقام): ', true) : '');
  if (rl) rl.close();
  if (!password) throw new Error('لم تُدخل كلمة مرور (اكتبها عند الطلب أو مرّرها عبر ADMIN_PASSWORD)');
  const err = validatePassword(password);
  if (err) throw new Error(err);
  const hash = await hashPassword(password);
  const existing = Users.getByEmail(email);
  if (existing) {
    Users.update(existing.id, { ...existing, role: 'admin', active: 1 });
    Users.setPassword(existing.id, hash);
    console.log(`✔ تم تحديث الحساب ${email}: أصبح مديرًا وتم تعيين كلمة مرور جديدة.`);
  } else {
    Users.create({ name, email, passwordHash: hash, role: 'admin', title: 'إدارة الموقع' });
    console.log(`✔ تم إنشاء حساب المدير: ${email}`);
  }
  console.log('ادخل إلى لوحة التحكم من: /admin/login');
  db.close();
}
main().catch((e) => { console.error('✖', e.message); process.exit(1); });
