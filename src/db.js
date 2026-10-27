'use strict';
const { DatabaseSync } = require('node:sqlite');

let db = null;
const cache = new Map();

// كل عنصر في المصفوفة = إصدار من مخطط قاعدة البيانات (ترحيلات متتالية)
const MIGRATIONS = [
`
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','editor','writer','ads')),
  title TEXT,
  bio TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE TABLE categories (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  kind TEXT NOT NULL DEFAULT 'news',
  sort INTEGER NOT NULL DEFAULT 0,
  show_on_home INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE media (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  original_name TEXT,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE articles (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  excerpt TEXT,
  body TEXT NOT NULL DEFAULT '',
  cover_image TEXT,
  cover_caption TEXT,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  type TEXT NOT NULL DEFAULT 'news' CHECK (type IN ('news','opinion','report','video','gallery')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending','published','archived')),
  is_featured INTEGER NOT NULL DEFAULT 0,
  is_demo INTEGER NOT NULL DEFAULT 0,
  allow_comments INTEGER NOT NULL DEFAULT 1,
  video_id TEXT,
  meta_title TEXT,
  meta_description TEXT,
  review_note TEXT,
  search_text TEXT NOT NULL DEFAULT '',
  views INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_articles_live ON articles(status, published_at DESC);
CREATE INDEX idx_articles_cat ON articles(category_id, status, published_at DESC);
CREATE INDEX idx_articles_author ON articles(author_id, status);
CREATE TABLE tags (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE
);
CREATE TABLE article_tags (
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (article_id, tag_id)
);
CREATE INDEX idx_article_tags_tag ON article_tags(tag_id);
CREATE TABLE article_sources (
  id INTEGER PRIMARY KEY,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT
);
CREATE TABLE gallery_items (
  id INTEGER PRIMARY KEY,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  image TEXT NOT NULL,
  caption TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE article_views_daily (
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (article_id, day)
);
CREATE INDEX idx_views_day ON article_views_daily(day);
CREATE TABLE site_views_daily (
  day TEXT PRIMARY KEY,
  views INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE breaking_news (
  id INTEGER PRIMARY KEY,
  text TEXT NOT NULL,
  article_id INTEGER REFERENCES articles(id) ON DELETE SET NULL,
  active INTEGER NOT NULL DEFAULT 1,
  is_demo INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE comments (
  id INTEGER PRIMARY KEY,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  ip_hash TEXT,
  created_at TEXT NOT NULL,
  moderated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  moderated_at TEXT
);
CREATE INDEX idx_comments_article ON comments(article_id, status);
CREATE TABLE comment_reports (
  id INTEGER PRIMARY KEY,
  comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  reason TEXT,
  ip_hash TEXT,
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE ad_slots (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  page TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  price REAL NOT NULL DEFAULT 0,
  price_unit TEXT NOT NULL DEFAULT 'week' CHECK (price_unit IN ('day','week','month')),
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE ad_campaigns (
  id INTEGER PRIMARY KEY,
  slot_id INTEGER NOT NULL REFERENCES ad_slots(id),
  title TEXT NOT NULL,
  advertiser_name TEXT NOT NULL,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  image TEXT NOT NULL,
  target_url TEXT NOT NULL,
  alt_text TEXT,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','paid','free')),
  amount REAL,
  notes TEXT,
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_campaigns_slot ON ad_campaigns(slot_id, status, starts_at, ends_at);
CREATE TABLE ad_stats_daily (
  campaign_id INTEGER NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (campaign_id, day)
);
CREATE TABLE ad_requests (
  id INTEGER PRIMARY KEY,
  company TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  email TEXT,
  phone TEXT NOT NULL,
  slot_id INTEGER REFERENCES ad_slots(id) ON DELETE SET NULL,
  start_date TEXT,
  duration TEXT,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','converted','closed')),
  created_at TEXT NOT NULL
);
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE feed_sources (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  active INTEGER NOT NULL DEFAULT 1,
  last_fetched_at TEXT,
  last_status TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE feed_items (
  id INTEGER PRIMARY KEY,
  source_id INTEGER NOT NULL REFERENCES feed_sources(id) ON DELETE CASCADE,
  guid TEXT NOT NULL,
  title TEXT NOT NULL,
  link TEXT,
  summary TEXT,
  published_at TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','drafted','ignored')),
  article_id INTEGER REFERENCES articles(id) ON DELETE SET NULL,
  fetched_at TEXT NOT NULL,
  UNIQUE (source_id, guid)
);
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id INTEGER,
  details TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_created ON audit_log(created_at DESC);
`,
`
CREATE TABLE contact_messages (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','read','archived')),
  ip_hash TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_contact_status ON contact_messages(status, created_at DESC);
`,
];

function open(file) {
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  for (let i = version; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  return { fresh: version === 0 };
}
function close() { if (db) { db.close(); db = null; cache.clear(); } }
function stmt(sql) {
  let s = cache.get(sql);
  if (!s) { s = db.prepare(sql); cache.set(sql, s); }
  return s;
}
const norm = (p) => p.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
const all = (sql, ...p) => stmt(sql).all(...norm(p));
const get = (sql, ...p) => stmt(sql).get(...norm(p));
function run(sql, ...p) {
  const r = stmt(sql).run(...norm(p));
  return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
}
let depth = 0;
function tx(fn) {
  if (depth > 0) return fn();
  depth++;
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { try { db.exec('ROLLBACK'); } catch { /* تجاهل */ } throw e; }
  finally { depth--; }
}
const exec = (sql) => db.exec(sql);

module.exports = { open, close, all, get, run, tx, exec };
