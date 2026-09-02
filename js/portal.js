/* ============================================================
   portal.js — פורטל מסמכים ללקוחות (/portal)
   כניסה: SMS (Phone Auth) או מייל (Email-link). לאחר כניסה:
   טוען את התיק/ים של הלקוח, מציג צ'ק-ליסט, ומאפשר העלאת קבצים ל-Firebase Storage.
   ============================================================ */
import { firebaseConfig, isConfigured } from '/js/firebase-config.js';
import { serviceLabel } from '/js/case-templates.js';

(async function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const show = (el, v) => { if (el) el.hidden = !v; };
  const esc = (s) => String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  if (!isConfigured) { show($('login-view'), false); show($('setup-view'), true); return; }

  const [appMod, authMod, fsMod, stMod] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js'),
    import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js'),
    import('https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js'),
  ]);
  const app = appMod.initializeApp(firebaseConfig);
  const auth = authMod.getAuth(app);
  auth.languageCode = 'he';
  const db = fsMod.getFirestore(app);
  const storage = stMod.getStorage(app);

  const errBox = $('login-error');
  const err = (msg) => { if (errBox) errBox.textContent = msg || ''; };

  /* ---------- מעבר בין שיטות כניסה ---------- */
  document.querySelectorAll('.method-tab').forEach((t) => t.addEventListener('click', () => {
    document.querySelectorAll('.method-tab').forEach((x) => x.classList.toggle('active', x === t));
    show($('panel-sms'), t.dataset.method === 'sms');
    show($('panel-email'), t.dataset.method === 'email');
    err('');
  }));

  /* ---------- טלפון ישראלי -> E.164 ---------- */
  function toE164(raw) {
    let d = (raw || '').replace(/\D/g, '');
    if (d.indexOf('972') === 0) d = d.slice(3); else if (d.indexOf('0') === 0) d = d.slice(1);
    if (!/^\d{8,9}$/.test(d)) return null;   // נייד/קווי
    return '+972' + d;
  }

  /* ---------- תרגום שגיאות Firebase להודעה מובנת (+ קוד לאבחון) ---------- */
  const AUTH_ERRORS = {
    'auth/too-many-requests':      'יותר מדי ניסיונות מהמספר הזה. נסו שוב בעוד כמה דקות.',
    'auth/invalid-phone-number':   'מספר הטלפון אינו תקין.',
    'auth/missing-phone-number':   'לא הוזן מספר טלפון.',
    'auth/quota-exceeded':         'מכסת ההודעות היומית נוצלה. נסו מחר או פנו אלינו.',
    'auth/operation-not-allowed':  'שיטת הכניסה אינה מופעלת במערכת.',
    'auth/unauthorized-domain':    'הדומיין אינו מורשה במערכת ההתחברות.',
    'auth/invalid-app-credential': 'אימות האבטחה (reCAPTCHA) נכשל. רעננו את הדף ונסו שוב.',
    'auth/captcha-check-failed':   'אימות האבטחה (reCAPTCHA) נכשל. רעננו את הדף ונסו שוב.',
    'auth/billing-not-enabled':    'שירות ה-SMS אינו פעיל בחשבון.',
    'auth/network-request-failed': 'אין חיבור לאינטרנט יציב. נסו שוב.',
    'auth/internal-error':         'שגיאה זמנית בשירות. נסו שוב.',
  };
  function authError(e, fallback) {
    const code = (e && e.code) || '';
    const msg = AUTH_ERRORS[code];
    return msg ? msg : (fallback + (code ? ' (' + code + ')' : ''));
  }

  /* ---------- כניסה ב-SMS ---------- */
  let confirmationResult = null, recaptcha = null;
  function ensureRecaptcha() {
    if (!recaptcha) {
      recaptcha = new authMod.RecaptchaVerifier(auth, 'recaptcha-holder', { size: 'invisible' });
    }
    return recaptcha;
  }
  function resetRecaptcha() { try { if (recaptcha) recaptcha.clear(); } catch (e) {} recaptcha = null; }

  $('send-sms').addEventListener('click', async () => {
    err('');
    const phone = toE164($('phone').value);
    if (!phone) { err('מספר הטלפון אינו תקין.'); return; }
    const btn = $('send-sms'); btn.disabled = true; btn.textContent = 'שולח…';
    try {
      confirmationResult = await authMod.signInWithPhoneNumber(auth, phone, ensureRecaptcha());
      show($('sms-step-phone'), false); show($('sms-step-code'), true);
      $('otp').focus();
    } catch (e) {
      console.error('[portal] signInWithPhoneNumber נכשל:', e);
      err(authError(e, 'שליחת הקוד נכשלה.'));
      resetRecaptcha();
    } finally { btn.disabled = false; btn.textContent = 'שליחת קוד ב-SMS'; }
  });

  $('verify-otp').addEventListener('click', async () => {
    err('');
    const code = ($('otp').value || '').replace(/\D/g, '');
    if (code.length < 6 || !confirmationResult) { err('הקוד אינו תקין.'); return; }
    const btn = $('verify-otp'); btn.disabled = true; btn.textContent = 'מאמת…';
    try { await confirmationResult.confirm(code); }
    catch (e) { err('הקוד שגוי או פג תוקף. נסו שוב.'); }
    finally { btn.disabled = false; btn.textContent = 'כניסה'; }
  });

  $('sms-back').addEventListener('click', () => {
    show($('sms-step-code'), false); show($('sms-step-phone'), true); err(''); confirmationResult = null;
  });

  /* ---------- כניסה במייל (קישור) ---------- */
  const actionCodeSettings = { url: location.origin + '/portal/', handleCodeInApp: true };

  $('send-email').addEventListener('click', async () => {
    err('');
    const email = ($('email').value || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err('כתובת המייל אינה תקינה.'); return; }
    const btn = $('send-email'); btn.disabled = true; btn.textContent = 'שולח…';
    try {
      await authMod.sendSignInLinkToEmail(auth, email, actionCodeSettings);
      window.localStorage.setItem('portalEmail', email);
      show($('email-step'), false); show($('email-sent'), true);
    } catch (e) { console.error('[portal] sendSignInLinkToEmail נכשל:', e); err(authError(e, 'שליחת הקישור נכשלה.')); }
    finally { btn.disabled = false; btn.textContent = 'שליחת קישור כניסה'; }
  });
  $('email-back').addEventListener('click', () => { show($('email-sent'), false); show($('email-step'), true); err(''); });

  // השלמת כניסה אם הגענו מקישור המייל
  if (authMod.isSignInWithEmailLink(auth, location.href)) {
    let email = window.localStorage.getItem('portalEmail');
    if (!email) email = window.prompt('אשרו את כתובת המייל שאליה נשלח הקישור:');
    if (email) {
      try {
        await authMod.signInWithEmailLink(auth, email.trim().toLowerCase(), location.href);
        window.localStorage.removeItem('portalEmail');
        history.replaceState(null, '', location.pathname);
      } catch (e) { err('הקישור אינו תקף או פג תוקף. שלחו קישור חדש.'); }
    }
  }

  $('logout-btn').addEventListener('click', () => authMod.signOut(auth));

  /* ---------- מצב התחברות ---------- */
  let unsub = null;
  authMod.onAuthStateChanged(auth, (user) => {
    if (unsub) { unsub(); unsub = null; }
    if (!user) { show($('app-view'), false); show($('login-view'), true); return; }
    show($('login-view'), false); show($('app-view'), true);
    $('user-id').textContent = user.phoneNumber || user.email || '';
    loadCases(user);
  });

  /* ---------- טעינת התיקים של הלקוח ---------- */
  function loadCases(user) {
    show($('cases-loading'), true); show($('case-picker'), false); show($('case-detail'), false); show($('no-case'), false);
    const col = fsMod.collection(db, 'cases');
    let q;
    if (user.phoneNumber) q = fsMod.query(col, fsMod.where('clientPhone', '==', user.phoneNumber));
    else if (user.email) q = fsMod.query(col, fsMod.where('clientEmail', '==', user.email.toLowerCase()));
    else { show($('cases-loading'), false); show($('no-case'), true); return; }

    unsub = fsMod.onSnapshot(q, (snap) => {
      const cases = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
      show($('cases-loading'), false);
      if (!cases.length) { show($('case-picker'), false); show($('case-detail'), false); show($('no-case'), true); return; }
      show($('no-case'), false);
      if (cases.length === 1) { renderCase(cases[0]); }
      else { renderPicker(cases); }
    }, (e) => {
      show($('cases-loading'), false); show($('no-case'), true);
      if (window.console) console.warn('cases load error', e);
    });
  }

  /* ---------- בחירת תיק (כשיש כמה) ---------- */
  function renderPicker(cases) {
    show($('case-detail'), false); show($('case-picker'), true);
    $('case-picker').innerHTML = '<h2 class="picker-h">התיקים שלך</h2>' + cases.map((c, i) =>
      '<button class="case-pick" data-i="' + i + '"><b>' + esc(serviceLabel(c.serviceType)) + '</b>' +
      '<span>' + pct(c) + '% הושלם</span></button>').join('');
    $('case-picker').querySelectorAll('.case-pick').forEach((b) =>
      b.addEventListener('click', () => { show($('case-picker'), false); renderCase(cases[+b.dataset.i]); }));
  }

  function pct(c) {
    const items = visibleItems(c);
    if (!items.length) return 0;
    const done = items.filter((it) => it.status === 'received').length;
    return Math.round((done / items.length) * 100);
  }
  function visibleItems(c) {
    return (c.items || []).filter((it) => it.stage === 1 || c.stage2Open);
  }

  /* ---------- תצוגת תיק + צ'ק-ליסט ---------- */
  function renderCase(c) {
    show($('case-picker'), false); show($('case-detail'), true);
    const items = visibleItems(c);
    const s1 = items.filter((it) => it.stage === 1);
    const s2 = items.filter((it) => it.stage === 2);
    const p = pct(c);

    let html = '<div class="case-head">' +
      '<div><h2>' + esc(serviceLabel(c.serviceType)) + '</h2>' +
      (c.clientName ? '<p class="case-sub">שלום ' + esc(c.clientName) + ' 👋</p>' : '') + '</div></div>' +
      '<div class="progress-wrap"><div class="progress-bar"><span style="width:' + p + '%"></span></div>' +
      '<div class="progress-label">' + p + '% מהמסמכים הועלו</div></div>';

    if (c.status === 'closed') {
      html += '<div class="case-closed-note"><b>התיק הושלם וסגור.</b> ' +
        'המסמכים שמורים אצלנו ואין צורך בפעולה נוספת. לשאלות — <a href="/contact/">צרו קשר</a>.</div>';
    }

    html += '<section class="doc-group"><h3>מסמכים נדרשים</h3>' + s1.map((it) => itemRow(c, it)).join('') + '</section>';
    if (c.stage2Open && s2.length) {
      html += '<section class="doc-group stage2"><h3>שלב נוסף — מסמכים משלימים</h3>' + s2.map((it) => itemRow(c, it)).join('') + '</section>';
    }
    html += doneBox(c);
    html += '<p class="case-foot">כל המסמכים נשמרים באופן מאובטח ומוצפן. לשאלות — <a href="/contact/">צרו קשר</a>.</p>';
    $('case-detail').innerHTML = html;

    // חיווט העלאות + החלפות + כפתור סיום
    $('case-detail').querySelectorAll('input[type=file]').forEach((inp) => {
      inp.addEventListener('change', () => {
        if (!inp.files || !inp.files.length) return;
        if (inp.dataset.swapKey !== undefined) {
          const idx = (c.items || []).findIndex((x) => x.key === inp.dataset.swapKey);
          if (idx >= 0) replaceFile(c, idx, +inp.dataset.swapFi, inp.files[0]);
          return;
        }
        const idx = (c.items || []).findIndex((x) => x.key === inp.dataset.key);
        if (idx >= 0) uploadFiles(c, idx, Array.from(inp.files));
      });
    });
    const doneBtn = $('client-done-btn');
    if (doneBtn) doneBtn.addEventListener('click', () => submitDone(c));
  }

  /* ---------- "סיימתי להעלות" ---------- */
  const currentStage = (c) => (c.stage2Open ? 2 : 1);
  function doneBox(c) {
    if (c.status === 'closed') return '';
    const items = visibleItems(c);
    const missing = items.filter((it) => !(it.files && it.files.length)).length;
    // כבר נשלח לבדיקה בשלב הנוכחי
    if (c.clientDoneAt && (c.clientDoneStage || 1) === currentStage(c)) {
      const d = new Date(c.clientDoneAt);
      return '<div class="done-note">✓ <b>התיק נשלח לבדיקה</b> (' + d.toLocaleDateString('he-IL') + '). הצוות שלנו עובר על המסמכים ויחזור אליך. אפשר עדיין להוסיף או להחליף קבצים.</div>';
    }
    if (missing > 0) {
      return '<div class="done-hint">נותרו עוד <b>' + missing + '</b> מסמכים להעלאה — כשתסיימו יופיע כאן כפתור השליחה לבדיקה.</div>';
    }
    return '<button class="portal-btn done-btn" id="client-done-btn" type="button">✓ סיימתי להעלות — שליחה לבדיקה</button>' +
      '<p class="done-sub">כל המסמכים הועלו. לחיצה מעדכנת את הצוות שאפשר להתחיל בבדיקה.</p>';
  }
  async function submitDone(c) {
    const btn = $('client-done-btn'); if (btn) { btn.disabled = true; btn.textContent = 'שולח…'; }
    try {
      await fsMod.updateDoc(fsMod.doc(db, 'cases', c.id), { clientDoneAt: new Date().toISOString(), clientDoneStage: currentStage(c) });
      // onSnapshot יציג את אישור השליחה
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = '✓ סיימתי להעלות — שליחה לבדיקה'; }
      alert('השליחה נכשלה. נסו שוב.');
      if (window.console) console.warn('submitDone error', e);
    }
  }

  /* ---------- החלפת קובץ קיים ---------- */
  async function replaceFile(c, idx, fi, file) {
    if (c.status === 'closed') { alert('התיק סגור — לא ניתן לשנות מסמכים.'); return; }
    const item = c.items[idx];
    const oldFile = (item.files || [])[fi];
    if (!oldFile) return;
    const prog = $('case-detail').querySelector('[data-prog="' + cssEsc(item.key) + '"]');
    if (prog) { prog.hidden = false; prog.classList.remove('err'); prog.textContent = 'מחליף את ' + oldFile.name + '…'; }
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('הקובץ ' + file.name + ' גדול מ-20MB.');
      const safe = file.name.replace(/[^\w.\-\u0590-\u05FF ]/g, '_');
      const path = 'client-cases/' + c.id + '/' + item.key + '/' + Date.now() + '-' + safe;
      const sref = stMod.ref(storage, path);
      await stMod.uploadBytes(sref, file, { contentType: file.type });
      const url = await stMod.getDownloadURL(sref);
      const files = (item.files || []).slice();
      files[fi] = { name: file.name, path, url, size: file.size, at: new Date().toISOString() };
      const items = (c.items || []).slice();
      items[idx] = { ...item, status: 'received', rejectReason: '', files };
      await fsMod.updateDoc(fsMod.doc(db, 'cases', c.id), { items });
      // מחיקת הקובץ הישן מהאחסון — לא קריטי אם נכשל
      if (oldFile.path) { try { await stMod.deleteObject(stMod.ref(storage, oldFile.path)); } catch (e) {} }
    } catch (e) {
      if (prog) { prog.hidden = false; prog.textContent = (e && e.message) ? e.message : 'ההחלפה נכשלה. נסו שוב.'; prog.classList.add('err'); }
      if (window.console) console.warn('replace error', e);
    }
  }

  function statusPill(st) {
    if (st === 'received') return '<span class="pill received">✓ התקבל</span>';
    if (st === 'rejected') return '<span class="pill rejected">✕ נדחה</span>';
    return '<span class="pill pending">ממתין</span>';
  }

  function itemRow(c, it) {
    const closed = c.status === 'closed';
    const files = (it.files || []).map((f, fi) =>
      '<span class="file-row"><a class="file-chip" href="' + esc(f.url) + '" target="_blank" rel="noopener">📄 ' + esc(f.name) + '</a>' +
      (closed ? '' : '<label class="file-swap" title="החלפת הקובץ בקובץ אחר">↻ החלפה<input type="file" accept="image/*,application/pdf" data-swap-key="' + esc(it.key) + '" data-swap-fi="' + fi + '" hidden></label>') +
      '</span>').join('');
    const reject = it.status === 'rejected' && it.rejectReason
      ? '<div class="reject-reason">סיבת הדחייה: ' + esc(it.rejectReason) + ' — נא להעלות מחדש.</div>' : '';
    return '<div class="doc-item ' + esc(it.status) + '">' +
      '<div class="doc-item-head"><span class="doc-label">' + esc(it.label) + '</span>' + statusPill(it.status) + '</div>' +
      reject +
      (files ? '<div class="file-list">' + files + '</div>' : '') +
      // בתיק סגור אין העלאות — תצוגה בלבד
      (c.status === 'closed' ? '' :
        '<label class="upload-btn"><input type="file" accept="image/*,application/pdf" multiple data-key="' + esc(it.key) + '" hidden>' +
        (it.files && it.files.length ? '＋ הוספת קובץ' : '⬆ העלאת מסמך') + '</label>' +
        '<div class="upload-progress" data-prog="' + esc(it.key) + '" hidden></div>') +
      '</div>';
  }

  /* ---------- העלאת קבצים ---------- */
  async function uploadFiles(c, idx, files) {
    if (c.status === 'closed') { alert('התיק סגור — לא ניתן להעלות מסמכים נוספים.'); return; }
    const item = c.items[idx];
    const prog = $('case-detail').querySelector('[data-prog="' + cssEsc(item.key) + '"]');
    if (prog) { prog.hidden = false; prog.textContent = 'מעלה…'; }
    try {
      const uploaded = [];
      for (const file of files) {
        if (file.size > 20 * 1024 * 1024) throw new Error('הקובץ ' + file.name + ' גדול מ-20MB.');
        const safe = file.name.replace(/[^\w.\-\u0590-\u05FF ]/g, '_');
        const path = 'client-cases/' + c.id + '/' + item.key + '/' + Date.now() + '-' + safe;
        const sref = stMod.ref(storage, path);
        await stMod.uploadBytes(sref, file, { contentType: file.type });
        const url = await stMod.getDownloadURL(sref);
        uploaded.push({ name: file.name, path, url, size: file.size, at: new Date().toISOString() });
      }
      const items = (c.items || []).slice();
      items[idx] = { ...item, status: 'received', rejectReason: '', files: [...(item.files || []), ...uploaded] };
      await fsMod.updateDoc(fsMod.doc(db, 'cases', c.id), { items });
      // onSnapshot יְרַנְדֵּר מחדש עם הקבצים
    } catch (e) {
      if (prog) { prog.hidden = false; prog.textContent = (e && e.message) ? e.message : 'ההעלאה נכשלה. נסו שוב.'; prog.classList.add('err'); }
      if (window.console) console.warn('upload error', e);
    }
  }
  function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }
})();
