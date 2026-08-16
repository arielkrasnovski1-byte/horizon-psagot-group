/* faq.js — טוען שאלות נפוצות מ-Firestore (נערך דרך /crm), מקבץ לפי קטגוריה,
   נפילה חזרה ל-data/faq.json. תומך עברית/אנגלית. */
(function () {
  'use strict';
  var list = document.getElementById('faqList');
  if (!list) return;
  var isEn = (document.documentElement.lang || 'he').toLowerCase().indexOf('en') === 0;
  function esc(s) { return String(s == null ? '' : s).replace(/[<>&]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]; }); }

  function render(items) {
    if (!items || !items.length) return;
    var groups = [], byCat = {};
    items.forEach(function (f) {
      var cat = isEn ? (f.category_en || f.category_he) : (f.category_he || f.category_en);
      cat = cat || '';
      if (!byCat[cat]) { byCat[cat] = []; groups.push(cat); }
      byCat[cat].push(f);
    });
    var html = '';
    groups.forEach(function (cat, gi) {
      if (cat) html += '<h2 class="reveal" style="font-size: var(--fs-xl); margin: ' + (gi === 0 ? '0 0 var(--space-sm)' : 'var(--space-lg) 0 var(--space-sm)') + ';">' + esc(cat) + '</h2>';
      byCat[cat].forEach(function (f) {
        var q = isEn ? (f.question_en || f.question_he) : (f.question_he || f.question_en);
        var a = isEn ? (f.answer_en || f.answer_he) : (f.answer_he || f.answer_en);
        html += '<details class="faq-item reveal"><summary class="faq-question">' + esc(q) + '</summary>' +
                '<div class="faq-answer">' + esc(a) + '</div></details>';
      });
    });
    list.innerHTML = html;
    list.querySelectorAll('.reveal').forEach(function(el){el.classList.add('is-visible');});
    injectFaqJsonLd(items);
  }
  // נתוני FAQPage מובנים — סיכוי לתצוגת שאלות עשירה בתוצאות גוגל
  function injectFaqJsonLd(items) {
    var prev = document.getElementById('faq-jsonld'); if (prev) prev.remove();
    var strip = function (s) { return String(s == null ? '' : s).replace(/<[^>]*>/g, '').trim(); };
    var entities = items.map(function (f) {
      var q = isEn ? (f.question_en || f.question_he) : (f.question_he || f.question_en);
      var a = isEn ? (f.answer_en || f.answer_he) : (f.answer_he || f.answer_en);
      return { '@type': 'Question', name: strip(q), acceptedAnswer: { '@type': 'Answer', text: strip(a) } };
    }).filter(function (e) { return e.name && e.acceptedAnswer.text; });
    if (!entities.length) return;
    var data = { '@context': 'https://schema.org', '@type': 'FAQPage', inLanguage: isEn ? 'en' : 'he', mainEntity: entities };
    var s = document.createElement('script'); s.type = 'application/ld+json'; s.id = 'faq-jsonld';
    s.textContent = JSON.stringify(data); document.head.appendChild(s);
  }
  function loadJson() { fetch('/data/faq.json', { cache: 'no-cache' }).then(function (r) { return r.json(); }).then(function (d) { render((d && d.faq) || []); }).catch(function () {}); }
  (async function () {
    try {
      var cfg = await import('/js/firebase-config.js');
      if (!cfg.isConfigured) { loadJson(); return; }
      var appMod = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
      var fs = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
      var db = fs.getFirestore(appMod.initializeApp(cfg.firebaseConfig));
      var snap = await fs.getDocs(fs.query(fs.collection(db, 'faq'), fs.orderBy('order', 'asc')));
      var items = snap.docs.map(function (d) { return d.data(); });
      if (items.length) render(items); else loadJson();
    } catch (e) { loadJson(); }
  })();
})();
