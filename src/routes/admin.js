'use strict';
const R = require('../router');
const config = require('../config');
const { parseBody, sendHtml, sendJson, send, redirect, setCookie } = require('../http');
const S = require('../security');
const U = require('../util');
const { renderMarkup, safeImg } = require('../markup');
const { saveImage, removeFile } = require('../uploads');
const Settings = require('../models/settings');
const Articles = require('../models/articles');
const Users = require('../models/users');
const Ads = require('../models/ads');
const { Breaking, Comments, Media, Stats, Feeds, Messages, Audit } = require('../models/misc');
const A = require('../views/admin');
const pages = require('../views/pages');
const pub = require('./public');
const { fetchFeed } = require('../feeds');

const { Categories } = Articles;
const { can } = S;

/* ======================= الحماية ======================= */
function loadSession(ctx) {
  const s = S.getSession(ctx.cookies.sid);
  if (!s) return false;
  ctx.session = s;
  ctx.user = s.user;
  return true;
}
const out = (ctx, body, status = 200) => sendHtml(ctx, status, String(body), { 'Cache-Control': 'no-store' });
const back = (ctx, path, key, kind = 'ok', detail) => redirect(ctx, `${path}${path.includes('?') ? '&' : '?'}${kind}=${key}${detail ? `&detail=${encodeURIComponent(detail)}` : ''}`, 303);
const intParam = (ctx, k = 'id') => { const n = parseInt(ctx.params[k], 10); return String(n) === ctx.params[k] ? n : 0; };

function guard(perm, handler, opts = {}) {
  return async (ctx) => {
    ctx.site = Settings.getAll();
    ctx.noCount = true;
    const api = !!opts.api;
    if (!loadSession(ctx)) {
      if (api) return sendJson(ctx, 401, { error: 'unauthorized', message: 'سجّل الدخول أولًا' });
      if (ctx.method === 'GET') return redirect(ctx, `/admin/login?next=${encodeURIComponent(ctx.url.pathname + ctx.url.search)}`);
      return out(ctx, A.shell('انتهت الجلسة', U.html`<main class="login-wrap"><p class="login-card">انتهت جلستك. <a href="/admin/login">سجّل الدخول مرة أخرى</a>.</p></main>`), 401);
    }
    if (ctx.method !== 'GET' && ctx.method !== 'HEAD') {
      ctx.form = await parseBody(ctx.req);
      const token = ctx.form.str('_csrf', 100) || String(ctx.req.headers['x-csrf-token'] || '');
      if (!S.safeEqual(token, ctx.session.csrf)) return api ? sendJson(ctx, 403, { error: 'csrf', message: 'رمز الحماية غير صالح' }) : out(ctx, A.shell('طلب مرفوض', U.html`<main class="login-wrap"><p class="login-card">تعذر التحقق من الطلب (رمز الحماية غير صالح). أعد تحميل الصفحة وحاول مرة أخرى.</p></main>`), 403);
    }
    if (perm && !can(ctx.user, perm)) return api ? sendJson(ctx, 403, { error: 'forbidden', message: 'ليست لديك صلاحية لهذا الإجراء' }) : out(ctx, A.forbidden(ctx), 403);
    ctx.badges = {
      messages: can(ctx.user, 'messages.view') ? Messages.counts().new : 0,
      pending: can(ctx.user, 'articles.publish') ? Articles.statusCounts().pending : 0,
      comments: can(ctx.user, 'comments.moderate') ? Comments.counts().pending : 0,
      requests: can(ctx.user, 'ads.manage') ? Ads.newRequestsCount() : 0,
    };
    return handler(ctx);
  };
}
const audit = (ctx, action, entity, id, details) => Audit.log(ctx.user?.id, action, entity, id, details);

/* ======================= الدخول والخروج ======================= */
R.get('/admin/login', (ctx) => {
  ctx.site = Settings.getAll();
  if (loadSession(ctx)) return redirect(ctx, '/admin');
  const token = U.randomToken(18);
  setCookie(ctx.res, 'lcsrf', token, { maxAge: 3600, sameSite: 'Strict', path: '/admin' });
  out(ctx, A.login(ctx, { csrfToken: token, next: ctx.query.get('next') || '' }));
});
R.post('/admin/login', async (ctx) => {
  ctx.site = Settings.getAll();
  const f = await parseBody(ctx.req);
  const email = f.str('email', 120).toLowerCase();
  const next = f.str('next', 300);
  const token = U.randomToken(18);
  const fail = (msg, status) => { setCookie(ctx.res, 'lcsrf', token, { maxAge: 3600, sameSite: 'Strict', path: '/admin' }); out(ctx, A.login(ctx, { error: msg, email, next, csrfToken: token }), status); };
  if (!S.safeEqual(f.str('_lcsrf', 100), ctx.cookies.lcsrf)) return fail('انتهت صلاحية صفحة الدخول. حاول مرة أخرى.', 403);
  if (!S.rateLimit(`login-ip:${ctx.ip}`, 20, 900000) || !S.rateLimit(`login:${email}`, 6, 900000)) {
    return fail('محاولات دخول كثيرة. انتظر 15 دقيقة ثم حاول مرة أخرى.', 429);
  }
  const user = Users.getByEmail(email);
  const ok = user ? await S.verifyPassword(f.str('password', 200), user.password_hash) : await S.dummyVerify(f.str('password', 200));
  if (!ok || !user.active) return fail('البريد الإلكتروني أو كلمة المرور غير صحيحة.', 401);
  S.resetRate(`login:${email}`);
  const s = S.createSession(user.id, ctx.ip, ctx.req.headers['user-agent']);
  setCookie(ctx.res, 'sid', s.token, { maxAge: S.SESSION_DAYS * 86400 });
  setCookie(ctx.res, 'lcsrf', '', { maxAge: 0, path: '/admin' });
  Users.touchLogin(user.id);
  Audit.log(user.id, 'سجّل الدخول');
  redirect(ctx, /^\/admin(\/|$|\?)/.test(next) && !next.startsWith('//') ? next : '/admin', 303);
});
R.post('/admin/logout', guard(null, (ctx) => {
  S.destroySession(ctx.cookies.sid);
  setCookie(ctx.res, 'sid', '', { maxAge: 0 });
  redirect(ctx, '/admin/login', 303);
}));

/* ======================= لوحة المعلومات ======================= */
R.get('/admin', guard(null, (ctx) => {
  const u = ctx.user;
  const today = U.localDay();
  const editorView = can(u, 'articles.edit_any');
  const d = { counts: Articles.statusCounts(editorView ? null : u.id), demoCount: require('../seed').demoCount(), comments: null };
  if (can(u, 'stats.view')) {
    const series = Stats.siteSeries(U.addDays(today, -13), today);
    d.series = series;
    d.stats = { today: series[series.length - 1].views, week: series.slice(-7).reduce((s, x) => s + x.views, 0) };
    d.top = Stats.topArticles(U.addDays(today, -6), today, 6);
  }
  if (can(u, 'comments.moderate')) d.comments = Comments.counts().pending;
  if (can(u, 'ads.manage')) d.ads = { running: Ads.runningCount(), requests: Ads.newRequestsCount() };
  if (editorView || can(u, 'users.manage')) d.activity = Audit.recent(10);
  else d.mine = Articles.adminList({ authorId: u.id, limit: 8 }).rows;
  out(ctx, A.dashboard(ctx, d));
}));

/* ======================= المواد ======================= */
R.get('/admin/articles', guard('articles.create', (ctx) => {
  const u = ctx.user;
  const own = can(u, 'articles.edit_any') ? null : u.id;
  const status = ['draft', 'pending', 'published', 'scheduled', 'archived'].includes(ctx.query.get('status')) ? ctx.query.get('status') : '';
  const filters = { status, q: (ctx.query.get('q') || '').slice(0, 100), category: parseInt(ctx.query.get('category') || '', 10) || '' };
  const per = 25;
  const page = parseInt(ctx.query.get('page') || '1', 10) || 1;
  const first = Articles.adminList({ ...filters, categoryId: filters.category, authorId: own, limit: per, offset: (page - 1) * per });
  const pg = U.paginate(first.total, page, per);
  const res = pg.page === page ? first : Articles.adminList({ ...filters, categoryId: filters.category, authorId: own, limit: per, offset: pg.offset });
  out(ctx, A.articlesList(ctx, { rows: res.rows, counts: Articles.statusCounts(own), pg, filters, categories: Categories.list() }));
}));

function editorData(a) {
  return { categories: Categories.list(), authors: Users.authors() };
}
function canEdit(u, a) {
  if (can(u, 'articles.edit_any')) return true;
  return (a.created_by === u.id || a.author_id === u.id) && ['draft', 'pending'].includes(a.status);
}
R.get('/admin/articles/new', guard('articles.create', (ctx) => {
  out(ctx, A.articleForm(ctx, { a: { author_id: ctx.user.id, allow_comments: 1 }, ...editorData() }));
}));
R.get('/admin/articles/:id/edit', guard('articles.create', (ctx) => {
  const a = Articles.getAny(intParam(ctx));
  if (!a) return back(ctx, '/admin/articles', 'not_found', 'err');
  if (!canEdit(ctx.user, a)) return out(ctx, A.forbidden(ctx), 403);
  a.tags = Articles.tagsFor(a.id);
  a.sources = Articles.sourcesFor(a.id);
  a.gallery = Articles.galleryFor(a.id);
  out(ctx, A.articleForm(ctx, { a, ...editorData() }));
}));

const splitLines = (s) => s.split('\n').map((l) => l.trim()).filter(Boolean);
function buildArticle(f, u, existing) {
  const canPub = can(u, 'articles.publish');
  const action = f.str('action', 20) || 'draft';
  const errors = [];
  const d = {
    id: existing?.id, title: f.str('title', 200), excerpt: f.str('excerpt', 400), body: f.str('body', 60000),
    cover_image: f.str('cover_image', 300), cover_caption: f.str('cover_caption', 200), category_id: f.int('category_id'),
    type: A.TYPES[f.str('type', 20)] ? f.str('type', 20) : 'news',
    author_id: can(u, 'articles.edit_any') ? f.int('author_id') : (existing?.author_id || u.id),
    is_featured: canPub ? f.bool('is_featured') : !!existing?.is_featured, allow_comments: f.bool('allow_comments'),
    meta_title: f.str('meta_title', 70), meta_description: f.str('meta_description', 160),
    slug: U.slugify(f.str('slug', 80) || f.str('title', 200)), video_url: f.str('video_url', 200), video_id: null,
    galleryText: f.str('gallery', 5000), sourcesText: f.str('sources', 3000), tagsText: f.str('tags', 400),
  };
  if (d.title.length < 5) errors.push('العنوان قصير جدًا (5 أحرف على الأقل).');
  if (!d.category_id || !Categories.byId(d.category_id)) errors.push('اختر القسم الذي تتبعه المادة.');
  if (!d.author_id || !Users.get(d.author_id)) d.author_id = u.id;
  const file = f.file('cover_file');
  if (file) {
    const saved = saveImage(file);
    if (saved.error) errors.push(`صورة الغلاف: ${saved.error}`);
    else { Media.create(saved, u.id); d.cover_image = saved.path; }
  } else if (d.cover_image && !safeImg(d.cover_image)) errors.push('رابط صورة الغلاف غير صالح. اختر صورة من مكتبة الوسائط.');
  if (d.video_url) { d.video_id = U.youtubeId(d.video_url); if (!d.video_id) errors.push('رابط الفيديو غير صالح. استخدم رابط فيديو من يوتيوب.'); }
  d.gallery = [];
  for (const line of splitLines(d.galleryText).slice(0, 40)) {
    const [img, ...cap] = line.split('|');
    if (!safeImg(img.trim())) { errors.push(`صورة غير صالحة في المعرض: ${U.truncate(img, 60)}`); continue; }
    d.gallery.push({ image: img.trim(), caption: cap.join('|').trim().slice(0, 200) });
  }
  d.sources = [];
  for (const line of splitLines(d.sourcesText).slice(0, 15)) {
    const i = line.lastIndexOf('|');
    const name = (i > 0 ? line.slice(0, i) : line).trim().slice(0, 120);
    const url = i > 0 ? line.slice(i + 1).trim() : '';
    if (url && !U.isHttpUrl(url)) { errors.push(`رابط المصدر غير صالح: ${U.truncate(url, 60)}`); continue; }
    if (name) d.sources.push({ name, url });
  }
  d.tags = d.tagsText.split(/[,،]/).map((t) => t.trim()).filter(Boolean).slice(0, 15);

  // تحديد الحالة وموعد النشر حسب الإجراء والصلاحية
  let status, publishedAt = existing?.published_at || null, note = existing?.review_note || null, ok;
  const wasLive = existing && existing.status === 'published' && existing.published_at <= U.nowIso();
  const publishInput = f.str('publish_at', 20);
  if (!canPub) {
    status = action === 'submit' ? 'pending' : 'draft';
    ok = action === 'submit' ? 'submitted' : 'draft';
  } else if (action === 'publish') {
    status = 'published'; publishedAt = wasLive ? existing.published_at : U.nowIso(); note = null; ok = 'published';
  } else if (action === 'schedule') {
    const when = U.localInputToUtc(publishInput);
    if (!when || when <= U.nowIso()) errors.push('اختر موعد نشر صحيحًا في المستقبل لجدولة المادة.');
    status = 'published'; publishedAt = when; note = null; ok = 'scheduled';
  } else if (action === 'return') {
    status = 'draft'; note = f.str('review_note', 500) || 'يُرجى مراجعة المادة وتعديلها.'; ok = 'returned';
  } else if (action === 'archive') {
    status = 'archived'; ok = 'archived';
  } else if (action === 'submit') {
    status = 'pending'; ok = 'submitted';
  } else {
    status = 'draft'; ok = 'draft';
  }
  if (!errors.length) {
    d.status = status;
    d.published_at = status === 'published' ? publishedAt : (status === 'archived' ? existing?.published_at : null);
    d.review_note = note;
  }
  return { d, errors, ok, publishInput };
}
const SAVE_LABELS = { published: 'نشر مادة', scheduled: 'جدول مادة', submitted: 'أرسل مادة للمراجعة', returned: 'أعاد مادة للكاتب', archived: 'أرشف مادة', draft: 'حفظ مسودة' };
async function saveArticle(ctx, existing) {
  const u = ctx.user;
  if (existing && !canEdit(u, existing)) return out(ctx, A.forbidden(ctx), 403);
  const { d, errors, ok, publishInput } = buildArticle(ctx.form, u, existing);
  if (errors.length) {
    const a = { ...existing, ...d, status: existing?.status || 'draft', published_at: existing?.published_at, publish_at_input: publishInput, created_by: existing?.created_by };
    return out(ctx, A.articleForm(ctx, { a, errors, ...editorData() }), 400);
  }
  const id = Articles.save(d, u.id);
  audit(ctx, SAVE_LABELS[ok], 'article', id, d.title);
  back(ctx, `/admin/articles/${id}/edit`, ok);
}
R.post('/admin/articles/new', guard('articles.create', (ctx) => saveArticle(ctx, null)));
R.post('/admin/articles/:id/edit', guard('articles.create', (ctx) => {
  const a = Articles.getAny(intParam(ctx));
  if (!a) return back(ctx, '/admin/articles', 'not_found', 'err');
  return saveArticle(ctx, a);
}));
R.post('/admin/articles/:id/delete', guard('articles.create', (ctx) => {
  const a = Articles.getAny(intParam(ctx));
  if (!a) return back(ctx, '/admin/articles', 'not_found', 'err');
  const own = a.created_by === ctx.user.id && ['draft', 'pending'].includes(a.status);
  if (!can(ctx.user, 'articles.delete_any') && !own) return out(ctx, A.forbidden(ctx), 403);
  Articles.remove(a.id);
  audit(ctx, 'حذف مادة', 'article', a.id, a.title);
  back(ctx, '/admin/articles', 'deleted');
}));
R.get('/admin/articles/:id/preview', guard('articles.create', (ctx) => {
  const a = Articles.getAny(intParam(ctx));
  if (!a) return back(ctx, '/admin/articles', 'not_found', 'err');
  if (!canEdit(ctx.user, a) && !can(ctx.user, 'articles.edit_any')) return out(ctx, A.forbidden(ctx), 403);
  pub.prepare(ctx);
  ctx.noCount = true;
  const author = a.author_id ? Users.get(a.author_id) : null;
  const view = { ...a, published_at: a.published_at || U.nowIso(), updated_at: a.updated_at, author_title: author?.title, is_demo: a.is_demo };
  const htmlStr = String(pages.article(ctx, { a: view, tags: Articles.tagsFor(a.id), sources: Articles.sourcesFor(a.id), gallery: Articles.galleryFor(a.id), related: [], mostRead: [], comments: [], commentsOpen: null, notice: null, formToken: {} }))
    .replace('<main id="main" tabindex="-1">', '<main id="main" tabindex="-1"><div class="preview-banner" role="note">معاينة: هذه المادة غير منشورة ولا يراها الزوار.</div>')
    .replace('<meta name="description"', '<meta name="robots" content="noindex, nofollow"><meta name="description"');
  out(ctx, htmlStr);
}));
R.post('/admin/preview', guard('articles.create', (ctx) => sendJson(ctx, 200, { html: renderMarkup(ctx.form.str('body', 60000)) })));

/* ======================= الوسائط ======================= */
R.get('/admin/media', guard('media.upload', (ctx) => {
  const per = 30;
  const pg = U.paginate(Media.count(), parseInt(ctx.query.get('page') || '1', 10), per);
  out(ctx, A.mediaPage(ctx, { items: Media.list(per, pg.offset), pg }));
}));
R.get('/admin/media.json', guard('media.upload', (ctx) => {
  const page = Math.max(1, parseInt(ctx.query.get('page') || '1', 10) || 1);
  const items = Media.list(48, (page - 1) * 48).map((m) => ({ id: m.id, path: m.path, width: m.width, height: m.height }));
  sendJson(ctx, 200, { items });
}));
R.post('/admin/media/upload', guard('media.upload', (ctx) => {
  const files = [...ctx.form.fileList('files'), ...ctx.form.fileList('file')].slice(0, 10);
  const saved = [], errors = [];
  for (const f of files) {
    const r = saveImage(f);
    if (r.error) errors.push(`${f.filename}: ${r.error}`);
    else { Media.create(r, ctx.user.id); saved.push({ path: r.path, width: r.width, height: r.height }); }
  }
  if (!files.length) errors.push('لم يتم اختيار أي ملف.');
  if (saved.length) audit(ctx, 'رفع صور', 'media', null, `${saved.length} ملف`);
  if (String(ctx.req.headers.accept || '').includes('application/json')) return sendJson(ctx, errors.length && !saved.length ? 400 : 200, { items: saved, errors });
  if (errors.length && !saved.length) return back(ctx, '/admin/media', 'upload', 'err', errors.join(' / '));
  back(ctx, '/admin/media', 'uploaded', 'ok');
}));
R.post('/admin/media/:id/delete', guard('media.delete', (ctx) => {
  const m = Media.get(intParam(ctx));
  if (!m) return back(ctx, '/admin/media', 'not_found', 'err');
  if (Media.usage(m.path) > 0) return back(ctx, '/admin/media', 'in_use', 'err');
  Media.remove(m.id);
  removeFile(m.path);
  audit(ctx, 'حذف صورة', 'media', m.id, m.path);
  back(ctx, '/admin/media', 'deleted');
}));

/* ======================= الأخبار العاجلة ======================= */
R.get('/admin/breaking', guard('breaking.manage', (ctx) => out(ctx, A.breakingPage(ctx, { items: Breaking.list(), articles: Articles.recentPublishedOptions() }))));
R.post('/admin/breaking', guard('breaking.manage', (ctx) => {
  const f = ctx.form;
  const text = f.str('text', 160);
  const hours = Math.min(48, Math.max(0, f.int('hours') ?? 6));
  let articleId = f.int('article_id');
  if (articleId && !Articles.getLive(articleId)) articleId = null;
  if (text.length < 3) return out(ctx, A.breakingPage(ctx, { items: Breaking.list(), articles: Articles.recentPublishedOptions(), errors: ['اكتب نص الخبر العاجل.'] }), 400);
  const id = Breaking.create(text, articleId, hours ? new Date(Date.now() + hours * 3600000).toISOString() : null, ctx.user.id);
  audit(ctx, 'أضاف خبرًا عاجلًا', 'breaking', id, text);
  back(ctx, '/admin/breaking', 'created');
}));
R.post('/admin/breaking/:id/toggle', guard('breaking.manage', (ctx) => { Breaking.toggle(intParam(ctx)); back(ctx, '/admin/breaking', 'status'); }));
R.post('/admin/breaking/:id/delete', guard('breaking.manage', (ctx) => { Breaking.remove(intParam(ctx)); back(ctx, '/admin/breaking', 'deleted'); }));

/* ======================= التعليقات ======================= */
R.get('/admin/comments', guard('comments.moderate', (ctx) => {
  const tab = ['pending', 'approved', 'rejected', 'reported'].includes(ctx.query.get('tab')) ? ctx.query.get('tab') : 'pending';
  out(ctx, A.commentsPage(ctx, { tab, items: Comments.adminList(tab), counts: Comments.counts(), enabled: ctx.site.comments_enabled === '1' }));
}));
for (const [act, fn, msg] of [['approve', (id, u) => Comments.moderate(id, 'approved', u), 'approved'], ['reject', (id, u) => Comments.moderate(id, 'rejected', u), 'rejected'],
  ['dismiss', (id) => Comments.dismissReports(id), 'dismissed'], ['delete', (id) => Comments.remove(id), 'deleted']]) {
  R.post(`/admin/comments/:id/${act}`, guard('comments.moderate', (ctx) => {
    const c = Comments.get(intParam(ctx));
    if (!c) return back(ctx, '/admin/comments', 'not_found', 'err');
    fn(c.id, ctx.user.id);
    audit(ctx, { approve: 'وافق على تعليق', reject: 'رفض تعليقًا', dismiss: 'أغلق بلاغات تعليق', delete: 'حذف تعليقًا' }[act], 'comment', c.id, U.truncate(c.body, 60));
    const tab = (ctx.req.headers.referer || '').match(/tab=(\w+)/)?.[1] || 'pending';
    back(ctx, `/admin/comments?tab=${tab}`, msg);
  }));
}

/* ======================= مصادر الأخبار ======================= */
R.get('/admin/feeds', guard('feeds.manage', (ctx) => out(ctx, A2().feedsPage(ctx, { sources: Feeds.sources(), items: Feeds.items('new'), categories: Categories.list() }))));
R.post('/admin/feeds', guard('feeds.manage', (ctx) => {
  const name = ctx.form.str('name', 80), url = ctx.form.str('url', 500), cat = ctx.form.int('category_id');
  const errors = [];
  if (name.length < 2) errors.push('اكتب اسم المصدر.');
  if (!U.isHttpUrl(url)) errors.push('رابط الخلاصة يجب أن يبدأ بـ http أو https.');
  else if (Feeds.sources().some((s) => s.url === url)) errors.push('هذا المصدر مضاف بالفعل.');
  if (errors.length) return out(ctx, A2().feedsPage(ctx, { sources: Feeds.sources(), items: Feeds.items('new'), categories: Categories.list(), errors }), 400);
  const id = Feeds.addSource(name, url, Categories.byId(cat) ? cat : null);
  audit(ctx, 'أضاف مصدر أخبار', 'feed', id, name);
  back(ctx, '/admin/feeds', 'created');
}));
R.post('/admin/feeds/:id/fetch', guard('feeds.manage', async (ctx) => {
  const src = Feeds.source(intParam(ctx));
  if (!src) return back(ctx, '/admin/feeds', 'not_found', 'err');
  try {
    const items = await fetchFeed(src.url);
    const added = Feeds.storeItems(src.id, items);
    Feeds.markFetched(src.id, `تم: ${added} عنوان جديد من ${items.length}`);
    back(ctx, '/admin/feeds', 'fetched');
  } catch (e) {
    const msg = e.name === 'AbortError' ? 'انتهت مهلة الاتصال' : e.message;
    Feeds.markFetched(src.id, `خطأ: ${msg}`.slice(0, 200));
    back(ctx, '/admin/feeds', 'fetch', 'err', msg);
  }
}));
R.post('/admin/feeds/:id/toggle', guard('feeds.manage', (ctx) => { Feeds.toggleSource(intParam(ctx)); back(ctx, '/admin/feeds', 'status'); }));
R.post('/admin/feeds/:id/delete', guard('feeds.manage', (ctx) => { Feeds.removeSource(intParam(ctx)); back(ctx, '/admin/feeds', 'deleted'); }));
R.post('/admin/feeds/items/:id/draft', guard('feeds.manage', (ctx) => {
  const it = Feeds.item(intParam(ctx));
  if (!it) return back(ctx, '/admin/feeds', 'not_found', 'err');
  const catId = it.category_id || Categories.list()[0].id;
  const body = [`> مسودة مُنشأة من عنوان مستورد من «${it.source_name}». أعد صياغة النص بالكامل بأسلوب الموقع وتحقق من المعلومات قبل النشر، ثم احذف هذه الملاحظة.`,
    it.summary ? `ملخص المصدر للاسترشاد: ${it.summary}` : ''].filter(Boolean).join('\n\n');
  const id = Articles.save({ title: it.title.slice(0, 200), excerpt: '', body, category_id: catId, author_id: ctx.user.id, type: 'news', status: 'draft', allow_comments: true,
    sources: [{ name: it.source_name, url: it.link || '' }], tags: [], gallery: [] }, ctx.user.id);
  Feeds.setItem(it.id, 'drafted', id);
  audit(ctx, 'أنشأ مسودة من مصدر خارجي', 'article', id, it.title);
  back(ctx, `/admin/articles/${id}/edit`, 'drafted');
}));
R.post('/admin/feeds/items/:id/ignore', guard('feeds.manage', (ctx) => { Feeds.setItem(intParam(ctx), 'ignored'); back(ctx, '/admin/feeds', 'status'); }));

/* ======================= رسائل اتصل بنا ======================= */
R.get('/admin/messages', guard('messages.view', (ctx) => {
  const tab = ['new', 'read', 'archived'].includes(ctx.query.get('tab')) ? ctx.query.get('tab') : 'new';
  out(ctx, A2().messagesPage(ctx, { tab, items: Messages.list(tab), counts: Messages.counts() }));
}));
R.post('/admin/messages/:id/:act', guard('messages.view', (ctx) => {
  const m = Messages.get(intParam(ctx));
  const act = ctx.params.act;
  if (!m || !['read', 'archive', 'delete'].includes(act)) return back(ctx, '/admin/messages', 'not_found', 'err');
  if (act === 'delete') Messages.remove(m.id); else Messages.setStatus(m.id, act === 'read' ? 'read' : 'archived');
  back(ctx, `/admin/messages?tab=${m.status}`, act === 'delete' ? 'deleted' : 'status');
}));

function A2() { return require('../views/admin2'); }

module.exports = { guard, out, back, audit, intParam, A2, buildArticle, canEdit, SAVE_LABELS };
require('./admin-business');
