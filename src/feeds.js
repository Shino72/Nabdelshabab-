'use strict';
/*
 * جلب عناوين الأخبار من خلاصات RSS/Atom المرخّصة.
 * يُخزَّن العنوان والرابط وملخص قصير فقط في "صندوق الوارد"، ولا يُنشر أي شيء تلقائيًا:
 * المحرر يحوّل الخبر إلى مسودة، يعيد صياغته ويتحقق منه، ثم ينشره مع ذكر المصدر ورابطه.
 */
const dns = require('node:dns/promises');
const net = require('node:net');
const config = require('./config');
const { truncate } = require('./util');

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const x = ip.toLowerCase();
  return x === '::1' || x === '::' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80') || x.startsWith('::ffff:127.') || x.startsWith('::ffff:10.') || x.startsWith('::ffff:192.168.');
}
async function assertPublicHost(hostname) {
  if (config.feedsAllowPrivate) return;
  const addrs = net.isIP(hostname) ? [{ address: hostname }] : await dns.lookup(hostname, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error('عنوان الخلاصة يشير إلى شبكة داخلية غير مسموح بها');
}

async function fetchText(url, hops = 0) {
  const u = new URL(url);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('الرابط يجب أن يبدأ بـ http أو https');
  await assertPublicHost(u.hostname);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(u, { redirect: 'manual', signal: ctrl.signal, headers: { 'User-Agent': 'NewsroomFeedReader/1.0', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5' } });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      if (hops >= 3) throw new Error('عدد كبير من التحويلات');
      return fetchText(new URL(res.headers.get('location'), u).href, hops + 1);
    }
    if (!res.ok) throw new Error(`استجاب الخادم بالرمز ${res.status}`);
    const reader = res.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 3 * 1024 * 1024) { ctrl.abort(); throw new Error('حجم الخلاصة كبير جدًا'); }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally { clearTimeout(timer); }
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decode(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
}
const stripTags = (s) => decode(decode(s).replace(/<[^>]*>/g, ' ')).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
function tag(xml, names) {
  for (const n of names) {
    const m = new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, 'i').exec(xml);
    if (m) return m[1];
  }
  return '';
}
function parseFeed(xml) {
  const items = [];
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) || xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks.slice(0, 60)) {
    const title = truncate(stripTags(tag(b, ['title'])), 250);
    let link = stripTags(tag(b, ['link']));
    if (!link) {
      const m = /<link\b[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i.exec(b) || /<link\b[^>]*href=["']([^"']+)["']/i.exec(b);
      if (m) link = decode(m[1]);
    }
    if (link && !/^https?:\/\//i.test(link)) link = '';
    const guid = truncate(stripTags(tag(b, ['guid', 'id'])) || link || title, 500);
    const dateRaw = stripTags(tag(b, ['pubDate', 'published', 'updated', 'dc:date']));
    const d = dateRaw ? new Date(dateRaw) : null;
    const summary = truncate(stripTags(tag(b, ['description', 'summary', 'content:encoded', 'content'])), 300);
    if (title && guid) items.push({ title, link, guid, summary, published_at: d && !Number.isNaN(d.getTime()) ? d.toISOString() : null });
  }
  return items;
}
async function fetchFeed(url) { return parseFeed(await fetchText(url)); }

module.exports = { fetchFeed, parseFeed, isPrivateIp };
