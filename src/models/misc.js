'use strict';
const { all, get, run, tx } = require('../db');
const { nowIso, addDays } = require('../util');

/* ================= الأخبار العاجلة ================= */
const Breaking = {
  active: () => all(`SELECT b.id, b.text, a.id AS article_id, a.slug AS article_slug FROM breaking_news b
    LEFT JOIN articles a ON a.id = b.article_id AND a.status = 'published' AND a.published_at <= ?
    WHERE b.active = 1 AND (b.expires_at IS NULL OR b.expires_at > ?) ORDER BY b.created_at DESC LIMIT 10`, nowIso(), nowIso()),
  list: () => all(`SELECT b.*, a.title AS article_title, u.name AS author_name FROM breaking_news b
    LEFT JOIN articles a ON a.id = b.article_id LEFT JOIN users u ON u.id = b.created_by ORDER BY b.created_at DESC LIMIT 100`),
  create: (text, articleId, expiresAt, userId, isDemo = false) =>
    run('INSERT INTO breaking_news (text, article_id, active, is_demo, expires_at, created_at, created_by) VALUES (?, ?, 1, ?, ?, ?, ?)',
      text, articleId || null, isDemo ? 1 : 0, expiresAt || null, nowIso(), userId || null).id,
  toggle: (id) => run('UPDATE breaking_news SET active = 1 - active WHERE id = ?', id),
  remove: (id) => run('DELETE FROM breaking_news WHERE id = ?', id),
};

/* ================= التعليقات ================= */
const Comments = {
  create: (articleId, name, body, ipHash) =>
    run("INSERT INTO comments (article_id, name, body, status, ip_hash, created_at) VALUES (?, ?, ?, 'pending', ?, ?)", articleId, name, body, ipHash, nowIso()).id,
  approvedFor: (articleId) => all("SELECT id, name, body, created_at FROM comments WHERE article_id = ? AND status = 'approved' ORDER BY created_at", articleId),
  get: (id) => get('SELECT * FROM comments WHERE id = ?', id),
  report: (commentId, reason, ipHash) => {
    if (get('SELECT 1 AS x FROM comment_reports WHERE comment_id = ? AND ip_hash = ?', commentId, ipHash)) return false;
    run('INSERT INTO comment_reports (comment_id, reason, ip_hash, created_at) VALUES (?, ?, ?, ?)', commentId, reason || null, ipHash, nowIso());
    return true;
  },
  adminList(tab) {
    const base = `SELECT cm.*, a.title AS article_title, a.slug AS article_slug,
      (SELECT COUNT(*) FROM comment_reports r WHERE r.comment_id = cm.id AND r.resolved = 0) AS open_reports,
      (SELECT string_agg(COALESCE(r.reason, ''), ' | ') FROM comment_reports r WHERE r.comment_id = cm.id AND r.resolved = 0) AS report_reasons
      FROM comments cm JOIN articles a ON a.id = cm.article_id`;
    if (tab === 'reported') return all(`${base} WHERE cm.id IN (SELECT comment_id FROM comment_reports WHERE resolved = 0) ORDER BY cm.created_at DESC LIMIT 200`);
    return all(`${base} WHERE cm.status = ? ORDER BY cm.created_at DESC LIMIT 200`, tab);
  },
  counts: () => ({
    pending: get("SELECT COUNT(*) AS n FROM comments WHERE status = 'pending'").n,
    approved: get("SELECT COUNT(*) AS n FROM comments WHERE status = 'approved'").n,
    rejected: get("SELECT COUNT(*) AS n FROM comments WHERE status = 'rejected'").n,
    reported: get('SELECT COUNT(DISTINCT comment_id) AS n FROM comment_reports WHERE resolved = 0').n,
  }),
  moderate: (id, status, userId) => {
    run('UPDATE comments SET status = ?, moderated_by = ?, moderated_at = ? WHERE id = ?', status, userId, nowIso(), id);
    run('UPDATE comment_reports SET resolved = 1 WHERE comment_id = ?', id);
  },
  dismissReports: (id) => run('UPDATE comment_reports SET resolved = 1 WHERE comment_id = ?', id),
  remove: (id) => run('DELETE FROM comments WHERE id = ?', id),
};

/* ================= مكتبة الوسائط ================= */
const Media = {
  create: (m, userId) => run('INSERT INTO media (path, original_name, mime, size, width, height, uploaded_by, created_at) VALUES (?,?,?,?,?,?,?,?)',
    m.path, m.originalName || null, m.mime, m.size, m.width || null, m.height || null, userId || null, nowIso()).id,
  list: (limit, offset) => all('SELECT m.*, u.name AS uploader FROM media m LEFT JOIN users u ON u.id = m.uploaded_by ORDER BY m.created_at DESC, m.id DESC LIMIT ? OFFSET ?', limit, offset),
  count: () => get('SELECT COUNT(*) AS n FROM media').n,
  get: (id) => get('SELECT * FROM media WHERE id = ?', id),
  usage(path) {
    const like = `%${path}%`;
    return get(`SELECT (SELECT COUNT(*) FROM articles WHERE cover_image = ? OR body LIKE ?)
      + (SELECT COUNT(*) FROM gallery_items WHERE image = ?) + (SELECT COUNT(*) FROM ad_campaigns WHERE image = ?) AS n`, path, like, path, path).n;
  },
  remove: (id) => run('DELETE FROM media WHERE id = ?', id),
};

/* ================= الإحصاءات ================= */
const Stats = {
  articleView(id, day) {
    run('UPDATE articles SET views = views + 1 WHERE id = ?', id);
    run('INSERT INTO article_views_daily (article_id, day, views) VALUES (?, ?, 1) ON CONFLICT(article_id, day) DO UPDATE SET views = article_views_daily.views + 1', id, day);
  },
  siteView: (day) => run('INSERT INTO site_views_daily (day, views) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET views = site_views_daily.views + 1', day),
  siteSeries(fromDay, toDay) {
    const map = new Map(all('SELECT day, views FROM site_views_daily WHERE day BETWEEN ? AND ?', fromDay, toDay).map((r) => [r.day, r.views]));
    const out = [];
    for (let d = fromDay; d <= toDay; d = addDays(d, 1)) out.push({ day: d, views: map.get(d) || 0 });
    return out;
  },
  articleViewsSum: (fromDay, toDay) => get('SELECT COALESCE(SUM(views), 0) AS n FROM article_views_daily WHERE day BETWEEN ? AND ?', fromDay, toDay).n,
  topArticles: (fromDay, toDay, limit = 10) => all(`SELECT a.id, a.slug, a.title, a.is_demo, c.name AS cat_name, u.name AS author_name, SUM(v.views) AS views
    FROM article_views_daily v JOIN articles a ON a.id = v.article_id JOIN categories c ON c.id = a.category_id LEFT JOIN users u ON u.id = a.author_id
    WHERE v.day BETWEEN ? AND ? GROUP BY a.id, c.id, u.id ORDER BY views DESC LIMIT ?`, fromDay, toDay, limit),
  byCategory: (fromDay, toDay) => all(`SELECT c.name, COALESCE(SUM(v.views), 0) AS views FROM categories c
    LEFT JOIN articles a ON a.category_id = c.id LEFT JOIN article_views_daily v ON v.article_id = a.id AND v.day BETWEEN ? AND ?
    GROUP BY c.id ORDER BY views DESC`, fromDay, toDay),
  byAuthor: (fromIso, toIso) => all(`SELECT u.name, COUNT(a.id) AS articles, COALESCE(SUM(a.views), 0) AS views FROM users u
    JOIN articles a ON a.author_id = u.id AND a.status = 'published' AND a.published_at >= ? AND a.published_at < ?
    GROUP BY u.id ORDER BY articles DESC`, fromIso, toIso),
  ads: (fromDay, toDay) => all(`SELECT c.id, c.title, c.advertiser_name, s.name AS slot_name, COALESCE(SUM(d.impressions), 0) AS impressions,
    COALESCE(SUM(d.clicks), 0) AS clicks FROM ad_campaigns c JOIN ad_slots s ON s.id = c.slot_id
    LEFT JOIN ad_stats_daily d ON d.campaign_id = c.id AND d.day BETWEEN ? AND ? GROUP BY c.id, s.id ORDER BY impressions DESC`, fromDay, toDay),
};

/* ================= مصادر الأخبار (RSS) ================= */
const Feeds = {
  sources: () => all(`SELECT f.*, c.name AS cat_name, (SELECT COUNT(*) FROM feed_items i WHERE i.source_id = f.id AND i.status = 'new') AS new_items
    FROM feed_sources f LEFT JOIN categories c ON c.id = f.category_id ORDER BY f.name`),
  source: (id) => get('SELECT * FROM feed_sources WHERE id = ?', id),
  addSource: (name, url, categoryId) => run('INSERT INTO feed_sources (name, url, category_id, active, created_at) VALUES (?, ?, ?, 1, ?)', name, url, categoryId || null, nowIso()).id,
  toggleSource: (id) => run('UPDATE feed_sources SET active = 1 - active WHERE id = ?', id),
  removeSource: (id) => run('DELETE FROM feed_sources WHERE id = ?', id),
  markFetched: (id, status) => run('UPDATE feed_sources SET last_fetched_at = ?, last_status = ? WHERE id = ?', nowIso(), status, id),
  storeItems(sourceId, items) {
    let added = 0;
    tx(() => {
      for (const it of items) {
        const r = run(`INSERT INTO feed_items (source_id, guid, title, link, summary, published_at, status, fetched_at)
          VALUES (?, ?, ?, ?, ?, ?, 'new', ?) ON CONFLICT DO NOTHING`, sourceId, it.guid, it.title, it.link || null, it.summary || null, it.published_at || null, nowIso());
        added += r.changes;
      }
    });
    return added;
  },
  items: (status = 'new') => all(`SELECT i.*, f.name AS source_name, f.category_id FROM feed_items i JOIN feed_sources f ON f.id = i.source_id
    WHERE i.status = ? ORDER BY COALESCE(i.published_at, i.fetched_at) DESC LIMIT 150`, status),
  item: (id) => get('SELECT i.*, f.name AS source_name, f.category_id FROM feed_items i JOIN feed_sources f ON f.id = i.source_id WHERE i.id = ?', id),
  setItem: (id, status, articleId = null) => run('UPDATE feed_items SET status = ?, article_id = COALESCE(?, article_id) WHERE id = ?', status, articleId, id),
};

/* ================= رسائل اتصل بنا ================= */
const Messages = {
  create: (m, ipHash) => run("INSERT INTO contact_messages (name, email, phone, subject, message, status, ip_hash, created_at) VALUES (?, ?, ?, ?, ?, 'new', ?, ?)",
    m.name, m.email || null, m.phone || null, m.subject, m.message, ipHash, nowIso()).id,
  list: (status) => all('SELECT * FROM contact_messages WHERE status = ? ORDER BY created_at DESC LIMIT 300', status),
  get: (id) => get('SELECT * FROM contact_messages WHERE id = ?', id),
  counts: () => Object.fromEntries(['new', 'read', 'archived'].map((s) => [s, get('SELECT COUNT(*) AS n FROM contact_messages WHERE status = ?', s).n])),
  setStatus: (id, status) => run('UPDATE contact_messages SET status = ? WHERE id = ?', status, id),
  remove: (id) => run('DELETE FROM contact_messages WHERE id = ?', id),
};

/* ================= سجل النشاط ================= */
const Audit = {
  log: (userId, action, entity = null, entityId = null, details = null) =>
    run('INSERT INTO audit_log (user_id, action, entity, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?)', userId || null, action, entity, entityId, details ? String(details).slice(0, 300) : null, nowIso()),
  recent: (limit = 12) => all('SELECT l.*, u.name AS user_name FROM audit_log l LEFT JOIN users u ON u.id = l.user_id ORDER BY l.created_at DESC, l.id DESC LIMIT ?', limit),
};

module.exports = { Breaking, Comments, Media, Stats, Feeds, Messages, Audit };
