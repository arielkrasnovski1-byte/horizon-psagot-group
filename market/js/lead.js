/* Horizon Market — טופס יצירת קשר: מייל (Web3Forms) + ליד ל-Desk (Firestore) */
(function () {
  var form = document.querySelector('form.contact-form');
  if (!form) return;
  var isEn = document.documentElement.lang === 'en';
  var T = {
    phone: isEn ? 'Please enter a valid phone number.' : 'נא להזין מספר טלפון תקין.',
    sending: isEn ? 'Sending...' : 'שולח...',
    okTitle: isEn ? 'Thank you — we got it.' : 'תודה — הפרטים התקבלו.',
    okText: isEn ? 'We will get back to you shortly.' : 'נחזור אליכם בהקדם.',
    error: isEn ? 'Something went wrong. Please try again or contact us on WhatsApp.' : 'אירעה שגיאה בשליחה. נסו שוב, או פנו אלינו בוואטסאפ.',
  };
  function val(id) { var el = form.querySelector('#' + id); return el ? (el.value || '').trim() : ''; }
  function validPhone(raw) {
    var d = (raw || '').replace(/\D/g, '');
    if (d.indexOf('972') === 0) d = '0' + d.slice(3);
    return isEn ? d.length >= 7 : /^0(5\d{8}|7\d{8}|[2-489]\d{7})$/.test(d);
  }
  async function toDesk() {
    try {
      var cfg = await import('/js/firebase-config.js');
      if (!cfg.isConfigured) return;
      var mods = await Promise.all([
        import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js'),
        import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js'),
      ]);
      var db = mods[1].getFirestore(mods[0].initializeApp(cfg.firebaseConfig, 'market'));
      var interest = val('interest');
      await mods[1].addDoc(mods[1].collection(db, 'leads'), {
        name: val('name'), phone: val('phone'), email: val('email'),
        audience: '', topic: 'הורייזון מרקט' + (interest ? ' — ' + interest : ''), hasAsset: '',
        message: val('message'),
        source: 'website', status: 'new', notes: '',
        lang: isEn ? 'en' : 'he',
        createdAt: mods[1].serverTimestamp(),
      });
    } catch (err) { if (window.console) console.warn('Desk capture skipped:', err); }
  }
  form.onsubmit = null;
  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    if (form.querySelector('[name="bot-field"]').value) return;
    if (!form.reportValidity()) return;
    var phoneEl = form.querySelector('#phone');
    if (!validPhone(phoneEl.value)) { phoneEl.setCustomValidity(T.phone); phoneEl.reportValidity(); phoneEl.oninput = function () { phoneEl.setCustomValidity(''); }; return; }
    var btn = form.querySelector('button[type="submit"]');
    var label = btn.textContent; btn.disabled = true; btn.textContent = T.sending;
    try {
      var fd = new FormData();
      fd.append('access_key', '2ac246b9-2132-4601-a985-38868169ffb3');
      fd.append('subject', 'ליד חדש — הורייזון מרקט (מניות / קריפטו)');
      fd.append('name', val('name'));
      fd.append('טלפון', val('phone'));
      fd.append('email', val('email'));
      fd.append('תחום עניין', val('interest'));
      fd.append('message', val('message'));
      var res = await fetch('https://api.web3forms.com/submit', { method: 'POST', headers: { Accept: 'application/json' }, body: fd });
      var data = await res.json();
      if (!data.success) throw new Error(data.message || 'failed');
      toDesk();
      if (window.gtag) window.gtag('event', 'generate_lead', { form_location: location.pathname });
      form.innerHTML = '<div role="alert" style="text-align:center;padding:2.5rem 1rem"><h3 style="margin:0 0 .5rem">' + T.okTitle + '</h3><p style="margin:0">' + T.okText + '</p></div>';
    } catch (err) {
      btn.disabled = false; btn.textContent = label;
      window.alert(T.error);
    }
  });
})();
