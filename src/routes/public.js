'use strict';
const R = require('../router');
const config = require('../config');
const { sendHtml, send, redirect, parseBody, sendJson } = require('../http');
const { esc, localDay, addDays, isDay, dayRange, paginate, articleUrl, utcToLocalInput, isHttpUrl, nowIso } = require('../util');
const { formToken, verifyFormToken, rateLimit, ipHash } = require('../security');
const Settings = require('../models/settings');
const Articles = require('../models/articles');
const Ads = require('../models/ads');
const { Breaking, Comments, Stats, Messages } = require('../models/misc');
const { coverSvg } = require('../covers');
const { markupToText } = require('../markup');
const pages = require('../views/pages');
const { all, get: dbGet } = require('../db');

const { Categories } = Articles;

function prepare(ctx) {
  ctx.site = Settings.getAll();
  ctx.nav = Categories.list();
  ctx.breaking = Breaking.active();
  ctx.hasDemo = Articles.hasDemo();
  ctx.day = localDay();
}
function page(ctx, status, body) {
  if (status === 200 && !ctx.isBot && ctx.method === 'GET') Stats.siteView(ctx.day);
  sendHtml(ctx, status, String(body), { 'Cache-Control': status === 200 ? 'public, max-age=30' : 'no-store' });
}
function notFound(ctx) {
  if (!ctx.site) prepare(ctx);
  page(ctx, 404, pages.notFound(ctx, Articles.listLive({ limit: 5 })));
}
const pageNum = (ctx) => Math.max(1, Math.min(1000, parseInt(ctx.query.get('page') || '1', 10) || 1));

// منع احتساب أكثر من مشاهدة لنفس الزائر على نفس الخبر خلال 30 دقيقة
const recentViews = new Map();
setInterval(() => { const now = Date.now(); for (const [k, t] of recentViews) if (t < now) recentViews.delete(k); }, 300000).unref();

/* ======================= الرئيسية ======================= */
R.get('/', (ctx) => {
  prepare(ctx);
  const featured = Articles.listLive({ featured: true, limit: 5 });
  const used = featured.map((a) => a.id);
  const fill = Articles.listLive({ limit: 5 - Math.min(5, featured.length), exclude: used });
  const leadPool = [...featured, ...fill];
  const lead = leadPool[0] || null;
  const top = leadPool.slice(1, 5);
  const shown = leadPool.map((a) => a.id);
  const latest = Articles.listLive({ limit: 10, exclude: shown });
  const mostRead = Articles.mostRead({ sinceDay: addDays(ctx.day, -6), limit: 5 });
  const sectionCats = ctx.nav.filter((c) => c.kind === 'news' && c.show_on_home);
  const sections = sectionCats.map((cat) => ({ cat, items: Articles.listLive({ categoryId: cat.id, limit: 4, notTypes: ['video', 'gallery'] }) })).filter((s) => s.items.length);
  const opCat = ctx.nav.find((c) => c.kind === 'opinion');
  const repCat = ctx.nav.find((c) => c.kind === 'reports');
  page(ctx, 200, pages.home(ctx, {
    lead, top, latest, mostRead, sections,
    opinions: opCat ? Articles.listLive({ types: ['opinion'], limit: 4 }) : [],
    reports: repCat ? Articles.listLive({ types: ['report'], limit: 3 }) : [],
    media: Articles.listLive({ types: ['video', 'gallery'], limit: 4 }),
    tags: Articles.popularTags(14),
  }));
});

/* ======================= الأقسام ======================= */
R.get('/category/:slug', (ctx) => {
  prepare(ctx);
  const cat = Categories.bySlug(ctx.params.slug);
  if (!cat) return notFound(ctx);
  const per = 13;
  const total = Articles.countLive({ categoryId: cat.id });
  const pg = paginate(total, pageNum(ctx), per);
  if (pageNum(ctx) > pg.pages && total) return notFound(ctx);
  const items = Articles.listLive({ categoryId: cat.id, limit: per, offset: pg.offset });
  page(ctx, 200, pages.category(ctx, { cat, items, pg, mostRead: Articles.mostRead({ sinceDay: addDays(ctx.day, -6), limit: 5 }) }));
});

/* ======================= صفحة الخبر ======================= */
function showArticle(ctx) {
  prepare(ctx);
  const id = parseInt(ctx.params.id, 10);
  if (!id || String(id) !== ctx.params.id) return notFound(ctx);
  const a = Articles.getLive(id);
  if (!a) return notFound(ctx);
  if (ctx.params.slug !== a.slug) return redirect(ctx, articleUrl(a) + (ctx.url.search || ''), 301);
  if (!ctx.isBot) {
    const key = `${ipHash(ctx.ip)}:${id}`;
    if (!recentViews.has(key)) { recentViews.set(key, Date.now() + 30 * 60000); Stats.articleView(id, ctx.day); }
  }
  const commentsOpen = ctx.site.comments_enabled === '1' ? !!a.allow_comments : null;
  page(ctx, 200, pages.article(ctx, {
    a, tags: Articles.tagsFor(id), sources: Articles.sourcesFor(id), gallery: Articles.galleryFor(id), related: Articles.related(a, 4),
    mostRead: Articles.mostRead({ sinceDay: addDays(ctx.day, -6), limit: 5 }).filter((m) => m.id !== id).slice(0, 5),
    comments: commentsOpen === null ? [] : Comments.approvedFor(id), commentsOpen, notice: ctx.query.get('comment'),
    formToken: { comment: formToken('comment'), report: formToken('report') },
  }));
}
R.get('/news/:id/:slug', showArticle);
R.get('/news/:id', (ctx) => { ctx.params.slug = ''; showArticle(ctx); });

/* ======================= البحث والأرشيف ======================= */
R.get('/search', (ctx) => {
  prepare(ctx);
  const q = (ctx.query.get('q') || '').trim().slice(0, 100);
  const filters = { category: ctx.query.get('category') || '', from: isDay(ctx.query.get('from')) ? ctx.query.get('from') : '', to: isDay(ctx.query.get('to')) ? ctx.query.get('to') : '' };
  const terms = Articles.searchTerms(q);
  const cat = filters.category ? Categories.bySlug(filters.category) : null;
  if (!cat) filters.category = '';
  const tooShort = !!q && !terms.length;
  const opts = { terms, categoryId: cat?.id, from: filters.from ? dayRange(filters.from)[0] : null, to: filters.to ? dayRange(filters.to)[1] : null };
  const active = !tooShort && (terms.length || cat || filters.from || filters.to);
  const per = 15;
  const total = active ? Articles.countLive(opts) : 0;
  const pg = paginate(total, pageNum(ctx), per);
  const items = active ? Articles.listLive({ ...opts, limit: per, offset: pg.offset }) : [];
  page(ctx, 200, pages.search(ctx, { q, items, pg, filters, tooShort }));
});
R.get('/archive', (ctx) => {
  prepare(ctx);
  let date = ctx.query.get('date') || '';
  if (!isDay(date) || date > ctx.day) date = '';
  const category = ctx.query.get('category') || '';
  const catObj = category ? Categories.bySlug(category) : null;
  let items = [], days = [];
  if (date) {
    const [from, to] = dayRange(date);
    items = Articles.listLive({ from, to, categoryId: catObj?.id, limit: 300 });
  } else {
    const since = dayRange(addDays(ctx.day, -29))[0];
    const rows = all(`SELECT published_at FROM articles WHERE status = 'published' AND published_at >= ? AND published_at <= ?${catObj ? ' AND category_id = ?' : ''} ORDER BY published_at DESC`,
      ...[since, nowIso(), ...(catObj ? [catObj.id] : [])]);
    const map = new Map();
    for (const r of rows) { const d = utcToLocalInput(r.published_at).slice(0, 10); map.set(d, (map.get(d) || 0) + 1); }
    days = [...map].map(([day, n]) => ({ day, n }));
  }
  page(ctx, 200, pages.archive(ctx, { date, category: catObj ? category : '', items, days, catObj }));
});
R.get('/tag/:slug', (ctx) => {
  prepare(ctx);
  const t = Articles.tagBySlug(ctx.params.slug);
  if (!t) return notFound(ctx);
  const per = 15;
  const pg = paginate(Articles.countLive({ tagId: t.id }), pageNum(ctx), per);
  page(ctx, 200, pages.tag(ctx, { tag: t, items: Articles.listLive({ tagId: t.id, limit: per, offset: pg.offset }), pg }));
});
R.get('/author/:id', (ctx) => {
  prepare(ctx);
  const id = parseInt(ctx.params.id, 10);
  const u = id ? require('../models/users').publicProfile(id) : null;
  if (!u) return notFound(ctx);
  const per = 15;
  const pg = paginate(Articles.countLive({ authorId: id }), pageNum(ctx), per);
  page(ctx, 200, pages.author(ctx, { u, items: Articles.listLive({ authorId: id, limit: per, offset: pg.offset }), pg }));
});
R.get('/multimedia', (ctx) => {
  prepare(ctx);
  const per = 12;
  const pg = paginate(Articles.countLive({ types: ['video', 'gallery'] }), pageNum(ctx), per);
  page(ctx, 200, pages.multimedia(ctx, { items: Articles.listLive({ types: ['video', 'gallery'], limit: per, offset: pg.offset }), pg }));
});

/* ======================= صفحات ثابتة ======================= */
R.get('/about', (ctx) => { prepare(ctx); page(ctx, 200, pages.about(ctx)); });
R.get('/privacy', (ctx) => { prepare(ctx); page(ctx, 200, pages.staticPage(ctx, 'privacy_body', 'سياسة الخصوصية', '/privacy')); });
R.get('/terms', (ctx) => { prepare(ctx); page(ctx, 200, pages.staticPage(ctx, 'terms_body', 'شروط الاستخدام', '/terms')); });

/* ======================= أعلن معنا ======================= */
const DURATIONS = ['أسبوع', 'أسبوعان', 'شهر', '3 أشهر', 'أخرى'];
R.get('/advertise', (ctx) => {
  prepare(ctx);
  page(ctx, 200, pages.advertise(ctx, { slots: Ads.activeSlots(), units: Ads.PRICE_UNITS, sent: ctx.query.get('sent') === '1', token: formToken('advertise'), values: { slotKey: ctx.query.get('slot') } }));
});
R.post('/advertise', async (ctx) => {
  prepare(ctx);
  const f = await parseBody(ctx.req);
  const v = { company: f.str('company', 120), contact_name: f.str('contact_name', 80), phone: f.str('phone', 30), email: f.str('email', 120),
    slot_id: f.int('slot_id'), start_date: f.str('start_date', 10), duration: f.str('duration', 20), message: f.str('message', 1500) };
  const errors = [];
  const tokenErr = verifyFormToken('advertise', f.str('token', 100));
  if (f.str('website')) errors.push('تعذر التحقق من الطلب.');
  else if (tokenErr === 'expired' || tokenErr === 'invalid') errors.push('انتهت صلاحية النموذج. أعد إرسال الطلب.');
  else if (tokenErr === 'too_fast') errors.push('تم إرسال النموذج بسرعة غير معتادة. راجع البيانات ثم أعد الإرسال.');
  if (v.company.length < 2) errors.push('اكتب اسم الشركة أو الجهة.');
  if (v.contact_name.length < 2) errors.push('اكتب اسم المسؤول عن التواصل.');
  if (!/^[+\d\s()-]{7,30}$/.test(v.phone)) errors.push('اكتب رقم هاتف صحيحًا.');
  if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) errors.push('البريد الإلكتروني غير صحيح.');
  if (v.slot_id && !Ads.slotById(v.slot_id)) v.slot_id = null;
  if (v.start_date && !isDay(v.start_date)) v.start_date = '';
  if (!DURATIONS.includes(v.duration)) v.duration = 'أخرى';
  if (!errors.length && !rateLimit(`adreq:${ctx.ip}`, 5, 3600000)) errors.push('أرسلت عدة طلبات خلال وقت قصير. حاول لاحقًا أو تواصل معنا مباشرة.');
  if (errors.length) return page(ctx, 400, pages.advertise(ctx, { slots: Ads.activeSlots(), units: Ads.PRICE_UNITS, values: v, errors, token: formToken('advertise') }));
  Ads.createRequest(v);
  redirect(ctx, '/advertise?sent=1#request', 303);
});

/* ======================= اتصل بنا ======================= */
R.get('/contact', (ctx) => { prepare(ctx); page(ctx, 200, pages.contact(ctx, { sent: ctx.query.get('sent') === '1', token: formToken('contact') })); });
R.post('/contact', async (ctx) => {
  prepare(ctx);
  const f = await parseBody(ctx.req);
  const v = { name: f.str('name', 80), email: f.str('email', 120), phone: f.str('phone', 30), subject: f.str('subject', 60), message: f.str('message', 3000) };
  const errors = [];
  const tokenErr = verifyFormToken('contact', f.str('token', 100));
  if (f.str('website')) errors.push('تعذر التحقق من الرسالة.');
  else if (tokenErr) errors.push(tokenErr === 'too_fast' ? 'تم إرسال النموذج بسرعة غير معتادة. راجع الرسالة ثم أعد الإرسال.' : 'انتهت صلاحية النموذج. أعد إرسال الرسالة.');
  if (v.name.length < 2) errors.push('اكتب اسمك.');
  if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) errors.push('البريد الإلكتروني غير صحيح.');
  if (v.phone && !/^[+\d\s()-]{7,30}$/.test(v.phone)) errors.push('رقم الهاتف غير صحيح.');
  if (!v.email && !v.phone) errors.push('اكتب البريد الإلكتروني أو رقم الهاتف للرد عليك.');
  if (!pages.CONTACT_SUBJECTS.includes(v.subject)) v.subject = 'أخرى';
  if (v.message.length < 10) errors.push('الرسالة قصيرة جدًا (10 أحرف على الأقل).');
  if (!errors.length && !rateLimit(`contact:${ctx.ip}`, 5, 3600000)) errors.push('أرسلت عدة رسائل خلال وقت قصير. حاول لاحقًا.');
  if (errors.length) return page(ctx, 400, pages.contact(ctx, { values: v, errors, token: formToken('contact') }));
  Messages.create(v, ipHash(ctx.ip));
  redirect(ctx, '/contact?sent=1', 303);
});

/* ======================= التعليقات ======================= */
R.post('/comments', async (ctx) => {
  prepare(ctx);
  const f = await parseBody(ctx.req);
  const a = Articles.getLive(f.int('article_id') || 0);
  if (!a) return notFound(ctx);
  const back = (n) => redirect(ctx, `${articleUrl(a)}?comment=${n}#comments`, 303);
  if (ctx.site.comments_enabled !== '1' || !a.allow_comments) return back('error');
  const tokenErr = verifyFormToken('comment', f.str('token', 100));
  if (tokenErr === 'expired' || tokenErr === 'invalid') return back('expired');
  if (f.str('website') || tokenErr === 'too_fast') return back('pending'); // روبوت على الأرجح: لا يُحفظ
  const name = f.str('name', 60), body = f.str('body', 1500);
  if (name.length < 2 || body.length < 3) return back('error');
  if (!rateLimit(`comment:${ctx.ip}`, 5, 600000)) return back('limit');
  Comments.create(a.id, name, body, ipHash(ctx.ip));
  back('pending');
});
R.post('/comments/:id/report', async (ctx) => {
  prepare(ctx);
  const f = await parseBody(ctx.req);
  const c = Comments.get(parseInt(ctx.params.id, 10) || 0);
  if (!c || c.status !== 'approved') return notFound(ctx);
  const a = Articles.getLive(c.article_id);
  if (!a) return notFound(ctx);
  const tokenErr = verifyFormToken('report', f.str('token', 100));
  if (tokenErr === 'expired' || tokenErr === 'invalid') return redirect(ctx, `${articleUrl(a)}?comment=expired#comments`, 303);
  if (rateLimit(`report:${ctx.ip}`, 10, 600000)) Comments.report(c.id, f.str('reason', 100), ipHash(ctx.ip));
  redirect(ctx, `${articleUrl(a)}?comment=reported#comments`, 303);
});

/* ======================= نقرات الإعلانات ======================= */
R.get('/go/ad/:id', (ctx) => {
  const target = Ads.registerClick(parseInt(ctx.params.id, 10) || 0, localDay(), !ctx.isBot);
  if (!target || !isHttpUrl(target)) return notFound(ctx);
  ctx.res.writeHead(302, { Location: target, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
  ctx.res.end();
});

/* ======================= صور توضيحية ======================= */
R.get('/demo-img/:name', (ctx) => {
  const m = /^([a-z]+-[a-z0-9]+)\.svg$/.exec(ctx.params.name);
  if (!m) return notFound(ctx);
  send(ctx, 200, coverSvg(m[1]), 'image/svg+xml', { 'Cache-Control': 'public, max-age=604800', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" });
});
R.get('/ph/:name', (ctx) => {
  const m = /^([a-z]+)\.svg$/.exec(ctx.params.name);
  if (!m) return notFound(ctx);
  send(ctx, 200, coverSvg(`${m[1]}-ph`, { label: false }), 'image/svg+xml', { 'Cache-Control': 'public, max-age=604800', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" });
});

/* ======================= SEO ======================= */
const xmlEsc = (s) => esc(s);
R.get('/robots.txt', (ctx) => send(ctx, 200, `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /go/\nDisallow: /search\n\nSitemap: ${config.siteUrl}/sitemap.xml\nSitemap: ${config.siteUrl}/news-sitemap.xml\n`, 'text/plain; charset=utf-8'));
R.get('/sitemap.xml', (ctx) => {
  const urls = [['/', 'hourly'], ['/about', 'monthly'], ['/contact', 'monthly'], ['/advertise', 'monthly'], ['/privacy', 'yearly'], ['/terms', 'yearly'], ['/multimedia', 'daily'], ['/archive', 'daily']]
    .map(([p, f]) => `<url><loc>${config.siteUrl}${p}</loc><changefreq>${f}</changefreq></url>`);
  for (const c of Categories.list()) urls.push(`<url><loc>${config.siteUrl}/category/${c.slug}</loc><changefreq>hourly</changefreq></url>`);
  for (const a of Articles.sitemapRows()) urls.push(`<url><loc>${config.siteUrl}${xmlEsc(articleUrl(a))}</loc><lastmod>${a.updated_at}</lastmod></url>`);
  send(ctx, 200, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`, 'application/xml; charset=utf-8', { 'Cache-Control': 'public, max-age=600' });
});
R.get('/news-sitemap.xml', (ctx) => {
  const site = Settings.getAll();
  const since = new Date(Date.now() - 2 * 86400000).toISOString();
  const rows = Articles.sitemapRows(1000).filter((a) => a.published_at >= since);
  const items = rows.map((a) => `<url><loc>${config.siteUrl}${xmlEsc(articleUrl(a))}</loc><news:news><news:publication><news:name>${xmlEsc(site.site_name)}</news:name><news:language>ar</news:language></news:publication><news:publication_date>${a.published_at}</news:publication_date><news:title>${xmlEsc(a.title)}</news:title></news:news></url>`);
  send(ctx, 200, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">\n${items.join('\n')}\n</urlset>`, 'application/xml; charset=utf-8', { 'Cache-Control': 'public, max-age=300' });
});
R.get('/rss.xml', (ctx) => {
  const site = Settings.getAll();
  const rows = Articles.listLive({ limit: 30 }).filter((a) => !a.is_demo);
  const items = rows.map((a) => `<item><title>${xmlEsc(a.title)}</title><link>${config.siteUrl}${xmlEsc(articleUrl(a))}</link><guid isPermaLink="true">${config.siteUrl}${xmlEsc(articleUrl(a))}</guid><pubDate>${new Date(a.published_at).toUTCString()}</pubDate><category>${xmlEsc(a.cat_name)}</category>${a.excerpt ? `<description>${xmlEsc(a.excerpt)}</description>` : ''}</item>`);
  send(ctx, 200, `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>${xmlEsc(site.site_name)}</title><link>${config.siteUrl}/</link><description>${xmlEsc(site.site_description)}</description><language>ar</language>\n${items.join('\n')}\n</channel></rss>`, 'application/rss+xml; charset=utf-8', { 'Cache-Control': 'public, max-age=300' });
});
R.get('/healthz', (ctx) => {
  const ok = !!dbGet('SELECT 1 AS ok');
  sendJson(ctx, ok ? 200 : 500, { status: ok ? 'ok' : 'error', time: nowIso() });
});

module.exports = { prepare, notFound, page };
