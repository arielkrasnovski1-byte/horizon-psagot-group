/* ============================================================
   ANIMATIONS.JS - אנימציות בגלילה (Intersection Observer)
   ============================================================
   מזהה אלמנטים עם class="reveal" / "reveal-right" / "reveal-left" / "reveal-scale"
   ומפעיל אנימציה כשהם נכנסים לחלון התצוגה.
   ============================================================ */

(function initRevealOnScroll() {
  const items = document.querySelectorAll('.reveal, .reveal-right, .reveal-left, .reveal-scale');
  if (items.length === 0) return;

  // אם הדפדפן לא תומך ב-IntersectionObserver או שהמשתמש העדיף ללא תנועה - מציג הכל מיד
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (!('IntersectionObserver' in window) || prefersReducedMotion) {
    items.forEach((el) => el.classList.add('is-visible'));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    },
    {
      threshold: 0.12,
      rootMargin: '0px 0px -60px 0px',
    }
  );

  items.forEach((el) => observer.observe(el));
})();
