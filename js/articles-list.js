/* articles-list.js — רשימת מאמרים ב-/knowledge מ-Firestore (נערך דרך /crm),
   כל כרטיס מקשר ל-/article/?id=. נפילה ל-data/articles.json (מקשר לסטטי). */
(function () {
  'use strict';
  var grid = document.getElementById('knowledgeGrid');
  if (!grid) return;
  var isEn = (document.documentElement.lang || 'he').toLowerCase().indexOf('en') === 0;
  var base = isEn ? '/en/article/' : '/article/';
  function esc(s) { return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]; }); }
  function card(a) {
    var title = isEn ? (a.title_en || a.title_he) : a.title_he;
    var cat = isEn ? (a.category_en || a.category_he) : a.category_he;
    var read = isEn ? (a.read_en || a.read_he) : a.read_he;
    var exc = isEn ? (a.excerpt_en || a.excerpt_he) : a.excerpt_he;
    var href = a.id ? (base + '?id=' + encodeURIComponent(a.id)) : base;
    return '<a href="' + href + '" class="blog-card reveal">' +
      (a.image ? '<div class="blog-card-image" aria-hidden="true"><img src="' + esc(a.image) + '" alt="" loading="lazy"></div>' : '') +
      '<div class="blog-card-content"><div class="blog-card-meta">' +
        '<span class="category">' + esc(cat) + '</span><span>·</span><span>' + esc(a.date || '') + '</span><span>·</span><span>' + esc(read) + '</span></div>' +
      '<h3>' + esc(title) + '</h3><p>' + esc(exc) + '</p></div></a>';
  }
  // מרנדר רק כשיש מאמרים אמיתיים ב-Firestore; אחרת משאיר את הכרטיסים הסטטיים הקיימים
  function render(items) { if (items && items.length) grid.innerHTML = items.map(card).join(''); }
  (async function () {
    try {
      var cfg = await import('/js/firebase-config.js');
      if (!cfg.isConfigured) return;
      var appMod = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
      var fs = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
      var db = fs.getFirestore(appMod.initializeApp(cfg.firebaseConfig));
      var snap = await fs.getDocs(fs.query(fs.collection(db, 'articles'), fs.orderBy('order', 'asc')));
      var items = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
      render(items);
    } catch (e) { /* משאיר סטטי */ }
  })();
})();
