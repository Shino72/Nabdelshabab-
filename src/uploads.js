'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./config');

// التعرف على نوع الصورة من محتواها الفعلي وليس من الامتداد (SVG غير مسموح لأسباب أمنية)
function detectImage(buf) {
  if (buf.length < 16) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: '.jpg', mime: 'image/jpeg' };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: '.png', mime: 'image/png' };
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return { ext: '.webp', mime: 'image/webp' };
  const g = buf.subarray(0, 6).toString('latin1');
  if (g === 'GIF87a' || g === 'GIF89a') return { ext: '.gif', mime: 'image/gif' };
  return null;
}

function imageSize(buf, mime) {
  try {
    if (mime === 'image/png') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (mime === 'image/gif') return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    if (mime === 'image/webp') {
      const chunk = buf.subarray(12, 16).toString('latin1');
      if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      if (chunk === 'VP8L') { const b = buf.readUInt32LE(21); return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }; }
      if (chunk === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    }
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i < buf.length - 9) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
        }
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
  } catch { /* تجاهل */ }
  return { width: null, height: null };
}

// يعيد { error } أو { path, mime, size, width, height }
function saveImage(file) {
  if (!file || !file.data || !file.data.length) return { error: 'لم يتم اختيار ملف' };
  if (file.data.length > config.maxUploadMb * 1024 * 1024) return { error: `حجم الصورة أكبر من ${config.maxUploadMb} ميجابايت` };
  const kind = detectImage(file.data);
  if (!kind) return { error: 'نوع الملف غير مدعوم. الأنواع المسموحة: JPG وPNG وWebP وGIF' };
  const { width, height } = imageSize(file.data, kind.mime);
  if (width && height && (width > 12000 || height > 12000)) return { error: 'أبعاد الصورة كبيرة جدًا' };
  const d = new Date();
  const sub = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  const dir = path.join(config.uploadsDir, sub);
  fs.mkdirSync(dir, { recursive: true });
  const name = crypto.randomBytes(12).toString('hex') + kind.ext;
  fs.writeFileSync(path.join(dir, name), file.data, { mode: 0o644 });
  return { path: `/uploads/${sub}/${name}`, mime: kind.mime, size: file.data.length, width, height, originalName: file.filename };
}

function removeFile(publicPath) {
  if (!/^\/uploads\/\d{4}\/\d{2}\/[a-f0-9]{24}\.(jpg|png|webp|gif)$/.test(publicPath)) return;
  try { fs.unlinkSync(path.join(config.uploadsDir, publicPath.replace('/uploads/', ''))); } catch { /* تجاهل */ }
}

module.exports = { detectImage, imageSize, saveImage, removeFile };
