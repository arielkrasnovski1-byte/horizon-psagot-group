/* ============================================================
   analytics.js — Google Analytics 4 (G-49Y3FBJ101)
   ------------------------------------------------------------
   נטען בעמודי האתר הציבוריים בלבד. הממשקים הפנימיים
   (/crm, /portal, /admin) אינם נמדדים — אין ערך במדידת הצוות
   והלקוחות המחוברים, ואין סיבה לשלוח את הניווט שלהם לגוגל.
   מלבד צפיות בעמודים נמדדים אירועי יצירת קשר: וואטסאפ,
   טלפון, מייל ושליחת טופס (generate_lead, מתוך form.js).
   ============================================================ */
(function () {
  var ID = 'G-49Y3FBJ101';       // Google Analytics 4
  var ADS = 'AW-18392878388';    // Google Ads — אותו gtag.js משרת את שניהם
  if (/^\/(crm|portal|admin)(\/|$)/.test(location.pathname)) return;

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;

  gtag('js', new Date());
  gtag('config', ID, { anonymize_ip: true });
  gtag('config', ADS);           // מעקב המרות ורימרקטינג ל-Google Ads

  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + ID;
  document.head.appendChild(s);

  /* ---- המרות Google Ads ----
     כל פעולת המרה ב-Ads מקבלת "תווית" בצורה AW-18392878388/xxxxxxxx.
     ממלאים כאן ומרגע זה האירוע נשלח גם כהמרה ל-Ads. ריק = לא נשלח. */
  var ADS_CONVERSIONS = {
    lead: '',        // שליחת טופס יצירת קשר
    whatsapp: '',    // לחיצה על וואטסאפ
    phone: '',       // לחיצה על טלפון
  };
  window.adsConversion = function (name) {
    var label = ADS_CONVERSIONS[name];
    if (label) gtag('event', 'conversion', { send_to: label });
  };

  /* ---- אירועי יצירת קשר ---- */
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var href = a.getAttribute('href') || '';
    var where = { link_location: location.pathname, link_text: (a.textContent || '').trim().slice(0, 60) };
    if (href.indexOf('wa.me') > -1) { gtag('event', 'whatsapp_click', where); window.adsConversion('whatsapp'); }
    else if (href.indexOf('tel:') === 0) { gtag('event', 'phone_click', where); window.adsConversion('phone'); }
    else if (href.indexOf('mailto:') === 0) gtag('event', 'email_click', where);
  }, { passive: true });
})();
