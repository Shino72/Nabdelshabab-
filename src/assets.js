'use strict';
// روابط الأصول الثابتة مع بصمة المحتوى لتفعيل التخزين المؤقت الطويل
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./config');

const cache = new Map();
function url(rel) {
  if (!cache.has(rel) || !config.isProd) {
    // على Vercel قد لا تكون الملفات الثابتة داخل الدالة نفسها: نستخدم رقم النسخة المنشورة بدلًا من بصمة الملف
    let v = (process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || '0').slice(0, 10);
    try { v = crypto.createHash('sha1').update(fs.readFileSync(path.join(config.publicDir, rel))).digest('hex').slice(0, 10); } catch { /* تجاهل */ }
    cache.set(rel, v);
  }
  return `/static/${rel}?v=${cache.get(rel)}`;
}
module.exports = { url };
