/* ============================================================
   ACCESSIBILITY WIDGET — תקן ישראלי 5568 / WCAG 2.0 AA
   ============================================================
   כפתור צף + פאנל שמספק:
   - הגדלת טקסט (3 רמות)
   - ניגודיות גבוהה / הפוכה
   - הדגשת קישורים
   - ביטול אנימציות
   - פונט קריא (לדיסלקסיה)
   - סמן גדול
   - איפוס הגדרות
   - קישור להצהרת הנגישות
   ============================================================ */

(function () {
  'use strict';

  const STORAGE_KEY = 'hp_a11y_settings';
  const isEnglish = document.documentElement.lang === 'en';

  // ===== Texts (HE / EN) =====
  const t = isEnglish ? {
    toggleLabel: 'Accessibility menu',
    title: 'Accessibility Settings',
    fontSize: 'Text size',
    large: 'Large', larger: 'X-Large', largest: 'XX-Large',
    contrast: 'Contrast',
    highContrast: 'High', invert: 'Inverted',
    moreOptions: 'More options',
    highlightLinks: 'Highlight links',
    noMotion: 'Stop animations',
    readableFont: 'Readable font',
    bigCursor: 'Large cursor',
    reset: 'Reset settings',
    statementLink: 'Full accessibility statement',
    statementHref: '/accessibility/',
  } : {
    toggleLabel: 'תפריט נגישות',
    title: 'הגדרות נגישות',
    fontSize: 'גודל טקסט',
    large: 'גדול', larger: 'גדול מאוד', largest: 'ענק',
    contrast: 'ניגודיות',
    highContrast: 'גבוהה', invert: 'הפוכה',
    moreOptions: 'אפשרויות נוספות',
    highlightLinks: 'הדגשת קישורים',
    noMotion: 'ביטול אנימציות',
    readableFont: 'פונט קריא',
    bigCursor: 'סמן גדול',
    reset: 'איפוס הגדרות',
    statementLink: 'להצהרת הנגישות המלאה',
    statementHref: '/accessibility/',
  };

  // ===== Load saved settings =====
  let settings;
  try {
    settings = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch (e) {
    settings = {};
  }
  if (!settings.toggles) settings.toggles = [];

  // ===== Inject CSS =====
  const css = `
    /* === Toggle button === */
    .a11y-toggle {
      position: fixed;
      bottom: 24px;
      inset-inline-end: 24px;
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: #0A4DA6;
      color: #fff;
      border: 3px solid #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      box-shadow: 0 6px 20px rgba(10, 77, 166, 0.45);
      z-index: 9998;
      transition: transform 0.2s, box-shadow 0.2s;
      padding: 0;
      font-family: inherit;
    }
    .a11y-toggle:hover {
      transform: scale(1.08);
      box-shadow: 0 8px 24px rgba(10, 77, 166, 0.6);
    }
    .a11y-toggle:focus-visible {
      outline: 3px solid #FFD700;
      outline-offset: 4px;
    }
    .a11y-toggle svg { width: 30px; height: 30px; }

    /* === Panel === */
    .a11y-panel {
      position: fixed;
      bottom: 92px;
      inset-inline-end: 24px;
      width: min(340px, calc(100vw - 32px));
      background: #fff;
      color: #2B2B2B;
      border-radius: 16px;
      box-shadow: 0 16px 48px rgba(0, 0, 0, 0.25);
      padding: 20px;
      z-index: 9999;
      max-height: calc(100vh - 130px);
      overflow-y: auto;
      transform-origin: bottom right;
      transform: scale(0.85) translateY(10px);
      opacity: 0;
      transition: transform 0.25s ease, opacity 0.2s ease;
      pointer-events: none;
      font-family: var(--font-body, Assistant, sans-serif);
      direction: ${isEnglish ? 'ltr' : 'rtl'};
      text-align: ${isEnglish ? 'left' : 'right'};
    }
    .a11y-panel[aria-hidden="false"] {
      transform: scale(1) translateY(0);
      opacity: 1;
      pointer-events: auto;
    }
    .a11y-panel h2 {
      font-size: 18px;
      font-weight: 700;
      margin: 0 0 16px;
      color: #0A1F3D;
      font-family: inherit;
    }
    .a11y-section { margin-bottom: 16px; }
    .a11y-section h3 {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: #666;
      margin: 0 0 8px;
      font-weight: 700;
      font-family: inherit;
    }
    .a11y-buttons {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 6px;
    }
    .a11y-buttons.two { grid-template-columns: 1fr 1fr; }
    .a11y-btn {
      padding: 10px 6px;
      border: 1.5px solid #ddd;
      background: #fff;
      border-radius: 8px;
      cursor: pointer;
      font-size: 13px;
      color: #2B2B2B;
      transition: all 0.15s;
      font-family: inherit;
      font-weight: 500;
      line-height: 1.2;
    }
    .a11y-btn:hover { border-color: #0A4DA6; background: #f0f6ff; }
    .a11y-btn:focus-visible { outline: 2px solid #0A4DA6; outline-offset: 2px; }
    .a11y-btn.is-active {
      background: #0A4DA6;
      color: #fff;
      border-color: #0A4DA6;
      font-weight: 700;
    }
    .a11y-reset {
      width: 100%;
      padding: 10px;
      background: #B94A48;
      color: #fff;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
      margin-top: 8px;
      font-family: inherit;
    }
    .a11y-reset:hover { background: #9c3d3b; }
    .a11y-reset:focus-visible { outline: 3px solid #FFD700; outline-offset: 2px; }
    .a11y-link {
      display: block;
      text-align: center;
      padding: 10px 8px;
      color: #0A4DA6;
      font-size: 13px;
      margin-top: 8px;
      text-decoration: underline;
      border-radius: 6px;
    }
    .a11y-link:hover { background: #f0f6ff; color: #083d85; }

    /* === The accessibility modifications themselves === */
    html.a11y-font-large { font-size: 19px !important; }
    html.a11y-font-larger { font-size: 22px !important; }
    html.a11y-font-largest { font-size: 26px !important; }

    html.a11y-contrast-high body { filter: contrast(1.4) saturate(1.3); }
    html.a11y-contrast-high .a11y-panel,
    html.a11y-contrast-high .a11y-toggle { filter: none; }

    html.a11y-contrast-invert body { filter: invert(1) hue-rotate(180deg); }
    html.a11y-contrast-invert img,
    html.a11y-contrast-invert video,
    html.a11y-contrast-invert .a11y-panel,
    html.a11y-contrast-invert .a11y-toggle {
      filter: invert(1) hue-rotate(180deg);
    }

    html.a11y-links a:not(.a11y-link):not(.a11y-btn) {
      text-decoration: underline !important;
      text-decoration-thickness: 2px !important;
      text-underline-offset: 2px !important;
      font-weight: 700 !important;
      color: #0A4DA6 !important;
    }
    html.a11y-links .skip-link { color: var(--color-cream) !important; }

    html.a11y-no-motion *,
    html.a11y-no-motion *::before,
    html.a11y-no-motion *::after {
      animation-duration: 0.001ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.001ms !important;
      scroll-behavior: auto !important;
    }

    html.a11y-readable body,
    html.a11y-readable body * {
      font-family: Arial, Helvetica, sans-serif !important;
      letter-spacing: 0.02em !important;
      word-spacing: 0.08em !important;
    }

    html.a11y-cursor-large,
    html.a11y-cursor-large * {
      cursor: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 24 24'><path d='M3 2 L3 18 L8.5 14 L11.5 22 L14.5 21 L11.5 13 L18 13 Z' fill='black' stroke='white' stroke-width='1.2' stroke-linejoin='round'/></svg>") 3 2, auto !important;
    }
  `;

  const styleEl = document.createElement('style');
  styleEl.id = 'a11y-widget-styles';
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // ===== Build toggle button =====
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'a11y-toggle';
  toggle.setAttribute('aria-label', t.toggleLabel);
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'a11y-panel');
  toggle.innerHTML =
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
    '<circle cx="12" cy="3.5" r="2"/>' +
    '<path d="M5 8.5h14v2h-5v12h-2v-7.5h-2v7.5h-2v-12H5z"/>' +
    '</svg>';

  // ===== Build panel =====
  const panel = document.createElement('div');
  panel.id = 'a11y-panel';
  panel.className = 'a11y-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', t.title);
  panel.setAttribute('aria-hidden', 'true');
  panel.innerHTML = `
    <h2>${t.title}</h2>
    <div class="a11y-section">
      <h3>${t.fontSize}</h3>
      <div class="a11y-buttons">
        <button type="button" class="a11y-btn" data-action="font" data-value="large">${t.large}</button>
        <button type="button" class="a11y-btn" data-action="font" data-value="larger">${t.larger}</button>
        <button type="button" class="a11y-btn" data-action="font" data-value="largest">${t.largest}</button>
      </div>
    </div>
    <div class="a11y-section">
      <h3>${t.contrast}</h3>
      <div class="a11y-buttons two">
        <button type="button" class="a11y-btn" data-action="contrast" data-value="high">${t.highContrast}</button>
        <button type="button" class="a11y-btn" data-action="contrast" data-value="invert">${t.invert}</button>
      </div>
    </div>
    <div class="a11y-section">
      <h3>${t.moreOptions}</h3>
      <div class="a11y-buttons two">
        <button type="button" class="a11y-btn" data-action="toggle" data-class="a11y-links">${t.highlightLinks}</button>
        <button type="button" class="a11y-btn" data-action="toggle" data-class="a11y-no-motion">${t.noMotion}</button>
        <button type="button" class="a11y-btn" data-action="toggle" data-class="a11y-readable">${t.readableFont}</button>
        <button type="button" class="a11y-btn" data-action="toggle" data-class="a11y-cursor-large">${t.bigCursor}</button>
      </div>
    </div>
    <button type="button" class="a11y-reset">${t.reset}</button>
    <a class="a11y-link" href="${t.statementHref}">${t.statementLink}</a>
  `;

  // Inject into DOM
  document.body.appendChild(toggle);
  document.body.appendChild(panel);

  // ===== Apply settings to the page =====
  function apply() {
    const html = document.documentElement;
    // Remove all a11y classes
    Array.from(html.classList).forEach(function (c) {
      if (c.indexOf('a11y-') === 0) html.classList.remove(c);
    });
    if (settings.font) html.classList.add('a11y-font-' + settings.font);
    if (settings.contrast) html.classList.add('a11y-contrast-' + settings.contrast);
    settings.toggles.forEach(function (c) { html.classList.add(c); });

    // Sync button states
    panel.querySelectorAll('.a11y-btn').forEach(function (btn) {
      const action = btn.dataset.action;
      if (action === 'font') {
        btn.classList.toggle('is-active', settings.font === btn.dataset.value);
      } else if (action === 'contrast') {
        btn.classList.toggle('is-active', settings.contrast === btn.dataset.value);
      } else if (action === 'toggle') {
        btn.classList.toggle('is-active', settings.toggles.indexOf(btn.dataset.class) >= 0);
      }
    });
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); }
    catch (e) { /* private mode etc — silent */ }
  }

  apply();

  // ===== Panel open/close =====
  function open() {
    panel.setAttribute('aria-hidden', 'false');
    toggle.setAttribute('aria-expanded', 'true');
  }
  function close() {
    panel.setAttribute('aria-hidden', 'true');
    toggle.setAttribute('aria-expanded', 'false');
  }

  toggle.addEventListener('click', function () {
    const isOpen = panel.getAttribute('aria-hidden') === 'false';
    isOpen ? close() : open();
  });

  document.addEventListener('click', function (e) {
    if (!panel.contains(e.target) && !toggle.contains(e.target)) close();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && panel.getAttribute('aria-hidden') === 'false') {
      close();
      toggle.focus();
    }
  });

  // ===== Button actions =====
  panel.querySelectorAll('.a11y-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const action = btn.dataset.action;
      if (action === 'font') {
        settings.font = settings.font === btn.dataset.value ? null : btn.dataset.value;
      } else if (action === 'contrast') {
        settings.contrast = settings.contrast === btn.dataset.value ? null : btn.dataset.value;
      } else if (action === 'toggle') {
        const cls = btn.dataset.class;
        const idx = settings.toggles.indexOf(cls);
        if (idx >= 0) settings.toggles.splice(idx, 1);
        else settings.toggles.push(cls);
      }
      save();
      apply();
    });
  });

  // Reset
  panel.querySelector('.a11y-reset').addEventListener('click', function () {
    settings = { toggles: [] };
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* silent */ }
    apply();
  });
})();
