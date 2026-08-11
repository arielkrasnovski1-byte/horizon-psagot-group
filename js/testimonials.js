/* ============================================================
   testimonials.js — טוען המלצות מ-Firestore (נערך דרך /crm),
   עם נפילה חזרה ל-data/testimonials.json. תומך עברית/אנגלית.
   ============================================================ */
(function () {
  'use strict';
  var grid = document.getElementById('testimonialsGrid');
  if (!grid) return;
  var isEn = (document.documentElement.lang || 'he').toLowerCase().indexOf('en') === 0;

  function esc(s) { return String(s == null ? '' : s).replace(/[<>&]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]; }); }

  function card(t) {
    var quote = isEn ? (t.quote_en || t.quote_he) : t.quote_he;
    var role = isEn ? (t.role_en || t.role_he) : t.role_he;
    return '<div class="testimonial-card reveal">' +
      '<p class="testimonial-quote">' + esc(quote) + '</p>' +
      '<div class="testimonial-author">' +
        '<div class="testimonial-avatar" aria-hidden="true">' + esc(t.initials) + '</div>' +
        '<div><div class="testimonial-name">' + esc(t.name) + '</div>' +
        '<div class="testimonial-role">' + esc(role) + '</div></div>' +
      '</div></div>';
  }

  function render(items) { if (items && items.length) grid.innerHTML = items.map(card).join(''); }

  function loadJson() {
    fetch('/data/testimonials.json', { cache: 'no-cache' })
      .then(function (r) { return r.json(); })
      .then(function (d) { render((d && d.testimonials) || []); })
      .catch(function () { /* משאיר את התוכן הסטטי הקיים */ });
  }

  (async function () {
    try {
      var cfg = await import('/js/firebase-config.js');
      if (!cfg.isConfigured) { loadJson(); return; }
      var appMod = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
      var fs = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
      var app = appMod.initializeApp(cfg.firebaseConfig);
      var db = fs.getFirestore(app);
      var snap = await fs.getDocs(fs.query(fs.collection(db, 'testimonials'), fs.orderBy('order', 'asc')));
      var items = snap.docs.map(function (d) { return d.data(); });
      if (items.length) render(items); else loadJson();
    } catch (e) { loadJson(); }
  })();
})();
