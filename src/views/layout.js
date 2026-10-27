'use strict';
const { html, raw, esc, relTime, fmtDate, fmtWeekday, articleUrl, initials } = require('../util');
const Settings = require('../models/settings');
const config = require('../config');
const assets = require('../assets');

const THEME_SCRIPT = "(function(){document.documentElement.classList.add('js');try{var t=localStorage.getItem('theme');if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t)}catch(e){}})();";
const FONTS = 'https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@500;700;800&family=Noto+Naskh+Arabic:wght@400;500;700&display=swap';

const logoMark = (cls = 'mark') => raw(`<svg class="${cls}" viewBox="0 0 40 40" aria-hidden="true" focusable="false"><rect x="1.6" y="1.6" width="36.8" height="36.8" rx="10" fill="none" stroke="currentColor" stroke-width="2.8"/><path d="M5.5 21.5h6.5l3-7.5 5.2 14.5 4.1-10.5 2.2 3.5h8" fill="none" stroke="#d21f30" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`);

const ICONS = {
  social_facebook: ['فيسبوك', '<path d="M14 8h3V4h-3c-2.8 0-4.5 1.8-4.5 4.6V11H7v4h2.5v9h4v-9h3l.7-4h-3.7V8.9c0-.6.3-.9 1-.9z"/>'],
  social_x: ['إكس', '<path d="M4 3h4.6l4 5.6L17.2 3h3.1l-6.2 7.2L21 21h-4.6l-4.5-6.2L6.6 21H3.5l6.9-8z"/>'],
  social_youtube: ['يوتيوب', '<path d="M22 8.2c-.2-1.6-1-2.6-2.6-2.8C17 5 12 5 12 5s-5 0-7.4.4C3 5.6 2.2 6.6 2 8.2 1.8 9.6 1.8 12 1.8 12s0 2.4.2 3.8c.2 1.6 1 2.6 2.6 2.8C7 19 12 19 12 19s5 0 7.4-.4c1.6-.2 2.4-1.2 2.6-2.8.2-1.4.2-3.8.2-3.8s0-2.4-.2-3.8zM10 15V9l5 3z"/>'],
  social_instagram: ['إنستجرام', '<rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17.5" cy="6.5" r="1.3"/>'],
  social_tiktok: ['تيك توك', '<path d="M16 3c.4 2.4 1.9 3.9 4.3 4.1v3.2c-1.6 0-3-.5-4.3-1.4V15a6 6 0 1 1-6-6h.6v3.3H10a2.7 2.7 0 1 0 2.7 2.7V3z"/>'],
  social_telegram: ['تيليجرام', '<path d="M21.4 3.6 2.9 10.8c-1 .4-1 1.6.1 1.9l4.6 1.4 1.8 5.6c.2.8 1.2 1 1.8.4l2.6-2.4 4.8 3.5c.7.5 1.7.1 1.9-.8l3.1-15c.2-1.1-.9-2.2-2.2-1.8zm-11.6 10.6-.3 3.6-1.3-4.3 9.6-6.6z"/>'],
};
function socialLinks(site, cls = 'social') {
  const items = Object.entries(ICONS).filter(([k]) => /^https?:\/\//.test(site[k] || ''));
  if (!items.length) return '';
  return html`<ul class="${cls}">${items.map(([k, [label, path]]) => html`<li><a href="${site[k]}" rel="noopener me" target="_blank" aria-label="${label}"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${raw(path)}</svg></a></li>`)}</ul>`;
}

const demoBadge = (a) => (a && a.is_demo ? html`<span class="demo-badge" title="محتوى تجريبي لعرض التصميم">تجريبي</span>` : '');
const coverOf = (a) => a.cover_image || `/ph/${a.cat_slug || 'default'}.svg`;
function img(src, alt, cls = '', eager = false) {
  return html`<img class="${cls}" src="${src}" alt="${alt || ''}" width="1200" height="675" ${raw(eager ? 'fetchpriority="high"' : 'loading="lazy"')} decoding="async">`;
}
const typeBadge = (a) => (a.type === 'video' ? html`<span class="type-badge">فيديو</span>` : a.type === 'gallery' ? html`<span class="type-badge">صور</span>` : '');
function meta(a, { cat = true, abs = false } = {}) {
  return html`<div class="meta">${cat ? html`<a class="cat" href="/category/${a.cat_slug}">${a.cat_name}</a>` : ''}<time datetime="${a.published_at}">${abs ? fmtDate(a.published_at) : relTime(a.published_at)}</time>${demoBadge(a)}</div>`;
}
function storyCard(a, { excerpt = false, cat = true } = {}) {
  return html`<article class="story-card">
    <a class="thumb" href="${articleUrl(a)}" tabindex="-1" aria-hidden="true">${img(coverOf(a), '')}${typeBadge(a)}</a>
    ${meta(a, { cat })}
    <h3><a href="${articleUrl(a)}">${a.title}</a></h3>
    ${excerpt && a.excerpt ? html`<p class="dek">${a.excerpt}</p>` : ''}
  </article>`;
}
function storyRow(a, { cat = true } = {}) {
  return html`<article class="story-row">
    <a class="thumb" href="${articleUrl(a)}" tabindex="-1" aria-hidden="true">${img(coverOf(a), '')}</a>
    <div><h3><a href="${articleUrl(a)}">${a.title}</a></h3>${meta(a, { cat })}</div>
  </article>`;
}
const storyLine = (a) => html`<li><h3><a href="${articleUrl(a)}">${a.title}</a></h3>${meta(a)}</li>`;
function sectionHead(title, href, tag = 'h2', short = false) {
  const more = short ? html`<a class="more" href="${href}" aria-label="المزيد من ${title}">المزيد</a>` : html`<a class="more" href="${href}">المزيد من ${title}</a>`;
  return html`<div class="sec-head">${raw(`<${tag}>`)}<span class="needle" aria-hidden="true"></span>${title}${raw(`</${tag}>`)}${href ? more : ''}</div>`;
}
function opinionCard(a) {
  return html`<article class="op-card">
    <div class="op-author"><span class="avatar" aria-hidden="true">${initials(a.author_name)}</span><a href="/author/${a.author_id}">${a.author_name || 'كاتب'}</a></div>
    <h3><a href="${articleUrl(a)}">${a.title}</a></h3>
    ${a.excerpt ? html`<p>${a.excerpt}</p>` : ''}
    ${meta(a, { cat: false })}
  </article>`;
}

/* ---------- الإعلانات ---------- */
function adSlot(ctx, key) {
  const Ads = require('../models/ads');
  const ad = Ads.pickForSlot(key);
  if (ad) {
    if (!ctx.isBot && !ctx.noCount) Ads.countImpression(ad.id, ctx.day);
    return html`<aside class="ad ad-${ad.width}x${ad.height}" aria-label="إعلان"><span class="ad-label">إعلان</span>
      <a href="/go/ad/${ad.id}" rel="sponsored noopener" target="_blank"><img src="${ad.image}" alt="${ad.alt_text || ad.title}" width="${ad.width}" height="${ad.height}" loading="lazy"></a></aside>`;
  }
  if (ctx.site.show_empty_ad_slots !== '1') return '';
  const slot = Ads.slotByKey(key);
  if (!slot || !slot.active) return '';
  return html`<aside class="ad ad-${slot.width}x${slot.height} ad-empty" aria-label="مساحة إعلانية"><a href="/advertise?slot=${slot.key}">
    <span class="ad-empty-title">مساحة إعلانية متاحة</span><span class="ad-empty-size">${slot.width}×${slot.height}</span><span class="ad-empty-cta">احجز هذه المساحة</span></a></aside>`;
}

/* ---------- ترقيم الصفحات ---------- */
function pagination(pg, baseUrl, query = {}) {
  if (pg.pages <= 1) return '';
  const link = (p) => { const q = new URLSearchParams({ ...query, ...(p > 1 ? { page: p } : {}) }); const s = q.toString(); return s ? `${baseUrl}?${s}` : baseUrl; };
  const nums = [];
  for (let p = Math.max(1, pg.page - 2); p <= Math.min(pg.pages, pg.page + 2); p++) nums.push(p);
  return html`<nav class="pager" aria-label="التنقل بين الصفحات">
    ${pg.page > 1 ? html`<a href="${link(pg.page - 1)}" rel="prev">السابق</a>` : ''}
    ${nums.map((p) => (p === pg.page ? html`<span aria-current="page">${p}</span>` : html`<a href="${link(p)}">${p}</a>`))}
    ${pg.page < pg.pages ? html`<a href="${link(pg.page + 1)}" rel="next">التالي</a>` : ''}
  </nav>`;
}

const jsonLd = (obj) => raw(`<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`);

/* ---------- الهيكل العام للصفحة ---------- */
function layout(ctx, { title, description, canonical, image, ogType = 'website', noindex = false, jsonld = [], body, active = '' }) {
  const site = ctx.site;
  const fullTitle = title ? `${title} | ${site.site_name}` : `${site.site_name}: ${site.site_tagline}`;
  const desc = description || site.site_description;
  const canon = canonical ? config.siteUrl + canonical : null;
  const ogImage = image ? (image.startsWith('http') ? image : config.siteUrl + image) : config.siteUrl + '/static/img/og-default.png';
  const nav = ctx.nav.filter((c) => c.slug !== 'multimedia');
  return html`<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${fullTitle}</title>
<meta name="description" content="${desc}">
${canon ? html`<link rel="canonical" href="${canon}">` : ''}
${noindex ? raw('<meta name="robots" content="noindex, follow">') : ''}
<meta property="og:site_name" content="${site.site_name}">
<meta property="og:locale" content="ar_EG">
<meta property="og:type" content="${ogType}">
<meta property="og:title" content="${title || site.site_name}">
<meta property="og:description" content="${desc}">
${canon ? html`<meta property="og:url" content="${canon}">` : ''}
<meta property="og:image" content="${ogImage}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#0f2342">
<link rel="icon" href="/static/img/favicon.svg" type="image/svg+xml">
<link rel="alternate" type="application/rss+xml" title="${site.site_name}" href="/rss.xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<link rel="stylesheet" href="${assets.url('css/site.css')}">
<script>${raw(THEME_SCRIPT)}</script>
${jsonld.map(jsonLd)}
</head>
<body>
<a class="skip" href="#main">تخطَّ إلى المحتوى الرئيسي</a>
${ctx.hasDemo ? html`<div class="demo-banner" role="note">يعرض الموقع حاليًا محتوى تجريبيًا لأغراض العرض فقط. الأخبار والصور الموجودة ليست حقيقية، ويمكن حذفها من لوحة التحكم.</div>` : ''}
<header class="site-header">
  <div class="topbar"><div class="wrap topbar-inner">
    <span class="today">${fmtWeekday(new Date().toISOString())}</span>
    <nav class="top-links" aria-label="روابط الموقع"><a href="/about">عن ${site.site_name}</a><a href="/advertise">أعلن معنا</a><a href="/contact">اتصل بنا</a><a href="/archive">الأرشيف</a></nav>
    ${socialLinks(site)}
    <button class="theme-toggle" type="button" aria-label="تبديل الوضع الليلي" data-theme-toggle><svg viewBox="0 0 24 24" aria-hidden="true"><path class="moon" d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/><g class="sun"><circle cx="12" cy="12" r="4.2"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></g></svg><span data-theme-label>الوضع الليلي</span></button>
  </div></div>
  <div class="wrap masthead">
    <a class="brand" href="/" aria-label="${site.site_name}: الصفحة الرئيسية">${logoMark()}<span class="brand-text"><span class="brand-name">${site.site_name}</span><span class="brand-tag">${site.site_tagline}</span></span></a>
    <form class="search" action="/search" method="get" role="search"><label class="sr-only" for="q-top">ابحث في الأخبار والمقالات</label><input id="q-top" name="q" type="search" placeholder="ابحث في الأخبار والمقالات" maxlength="100" value="${ctx.searchQuery || ''}"><button type="submit">بحث</button></form>
    <a class="cta-ad" href="/advertise">أعلن معنا</a>
    <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="main-nav" data-menu-toggle><span class="bars" aria-hidden="true"></span>الأقسام</button>
  </div>
  <nav id="main-nav" class="main-nav" aria-label="الأقسام الرئيسية"><div class="wrap"><ul>
    <li><a href="/" ${raw(active === 'home' ? 'aria-current="page"' : '')}>الرئيسية</a></li>
    ${nav.map((c) => html`<li><a href="/category/${c.slug}" ${raw(active === c.slug ? 'aria-current="page"' : '')}>${c.name}</a></li>`)}
    <li><a href="/multimedia" ${raw(active === 'multimedia' ? 'aria-current="page"' : '')}>الوسائط المتعددة</a></li>
  </ul></div></nav>
  ${ticker(ctx.breaking)}
</header>
<main id="main" tabindex="-1">
${body}
</main>
${footer(ctx)}
<script src="${assets.url('js/site.js')}" defer></script>
</body>
</html>`;
}

function ticker(items) {
  if (!items || !items.length) return '';
  const li = (b, hidden) => html`<li>${b.article_id ? html`<a href="${articleUrl({ id: b.article_id, slug: b.article_slug })}" ${raw(hidden ? 'tabindex="-1"' : '')}>${b.text}</a>` : html`<span>${b.text}</span>`}</li>`;
  return html`<div class="ticker" role="region" aria-label="أخبار عاجلة"><div class="wrap ticker-inner">
    <strong class="ticker-label"><span class="pulse" aria-hidden="true"></span>عاجل</strong>
    <div class="ticker-viewport"><div class="ticker-track" data-ticker>
      <ul>${items.map((b) => li(b, false))}</ul><ul aria-hidden="true">${items.map((b) => li(b, true))}</ul>
    </div></div>
    <button class="ticker-pause" type="button" aria-pressed="false" data-ticker-pause>إيقاف مؤقت</button>
  </div></div>`;
}

function footer(ctx) {
  const site = ctx.site;
  const credits = Settings.credits(site);
  const year = new Date().getFullYear();
  return html`<footer class="site-footer">
  <div class="wrap footer-grid">
    <div class="footer-brand">
      <a class="brand brand-footer" href="/">${logoMark()}<span class="brand-text"><span class="brand-name">${site.site_name}</span><span class="brand-tag">${site.site_tagline}</span></span></a>
      <p>${site.site_description}</p>
      ${socialLinks(site, 'social social-footer')}
    </div>
    <nav aria-label="الأقسام"><h2>الأقسام</h2><ul class="footer-cats">${ctx.nav.map((c) => html`<li><a href="/category/${c.slug}">${c.name}</a></li>`)}</ul></nav>
    <nav aria-label="عن الموقع"><h2>الموقع</h2><ul>
      <li><a href="/about">عن ${site.site_name}</a></li><li><a href="/contact">اتصل بنا</a></li><li><a href="/advertise">أعلن معنا</a></li><li><a href="/archive">أرشيف الأخبار</a></li>
      <li><a href="/privacy">سياسة الخصوصية</a></li><li><a href="/terms">شروط الاستخدام</a></li><li><a href="/rss.xml">خلاصة RSS</a></li>
    </ul></nav>
    <div><h2>تواصل معنا</h2><ul class="contact-list">
      ${site.contact_email ? html`<li><a href="mailto:${site.contact_email}">${site.contact_email}</a></li>` : ''}
      ${site.contact_phone ? html`<li><a href="tel:${site.contact_phone.replace(/[^\d+]/g, '')}" dir="ltr">${site.contact_phone}</a></li>` : ''}
      ${site.address ? html`<li>${site.address}</li>` : ''}
    </ul></div>
  </div>
  ${credits.length ? html`<div class="wrap credits" aria-label="إدارة الموقع">${credits.map((c) => html`<p>${c.label ? html`<span>${c.label}:</span> ` : ''}<strong>${c.name}</strong></p>`)}</div>` : ''}
  <div class="wrap footer-bottom"><p>© ${year} ${site.site_name}. ${site.footer_note}</p></div>
</footer>`;
}

module.exports = { layout, logoMark, storyCard, storyRow, storyLine, sectionHead, opinionCard, adSlot, pagination, meta, img, coverOf, demoBadge, typeBadge, THEME_SCRIPT, FONTS, socialLinks, esc };
