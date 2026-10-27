'use strict';
const crypto = require('node:crypto');
const config = require('./config');

/* ---------- قوالب HTML آمنة: كل قيمة تُهرَّب تلقائيًا ما لم تكن SafeHtml ---------- */
class SafeHtml { constructor(s) { this.s = s; } toString() { return this.s; } }
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
function renderVal(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof SafeHtml) return v.s;
  if (Array.isArray(v)) return v.map(renderVal).join('');
  return esc(v);
}
function html(strings, ...vals) {
  let out = '';
  for (let i = 0; i < strings.length; i++) {
    out += strings[i];
    if (i < vals.length) out += renderVal(vals[i]);
  }
  return new SafeHtml(out);
}
const raw = (s) => new SafeHtml(String(s ?? ''));

/* ---------- نصوص عربية ---------- */
function normalizeArabic(s) {
  return String(s || '')
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
    .replace(/\u0640/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .toLowerCase();
}
function slugify(s, max = 80) {
  const out = String(s || '')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/, '');
  return out || 'news';
}
const truncate = (s, n) => { s = String(s || '').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };
function initials(name) {
  const parts = String(name || '').replace(/^(د|أ|م)\.\s*/, '').trim().split(/\s+/);
  return (parts[0]?.[0] || '') + (parts[1]?.[0] || '');
}
function arPlural(n, one, two, few, many) {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${n} ${few}`;
  return `${n} ${many}`;
}

/* ---------- روابط ---------- */
function isHttpUrl(u) {
  try { const x = new URL(u); return x.protocol === 'http:' || x.protocol === 'https:'; } catch { return false; }
}
function youtubeId(input) {
  const s = String(input || '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^www\.|^m\./, '');
    let id = null;
    if (host === 'youtu.be') id = u.pathname.slice(1);
    else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      if (u.pathname === '/watch') id = u.searchParams.get('v');
      else { const m = u.pathname.match(/^\/(embed|shorts|live)\/([\w-]{11})/); if (m) id = m[2]; }
    }
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  } catch { return null; }
}
const articleUrl = (a) => `/news/${a.id}/${encodeURIComponent(a.slug)}`;

/* ---------- تشفير ---------- */
const randomToken = (n = 32) => crypto.randomBytes(n).toString('base64url');
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

/* ---------- التواريخ (تُخزَّن UTC وتُعرض بتوقيت الموقع) ---------- */
const nowIso = () => new Date().toISOString();
const LOCALE = 'ar-EG-u-nu-latn';
const fmtCache = new Map();
function fmt(opts) {
  const key = JSON.stringify(opts);
  if (!fmtCache.has(key)) fmtCache.set(key, new Intl.DateTimeFormat(LOCALE, { timeZone: config.tz, ...opts }));
  return fmtCache.get(key);
}
const fmtDate = (iso) => (iso ? fmt({ day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso)) : '');
const fmtDateTime = (iso) => (iso ? fmt({ day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso)) : '');
const fmtTime = (iso) => (iso ? fmt({ hour: 'numeric', minute: '2-digit' }).format(new Date(iso)) : '');
const fmtWeekday = (iso) => fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));
function relTime(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 60000;
  if (diff < 1) return 'الآن';
  if (diff < 60) return 'منذ ' + arPlural(Math.floor(diff), 'دقيقة', 'دقيقتين', 'دقائق', 'دقيقة');
  if (diff < 1440) return 'منذ ' + arPlural(Math.floor(diff / 60), 'ساعة', 'ساعتين', 'ساعات', 'ساعة');
  return fmtDate(iso);
}
function tzOffsetMs(date, tz = config.tz) {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = Object.fromEntries(dtf.formatToParts(date).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(date.getTime() / 1000) * 1000;
}
// "2026-10-25T14:30" بتوقيت الموقع => ISO بتوقيت UTC
function localInputToUtc(str, tz = config.tz) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(String(str || '').trim());
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
  if (Number.isNaN(guess)) return null;
  let t = guess - tzOffsetMs(new Date(guess), tz);
  const off2 = tzOffsetMs(new Date(t), tz);
  t = guess - off2;
  return new Date(t).toISOString();
}
function utcToLocalInput(iso, tz = config.tz) {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() + tzOffsetMs(d, tz)).toISOString().slice(0, 16);
}
const localDay = (d = new Date()) => utcToLocalInput(d.toISOString()).slice(0, 10);
function addDays(day, n) {
  const d = new Date(day + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(Date.parse(s));
// بداية ونهاية يوم محلي بتوقيت UTC
const dayRange = (day) => [localInputToUtc(day), localInputToUtc(addDays(day, 1))];

const fmtNum = (n) => Number(n || 0).toLocaleString('en-US');
function readMinutes(text) {
  const words = String(text || '').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 180));
}
function paginate(total, page, perPage) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  const p = Math.min(Math.max(1, page || 1), pages);
  return { total, page: p, pages, perPage, offset: (p - 1) * perPage };
}

module.exports = {
  SafeHtml, html, raw, esc, normalizeArabic, slugify, truncate, initials, arPlural,
  isHttpUrl, youtubeId, articleUrl, randomToken, sha256, nowIso, fmtDate, fmtDateTime, fmtTime, fmtWeekday,
  relTime, tzOffsetMs, localInputToUtc, utcToLocalInput, localDay, addDays, isDay, dayRange, fmtNum, readMinutes, paginate,
};
