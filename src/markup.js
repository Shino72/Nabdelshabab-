'use strict';
/*
 * صيغة كتابة المقالات (آمنة: لا يُسمح بأي HTML خام)
 *   فقرة: سطر أو أكثر، والفصل بين الفقرات بسطر فارغ
 *   ## عنوان فرعي      ### عنوان أصغر
 *   > اقتباس
 *   - بند في قائمة      1. بند مرقّم
 *   **نص غامق**         [نص الرابط](https://example.com)
 *   ![وصف الصورة](/uploads/2026/10/photo.jpg)
 */
const { esc } = require('./util');

const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function safeUrl(u) {
  u = String(u || '').trim();
  if (/^\/(?!\/)[^\s]*$/.test(u)) return u;
  try {
    const x = new URL(u);
    if (x.protocol === 'http:' || x.protocol === 'https:') return x.href;
  } catch { /* تجاهل */ }
  return null;
}
const safeImg = (u) => (/^\/(uploads|demo-img)\/[\w\-./]+\.(jpe?g|png|webp|gif|svg)$/i.test(u) && !u.includes('..') ? u : null);

function inline(text) {
  let s = esc(text);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (all, label, url) => {
    const u = safeUrl(unesc(url));
    if (!u) return label;
    const ext = /^https?:/i.test(u);
    return `<a href="${esc(u)}"${ext ? ' rel="noopener nofollow" target="_blank"' : ''}>${label}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return s;
}

function renderMarkup(src) {
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [], list = null, quote = [];
  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<${list.t}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.t}>`); list = null; } };
  const flushQuote = () => { if (quote.length) { out.push(`<blockquote><p>${inline(quote.join(' '))}</p></blockquote>`); quote = []; } };
  const flushAll = () => { flushPara(); flushList(); flushQuote(); };
  for (const rawLine of lines) {
    const line = rawLine.trim();
    let m;
    if (!line) { flushAll(); continue; }
    if ((m = /^(#{2,3})\s+(.+)$/.exec(line))) { flushAll(); const l = m[1].length; out.push(`<h${l}>${inline(m[2])}</h${l}>`); continue; }
    if ((m = /^!\[([^\]]*)\]\((\S+?)\)$/.exec(line))) {
      flushAll();
      const src = safeImg(m[2]);
      if (src) out.push(`<figure><img src="${esc(src)}" alt="${esc(m[1])}" loading="lazy" decoding="async">${m[1] ? `<figcaption>${esc(m[1])}</figcaption>` : ''}</figure>`);
      continue;
    }
    if ((m = /^>\s?(.*)$/.exec(line))) { flushPara(); flushList(); quote.push(m[1]); continue; }
    if ((m = /^[-*•]\s+(.+)$/.exec(line))) { flushPara(); flushQuote(); if (!list || list.t !== 'ul') { flushList(); list = { t: 'ul', items: [] }; } list.items.push(m[1]); continue; }
    if ((m = /^(?:\d+|[٠-٩]+)[.)]\s+(.+)$/.exec(line))) { flushPara(); flushQuote(); if (!list || list.t !== 'ol') { flushList(); list = { t: 'ol', items: [] }; } list.items.push(m[1]); continue; }
    flushList(); flushQuote();
    para.push(line);
  }
  flushAll();
  return out.join('\n');
}

function markupToText(src) {
  return String(src || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/^\s*(#{2,3}|>|[-*•]|\d+[.)])\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// إدراج محتوى (مثل إعلان) بعد الفقرة رقم n
function insertAfterParagraph(htmlStr, n, insert) {
  let count = 0;
  let done = false;
  const out = htmlStr.replace(/<\/p>/g, (m) => {
    count++;
    if (count === n && !done) { done = true; return m + insert; }
    return m;
  });
  return done ? out : out + insert;
}

module.exports = { renderMarkup, markupToText, insertAfterParagraph, safeUrl, safeImg };
