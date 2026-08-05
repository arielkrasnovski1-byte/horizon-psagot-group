/* ============================================================
   deals.js — טוען עסקאות לדוגמה מ-data/deals.json ומצייר כרטיסים
   נטען בעמוד /deals/ ו-/en/deals/. תומך עברית ואנגלית לפי <html lang>.
   ============================================================ */
(function () {
  'use strict';

  var grid = document.getElementById('dealsGrid');
  if (!grid) return;

  var isEn = (document.documentElement.lang || 'he').toLowerCase().indexOf('en') === 0;

  var T = isEn
    ? { empty: 'Deals will be published here soon.', error: 'Could not load deals.', location: 'Location', scope: 'Scope' }
    : { empty: 'עסקאות יתפרסמו כאן בקרוב.', error: 'לא ניתן לטעון את העסקאות כרגע.', location: 'מיקום', scope: 'היקף' };

  function pick(deal, base) {
    return (isEn ? deal[base + '_en'] : deal[base + '_he']) || deal[base + '_he'] || deal[base + '_en'] || '';
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // חושף כרטיסים שנוספו דינמית — תואם לאנימציית הגלילה של שאר האתר
  function revealCards(items) {
    if (!items.length) return;
    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!('IntersectionObserver' in window) || reduced) {
      items.forEach(function (el) { el.classList.add('is-visible'); });
      return;
    }
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -60px 0px' });
    items.forEach(function (el) { observer.observe(el); });
  }

  function cardHTML(deal, i) {
    var title = pick(deal, 'title');
    var desc = pick(deal, 'desc');
    var category = pick(deal, 'category');
    var delay = (i % 3);

    var image = '';
    if (deal.image) {
      image = '<div class="blog-card-image"><img src="' + esc(deal.image) +
        '" alt="' + esc(title) + '" loading="lazy"></div>';
    }

    var meta = '';
    if (category || deal.year) {
      meta = '<div class="blog-card-meta">' +
        (category ? '<span class="category">' + esc(category) + '</span>' : '') +
        (deal.year ? '<span>' + esc(deal.year) + '</span>' : '') +
        '</div>';
    }

    var facts = '';
    if (deal.location || deal.amount) {
      facts = '<dl class="deal-facts">' +
        (deal.location ? '<div><dt>' + T.location + '</dt><dd>' + esc(deal.location) + '</dd></div>' : '') +
        (deal.amount ? '<div><dt>' + T.scope + '</dt><dd>' + esc(deal.amount) + '</dd></div>' : '') +
        '</dl>';
    }

    return '<article class="blog-card deal-card reveal"' + (delay ? ' data-delay="' + delay + '"' : '') + '>' +
      image +
      '<div class="blog-card-content">' +
        meta +
        '<h3>' + esc(title) + '</h3>' +
        (desc ? '<p>' + esc(desc) + '</p>' : '') +
        facts +
      '</div>' +
    '</article>';
  }

  function render(deals) {
    if (!deals || !deals.length) {
      grid.innerHTML = '<p class="deals-empty">' + T.empty + '</p>';
      grid.classList.remove('blog-grid');
      return;
    }
    grid.innerHTML = deals.map(cardHTML).join('');
    revealCards(grid.querySelectorAll('.reveal'));
  }

  function loadFromJson() {
    fetch('/data/deals.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) { render((data && data.deals) || []); })
      .catch(function (err) {
        console.error('deals.js:', err);
        grid.innerHTML = '<p class="deals-empty">' + T.error + '</p>';
        grid.classList.remove('blog-grid');
      });
  }

  // מנסה קודם את מסד הנתונים (Firestore, נערך דרך /crm), ואם אין — חוזר ל-deals.json
  (async function () {
    try {
      var cfg = await import('/js/firebase-config.js');
      if (!cfg.isConfigured) { loadFromJson(); return; }
      var appMod = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
      var fs = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
      var app = appMod.initializeApp(cfg.firebaseConfig);
      var db = fs.getFirestore(app);
      var snap = await fs.getDocs(fs.query(fs.collection(db, 'deals'), fs.orderBy('order', 'asc')));
      var deals = snap.docs.map(function (d) { return d.data(); });
      if (deals.length) render(deals);
      else loadFromJson();   // אם אין עסקאות ב-DB — משתמש בקובץ
    } catch (err) {
      console.warn('deals.js: Firestore unavailable, using json —', err);
      loadFromJson();
    }
  })();
})();
