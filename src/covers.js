'use strict';
// صور توضيحية مولّدة برمجيًا (SVG) للمحتوى التجريبي وللأخبار التي لا تحتوي صورة غلاف
const PALETTE = {
  politics: ['#16305a', '#0b1a33'], sports: ['#0f5a3e', '#0a2f24'], culture: ['#4b2a6b', '#24133a'], economy: ['#0d5160', '#082a33'],
  tech: ['#273a8a', '#111b45'], society: ['#7a4a12', '#3b2308'], education: ['#0c5a7a', '#06293a'], world: ['#2b4a6b', '#132438'],
  opinion: ['#6b1f2a', '#320d14'], reports: ['#3d4656', '#1a1f28'], multimedia: ['#7a1a22', '#2e0a0e'], default: ['#16305a', '#0b1a33'],
};
const ICONS = {
  politics: '<path d="M-150 -40 L0 -130 L150 -40 Z"/><path d="M-120 -20 V100 M-60 -20 V100 M0 -20 V100 M60 -20 V100 M120 -20 V100"/><path d="M-160 120 H160"/>',
  sports: '<circle r="140"/><path d="M0 -55 L52 -17 L32 45 L-32 45 L-52 -17 Z"/><path d="M0 -55 V-140 M52 -17 L132 -45 M32 45 L82 113 M-32 45 L-82 113 M-52 -17 L-132 -45"/>',
  culture: '<rect x="-150" y="-60" width="300" height="180" rx="10"/><path d="M-150 -60 L-130 -130 L170 -100 L150 -40"/><path d="M-80 -125 L-100 -55 M0 -118 L-20 -50 M80 -110 L60 -45"/><path d="M-30 10 L45 50 L-30 90 Z"/>',
  economy: '<path d="M-150 130 H150"/><path d="M-120 130 V60 M-60 130 V20 M0 130 V-10 M60 130 V-50 M120 130 V-90"/><path d="M-140 30 L-50 -30 L10 0 L130 -120"/><path d="M80 -120 H130 V-70"/>',
  tech: '<rect x="-100" y="-100" width="200" height="200" rx="18"/><rect x="-50" y="-50" width="100" height="100" rx="8"/><path d="M-60 -100 V-150 M0 -100 V-150 M60 -100 V-150 M-60 100 V150 M0 100 V150 M60 100 V150 M-100 -60 H-150 M-100 0 H-150 M-100 60 H-150 M100 -60 H150 M100 0 H150 M100 60 H150"/>',
  society: '<circle cx="-90" cy="-40" r="38"/><circle cx="0" cy="-70" r="45"/><circle cx="90" cy="-40" r="38"/><path d="M-160 110 C-160 40 -20 40 -20 110 M-70 110 C-70 10 70 10 70 110 M20 110 C20 40 160 40 160 110"/>',
  education: '<path d="M-170 -40 L0 -120 L170 -40 L0 40 Z"/><path d="M-100 0 V80 C-50 120 50 120 100 80 V0"/><path d="M150 -30 V60"/><circle cx="150" cy="75" r="12"/>',
  world: '<circle r="140"/><ellipse rx="60" ry="140"/><path d="M-140 0 H140 M-120 -70 H120 M-120 70 H120"/>',
  opinion: '<path d="M-130 20 C-130 -60 -90 -100 -40 -110 L-40 -80 C-70 -70 -85 -45 -85 -15 L-30 -15 L-30 90 L-130 90 Z"/><path d="M30 20 C30 -60 70 -100 120 -110 L120 -80 C90 -70 75 -45 75 -15 L130 -15 L130 90 L30 90 Z"/>',
  reports: '<circle cx="-30" cy="-30" r="100"/><path d="M42 42 L140 140"/><path d="M-80 -30 H20 M-80 10 H0 M-80 -70 H20"/>',
  multimedia: '<circle r="140"/><path d="M-40 -70 L80 0 L-40 70 Z"/>',
};
function hash(str) { let h = 2166136261; for (const ch of str) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

function coverSvg(key, { label = true } = {}) {
  const cat = String(key).split('-')[0];
  const [c1, c2] = PALETTE[cat] || PALETTE.default;
  const icon = ICONS[cat] || ICONS.world;
  const h = hash(key);
  const x = 300 + (h % 600), y = 200 + ((h >> 8) % 280), r = 260 + ((h >> 16) % 200);
  const ix = 600 + (((h >> 4) % 5) - 2) * 110, rot = ((h >> 12) % 21) - 10;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 675" width="1200" height="675">
<defs><linearGradient id="g" x1="${h % 2}" y1="0" x2="${1 - (h % 2)}" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>
<pattern id="p" width="48" height="48" patternUnits="userSpaceOnUse"><path d="M48 0H0V48" fill="none" stroke="#fff" stroke-opacity=".05"/></pattern></defs>
<rect width="1200" height="675" fill="url(#g)"/><rect width="1200" height="675" fill="url(#p)"/>
<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" fill-opacity=".05"/><circle cx="${1200 - x}" cy="${675 - y}" r="${r / 2}" fill="none" stroke="#fff" stroke-opacity=".08" stroke-width="2"/>
<path d="M${1200 - x / 3} 0 L${1200 - x / 3 - 40} 675" stroke="#d21f30" stroke-opacity=".55" stroke-width="6"/>
<g transform="translate(${ix} 330) rotate(${rot}) scale(1.15)" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" stroke-opacity=".88">${icon}</g>
${label ? '<text x="1160" y="640" direction="rtl" font-family="Noto Kufi Arabic, Tahoma, sans-serif" font-size="24" fill="#fff" fill-opacity=".72">صورة توضيحية</text>' : ''}
</svg>`;
}
module.exports = { coverSvg };
