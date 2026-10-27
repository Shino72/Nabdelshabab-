'use strict';
const { html, raw, esc, fmtDate, fmtDateTime, fmtNum, utcToLocalInput, articleUrl, truncate, relTime } = require('../util');
const { can, ROLE_LABELS } = require('../security');
const assets = require('../assets');
const { logoMark, FONTS } = require('./layout');

const MSG = {
  saved: 'تم حفظ التغييرات.', created: 'تم الإنشاء بنجاح.', deleted: 'تم الحذف.', published: 'تم نشر المادة وأصبحت ظاهرة على الموقع.',
  scheduled: 'تمت جدولة المادة، وستظهر تلقائيًا في الموعد المحدد.', submitted: 'أُرسلت المادة إلى المحرر للمراجعة.', returned: 'أُعيدت المادة إلى الكاتب مع ملاحظاتك.',
  archived: 'تمت أرشفة المادة وإخفاؤها من الموقع.', draft: 'تم حفظ المادة كمسودة.', uploaded: 'تم رفع الملفات إلى المكتبة.', password: 'تم تغيير كلمة المرور.',
  fetched: 'تم جلب الخلاصة.', drafted: 'أُنشئت مسودة من الخبر المستورد. أعد صياغتها وتحقق من المعلومات قبل النشر.', demo_deleted: 'تم حذف المحتوى التجريبي بالكامل.',
  approved: 'تمت الموافقة على التعليق ونشره.', rejected: 'تم رفض التعليق.', dismissed: 'تم إغلاق البلاغات.', status: 'تم تحديث الحالة.', paused: 'تم إيقاف الحملة مؤقتًا.', resumed: 'تم استئناف الحملة.',
};
const ERR = {
  forbidden: 'ليست لديك صلاحية لتنفيذ هذا الإجراء.', in_use: 'لا يمكن حذف الملف لأنه مستخدم في مادة أو حملة إعلانية.', last_admin: 'لا يمكن إزالة صلاحية آخر مدير نشط.',
  self: 'لا يمكنك تعطيل حسابك الحالي.', not_found: 'العنصر المطلوب غير موجود.', fetch: 'تعذر جلب الخلاصة.', upload: 'تعذر رفع الملف.', invalid: 'البيانات المرسلة غير صالحة.',
};
const STATUS = { draft: 'مسودة', pending: 'بانتظار المراجعة', published: 'منشور', scheduled: 'مجدول', archived: 'مؤرشف' };
const TYPES = { news: 'خبر', opinion: 'مقال رأي', report: 'تقرير / تحقيق', video: 'فيديو', gallery: 'معرض صور' };
const statusOf = (a) => (a.status === 'published' && a.published_at > new Date().toISOString() ? 'scheduled' : a.status);
const badge = (key, label) => html`<span class="st st-${key}">${label}</span>`;
const csrf = (ctx) => html`<input type="hidden" name="_csrf" value="${ctx.session.csrf}">`;
const sel = (cond) => raw(cond ? 'selected' : '');
const chk = (cond) => raw(cond ? 'checked' : '');

function flash(ctx) {
  const ok = MSG[ctx.query.get('ok')];
  const err = ERR[ctx.query.get('err')];
  const detail = ctx.query.get('detail');
  return html`${ok ? html`<div class="flash flash-ok" role="status">${ok}</div>` : ''}${err ? html`<div class="flash flash-err" role="alert">${err}${detail ? ` ${detail.slice(0, 200)}` : ''}</div>` : ''}`;
}
const errorsBox = (errors) => (errors && errors.length ? html`<div class="flash flash-err" role="alert"><strong>راجع الحقول التالية:</strong><ul>${errors.map((e) => html`<li>${e}</li>`)}</ul></div>` : '');

function shell(title, body, bodyClass = '') {
  return html`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>${title} | لوحة التحكم</title>
<link rel="icon" href="/static/img/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="${FONTS}">
<link rel="stylesheet" href="${assets.url('css/admin.css')}"></head><body class="${bodyClass}">${body}<script src="${assets.url('js/admin.js')}" defer></script></body></html>`;
}

function layout(ctx, { title, body, active = '', actions = '' }) {
  const u = ctx.user;
  const b = ctx.badges || {};
  const item = (href, label, key, perm, count) => (!perm || can(u, perm)
    ? html`<li><a href="${href}" ${raw(active === key ? 'aria-current="page"' : '')}>${label}${count ? html`<span class="count">${count}</span>` : ''}</a></li>` : '');
  const group = (label, items) => { const s = items.map(String).join(''); return s ? html`<p class="nav-group">${label}</p><ul>${raw(s)}</ul>` : ''; };
  const nav = html`
    ${group('المحتوى', [
      item('/admin', 'لوحة المعلومات', 'dashboard'),
      item('/admin/articles', 'الأخبار والمقالات', 'articles', 'articles.create'),
      item('/admin/articles/new', 'كتابة مادة جديدة', 'new', 'articles.create'),
      item('/admin/articles?status=pending', 'بانتظار المراجعة', 'review', 'articles.publish', b.pending),
      item('/admin/breaking', 'الأخبار العاجلة', 'breaking', 'breaking.manage'),
      item('/admin/media', 'مكتبة الوسائط', 'media', 'media.upload'),
      item('/admin/comments', 'التعليقات والبلاغات', 'comments', 'comments.moderate', b.comments),
      item('/admin/messages', 'رسائل «اتصل بنا»', 'messages', 'messages.view', b.messages),
      item('/admin/feeds', 'مصادر الأخبار (RSS)', 'feeds', 'feeds.manage'),
    ])}
    ${group('الإعلانات', [
      item('/admin/ads', 'الحملات الإعلانية', 'ads', 'ads.manage'),
      item('/admin/ads/slots', 'المساحات والأسعار', 'slots', 'ads.manage'),
      item('/admin/ads/requests', 'طلبات الإعلان', 'requests', 'ads.manage', b.requests),
    ])}
    ${group('المتابعة', [item('/admin/reports', 'تقارير الأداء', 'reports', 'stats.view')])}
    ${group('الإدارة', [
      item('/admin/categories', 'الأقسام', 'categories', 'categories.manage'),
      item('/admin/users', 'المستخدمون والصلاحيات', 'users', 'users.manage'),
      item('/admin/settings', 'إعدادات الموقع', 'settings', 'settings.manage'),
      item('/admin/profile', 'حسابي', 'profile'),
    ])}`;
  return shell(title, html`
<div class="admin">
  <aside class="sidebar" id="sidebar">
    <a class="side-brand" href="/admin">${logoMark()}<span>${ctx.site.site_name}<small>لوحة التحكم</small></span></a>
    <nav aria-label="قائمة لوحة التحكم">${nav}</nav>
    <form method="post" action="/admin/logout" class="logout">${csrf(ctx)}<button type="submit">تسجيل الخروج</button></form>
  </aside>
  <div class="main">
    <header class="topbar">
      <button class="side-toggle" type="button" data-side-toggle aria-controls="sidebar" aria-expanded="false">القائمة</button>
      <h1>${title}</h1>
      <div class="top-actions">${actions}<a class="btn btn-ghost" href="/" target="_blank" rel="noopener">عرض الموقع</a><span class="who">${u.name}<small>${ROLE_LABELS[u.role]}</small></span></div>
    </header>
    <div class="content">${flash(ctx)}${body}</div>
  </div>
</div>
<dialog id="media-dialog" class="media-dialog" aria-labelledby="md-title">
  <form method="dialog" class="md-head"><h2 id="md-title">مكتبة الوسائط</h2><button class="btn btn-ghost" value="close">إغلاق</button></form>
  <div class="md-upload"><label class="btn">رفع صورة جديدة<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" data-md-upload hidden></label><span class="muted" data-md-status></span></div>
  <div class="md-grid" data-md-grid><p class="muted">جارٍ التحميل…</p></div>
</dialog>`, 'admin-body');
}

/* ======================= تسجيل الدخول ======================= */
function login(ctx, { error, email = '', next = '', csrfToken }) {
  return shell('تسجيل الدخول', html`<main class="login-wrap">
    <form class="login-card" method="post" action="/admin/login">
      <div class="login-brand">${logoMark()}<div><strong>${ctx.site.site_name}</strong><span>دخول فريق التحرير</span></div></div>
      ${error ? html`<p class="flash flash-err" role="alert">${error}</p>` : ''}
      <input type="hidden" name="_lcsrf" value="${csrfToken}"><input type="hidden" name="next" value="${next}">
      <label>البريد الإلكتروني<input type="email" name="email" required autocomplete="username" dir="ltr" value="${email}" autofocus></label>
      <label>كلمة المرور<input type="password" name="password" required autocomplete="current-password" dir="ltr"></label>
      <button type="submit" class="btn btn-primary btn-block">تسجيل الدخول</button>
      <p class="muted small">نسيت كلمة المرور؟ اطلب من مدير الموقع تعيين كلمة مرور جديدة لحسابك.</p>
    </form></main>`, 'login-body');
}
function forbidden(ctx) {
  return layout(ctx, { title: 'غير مسموح', body: html`<div class="panel"><p>ليست لديك صلاحية لفتح هذه الصفحة. تواصل مع مدير الموقع إذا كنت تحتاج إلى هذه الصلاحية.</p><p><a class="btn" href="/admin">العودة إلى لوحة المعلومات</a></p></div>` });
}

/* ======================= رسم بياني بسيط (SVG) ======================= */
function barChart(series, { height = 170, label = 'المشاهدات' } = {}) {
  const w = 640, pad = 24, n = series.length || 1;
  const max = Math.max(1, ...series.map((s) => s.views));
  const bw = (w - pad * 2) / n;
  const bars = series.map((s, i) => {
    const h = Math.round((s.views / max) * (height - 40));
    const x = w - pad - (i + 1) * bw + 3; // من اليمين لليسار
    return `<g><rect x="${x.toFixed(1)}" y="${height - 20 - h}" width="${(bw - 6).toFixed(1)}" height="${Math.max(h, 1)}" rx="3" class="bar"><title>${esc(s.day)}: ${fmtNum(s.views)}</title></rect>
      <text x="${(x + (bw - 6) / 2).toFixed(1)}" y="${height - 5}" class="ax">${esc(s.day.slice(8))}</text></g>`;
  }).join('');
  return raw(`<svg class="chart" viewBox="0 0 ${w} ${height}" role="img" aria-label="${esc(label)}: رسم بياني بالأعمدة"><line x1="${pad}" x2="${w - pad}" y1="${height - 20}" y2="${height - 20}" class="base"/>${bars}</svg>`);
}

/* ======================= لوحة المعلومات ======================= */
function dashboard(ctx, d) {
  const u = ctx.user;
  const card = (label, value, href) => html`<a class="stat" ${raw(href ? `href="${esc(href)}"` : '')}><span class="stat-v">${fmtNum(value)}</span><span class="stat-l">${label}</span></a>`;
  return layout(ctx, { title: 'لوحة المعلومات', active: 'dashboard', body: html`
    ${d.demoCount ? html`<div class="flash flash-warn">الموقع يحتوي على ${d.demoCount} مادة تجريبية تظهر للزوار بعلامة «تجريبي». ${can(u, 'settings.manage') ? html`<a href="/admin/settings#demo">احذفها من الإعدادات قبل الإطلاق</a>.` : ''}</div>` : ''}
    ${d.missingAdminWarning ? '' : ''}
    <div class="stats">
      ${d.stats ? html`${card('مشاهدات اليوم', d.stats.today)}${card('مشاهدات آخر 7 أيام', d.stats.week)}` : ''}
      ${card(can(u, 'articles.edit_any') ? 'مواد منشورة' : 'موادي المنشورة', d.counts.published, '/admin/articles?status=published')}
      ${card('بانتظار المراجعة', d.counts.pending, '/admin/articles?status=pending')}
      ${card('مسودات', d.counts.draft, '/admin/articles?status=draft')}
      ${card('مجدولة', d.counts.scheduled, '/admin/articles?status=scheduled')}
      ${d.comments !== null ? card('تعليقات بانتظار المراجعة', d.comments, '/admin/comments') : ''}
      ${d.ads ? html`${card('حملات إعلانية تعمل الآن', d.ads.running, '/admin/ads')}${card('طلبات إعلان جديدة', d.ads.requests, '/admin/ads/requests')}` : ''}
    </div>
    <div class="cols">
      ${d.series ? html`<section class="panel"><h2>زيارات الموقع خلال 14 يومًا</h2>${barChart(d.series)}<p class="muted small">تُحتسب الزيارات من الخادم لكل صفحة تُعرض لزائر (مع استبعاد محركات البحث المعروفة). للحصول على تحليلات تفصيلية يمكن ربط أداة مثل Google Analytics لاحقًا.</p></section>` : ''}
      <section class="panel"><h2>إجراءات سريعة</h2><div class="quick">
        ${can(u, 'articles.create') ? html`<a class="btn btn-primary" href="/admin/articles/new">كتابة مادة جديدة</a>` : ''}
        ${can(u, 'breaking.manage') ? html`<a class="btn" href="/admin/breaking">إضافة خبر عاجل</a>` : ''}
        ${can(u, 'media.upload') ? html`<a class="btn" href="/admin/media">رفع صور</a>` : ''}
        ${can(u, 'ads.manage') ? html`<a class="btn" href="/admin/ads/new">إنشاء حملة إعلانية</a>` : ''}
      </div></section>
    </div>
    <div class="cols">
      ${d.top ? html`<section class="panel"><h2>الأكثر مشاهدة خلال 7 أيام</h2>${d.top.length ? html`<ol class="top-list">${d.top.map((a) => html`<li><a href="${articleUrl(a)}" target="_blank" rel="noopener">${a.title}</a><span>${fmtNum(a.views)} مشاهدة</span></li>`)}</ol>` : html`<p class="muted">لا توجد مشاهدات مسجلة بعد.</p>`}</section>` : ''}
      ${d.activity ? html`<section class="panel"><h2>آخر النشاطات</h2>${d.activity.length ? html`<ul class="activity">${d.activity.map((l) => html`<li><strong>${l.user_name || 'النظام'}</strong> ${l.action}${l.details ? html`: <span>${truncate(l.details, 70)}</span>` : ''}<time>${relTime(l.created_at)}</time></li>`)}</ul>` : html`<p class="muted">لا توجد نشاطات بعد.</p>`}</section>` : ''}
      ${d.mine ? html`<section class="panel"><h2>آخر موادي</h2>${d.mine.length ? html`<ul class="activity">${d.mine.map((a) => html`<li><a href="/admin/articles/${a.id}/edit">${a.title}</a> ${badge(statusOf(a), STATUS[statusOf(a)])}</li>`)}</ul>` : html`<p class="muted">لم تكتب أي مادة بعد.</p>`}</section>` : ''}
    </div>` });
}

/* ======================= قائمة المواد ======================= */
function articlesList(ctx, { rows, counts, pg, filters, categories }) {
  const tab = (key, label) => html`<a href="/admin/articles${key ? `?status=${key}` : ''}" ${raw(filters.status === key ? 'aria-current="page"' : '')}>${label}<span>${counts[key || 'all']}</span></a>`;
  const qs = (p) => { const q = new URLSearchParams(Object.entries({ ...filters, page: p }).filter(([, v]) => v)); return `/admin/articles?${q}`; };
  return layout(ctx, { title: 'الأخبار والمقالات', active: filters.status === 'pending' ? 'review' : 'articles', actions: html`<a class="btn btn-primary" href="/admin/articles/new">مادة جديدة</a>`, body: html`
    <nav class="tabs" aria-label="حالة المواد">${tab('', 'الكل')}${tab('published', 'منشور')}${tab('scheduled', 'مجدول')}${tab('pending', 'بانتظار المراجعة')}${tab('draft', 'مسودات')}${tab('archived', 'مؤرشف')}</nav>
    <form class="filters" method="get" action="/admin/articles">
      ${filters.status ? html`<input type="hidden" name="status" value="${filters.status}">` : ''}
      <label class="sr-only" for="fq">بحث</label><input id="fq" type="search" name="q" value="${filters.q}" placeholder="ابحث في العناوين والنصوص">
      <select name="category" aria-label="القسم"><option value="">كل الأقسام</option>${categories.map((c) => html`<option value="${c.id}" ${sel(String(c.id) === String(filters.category))}>${c.name}</option>`)}</select>
      <button class="btn" type="submit">تصفية</button>
    </form>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>العنوان</th><th>الحالة</th><th>القسم</th><th>الكاتب</th><th>التاريخ</th><th>المشاهدات</th><th><span class="sr-only">إجراءات</span></th></tr></thead>
      <tbody>${rows.length ? rows.map((a) => { const st = statusOf(a); return html`<tr>
        <td class="t-title"><a href="/admin/articles/${a.id}/edit">${a.title}</a><div class="t-sub">${TYPES[a.type]}${a.is_featured ? html` <span class="pin">مثبت في الرئيسية</span>` : ''}${a.is_demo ? html` <span class="demo">تجريبي</span>` : ''}</div></td>
        <td>${badge(st, STATUS[st])}</td><td>${a.cat_name}</td><td>${a.author_name || '—'}</td>
        <td><time datetime="${a.published_at || a.updated_at}">${fmtDateTime(st === 'published' || st === 'scheduled' ? a.published_at : a.updated_at)}</time></td>
        <td>${fmtNum(a.views)}</td>
        <td class="t-actions"><a href="/admin/articles/${a.id}/edit">تعديل</a>${st === 'published' ? html`<a href="${articleUrl(a)}" target="_blank" rel="noopener">عرض</a>` : html`<a href="/admin/articles/${a.id}/preview" target="_blank" rel="noopener">معاينة</a>`}</td>
      </tr>`; }) : html`<tr><td colspan="7" class="empty">لا توجد مواد مطابقة. <a href="/admin/articles/new">اكتب مادة جديدة</a>.</td></tr>`}</tbody>
    </table></div>
    ${pg.pages > 1 ? html`<nav class="pager">${pg.page > 1 ? html`<a href="${qs(pg.page - 1)}">السابق</a>` : ''}<span>صفحة ${pg.page} من ${pg.pages}</span>${pg.page < pg.pages ? html`<a href="${qs(pg.page + 1)}">التالي</a>` : ''}</nav>` : ''}` });
}

/* ======================= محرر المادة ======================= */
function articleForm(ctx, { a, categories, authors, errors = [], recentMedia = [] }) {
  const u = ctx.user;
  const isNew = !a.id;
  const st = a.id ? statusOf(a) : 'draft';
  const canPublish = can(u, 'articles.publish');
  const lines = (arr, fn) => arr.map(fn).join('\n');
  const toolbar = html`<div class="md-toolbar" role="toolbar" aria-label="أدوات التنسيق" data-target="body">
    <button type="button" data-md="h2" title="عنوان فرعي">عنوان فرعي</button><button type="button" data-md="bold" title="غامق">غامق</button>
    <button type="button" data-md="link">رابط</button><button type="button" data-md="quote">اقتباس</button><button type="button" data-md="list">قائمة</button>
    <button type="button" data-md="image" data-open-media="insert">صورة</button><button type="button" class="preview-btn" data-preview>معاينة</button></div>`;
  return layout(ctx, { title: isNew ? 'مادة جديدة' : 'تعديل مادة', active: isNew ? 'new' : 'articles',
    actions: a.id ? html`${st === 'published' ? html`<a class="btn btn-ghost" href="${articleUrl(a)}" target="_blank" rel="noopener">عرض على الموقع</a>` : html`<a class="btn btn-ghost" href="/admin/articles/${a.id}/preview" target="_blank" rel="noopener">معاينة</a>`}` : '', body: html`
  ${errorsBox(errors)}
  ${a.review_note && (st === 'draft' || st === 'pending') ? html`<div class="flash flash-warn"><strong>ملاحظات المراجعة:</strong> ${a.review_note}</div>` : ''}
  ${a.is_demo ? html`<div class="flash flash-warn">هذه مادة تجريبية. تظهر للزوار بعلامة «تجريبي» ولا تُفهرس في محركات البحث.</div>` : ''}
  <form class="editor" method="post" action="${isNew ? '/admin/articles/new' : `/admin/articles/${a.id}/edit`}" enctype="multipart/form-data">
    ${csrf(ctx)}
    <div class="editor-main">
      <label class="field">العنوان الرئيسي<input name="title" required maxlength="200" value="${a.title || ''}" data-count="200" class="input-title"></label>
      <label class="field">المقدمة أو الملخص<span class="hint">تظهر تحت العنوان وفي بطاقات الأخبار ونتائج البحث.</span><textarea name="excerpt" rows="2" maxlength="400" data-count="400">${a.excerpt || ''}</textarea></label>
      <div class="field"><label for="body">نص المادة</label>${toolbar}
        <textarea id="body" name="body" rows="18" maxlength="60000" class="body-input">${a.body || ''}</textarea>
        <div class="preview prose" data-preview-pane hidden></div>
        <details class="help"><summary>طريقة التنسيق</summary><ul>
          <li>افصل بين الفقرات بسطر فارغ.</li><li><code>## عنوان</code> لعنوان فرعي، و<code>&gt; نص</code> لاقتباس.</li>
          <li><code>- بند</code> لقائمة، و<code>**نص**</code> لنص غامق.</li><li><code>[النص](https://example.com)</code> لرابط، و<code>![وصف](/uploads/...)</code> لصورة.</li>
          <li>لا يُسمح بأكواد HTML داخل النص حفاظًا على أمان الموقع.</li></ul></details>
      </div>
      <fieldset class="box"><legend>صورة الغلاف</legend>
        <div class="cover-row"><img class="cover-preview" data-cover-preview src="${a.cover_image || '/static/img/empty.svg'}" alt="">
          <div class="cover-fields">
            <label>رابط الصورة من المكتبة<input name="cover_image" data-cover-input value="${a.cover_image || ''}" dir="ltr" placeholder="/uploads/..."></label>
            <div class="row-btns"><button type="button" class="btn" data-open-media="cover">اختيار من المكتبة</button><label class="btn">رفع صورة جديدة<input type="file" name="cover_file" accept="image/jpeg,image/png,image/webp,image/gif" hidden data-file-name></label><span class="muted small" data-file-label></span></div>
            <label>تعليق الصورة<input name="cover_caption" maxlength="200" value="${a.cover_caption || ''}"></label>
          </div></div>
      </fieldset>
      <fieldset class="box"><legend>الفيديو ومعرض الصور</legend>
        <label>رابط فيديو يوتيوب (لمواد الفيديو)<input name="video_url" dir="ltr" maxlength="200" value="${a.video_id ? `https://www.youtube.com/watch?v=${a.video_id}` : a.video_url || ''}" placeholder="https://www.youtube.com/watch?v=..."></label>
        <label>صور المعرض<span class="hint">صورة في كل سطر بالشكل: الرابط | التعليق</span><textarea name="gallery" rows="4" dir="auto" data-gallery-input>${a.galleryText ?? lines(a.gallery || [], (g) => `${g.image}${g.caption ? ` | ${g.caption}` : ''}`)}</textarea></label>
        <button type="button" class="btn" data-open-media="gallery">إضافة صور من المكتبة</button>
      </fieldset>
      <fieldset class="box"><legend>المصادر والوسوم</legend>
        <label>المصادر الأصلية<span class="hint">مصدر في كل سطر بالشكل: اسم المصدر | الرابط (الرابط اختياري)</span><textarea name="sources" rows="3" dir="auto">${a.sourcesText ?? lines(a.sources || [], (s) => `${s.name}${s.url ? ` | ${s.url}` : ''}`)}</textarea></label>
        <label>الوسوم<span class="hint">افصل بينها بفاصلة، مثل: الدوري المصري، كرة القدم</span><input name="tags" maxlength="400" value="${a.tagsText ?? (a.tags || []).map((t) => t.name || t).join('، ')}"></label>
      </fieldset>
      <fieldset class="box"><legend>تحسين الظهور في محركات البحث (اختياري)</legend>
        <label>عنوان SEO<input name="meta_title" maxlength="70" data-count="70" value="${a.meta_title || ''}" placeholder="يُستخدم العنوان الرئيسي إذا تُرك فارغًا"></label>
        <label>وصف SEO<textarea name="meta_description" rows="2" maxlength="160" data-count="160" placeholder="تُستخدم المقدمة إذا تُرك فارغًا">${a.meta_description || ''}</textarea></label>
        <label>الرابط المختصر (slug)<input name="slug" maxlength="80" dir="auto" value="${a.slug || ''}" placeholder="يُنشأ تلقائيًا من العنوان"></label>
      </fieldset>
    </div>
    <aside class="editor-side">
      <section class="box publish-box"><h2>النشر</h2>
        <p>الحالة الحالية: ${badge(st, STATUS[st])}</p>
        ${a.published_at && (st === 'published' || st === 'scheduled') ? html`<p class="muted small">${st === 'scheduled' ? 'موعد النشر' : 'نُشر في'}: ${fmtDateTime(a.published_at)}</p>` : ''}
        ${canPublish ? html`
          <label>موعد النشر (للجدولة)<input type="datetime-local" name="publish_at" value="${a.publish_at_input ?? (st === 'scheduled' ? utcToLocalInput(a.published_at) : '')}"></label>
          <div class="pub-actions">
            <button class="btn btn-primary" name="action" value="publish">${st === 'published' ? 'تحديث المنشور' : 'نشر الآن'}</button>
            <button class="btn" name="action" value="schedule">جدولة النشر</button>
            <button class="btn" name="action" value="draft">${st === 'published' ? 'إلغاء النشر وحفظ كمسودة' : 'حفظ كمسودة'}</button>
            ${st === 'pending' ? html`<label>ملاحظة للكاتب عند الإعادة<textarea name="review_note" rows="2" maxlength="500"></textarea></label><button class="btn" name="action" value="return">إعادة للكاتب</button>` : ''}
            ${a.id && st !== 'archived' ? html`<button class="btn btn-ghost" name="action" value="archive">أرشفة</button>` : ''}
          </div>` : html`<div class="pub-actions">
            <button class="btn btn-primary" name="action" value="submit">إرسال للمراجعة</button>
            <button class="btn" name="action" value="draft">حفظ كمسودة</button></div>
            <p class="muted small">يراجع المحرر المادة وينشرها. لا يمكن للكاتب النشر مباشرة.</p>`}
      </section>
      <section class="box"><h2>التصنيف</h2>
        <label>القسم<select name="category_id" required><option value="">اختر القسم</option>${categories.map((c) => html`<option value="${c.id}" ${sel(c.id === a.category_id)}>${c.name}</option>`)}</select></label>
        <label>نوع المادة<select name="type">${Object.entries(TYPES).map(([k, v]) => html`<option value="${k}" ${sel(k === (a.type || 'news'))}>${v}</option>`)}</select></label>
        ${can(u, 'articles.edit_any') ? html`<label>الكاتب أو المحرر<select name="author_id">${authors.map((x) => html`<option value="${x.id}" ${sel(x.id === (a.author_id || u.id))}>${x.name}</option>`)}</select></label>` : html`<p class="muted small">الكاتب: ${u.name}</p>`}
      </section>
      <section class="box"><h2>خيارات</h2>
        ${canPublish ? html`<label class="check"><input type="checkbox" name="is_featured" value="1" ${chk(a.is_featured)}> تثبيت في أبرز أخبار الرئيسية</label>` : ''}
        <label class="check"><input type="checkbox" name="allow_comments" value="1" ${chk(isNew ? true : a.allow_comments)}> السماح بالتعليقات</label>
      </section>
      ${a.id && (can(u, 'articles.delete_any') || (a.created_by === u.id && ['draft', 'pending'].includes(a.status))) ? html`<section class="box danger"><h2>حذف المادة</h2><p class="muted small">الحذف نهائي ولا يمكن التراجع عنه. للإخفاء فقط استخدم الأرشفة.</p>
        <button class="btn btn-danger" form="delete-form" type="submit">حذف نهائيًا</button></section>` : ''}
    </aside>
  </form>
  ${a.id ? html`<form id="delete-form" method="post" action="/admin/articles/${a.id}/delete" data-confirm="هل تريد حذف هذه المادة نهائيًا؟">${csrf(ctx)}</form>` : ''}` });
}

/* ======================= مكتبة الوسائط ======================= */
function mediaPage(ctx, { items, pg }) {
  const kb = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} م.ب` : `${Math.round(n / 1024)} ك.ب`);
  return layout(ctx, { title: 'مكتبة الوسائط', active: 'media', body: html`
    <form class="panel upload-form" method="post" action="/admin/media/upload" enctype="multipart/form-data">${csrf(ctx)}
      <label>اختر صورة أو أكثر (JPG وPNG وWebP وGIF، حتى ${require('../config').maxUploadMb} ميجابايت للصورة)<input type="file" name="files" multiple required accept="image/jpeg,image/png,image/webp,image/gif"></label>
      <button class="btn btn-primary" type="submit">رفع الصور</button>
      <p class="muted small">يُنصح برفع صور بعرض 1200 إلى 1600 بكسل وضغطها قبل الرفع لتسريع تحميل الموقع.</p>
    </form>
    ${items.length ? html`<ul class="media-grid">${items.map((m) => html`<li>
      <img src="${m.path}" alt="" loading="lazy">
      <div class="m-info"><code dir="ltr">${m.path}</code><span>${m.width && m.height ? `${m.width}×${m.height}` : ''} ${kb(m.size)}</span><span>${m.uploader || '—'}</span><span>${fmtDate(m.created_at)}</span></div>
      <div class="m-actions"><button type="button" class="btn btn-sm" data-copy="${m.path}">نسخ الرابط</button>
      ${can(ctx.user, 'media.delete') ? html`<form method="post" action="/admin/media/${m.id}/delete" data-confirm="حذف هذه الصورة نهائيًا؟">${csrf(ctx)}<button class="btn btn-sm btn-danger" type="submit">حذف</button></form>` : ''}</div>
    </li>`)}</ul>` : html`<p class="panel empty">المكتبة فارغة. ارفع أول صورة من النموذج أعلاه.</p>`}
    ${pg.pages > 1 ? html`<nav class="pager">${pg.page > 1 ? html`<a href="/admin/media?page=${pg.page - 1}">السابق</a>` : ''}<span>صفحة ${pg.page} من ${pg.pages}</span>${pg.page < pg.pages ? html`<a href="/admin/media?page=${pg.page + 1}">التالي</a>` : ''}</nav>` : ''}` });
}

/* ======================= الأخبار العاجلة ======================= */
function breakingPage(ctx, { items, articles, errors = [] }) {
  const now = new Date().toISOString();
  return layout(ctx, { title: 'الأخبار العاجلة', active: 'breaking', body: html`
    ${errorsBox(errors)}
    <form class="panel form-grid" method="post" action="/admin/breaking">${csrf(ctx)}
      <h2 class="wide">إضافة خبر عاجل إلى الشريط</h2>
      <label class="wide">نص الخبر العاجل<input name="text" required maxlength="160" data-count="160" placeholder="جملة قصيرة وواضحة"></label>
      <label>ربطه بمادة منشورة (اختياري)<select name="article_id"><option value="">بدون رابط</option>${articles.map((x) => html`<option value="${x.id}">${truncate(x.title, 80)}</option>`)}</select></label>
      <label>يختفي تلقائيًا بعد<select name="hours"><option value="1">ساعة</option><option value="3">3 ساعات</option><option value="6" selected>6 ساعات</option><option value="12">12 ساعة</option><option value="24">24 ساعة</option><option value="48">يومين</option><option value="0">لا يختفي تلقائيًا</option></select></label>
      <button class="btn btn-primary" type="submit">إضافة إلى الشريط</button>
    </form>
    <div class="table-wrap"><table class="table"><thead><tr><th>النص</th><th>الحالة</th><th>ينتهي</th><th>أضافه</th><th><span class="sr-only">إجراءات</span></th></tr></thead><tbody>
    ${items.length ? items.map((b) => { const live = b.active && (!b.expires_at || b.expires_at > now); return html`<tr>
      <td>${b.text}${b.article_title ? html`<div class="t-sub">مرتبط بـ: ${truncate(b.article_title, 60)}</div>` : ''}</td>
      <td>${live ? badge('published', 'ظاهر الآن') : b.active ? badge('archived', 'انتهى') : badge('draft', 'متوقف')}</td>
      <td>${b.expires_at ? fmtDateTime(b.expires_at) : 'بدون'}</td><td>${b.author_name || '—'}</td>
      <td class="t-actions"><form method="post" action="/admin/breaking/${b.id}/toggle">${csrf(ctx)}<button class="link" type="submit">${b.active ? 'إيقاف' : 'تفعيل'}</button></form>
        <form method="post" action="/admin/breaking/${b.id}/delete" data-confirm="حذف هذا الخبر العاجل؟">${csrf(ctx)}<button class="link danger" type="submit">حذف</button></form></td></tr>`; })
    : html`<tr><td colspan="5" class="empty">لا توجد أخبار عاجلة. الشريط مخفي عن الزوار حتى تضيف خبرًا.</td></tr>`}
    </tbody></table></div>` });
}

/* ======================= التعليقات ======================= */
function commentsPage(ctx, { tab, items, counts, enabled }) {
  const t = (key, label) => html`<a href="/admin/comments?tab=${key}" ${raw(tab === key ? 'aria-current="page"' : '')}>${label}<span>${counts[key]}</span></a>`;
  return layout(ctx, { title: 'التعليقات والبلاغات', active: 'comments', body: html`
    ${!enabled ? html`<div class="flash flash-warn">التعليقات متوقفة حاليًا على الموقع. يمكنك تفعيلها من <a href="/admin/settings">الإعدادات</a>.</div>` : ''}
    <nav class="tabs">${t('pending', 'بانتظار المراجعة')}${t('reported', 'عليها بلاغات')}${t('approved', 'منشورة')}${t('rejected', 'مرفوضة')}</nav>
    ${items.length ? html`<ul class="comment-admin">${items.map((c) => html`<li>
      <div class="c-meta"><strong>${c.name}</strong> على <a href="${articleUrl({ id: c.article_id, slug: c.article_slug })}" target="_blank" rel="noopener">${truncate(c.article_title, 70)}</a><time>${fmtDateTime(c.created_at)}</time></div>
      <p>${c.body}</p>
      ${c.open_reports ? html`<p class="reports-note">بلاغات مفتوحة: ${c.open_reports}${c.report_reasons ? ` (${c.report_reasons})` : ''}</p>` : ''}
      <div class="row-btns">
        ${c.status !== 'approved' ? html`<form method="post" action="/admin/comments/${c.id}/approve">${csrf(ctx)}<button class="btn btn-sm btn-primary">موافقة ونشر</button></form>` : ''}
        ${c.status !== 'rejected' ? html`<form method="post" action="/admin/comments/${c.id}/reject">${csrf(ctx)}<button class="btn btn-sm">رفض وإخفاء</button></form>` : ''}
        ${c.open_reports ? html`<form method="post" action="/admin/comments/${c.id}/dismiss">${csrf(ctx)}<button class="btn btn-sm btn-ghost">إغلاق البلاغات</button></form>` : ''}
        <form method="post" action="/admin/comments/${c.id}/delete" data-confirm="حذف التعليق نهائيًا؟">${csrf(ctx)}<button class="btn btn-sm btn-danger">حذف</button></form>
      </div></li>`)}</ul>` : html`<p class="panel empty">لا توجد تعليقات في هذا القسم.</p>`}` });
}

module.exports = { layout, shell, login, forbidden, dashboard, articlesList, articleForm, mediaPage, breakingPage, commentsPage, barChart, csrf, errorsBox, badge, sel, chk, STATUS, TYPES, statusOf, MSG };
