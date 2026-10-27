'use strict';
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const rootDir = path.resolve(__dirname, '..');
const envFile = path.join(rootDir, '.env');
if (!process.env.SKIP_ENV_FILE && fs.existsSync(envFile)) {
  try { process.loadEnvFile(envFile); } catch (e) { console.warn('تعذرت قراءة ملف .env:', e.message); }
}
const env = process.env;
const bool = (v, d = false) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(v));

const dataDir = path.resolve(rootDir, env.DATA_DIR || 'data');
const uploadsDir = path.resolve(rootDir, env.UPLOADS_DIR || 'uploads');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadsDir, { recursive: true });

const isProd = env.NODE_ENV === 'production';
const port = parseInt(env.PORT || '3000', 10);

function loadSecret() {
  if (env.SESSION_SECRET) {
    if (env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET قصير جدًا: استخدم 32 حرفًا على الأقل');
    return env.SESSION_SECRET;
  }
  // في حال عدم ضبطه: يُنشأ مفتاح عشوائي ويُحفظ داخل مجلد البيانات حتى لا تنتهي الجلسات بعد إعادة التشغيل
  const f = path.join(dataDir, '.secret');
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  const s = crypto.randomBytes(48).toString('base64url');
  fs.writeFileSync(f, s, { mode: 0o600 });
  return s;
}

module.exports = {
  rootDir,
  dataDir,
  uploadsDir,
  publicDir: path.join(rootDir, 'public'),
  dbFile: path.join(dataDir, env.DB_FILE || 'news.db'),
  port,
  host: env.HOST || '0.0.0.0',
  siteUrl: (env.SITE_URL || `http://localhost:${port}`).replace(/\/+$/, ''),
  isProd,
  cookieSecure: bool(env.COOKIE_SECURE, isProd),
  trustProxy: bool(env.TRUST_PROXY, false),
  tz: env.TZ_NAME || 'Africa/Cairo',
  maxUploadMb: Math.max(1, parseInt(env.MAX_UPLOAD_MB || '5', 10)),
  seedDemo: bool(env.SEED_DEMO, true),
  feedsAllowPrivate: bool(env.FEEDS_ALLOW_PRIVATE, false),
  formMinSeconds: parseFloat(env.FORM_MIN_SECONDS ?? '3'),
  secret: loadSecret(),
  admin: { name: env.ADMIN_NAME || 'مدير الموقع', email: env.ADMIN_EMAIL || '', password: env.ADMIN_PASSWORD || '' },
};
