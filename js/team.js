/* team.js — טוען צוות מ-Firestore (נערך דרך /crm), נפילה ל-data/team.json */
(function () {
  'use strict';
  var grid = document.getElementById('teamGrid');
  if (!grid) return;
  var isEn = (document.documentElement.lang || 'he').toLowerCase().indexOf('en') === 0;
  function esc(s) { return String(s == null ? '' : s).replace(/[<>&]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]; }); }
  function card(t) {
    var role = isEn ? (t.role_en || t.role_he) : (t.role_he || t.role_en);
    var bio = isEn ? (t.bio_en || t.bio_he) : (t.bio_he || t.bio_en);
    return '<article class="team-card reveal"><span class="team-accent" aria-hidden="true"></span>' +
      '<h3>' + esc(role) + '</h3><p class="team-bio">' + esc(bio) + '</p></article>';
  }
  function render(items) { if (items && items.length) { grid.innerHTML = items.map(card).join(''); grid.querySelectorAll('.reveal').forEach(function (el) { el.classList.add('is-visible'); }); } }
  function loadJson() { fetch('/data/team.json', { cache: 'no-cache' }).then(function (r) { return r.json(); }).then(function (d) { render((d && d.team) || []); }).catch(function () {}); }
  (async function () {
    try {
      var cfg = await import('/js/firebase-config.js');
      if (!cfg.isConfigured) { loadJson(); return; }
      var appMod = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
      var fs = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
      var db = fs.getFirestore(appMod.initializeApp(cfg.firebaseConfig));
      var snap = await fs.getDocs(fs.query(fs.collection(db, 'team'), fs.orderBy('order', 'asc')));
      var items = snap.docs.map(function (d) { return d.data(); });
      if (items.length) render(items); else loadJson();
    } catch (e) { loadJson(); }
  })();
})();
