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
const clean = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '');
// ربط Supabase من Vercel قد يضيف بادئة لأسماء المتغيرات (مثل STORAGE_POSTGRES_URL): نقبل الاسم كما هو أو ببادئة
function fromEnv(name) {
  if (clean(env[name])) return clean(env[name]);
  const key = Object.keys(env).sort().find((k) => k.endsWith(`_${name}`) && clean(env[k]));
  return key ? clean(env[key]) : '';
}

const isVercel = !!env.VERCEL;
const isProd = env.NODE_ENV === 'production';
const port = parseInt(env.PORT || '3000', 10);

/* ---------- قاعدة البيانات ---------- */
// DATABASE_URL، أو POSTGRES_URL الذي يضيفه ربط Supabase بمشروع Vercel تلقائيًا
function dbConfig() {
  const raw = clean(env.DATABASE_URL) || fromEnv('POSTGRES_URL');
  if (!raw) return null;
  let url;
  try { url = new URL(raw); } catch { throw new Error('رابط قاعدة البيانات (DATABASE_URL) غير صالح'); }
  // إعدادات SSL في الرابط تتجاوز الإعدادات أدناه في node-postgres، لذا تُحذف ويُضبط SSL صراحة
  const noSsl = url.searchParams.get('sslmode') === 'disable';
  for (const k of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'ssl']) url.searchParams.delete(k);
  const local = noSsl || ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  const ca = clean(env.DATABASE_CA_CERT).replace(/\\n/g, '\n');
  // شهادة Supabase موقّعة من جهة خاصة بها: تُتحقق منها عند ضبط DATABASE_CA_CERT، وإلا يبقى الاتصال مشفّرًا دون التحقق من الجهة
  const ssl = local ? false : ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false };
  return { connectionString: url.toString(), ssl };
}

/* ---------- تخزين الصور (Supabase Storage) ---------- */
function storageConfig() {
  const url = fromEnv('SUPABASE_URL');
  const key = fromEnv('SUPABASE_SECRET_KEY') || fromEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return null;
  let origin;
  try { origin = new URL(url).origin; } catch { throw new Error('SUPABASE_URL غير صالح'); }
  return { url: origin, key, bucket: clean(env.STORAGE_BUCKET) || 'nabd-media' };
}

function siteUrl() {
  if (clean(env.SITE_URL)) return clean(env.SITE_URL).replace(/\/+$/, '');
  if (clean(env.VERCEL_PROJECT_PRODUCTION_URL)) return `https://${clean(env.VERCEL_PROJECT_PRODUCTION_URL)}`;
  return `http://localhost:${port}`;
}

if (env.SESSION_SECRET && env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET قصير جدًا: استخدم 32 حرفًا على الأقل');

const config = {
  rootDir,
  uploadsDir: path.resolve(rootDir, env.UPLOADS_DIR || 'uploads'),
  publicDir: path.join(rootDir, 'public'),
  db: dbConfig(),
  storage: storageConfig(),
  port,
  host: env.HOST || '0.0.0.0',
  siteUrl: siteUrl(),
  isProd,
  isVercel,
  cookieSecure: bool(env.COOKIE_SECURE, isProd || isVercel),
  trustProxy: bool(env.TRUST_PROXY, isVercel),
  tz: env.TZ_NAME || 'Africa/Cairo',
  // Vercel يرفض الطلبات الأكبر من 4.5 ميجابايت
  maxUploadMb: Math.max(1, parseInt(env.MAX_UPLOAD_MB || (isVercel ? '4' : '5'), 10)),
  maxRequestMb: isVercel ? 4.5 : null,
  // المحتوى التجريبي متوقف افتراضيًا؛ وعند إيقافه يُحذف أي محتوى تجريبي موجود عند التشغيل
  seedDemo: bool(env.SEED_DEMO, false),
  feedsAllowPrivate: bool(env.FEEDS_ALLOW_PRIVATE, false),
  formMinSeconds: parseFloat(env.FORM_MIN_SECONDS ?? '3'),
  admin: { name: env.ADMIN_NAME || 'مدير الموقع', email: env.ADMIN_EMAIL || '', password: env.ADMIN_PASSWORD || '' },
};

// مفتاح توقيع الجلسات والنماذج: من SESSION_SECRET، وإلا يُنشأ مرة واحدة ويُحفظ في قاعدة البيانات
let secret = env.SESSION_SECRET || null;
Object.defineProperty(config, 'secret', {
  enumerable: true,
  get() {
    if (!secret) {
      const { get, run } = require('./db');
      run("INSERT INTO settings (key, value) VALUES ('_secret', ?) ON CONFLICT (key) DO NOTHING", crypto.randomBytes(48).toString('base64url'));
      secret = get("SELECT value FROM settings WHERE key = '_secret'").value;
    }
    return secret;
  },
});

module.exports = config;
