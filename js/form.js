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
    field.addEventListener('input', () => clearError(field));
    field.addEventListener('change', () => clearError(field));
  });

  // טקסטים לפי שפת העמוד (עברית / אנגלית)
  const isEnglish = document.documentElement.lang === 'en';
  const t = {
    required: isEnglish ? 'Required field' : 'שדה חובה',
    email: isEnglish ? 'Invalid email' : 'אימייל לא תקין',
    phone: isEnglish ? 'Invalid phone number' : 'טלפון לא תקין (לפחות 9 ספרות)',
    sending: isEnglish ? 'Sending...' : 'שולח...',
    error: isEnglish
      ? 'Something went wrong. Please try again, or contact us by phone or WhatsApp.'
      : 'אירעה שגיאה בשליחה. נסו שוב, או צרו קשר בטלפון או בוואטסאפ.',
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    let isValid = true;
    let firstError = null;

    // בדיקת שדות חובה
    form.querySelectorAll('[required]').forEach((field) => {
      const value = (field.value || '').trim();
      const isCheckbox = field.type === 'checkbox';
      const empty = isCheckbox ? !field.checked : !value;

      if (empty) {
        showError(field, t.required);
        isValid = false;
        if (!firstError) firstError = field;
      }
    });

    // בדיקת אימייל
    const emailField = form.querySelector('[type="email"]');
    if (emailField && emailField.value.trim()) {
      const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRe.test(emailField.value.trim())) {
        showError(emailField, t.email);
        isValid = false;
        if (!firstError) firstError = emailField;
      }
    }

    // בדיקת טלפון - לפחות 9 ספרות
    const phoneField = form.querySelector('[type="tel"]');
    if (phoneField && phoneField.value.trim()) {
      const digitsOnly = phoneField.value.replace(/\D/g, '');
      if (digitsOnly.length < 9) {
        showError(phoneField, t.phone);
        isValid = false;
        if (!firstError) firstError = phoneField;
      }
    }

    if (!isValid) {
      if (firstError) firstError.focus();
      return;
    }

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
