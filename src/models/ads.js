'use strict';
const { all, get, run } = require('../db');
const { nowIso } = require('../util');

const PRICE_UNITS = { day: 'يوم', week: 'أسبوع', month: 'شهر' };

const slots = () => all('SELECT * FROM ad_slots ORDER BY sort, id');
const activeSlots = () => all('SELECT * FROM ad_slots WHERE active = 1 ORDER BY sort, id');
const slotByKey = (key) => get('SELECT * FROM ad_slots WHERE key = ?', key);
const slotById = (id) => get('SELECT * FROM ad_slots WHERE id = ?', id);
const updateSlot = (id, s) => run('UPDATE ad_slots SET name = ?, price = ?, price_unit = ?, active = ? WHERE id = ?', s.name, s.price, s.price_unit, s.active ? 1 : 0, id);

// اختيار إعلان نشط عشوائيًا للمساحة (تدوير عند وجود أكثر من حملة)
function pickForSlot(key) {
  const now = nowIso();
  const rows = all(`SELECT c.id, c.image, c.alt_text, c.title, s.width, s.height FROM ad_campaigns c JOIN ad_slots s ON s.id = c.slot_id
    WHERE s.key = ? AND s.active = 1 AND c.status = 'active' AND c.starts_at <= ? AND c.ends_at > ?`, key, now, now);
  return rows.length ? rows[Math.floor(Math.random() * rows.length)] : null;
}
function countImpression(id, day) {
  run('UPDATE ad_campaigns SET impressions = impressions + 1 WHERE id = ?', id);
  run('INSERT INTO ad_stats_daily (campaign_id, day, impressions, clicks) VALUES (?, ?, 1, 0) ON CONFLICT(campaign_id, day) DO UPDATE SET impressions = impressions + 1', id, day);
}
function registerClick(id, day, count = true) {
  const c = get('SELECT id, target_url FROM ad_campaigns WHERE id = ?', id);
  if (!c) return null;
  if (count) {
    run('UPDATE ad_campaigns SET clicks = clicks + 1 WHERE id = ?', id);
    run('INSERT INTO ad_stats_daily (campaign_id, day, impressions, clicks) VALUES (?, ?, 0, 1) ON CONFLICT(campaign_id, day) DO UPDATE SET clicks = clicks + 1', id, day);
  }
  return c.target_url;
}

function campaignState(c, now = nowIso()) {
  if (c.status === 'paused') return { key: 'paused', label: 'موقوفة' };
  if (c.starts_at > now) return { key: 'scheduled', label: 'مجدولة' };
  if (c.ends_at <= now) return { key: 'ended', label: 'منتهية' };
  return { key: 'running', label: 'تعمل الآن' };
}
const campaigns = () => all(`SELECT c.*, s.name AS slot_name, s.key AS slot_key, s.width, s.height FROM ad_campaigns c JOIN ad_slots s ON s.id = c.slot_id
  ORDER BY CASE WHEN c.ends_at > ? THEN 0 ELSE 1 END, c.starts_at DESC`, nowIso());
const campaign = (id) => get('SELECT c.*, s.name AS slot_name FROM ad_campaigns c JOIN ad_slots s ON s.id = c.slot_id WHERE c.id = ?', id);
const runningCount = () => get("SELECT COUNT(*) AS n FROM ad_campaigns WHERE status = 'active' AND starts_at <= ? AND ends_at > ?", nowIso(), nowIso()).n;

const CAMPAIGN_FIELDS = ['slot_id', 'title', 'advertiser_name', 'contact_name', 'contact_email', 'contact_phone', 'image', 'target_url', 'alt_text',
  'starts_at', 'ends_at', 'status', 'payment_status', 'amount', 'notes'];
function saveCampaign(c, userId) {
  const vals = CAMPAIGN_FIELDS.map((f) => (c[f] === '' ? null : c[f]));
  if (c.id) {
    run(`UPDATE ad_campaigns SET ${CAMPAIGN_FIELDS.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`, ...vals, c.id);
    return c.id;
  }
  return run(`INSERT INTO ad_campaigns (${CAMPAIGN_FIELDS.join(', ')}, created_at, created_by) VALUES (${CAMPAIGN_FIELDS.map(() => '?').join(', ')}, ?, ?)`,
    ...vals, nowIso(), userId || null).id;
}
const setCampaignStatus = (id, status) => run('UPDATE ad_campaigns SET status = ? WHERE id = ?', status, id);
const deleteCampaign = (id) => run('DELETE FROM ad_campaigns WHERE id = ?', id);
const campaignDaily = (id) => all('SELECT day, impressions, clicks FROM ad_stats_daily WHERE campaign_id = ? ORDER BY day', id);

/* ---------- طلبات الإعلان من صفحة «أعلن معنا» ---------- */
const createRequest = (r) => run(`INSERT INTO ad_requests (company, contact_name, email, phone, slot_id, start_date, duration, message, status, created_at)
  VALUES (?,?,?,?,?,?,?,?, 'new', ?)`, r.company, r.contact_name, r.email || null, r.phone, r.slot_id || null, r.start_date || null, r.duration || null, r.message || null, nowIso()).id;
const requests = () => all('SELECT r.*, s.name AS slot_name FROM ad_requests r LEFT JOIN ad_slots s ON s.id = r.slot_id ORDER BY r.created_at DESC LIMIT 300');
const request = (id) => get('SELECT * FROM ad_requests WHERE id = ?', id);
const setRequestStatus = (id, status) => run('UPDATE ad_requests SET status = ? WHERE id = ?', status, id);
const newRequestsCount = () => get("SELECT COUNT(*) AS n FROM ad_requests WHERE status = 'new'").n;

module.exports = {
  PRICE_UNITS, slots, activeSlots, slotByKey, slotById, updateSlot, pickForSlot, countImpression, registerClick, campaignState, campaigns, campaign,
  runningCount, saveCampaign, setCampaignStatus, deleteCampaign, campaignDaily, createRequest, requests, request, setRequestStatus, newRequestsCount,
};
