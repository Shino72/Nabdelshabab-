/* نبض الشباب: سلوك الواجهة العامة (بدون مكتبات خارجية) */
(function () {
  'use strict';
  var root = document.documentElement;

  // الوضع الليلي / الفاتح
  var toggle = document.querySelector('[data-theme-toggle]');
  var label = document.querySelector('[data-theme-label]');
  function current() {
    var t = root.getAttribute('data-theme');
    if (t) return t;
    return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function sync() {
    var dark = current() === 'dark';
    if (label) label.textContent = dark ? 'الوضع الفاتح' : 'الوضع الليلي';
    if (toggle) toggle.setAttribute('aria-pressed', String(dark));
  }
  if (toggle) toggle.addEventListener('click', function () {
    var next = current() === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); } catch (e) { /* تجاهل */ }
    sync();
  });
  sync();

  // قائمة الأقسام على الموبايل
  var menuBtn = document.querySelector('[data-menu-toggle]');
  var nav = document.getElementById('main-nav');
  if (menuBtn && nav) menuBtn.addEventListener('click', function () {
    var open = nav.classList.toggle('open');
    menuBtn.setAttribute('aria-expanded', String(open));
  });

  // شريط العاجل: سرعة ثابتة مهما كان طول النصوص + زر إيقاف
  var track = document.querySelector('[data-ticker]');
  var pause = document.querySelector('[data-ticker-pause]');
  if (track) {
    var half = track.scrollWidth / 2;
    track.style.animationDuration = Math.max(18, half / 65) + 's';
  }
  if (track && pause) pause.addEventListener('click', function () {
    var bar = track.closest('.ticker');
    var paused = bar.classList.toggle('paused');
    pause.setAttribute('aria-pressed', String(paused));
    pause.textContent = paused ? 'تشغيل' : 'إيقاف مؤقت';
  });

  // نسخ الرابط والطباعة
  document.addEventListener('click', function (e) {
    var copy = e.target.closest('[data-copy]');
    if (copy) {
      var text = copy.getAttribute('data-copy');
      var done = function () { var old = copy.textContent; copy.textContent = 'تم النسخ'; setTimeout(function () { copy.textContent = old; }, 1800); };
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, function () { window.prompt('انسخ الرابط:', text); });
      else window.prompt('انسخ الرابط:', text);
    }
    if (e.target.closest('[data-print]')) window.print();
  });
})();
