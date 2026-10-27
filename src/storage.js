'use strict';
// حفظ الصور المرفوعة في Supabase Storage (عند ضبط SUPABASE_URL ومفتاح الخدمة)، وإلا في مجلد uploads على الخادم
const fs = require('node:fs');
const path = require('node:path');
const bridge = require('./bridge');
const config = require('./config');

const enabled = () => !!config.storage;

function request(method, apiPath, { body, headers = {} } = {}) {
  const { url, key } = config.storage;
  const h = { apikey: key, ...headers };
  // المفاتيح القديمة (JWT) تُرسل أيضًا كـ Bearer؛ المفاتيح الجديدة sb_secret_ تكفي في apikey
  if (key.startsWith('eyJ')) h.Authorization = `Bearer ${key}`;
  return bridge.call('http', { method, url: `${url}/storage/v1/${apiPath}`, headers: h, body });
}
const encodePath = (rel) => rel.split('/').map(encodeURIComponent).join('/');

function createBucket() {
  const { bucket } = config.storage;
  const r = request('POST', 'bucket', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: bucket, name: bucket, public: true, file_size_limit: config.maxUploadMb * 1024 * 1024, allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] }),
  });
  if (r.status >= 300 && !/already exists|Duplicate/i.test(r.text)) throw new Error(`تعذر إنشاء مساحة تخزين الصور (${r.status})`);
}

// rel مثل 2026/10/abc.jpg
function put(rel, data, mime) {
  if (!enabled()) {
    const full = path.join(config.uploadsDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, data, { mode: 0o644 });
    return;
  }
  const upload = () => request('POST', `object/${config.storage.bucket}/${encodePath(rel)}`, {
    headers: { 'Content-Type': mime, 'Cache-Control': 'max-age=31536000', 'x-upsert': 'false' }, body: new Uint8Array(data),
  });
  let r = upload();
  if (r.status === 404 || /bucket not found/i.test(r.text)) { createBucket(); r = upload(); }
  if (r.status >= 300) throw new Error(`تعذر رفع الصورة إلى التخزين (${r.status})`);
}

function remove(rel) {
  if (!enabled()) {
    try { fs.unlinkSync(path.join(config.uploadsDir, rel)); } catch { /* تجاهل */ }
    return;
  }
  try { request('DELETE', `object/${config.storage.bucket}/${encodePath(rel)}`); } catch { /* تجاهل: الملف يبقى بلا استخدام */ }
}

const publicUrl = (rel) => `${config.storage.url}/storage/v1/object/public/${config.storage.bucket}/${encodePath(rel)}`;
const origin = () => (enabled() ? config.storage.url : null);

module.exports = { enabled, put, remove, publicUrl, origin };
