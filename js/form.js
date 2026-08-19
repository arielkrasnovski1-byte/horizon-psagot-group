/* ============================================================
   FORM.JS - אימות טופס יצירת קשר
   ============================================================ */

(function initContactForm() {
  const formWrap = document.querySelector('.contact-form');
  if (!formWrap) return;

  const form = formWrap.querySelector('form');
  if (!form) return;

  const showError = (field, msg) => {
    const wrapper = field.closest('.form-field');
    if (!wrapper) return;
    wrapper.classList.add('has-error');
    const errEl = wrapper.querySelector('.form-error');
    if (errEl && msg) errEl.textContent = msg;
  };

  const clearError = (field) => {
    const wrapper = field.closest('.form-field');
    if (wrapper) wrapper.classList.remove('has-error');
  };

  // ניקוי שגיאה בעת הקלדה
  form.querySelectorAll('input, textarea, select').forEach((field) => {
    const clear = () => { clearError(field); const box = form.querySelector('.form-summary'); if (box) box.remove(); };
    field.addEventListener('input', clear);
    field.addEventListener('change', clear);
  });

  // טקסטים לפי שפת העמוד (עברית / אנגלית)
  const isEnglish = document.documentElement.lang === 'en';
  const t = {
    required: isEnglish ? 'Required' : 'שדה חובה',
    email: isEnglish ? 'The email address is invalid' : 'כתובת האימייל אינה תקינה',
    phone: isEnglish ? 'The phone number is invalid' : 'מספר הטלפון אינו תקין',
    fixTitle: isEnglish ? 'Please complete the following before sending:' : 'יש להשלים את הפרטים הבאים לפני שליחה:',
    missingPrefix: isEnglish ? 'Missing: ' : 'חסר: ',
    sending: isEnglish ? 'Sending...' : 'שולח...',
    error: isEnglish
      ? 'Something went wrong. Please try again, or contact us by phone or WhatsApp.'
      : 'אירעה שגיאה בשליחה. נסו שוב, או צרו קשר בטלפון או בוואטסאפ.',
  };

  // שם קריא לכל שדה (לסיכום מה חסר)
  const shortLabel = isEnglish
    ? { name: 'Full name', phone: 'Phone', asset: 'Do you own real estate', message: 'Details', consent: 'Consent' }
    : { name: 'שם מלא', phone: 'טלפון', asset: 'האם ברשותך נכס נדל"ן', message: 'פירוט הפנייה', consent: 'אישור קבלת פנייה' };
  function fieldLabel(field) {
    if (shortLabel[field.id]) return shortLabel[field.id];
    const wrap = field.closest('.form-field');
    const lbl = wrap && wrap.querySelector('label');
    return lbl ? lbl.textContent.replace(/\*/g, '').trim() : (field.name || '');
  }
  // בדיקת מספר טלפון ישראלי תקין (נייד/קווי, כולל +972)
  function isValidPhone(raw) {
    let d = (raw || '').replace(/\D/g, '');
    if (d.indexOf('972') === 0) d = '0' + d.slice(3);
    return /^0(5\d{8}|7\d{8}|[2-489]\d{7})$/.test(d);   // נייד/VoIP=10 ספרות, קווי=9
  }
  // הצגת סיכום שגיאות מעל כפתור השליחה
  function renderSummary(problems) {
    let box = form.querySelector('.form-summary');
    if (!problems.length) { if (box) box.remove(); return; }
    if (!box) {
      box = document.createElement('div');
      box.className = 'form-summary';
      const btn = form.querySelector('.form-submit');
      if (btn && btn.parentNode) btn.parentNode.insertBefore(box, btn);
    }
    box.innerHTML = '<strong>' + t.fixTitle + '</strong><ul>' + problems.map((p) => '<li>' + p + '</li>').join('') + '</ul>';
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // כתיבת הפנייה ל-CRM (Firestore) — לא חוסמת; נכשלת בשקט אם Firebase לא מוגדר
  async function captureToCRM() {
    try {
      const cfg = await import('/js/firebase-config.js');
      if (!cfg.isConfigured) return;
      const [{ initializeApp }, { getFirestore, collection, addDoc, serverTimestamp }] = await Promise.all([
        import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js'),
        import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js'),
      ]);
      const app = initializeApp(cfg.firebaseConfig);
      const db = getFirestore(app);
      const v = (id) => { const el = form.querySelector('#' + id); return el ? (el.value || '').trim() : ''; };
      await addDoc(collection(db, 'leads'), {
        name: v('name'), phone: v('phone'), email: v('email'),
        audience: v('audience'), topic: v('topic'), hasAsset: v('asset'),
        message: v('message'),
        source: 'website', status: 'new', notes: '',
        lang: document.documentElement.lang === 'en' ? 'en' : 'he',
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      if (window.console) console.warn('CRM capture skipped:', err);
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    let firstError = null;
    const missing = [];
    const problems = [];

    // שדות חובה — אוספים את מה שחסר לפי השם
    form.querySelectorAll('[required]').forEach((field) => {
      const empty = field.type === 'checkbox' ? !field.checked : !(field.value || '').trim();
      if (empty) {
        showError(field, t.required);
        missing.push(fieldLabel(field));
        if (!firstError) firstError = field;
      }
    });
    if (missing.length) problems.push(t.missingPrefix + missing.join(', '));

    // בדיקת אימייל (אם מולא)
    const emailField = form.querySelector('[type="email"]');
    if (emailField && emailField.value.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailField.value.trim())) {
      showError(emailField, t.email);
      problems.push(t.email);
      if (!firstError) firstError = emailField;
    }

    // בדיקת טלפון תקין (אם מולא)
    const phoneField = form.querySelector('[type="tel"]');
    if (phoneField && phoneField.value.trim() && !isValidPhone(phoneField.value)) {
      showError(phoneField, t.phone);
      problems.push(t.phone);
      if (!firstError) firstError = phoneField;
    }

    if (problems.length) {
      renderSummary(problems);
      if (firstError) firstError.focus();
      return;
    }
    renderSummary([]);   // ניקוי הסיכום אם הכל תקין

    // שליחה אמיתית ל-Web3Forms
    const submitBtn = form.querySelector('.form-submit');
    const originalLabel = submitBtn ? submitBtn.textContent : '';
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = t.sending;
    }

    try {
      const response = await fetch('https://api.web3forms.com/submit', {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: new FormData(form),
      });
      const data = await response.json();

      if (data.success) {
        captureToCRM();               // כתיבה ל-CRM (לא חוסמת — לא מפריעה למייל)
        if (window.gtag) window.gtag('event', 'generate_lead', { form_location: location.pathname });
        if (window.adsConversion) window.adsConversion('lead');   // המרה ל-Google Ads
        formWrap.classList.add('is-submitted');
        formWrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        throw new Error(data.message || 'submission failed');
      }
    } catch (err) {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalLabel;
      }
      window.alert(t.error);
    }
  });
})();
