'use strict';
const { html, raw, esc, fmtDate, fmtDateTime, fmtTime, articleUrl, initials, readMinutes, fmtNum } = require('../util');
const { renderMarkup, markupToText, insertAfterParagraph } = require('../markup');
const L = require('./layout');
const Settings = require('../models/settings');
const config = require('../config');

const { layout, storyCard, storyRow, storyLine, sectionHead, opinionCard, adSlot, pagination, meta, img, coverOf, demoBadge } = L;

function orgLd(site) {
  return { '@context': 'https://schema.org', '@type': 'NewsMediaOrganization', name: site.site_name, url: config.siteUrl, logo: { '@type': 'ImageObject', url: `${config.siteUrl}/static/img/logo-512.png` } };
}

/* ======================= الرئيسية ======================= */
function home(ctx, d) {
  const site = ctx.site;
  const lead = d.lead;
  const body = html`
<div class="wrap home">
  <h1 class="sr-only">${site.site_name}: ${site.site_tagline}</h1>
  ${lead ? html`<section class="lead-zone" aria-label="أبرز الأخبار">
    <article class="lead-story">
      <a class="thumb" href="${articleUrl(lead)}" tabindex="-1" aria-hidden="true">${img(coverOf(lead), '', '', true)}${L.typeBadge(lead)}</a>
      <div class="lead-copy">
        ${meta(lead)}
        <h2><a href="${articleUrl(lead)}">${lead.title}</a></h2>
        ${lead.excerpt ? html`<p class="dek">${lead.excerpt}</p>` : ''}
      </div>
    </article>
    <div class="top-stories">
      ${sectionHead('أهم الأخبار', null)}
      ${d.top.map((a) => storyRow(a))}
    </div>
  </section>` : html`<section class="empty-state"><h2>لا توجد أخبار منشورة بعد</h2><p>انشر أول خبر من لوحة التحكم ليظهر هنا.</p></section>`}

  ${adSlot(ctx, 'home_leaderboard')}

  <div class="split">
    <section class="latest" aria-labelledby="latest-h">
      <div class="sec-head"><h2 id="latest-h"><span class="needle" aria-hidden="true"></span>آخر الأخبار</h2><a class="more" href="/archive">كل الأخبار حسب التاريخ</a></div>
      <ol class="timeline">${d.latest.map((a) => html`<li><time datetime="${a.published_at}">${fmtTime(a.published_at)}</time><div>${meta(a)}<h3><a href="${articleUrl(a)}">${a.title}</a></h3></div></li>`)}</ol>
    </section>
    <aside class="rail">
      <section class="most-read" aria-labelledby="mr-h">
        <div class="sec-head"><h2 id="mr-h"><span class="needle" aria-hidden="true"></span>الأكثر قراءة</h2></div>
        <ol class="ranked">${d.mostRead.map((a) => html`<li><a href="${articleUrl(a)}">${a.title}</a>${demoBadge(a)}</li>`)}</ol>
      </section>
      ${adSlot(ctx, 'home_sidebar')}
    </aside>
  </div>

  <div class="sections-grid">
    ${d.sections.map((s, i) => html`${i === 4 ? html`<div class="span-all">${adSlot(ctx, 'home_billboard')}</div>` : ''}
      <section class="cat-block">
        ${sectionHead(s.cat.name, `/category/${s.cat.slug}`, 'h2', true)}
        ${s.items[0] ? storyCard(s.items[0], { excerpt: true, cat: false }) : ''}
        <ul class="lines">${s.items.slice(1).map((a) => html`<li><h3><a href="${articleUrl(a)}">${a.title}</a></h3>${meta(a, { cat: false })}</li>`)}</ul>
      </section>`)}
  </div>

  ${d.opinions.length ? html`<section class="opinion-zone">
    ${sectionHead('الرأي والتحليلات', '/category/opinion')}
    <div class="op-grid">${d.opinions.map(opinionCard)}</div>
  </section>` : ''}

  ${d.reports.length ? html`<section class="reports-zone">
    ${sectionHead('تحقيقات وتقارير', '/category/reports')}
    <div class="grid-3">${d.reports.map((a) => storyCard(a, { excerpt: true, cat: false }))}</div>
  </section>` : ''}
</div>
${d.media.length ? html`<section class="media-band"><div class="wrap">
  ${sectionHead('الوسائط المتعددة', '/multimedia')}
  <div class="media-grid">${d.media.map((a) => storyCard(a, { cat: false }))}</div>
</div></section>` : ''}
<div class="wrap">
  <section class="browse">
    ${sectionHead('تصفح الأخبار حسب القسم والتاريخ', null)}
    ${archiveForm(ctx, {})}
    ${d.tags.length ? html`<div class="tag-cloud"><h3>وسوم متداولة</h3><ul>${d.tags.map((t) => html`<li><a href="/tag/${encodeURIComponent(t.slug)}">${t.name}</a></li>`)}</ul></div>` : ''}
  </section>
</div>`;
  const ld = [orgLd(site), { '@context': 'https://schema.org', '@type': 'WebSite', name: site.site_name, url: config.siteUrl,
    potentialAction: { '@type': 'SearchAction', target: `${config.siteUrl}/search?q={search_term_string}`, 'query-input': 'required name=search_term_string' } }];
  return layout(ctx, { canonical: '/', body, active: 'home', jsonld: ld });
}

function archiveForm(ctx, { date = '', category = '' }) {
  return html`<form class="archive-form" action="/archive" method="get">
    <label>اليوم<input type="date" name="date" value="${date}" max="${ctx.day}"></label>
    <label>القسم<select name="category"><option value="">كل الأقسام</option>${ctx.nav.map((c) => html`<option value="${c.slug}" ${raw(c.slug === category ? 'selected' : '')}>${c.name}</option>`)}</select></label>
    <button type="submit">عرض الأخبار</button>
  </form>`;
}

/* ======================= القسم ======================= */
function category(ctx, { cat, items, pg, mostRead }) {
  const isOpinion = cat.kind === 'opinion';
  const [first, ...rest] = pg.page === 1 && !isOpinion ? items : [null, ...items];
  const body = html`
<div class="wrap">
  <header class="page-head"><h1><span class="needle" aria-hidden="true"></span>${cat.name}</h1>${cat.description ? html`<p>${cat.description}</p>` : ''}
    <a class="head-link" href="/archive?category=${cat.slug}">أرشيف ${cat.name} حسب التاريخ</a></header>
  ${adSlot(ctx, 'category_top')}
  <div class="split">
    <div>
      ${!items.length ? html`<p class="empty-state">لا توجد مواد منشورة في هذا القسم بعد.</p>` : ''}
      ${first ? html`<div class="cat-lead">${storyCard(first, { excerpt: true, cat: false })}</div>` : ''}
      ${isOpinion ? html`<div class="op-grid op-grid-2">${rest.filter(Boolean).map(opinionCard)}</div>`
        : html`<div class="grid-2">${rest.filter(Boolean).map((a) => storyCard(a, { excerpt: true, cat: false }))}</div>`}
      ${pagination(pg, `/category/${cat.slug}`)}
    </div>
    <aside class="rail">
      <section class="most-read"><div class="sec-head"><h2><span class="needle" aria-hidden="true"></span>الأكثر قراءة</h2></div>
        <ol class="ranked">${mostRead.map((a) => html`<li><a href="${articleUrl(a)}">${a.title}</a>${demoBadge(a)}</li>`)}</ol></section>
      ${adSlot(ctx, 'home_sidebar')}
    </aside>
  </div>
</div>`;
  const ld = [{ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'الرئيسية', item: config.siteUrl + '/' },
    { '@type': 'ListItem', position: 2, name: cat.name, item: `${config.siteUrl}/category/${cat.slug}` }] }];
  return layout(ctx, { title: pg.page > 1 ? `${cat.name} (صفحة ${pg.page})` : cat.name, description: cat.description, canonical: `/category/${cat.slug}${pg.page > 1 ? `?page=${pg.page}` : ''}`, body, active: cat.slug, jsonld: ld });
}

/* ======================= صفحة الخبر ======================= */
function shareBar(url, title) {
  const u = encodeURIComponent(url), t = encodeURIComponent(title);
  return html`<div class="share" aria-label="مشاركة">
    <a class="sh-wa" href="https://wa.me/?text=${t}%20${u}" target="_blank" rel="noopener">واتساب</a>
    <a class="sh-fb" href="https://www.facebook.com/sharer/sharer.php?u=${u}" target="_blank" rel="noopener">فيسبوك</a>
    <a class="sh-x" href="https://twitter.com/intent/tweet?text=${t}&url=${u}" target="_blank" rel="noopener">إكس</a>
    <a class="sh-tg" href="https://t.me/share/url?url=${u}&text=${t}" target="_blank" rel="noopener">تيليجرام</a>
    <button type="button" data-copy="${url}">نسخ الرابط</button>
    <button type="button" data-print>طباعة</button>
  </div>`;
}

function article(ctx, { a, tags, sources, gallery, related, mostRead, comments, commentsOpen, notice, formToken }) {
  const url = config.siteUrl + articleUrl(a);
  const showCover = a.cover_image && !(a.type === 'video' && a.video_id);
  let bodyHtml = renderMarkup(a.body);
  const inlineAd = adSlot(ctx, 'article_inline');
  if (inlineAd) bodyHtml = insertAfterParagraph(bodyHtml, 3, String(inlineAd));
  const updated = a.updated_at && a.updated_at > a.published_at && (new Date(a.updated_at) - new Date(a.published_at)) > 5 * 60000;
  const isOpinion = a.type === 'opinion';
  const body = html`
<div class="wrap article-wrap">
  <nav class="crumbs" aria-label="مسار التنقل"><a href="/">الرئيسية</a><span aria-hidden="true">/</span><a href="/category/${a.cat_slug}">${a.cat_name}</a></nav>
  <div class="article-grid">
    <article class="article${isOpinion ? ' is-opinion' : ''}">
      <header class="article-head">
        <div class="head-tags"><a class="cat-chip" href="/category/${a.cat_slug}">${a.cat_name}</a>${isOpinion ? html`<span class="kind-chip">مقال رأي</span>` : ''}${demoBadge(a)}</div>
        <h1>${a.title}</h1>
        ${a.excerpt ? html`<p class="lede">${a.excerpt}</p>` : ''}
        ${a.is_demo ? html`<p class="demo-note">هذه مادة تجريبية لعرض شكل صفحة الخبر، وليست خبرًا حقيقيًا.</p>` : ''}
        <div class="byline">
          ${a.author_name ? html`<span class="avatar" aria-hidden="true">${initials(a.author_name)}</span>` : ''}
          <div>
            ${a.author_name ? html`<a class="author" href="/author/${a.author_id}">${a.author_name}</a>${a.author_title ? html`<span class="author-title">${a.author_title}</span>` : ''}` : html`<span class="author">${ctx.site.site_name}</span>`}
            <div class="dates"><span>نُشر في <time datetime="${a.published_at}">${fmtDateTime(a.published_at)}</time></span>
              ${updated ? html`<span>آخر تحديث <time datetime="${a.updated_at}">${fmtDateTime(a.updated_at)}</time></span>` : ''}
              <span>${readMinutes(markupToText(a.body))} دقائق للقراءة</span></div>
          </div>
        </div>
        ${shareBar(url, a.title)}
      </header>
      ${a.type === 'video' && a.video_id ? html`<div class="video-embed"><iframe src="https://www.youtube-nocookie.com/embed/${a.video_id}" title="${a.title}" loading="lazy" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div>` : ''}
      ${a.type === 'video' && !a.video_id ? html`<div class="video-placeholder"><span>مكان مشغل الفيديو</span><small>أضف رابط يوتيوب للمادة من لوحة التحكم ليظهر المشغل هنا.</small></div>` : ''}
      ${showCover ? html`<figure class="cover">${img(a.cover_image, a.cover_caption || a.title, '', true)}${a.cover_caption ? html`<figcaption>${a.cover_caption}</figcaption>` : ''}</figure>` : ''}
      ${adSlot(ctx, 'article_top')}
      <div class="prose">${raw(bodyHtml)}</div>
      ${gallery.length ? html`<section class="gallery" aria-label="معرض الصور"><h2>معرض الصور</h2><div class="gallery-grid">${gallery.map((g, i) => html`<figure><a href="${g.image}" target="_blank" rel="noopener">${img(g.image, g.caption || `صورة ${i + 1}`)}</a>${g.caption ? html`<figcaption>${g.caption}</figcaption>` : ''}</figure>`)}</div></section>` : ''}
      ${sources.length ? html`<section class="sources"><h2>المصادر</h2><ul>${sources.map((s) => html`<li>${s.url ? html`<a href="${s.url}" target="_blank" rel="noopener nofollow">${s.name}</a>` : s.name}</li>`)}</ul></section>` : ''}
      ${tags.length ? html`<div class="tags"><span>الوسوم:</span><ul>${tags.map((t) => html`<li><a href="/tag/${encodeURIComponent(t.slug)}">${t.name}</a></li>`)}</ul></div>` : ''}
      <div class="article-foot">${shareBar(url, a.title)}</div>
      ${commentsOpen !== null ? commentsSection(a, comments, commentsOpen, notice, formToken) : ''}
    </article>
    <aside class="rail">
      ${adSlot(ctx, 'article_sidebar')}
      <section class="most-read"><div class="sec-head"><h2><span class="needle" aria-hidden="true"></span>الأكثر قراءة</h2></div>
        <ol class="ranked">${mostRead.map((m) => html`<li><a href="${articleUrl(m)}">${m.title}</a>${demoBadge(m)}</li>`)}</ol></section>
    </aside>
  </div>
  ${related.length ? html`<section class="related">${sectionHead('أخبار ذات صلة', null)}<div class="grid-4">${related.map((r) => storyCard(r))}</div></section>` : ''}
</div>`;
  const image = a.cover_image && !a.cover_image.endsWith('.svg') ? a.cover_image : null;
  const ld = [{
    '@context': 'https://schema.org', '@type': isOpinion ? 'OpinionNewsArticle' : a.type === 'report' ? 'ReportageNewsArticle' : 'NewsArticle',
    headline: a.title.slice(0, 110), description: a.meta_description || a.excerpt || undefined, datePublished: a.published_at, dateModified: a.updated_at,
    mainEntityOfPage: url, image: image ? [config.siteUrl + image] : undefined, articleSection: a.cat_name, keywords: tags.map((t) => t.name).join('، ') || undefined,
    author: a.author_name ? [{ '@type': 'Person', name: a.author_name, url: `${config.siteUrl}/author/${a.author_id}` }] : [{ '@type': 'Organization', name: ctx.site.site_name }],
    publisher: orgLd(ctx.site),
  }, { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'الرئيسية', item: config.siteUrl + '/' },
    { '@type': 'ListItem', position: 2, name: a.cat_name, item: `${config.siteUrl}/category/${a.cat_slug}` },
    { '@type': 'ListItem', position: 3, name: a.title, item: url }] }];
  return layout(ctx, { title: a.meta_title || a.title, description: a.meta_description || a.excerpt, canonical: articleUrl(a), image: image || undefined, ogType: 'article', noindex: !!a.is_demo, jsonld: ld, body, active: a.cat_slug });
}

function commentsSection(a, comments, open, notice, token) {
  const notes = { pending: ['ok', 'تم استلام تعليقك، وسيظهر بعد مراجعته من فريق التحرير.'], reported: ['ok', 'شكرًا لك. وصل بلاغك وسيراجعه فريق التحرير.'],
    error: ['err', 'تعذر إرسال التعليق. تأكد من كتابة الاسم والتعليق (بين 3 و1500 حرف) ثم حاول مرة أخرى.'], limit: ['err', 'أرسلت تعليقات كثيرة خلال وقت قصير. حاول مرة أخرى بعد قليل.'],
    expired: ['err', 'انتهت صلاحية النموذج. أعد تحميل الصفحة وحاول مرة أخرى.'] };
  const n = notes[notice];
  return html`<section class="comments" id="comments" aria-labelledby="comments-h">
    <h2 id="comments-h">التعليقات <span class="count">${comments.length}</span></h2>
    ${n ? html`<p class="notice notice-${n[0]}" role="status">${n[1]}</p>` : ''}
    ${comments.length ? html`<ol class="comment-list">${comments.map((c) => html`<li id="c${c.id}">
      <div class="c-head"><strong>${c.name}</strong><time datetime="${c.created_at}">${fmtDateTime(c.created_at)}</time></div>
      <p>${raw(esc(c.body).replace(/\n/g, '<br>'))}</p>
      <details class="report"><summary>إبلاغ عن هذا التعليق</summary>
        <form method="post" action="/comments/${c.id}/report"><input type="hidden" name="token" value="${token.report}">
          <label>سبب الإبلاغ<select name="reason"><option>إساءة أو ألفاظ خارجة</option><option>معلومات مضللة</option><option>رسائل مزعجة أو إعلانات</option><option>سبب آخر</option></select></label>
          <button type="submit">إرسال البلاغ</button></form></details>
    </li>`)}</ol>` : html`<p class="muted">لا توجد تعليقات منشورة بعد.</p>`}
    ${open ? html`<form class="comment-form" method="post" action="/comments">
      <h3>أضف تعليقك</h3>
      <input type="hidden" name="article_id" value="${a.id}"><input type="hidden" name="token" value="${token.comment}">
      <div class="hp" aria-hidden="true"><label>اترك هذا الحقل فارغًا<input name="website" tabindex="-1" autocomplete="off"></label></div>
      <label>الاسم<input name="name" required maxlength="60" autocomplete="name"></label>
      <label>التعليق<textarea name="body" required minlength="3" maxlength="1500" rows="4"></textarea></label>
      <p class="muted">تخضع التعليقات للمراجعة قبل النشر. يُرجى الالتزام بـ<a href="/terms">شروط الاستخدام</a>.</p>
      <button type="submit">إرسال التعليق</button>
    </form>` : html`<p class="muted">التعليقات مغلقة على هذه المادة.</p>`}
  </section>`;
}

/* ======================= البحث والأرشيف والوسوم والكتّاب ======================= */
function listing(items) {
  return html`<div class="listing">${items.map((a) => html`<article class="list-item">
    <a class="thumb" href="${articleUrl(a)}" tabindex="-1" aria-hidden="true">${img(coverOf(a), '')}</a>
    <div>${meta(a, { abs: true })}<h2><a href="${articleUrl(a)}">${a.title}</a></h2>${a.excerpt ? html`<p class="dek">${a.excerpt}</p>` : ''}</div>
  </article>`)}</div>`;
}
function search(ctx, { q, items, pg, filters, tooShort }) {
  const body = html`<div class="wrap narrow">
    <header class="page-head"><h1><span class="needle" aria-hidden="true"></span>البحث في الأخبار والمقالات</h1></header>
    <form class="search-page" action="/search" method="get" role="search">
      <label class="wide">كلمات البحث<input type="search" name="q" value="${q}" maxlength="100" placeholder="مثال: الدوري المصري"></label>
      <label>القسم<select name="category"><option value="">كل الأقسام</option>${ctx.nav.map((c) => html`<option value="${c.slug}" ${raw(c.slug === filters.category ? 'selected' : '')}>${c.name}</option>`)}</select></label>
      <label>من تاريخ<input type="date" name="from" value="${filters.from}"></label>
      <label>إلى تاريخ<input type="date" name="to" value="${filters.to}"></label>
      <button type="submit">بحث</button>
    </form>
    ${tooShort ? html`<p class="empty-state">اكتب كلمة من حرفين على الأقل للبحث.</p>` : q || filters.category || filters.from ? html`
      <p class="result-count" role="status">${pg.total ? `عدد النتائج: ${fmtNum(pg.total)}` : 'لا توجد نتائج مطابقة. جرّب كلمات أخرى أو وسّع نطاق التاريخ.'}</p>
      ${listing(items)}${pagination(pg, '/search', { q, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) })}` : ''}
  </div>`;
  ctx.searchQuery = q;
  return layout(ctx, { title: q ? `نتائج البحث عن: ${q}` : 'البحث', canonical: '/search', noindex: true, body });
}
function archive(ctx, { date, category, items, days, catObj }) {
  const body = html`<div class="wrap narrow">
    <header class="page-head"><h1><span class="needle" aria-hidden="true"></span>أرشيف الأخبار</h1><p>اختر يومًا وقسمًا لعرض كل ما نُشر فيه.</p></header>
    ${archiveForm(ctx, { date, category })}
    ${date ? html`<h2 class="archive-title">${fmtDate(date + 'T12:00:00Z')}${catObj ? ` في قسم ${catObj.name}` : ''}</h2>
      ${items.length ? listing(items) : html`<p class="empty-state">لا توجد أخبار منشورة في هذا اليوم${catObj ? ' في هذا القسم' : ''}.</p>`}`
      : html`<h2 class="archive-title">آخر الأيام</h2><ul class="days">${days.map((d) => html`<li><a href="/archive?date=${d.day}${category ? `&category=${category}` : ''}"><span>${fmtDate(d.day + 'T12:00:00Z')}</span><span class="n">${d.n} مادة</span></a></li>`)}</ul>`}
  </div>`;
  return layout(ctx, { title: date ? `أرشيف ${fmtDate(date + 'T12:00:00Z')}` : 'أرشيف الأخبار', canonical: '/archive', noindex: !!date && !items.length, body });
}
function tag(ctx, { tag: t, items, pg }) {
  const body = html`<div class="wrap narrow"><header class="page-head"><h1><span class="needle" aria-hidden="true"></span>${t.name}</h1><p>كل المواد المنشورة تحت هذا الوسم.</p></header>
    ${items.length ? listing(items) : html`<p class="empty-state">لا توجد مواد منشورة بهذا الوسم.</p>`}${pagination(pg, `/tag/${encodeURIComponent(t.slug)}`)}</div>`;
  return layout(ctx, { title: `وسم: ${t.name}`, canonical: `/tag/${encodeURIComponent(t.slug)}`, body });
}
function author(ctx, { u, items, pg }) {
  const body = html`<div class="wrap narrow"><header class="page-head author-head"><span class="avatar big" aria-hidden="true">${initials(u.name)}</span><div><h1>${u.name}</h1>
    ${u.title ? html`<p class="author-title">${u.title}</p>` : ''}${u.bio ? html`<p>${u.bio}</p>` : ''}</div></header>
    ${items.length ? listing(items) : html`<p class="empty-state">لا توجد مواد منشورة لهذا الكاتب بعد.</p>`}${pagination(pg, `/author/${u.id}`)}</div>`;
  return layout(ctx, { title: u.name, canonical: `/author/${u.id}`, noindex: !!u.is_demo, body,
    jsonld: [{ '@context': 'https://schema.org', '@type': 'Person', name: u.name, jobTitle: u.title || undefined, url: `${config.siteUrl}/author/${u.id}` }] });
}
function multimedia(ctx, { items, pg }) {
  const body = html`<div class="wrap"><header class="page-head"><h1><span class="needle" aria-hidden="true"></span>الوسائط المتعددة</h1><p>الفيديوهات ومعارض الصور والتغطيات المصورة.</p></header>
    ${items.length ? html`<div class="grid-3">${items.map((a) => storyCard(a, { excerpt: true }))}</div>` : html`<p class="empty-state">لا توجد فيديوهات أو معارض صور منشورة بعد.</p>`}
    ${pagination(pg, '/multimedia')}</div>`;
  return layout(ctx, { title: 'الوسائط المتعددة', canonical: '/multimedia', body, active: 'multimedia' });
}

/* ======================= صفحات ثابتة ======================= */
function contactBlock(site) {
  return html`<ul class="contact-list">${site.contact_email ? html`<li>البريد الإلكتروني: <a href="mailto:${site.contact_email}">${site.contact_email}</a></li>` : ''}
    ${site.contact_phone ? html`<li>الهاتف: <a href="tel:${site.contact_phone.replace(/[^\d+]/g, '')}" dir="ltr">${site.contact_phone}</a></li>` : ''}
    ${site.whatsapp ? html`<li>واتساب: <a href="https://wa.me/${site.whatsapp.replace(/\D/g, '')}" dir="ltr">${site.whatsapp}</a></li>` : ''}
    ${site.address ? html`<li>العنوان: ${site.address}</li>` : ''}</ul>`;
}
function about(ctx) {
  const site = ctx.site;
  const credits = Settings.credits(site);
  const body = html`<div class="wrap narrow"><header class="page-head"><h1><span class="needle" aria-hidden="true"></span>عن ${site.site_name}</h1></header>
    <div class="prose">${raw(renderMarkup(Settings.pageText(site, 'about_body')))}</div>
    ${credits.length ? html`<section class="masthead-credits" aria-labelledby="mgmt-h"><h2 id="mgmt-h">إدارة الموقع</h2><dl>${credits.map((c) => html`<div><dt>${c.label}</dt><dd>${c.name}</dd></div>`)}</dl></section>` : ''}
    <section class="contact-box"><h2>بيانات التواصل</h2>${contactBlock(site)}</section></div>`;
  return layout(ctx, { title: `عن ${site.site_name}`, canonical: '/about', body });
}
function staticPage(ctx, key, title, path) {
  const body = html`<div class="wrap narrow"><header class="page-head"><h1><span class="needle" aria-hidden="true"></span>${title}</h1></header>
    <div class="prose">${raw(renderMarkup(Settings.pageText(ctx.site, key)))}</div></div>`;
  return layout(ctx, { title, canonical: path, body });
}
function advertise(ctx, { slots, units, values = {}, errors = [], sent, token }) {
  const site = ctx.site;
  const body = html`<div class="wrap narrow"><header class="page-head"><h1><span class="needle" aria-hidden="true"></span>أعلن معنا</h1></header>
    <div class="prose">${raw(renderMarkup(Settings.pageText(site, 'advertise_body')))}</div>
    <section><h2 class="h-section">المساحات المتاحة والأسعار</h2>
      <div class="table-wrap"><table class="price-table"><thead><tr><th>المساحة</th><th>الصفحة</th><th>المقاس (بكسل)</th><th>السعر</th></tr></thead>
      <tbody>${slots.map((s) => html`<tr><td>${s.name}</td><td>${s.page}</td><td dir="ltr">${s.width}×${s.height}</td><td>${s.price ? `${fmtNum(s.price)} ج.م / ${units[s.price_unit]}` : 'حسب الاتفاق'}</td></tr>`)}</tbody></table></div>
      <p class="muted">الأسعار استرشادية وقد تتغير حسب مدة الحملة وعدد المساحات. نرسل لك عرض سعر نهائيًا بعد مراجعة طلبك.</p></section>
    <section id="request"><h2 class="h-section">طلب حجز إعلان</h2>
      ${sent ? html`<p class="notice notice-ok" role="status">وصل طلبك بنجاح. سيتواصل معك فريق الإعلانات خلال يومي عمل.</p>` : ''}
      ${errors.length ? html`<div class="notice notice-err" role="alert"><p>تعذر إرسال الطلب:</p><ul>${errors.map((e) => html`<li>${e}</li>`)}</ul></div>` : ''}
      <form class="form-grid" method="post" action="/advertise#request">
        <input type="hidden" name="token" value="${token}">
        <div class="hp" aria-hidden="true"><label>اترك هذا الحقل فارغًا<input name="website" tabindex="-1" autocomplete="off"></label></div>
        <label>اسم الشركة أو الجهة<input name="company" required maxlength="120" value="${values.company || ''}"></label>
        <label>اسم المسؤول<input name="contact_name" required maxlength="80" value="${values.contact_name || ''}"></label>
        <label>رقم الهاتف<input name="phone" type="tel" required maxlength="30" dir="ltr" value="${values.phone || ''}"></label>
        <label>البريد الإلكتروني<input name="email" type="email" maxlength="120" dir="ltr" value="${values.email || ''}"></label>
        <label>المساحة المطلوبة<select name="slot_id"><option value="">لم أحدد بعد</option>${slots.map((s) => html`<option value="${s.id}" ${raw(String(values.slot_id) === String(s.id) || values.slotKey === s.key ? 'selected' : '')}>${s.name} (${s.width}×${s.height})</option>`)}</select></label>
        <label>تاريخ البدء المقترح<input name="start_date" type="date" min="${ctx.day}" value="${values.start_date || ''}"></label>
        <label>مدة الحملة<select name="duration">${['أسبوع', 'أسبوعان', 'شهر', '3 أشهر', 'أخرى'].map((d) => html`<option ${raw(values.duration === d ? 'selected' : '')}>${d}</option>`)}</select></label>
        <label class="wide">تفاصيل إضافية<textarea name="message" rows="4" maxlength="1500">${values.message || ''}</textarea></label>
        <button type="submit" class="wide-btn">إرسال طلب الحجز</button>
      </form>
      <p class="muted">لا يتم الدفع عبر الموقع حاليًا. بعد مراجعة الطلب نرسل لك عرض السعر وطرق الدفع المتاحة.</p>
    </section>
    <section class="contact-box"><h2>تواصل مباشر مع فريق الإعلانات</h2><ul class="contact-list">
      ${site.ads_email && site.ads_email !== site.contact_email ? html`<li>البريد الإلكتروني: <a href="mailto:${site.ads_email}">${site.ads_email}</a></li>` : ''}</ul>${contactBlock(site)}</section>
  </div>`;
  return layout(ctx, { title: 'أعلن معنا', description: `احجز مساحتك الإعلانية على ${site.site_name}`, canonical: '/advertise', body });
}

const CONTACT_SUBJECTS = ['استفسار عام', 'تصحيح معلومة في خبر', 'إرسال خبر أو معلومة', 'شكوى أو اقتراح', 'أخرى'];
function contact(ctx, { values = {}, errors = [], sent, token }) {
  const site = ctx.site;
  const body = html`<div class="wrap narrow"><header class="page-head"><h1><span class="needle" aria-hidden="true"></span>اتصل بنا</h1>
    <p>للاستفسارات والتصحيحات وإرسال الأخبار والمعلومات. يقرأ فريق التحرير كل الرسائل ويرد عليها في أقرب وقت.</p></header>
    ${sent ? html`<p class="notice notice-ok" role="status">وصلت رسالتك بنجاح. شكرًا لتواصلك معنا.</p>` : ''}
    ${errors.length ? html`<div class="notice notice-err" role="alert"><p>تعذر إرسال الرسالة:</p><ul>${errors.map((e) => html`<li>${e}</li>`)}</ul></div>` : ''}
    <form class="form-grid" method="post" action="/contact">
      <input type="hidden" name="token" value="${token}">
      <div class="hp" aria-hidden="true"><label>اترك هذا الحقل فارغًا<input name="website" tabindex="-1" autocomplete="off"></label></div>
      <label>الاسم<input name="name" required maxlength="80" autocomplete="name" value="${values.name || ''}"></label>
      <label>الموضوع<select name="subject">${CONTACT_SUBJECTS.map((s) => html`<option ${raw(values.subject === s ? 'selected' : '')}>${s}</option>`)}</select></label>
      <label>البريد الإلكتروني<input name="email" type="email" maxlength="120" dir="ltr" autocomplete="email" value="${values.email || ''}"></label>
      <label>رقم الهاتف<input name="phone" type="tel" maxlength="30" dir="ltr" autocomplete="tel" value="${values.phone || ''}"></label>
      <label class="wide">الرسالة<textarea name="message" required minlength="10" maxlength="3000" rows="6">${values.message || ''}</textarea></label>
      <p class="muted wide">اكتب البريد الإلكتروني أو رقم الهاتف على الأقل حتى نتمكن من الرد عليك. راجع <a href="/privacy">سياسة الخصوصية</a>.</p>
      <button type="submit" class="wide-btn">إرسال الرسالة</button>
    </form>
    <section class="contact-box"><h2>بيانات التواصل المباشر</h2>${contactBlock(site)}</section></div>`;
  return layout(ctx, { title: 'اتصل بنا', description: `تواصل مع فريق ${site.site_name}`, canonical: '/contact', body });
}

function notFound(ctx, latest = []) {
  const body = html`<div class="wrap narrow not-found"><p class="code" aria-hidden="true">404</p><h1>الصفحة غير موجودة</h1>
    <p>ربما نُقل الرابط أو حُذفت المادة. ابحث عمّا تريد أو تصفّح آخر الأخبار.</p>
    <form class="search-inline" action="/search" method="get" role="search"><label class="sr-only" for="q404">ابحث</label><input id="q404" type="search" name="q" placeholder="ابحث في الأخبار"><button type="submit">بحث</button></form>
    ${latest.length ? html`<h2 class="h-section">آخر الأخبار</h2><div class="rows">${latest.map((a) => storyRow(a))}</div>` : ''}
    <p><a href="/">العودة إلى الصفحة الرئيسية</a></p></div>`;
  return layout(ctx, { title: 'الصفحة غير موجودة', noindex: true, body });
}
function errorPage(message = 'حدث خطأ غير متوقع أثناء تحميل الصفحة. حاول مرة أخرى بعد قليل.') {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>خطأ</title>
<style>body{font-family:Tahoma,sans-serif;background:#f3f5f8;color:#0f2342;display:grid;place-items:center;min-height:100vh;margin:0}main{max-width:32rem;padding:2rem;text-align:center}a{color:#d21f30}</style></head>
<body><main><h1>تعذر عرض الصفحة</h1><p>${esc(message)}</p><p><a href="/">العودة إلى الرئيسية</a></p></main></body></html>`;
}

module.exports = { home, category, article, search, archive, tag, author, multimedia, about, staticPage, advertise, contact, CONTACT_SUBJECTS, notFound, errorPage };
