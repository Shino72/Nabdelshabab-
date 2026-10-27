'use strict';
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const config = require('./config');
const { get, run } = require('./db');
const { randomToken, sha256, nowIso } = require('./util');

const scrypt = promisify(crypto.scrypt);
const SC = { N: 16384, r: 8, p: 1 };

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(pw), salt, 64, { ...SC, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${SC.N}$${SC.r}$${SC.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}
async function verifyPassword(pw, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(String(pw), Buffer.from(saltB64, 'base64'), expected.length, { N: +N, r: +r, p: +p, maxmem: 64 * 1024 * 1024 });
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}
function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 10) return 'كلمة المرور يجب أن تكون 10 أحرف على الأقل';
  if (pw.length > 200) return 'كلمة المرور طويلة جدًا';
  if (!/[A-Za-z\u0600-\u06FF]/.test(pw) || !/\d/.test(pw)) return 'كلمة المرور يجب أن تحتوي على حروف وأرقام';
  return null;
}
// تجزئة وهمية لمساواة زمن الاستجابة عند إدخال بريد غير موجود
let dummyHash = null;
async function dummyVerify(pw) { dummyHash ||= await hashPassword('dummy-password-0'); await verifyPassword(pw, dummyHash); return false; }

/* ---------- الجلسات ---------- */
const SESSION_DAYS = 3;
function createSession(userId, ip, ua) {
  const token = randomToken(32);
  const csrf = randomToken(24);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  run('INSERT INTO sessions (token_hash, user_id, csrf, created_at, expires_at, ip, user_agent) VALUES (?,?,?,?,?,?,?)',
    sha256(token), userId, csrf, nowIso(), expires, ip || null, String(ua || '').slice(0, 300));
  return { token, csrf, expires };
}
function getSession(token) {
  if (!token || token.length > 100) return null;
  const row = get(`SELECT s.token_hash, s.csrf, s.expires_at, u.id, u.name, u.email, u.role, u.title, u.active
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`, sha256(token));
  if (!row || !row.active || row.expires_at < nowIso()) return null;
  return { tokenHash: row.token_hash, csrf: row.csrf, user: { id: row.id, name: row.name, email: row.email, role: row.role, title: row.title } };
}
const destroySession = (token) => run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
function cleanupSessions() {
  run('DELETE FROM sessions WHERE expires_at < ?', nowIso());
  run('DELETE FROM rate_limits WHERE reset_at < ?', Date.now());
}
function safeEqual(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

/* ---------- رموز النماذج العامة (حماية من الإرسال الآلي) ---------- */
const hmac = (s) => crypto.createHmac('sha256', config.secret).update(s).digest('base64url');
function formToken(name) {
  const ts = Date.now().toString(36);
  return `${ts}.${hmac(`${name}|${ts}`).slice(0, 32)}`;
}
function verifyFormToken(name, token) {
  const [ts, sig] = String(token || '').split('.');
  if (!ts || !sig || !safeEqual(sig, hmac(`${name}|${ts}`).slice(0, 32))) return 'invalid';
  const age = (Date.now() - parseInt(ts, 36)) / 1000;
  if (age < config.formMinSeconds) return 'too_fast';
  if (age > 6 * 3600) return 'expired';
  return null;
}

/* ---------- تحديد معدل الطلبات ---------- */
// العدّادات في قاعدة البيانات لأن الموقع قد يعمل على عدة نسخ في نفس الوقت (Vercel)
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const r = get(`INSERT INTO rate_limits (key, n, reset_at) VALUES (?, 1, ?)
    ON CONFLICT (key) DO UPDATE SET n = CASE WHEN rate_limits.reset_at < ? THEN 1 ELSE rate_limits.n + 1 END,
      reset_at = CASE WHEN rate_limits.reset_at < ? THEN EXCLUDED.reset_at ELSE rate_limits.reset_at END
    RETURNING n`, sha256(key), now + windowMs, now, now);
  return r.n <= max;
}
const resetRate = (key) => run('DELETE FROM rate_limits WHERE key = ?', sha256(key));
const ipHash = (ip) => sha256(`${config.secret}|${ip}`).slice(0, 24);

/* ---------- الأدوار والصلاحيات ---------- */
const ROLE_LABELS = { admin: 'مدير عام', editor: 'محرر (رئيس تحرير)', writer: 'كاتب / مراسل', ads: 'مسؤول إعلانات' };
const PERMS = {
  'articles.create': ['admin', 'editor', 'writer'],
  'articles.edit_any': ['admin', 'editor'],
  'articles.publish': ['admin', 'editor'],
  'articles.delete_any': ['admin', 'editor'],
  'breaking.manage': ['admin', 'editor'],
  'media.upload': ['admin', 'editor', 'writer'],
  'media.delete': ['admin', 'editor'],
  'comments.moderate': ['admin', 'editor'],
  'messages.view': ['admin', 'editor'],
  'feeds.manage': ['admin', 'editor'],
  'stats.view': ['admin', 'editor', 'ads'],
  'ads.manage': ['admin', 'ads'],
  'categories.manage': ['admin'],
  'users.manage': ['admin'],
  'settings.manage': ['admin'],
};
const can = (user, perm) => !!user && (PERMS[perm] || []).includes(user.role);

module.exports = {
  hashPassword, verifyPassword, validatePassword, dummyVerify, createSession, getSession, destroySession, cleanupSessions,
  safeEqual, formToken, verifyFormToken, rateLimit, resetRate, ipHash, ROLE_LABELS, PERMS, can, SESSION_DAYS,
};
