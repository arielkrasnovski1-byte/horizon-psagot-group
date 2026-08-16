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
  var ORG = isEn ? 'Horizon Psagot Group' : 'הורייזון פסגות גרופ';
  // DD.MM.YYYY -> YYYY-MM-DD (עבור datePublished בתקן schema)
  function isoDate(d) { var m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec((d || '').trim()); return m ? (m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2)) : ''; }
  function abs(u) { if (!u) return ''; return /^https?:/.test(u) ? u : (location.origin + u); }
  function canonicalUrl() { return location.origin + location.pathname + '?id=' + encodeURIComponent(id); }
  // קנוני ייחודי לכל מאמר (במקום שכל המאמרים יצביעו לאותו עמוד תבנית)
  function setCanonical(url) {
    var l = document.querySelector('link[rel="canonical"]');
    if (!l) { l = document.createElement('link'); l.setAttribute('rel', 'canonical'); document.head.appendChild(l); }
    l.setAttribute('href', url);
  }
  // נתוני BlogPosting מובנים — סיכוי לתצוגה עשירה בגוגל
  function injectJsonLd(a, title, cat) {
    var prev = document.getElementById('article-jsonld'); if (prev) prev.remove();
    var data = {
      '@context': 'https://schema.org', '@type': 'BlogPosting',
      headline: title, articleSection: cat, inLanguage: isEn ? 'en' : 'he',
      image: abs(a.image) || 'https://horizonpsagotgroup.com/assets/logo/og-image.png',
      author: { '@type': 'Organization', name: ORG },
      publisher: { '@type': 'Organization', name: ORG, logo: { '@type': 'ImageObject', url: 'https://horizonpsagotgroup.com/assets/logo/logo.png' } },
      mainEntityOfPage: canonicalUrl()
    };
    var iso = isoDate(a.date); if (iso) { data.datePublished = iso; data.dateModified = iso; }
    var s = document.createElement('script'); s.type = 'application/ld+json'; s.id = 'article-jsonld';
    s.textContent = JSON.stringify(data); document.head.appendChild(s);
  }
  function render(a) {
    var title = isEn ? (a.title_en || a.title_he) : (a.title_he || a.title_en);
    var cat = isEn ? (a.category_en || a.category_he) : (a.category_he || a.category_en);
    var read = isEn ? (a.read_en || a.read_he) : (a.read_he || a.read_en);
    var body = isEn ? (a.body_en || a.body_he) : (a.body_he || a.body_en);
    if (titleEl) titleEl.textContent = title;
    document.title = title + (isEn ? ' — Horizon Psagot Group' : ' — הורייזון פסגות גרופ');
    if (metaEl) metaEl.innerHTML = '<span class="category">' + esc(cat) + '</span><span>' + esc(a.date || '') + '</span><span>' + esc(read) + '</span><span>' + (isEn ? 'By: Horizon Psagot Group team' : 'מאת: צוות הורייזון פסגות גרופ') + '</span>';
    bodyEl.innerHTML = bodyHtml(body);
    setCanonical(canonicalUrl());
    injectJsonLd(a, title, cat);
  }
  // חיפוש המאמר בקובץ הסטטי לפי id (נפילה כש-Firestore לא מוגדר/ריק)
  async function fromJson() {
    try {
      var r = await fetch('/data/articles.json', { cache: 'no-cache' });
      var data = await r.json();
      var list = (data && data.articles) || [];
      var found = list.filter(function (a) { return a.id === id; })[0];
      if (found) { render(found); return true; }
    } catch (e) { /* ממשיך */ }
    return false;
  }
  // מצב "לא נמצא" — עדיף מהצגת מאמר סטטי לא-קשור
  function notFound() {
    var t = isEn ? 'Article not found' : 'המאמר לא נמצא';
    if (titleEl) titleEl.textContent = t;
    document.title = t + (isEn ? ' — Horizon Psagot Group' : ' — הורייזון פסגות גרופ');
    if (metaEl) metaEl.innerHTML = '';
    var back = isEn ? '/en/knowledge/' : '/knowledge/';
    var label = isEn ? 'Back to all articles' : 'חזרה לכל המאמרים';
    bodyEl.innerHTML = '<p>' + esc(t) + '.</p><p><a href="' + back + '">' + esc(label) + ' ›</a></p>';
  }
  (async function () {
    try {
      var cfg = await import('/js/firebase-config.js');
      if (cfg.isConfigured) {
        try {
          var appMod = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
          var fs = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
          var db = fs.getFirestore(appMod.initializeApp(cfg.firebaseConfig));
          var snap = await fs.getDoc(fs.doc(db, 'articles', id));
          if (snap.exists()) { render(snap.data()); return; }
        } catch (e) { /* נופל ל-JSON */ }
      }
      if (await fromJson()) return;
      notFound();
    } catch (e) { /* משאיר סטטי */ }
  })();
})();
