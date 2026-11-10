/* ============================================================
   HORIZON MARKETS — fx.js
   אפקט זרקור על כרטיסים + פרלקסה עדינה לרקע
   ============================================================ */
(function () {
  'use strict';

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* --- זרקור שעוקב אחרי העכבר --- */
  var cards = document.querySelectorAll('.spotlight');
  cards.forEach(function (card) {
    card.addEventListener('pointermove', function (e) {
      var r = card.getBoundingClientRect();
      card.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      card.style.setProperty('--my', (e.clientY - r.top) + 'px');
    });
  });

  /* --- פרלקסה עדינה של אורות הרקע ביחס לגלילה --- */
  if (!reduce) {
    var orbs = document.querySelectorAll('.bg-fx .orb');
    var ticking = false;
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(function () {
        var y = window.scrollY;
        orbs.forEach(function (orb, i) {
          var speed = (i + 1) * 0.03;
          orb.style.marginTop = (y * speed) + 'px';
        });
        ticking = false;
      });
    }, { passive: true });
  }
})();
