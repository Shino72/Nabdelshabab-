'use strict';
const { all, get, run } = require('../db');
const { nowIso } = require('../util');

const COLS = 'id, name, email, role, title, bio, active, is_demo, created_at, last_login_at';

module.exports = {
  list: () => all(`SELECT ${COLS}, (SELECT COUNT(*) FROM articles a WHERE a.author_id = users.id) AS article_count
    FROM users ORDER BY active DESC, CASE role WHEN 'admin' THEN 0 WHEN 'editor' THEN 1 WHEN 'writer' THEN 2 ELSE 3 END, name`),
  get: (id) => get(`SELECT ${COLS} FROM users WHERE id = ?`, id),
  getByEmail: (email) => get('SELECT * FROM users WHERE lower(email) = lower(?)', String(email || '').trim()),
  getWithHash: (id) => get('SELECT * FROM users WHERE id = ?', id),
  emailTaken: (email, exceptId = 0) => !!get('SELECT 1 AS x FROM users WHERE lower(email) = lower(?) AND id != ?', email, exceptId),
  create: ({ name, email, passwordHash, role, title, bio, isDemo }) =>
    run('INSERT INTO users (name, email, password_hash, role, title, bio, active, is_demo, created_at) VALUES (?,?,?,?,?,?,1,?,?)',
      name, email, passwordHash, role, title || null, bio || null, isDemo ? 1 : 0, nowIso()).id,
  update: (id, u) => run('UPDATE users SET name = ?, email = ?, role = ?, title = ?, bio = ?, active = ? WHERE id = ?',
    u.name, u.email, u.role, u.title || null, u.bio || null, u.active ? 1 : 0, id),
  updateProfile: (id, u) => run('UPDATE users SET name = ?, title = ?, bio = ? WHERE id = ?', u.name, u.title || null, u.bio || null, id),
  setPassword(id, hash, keepTokenHash = null) {
    run('UPDATE users SET password_hash = ? WHERE id = ?', hash, id);
    run('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?', id, keepTokenHash || '');
  },
  endSessions: (id) => run('DELETE FROM sessions WHERE user_id = ?', id),
  touchLogin: (id) => run('UPDATE users SET last_login_at = ? WHERE id = ?', nowIso(), id),
  countActiveAdmins: () => get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1").n,
  authors: () => all("SELECT id, name, role FROM users WHERE active = 1 AND role != 'ads' ORDER BY name"),
  publicProfile: (id) => get('SELECT id, name, title, bio, is_demo FROM users WHERE id = ?', id),
};
