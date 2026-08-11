/* article.js — טוען מאמר בודד לפי ?id= מ-Firestore. בלי id → משאיר סטטי. */
(function () {
  'use strict';
  var bodyEl = document.getElementById('articleBody');
  if (!bodyEl) return;
  var id = new URLSearchParams(location.search).get('id');
  if (!id) return;
  var isEn = (document.documentElement.lang || 'he').toLowerCase().indexOf('en') === 0;
  var titleEl = document.getElementById('articleTitle');
  var metaEl = document.getElementById('articleMeta');
  function esc(s) { return String(s == null ? '' : s).replace(/[<>&]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]; }); }
  function bodyHtml(b) { b = b || ''; if (/^\s*</.test(b)) return b; return b.split(/\n\s*\n/).map(function (p) { return '<p>' + esc(p.trim()) + '</p>'; }).join(''); }
  function render(a) {
    var title = isEn ? (a.title_en || a.title_he) : a.title_he;
    var cat = isEn ? (a.category_en || a.category_he) : a.category_he;
    var read = isEn ? (a.read_en || a.read_he) : a.read_he;
    var body = isEn ? (a.body_en || a.body_he) : a.body_he;
    if (titleEl) titleEl.textContent = title;
    document.title = title + (isEn ? ' — Horizon Psagot Group' : ' — הורייזון פסגות גרופ');
    if (metaEl) metaEl.innerHTML = '<span class="category">' + esc(cat) + '</span><span>' + esc(a.date || '') + '</span><span>' + esc(read) + '</span><span>' + (isEn ? 'By: Horizon Psagot Group team' : 'מאת: צוות הורייזון פסגות גרופ') + '</span>';
    bodyEl.innerHTML = bodyHtml(body);
  }
  (async function () {
    try {
      var cfg = await import('/js/firebase-config.js');
      if (!cfg.isConfigured) return;
      var appMod = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
      var fs = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
      var db = fs.getFirestore(appMod.initializeApp(cfg.firebaseConfig));
      var snap = await fs.getDoc(fs.doc(db, 'articles', id));
      if (snap.exists()) render(snap.data());
    } catch (e) { /* משאיר סטטי */ }
  })();
})();
