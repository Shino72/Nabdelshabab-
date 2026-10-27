'use strict';
const R = require('../router');
const { send } = require('../http');
const S = require('../security');
const U = require('../util');
const { safeImg } = require('../markup');
const { saveImage } = require('../uploads');
const Settings = require('../models/settings');
const Articles = require('../models/articles');
const Users = require('../models/users');
const Ads = require('../models/ads');
const { Media, Stats } = require('../models/misc');
const seed = require('../seed');
const { guard, out, back, audit, intParam, A2 } = require('./admin');
const { get } = require('../db');

const { Categories } = Articles;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ======================= الحملات الإعلانية ======================= */
R.get('/admin/ads', guard('ads.manage', (ctx) => out(ctx, A2().campaigns(ctx, { rows: Ads.campaigns(), stateOf: Ads.campaignState }))));

function campaignToForm(c) {
  return { ...c, start: U.utcToLocalInput(c.starts_at).slice(0, 10), end: U.addDays(U.utcToLocalInput(c.ends_at).slice(0, 10), -1) };
}
R.get('/admin/ads/new', guard('ads.manage', (ctx) => {
  const c = { start: U.localDay(), end: U.addDays(U.localDay(), 6), status: 'active', payment_status: 'unpaid' };
  const r = Ads.request(parseInt(ctx.query.get('from_request') || '0', 10));
  if (r) Object.assign(c, { title: `حملة ${r.company}`, advertiser_name: r.company, contact_name: r.contact_name, contact_email: r.email, contact_phone: r.phone, slot_id: r.slot_id, notes: r.message, start: r.start_date || c.start });
  out(ctx, A2().campaignForm(ctx, { c, slots: Ads.slots() }));
}));
R.get('/admin/ads/:id/edit', guard('ads.manage', (ctx) => {
  const c = Ads.campaign(intParam(ctx));
  if (!c) return back(ctx, '/admin/ads', 'not_found', 'err');
  out(ctx, A2().campaignForm(ctx, { c: campaignToForm(c), slots: Ads.slots() }));
}));
function saveCampaign(ctx, existing) {
  const f = ctx.form;
  const c = {
    id: existing?.id, title: f.str('title', 120), slot_id: f.int('slot_id'), start: f.str('start', 10), end: f.str('end', 10),
    target_url: f.str('target_url', 500), alt_text: f.str('alt_text', 150), image: f.str('image', 300), advertiser_name: f.str('advertiser_name', 120),
    contact_name: f.str('contact_name', 80), contact_email: f.str('contact_email', 120), contact_phone: f.str('contact_phone', 30),
    status: f.str('status', 10) === 'paused' ? 'paused' : 'active', payment_status: ['paid', 'free'].includes(f.str('payment_status', 10)) ? f.str('payment_status', 10) : 'unpaid',
    amount: f.num('amount'), notes: f.str('notes', 1000),
  };
  const errors = [];
  if (c.title.length < 2) errors.push('اكتب اسم الحملة.');
  if (!c.slot_id || !Ads.slotById(c.slot_id)) errors.push('اختر المساحة الإعلانية.');
  if (!U.isDay(c.start) || !U.isDay(c.end)) errors.push('حدد تاريخي البداية والنهاية.');
  else if (c.end < c.start) errors.push('تاريخ النهاية يجب أن يكون بعد تاريخ البداية أو مساويًا له.');
  if (!U.isHttpUrl(c.target_url)) errors.push('رابط الوجهة يجب أن يبدأ بـ http أو https.');
  if (c.advertiser_name.length < 2) errors.push('اكتب اسم المعلن.');
  if (c.contact_email && !EMAIL.test(c.contact_email)) errors.push('بريد المعلن غير صحيح.');
  if (c.amount !== null && c.amount < 0) errors.push('قيمة الحملة غير صحيحة.');
  const file = f.file('image_file');
  if (file) {
    const saved = saveImage(file);
    if (saved.error) errors.push(`صورة الإعلان: ${saved.error}`);
    else { Media.create(saved, ctx.user.id); c.image = saved.path; }
  } else if (!c.image) errors.push('أضف صورة للإعلان.');
  else if (!/^\/uploads\//.test(c.image) || !safeImg(c.image)) errors.push('صورة الإعلان يجب أن تكون من مكتبة الوسائط.');
  if (errors.length) return out(ctx, A2().campaignForm(ctx, { c, slots: Ads.slots(), errors }), 400);
  c.starts_at = U.localInputToUtc(c.start);
  c.ends_at = U.localInputToUtc(U.addDays(c.end, 1));
  const id = Ads.saveCampaign(c, ctx.user.id);
  audit(ctx, existing ? 'عدّل حملة إعلانية' : 'أنشأ حملة إعلانية', 'campaign', id, c.title);
  back(ctx, `/admin/ads/${id}/edit`, existing ? 'saved' : 'created');
}
R.post('/admin/ads/new', guard('ads.manage', (ctx) => saveCampaign(ctx, null)));
R.post('/admin/ads/:id/edit', guard('ads.manage', (ctx) => {
  const c = Ads.campaign(intParam(ctx));
  if (!c) return back(ctx, '/admin/ads', 'not_found', 'err');
  return saveCampaign(ctx, c);
}));
R.post('/admin/ads/:id/toggle', guard('ads.manage', (ctx) => {
  const c = Ads.campaign(intParam(ctx));
  if (!c) return back(ctx, '/admin/ads', 'not_found', 'err');
  Ads.setCampaignStatus(c.id, c.status === 'active' ? 'paused' : 'active');
  back(ctx, '/admin/ads', c.status === 'active' ? 'paused' : 'resumed');
}));
R.post('/admin/ads/:id/delete', guard('ads.manage', (ctx) => {
  const c = Ads.campaign(intParam(ctx));
  if (!c) return back(ctx, '/admin/ads', 'not_found', 'err');
  Ads.deleteCampaign(c.id);
  audit(ctx, 'حذف حملة إعلانية', 'campaign', c.id, c.title);
  back(ctx, '/admin/ads', 'deleted');
}));
R.get('/admin/ads/:id/report.csv', guard('ads.manage', (ctx) => {
  const c = Ads.campaign(intParam(ctx));
  if (!c) return back(ctx, '/admin/ads', 'not_found', 'err');
  const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const rows = [['الحملة', c.title], ['المعلن', c.advertiser_name], ['المساحة', c.slot_name], [], ['اليوم', 'مرات الظهور', 'النقرات', 'نسبة النقر']];
  for (const d of Ads.campaignDaily(c.id)) rows.push([d.day, d.impressions, d.clicks, d.impressions ? `${((d.clicks / d.impressions) * 100).toFixed(2)}%` : '']);
  rows.push([], ['الإجمالي', c.impressions, c.clicks, c.impressions ? `${((c.clicks / c.impressions) * 100).toFixed(2)}%` : '']);
  const csv = '\uFEFF' + rows.map((r) => r.map(q).join(',')).join('\r\n');
  send(ctx, 200, csv, 'text/csv; charset=utf-8', { 'Content-Disposition': `attachment; filename="campaign-${c.id}.csv"`, 'Cache-Control': 'no-store' });
}));

R.get('/admin/ads/slots', guard('ads.manage', (ctx) => out(ctx, A2().slotsPage(ctx, { slots: Ads.slots(), units: Ads.PRICE_UNITS }))));
R.post('/admin/ads/slots/:id', guard('ads.manage', (ctx) => {
  const s = Ads.slotById(intParam(ctx));
  if (!s) return back(ctx, '/admin/ads/slots', 'not_found', 'err');
  const f = ctx.form;
  const name = f.str('name', 80) || s.name;
  const price = Math.max(0, f.num('price') || 0);
  const unit = Ads.PRICE_UNITS[f.str('price_unit', 10)] ? f.str('price_unit', 10) : s.price_unit;
  Ads.updateSlot(s.id, { name, price, price_unit: unit, active: f.bool('active') });
  audit(ctx, 'عدّل مساحة إعلانية', 'slot', s.id, name);
  back(ctx, '/admin/ads/slots', 'saved');
}));
R.get('/admin/ads/requests', guard('ads.manage', (ctx) => out(ctx, A2().requestsPage(ctx, { rows: Ads.requests() }))));
R.post('/admin/ads/requests/:id', guard('ads.manage', (ctx) => {
  const r = Ads.request(intParam(ctx));
  if (!r) return back(ctx, '/admin/ads/requests', 'not_found', 'err');
  const st = ctx.form.str('status', 20);
  if (['new', 'contacted', 'converted', 'closed'].includes(st)) Ads.setRequestStatus(r.id, st);
  back(ctx, '/admin/ads/requests', 'status');
}));

/* ======================= التقارير ======================= */
R.get('/admin/reports', guard('stats.view', (ctx) => {
  const today = U.localDay();
  let to = U.isDay(ctx.query.get('to')) ? ctx.query.get('to') : today;
  let from = U.isDay(ctx.query.get('from')) ? ctx.query.get('from') : U.addDays(today, -29);
  if (from > to) [from, to] = [to, from];
  if (from < U.addDays(to, -365)) from = U.addDays(to, -365);
  const series = Stats.siteSeries(from, to);
  const [fromIso] = U.dayRange(from);
  const toIso = U.dayRange(to)[1];
  out(ctx, A2().reportsPage(ctx, {
    from, to, series, siteTotal: series.reduce((s, x) => s + x.views, 0), articleTotal: Stats.articleViewsSum(from, to),
    publishedCount: get("SELECT COUNT(*) AS n FROM articles WHERE status = 'published' AND published_at >= ? AND published_at < ? AND published_at <= ?", fromIso, toIso, U.nowIso()).n,
    top: Stats.topArticles(from, to, 15), byCategory: Stats.byCategory(from, to), byAuthor: Stats.byAuthor(fromIso, toIso), ads: Stats.ads(from, to),
  }));
}));

/* ======================= الأقسام ======================= */
R.get('/admin/categories', guard('categories.manage', (ctx) => out(ctx, A2().categoriesPage(ctx, { cats: Categories.list() }))));
R.post('/admin/categories/:id', guard('categories.manage', (ctx) => {
  const c = Categories.byId(intParam(ctx));
  if (!c) return back(ctx, '/admin/categories', 'not_found', 'err');
  const f = ctx.form;
  Categories.update(c.id, { name: f.str('name', 40) || c.name, description: f.str('description', 200), sort: Math.min(99, Math.max(0, f.int('sort') ?? c.sort)), show_on_home: f.bool('show_on_home') });
  audit(ctx, 'عدّل قسمًا', 'category', c.id, f.str('name', 40));
  back(ctx, '/admin/categories', 'saved');
}));

/* ======================= المستخدمون ======================= */
R.get('/admin/users', guard('users.manage', (ctx) => out(ctx, A2().usersPage(ctx, { users: Users.list() }))));
R.get('/admin/users/new', guard('users.manage', (ctx) => out(ctx, A2().userForm(ctx, { u: { role: 'writer', active: 1 } }))));
R.get('/admin/users/:id/edit', guard('users.manage', (ctx) => {
  const u = Users.get(intParam(ctx));
  if (!u) return back(ctx, '/admin/users', 'not_found', 'err');
  out(ctx, A2().userForm(ctx, { u }));
}));
async function saveUser(ctx, existing) {
  const f = ctx.form;
  const u = { id: existing?.id, name: f.str('name', 80), email: f.str('email', 120).toLowerCase(), role: S.ROLE_LABELS[f.str('role', 10)] ? f.str('role', 10) : 'writer',
    title: f.str('title', 80), bio: f.str('bio', 600), active: existing ? f.bool('active') : true };
  const password = f.str('password', 200);
  const errors = [];
  if (u.name.length < 2) errors.push('اكتب اسم المستخدم.');
  if (!EMAIL.test(u.email)) errors.push('البريد الإلكتروني غير صحيح.');
  else if (Users.emailTaken(u.email, existing?.id || 0)) errors.push('هذا البريد مستخدم لحساب آخر.');
  if (!existing || password) { const pe = S.validatePassword(password); if (pe) errors.push(pe); }
  if (existing) {
    if (existing.id === ctx.user.id && !u.active) errors.push('لا يمكنك تعطيل حسابك الحالي.');
    if (existing.role === 'admin' && existing.active && (u.role !== 'admin' || !u.active) && Users.countActiveAdmins() <= 1) errors.push('لا يمكن إزالة صلاحية آخر مدير نشط في الموقع.');
  }
  if (errors.length) return out(ctx, A2().userForm(ctx, { u: { ...existing, ...u }, errors }), 400);
  let id = existing?.id;
  if (existing) {
    Users.update(id, u);
    if (password) Users.setPassword(id, await S.hashPassword(password), id === ctx.user.id ? ctx.session.tokenHash : null);
    if (!u.active) Users.endSessions(id);
    audit(ctx, 'عدّل مستخدمًا', 'user', id, u.email);
  } else {
    id = Users.create({ ...u, passwordHash: await S.hashPassword(password) });
    audit(ctx, 'أنشأ مستخدمًا', 'user', id, `${u.email} (${S.ROLE_LABELS[u.role]})`);
  }
  back(ctx, '/admin/users', existing ? 'saved' : 'created');
}
R.post('/admin/users/new', guard('users.manage', (ctx) => saveUser(ctx, null)));
R.post('/admin/users/:id/edit', guard('users.manage', (ctx) => {
  const u = Users.get(intParam(ctx));
  if (!u) return back(ctx, '/admin/users', 'not_found', 'err');
  return saveUser(ctx, u);
}));

/* ======================= حسابي ======================= */
R.get('/admin/profile', guard(null, (ctx) => out(ctx, A2().profilePage(ctx, { u: Users.get(ctx.user.id) }))));
R.post('/admin/profile', guard(null, (ctx) => {
  const f = ctx.form;
  const name = f.str('name', 80);
  if (name.length < 2) return out(ctx, A2().profilePage(ctx, { u: Users.get(ctx.user.id), errors: ['اكتب الاسم.'] }), 400);
  Users.updateProfile(ctx.user.id, { name, title: f.str('title', 80), bio: f.str('bio', 600) });
  back(ctx, '/admin/profile', 'saved');
}));
R.post('/admin/profile/password', guard(null, async (ctx) => {
  const f = ctx.form;
  const full = Users.getWithHash(ctx.user.id);
  const errors = [];
  if (!(await S.verifyPassword(f.str('current', 200), full.password_hash))) errors.push('كلمة المرور الحالية غير صحيحة.');
  const pe = S.validatePassword(f.str('password', 200));
  if (pe) errors.push(pe);
  if (f.str('password', 200) !== f.str('confirm', 200)) errors.push('تأكيد كلمة المرور غير مطابق.');
  if (errors.length) return out(ctx, A2().profilePage(ctx, { u: Users.get(ctx.user.id), errors }), 400);
  Users.setPassword(ctx.user.id, await S.hashPassword(f.str('password', 200)), ctx.session.tokenHash);
  audit(ctx, 'غيّر كلمة المرور');
  back(ctx, '/admin/profile', 'password');
}));

/* ======================= الإعدادات ======================= */
R.get('/admin/settings', guard('settings.manage', (ctx) => out(ctx, A2().settingsPage(ctx, { s: Settings.getAll(), demoCount: seed.demoCount() }))));
R.post('/admin/settings', guard('settings.manage', (ctx) => {
  const f = ctx.form;
  const v = {};
  const text = { site_name: 40, site_tagline: 80, site_description: 300, contact_email: 120, ads_email: 120, contact_phone: 30, whatsapp: 30, address: 200,
    masthead_credits: 1000, project_note: 120, footer_note: 200, about_body: 20000, privacy_body: 20000, terms_body: 20000, advertise_body: 10000 };
  for (const [k, max] of Object.entries(text)) v[k] = f.str(k, max);
  for (const k of ['social_facebook', 'social_x', 'social_instagram', 'social_youtube', 'social_tiktok', 'social_telegram']) v[k] = f.str(k, 300);
  v.comments_enabled = f.bool('comments_enabled') ? '1' : '0';
  v.show_empty_ad_slots = f.bool('show_empty_ad_slots') ? '1' : '0';
  const errors = [];
  if (v.site_name.length < 2) errors.push('اكتب اسم الموقع.');
  for (const k of ['contact_email', 'ads_email']) if (v[k] && !EMAIL.test(v[k])) errors.push(`البريد الإلكتروني غير صحيح: ${v[k]}`);
  for (const k of Object.keys(v).filter((x) => x.startsWith('social_'))) if (v[k] && !U.isHttpUrl(v[k])) errors.push(`رابط غير صحيح: ${v[k]}`);
  if (errors.length) return out(ctx, A2().settingsPage(ctx, { s: { ...Settings.getAll(), ...v }, errors, demoCount: seed.demoCount() }), 400);
  Settings.setMany(v);
  audit(ctx, 'حدّث إعدادات الموقع');
  back(ctx, '/admin/settings', 'saved');
}));
R.post('/admin/settings/delete-demo', guard('settings.manage', (ctx) => {
  const n = seed.deleteDemo();
  audit(ctx, 'حذف المحتوى التجريبي', null, null, `${n} مادة`);
  back(ctx, '/admin/settings', 'demo_deleted');
}));
