/* ============================================================
   הורייזון פסגות גרופ — crm-invoices.js  (module)
   ארכיון חשבוניות וקבלות של העסק — לבעלים בלבד.
   · קבצים ב-Storage תחת invoices/{שנה}/{חודש}/ · מטא-דאטה ב-Firestore invoices/{id}
   · העלאה ידנית (גרירה / בחירה) · פרטי חשבונית · סינון לפי שנה/חודש/סוג
   · ייצוא CSV · הורדת ZIP · ייבוא קבצים מצורפים ישירות מתיבת Gmail
   ההרשאה נאכפת בחוקי Firestore + Storage (role == 'owner'), לא רק כאן.
   נטען מתוך crm.js עם ctx (Firebase + עזרים + מצב המשתמש).
   ============================================================ */

/* ---- ייבוא מ-Gmail: OAuth Client ID (סוג Web) מ-Google Cloud Console של הפרויקט.
        ריק = הכפתור מציג הוראות הגדרה. ראו README-INVOICES-GMAIL.md ---- */
export const GMAIL_CLIENT_ID = '579496667206-u63c3v4m3v25r1n15jhabunekdslgr0f.apps.googleusercontent.com';
const GMAIL_LOGIN_HINT = 'office@horizon-psagot-group.com';
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const GMAIL_DEFAULT_Q = '(חשבונית OR קבלה OR invoice OR receipt OR "חשבונית מס") has:attachment';

export const INVOICE_KINDS = { expense: 'הוצאה', income: 'הכנסה' };
export const INVOICE_CATS = ['שכירות ומשרד', 'תוכנה ומנויים', 'פרסום ושיווק', 'רו"ח / עו"ד / ייעוץ', 'תקשורת', 'ציוד', 'נסיעות ואירוח', 'בנק ועמלות', 'ספקים ושכר', 'אחר'];
const CURRENCIES = ['ILS', 'USD', 'EUR'];
const MAX_MB = 25;
const MONTHS_HE = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

export function initInvoices(ctx) {
  const { fs, db, st, storage, $, esc, nowISO, fmtDate, todayStr, toDateObj, displayName, safeSeg, loadJSZip } = ctx;

  let all = [];
  let unsub = null;
  let ownerMode = false;
  let yearF = '', monthF = '', kindF = '', catF = '', q = '';
  let current = null;            // החשבונית הפתוחה בכרטיס
  let pendingFile = null;        // קובץ שנבחר בכרטיס "חשבונית חדשה" לפני שמירה
  let gmailToken = null, gmailResults = [];

  const p2 = (n) => ('0' + n).slice(-2);
  const num = (v) => { const n = parseFloat(String(v == null ? '' : v).replace(/[^\d.\-]/g, '')); return isNaN(n) ? 0 : n; };
  const fmtMoney = (n, cur) => (cur === 'USD' ? '$' : cur === 'EUR' ? '€' : '₪') + Number(n || 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtSize = (b) => b > 1024 * 1024 ? (b / 1024 / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round((b || 0) / 1024)) + ' KB';
  const fmtDay = (ymd) => { if (!ymd) return '—'; const [y, m, d] = ymd.split('-'); return `${d}/${m}/${y}`; };
  const isPdf = (f) => /pdf/i.test(f.contentType || f.type || '') || /\.pdf$/i.test(f.fileName || f.name || '');
  const okType = (type, name) => /^(image\/|application\/pdf$)/.test(type || '') || /\.(pdf|jpe?g|png|webp|heic)$/i.test(name || '');
  const missingInfo = (inv) => !inv.supplier || !inv.amount;

  /* ============================================================
     הרשאה: הטאב והמנוי קיימים רק לבעלים
     ============================================================ */
  function setOwner(isOwner) {
    ownerMode = !!isOwner;
    const tab = $('tab-invoices'); if (tab) tab.hidden = !ownerMode;
    if (ownerMode && !unsub) listen();
    if (!ownerMode && unsub) detach();
  }
  function listen() {
    unsub = fs.onSnapshot(fs.collection(db, 'invoices'), (snap) => {
      all = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
      render();
      if (current) { const c = all.find((x) => x.id === current.id); if (c) current = c; }
    }, (err) => {
      console.warn('invoices listen', err);
      $('inv-table-wrap').innerHTML = '<p class="empty-state">אין הרשאה לצפות בחשבוניות' + (err && err.code === 'permission-denied' ? ' — ודאו שחוקי Firestore עודכנו (firebase deploy --only firestore:rules).' : '.') + '</p>';
    });
  }
  function detach() { if (unsub) { try { unsub(); } catch (e) {} } unsub = null; all = []; current = null; }

  /* ============================================================
     סינון ותצוגה
     ============================================================ */
  function filtered() {
    const qq = q.trim().toLowerCase();
    return all.filter((i) => {
      if (yearF && String(i.year || '') !== yearF) return false;
      if (monthF && String(i.month || '') !== monthF) return false;
      if (kindF && (i.kind || 'expense') !== kindF) return false;
      if (catF && (i.category || '') !== catF) return false;
      if (qq) {
        const hay = [i.supplier, i.number, i.fileName, i.note, i.category, i.gmailSubject, i.gmailFrom].map((s) => String(s || '').toLowerCase()).join(' ');
        if (!hay.includes(qq)) return false;
      }
      return true;
    }).sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.uploadedAt || '').localeCompare(a.uploadedAt || ''));
  }
  function render() {
    if (!ownerMode) return;
    renderFilter();
    const rows = filtered();
    renderSummary(rows);
    const wrap = $('inv-table-wrap');
    if (!all.length) { wrap.innerHTML = '<p class="empty-state">עדיין אין חשבוניות. גררו קבצי PDF לאזור ההעלאה, או ייבאו מהמייל.</p>'; return; }
    if (!rows.length) { wrap.innerHTML = '<p class="empty-state">אין חשבוניות שמתאימות לסינון.</p>'; return; }
    wrap.innerHTML = '<div class="leads-table-wrap"><table class="leads inv-table"><thead><tr>' +
      '<th>תאריך</th><th>ספק / לקוח</th><th>מס׳ חשבונית</th><th>קטגוריה</th><th>סוג</th><th>סכום</th><th>קובץ</th><th>מקור</th><th></th>' +
      '</tr></thead><tbody>' + rows.map(rowHTML).join('') + '</tbody></table></div>';
    wrap.querySelectorAll('tr.inv-row').forEach((tr) => {
      tr.addEventListener('click', (e) => { if (e.target.closest('a,button')) return; const inv = all.find((x) => x.id === tr.dataset.id); if (inv) openModal(inv); });
    });
    wrap.querySelectorAll('[data-inv-del]').forEach((b) => b.onclick = () => { const inv = all.find((x) => x.id === b.dataset.invDel); if (inv) removeInvoice(inv); });
    wrap.querySelectorAll('[data-inv-edit]').forEach((b) => b.onclick = () => { const inv = all.find((x) => x.id === b.dataset.invEdit); if (inv) openModal(inv); });
  }
  function rowHTML(i) {
    const kind = i.kind === 'income' ? 'income' : 'expense';
    const miss = missingInfo(i);
    return `<tr class="inv-row${miss ? ' inv-missing' : ''}${i.paid === false ? ' inv-unpaid' : ''}" data-id="${i.id}">` +
      `<td>${fmtDay(i.date)}</td>` +
      `<td><b>${esc(i.supplier || '')}</b>${miss ? '<span class="pill pending inv-pill-miss">חסרים פרטים</span>' : ''}${i.paid === false ? '<span class="pill rejected inv-pill-miss">לא שולם</span>' : ''}</td>` +
      `<td>${esc(i.number || '—')}</td>` +
      `<td>${esc(i.category || '—')}</td>` +
      `<td><span class="inv-kind ${kind}">${INVOICE_KINDS[kind]}</span></td>` +
      `<td class="inv-amt">${i.amount ? fmtMoney(i.amount, i.currency) : '—'}</td>` +
      `<td>${i.url ? `<a class="file-chip" href="${esc(i.url)}" target="_blank" rel="noopener" title="${esc(i.fileName || '')}">${isPdf(i) ? '📄' : '🖼'} ${esc((i.fileName || 'קובץ').slice(0, 28))}</a>` : '—'}</td>` +
      `<td><small>${i.source === 'gmail' ? '✉ מייל' : '⬆ ידני'}</small></td>` +
      `<td class="inv-actions"><button class="icon-btn" data-inv-edit="${i.id}" title="עריכת פרטים">✎</button><button class="icon-btn danger" data-inv-del="${i.id}" title="מחיקה">✕</button></td>` +
      '</tr>';
  }
  function renderFilter() {
    const bar = $('inv-filter');
    const years = [...new Set(all.map((i) => i.year).filter(Boolean))].sort((a, b) => b - a);
    const cats = [...new Set(all.map((i) => i.category).filter(Boolean))].sort();
    bar.innerHTML =
      `<select id="inv-year" class="status-select"><option value="">כל השנים</option>${years.map((y) => `<option value="${y}"${String(y) === yearF ? ' selected' : ''}>${y}</option>`).join('')}</select>` +
      `<select id="inv-month" class="status-select"><option value="">כל החודשים</option>${MONTHS_HE.map((m, k) => `<option value="${k + 1}"${String(k + 1) === monthF ? ' selected' : ''}>${m}</option>`).join('')}</select>` +
      `<select id="inv-kind" class="status-select"><option value="">הוצאות והכנסות</option>${Object.keys(INVOICE_KINDS).map((k) => `<option value="${k}"${k === kindF ? ' selected' : ''}>${INVOICE_KINDS[k]}</option>`).join('')}</select>` +
      `<select id="inv-cat" class="status-select"><option value="">כל הקטגוריות</option>${cats.map((c) => `<option value="${esc(c)}"${c === catF ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>` +
      `<input type="search" id="inv-q" class="search-input cases-search" placeholder="חיפוש ספק / מספר / קובץ…" value="${esc(q)}">` +
      `<span class="cases-viewsw inv-tools">` +
      `<button type="button" class="cases-fbtn" id="inv-csv" title="ייצוא הטבלה המסוננת לאקסל">📊 ייצוא CSV</button>` +
      `<button type="button" class="cases-fbtn" id="inv-zip" title="הורדת כל הקבצים המסוננים כ-ZIP אחד">⬇ ZIP</button>` +
      `</span>`;
    bar.querySelector('#inv-year').onchange = (e) => { yearF = e.target.value; render(); };
    bar.querySelector('#inv-month').onchange = (e) => { monthF = e.target.value; render(); };
    bar.querySelector('#inv-kind').onchange = (e) => { kindF = e.target.value; render(); };
    bar.querySelector('#inv-cat').onchange = (e) => { catF = e.target.value; render(); };
    const qi = bar.querySelector('#inv-q');
    qi.oninput = () => { q = qi.value; const pos = qi.selectionStart; render(); const n = $('inv-q'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} } };
    bar.querySelector('#inv-csv').onclick = exportCSV;
    bar.querySelector('#inv-zip').onclick = downloadZip;
  }
  function renderSummary(rows) {
    const el = $('inv-summary');
    const sums = {};
    rows.forEach((i) => { const cur = i.currency || 'ILS'; sums[cur] = sums[cur] || { expense: 0, income: 0 }; sums[cur][i.kind === 'income' ? 'income' : 'expense'] += num(i.amount); });
    const miss = rows.filter(missingInfo).length;
    const parts = Object.keys(sums).map((cur) => {
      const s = sums[cur];
      return `<span class="inv-sum"><i>הוצאות</i> ${fmtMoney(s.expense, cur)}</span>` + (s.income ? `<span class="inv-sum in"><i>הכנסות</i> ${fmtMoney(s.income, cur)}</span>` : '');
    });
    el.innerHTML = `<span class="inv-sum"><i>מסמכים</i> ${rows.length}${rows.length !== all.length ? ' / ' + all.length : ''}</span>` + parts.join('') +
      (miss ? `<span class="inv-sum warn"><i>חסרים פרטים</i> ${miss}</span>` : '');
  }

  /* ============================================================
     העלאה (גרירה / בחירה) — כל קובץ = מסמך חשבונית חדש
     ============================================================ */
  const drop = $('inv-drop'), fileIn = $('inv-files');
  drop.addEventListener('click', (e) => { if (e.target.closest('button')) return; fileIn.click(); });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); const files = Array.from(e.dataTransfer.files || []); if (files.length) uploadFiles(files); });
  fileIn.addEventListener('change', () => { const files = Array.from(fileIn.files || []); fileIn.value = ''; if (files.length) uploadFiles(files); });

  function datePartsFromName(name) {
    // מנסה לחלץ תאריך משם הקובץ: 2026-03-14 · 14.03.2026 · 14-03-26 · 20260314
    const s = String(name || '');
    let m = s.match(/(20\d{2})[-_.](\d{1,2})[-_.](\d{1,2})/); if (m) return `${m[1]}-${p2(m[2])}-${p2(m[3])}`;
    m = s.match(/(\d{1,2})[-_.](\d{1,2})[-_.](20\d{2})/); if (m) return `${m[3]}-${p2(m[2])}-${p2(m[1])}`;
    m = s.match(/(\d{1,2})[-_.](\d{1,2})[-_.](\d{2})(?!\d)/); if (m) return `20${m[3]}-${p2(m[2])}-${p2(m[1])}`;
    m = s.match(/(20\d{2})(\d{2})(\d{2})(?!\d)/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    return '';
  }
  function invoiceStoragePath(date, fileName) {
    const [y, m] = (date || todayStr()).split('-');
    return 'invoices/' + y + '/' + m + '/' + Date.now() + '-' + (safeSeg(fileName, 100) || 'file');
  }
  function say(t, err) { const el = $('inv-prog'); el.hidden = !t; el.className = 'cm-upload-prog inv-prog' + (err ? ' err' : ''); el.textContent = t || ''; }

  async function uploadOne(blob, fileName, meta) {
    if (blob.size > MAX_MB * 1024 * 1024) throw new Error('הקובץ ' + fileName + ' גדול מ-' + MAX_MB + 'MB.');
    const type = blob.type || (/\.pdf$/i.test(fileName) ? 'application/pdf' : /\.(jpe?g)$/i.test(fileName) ? 'image/jpeg' : /\.png$/i.test(fileName) ? 'image/png' : '');
    if (!okType(type, fileName)) throw new Error('הקובץ ' + fileName + ' אינו PDF או תמונה.');
    const date = (meta && meta.date) || datePartsFromName(fileName) || todayStr();
    const path = invoiceStoragePath(date, fileName);
    const sref = st.ref(storage, path);
    await st.uploadBytes(sref, blob, { contentType: type || 'application/pdf' });
    const url = await st.getDownloadURL(sref);
    const [y, m] = date.split('-');
    const me = ctx.me();
    const doc = {
      fileName, path, url, size: blob.size, contentType: type || 'application/pdf',
      supplier: '', number: '', date, year: Number(y), month: Number(m),
      amount: 0, currency: 'ILS', kind: 'expense', category: '', paid: true, note: '',
      source: 'manual', uploadedAt: nowISO(), uploadedBy: me.email || '', uploadedByUid: me.uid || '',
      ...(meta || {}),
    };
    const ref = await fs.addDoc(fs.collection(db, 'invoices'), doc);
    return { ...doc, id: ref.id };
  }
  async function uploadFiles(files) {
    if (!ownerMode) return;
    let done = 0, failed = 0, first = null;
    for (const f of files) {
      say('מעלה ' + (done + failed + 1) + '/' + files.length + ' — ' + f.name + '…');
      try { const inv = await uploadOne(f, f.name); done++; if (!first) first = inv; }
      catch (e) { failed++; console.warn('invoice upload', e); say('שגיאה: ' + (e.message || e), true); await new Promise((r) => setTimeout(r, 1200)); }
    }
    say(done ? ('הועלו ' + done + ' קבצים' + (failed ? ', ' + failed + ' נכשלו' : '') + '. לחצו על שורה כדי למלא ספק וסכום.') : 'ההעלאה נכשלה.', !done);
    setTimeout(() => say(''), 6000);
    if (done === 1 && first) openModal(first);   // קובץ בודד — פותחים מיד את הפרטים למילוי
  }

  /* ============================================================
     כרטיס חשבונית (עריכה / חדשה)
     ============================================================ */
  const M = (id) => $('im-' + id);
  function fillCats(sel, val) {
    const cats = [...new Set([...INVOICE_CATS, ...all.map((i) => i.category).filter(Boolean)])];
    sel.innerHTML = '<option value="">— ללא קטגוריה —</option>' + cats.map((c) => `<option value="${esc(c)}"${c === val ? ' selected' : ''}>${esc(c)}</option>`).join('');
  }
  function openModal(inv) {
    current = inv || null; pendingFile = null;
    $('inv-modal-title').textContent = inv ? 'פרטי חשבונית' : 'חשבונית חדשה';
    M('supplier').value = inv ? (inv.supplier || '') : '';
    M('number').value = inv ? (inv.number || '') : '';
    M('date').value = inv ? (inv.date || '') : todayStr();
    M('amount').value = inv && inv.amount ? inv.amount : '';
    M('currency').innerHTML = CURRENCIES.map((c) => `<option value="${c}"${(inv ? inv.currency : 'ILS') === c ? ' selected' : ''}>${c}</option>`).join('');
    M('kind').value = inv ? (inv.kind || 'expense') : 'expense';
    fillCats(M('cat'), inv ? inv.category : '');
    M('paid').checked = inv ? inv.paid !== false : true;
    M('note').value = inv ? (inv.note || '') : '';
    M('file-row').innerHTML = inv && inv.url
      ? `<a class="file-chip" href="${esc(inv.url)}" target="_blank" rel="noopener">${isPdf(inv) ? '📄' : '🖼'} ${esc(inv.fileName || 'קובץ')}</a> <small>${fmtSize(inv.size)} · ${inv.source === 'gmail' ? 'יובא מהמייל' : 'הועלה'} ${fmtDate(inv.uploadedAt)}${inv.uploadedBy ? ' · ' + esc(displayName(inv.uploadedBy)) : ''}</small>`
      : '<small>לא נבחר קובץ</small>';
    M('src').innerHTML = inv && inv.source === 'gmail'
      ? `<div class="inv-gmail-src">✉ <b>${esc(inv.gmailFrom || '')}</b> · ${esc(inv.gmailSubject || '')}${inv.gmailDate ? ' · ' + fmtDate(inv.gmailDate) : ''}</div>` : '';
    M('delete').hidden = !inv;
    M('replace-lbl').textContent = inv ? 'החלפת הקובץ' : 'בחירת קובץ (PDF / תמונה)';
    M('err').textContent = '';
    $('inv-modal').hidden = false;
    setTimeout(() => M('supplier').focus(), 50);
  }
  function closeModal() { $('inv-modal').hidden = true; current = null; pendingFile = null; M('file').value = ''; }
  $('inv-modal-close').addEventListener('click', closeModal);
  M('cancel').addEventListener('click', closeModal);
  $('inv-modal').addEventListener('click', (e) => { if (e.target === $('inv-modal')) closeModal(); });
  $('inv-new').addEventListener('click', () => openModal(null));
  M('file').addEventListener('change', () => {
    const f = M('file').files && M('file').files[0]; if (!f) return;
    pendingFile = f;
    M('file-row').innerHTML = `<span class="file-chip staff">${isPdf(f) ? '📄' : '🖼'} ${esc(f.name)}</span> <small>${fmtSize(f.size)} · יישמר בלחיצה על "שמירה"</small>`;
    if (!M('date').value || !current) { const d = datePartsFromName(f.name); if (d) M('date').value = d; }
  });
  $('inv-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
      supplier: M('supplier').value.trim(), number: M('number').value.trim(), date: M('date').value || todayStr(),
      amount: num(M('amount').value), currency: M('currency').value, kind: M('kind').value,
      category: M('cat').value, paid: M('paid').checked, note: M('note').value.trim(),
    };
    const [y, m] = data.date.split('-'); data.year = Number(y); data.month = Number(m);
    const btn = M('save'); btn.disabled = true; M('err').textContent = '';
    try {
      if (!current) {
        if (!pendingFile) throw new Error('בחרו קובץ חשבונית (PDF או תמונה).');
        await uploadOne(pendingFile, pendingFile.name, data);
      } else {
        const upd = { ...data, updatedAt: nowISO(), updatedBy: ctx.me().email || '' };
        if (pendingFile) {
          const path = invoiceStoragePath(data.date, pendingFile.name);
          const sref = st.ref(storage, path);
          await st.uploadBytes(sref, pendingFile, { contentType: pendingFile.type || 'application/pdf' });
          upd.url = await st.getDownloadURL(sref); upd.path = path; upd.fileName = pendingFile.name; upd.size = pendingFile.size; upd.contentType = pendingFile.type || 'application/pdf';
          if (current.path) { try { await st.deleteObject(st.ref(storage, current.path)); } catch (err) { console.warn('old file delete', err); } }
        }
        await fs.updateDoc(fs.doc(db, 'invoices', current.id), upd);
      }
      closeModal();
    } catch (err) { M('err').textContent = 'שגיאה בשמירה: ' + (err.message || err); console.warn('invoice save', err); }
    btn.disabled = false;
  });
  M('delete').addEventListener('click', () => { if (current) removeInvoice(current, true); });
  async function removeInvoice(inv, fromModal) {
    if (!confirm('למחוק את החשבונית' + (inv.supplier ? ' של ' + inv.supplier : '') + ' (' + (inv.fileName || '') + ')?\nהקובץ יימחק לצמיתות מהאחסון.')) return;
    try {
      if (inv.path) { try { await st.deleteObject(st.ref(storage, inv.path)); } catch (e) { if (e.code !== 'storage/object-not-found') throw e; } }
      await fs.deleteDoc(fs.doc(db, 'invoices', inv.id));
      if (fromModal) closeModal();
    } catch (e) { alert('שגיאה במחיקה: ' + e.message); }
  }

  /* ============================================================
     ייצוא CSV (אקסל) + ZIP של הקבצים המסוננים
     ============================================================ */
  function exportCSV() {
    const rows = filtered(); if (!rows.length) { alert('אין שורות לייצוא.'); return; }
    const cols = [['תאריך', (i) => fmtDay(i.date)], ['ספק / לקוח', (i) => i.supplier], ['מספר חשבונית', (i) => i.number], ['סוג', (i) => INVOICE_KINDS[i.kind] || 'הוצאה'],
      ['קטגוריה', (i) => i.category], ['סכום', (i) => i.amount || 0], ['מטבע', (i) => i.currency || 'ILS'], ['שולם', (i) => i.paid === false ? 'לא' : 'כן'],
      ['הערה', (i) => i.note], ['קובץ', (i) => i.fileName], ['קישור', (i) => i.url], ['מקור', (i) => i.source === 'gmail' ? 'מייל' : 'ידני'], ['נושא המייל', (i) => i.gmailSubject], ['שולח המייל', (i) => i.gmailFrom]];
    const cell = (v) => { const s = String(v == null ? '' : v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const csv = '﻿' + cols.map((c) => cell(c[0])).join(',') + '\r\n' + rows.map((i) => cols.map((c) => cell(c[1](i))).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'חשבוניות' + (yearF ? '-' + yearF : '') + (monthF ? '-' + p2(monthF) : '') + '.csv';
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  async function downloadZip() {
    const rows = filtered().filter((i) => i.url); if (!rows.length) { alert('אין קבצים להורדה.'); return; }
    const btn = $('inv-zip'); const orig = btn.textContent; btn.disabled = true;
    try {
      const JSZip = await loadJSZip(); const zip = new JSZip(); const used = new Set(); let n = 0;
      for (const i of rows) {
        btn.textContent = 'מוריד ' + (++n) + '/' + rows.length + '…';
        const r = await fetch(i.url); if (!r.ok) throw new Error('HTTP ' + r.status);
        const ext = (i.fileName || '').match(/\.[a-z0-9]+$/i); const e = ext ? ext[0] : (isPdf(i) ? '.pdf' : '');
        let name = [i.date, safeSeg(i.supplier, 40), i.number ? safeSeg(i.number, 20) : ''].filter(Boolean).join(' ') || safeSeg(i.fileName, 60) || 'invoice';
        let k = 1, base = name; while (used.has(name + e)) name = base + ' (' + (++k) + ')'; used.add(name + e);
        zip.folder(String(i.year || 'ללא שנה')).file(name + e, await r.blob());
      }
      btn.textContent = 'אורז…';
      const blob = await zip.generateAsync({ type: 'blob' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = 'חשבוניות' + (yearF ? '-' + yearF : '') + (monthF ? '-' + p2(monthF) : '') + '.zip';
      document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    } catch (e) { alert('הורדת ה-ZIP נכשלה: ' + (e.message || e) + (e instanceof TypeError ? '\n(ייתכן שחסרה הגדרת CORS על ה-bucket — ראו README-STORAGE-CORS.md)' : '')); }
    btn.disabled = false; btn.textContent = orig;
  }

  /* ============================================================
     ייבוא מ-Gmail — חיפוש מיילים עם קבצים מצורפים, בחירה, ייבוא
     רץ כולו בדפדפן (Google Identity Services + Gmail REST, קריאה בלבד).
     ============================================================ */
  const G = (id) => $('ig-' + id);
  $('inv-gmail').addEventListener('click', openGmail);
  function openGmail() {
    gmailResults = [];
    G('setup').hidden = !!GMAIL_CLIENT_ID;
    G('body').hidden = !GMAIL_CLIENT_ID;
    G('q').value = GMAIL_DEFAULT_Q;
    G('list').innerHTML = '';
    G('status').textContent = '';
    G('import').disabled = true;
    $('inv-gmail-modal').hidden = false;
  }
  const closeGmail = () => { $('inv-gmail-modal').hidden = true; };
  $('inv-gmail-close').addEventListener('click', closeGmail);
  G('cancel').addEventListener('click', closeGmail);
  $('inv-gmail-modal').addEventListener('click', (e) => { if (e.target === $('inv-gmail-modal')) closeGmail(); });

  function loadGIS() {
    if (window.google && window.google.accounts) return Promise.resolve();
    return new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
      s.onload = res; s.onerror = () => rej(new Error('טעינת Google Sign-In נכשלה')); document.head.appendChild(s);
    });
  }
  async function getGmailToken() {
    if (gmailToken && gmailToken.exp > Date.now() + 60000) return gmailToken.token;
    await loadGIS();
    return new Promise((res, rej) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: GMAIL_CLIENT_ID, scope: GMAIL_SCOPE, hint: GMAIL_LOGIN_HINT, prompt: '',
        callback: (r) => { if (r.error) { rej(new Error(r.error_description || r.error)); return; } gmailToken = { token: r.access_token, exp: Date.now() + (Number(r.expires_in) || 3600) * 1000 }; res(r.access_token); },
        error_callback: (e) => rej(new Error(e && e.type === 'popup_closed' ? 'חלון ההתחברות נסגר' : (e && e.message) || 'שגיאת התחברות ל-Google')),
      });
      client.requestAccessToken();
    });
  }
  async function gapi(path, params) {
    const token = await getGmailToken();
    const url = 'https://gmail.googleapis.com/gmail/v1/users/me/' + path + (params ? '?' + new URLSearchParams(params) : '');
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    if (r.status === 401) { gmailToken = null; throw new Error('ההרשאה פגה — נסו שוב.'); }
    if (!r.ok) { let msg = 'HTTP ' + r.status; try { const j = await r.json(); msg = (j.error && j.error.message) || msg; } catch (e) {} throw new Error(msg); }
    return r.json();
  }
  const hdr = (msg, name) => { const h = ((msg.payload || {}).headers || []).find((x) => x.name.toLowerCase() === name); return h ? h.value : ''; };
  function attachmentsOf(payload, out) {
    out = out || [];
    if (!payload) return out;
    if (payload.filename && payload.body && payload.body.attachmentId && okType(payload.mimeType, payload.filename))
      out.push({ id: payload.body.attachmentId, name: payload.filename, size: payload.body.size || 0, mime: payload.mimeType });
    (payload.parts || []).forEach((p) => attachmentsOf(p, out));
    return out;
  }
  const alreadyImported = (msgId, name) => all.some((i) => i.gmailMessageId === msgId && i.fileName === name);

  G('search').addEventListener('click', async () => {
    const range = G('range').value;
    const qq = G('q').value.trim() + (range ? ' newer_than:' + range : '');
    G('status').textContent = 'מתחבר ל-Gmail…'; G('list').innerHTML = ''; G('import').disabled = true; gmailResults = [];
    try {
      let ids = [], pageToken = '';
      do {
        const r = await gapi('messages', { q: qq, maxResults: 100, ...(pageToken ? { pageToken } : {}) });
        ids = ids.concat((r.messages || []).map((m) => m.id)); pageToken = r.nextPageToken || '';
        G('status').textContent = 'נמצאו ' + ids.length + ' מיילים…';
      } while (pageToken && ids.length < 500);
      if (!ids.length) { G('status').textContent = 'לא נמצאו מיילים מתאימים.'; return; }
      let n = 0;
      for (const id of ids) {
        G('status').textContent = 'קורא מייל ' + (++n) + '/' + ids.length + '…';
        const m = await gapi('messages/' + id, { format: 'full' });
        const atts = attachmentsOf(m.payload);
        if (!atts.length) continue;
        const d = new Date(Number(m.internalDate));
        atts.forEach((a) => gmailResults.push({ msgId: id, att: a, from: hdr(m, 'from'), subject: hdr(m, 'subject'), date: isNaN(d) ? '' : d.toISOString(), day: isNaN(d) ? '' : `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}` }));
      }
      gmailResults.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      renderGmailList();
    } catch (e) { G('status').textContent = 'שגיאה: ' + (e.message || e); console.warn('gmail search', e); }
  });
  function renderGmailList() {
    const fresh = gmailResults.filter((r) => !alreadyImported(r.msgId, r.att.name)).length;
    G('status').textContent = gmailResults.length ? (gmailResults.length + ' קבצים מצורפים' + (fresh !== gmailResults.length ? ' · ' + (gmailResults.length - fresh) + ' כבר יובאו' : '')) : 'לא נמצאו קבצים מצורפים מתאימים (PDF / תמונה).';
    G('list').innerHTML = gmailResults.map((r, k) => {
      const dup = alreadyImported(r.msgId, r.att.name);
      return `<label class="lw-item ig-item${dup ? ' dup' : ''}"><input type="checkbox" data-k="${k}"${dup ? ' disabled' : ' checked'}>` +
        `<span><b>${isPdf({ contentType: r.att.mime, fileName: r.att.name }) ? '📄' : '🖼'} ${esc(r.att.name)} <small style="display:inline">${fmtSize(r.att.size)}</small></b>` +
        `<small>${esc(r.from.replace(/<.*>/, '').trim())} · ${esc(r.subject)} · ${fmtDay(r.day)}</small></span>` +
        (dup ? '<span class="pill received">יובא</span>' : '') + '</label>';
    }).join('');
    const upd = () => { const n = G('list').querySelectorAll('input:checked:not(:disabled)').length; G('import').disabled = !n; G('import').textContent = 'ייבוא ' + (n ? n + ' קבצים' : 'נבחרים'); };
    G('list').querySelectorAll('input').forEach((c) => c.onchange = upd); upd();
    G('all').onclick = () => { G('list').querySelectorAll('input:not(:disabled)').forEach((c) => c.checked = true); upd(); };
    G('none').onclick = () => { G('list').querySelectorAll('input').forEach((c) => c.checked = false); upd(); };
  }
  G('import').addEventListener('click', async () => {
    const picks = Array.from(G('list').querySelectorAll('input:checked:not(:disabled)')).map((c) => gmailResults[Number(c.dataset.k)]);
    if (!picks.length) return;
    G('import').disabled = true; let done = 0, failed = 0;
    for (const r of picks) {
      G('status').textContent = 'מייבא ' + (done + failed + 1) + '/' + picks.length + ' — ' + r.att.name + '…';
      try {
        const a = await gapi('messages/' + r.msgId + '/attachments/' + r.att.id);
        const bin = atob(String(a.data || '').replace(/-/g, '+').replace(/_/g, '/'));
        const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const blob = new Blob([bytes], { type: r.att.mime || 'application/pdf' });
        const from = r.from.replace(/<.*>/, '').replace(/"/g, '').trim();
        await uploadOne(blob, r.att.name, {
          source: 'gmail', gmailMessageId: r.msgId, gmailSubject: r.subject, gmailFrom: r.from, gmailDate: r.date,
          date: datePartsFromName(r.att.name) || r.day || todayStr(), supplier: from.slice(0, 80),
        });
        done++;
      } catch (e) { failed++; console.warn('gmail import', r, e); }
    }
    G('status').textContent = 'יובאו ' + done + ' קבצים' + (failed ? ', ' + failed + ' נכשלו (ראו קונסול)' : '') + '. הספק מולא לפי שם השולח — כדאי לעבור ולמלא סכומים.';
    renderGmailList();
  });

  return { setOwner, refresh: render, detach, openNew: () => openModal(null) };
}
