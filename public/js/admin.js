/* نبض الشباب: سلوك لوحة التحكم */
(function () {
  'use strict';
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  var csrfInput = $('input[name="_csrf"]');
  var csrf = csrfInput ? csrfInput.value : '';

  // القائمة الجانبية على الشاشات الصغيرة
  var sideBtn = $('[data-side-toggle]'), side = $('#sidebar');
  if (sideBtn && side) sideBtn.addEventListener('click', function () {
    var open = side.classList.toggle('open');
    sideBtn.setAttribute('aria-expanded', String(open));
  });

  // تأكيد العمليات الحساسة (الحذف)
  document.addEventListener('submit', function (e) {
    var msg = e.target.getAttribute('data-confirm');
    if (msg && !window.confirm(msg)) e.preventDefault();
  }, true);

  // عدّاد الأحرف
  $$('[data-count]').forEach(function (el) {
    var max = +el.getAttribute('data-count');
    var c = document.createElement('span');
    c.className = 'counter';
    el.insertAdjacentElement('afterend', c);
    function update() { c.textContent = el.value.length + ' / ' + max; c.classList.toggle('over', el.value.length > max * 0.95); }
    el.addEventListener('input', update);
    update();
  });

  // معاينة صورة الغلاف
  function scopeOf(el) { return el.closest('fieldset') || el.closest('form') || document; }
  $$('[data-file-name]').forEach(function (inp) {
    inp.addEventListener('change', function () {
      var scope = scopeOf(inp), f = inp.files[0];
      var lab = scope.querySelector('[data-file-label]'), prev = scope.querySelector('[data-cover-preview]');
      if (lab) lab.textContent = f ? f.name : '';
      if (f && prev) prev.src = URL.createObjectURL(f);
    });
  });
  $$('[data-cover-input]').forEach(function (inp) {
    inp.addEventListener('change', function () {
      var prev = scopeOf(inp).querySelector('[data-cover-preview]');
      if (prev && /^\/(uploads|demo-img)\//.test(inp.value.trim())) prev.src = inp.value.trim();
    });
  });

  // أدوات التنسيق في محرر المقالات
  var body = $('#body');
  function wrap(before, after, placeholder) {
    var s = body.selectionStart, e = body.selectionEnd, v = body.value;
    var sel = v.slice(s, e) || placeholder;
    body.value = v.slice(0, s) + before + sel + after + v.slice(e);
    body.focus();
    body.setSelectionRange(s + before.length, s + before.length + sel.length);
  }
  function prefixLine(prefix, placeholder) {
    var s = body.selectionStart, e = body.selectionEnd, v = body.value;
    var start = v.lastIndexOf('\n', s - 1) + 1;
    var sel = v.slice(start, e) || placeholder;
    var lines = sel.split('\n').map(function (l) { return prefix + l; }).join('\n');
    body.value = v.slice(0, start) + lines + v.slice(Math.max(e, start));
    body.focus();
  }
  $$('[data-md]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (!body) return;
      var k = btn.getAttribute('data-md');
      if (k === 'h2') prefixLine('## ', 'عنوان فرعي');
      else if (k === 'bold') wrap('**', '**', 'نص غامق');
      else if (k === 'quote') prefixLine('> ', 'اقتباس');
      else if (k === 'list') prefixLine('- ', 'بند');
      else if (k === 'link') {
        var url = window.prompt('أدخل الرابط (يبدأ بـ https://)', 'https://');
        if (url && /^https?:\/\/\S+$/.test(url)) wrap('[', '](' + url + ')', 'نص الرابط');
      }
    });
  });

  // المعاينة: النص يُحوَّل على الخادم بنفس قواعد الأمان المستخدمة في الموقع
  var pvBtn = $('[data-preview]'), pane = $('[data-preview-pane]');
  if (pvBtn && pane && body) pvBtn.addEventListener('click', function () {
    if (pvBtn.getAttribute('aria-pressed') === 'true') {
      pane.hidden = true; body.hidden = false; pvBtn.setAttribute('aria-pressed', 'false'); pvBtn.textContent = 'معاينة'; return;
    }
    fetch('/admin/preview', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify({ body: body.value }) })
      .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
      .then(function (d) { pane.innerHTML = d.html || '<p>لا يوجد نص بعد.</p>'; pane.hidden = false; body.hidden = true; pvBtn.setAttribute('aria-pressed', 'true'); pvBtn.textContent = 'العودة للتحرير'; })
      .catch(function () { window.alert('تعذرت المعاينة. تأكد من اتصالك وحاول مرة أخرى.'); });
  });

  // نسخ روابط الصور
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-copy]');
    if (!b || !navigator.clipboard) return;
    navigator.clipboard.writeText(b.getAttribute('data-copy')).then(function () { var o = b.textContent; b.textContent = 'تم النسخ'; setTimeout(function () { b.textContent = o; }, 1500); });
  });

  // نافذة مكتبة الوسائط (اختيار غلاف، إدراج صورة في النص، إضافة صور للمعرض)
  var dlg = $('#media-dialog'), grid = $('[data-md-grid]'), status = $('[data-md-status]'), upload = $('[data-md-upload]');
  var mode = null, opener = null;
  function msg(text) { grid.textContent = ''; var p = document.createElement('p'); p.className = 'muted'; p.textContent = text; grid.appendChild(p); }
  function load() {
    msg('جارٍ التحميل…');
    fetch('/admin/media.json', { headers: { Accept: 'application/json' } }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.items.length) return msg('المكتبة فارغة. ارفع صورة من الزر أعلاه.');
      grid.textContent = '';
      d.items.forEach(function (m) {
        var b = document.createElement('button');
        b.type = 'button'; b.title = m.path;
        var img = document.createElement('img');
        img.src = m.path; img.alt = ''; img.loading = 'lazy';
        b.appendChild(img);
        b.addEventListener('click', function () { choose(m.path); });
        grid.appendChild(b);
      });
    }).catch(function () { msg('تعذر تحميل المكتبة.'); });
  }
  function choose(path) {
    if (mode === 'cover') {
      var scope = scopeOf(opener);
      var inp = scope.querySelector('[data-cover-input]'), prev = scope.querySelector('[data-cover-preview]');
      if (inp) inp.value = path;
      if (prev) prev.src = path;
    } else if (mode === 'insert' && body) {
      var alt = (window.prompt('وصف الصورة (يظهر أسفلها)', '') || '').replace(/[\[\]]/g, '');
      var s = body.selectionStart, v = body.value;
      var ins = (s > 0 && v[s - 1] !== '\n' ? '\n\n' : '') + '![' + alt + '](' + path + ')\n\n';
      body.value = v.slice(0, s) + ins + v.slice(s);
    } else if (mode === 'gallery') {
      var g = $('[data-gallery-input]');
      if (g) g.value = (g.value.trim() ? g.value.trim() + '\n' : '') + path + ' | ';
    }
    dlg.close();
  }
  $$('[data-open-media]').forEach(function (b) {
    b.addEventListener('click', function () {
      if (!dlg || !dlg.showModal) return;
      mode = b.getAttribute('data-open-media'); opener = b;
      dlg.showModal(); load();
    });
  });
  if (upload) upload.addEventListener('change', function () {
    var f = upload.files[0];
    if (!f) return;
    var fd = new FormData();
    fd.append('file', f);
    fd.append('_csrf', csrf);
    status.textContent = 'جارٍ الرفع…';
    fetch('/admin/media/upload', { method: 'POST', body: fd, headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (d) { status.textContent = d.errors && d.errors.length ? d.errors.join(' / ') : 'تم الرفع. اختر الصورة من القائمة.'; upload.value = ''; load(); })
      .catch(function () { status.textContent = 'تعذر الرفع.'; });
  });
})();
