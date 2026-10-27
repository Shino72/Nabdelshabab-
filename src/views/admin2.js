'use strict';
const { html, raw, fmtDate, fmtDateTime, fmtNum, utcToLocalInput, articleUrl, truncate } = require('../util');
const { ROLE_LABELS } = require('../security');
const { layout, csrf, errorsBox, badge, sel, chk, barChart } = require('./admin');
const config = require('../config');

const ctr = (imp, clk) => (imp ? `${((clk / imp) * 100).toFixed(2)}%` : '—');

/* ======================= الحملات الإعلانية ======================= */
function campaigns(ctx, { rows, stateOf }) {
  return layout(ctx, { title: 'الحملات الإعلانية', active: 'ads', actions: html`<a class="btn btn-primary" href="/admin/ads/new">حملة جديدة</a>`, body: html`
    <p class="muted">يظهر الإعلان تلقائيًا في مساحته طوال فترة الحملة. عند وجود أكثر من حملة نشطة في المساحة نفسها تُعرض بالتناوب.
      تُحتسب مرات الظهور عند عرض الصفحة التي تحتوي الإعلان، وتُحتسب النقرات عند الضغط عليه (مع استبعاد محركات البحث المعروفة).</p>
    <div class="table-wrap"><table class="table"><thead><tr><th>الحملة</th><th>المساحة</th><th>الفترة</th><th>الحالة</th><th>الظهور</th><th>النقرات</th><th>نسبة النقر</th><th>الدفع</th><th><span class="sr-only">إجراءات</span></th></tr></thead><tbody>
    ${rows.length ? rows.map((c) => { const s = stateOf(c); return html`<tr>
      <td class="t-title"><a href="/admin/ads/${c.id}/edit">${c.title}</a><div class="t-sub">${c.advertiser_name}</div></td>
      <td>${c.slot_name}<div class="t-sub" dir="ltr">${c.width}×${c.height}</div></td>
      <td>${fmtDate(c.starts_at)}<div class="t-sub">حتى ${fmtDate(new Date(new Date(c.ends_at).getTime() - 1000).toISOString())}</div></td>
      <td>${badge(s.key === 'running' ? 'published' : s.key === 'scheduled' ? 'scheduled' : s.key === 'paused' ? 'draft' : 'archived', s.label)}</td>
      <td>${fmtNum(c.impressions)}</td><td>${fmtNum(c.clicks)}</td><td>${ctr(c.impressions, c.clicks)}</td>
      <td>${{ unpaid: 'غير مدفوع', paid: 'مدفوع', free: 'مجاني' }[c.payment_status]}${c.amount ? html`<div class="t-sub">${fmtNum(c.amount)} ج.م</div>` : ''}</td>
      <td class="t-actions"><a href="/admin/ads/${c.id}/edit">تعديل</a><a href="/admin/ads/${c.id}/report.csv">تقرير CSV</a>
        <form method="post" action="/admin/ads/${c.id}/toggle">${csrf(ctx)}<button class="link">${c.status === 'active' ? 'إيقاف' : 'استئناف'}</button></form></td></tr>`; })
    : html`<tr><td colspan="9" class="empty">لا توجد حملات بعد. <a href="/admin/ads/new">أنشئ أول حملة</a>.</td></tr>`}
    </tbody></table></div>` });
}
function campaignForm(ctx, { c, slots, errors = [] }) {
  const isNew = !c.id;
  return layout(ctx, { title: isNew ? 'حملة إعلانية جديدة' : 'تعديل حملة إعلانية', active: 'ads', body: html`
    ${errorsBox(errors)}
    <form class="panel form-grid" method="post" action="${isNew ? '/admin/ads/new' : `/admin/ads/${c.id}/edit`}" enctype="multipart/form-data">${csrf(ctx)}
      <h2 class="wide">بيانات الحملة</h2>
      <label>اسم الحملة<input name="title" required maxlength="120" value="${c.title || ''}"></label>
      <label>المساحة الإعلانية<select name="slot_id" required>${slots.map((s) => html`<option value="${s.id}" ${sel(s.id === c.slot_id)}>${s.name} (${s.width}×${s.height})${s.active ? '' : ' — متوقفة'}</option>`)}</select></label>
      <label>تاريخ البداية<input type="date" name="start" required value="${c.start || ''}"></label>
      <label>تاريخ النهاية (شاملًا)<input type="date" name="end" required value="${c.end || ''}"></label>
      <label>رابط الوجهة عند النقر<input name="target_url" required type="url" dir="ltr" maxlength="500" value="${c.target_url || ''}" placeholder="https://"></label>
      <label>نص بديل للصورة<input name="alt_text" maxlength="150" value="${c.alt_text || ''}" placeholder="وصف قصير يظهر لقارئات الشاشة"></label>
      <fieldset class="wide box"><legend>صورة الإعلان</legend>
        <div class="cover-row"><img class="cover-preview" data-cover-preview src="${c.image || '/static/img/empty.svg'}" alt="">
        <div class="cover-fields"><label>رابط الصورة من المكتبة<input name="image" data-cover-input dir="ltr" value="${c.image || ''}" placeholder="/uploads/..."></label>
          <div class="row-btns"><button type="button" class="btn" data-open-media="cover">اختيار من المكتبة</button><label class="btn">رفع صورة<input type="file" name="image_file" accept="image/jpeg,image/png,image/webp,image/gif" hidden data-file-name></label><span class="muted small" data-file-label></span></div>
          <p class="muted small">استخدم صورة بنفس مقاس المساحة أو بضعفه للشاشات عالية الدقة.</p></div></div>
      </fieldset>
      <h2 class="wide">بيانات المعلن</h2>
      <label>اسم المعلن (الشركة)<input name="advertiser_name" required maxlength="120" value="${c.advertiser_name || ''}"></label>
      <label>اسم المسؤول<input name="contact_name" maxlength="80" value="${c.contact_name || ''}"></label>
      <label>البريد الإلكتروني<input name="contact_email" type="email" dir="ltr" maxlength="120" value="${c.contact_email || ''}"></label>
      <label>الهاتف<input name="contact_phone" dir="ltr" maxlength="30" value="${c.contact_phone || ''}"></label>
      <h2 class="wide">الحالة والدفع</h2>
      <label>حالة الحملة<select name="status"><option value="active" ${sel(c.status !== 'paused')}>نشطة</option><option value="paused" ${sel(c.status === 'paused')}>موقوفة</option></select></label>
      <label>حالة الدفع<select name="payment_status"><option value="unpaid" ${sel(c.payment_status === 'unpaid' || !c.payment_status)}>غير مدفوع</option><option value="paid" ${sel(c.payment_status === 'paid')}>مدفوع</option><option value="free" ${sel(c.payment_status === 'free')}>مجاني</option></select></label>
      <label>قيمة الحملة (ج.م)<input name="amount" type="number" min="0" step="1" value="${c.amount ?? ''}"></label>
      <label class="wide">ملاحظات داخلية<textarea name="notes" rows="2" maxlength="1000">${c.notes || ''}</textarea></label>
      <p class="muted small wide">الدفع الإلكتروني غير مفعّل حاليًا. حالة الدفع تُحدَّث يدويًا بعد التحصيل.</p>
      <div class="wide row-btns"><button class="btn btn-primary" type="submit">حفظ الحملة</button>
      ${!isNew ? html`<button class="btn btn-danger" form="del-campaign" type="submit">حذف الحملة</button>` : ''}</div>
    </form>
    ${!isNew ? html`<form id="del-campaign" method="post" action="/admin/ads/${c.id}/delete" data-confirm="حذف الحملة وإحصاءاتها نهائيًا؟">${csrf(ctx)}</form>` : ''}` });
}
function slotsPage(ctx, { slots, units }) {
  return layout(ctx, { title: 'المساحات الإعلانية والأسعار', active: 'slots', body: html`
    <p class="muted">هذه المساحات مثبتة في تصميم الموقع. يمكنك تعديل الاسم والسعر أو إيقاف المساحة (لن تظهر للزوار ولا في صفحة «أعلن معنا»).</p>
    <div class="slot-list">${slots.map((s) => html`<form class="panel slot-row" method="post" action="/admin/ads/slots/${s.id}">${csrf(ctx)}
      <div class="slot-id"><strong>${s.page}</strong><code dir="ltr">${s.key}</code><code dir="ltr">${s.width}×${s.height}</code></div>
      <label>الاسم الظاهر<input name="name" required maxlength="80" value="${s.name}"></label>
      <label>السعر (ج.م)<input name="price" type="number" min="0" step="1" value="${s.price}"></label>
      <label>لكل<select name="price_unit">${Object.entries(units).map(([k, v]) => html`<option value="${k}" ${sel(k === s.price_unit)}>${v}</option>`)}</select></label>
      <label class="check"><input type="checkbox" name="active" value="1" ${chk(s.active)}> مفعّلة</label>
      <button class="btn" type="submit">حفظ</button></form>`)}</div>` });
}
function requestsPage(ctx, { rows }) {
  const ST = { new: 'جديد', contacted: 'تم التواصل', converted: 'تحوّل إلى حملة', closed: 'مغلق' };
  return layout(ctx, { title: 'طلبات الإعلان', active: 'requests', body: html`
    <p class="muted">الطلبات المرسلة من صفحة «أعلن معنا». لا تُرسل إشعارات بريدية تلقائيًا حاليًا، لذا راجع هذه الصفحة بانتظام.</p>
    ${rows.length ? html`<ul class="requests">${rows.map((r) => html`<li class="panel">
      <div class="req-head"><strong>${r.company}</strong>${badge(r.status === 'new' ? 'pending' : r.status === 'converted' ? 'published' : 'draft', ST[r.status])}<time>${fmtDateTime(r.created_at)}</time></div>
      <dl class="req-info"><div><dt>المسؤول</dt><dd>${r.contact_name}</dd></div><div><dt>الهاتف</dt><dd dir="ltr">${r.phone}</dd></div>
        ${r.email ? html`<div><dt>البريد</dt><dd><a href="mailto:${r.email}">${r.email}</a></dd></div>` : ''}
        <div><dt>المساحة</dt><dd>${r.slot_name || 'غير محددة'}</dd></div><div><dt>البدء</dt><dd>${r.start_date || '—'}</dd></div><div><dt>المدة</dt><dd>${r.duration || '—'}</dd></div></dl>
      ${r.message ? html`<p>${r.message}</p>` : ''}
      <div class="row-btns"><form method="post" action="/admin/ads/requests/${r.id}">${csrf(ctx)}<select name="status" aria-label="حالة الطلب">${Object.entries(ST).map(([k, v]) => html`<option value="${k}" ${sel(k === r.status)}>${v}</option>`)}</select><button class="btn btn-sm">تحديث</button></form>
        <a class="btn btn-sm" href="/admin/ads/new?from_request=${r.id}">تحويل إلى حملة</a></div>
    </li>`)}</ul>` : html`<p class="panel empty">لا توجد طلبات بعد. شارك رابط صفحة <a href="/advertise" target="_blank">أعلن معنا</a> مع المعلنين.</p>`}` });
}

/* ======================= المستخدمون ======================= */
function usersPage(ctx, { users }) {
  return layout(ctx, { title: 'المستخدمون والصلاحيات', active: 'users', actions: html`<a class="btn btn-primary" href="/admin/users/new">مستخدم جديد</a>`, body: html`
    <section class="panel roles-help"><h2>الصلاحيات</h2><dl>
      <div><dt>${ROLE_LABELS.admin}</dt><dd>كل الصلاحيات: المستخدمون والإعدادات والإعلانات والمحتوى.</dd></div>
      <div><dt>${ROLE_LABELS.editor}</dt><dd>كتابة ومراجعة ونشر وجدولة كل المواد، الأخبار العاجلة، التعليقات، المصادر، التقارير.</dd></div>
      <div><dt>${ROLE_LABELS.writer}</dt><dd>كتابة المسودات ورفع الصور وإرسال المواد للمراجعة فقط.</dd></div>
      <div><dt>${ROLE_LABELS.ads}</dt><dd>إدارة الحملات والمساحات وطلبات الإعلان وعرض التقارير.</dd></div></dl></section>
    <div class="table-wrap"><table class="table"><thead><tr><th>الاسم</th><th>البريد</th><th>الدور</th><th>الحالة</th><th>المواد</th><th>آخر دخول</th><th><span class="sr-only">إجراءات</span></th></tr></thead><tbody>
    ${users.map((u) => html`<tr><td class="t-title">${u.name}${u.title ? html`<div class="t-sub">${u.title}</div>` : ''}</td><td dir="ltr">${u.email}</td><td>${ROLE_LABELS[u.role]}</td>
      <td>${u.active ? badge('published', 'نشط') : badge('archived', 'معطّل')}${u.is_demo ? html` <span class="demo">تجريبي</span>` : ''}</td><td>${u.article_count}</td>
      <td>${u.last_login_at ? fmtDateTime(u.last_login_at) : 'لم يسجل الدخول'}</td><td class="t-actions"><a href="/admin/users/${u.id}/edit">تعديل</a></td></tr>`)}
    </tbody></table></div>` });
}
function userForm(ctx, { u, errors = [] }) {
  const isNew = !u.id;
  return layout(ctx, { title: isNew ? 'مستخدم جديد' : `تعديل: ${u.name}`, active: 'users', body: html`
    ${errorsBox(errors)}
    <form class="panel form-grid" method="post" action="${isNew ? '/admin/users/new' : `/admin/users/${u.id}/edit`}">${csrf(ctx)}
      <label>الاسم كما يظهر على المواد<input name="name" required maxlength="80" value="${u.name || ''}"></label>
      <label>البريد الإلكتروني (لتسجيل الدخول)<input name="email" type="email" required dir="ltr" maxlength="120" value="${u.email || ''}"></label>
      <label>الدور<select name="role">${Object.entries(ROLE_LABELS).map(([k, v]) => html`<option value="${k}" ${sel(k === (u.role || 'writer'))}>${v}</option>`)}</select></label>
      <label>المسمى الوظيفي<input name="title" maxlength="80" value="${u.title || ''}" placeholder="مثال: محرر رياضي"></label>
      <label class="wide">نبذة تظهر في صفحة الكاتب<textarea name="bio" rows="3" maxlength="600">${u.bio || ''}</textarea></label>
      <label>${isNew ? 'كلمة المرور' : 'كلمة مرور جديدة (اتركها فارغة لعدم التغيير)'}<input name="password" type="password" ${raw(isNew ? 'required' : '')} minlength="10" autocomplete="new-password" dir="ltr"></label>
      ${!isNew ? html`<label class="check"><input type="checkbox" name="active" value="1" ${chk(u.active)}> الحساب نشط</label>` : ''}
      <p class="muted small wide">كلمة المرور 10 أحرف على الأقل وتحتوي على حروف وأرقام. عند تغييرها يُسجَّل خروج المستخدم من كل الأجهزة.</p>
      <div class="wide"><button class="btn btn-primary" type="submit">${isNew ? 'إنشاء المستخدم' : 'حفظ التغييرات'}</button></div>
    </form>` });
}
function profilePage(ctx, { u, errors = [] }) {
  return layout(ctx, { title: 'حسابي', active: 'profile', body: html`
    ${errorsBox(errors)}
    <div class="cols">
    <form class="panel form-grid one" method="post" action="/admin/profile">${csrf(ctx)}<h2>البيانات الشخصية</h2>
      <label>الاسم<input name="name" required maxlength="80" value="${u.name}"></label>
      <label>المسمى الوظيفي<input name="title" maxlength="80" value="${u.title || ''}"></label>
      <label>النبذة<textarea name="bio" rows="3" maxlength="600">${u.bio || ''}</textarea></label>
      <button class="btn btn-primary" type="submit">حفظ</button></form>
    <form class="panel form-grid one" method="post" action="/admin/profile/password">${csrf(ctx)}<h2>تغيير كلمة المرور</h2>
      <label>كلمة المرور الحالية<input type="password" name="current" required autocomplete="current-password" dir="ltr"></label>
      <label>كلمة المرور الجديدة<input type="password" name="password" required minlength="10" autocomplete="new-password" dir="ltr"></label>
      <label>تأكيد كلمة المرور الجديدة<input type="password" name="confirm" required minlength="10" autocomplete="new-password" dir="ltr"></label>
      <button class="btn btn-primary" type="submit">تغيير كلمة المرور</button></form>
    </div>` });
}

/* ======================= الإعدادات ======================= */
function settingsPage(ctx, { s, errors = [], demoCount }) {
  const input = (k, label, attrs = '') => html`<label>${label}<input name="${k}" value="${s[k] || ''}" ${raw(attrs)}></label>`;
  const area = (k, label, rows = 8, hint = '') => html`<label class="wide">${label}${hint ? html`<span class="hint">${hint}</span>` : ''}<textarea name="${k}" rows="${rows}" dir="auto">${s[k] || ''}</textarea></label>`;
  return layout(ctx, { title: 'إعدادات الموقع', active: 'settings', body: html`
    ${errorsBox(errors)}
    <form class="settings" method="post" action="/admin/settings">${csrf(ctx)}
      <fieldset class="panel form-grid"><legend>هوية الموقع</legend>
        ${input('site_name', 'اسم الموقع', 'required maxlength="40"')}${input('site_tagline', 'الشعار النصي', 'maxlength="80"')}
        <label class="wide">وصف الموقع (يظهر في محركات البحث والتذييل)<textarea name="site_description" rows="2" maxlength="300">${s.site_description}</textarea></label>
        <p class="muted small wide">رابط الموقع الأساسي: <code dir="ltr">${config.siteUrl}</code> (يُضبط من متغير SITE_URL في ملف الإعدادات على الخادم).</p>
      </fieldset>
      <fieldset class="panel form-grid"><legend>بيانات الإدارة</legend>
        ${area('masthead_credits', 'تظهر في تذييل الموقع وصفحة «عن الموقع»', 4, 'سطر لكل اسم بالشكل: الصفة: الاسم')}
      </fieldset>
      <fieldset class="panel form-grid"><legend>بيانات التواصل</legend>
        ${input('contact_email', 'البريد العام', 'type="email" dir="ltr"')}${input('ads_email', 'بريد الإعلانات', 'type="email" dir="ltr"')}
        ${input('contact_phone', 'الهاتف', 'dir="ltr"')}${input('whatsapp', 'رقم واتساب', 'dir="ltr"')}${input('address', 'العنوان', 'class="wide"')}
      </fieldset>
      <fieldset class="panel form-grid"><legend>وسائل التواصل الاجتماعي</legend>
        ${[['social_facebook', 'فيسبوك'], ['social_x', 'إكس (تويتر)'], ['social_instagram', 'إنستجرام'], ['social_youtube', 'يوتيوب'], ['social_tiktok', 'تيك توك'], ['social_telegram', 'تيليجرام']]
          .map(([k, l]) => input(k, l, 'type="url" dir="ltr" placeholder="https://"'))}
      </fieldset>
      <fieldset class="panel form-grid"><legend>التعليقات والإعلانات</legend>
        <label class="check wide"><input type="checkbox" name="comments_enabled" value="1" ${chk(s.comments_enabled === '1')}> تفعيل التعليقات على الأخبار (تخضع كلها للمراجعة قبل النشر)</label>
        <label class="check wide"><input type="checkbox" name="show_empty_ad_slots" value="1" ${chk(s.show_empty_ad_slots === '1')}> عرض «مساحة إعلانية متاحة» في المساحات الفارغة لجذب المعلنين</label>
      </fieldset>
      <fieldset class="panel form-grid"><legend>نصوص الصفحات</legend>
        <p class="muted small wide">تستخدم نفس طريقة تنسيق المقالات. اكتب {{site}} ليُستبدل باسم الموقع تلقائيًا.</p>
        ${area('about_body', 'صفحة «عن الموقع»', 10)}${area('advertise_body', 'مقدمة صفحة «أعلن معنا»', 6)}
        ${area('privacy_body', 'سياسة الخصوصية', 10)}${area('terms_body', 'شروط الاستخدام', 10)}
        <label class="wide">نص حقوق النشر في التذييل<input name="footer_note" maxlength="200" value="${s.footer_note}"></label>
        <label class="wide">سطر في أسفل الموقع تمامًا (اتركه فارغًا لإخفائه)<input name="project_note" maxlength="120" value="${s.project_note}"></label>
      </fieldset>
      <div class="sticky-save"><button class="btn btn-primary" type="submit">حفظ الإعدادات</button></div>
    </form>
    <section class="panel danger" id="demo"><h2>المحتوى التجريبي</h2>
      ${demoCount ? html`<p>يحتوي الموقع على ${demoCount} مادة تجريبية (مع كتّابها ومشاهداتها وأخبارها العاجلة). احذفها قبل إطلاق الموقع للجمهور.</p>
        <form method="post" action="/admin/settings/delete-demo" data-confirm="سيتم حذف كل المحتوى التجريبي نهائيًا. متابعة؟">${csrf(ctx)}<button class="btn btn-danger" type="submit">حذف كل المحتوى التجريبي</button></form>`
      : html`<p class="muted">لا يوجد محتوى تجريبي على الموقع.</p>`}
    </section>` });
}

/* ======================= الأقسام ======================= */
function categoriesPage(ctx, { cats }) {
  return layout(ctx, { title: 'الأقسام', active: 'categories', body: html`
    <p class="muted">روابط الأقسام ثابتة للحفاظ على ترتيبها في محركات البحث. يمكنك تعديل الاسم والوصف وترتيب الظهور.</p>
    <div class="slot-list">${cats.map((c) => html`<form class="panel slot-row cat-row" method="post" action="/admin/categories/${c.id}">${csrf(ctx)}
      <div class="slot-id"><strong>${c.name}</strong><code dir="ltr">/category/${c.slug}</code></div>
      <label>الاسم<input name="name" required maxlength="40" value="${c.name}"></label>
      <label class="grow">الوصف<input name="description" maxlength="200" value="${c.description || ''}"></label>
      <label>الترتيب<input name="sort" type="number" min="0" max="99" value="${c.sort}"></label>
      <label class="check"><input type="checkbox" name="show_on_home" value="1" ${chk(c.show_on_home)}> في الرئيسية</label>
      <button class="btn">حفظ</button></form>`)}</div>` });
}

/* ======================= التقارير ======================= */
function reportsPage(ctx, d) {
  const totalArt = d.byCategory.reduce((s, r) => s + r.views, 0) || 1;
  return layout(ctx, { title: 'تقارير الأداء', active: 'reports', body: html`
    <form class="filters" method="get" action="/admin/reports"><label>من<input type="date" name="from" value="${d.from}"></label><label>إلى<input type="date" name="to" value="${d.to}"></label><button class="btn">عرض</button></form>
    <div class="stats">
      <div class="stat"><span class="stat-v">${fmtNum(d.siteTotal)}</span><span class="stat-l">زيارات الصفحات</span></div>
      <div class="stat"><span class="stat-v">${fmtNum(d.articleTotal)}</span><span class="stat-l">مشاهدات المواد</span></div>
      <div class="stat"><span class="stat-v">${fmtNum(d.publishedCount)}</span><span class="stat-l">مواد نُشرت في الفترة</span></div>
      <div class="stat"><span class="stat-v">${fmtNum(d.ads.reduce((s, a) => s + a.clicks, 0))}</span><span class="stat-l">نقرات الإعلانات</span></div>
    </div>
    <section class="panel"><h2>الزيارات اليومية</h2>${barChart(d.series.length > 60 ? d.series.slice(-60) : d.series)}</section>
    <div class="cols">
      <section class="panel"><h2>أكثر المواد مشاهدة</h2><div class="table-wrap"><table class="table compact"><thead><tr><th>المادة</th><th>القسم</th><th>المشاهدات</th></tr></thead><tbody>
        ${d.top.length ? d.top.map((a) => html`<tr><td><a href="${articleUrl(a)}" target="_blank" rel="noopener">${truncate(a.title, 70)}</a>${a.is_demo ? html` <span class="demo">تجريبي</span>` : ''}</td><td>${a.cat_name}</td><td>${fmtNum(a.views)}</td></tr>`) : html`<tr><td colspan="3" class="empty">لا توجد بيانات في هذه الفترة.</td></tr>`}
      </tbody></table></div></section>
      <section class="panel"><h2>المشاهدات حسب القسم</h2><ul class="bars">${d.byCategory.map((r) => html`<li><span>${r.name}</span><meter min="0" max="${totalArt}" value="${r.views}"></meter><span>${fmtNum(r.views)}</span></li>`)}</ul></section>
    </div>
    <div class="cols">
      <section class="panel"><h2>إنتاج الكتّاب</h2><div class="table-wrap"><table class="table compact"><thead><tr><th>الكاتب</th><th>مواد منشورة</th><th>إجمالي مشاهداتها</th></tr></thead><tbody>
        ${d.byAuthor.length ? d.byAuthor.map((r) => html`<tr><td>${r.name}</td><td>${r.articles}</td><td>${fmtNum(r.views)}</td></tr>`) : html`<tr><td colspan="3" class="empty">لا توجد مواد منشورة في الفترة.</td></tr>`}
      </tbody></table></div></section>
      <section class="panel"><h2>أداء الحملات الإعلانية</h2><div class="table-wrap"><table class="table compact"><thead><tr><th>الحملة</th><th>الظهور</th><th>النقرات</th><th>نسبة النقر</th></tr></thead><tbody>
        ${d.ads.length ? d.ads.map((a) => html`<tr><td>${a.title}<div class="t-sub">${a.advertiser_name}</div></td><td>${fmtNum(a.impressions)}</td><td>${fmtNum(a.clicks)}</td><td>${ctr(a.impressions, a.clicks)}</td></tr>`) : html`<tr><td colspan="4" class="empty">لا توجد حملات.</td></tr>`}
      </tbody></table></div></section>
    </div>
    <p class="muted small">الأرقام محسوبة من خادم الموقع مع استبعاد محركات البحث المعروفة، ولا تُحتسب إعادة تحميل الخبر من الزائر نفسه خلال 30 دقيقة. قد تختلف عن أدوات التحليل الخارجية.</p>` });
}

/* ======================= مصادر الأخبار ======================= */
function feedsPage(ctx, { sources, items, categories, errors = [] }) {
  return layout(ctx, { title: 'مصادر الأخبار (RSS)', active: 'feeds', body: html`
    <div class="flash flash-warn">استخدم فقط مصادر تسمح شروطها بإعادة الاستخدام، أو لديك اتفاق ترخيص معها. يجلب النظام العنوان والرابط وملخصًا قصيرًا فقط، ولا يُنشر أي شيء تلقائيًا: حوّل الخبر إلى مسودة، ثم أعد صياغته وتحقق منه واذكر المصدر قبل النشر.</div>
    ${errorsBox(errors)}
    <form class="panel form-grid" method="post" action="/admin/feeds">${csrf(ctx)}<h2 class="wide">إضافة مصدر</h2>
      <label>اسم المصدر<input name="name" required maxlength="80"></label>
      <label>رابط خلاصة RSS أو Atom<input name="url" required type="url" dir="ltr" maxlength="500" placeholder="https://example.com/rss.xml"></label>
      <label>القسم الافتراضي للمسودات<select name="category_id">${categories.map((c) => html`<option value="${c.id}">${c.name}</option>`)}</select></label>
      <button class="btn btn-primary" type="submit">إضافة المصدر</button></form>
    ${sources.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>المصدر</th><th>القسم</th><th>آخر جلب</th><th>جديد</th><th><span class="sr-only">إجراءات</span></th></tr></thead><tbody>
      ${sources.map((f) => html`<tr><td class="t-title">${f.name}${f.active ? '' : html` <span class="demo">متوقف</span>`}<div class="t-sub" dir="ltr">${truncate(f.url, 60)}</div></td><td>${f.cat_name || '—'}</td>
        <td>${f.last_fetched_at ? fmtDateTime(f.last_fetched_at) : 'لم يُجلب بعد'}${f.last_status ? html`<div class="t-sub">${f.last_status}</div>` : ''}</td><td>${f.new_items}</td>
        <td class="t-actions"><form method="post" action="/admin/feeds/${f.id}/fetch">${csrf(ctx)}<button class="link">جلب الآن</button></form>
          <form method="post" action="/admin/feeds/${f.id}/toggle">${csrf(ctx)}<button class="link">${f.active ? 'إيقاف' : 'تفعيل'}</button></form>
          <form method="post" action="/admin/feeds/${f.id}/delete" data-confirm="حذف المصدر وكل عناوينه المستوردة؟">${csrf(ctx)}<button class="link danger">حذف</button></form></td></tr>`)}
    </tbody></table></div>` : ''}
    <h2 class="h2">صندوق الوارد</h2>
    ${items.length ? html`<ul class="inbox">${items.map((i) => html`<li class="panel"><div class="c-meta"><strong>${i.source_name}</strong><time>${i.published_at ? fmtDateTime(i.published_at) : fmtDateTime(i.fetched_at)}</time></div>
      <h3>${i.title}</h3>${i.summary ? html`<p class="muted">${i.summary}</p>` : ''}
      <div class="row-btns">${i.link ? html`<a class="btn btn-sm btn-ghost" href="${i.link}" target="_blank" rel="noopener nofollow">فتح المصدر</a>` : ''}
        <form method="post" action="/admin/feeds/items/${i.id}/draft">${csrf(ctx)}<button class="btn btn-sm btn-primary">تحويل إلى مسودة</button></form>
        <form method="post" action="/admin/feeds/items/${i.id}/ignore">${csrf(ctx)}<button class="btn btn-sm">تجاهل</button></form></div></li>`)}</ul>`
    : html`<p class="panel empty">لا توجد عناوين جديدة. أضف مصدرًا ثم اضغط «جلب الآن».</p>`}` });
}

/* ======================= رسائل اتصل بنا ======================= */
function messagesPage(ctx, { tab, items, counts }) {
  const t = (key, label) => html`<a href="/admin/messages?tab=${key}" ${raw(tab === key ? 'aria-current="page"' : '')}>${label}<span>${counts[key]}</span></a>`;
  return layout(ctx, { title: 'رسائل «اتصل بنا»', active: 'messages', body: html`
    <nav class="tabs">${t('new', 'جديدة')}${t('read', 'مقروءة')}${t('archived', 'مؤرشفة')}</nav>
    ${items.length ? html`<ul class="inbox">${items.map((m) => html`<li class="panel">
      <div class="c-meta"><strong>${m.name}</strong><span>${m.subject}</span><time>${fmtDateTime(m.created_at)}</time></div>
      <dl class="req-info">${m.email ? html`<div><dt>البريد</dt><dd><a href="mailto:${m.email}">${m.email}</a></dd></div>` : ''}${m.phone ? html`<div><dt>الهاتف</dt><dd dir="ltr">${m.phone}</dd></div>` : ''}</dl>
      <p>${m.message}</p>
      <div class="row-btns">
        ${m.status === 'new' ? html`<form method="post" action="/admin/messages/${m.id}/read">${csrf(ctx)}<button class="btn btn-sm btn-primary">تمت القراءة</button></form>` : ''}
        ${m.status !== 'archived' ? html`<form method="post" action="/admin/messages/${m.id}/archive">${csrf(ctx)}<button class="btn btn-sm">أرشفة</button></form>` : ''}
        <form method="post" action="/admin/messages/${m.id}/delete" data-confirm="حذف الرسالة نهائيًا؟">${csrf(ctx)}<button class="btn btn-sm btn-danger">حذف</button></form>
      </div></li>`)}</ul>` : html`<p class="panel empty">لا توجد رسائل هنا.</p>`}` });
}

module.exports = { messagesPage, campaigns, campaignForm, slotsPage, requestsPage, usersPage, userForm, profilePage, settingsPage, categoriesPage, reportsPage, feedsPage };
