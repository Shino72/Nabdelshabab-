'use strict';
/*
 * واجهة برمجية JSON
 *   عامة (قراءة فقط):  GET /api/v1/articles   GET /api/v1/articles/:id   GET /api/v1/categories
 *   للمحررين:          POST /api/v1/auth/login  GET /api/v1/admin/session
 *                      GET/POST /api/v1/admin/articles   PUT/DELETE /api/v1/admin/articles/:id
 * طلبات الكتابة تتطلب ملف تعريف الجلسة (sid) + الترويسة X-CSRF-Token، وتخضع لنفس الصلاحيات والتحقق المستخدم في لوحة التحكم.
 */
const R = require('../router');
const config = require('../config');
const { send, sendJson, parseBody, setCookie, Form } = require('../http');
const S = require('../security');
const U = require('../util');
const { renderMarkup } = require('../markup');
const Articles = require('../models/articles');
const Users = require('../models/users');
const { Audit } = require('../models/misc');
const { guard, buildArticle, canEdit, SAVE_LABELS } = require('./admin');

const { Categories } = Articles;
const abs = (p) => (p ? (/^https?:/.test(p) ? p : config.siteUrl + p) : null);
const pubJson = (ctx, status, obj) => send(ctx, status, JSON.stringify(obj), 'application/json; charset=utf-8', { 'Cache-Control': status === 200 ? 'public, max-age=60' : 'no-store', 'Access-Control-Allow-Origin': '*' });
const statusOf = (a) => (a.status === 'published' && a.published_at > U.nowIso() ? 'scheduled' : a.status);

function shape(a, full = false) {
  const o = {
    id: a.id, title: a.title, slug: a.slug, url: config.siteUrl + U.articleUrl(a), excerpt: a.excerpt || null, type: a.type,
    category: { slug: a.cat_slug, name: a.cat_name }, author: a.author_id ? { id: a.author_id, name: a.author_name } : null,
    cover_image: abs(a.cover_image), published_at: a.published_at, updated_at: a.updated_at, is_demo: !!a.is_demo,
  };
  if (full) {
    Object.assign(o, {
      body: a.body, body_html: renderMarkup(a.body), video_id: a.video_id || null,
      tags: Articles.tagsFor(a.id).map((t) => t.name), sources: Articles.sourcesFor(a.id),
      gallery: Articles.galleryFor(a.id).map((g) => ({ image: abs(g.image), caption: g.caption })),
    });
  }
  return o;
}

/* ---------- قراءة عامة ---------- */
R.get('/api/v1/categories', (ctx) => pubJson(ctx, 200, { data: Categories.list().map((c) => ({ id: c.id, slug: c.slug, name: c.name, description: c.description })) }));
R.get('/api/v1/articles', (ctx) => {
  const per = Math.min(50, Math.max(1, parseInt(ctx.query.get('per_page') || '20', 10) || 20));
  const slug = ctx.query.get('category');
  const cat = slug ? Categories.bySlug(slug) : null;
  if (slug && !cat) return pubJson(ctx, 404, { error: 'not_found', message: 'القسم غير موجود' });
  const opts = { categoryId: cat?.id, terms: Articles.searchTerms((ctx.query.get('q') || '').slice(0, 100)) };
  const pg = U.paginate(Articles.countLive(opts), parseInt(ctx.query.get('page') || '1', 10) || 1, per);
  pubJson(ctx, 200, { data: Articles.listLive({ ...opts, limit: per, offset: pg.offset }).map((a) => shape(a)), meta: { page: pg.page, pages: pg.pages, total: pg.total, per_page: per } });
});
R.get('/api/v1/articles/:id', (ctx) => {
  const a = Articles.getLive(parseInt(ctx.params.id, 10) || 0);
  if (!a) return pubJson(ctx, 404, { error: 'not_found', message: 'الخبر غير موجود أو غير منشور' });
  pubJson(ctx, 200, { data: shape(a, true) });
});

/* ---------- تسجيل الدخول ---------- */
R.post('/api/v1/auth/login', async (ctx) => {
  // يُشترط JSON: النماذج القادمة من مواقع أخرى لا تستطيع إرسال هذا النوع دون إذن CORS
  if (!String(ctx.req.headers['content-type'] || '').startsWith('application/json')) return sendJson(ctx, 415, { error: 'unsupported_media_type', message: 'استخدم Content-Type: application/json' });
  const f = await parseBody(ctx.req);
  const email = f.str('email', 120).toLowerCase();
  if (!S.rateLimit(`login-ip:${ctx.ip}`, 20, 900000) || !S.rateLimit(`login:${email}`, 6, 900000)) return sendJson(ctx, 429, { error: 'rate_limited', message: 'محاولات دخول كثيرة. حاول بعد 15 دقيقة.' });
  const user = Users.getByEmail(email);
  const ok = user ? await S.verifyPassword(f.str('password', 200), user.password_hash) : await S.dummyVerify(f.str('password', 200));
  if (!ok || !user.active) return sendJson(ctx, 401, { error: 'invalid_credentials', message: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' });
  S.resetRate(`login:${email}`);
  const s = S.createSession(user.id, ctx.ip, ctx.req.headers['user-agent']);
  setCookie(ctx.res, 'sid', s.token, { maxAge: S.SESSION_DAYS * 86400 });
  Users.touchLogin(user.id);
  Audit.log(user.id, 'سجّل الدخول عبر API');
  sendJson(ctx, 200, { user: { id: user.id, name: user.name, role: user.role }, csrf_token: s.csrf, expires_at: s.expires });
});
R.get('/api/v1/admin/session', guard(null, (ctx) => sendJson(ctx, 200, { user: ctx.user, csrf_token: ctx.session.csrf }), { api: true }));

/* ---------- إدارة المواد ---------- */
R.get('/api/v1/admin/articles', guard('articles.create', (ctx) => {
  const own = S.can(ctx.user, 'articles.edit_any') ? null : ctx.user.id;
  const st = ctx.query.get('status');
  const status = ['draft', 'pending', 'published', 'scheduled', 'archived'].includes(st) ? st : '';
  const page = Math.max(1, parseInt(ctx.query.get('page') || '1', 10) || 1);
  const { total, rows } = Articles.adminList({ status, authorId: own, q: (ctx.query.get('q') || '').slice(0, 100), limit: 50, offset: (page - 1) * 50 });
  sendJson(ctx, 200, { data: rows.map((r) => ({ id: r.id, title: r.title, status: statusOf(r), type: r.type, category: r.cat_name, author: r.author_name, published_at: r.published_at, updated_at: r.updated_at, views: r.views })), meta: { total, page, per_page: 50 } });
}, { api: true }));

function toFields(obj, base) {
  const out = { ...base };
  for (const [k, v] of Object.entries(obj || {})) {
    if (k === 'tags' && Array.isArray(v)) out.tags = v.join('، ');
    else if (k === 'sources' && Array.isArray(v)) out.sources = v.map((s) => (typeof s === 'string' ? s : `${s.name || ''}${s.url ? ` | ${s.url}` : ''}`)).join('\n');
    else if (k === 'gallery' && Array.isArray(v)) out.gallery = v.map((g) => (typeof g === 'string' ? g : `${g.image || ''}${g.caption ? ` | ${g.caption}` : ''}`)).join('\n');
    else if (typeof v === 'boolean') out[k] = v ? '1' : '';
    else if (v === null || v === undefined) out[k] = '';
    else if (typeof v !== 'object') out[k] = String(v);
  }
  delete out._csrf;
  return out;
}
function currentFields(a) {
  const st = statusOf(a);
  return {
    title: a.title, excerpt: a.excerpt || '', body: a.body, cover_image: a.cover_image || '', cover_caption: a.cover_caption || '', category_id: String(a.category_id), type: a.type,
    author_id: String(a.author_id || ''), is_featured: a.is_featured ? '1' : '', allow_comments: a.allow_comments ? '1' : '', meta_title: a.meta_title || '', meta_description: a.meta_description || '',
    slug: a.slug, video_url: a.video_id ? `https://www.youtube.com/watch?v=${a.video_id}` : '', tags: Articles.tagsFor(a.id).map((t) => t.name).join('، '),
    sources: Articles.sourcesFor(a.id).map((s) => `${s.name}${s.url ? ` | ${s.url}` : ''}`).join('\n'), gallery: Articles.galleryFor(a.id).map((g) => `${g.image}${g.caption ? ` | ${g.caption}` : ''}`).join('\n'),
    action: { published: 'publish', scheduled: 'schedule', pending: 'submit', draft: 'draft', archived: 'archive' }[st], publish_at: st === 'scheduled' ? U.utcToLocalInput(a.published_at) : '',
  };
}
function saveFromApi(ctx, existing) {
  const u = ctx.user;
  if (existing && !canEdit(u, existing)) return sendJson(ctx, 403, { error: 'forbidden', message: 'لا يمكنك تعديل هذه المادة' });
  const fields = toFields(ctx.form.fields, existing ? currentFields(existing) : { allow_comments: '1', action: 'draft' });
  const { d, errors, ok } = buildArticle(new Form(fields), u, existing);
  if (errors.length) return sendJson(ctx, 422, { error: 'validation', errors });
  const id = Articles.save(d, u.id);
  Audit.log(u.id, `${SAVE_LABELS[ok]} (API)`, 'article', id, d.title);
  const a = Articles.getAny(id);
  sendJson(ctx, existing ? 200 : 201, { data: { id, title: a.title, status: statusOf(a), url: config.siteUrl + U.articleUrl(a), published_at: a.published_at, updated_at: a.updated_at } });
}
const idOf = (ctx) => { const n = parseInt(ctx.params.id, 10); return String(n) === ctx.params.id ? n : 0; };
R.post('/api/v1/admin/articles', guard('articles.create', (ctx) => saveFromApi(ctx, null), { api: true }));
R.put('/api/v1/admin/articles/:id', guard('articles.create', (ctx) => {
  const a = Articles.getAny(idOf(ctx));
  if (!a) return sendJson(ctx, 404, { error: 'not_found', message: 'المادة غير موجودة' });
  return saveFromApi(ctx, a);
}, { api: true }));
R.del('/api/v1/admin/articles/:id', guard('articles.create', (ctx) => {
  const a = Articles.getAny(idOf(ctx));
  if (!a) return sendJson(ctx, 404, { error: 'not_found', message: 'المادة غير موجودة' });
  const own = a.created_by === ctx.user.id && ['draft', 'pending'].includes(a.status);
  if (!S.can(ctx.user, 'articles.delete_any') && !own) return sendJson(ctx, 403, { error: 'forbidden', message: 'لا يمكنك حذف هذه المادة' });
  Articles.remove(a.id);
  Audit.log(ctx.user.id, 'حذف مادة (API)', 'article', a.id, a.title);
  sendJson(ctx, 200, { data: { id: a.id, deleted: true } });
}, { api: true }));
