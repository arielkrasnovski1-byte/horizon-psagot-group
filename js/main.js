/* ============================================================
   MAIN.JS - אינטראקציות גלובליות (תפריט, ניווט)
   ============================================================ */


/* === 1. Mobile menu toggle === */
(function initMenuToggle() {
  const toggle = document.querySelector('.menu-toggle');
  const nav = document.querySelector('.site-nav');
  if (!toggle || !nav) return;

  const closeMenu = () => {
    toggle.setAttribute('aria-expanded', 'false');
    nav.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  };

  toggle.addEventListener('click', () => {
    const isOpen = toggle.getAttribute('aria-expanded') === 'true';
    if (isOpen) {
      closeMenu();
    } else {
      toggle.setAttribute('aria-expanded', 'true');
      nav.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
    }
  });

  // סגירה בלחיצה על קישור בתפריט
  nav.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', closeMenu);
  });

  // סגירה ב-Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
      closeMenu();
      toggle.focus();
    }
  });
})();


/* === 2. Header shrink on scroll === */
(function initHeaderScroll() {
  const header = document.querySelector('.site-header');
  if (!header) return;

  let ticking = false;

  const update = () => {
    if (window.scrollY > 30) {
      header.classList.add('is-scrolled');
    } else {
      header.classList.remove('is-scrolled');
    }
    ticking = false;
  };

  window.addEventListener('scroll', () => {
    if (!ticking) {
      window.requestAnimationFrame(update);
      ticking = true;
    }
  }, { passive: true });

  update();
})();


/* === 3. Smooth scroll לקישורי עוגן === */
(function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener('click', (e) => {
      const href = link.getAttribute('href');
      if (!href || href === '#') return;

      const target = document.querySelector(href);
      if (!target) return;

      e.preventDefault();
      const headerHeight = document.querySelector('.site-header')?.offsetHeight || 0;
      const targetY = target.getBoundingClientRect().top + window.scrollY - headerHeight - 16;

      window.scrollTo({ top: targetY, behavior: 'smooth' });
    });
  });
})();


/* === 4. Auto-update year בפוטר === */
(function setFooterYear() {
  const el = document.querySelector('[data-current-year]');
  if (el) el.textContent = new Date().getFullYear();
})();


/* === 5. Testimonials carousel === */
(function initCarousels() {
  document.querySelectorAll('.testimonials-carousel').forEach((carousel) => {
    const track = carousel.querySelector('.testimonials-track');
    const prevBtn = carousel.querySelector('[data-carousel-prev]');
    const nextBtn = carousel.querySelector('[data-carousel-next]');
    if (!track) return;

    const getScrollAmount = () => {
      const firstCard = track.querySelector('.testimonial-card');
      if (!firstCard) return 400;
      const gap = parseFloat(getComputedStyle(track).columnGap) || 24;
      return firstCard.offsetWidth + gap;
    };

    // ב-RTL: scrollLeft שלילי = התקדמות שמאלה (קדימה בכיוון הקריאה),
    // חיובי = חזרה ימינה (אחורה). לכן "הבא" שלילי ו"הקודם" חיובי.
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        track.scrollBy({ left: -getScrollAmount(), behavior: 'smooth' });
      });
    }
    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        track.scrollBy({ left: getScrollAmount(), behavior: 'smooth' });
      });
    }
  });
})();
