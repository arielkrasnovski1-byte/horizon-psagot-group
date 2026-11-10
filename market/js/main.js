/* ============================================================
   HORIZON MARKETS — main.js
   תפריט נייד, מצב גלילה ל-header, אנימציית חשיפה
   ============================================================ */
(function () {
  'use strict';

  /* --- תפריט נייד --- */
  var toggle = document.querySelector('.menu-toggle');
  var nav = document.querySelector('.site-nav');

  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      toggle.classList.toggle('is-active', open);
      toggle.setAttribute('aria-expanded', String(open));
      nav.setAttribute('aria-hidden', String(!open));
      document.body.style.overflow = open ? 'hidden' : '';
    });

    // סגירה בלחיצה על קישור ניווט
    nav.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        if (nav.classList.contains('is-open')) {
          nav.classList.remove('is-open');
          toggle.classList.remove('is-active');
          toggle.setAttribute('aria-expanded', 'false');
          document.body.style.overflow = '';
        }
      });
    });
  }

  /* --- מצב גלילה ל-header --- */
  var header = document.querySelector('.site-header');
  if (header) {
    var onScroll = function () {
      header.classList.toggle('is-scrolled', window.scrollY > 8);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* --- אנימציית חשיפה בגלילה --- */
  var revealEls = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && revealEls.length) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add('is-visible'); });
  }

  /* --- שנה שוטף בפוטר --- */
  var yearEl = document.getElementById('current-year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();
})();
