'use strict';
const { all, get, run, tx } = require('../db');
const { nowIso, slugify, normalizeArabic } = require('../util');
const { markupToText } = require('../markup');

/* ================= الأقسام ================= */
const Categories = {
  list: () => all('SELECT * FROM categories ORDER BY sort, id'),
  bySlug: (slug) => get('SELECT * FROM categories WHERE slug = ?', slug),
  byId: (id) => get('SELECT * FROM categories WHERE id = ?', id),
  update: (id, c) => run('UPDATE categories SET name = ?, description = ?, sort = ?, show_on_home = ? WHERE id = ?', c.name, c.description || null, c.sort || 0, c.show_on_home ? 1 : 0, id),
};

/* ================= الاستعلامات العامة (المنشور فقط) ================= */
const CARD = `a.id, a.slug, a.title, a.excerpt, a.cover_image, a.cover_caption, a.type, a.published_at, a.updated_at, a.views,
  a.is_demo, a.is_featured, a.video_id, c.id AS cat_id, c.slug AS cat_slug, c.name AS cat_name, u.id AS author_id, u.name AS author_name`;
const FROM = 'FROM articles a JOIN categories c ON c.id = a.category_id LEFT JOIN users u ON u.id = a.author_id';
const ph = (arr) => arr.map(() => '?').join(',');

function liveWhere(o = {}) {
  const w = ["a.status = 'published'", 'a.published_at <= ?'];
  const p = [nowIso()];
  if (o.categoryId) { w.push('a.category_id = ?'); p.push(o.categoryId); }
  if (o.types?.length) { w.push(`a.type IN (${ph(o.types)})`); p.push(...o.types); }
  if (o.notTypes?.length) { w.push(`a.type NOT IN (${ph(o.notTypes)})`); p.push(...o.notTypes); }
  if (o.featured) w.push('a.is_featured = 1');
  if (o.authorId) { w.push('a.author_id = ?'); p.push(o.authorId); }
  if (o.tagId) { w.push('a.id IN (SELECT article_id FROM article_tags WHERE tag_id = ?)'); p.push(o.tagId); }
  if (o.from) { w.push('a.published_at >= ?'); p.push(o.from); }
  if (o.to) { w.push('a.published_at < ?'); p.push(o.to); }
  if (o.exclude?.length) { w.push(`a.id NOT IN (${ph(o.exclude)})`); p.push(...o.exclude); }
  if (o.terms?.length) for (const t of o.terms) { w.push("a.search_text LIKE ? ESCAPE '\\'"); p.push(`%${t.replace(/[\\%_]/g, (c) => '\\' + c)}%`); }
  return { where: w.join(' AND '), params: p };
}
function listLive(o = {}) {
  const { where, params } = liveWhere(o);
  const order = o.orderByViews ? 'a.views DESC, a.published_at DESC' : 'a.published_at DESC, a.id DESC';
  return all(`SELECT ${CARD} ${FROM} WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`, ...params, o.limit || 10, o.offset || 0);
}
function countLive(o = {}) {
  const { where, params } = liveWhere(o);
  return get(`SELECT COUNT(*) AS n ${FROM} WHERE ${where}`, ...params).n;
}
const searchTerms = (q) => normalizeArabic(q).split(/[\s،,.؟?!]+/).filter((t) => t.length >= 2).slice(0, 6);

function mostRead({ sinceDay, limit = 5 }) {
  const rows = all(`SELECT ${CARD}, SUM(v.views) AS period_views FROM article_views_daily v
    JOIN articles a ON a.id = v.article_id JOIN categories c ON c.id = a.category_id LEFT JOIN users u ON u.id = a.author_id
    WHERE v.day >= ? AND a.status = 'published' AND a.published_at <= ?
    GROUP BY a.id ORDER BY period_views DESC LIMIT ?`, sinceDay, nowIso(), limit);
  if (rows.length < limit) rows.push(...listLive({ limit: limit - rows.length, exclude: rows.map((r) => r.id), orderByViews: true }));
  return rows;
}
const getLive = (id) => get(`SELECT a.*, c.slug AS cat_slug, c.name AS cat_name, c.kind AS cat_kind, u.id AS author_id, u.name AS author_name, u.title AS author_title, u.bio AS author_bio
  ${FROM} WHERE a.id = ? AND a.status = 'published' AND a.published_at <= ?`, id, nowIso());

function related(article, limit = 4) {
  return all(`SELECT ${CARD}, (SELECT COUNT(*) FROM article_tags t1 WHERE t1.article_id = a.id
      AND t1.tag_id IN (SELECT tag_id FROM article_tags WHERE article_id = ?)) AS shared
    ${FROM} WHERE a.status = 'published' AND a.published_at <= ? AND a.id != ?
      AND (a.category_id = ? OR a.id IN (SELECT article_id FROM article_tags WHERE tag_id IN (SELECT tag_id FROM article_tags WHERE article_id = ?)))
    ORDER BY shared DESC, a.published_at DESC LIMIT ?`, article.id, nowIso(), article.id, article.category_id, article.id, limit);
}

const tagsFor = (id) => all('SELECT t.id, t.name, t.slug FROM tags t JOIN article_tags x ON x.tag_id = t.id WHERE x.article_id = ? ORDER BY t.name', id);
const sourcesFor = (id) => all('SELECT name, url FROM article_sources WHERE article_id = ? ORDER BY id', id);
const galleryFor = (id) => all('SELECT image, caption FROM gallery_items WHERE article_id = ? ORDER BY sort, id', id);
const tagBySlug = (slug) => get('SELECT * FROM tags WHERE slug = ?', slug);
const popularTags = (limit = 12) => all(`SELECT t.name, t.slug, COUNT(*) AS n FROM tags t JOIN article_tags x ON x.tag_id = t.id
  JOIN articles a ON a.id = x.article_id WHERE a.status = 'published' AND a.published_at <= ? GROUP BY t.id ORDER BY n DESC, t.name LIMIT ?`, nowIso(), limit);
const hasDemo = () => !!get('SELECT 1 AS x FROM articles WHERE is_demo = 1 LIMIT 1');
const sitemapRows = (limit = 5000) => all("SELECT id, slug, updated_at, published_at, title, is_demo FROM articles WHERE status = 'published' AND published_at <= ? AND is_demo = 0 ORDER BY published_at DESC LIMIT ?", nowIso(), limit);

/* ================= الإدارة ================= */
function adminWhere(o) {
  const w = ['1 = 1'], p = [];
  const now = nowIso();
  if (o.status === 'scheduled') { w.push("a.status = 'published' AND a.published_at > ?"); p.push(now); }
  else if (o.status === 'published') { w.push("a.status = 'published' AND a.published_at <= ?"); p.push(now); }
  else if (o.status) { w.push('a.status = ?'); p.push(o.status); }
  if (o.categoryId) { w.push('a.category_id = ?'); p.push(o.categoryId); }
  if (o.authorId) { w.push('(a.author_id = ? OR a.created_by = ?)'); p.push(o.authorId, o.authorId); }
  if (o.q) for (const t of searchTerms(o.q)) { w.push("a.search_text LIKE ? ESCAPE '\\'"); p.push(`%${t.replace(/[\\%_]/g, (c) => '\\' + c)}%`); }
  return { where: w.join(' AND '), params: p };
}
function adminList(o) {
  const { where, params } = adminWhere(o);
  const total = get(`SELECT COUNT(*) AS n FROM articles a WHERE ${where}`, ...params).n;
  const rows = all(`SELECT a.id, a.slug, a.title, a.status, a.type, a.is_featured, a.is_demo, a.views, a.published_at, a.updated_at, a.created_at,
      c.name AS cat_name, u.name AS author_name ${FROM} WHERE ${where}
      ORDER BY CASE WHEN a.status IN ('draft','pending') THEN a.updated_at ELSE COALESCE(a.published_at, a.updated_at) END DESC LIMIT ? OFFSET ?`,
  ...params, o.limit || 20, o.offset || 0);
  return { total, rows };
}
function statusCounts(authorId) {
  const now = nowIso();
  const own = authorId ? ' AND (author_id = ? OR created_by = ?)' : '';
  const extra = authorId ? [authorId, authorId] : [];
  const one = (cond, ...p) => get(`SELECT COUNT(*) AS n FROM articles WHERE ${cond}${own}`, ...p, ...extra).n;
  return {
    all: one('1 = 1'),
    draft: one("status = 'draft'"),
    pending: one("status = 'pending'"),
    published: one("status = 'published' AND published_at <= ?", now),
    scheduled: one("status = 'published' AND published_at > ?", now),
    archived: one("status = 'archived'"),
  };
}
const getAny = (id) => get(`SELECT a.*, c.slug AS cat_slug, c.name AS cat_name, u.name AS author_name ${FROM} WHERE a.id = ?`, id);

function setTags(articleId, names) {
  run('DELETE FROM article_tags WHERE article_id = ?', articleId);
  const seen = new Set();
  for (const raw of names) {
    const name = raw.trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    let tag = get('SELECT id FROM tags WHERE name = ?', name);
    if (!tag) {
      let slug = slugify(name, 40);
      if (get('SELECT 1 AS x FROM tags WHERE slug = ?', slug)) slug = `${slug}-${Date.now().toString(36)}`;
      tag = { id: run('INSERT INTO tags (name, slug) VALUES (?, ?)', name, slug).id };
    }
    run('INSERT OR IGNORE INTO article_tags (article_id, tag_id) VALUES (?, ?)', articleId, tag.id);
  }
}

/*
 * حفظ مقال (إنشاء أو تعديل). d يحتوي الحقول بعد التحقق من صحتها في طبقة المسارات.
 */
function save(d, userId) {
  return tx(() => {
    const now = nowIso();
    const searchText = normalizeArabic([d.title, d.excerpt, markupToText(d.body), (d.tags || []).join(' ')].join(' '));
    const fields = [d.slug || slugify(d.title), d.title, d.excerpt || null, d.body || '', d.cover_image || null, d.cover_caption || null,
      d.category_id, d.author_id || null, d.type, d.status, d.is_featured ? 1 : 0, d.allow_comments ? 1 : 0, d.video_id || null,
      d.meta_title || null, d.meta_description || null, d.review_note || null, searchText, d.published_at || null];
    let id = d.id;
    if (id) {
      run(`UPDATE articles SET slug = ?, title = ?, excerpt = ?, body = ?, cover_image = ?, cover_caption = ?, category_id = ?, author_id = ?,
        type = ?, status = ?, is_featured = ?, allow_comments = ?, video_id = ?, meta_title = ?, meta_description = ?, review_note = ?,
        search_text = ?, published_at = ?, updated_at = ? WHERE id = ?`, ...fields, now, id);
    } else {
      id = run(`INSERT INTO articles (slug, title, excerpt, body, cover_image, cover_caption, category_id, author_id, type, status, is_featured,
        allow_comments, video_id, meta_title, meta_description, review_note, search_text, published_at, is_demo, created_at, updated_at, created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, ...fields, d.is_demo ? 1 : 0, d.created_at || now, d.updated_at || now, userId || null).id;
    }
    if (d.tags) setTags(id, d.tags);
    if (d.sources) {
      run('DELETE FROM article_sources WHERE article_id = ?', id);
      for (const s of d.sources) run('INSERT INTO article_sources (article_id, name, url) VALUES (?, ?, ?)', id, s.name, s.url || null);
    }
    if (d.gallery) {
      run('DELETE FROM gallery_items WHERE article_id = ?', id);
      d.gallery.forEach((g, i) => run('INSERT INTO gallery_items (article_id, image, caption, sort) VALUES (?, ?, ?, ?)', id, g.image, g.caption || null, i));
    }
    return id;
  });
}
const setStatus = (id, status, note = null) => run('UPDATE articles SET status = ?, review_note = ?, updated_at = ? WHERE id = ?', status, note, nowIso(), id);
const publishNow = (id) => run("UPDATE articles SET status = 'published', published_at = ?, review_note = NULL, updated_at = ? WHERE id = ?", nowIso(), nowIso(), id);
const remove = (id) => run('DELETE FROM articles WHERE id = ?', id);
const recentPublishedOptions = (limit = 40) => all("SELECT id, title FROM articles WHERE status = 'published' AND published_at <= ? ORDER BY published_at DESC LIMIT ?", nowIso(), limit);

module.exports = {
  Categories, listLive, countLive, searchTerms, mostRead, getLive, related, tagsFor, sourcesFor, galleryFor, tagBySlug, popularTags,
  hasDemo, sitemapRows, adminList, statusCounts, getAny, save, setStatus, publishNow, remove, recentPublishedOptions,
};
