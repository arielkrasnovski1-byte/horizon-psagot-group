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
// קריאה (ייבוא) + שליחה (גשר ל-Dokka). בפעם הראשונה אחרי העדכון גוגל יבקש לאשר גם שליחה.
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send';
/* ---- Dokka: תיבת הקליטה של החברה (מופיעה ב-Dokka מתחת לשם החברה). כל מייל עם קובץ שנשלח אליה נקלט כמסמך. ---- */
export const DOKKA_EMAIL = 'horizon-pg@dokka.co.il';
// מילות מפתח למיילים ללא קובץ מצורף. ג'ימייל לא מזהה נטיות בעברית (החשבונית/חשבוניות), לכן הן מפורטות.
const GMAIL_KEYWORDS = '(חשבונית OR החשבונית OR חשבוניות OR קבלה OR הקבלה OR קבלות OR "חשבונית מס" OR "אישור תשלום" OR "דרישת תשלום" OR invoice OR invoices OR receipt OR receipts OR "tax invoice" OR billing OR statement OR payment OR subscription OR order)';
const GMAIL_MAX_MSGS = 4000;  // מיילים עם קבצים מצורפים שנסרקים בסבב אחד
const GMAIL_MAX_BODY = 1500;  // מיילים ללא קובץ מצורף שנבדקים (לפי מילות מפתח)

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
  let periodF = '', fromF = '', toF = '', supF = '', kindF = '', catF = '', acctF = '', paidF = '', minF = '', maxF = '', q = '';
  let sortF = 'date_desc', viewF = 'list';
  let selected = new Set();   // מזהי חשבוניות שסומנו בטבלה (להדפסה / ייצוא נבחרים)
  let current = null;            // החשבונית הפתוחה בכרטיס
  let pendingFile = null;        // קובץ שנבחר בכרטיס "חשבונית חדשה" לפני שמירה
  let gmailToken = null, gmailResults = [], gmailBody = [], gmailAccount = '', gmailPrompt = '';
  let backfilled = false;
  let syncState = null, unsubSync = null;   // settings/dokkaSync — מצב הסנכרון האוטומטי מ-DOKKA

  const p2 = (n) => ('0' + n).slice(-2);
  const num = (v) => { const n = parseFloat(String(v == null ? '' : v).replace(/[^\d.\-]/g, '')); return isNaN(n) ? 0 : n; };
  const fmtMoney = (n, cur) => (cur === 'USD' ? '$' : cur === 'EUR' ? '€' : '₪') + Number(n || 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtSize = (b) => b > 1024 * 1024 ? (b / 1024 / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round((b || 0) / 1024)) + ' KB';
  const fmtDay = (ymd) => { if (!ymd) return '—'; const [y, m, d] = ymd.split('-'); return `${d}/${m}/${y}`; };
  const isPdf = (f) => /pdf/i.test(f.contentType || f.type || '') || /\.pdf$/i.test(f.fileName || f.name || '');
  const okType = (type, name) => /^(image\/|application\/pdf$)/.test(type || '') || /\.(pdf|jpe?g|png|webp|heic)$/i.test(name || '');
  const missingInfo = (inv) => !inv.supplier || !inv.amount;
  // מאיזו תיבה הגיעה החשבונית: מייל של החשבון המייבא, או 'manual' להעלאה ידנית.
  // ייבואים ישנים (לפני שנשמר החשבון) נעשו כולם מ-office.
  const acctOf = (i) => i.source === 'gmail' ? (i.gmailAccount || GMAIL_LOGIN_HINT) : i.source === 'dokka' ? 'dokka' : 'manual';
  const acctLabel = (a) => a === 'manual' ? 'העלאה ידנית' : a === 'dokka' ? 'Dokka (סנכרון אוטומטי)' : a;
  const acctShort = (a) => a === 'manual' ? 'ידני' : a === 'dokka' ? 'Dokka' : String(a).split('@')[0];

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
    unsubSync = fs.onSnapshot(fs.doc(db, 'settings', 'dokkaSync'), (snap) => { syncState = (snap && typeof snap.data === 'function' && snap.exists && snap.exists()) ? snap.data() : null; renderSyncStatus(); }, (e) => { console.warn('dokkaSync listen', e); syncState = null; renderSyncStatus(); });
    unsub = fs.onSnapshot(fs.collection(db, 'invoices'), (snap) => {
      all = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
      const ids = new Set(all.map((i) => i.id)); selected.forEach((id) => { if (!ids.has(id)) selected.delete(id); });
      render();
      // השלמה חד-פעמית: ייבואים שנעשו לפני שמירת שם התיבה — כולם מ-office
      if (!backfilled) { backfilled = true; all.filter((i) => i.source === 'gmail' && !i.gmailAccount).forEach((i) => fs.updateDoc(fs.doc(db, 'invoices', i.id), { gmailAccount: GMAIL_LOGIN_HINT }).catch(() => {})); }
      if (current) { const c = all.find((x) => x.id === current.id); if (c) current = c; }
    }, (err) => {
      console.warn('invoices listen', err);
      $('inv-table-wrap').innerHTML = '<p class="empty-state">אין הרשאה לצפות בחשבוניות' + (err && err.code === 'permission-denied' ? ' — ודאו שחוקי Firestore עודכנו (firebase deploy --only firestore:rules).' : '.') + '</p>';
    });
  }
  function detach() { if (unsub) { try { unsub(); } catch (e) {} } unsub = null; if (unsubSync) { try { unsubSync(); } catch (e) {} } unsubSync = null; all = []; current = null; }

  /* ============================================================
     סנכרון אוטומטי מ-DOKKA (Cloud Function dokkaSyncScheduled כל 30 דק׳ + dokkaSyncNow ידני)
     ============================================================ */
  function renderSyncStatus() {
    const el = $('inv-dokka-status'); if (!el) return;
    const btn = $('inv-dokka-sync');
    if (!syncState) { el.innerHTML = '<span class="pill pending">סנכרון מ-Dokka עדיין לא הופעל</span> <small>נדרשת הגדרת הפונקציה בענן — ראו README-DOKKA.md</small>'; if (btn) btn.disabled = false; return; }
    const r = syncState.lastResult || {};
    const running = syncState.running && syncState.runningSince && (Date.now() - Date.parse(syncState.runningSince) < 10 * 60000);
    el.innerHTML = (running ? '<span class="pill printed">⏳ סנכרון רץ עכשיו…</span> ' : '') +
      (syncState.lastSyncAt ? `<span class="pill dokka">🔗 Dokka</span> סנכרון אחרון ${esc(fmtDate(syncState.lastSyncAt))}` + (syncState.lastTrigger && String(syncState.lastTrigger).startsWith('manual') ? ' (ידני)' : ' (אוטומטי, כל 30 דק׳)') : '') +
      (r.seen != null ? ` · נבדקו ${r.seen} · <b>נוספו ${r.added || 0}</b> · עודכנו ${r.updated || 0}` + (r.errorCount ? ` · <span class="inv-sync-err" title="${esc((r.errors || []).join('\n'))}">שגיאות ${r.errorCount}</span>` : '') : '');
    if (btn) btn.disabled = !!running;
  }
  $('inv-dokka-sync').addEventListener('click', async () => {
    const btn = $('inv-dokka-sync'); const orig = btn.textContent;
    btn.disabled = true; btn.textContent = 'מסנכרן…';
    try {
      const r = await ctx.callFn('dokkaSyncNow', { sinceDays: 0 });
      alert('סנכרון מ-Dokka הסתיים: נבדקו ' + r.seen + ', נוספו ' + r.added + ', עודכנו ' + r.updated + (r.errors && r.errors.length ? '\nשגיאות (' + r.errors.length + '):\n' + r.errors.slice(0, 5).join('\n') : ''));
    } catch (e) {
      const code = e && e.code ? String(e.code) : '';
      alert(/not-found|internal/.test(code) && /not found|NOT_FOUND/i.test(e.message || '') || /functions\/not-found/.test(code)
        ? 'הפונקציה עדיין לא פרוסה בענן. ראו README-DOKKA.md (firebase deploy --only functions).'
        : 'הסנכרון נכשל: ' + (e.message || e));
      console.warn('dokkaSyncNow', e);
    }
    btn.textContent = orig; renderSyncStatus();
  });

  /* ============================================================
     סינון ותצוגה
     תקופה (מהירה / טווח תאריכים) · ספק/מוצר · סוג · קטגוריה · תיבת מייל · מצב תשלום ·
     טווח סכום · חיפוש · מיון · תצוגה: רשימה / לפי ספק (עם סיכום לכל ספק)
     ============================================================ */
  const PERIODS = [['', 'כל התקופה'], ['month', 'החודש'], ['lastmonth', 'חודש שעבר'], ['3m', '3 חודשים אחרונים'], ['6m', '6 חודשים אחרונים'], ['12m', '12 חודשים אחרונים'], ['year', 'השנה'], ['lastyear', 'שנה שעברה'], ['custom', 'טווח תאריכים…']];
  const SORTS = [['date_desc', 'תאריך: חדש → ישן'], ['date_asc', 'תאריך: ישן → חדש'], ['amt_desc', 'סכום: גבוה → נמוך'], ['amt_asc', 'סכום: נמוך → גבוה'], ['sup', 'ספק: א → ת'], ['added', 'נוסף לאחרונה']];
  const supKey = (i) => String(i.supplier || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const addM = (d, n) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; };
  const ymd = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  function periodRange() {
    const t = new Date(), y = t.getFullYear(), m = t.getMonth();
    switch (periodF) {
      case 'month': return [ymd(new Date(y, m, 1)), ymd(new Date(y, m + 1, 0))];
      case 'lastmonth': return [ymd(new Date(y, m - 1, 1)), ymd(new Date(y, m, 0))];
      case '3m': return [ymd(addM(t, -3)), ymd(t)];
      case '6m': return [ymd(addM(t, -6)), ymd(t)];
      case '12m': return [ymd(addM(t, -12)), ymd(t)];
      case 'year': return [`${y}-01-01`, `${y}-12-31`];
      case 'lastyear': return [`${y - 1}-01-01`, `${y - 1}-12-31`];
      case 'custom': return [fromF, toF];
      default: return periodF.startsWith('y:') ? [periodF.slice(2) + '-01-01', periodF.slice(2) + '-12-31'] : ['', ''];
    }
  }
  function filtered() {
    const qq = q.trim().toLowerCase();
    const [from, to] = periodRange();
    const min = minF !== '' ? num(minF) : null, max = maxF !== '' ? num(maxF) : null;
    const rows = all.filter((i) => {
      const d = i.date || '';
      if (from && d < from) return false;
      if (to && d > to) return false;
      if (supF && supKey(i) !== supF) return false;
      if (kindF && (i.kind || 'expense') !== kindF) return false;
      if (catF && (i.category || '') !== catF) return false;
      if (acctF && acctOf(i) !== acctF) return false;
      if (paidF === 'paid' && i.paid === false) return false;
      if (paidF === 'unpaid' && i.paid !== false) return false;
      if (paidF === 'missing' && !missingInfo(i)) return false;
      if (paidF === 'emailprint' && !i.emailPrint) return false;
      if (paidF === 'printed' && !i.printedAt) return false;
      if (paidF === 'unprinted' && i.printedAt) return false;
      if (paidF === 'dokka' && !i.dokkaSentAt) return false;
      if (paidF === 'nodokka' && (i.dokkaSentAt || i.kind === 'income')) return false;
      if (min != null && num(i.amount) < min) return false;
      if (max != null && num(i.amount) > max) return false;
      if (qq) {
        const hay = [i.supplier, i.number, i.fileName, i.note, i.category, i.gmailSubject, i.gmailFrom, i.amount].map((s) => String(s || '').toLowerCase()).join(' ');
        if (!hay.includes(qq)) return false;
      }
      return true;
    });
    const byDate = (a, b) => (b.date || '').localeCompare(a.date || '') || (b.uploadedAt || '').localeCompare(a.uploadedAt || '');
    const sorters = {
      date_desc: byDate, date_asc: (a, b) => -byDate(a, b),
      amt_desc: (a, b) => num(b.amount) - num(a.amount) || byDate(a, b), amt_asc: (a, b) => num(a.amount) - num(b.amount) || byDate(a, b),
      sup: (a, b) => supKey(a).localeCompare(supKey(b), 'he') || byDate(a, b),
      added: (a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || ''),
    };
    return rows.sort(sorters[sortF] || byDate);
  }
  const activeFilters = () => [periodF, supF, kindF, catF, acctF, paidF, minF, maxF, q.trim()].filter(Boolean).length;
  // היעד לפעולות (הדפסה / CSV / ZIP): הנבחרים — ואם לא נבחר כלום, כל מה שמסונן
  const targetRows = () => { const rows = filtered(); return selected.size ? rows.filter((i) => selected.has(i.id)) : rows; };
  const targetLabel = () => selected.size ? ' (' + selected.size + ' נבחרים)' : '';
  // סימון "הודפס": נשמר על המסמך (printedAt/printedBy/printCount). נרשם אוטומטית בשליחה להדפסה, וניתן לשינוי ידני.
  async function markPrinted(rows, on) {
    const me = ctx.me(); const at = nowISO();
    await Promise.all(rows.map((i) => fs.updateDoc(fs.doc(db, 'invoices', i.id), on
      ? { printedAt: at, printedBy: me.email || '', printCount: (Number(i.printCount) || 0) + 1 }
      : { printedAt: '', printedBy: '' }).catch((e) => console.warn('markPrinted', e))));
    // עדכון מקומי מיידי (עד שה-snapshot מגיע)
    rows.forEach((i) => { i.printedAt = on ? at : ''; i.printedBy = on ? (me.email || '') : ''; if (on) i.printCount = (Number(i.printCount) || 0) + 1; });
    render();
  }
  function clearFilters() { periodF = ''; fromF = ''; toF = ''; supF = ''; kindF = ''; catF = ''; acctF = ''; paidF = ''; minF = ''; maxF = ''; q = ''; render(); }
  function render() {
    if (!ownerMode) return;
    renderFilter();
    const rows = filtered();
    renderSummary(rows);
    const wrap = $('inv-table-wrap');
    if (!all.length) { wrap.innerHTML = '<p class="empty-state">עדיין אין חשבוניות. גררו קבצי PDF לאזור ההעלאה, או ייבאו מהמייל.</p>'; return; }
    if (!rows.length) { wrap.innerHTML = '<p class="empty-state">אין חשבוניות שמתאימות לסינון. <button type="button" class="btn-ghost lw-mini" id="inv-clear2">ניקוי הסינון</button></p>'; const b = $('inv-clear2'); if (b) b.onclick = clearFilters; return; }
    const visIds = rows.map((i) => i.id);
    const allSel = visIds.length && visIds.every((id) => selected.has(id));
    const head = '<div class="leads-table-wrap"><table class="leads inv-table"><thead><tr>' +
      `<th class="inv-sel"><input type="checkbox" id="inv-selall" title="בחירת כל השורות המוצגות"${allSel ? ' checked' : ''}></th>` +
      '<th>תאריך</th><th>ספק / מוצר</th><th>מס׳ חשבונית</th><th>קטגוריה</th><th>סוג</th><th>סכום</th><th>קובץ</th><th>מקור</th><th></th>' +
      '</tr></thead><tbody>';
    let body = '';
    if (viewF === 'supplier') {
      // קיבוץ לפי ספק: כותרת עם מספר חשבוניות וסכום (₪, הוצאות), ממוין לפי סכום יורד
      const groups = {};
      rows.forEach((i) => { const k = supKey(i); (groups[k] = groups[k] || { name: i.supplier || 'ללא ספק', rows: [], sum: 0, n: 0 }); groups[k].rows.push(i); groups[k].n++; if ((i.currency || 'ILS') === 'ILS' && i.kind !== 'income') groups[k].sum += num(i.amount); });
      Object.entries(groups).sort((a, b) => b[1].sum - a[1].sum || b[1].n - a[1].n).forEach(([k, g]) => {
        body += `<tr class="inv-grp" data-sup="${esc(k)}"><td colspan="10"><b>${esc(g.name)}</b><span>${g.n} ${g.n === 1 ? 'חשבונית' : 'חשבוניות'}</span><span class="inv-grp-sum">${fmtMoney(g.sum, 'ILS')}</span><small>לחיצה = סינון לספק זה</small></td></tr>` + g.rows.map(rowHTML).join('');
      });
    } else body = rows.map(rowHTML).join('');
    wrap.innerHTML = head + body + '</tbody></table></div>';
    wrap.querySelectorAll('tr.inv-row').forEach((tr) => {
      tr.addEventListener('click', (e) => { if (e.target.closest('a,button,input,.inv-sel')) return; const inv = all.find((x) => x.id === tr.dataset.id); if (inv) openModal(inv); });
    });
    wrap.querySelectorAll('[data-sel]').forEach((c) => c.onchange = () => { if (c.checked) selected.add(c.dataset.sel); else selected.delete(c.dataset.sel); render(); });
    const sa = $('inv-selall'); if (sa) sa.onchange = () => { if (sa.checked) visIds.forEach((id) => selected.add(id)); else visIds.forEach((id) => selected.delete(id)); render(); };
    wrap.querySelectorAll('tr.inv-grp').forEach((tr) => tr.onclick = () => { supF = tr.dataset.sup; viewF = 'list'; render(); });
    wrap.querySelectorAll('[data-inv-del]').forEach((b) => b.onclick = () => { const inv = all.find((x) => x.id === b.dataset.invDel); if (inv) removeInvoice(inv); });
    wrap.querySelectorAll('[data-inv-edit]').forEach((b) => b.onclick = () => { const inv = all.find((x) => x.id === b.dataset.invEdit); if (inv) openModal(inv); });
    wrap.querySelectorAll('[data-inv-sup]').forEach((b) => b.onclick = () => { supF = b.dataset.invSup; render(); });
  }
  function rowHTML(i) {
    const kind = i.kind === 'income' ? 'income' : 'expense';
    const miss = missingInfo(i);
    return `<tr class="inv-row${miss ? ' inv-missing' : ''}${i.paid === false ? ' inv-unpaid' : ''}${selected.has(i.id) ? ' inv-selected' : ''}" data-id="${i.id}">` +
      `<td class="inv-sel"><input type="checkbox" data-sel="${i.id}"${selected.has(i.id) ? ' checked' : ''}></td>` +
      `<td>${fmtDay(i.date)}</td>` +
      `<td><b>${esc(i.supplier || '')}</b>${i.supplier && !supF ? `<button type="button" class="inv-suplink" data-inv-sup="${esc(supKey(i))}" title="הצגת כל החשבוניות של ${esc(i.supplier)}">▼</button>` : ''}${miss ? '<span class="pill pending inv-pill-miss">חסרים פרטים</span>' : ''}${i.paid === false ? '<span class="pill rejected inv-pill-miss">לא שולם</span>' : ''}${i.dokkaSentAt ? `<span class="pill dokka inv-pill-miss" title="נשלח ל-Dokka ${esc(fmtDate(i.dokkaSentAt))}${i.dokkaSentBy ? ' מ-' + esc(i.dokkaSentBy) : ''}">📤 Dokka ${esc(fmtDay(String(i.dokkaSentAt).slice(0, 10)))}</span>` : ''}${i.printedAt ? `<span class="pill printed inv-pill-miss" title="הודפס ${esc(fmtDate(i.printedAt))}${i.printedBy ? ' · ' + esc(displayName(i.printedBy)) : ''}${Number(i.printCount) > 1 ? ' · ' + i.printCount + ' פעמים' : ''}">🖨 הודפס ${esc(fmtDay(String(i.printedAt).slice(0, 10)))}</span>` : ''}</td>` +
      `<td>${esc(i.number || '—')}</td>` +
      `<td>${esc(i.category || '—')}</td>` +
      `<td><span class="inv-kind ${kind}">${INVOICE_KINDS[kind]}</span></td>` +
      `<td class="inv-amt">${i.amount ? fmtMoney(i.amount, i.currency) : '—'}</td>` +
      `<td>${i.url ? `<a class="file-chip" href="${esc(i.url)}" target="_blank" rel="noopener" title="${esc(i.fileName || '')}">${i.emailPrint ? '📧' : isPdf(i) ? '📄' : '🖼'} ${esc((i.fileName || 'קובץ').slice(0, 28))}</a>` : '—'}</td>` +
      `<td><small title="${esc(acctLabel(acctOf(i)))}">${i.source === 'gmail' ? '✉ ' + esc(acctShort(acctOf(i))) : i.source === 'dokka' ? '🔗 Dokka' : '⬆ ידני'}</small></td>` +
      `<td class="inv-actions"><button class="icon-btn" data-inv-edit="${i.id}" title="עריכת פרטים">✎</button><button class="icon-btn danger" data-inv-del="${i.id}" title="מחיקה">✕</button></td>` +
      '</tr>';
  }
  function renderFilter() {
    const bar = $('inv-filter');
    const years = [...new Set(all.map((i) => i.year).filter(Boolean))].sort((a, b) => b - a);
    const cats = [...new Set(all.map((i) => i.category).filter(Boolean))].sort();
    const accts = [...new Set(all.map(acctOf))].sort((a, b) => (a === 'manual') - (b === 'manual') || a.localeCompare(b));
    const sups = {}; all.forEach((i) => { const k = supKey(i); if (!k) return; sups[k] = sups[k] || { name: i.supplier.trim(), n: 0 }; sups[k].n++; });
    const supList = Object.entries(sups).sort((a, b) => b[1].n - a[1].n || a[1].name.localeCompare(b[1].name, 'he'));
    const opt = (v, label, cur) => `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(label)}</option>`;
    const nActive = activeFilters();
    bar.innerHTML =
      `<select id="inv-period" class="status-select" title="תקופה">${PERIODS.map(([v, l]) => opt(v, l, periodF)).join('')}${years.length ? '<option disabled>──</option>' + years.map((y) => opt('y:' + y, 'שנת ' + y, periodF)).join('') : ''}</select>` +
      `<span class="inv-range" id="inv-range"${periodF === 'custom' ? '' : ' hidden'}><label>מ־<input type="date" id="inv-from" value="${esc(fromF)}"></label><label>עד <input type="date" id="inv-to" value="${esc(toF)}"></label></span>` +
      `<select id="inv-sup" class="status-select" title="ספק / מוצר"><option value="">כל הספקים / מוצרים</option>${supList.map(([k, s]) => opt(k, s.name + ' (' + s.n + ')', supF)).join('')}</select>` +
      `<select id="inv-kind" class="status-select">${opt('', 'הוצאות והכנסות', kindF)}${Object.keys(INVOICE_KINDS).map((k) => opt(k, INVOICE_KINDS[k], kindF)).join('')}</select>` +
      `<select id="inv-cat" class="status-select">${opt('', 'כל הקטגוריות', catF)}${cats.map((c) => opt(c, c, catF)).join('')}</select>` +
      `<select id="inv-acct" class="status-select">${opt('', 'כל התיבות', acctF)}${accts.map((a) => opt(a, acctLabel(a), acctF)).join('')}</select>` +
      `<select id="inv-paid" class="status-select">${opt('', 'כל המצבים', paidF)}${opt('paid', 'שולם', paidF)}${opt('unpaid', 'לא שולם', paidF)}${opt('missing', 'חסרים פרטים (ספק/סכום)', paidF)}${opt('emailprint', 'נשמרו מגוף המייל', paidF)}${opt('printed', '🖨 הודפסו', paidF)}${opt('unprinted', 'טרם הודפסו', paidF)}${opt('dokka', '📤 נשלחו ל-Dokka', paidF)}${opt('nodokka', 'טרם נשלחו ל-Dokka (הוצאות)', paidF)}</select>` +
      `<span class="inv-amtrange"><input type="text" inputmode="decimal" id="inv-min" placeholder="מסכום ₪" value="${esc(minF)}"><input type="text" inputmode="decimal" id="inv-max" placeholder="עד סכום ₪" value="${esc(maxF)}"></span>` +
      `<input type="search" id="inv-q" class="search-input cases-search" placeholder="חיפוש חופשי: ספק, מספר, קובץ, נושא מייל…" value="${esc(q)}">` +
      `<select id="inv-sort" class="status-select" title="מיון">${SORTS.map(([v, l]) => opt(v, l, sortF)).join('')}</select>` +
      `<span class="cases-viewsw inv-tools">` +
      `<button type="button" class="cases-fbtn${viewF === 'list' ? ' on' : ''}" data-iv="list" title="רשימה">☰ רשימה</button>` +
      `<button type="button" class="cases-fbtn${viewF === 'supplier' ? ' on' : ''}" data-iv="supplier" title="קיבוץ לפי ספק / מוצר עם סיכום לכל אחד">▤ לפי ספק</button>` +
      (nActive ? `<button type="button" class="cases-fbtn inv-clear" id="inv-clear" title="איפוס כל הסינונים">✕ ניקוי סינון (${nActive})</button>` : '') +
      `<span class="inv-printwrap"><button type="button" class="cases-fbtn inv-print" id="inv-print-btn" title="הדפסה (נבחרים, או כל המסוננים)">🖨 הדפסה${esc(targetLabel())} ▾</button>` +
      `<span class="inv-printmenu" id="inv-printmenu" hidden>` +
      `<button type="button" id="inv-print-sep">📄 כל מסמך בנפרד<small>עבודת הדפסה לכל חשבונית, אחת אחרי השנייה, עם תצוגה מקדימה</small></button>` +
      `<button type="button" id="inv-print-docs">🗂 כולם כקובץ אחד<small>איחוד כל החשבוניות ל-PDF אחד</small></button>` +
      `<button type="button" id="inv-print-list">📋 הרשימה כדוח<small>טבלה עם סיכומים</small></button>` +
      `<button type="button" id="inv-print-mark">✔ סימון כהודפס / ביטול<small>בלי להדפיס — למשל אם הודפס במקום אחר</small></button>` +
      `</span></span>` +
      `<button type="button" class="cases-fbtn inv-dokka" id="inv-dokka" title="שליחת קובצי החשבוניות במייל לתיבת הקליטה של Dokka (" + DOKKA_EMAIL + ") — נבחרים, או כל המסוננים; הכנסות ומה שכבר נשלח מדולגים">📤 שליחה ל-Dokka${esc(targetLabel())}</button>` +
      `<button type="button" class="cases-fbtn" id="inv-csv" title="ייצוא לאקסל (נבחרים, או כל המסוננים)">📊 CSV${esc(targetLabel())}</button>` +
      `<button type="button" class="cases-fbtn" id="inv-zip" title="הורדת הקבצים כ-ZIP אחד (נבחרים, או כל המסוננים)">⬇ ZIP${esc(targetLabel())}</button>` +
      (selected.size ? `<button type="button" class="cases-fbtn inv-clear" id="inv-unsel" title="ביטול הבחירה">✕ ביטול בחירה (${selected.size})</button>` : '') +
      `</span>`;
    const on = (id, ev, fn) => { const el = bar.querySelector('#' + id); if (el) el['on' + ev] = fn; };
    on('inv-period', 'change', (e) => { periodF = e.target.value; if (periodF === 'custom' && !fromF && !toF) { fromF = ymd(addM(new Date(), -1)); toF = todayStr(); } render(); });
    on('inv-from', 'change', (e) => { fromF = e.target.value; render(); });
    on('inv-to', 'change', (e) => { toF = e.target.value; render(); });
    on('inv-sup', 'change', (e) => { supF = e.target.value; render(); });
    on('inv-kind', 'change', (e) => { kindF = e.target.value; render(); });
    on('inv-cat', 'change', (e) => { catF = e.target.value; render(); });
    on('inv-acct', 'change', (e) => { acctF = e.target.value; render(); });
    on('inv-paid', 'change', (e) => { paidF = e.target.value; render(); });
    on('inv-sort', 'change', (e) => { sortF = e.target.value; render(); });
    // שדות טקסט: עדכון תוך כדי הקלדה בלי לאבד את הסמן
    const live = (id, set) => { const el = bar.querySelector('#' + id); el.oninput = () => { set(el.value); const pos = el.selectionStart; render(); const n = $(id); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} } }; };
    live('inv-q', (v) => { q = v; }); live('inv-min', (v) => { minF = v; }); live('inv-max', (v) => { maxF = v; });
    bar.querySelectorAll('[data-iv]').forEach((b) => b.onclick = () => { viewF = b.dataset.iv; render(); });
    on('inv-clear', 'click', clearFilters);
    on('inv-csv', 'click', exportCSV);
    on('inv-zip', 'click', downloadZip);
    on('inv-dokka', 'click', () => sendToDokka());
    const menu = bar.querySelector('#inv-printmenu');
    on('inv-print-btn', 'click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; });
    document.addEventListener('click', (e) => { if (!e.target.closest('.inv-printwrap')) menu.hidden = true; }, { once: true, capture: true });
    on('inv-print-sep', 'click', () => { menu.hidden = true; printSeparately(); });
    on('inv-print-docs', 'click', () => { menu.hidden = true; printDocs(); });
    on('inv-print-list', 'click', () => { menu.hidden = true; printList(); });
    on('inv-print-mark', 'click', () => { menu.hidden = true; const rows = targetRows(); if (!rows.length) return; const allOn = rows.every((i) => i.printedAt); if (confirm(allOn ? 'לבטל את סימון "הודפס" ל-' + rows.length + ' חשבוניות?' : 'לסמן ' + rows.length + ' חשבוניות כהודפסו?')) markPrinted(rows, !allOn); });
    on('inv-unsel', 'click', () => { selected.clear(); render(); });
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
    // חלוקה לפי תיבת מייל (מוצג כשיש יותר מתיבה אחת ואין סינון לפי תיבה)
    const byAcct = {};
    rows.forEach((i) => { const a = acctOf(i); byAcct[a] = byAcct[a] || { n: 0, sum: 0 }; byAcct[a].n++; if ((i.currency || 'ILS') === 'ILS' && i.kind !== 'income') byAcct[a].sum += num(i.amount); });
    const acctKeys = Object.keys(byAcct);
    const split = (!acctF && acctKeys.length > 1)
      ? `<span class="inv-split">${acctKeys.sort((a, b) => (a === 'manual') - (b === 'manual') || a.localeCompare(b)).map((a) => `<button type="button" class="inv-sum acct" data-acct="${esc(a)}" title="סינון לפי תיבה זו"><i>${esc(acctLabel(a))}</i> ${byAcct[a].n} · ${fmtMoney(byAcct[a].sum, 'ILS')}</button>`).join('')}</span>` : '';
    el.innerHTML = `<span class="inv-sum"><i>מסמכים</i> ${rows.length}${rows.length !== all.length ? ' / ' + all.length : ''}</span>` + parts.join('') +
      (miss ? `<span class="inv-sum warn"><i>חסרים פרטים</i> ${miss}</span>` : '') + (rows.some((i) => !i.dokkaSentAt && i.kind !== 'income') && paidF !== 'nodokka' ? `<button type="button" class="inv-sum nodokka" id="inv-nodokka" title="הצגת ההוצאות שטרם נשלחו ל-Dokka"><i>טרם נשלחו ל-Dokka</i> ${rows.filter((i) => !i.dokkaSentAt && i.kind !== 'income').length}</button>` : '') + (rows.some((i) => !i.printedAt) && paidF !== 'unprinted' ? `<button type="button" class="inv-sum unprinted" id="inv-unprinted" title="הצגת החשבוניות שטרם הודפסו"><i>טרם הודפסו</i> ${rows.filter((i) => !i.printedAt).length}</button>` : '') + (selected.size ? `<span class="inv-sum sel"><i>נבחרו</i> ${selected.size} · ${fmtMoney(all.filter((i) => selected.has(i.id) && (i.currency || 'ILS') === 'ILS').reduce((t, i) => t + num(i.amount), 0), 'ILS')}</span>` : '') + split;
    el.querySelectorAll('[data-acct]').forEach((b) => b.onclick = () => { acctF = b.dataset.acct; render(); });
    const up = $('inv-unprinted'); if (up) up.onclick = () => { paidF = 'unprinted'; render(); };
    const nd = $('inv-nodokka'); if (nd) nd.onclick = () => { paidF = 'nodokka'; render(); };
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
    M('src').innerHTML = inv && inv.source === 'dokka'
      ? `<div class="inv-gmail-src">🔗 <b>הגיע מ-Dokka</b>${inv.dokkaCreated ? ' · נקלט ' + esc(fmtDate(inv.dokkaCreated)) : ''}${inv.dokkaCreatedBy ? ' · ' + esc(inv.dokkaCreatedBy) : ''}${inv.dokkaType ? ' · סוג: ' + esc(inv.dokkaType) : ''}${(inv.dokkaTags || []).length ? ' · תגיות: ' + esc(inv.dokkaTags.join(', ')) : ''}<br><small>מזהה Dokka: ${esc(inv.dokkaDocumentId || '')}${inv.manualEdit ? ' · תוקן ידנית (הסנכרון לא ידרוס)' : ' · הפרטים מתעדכנים אוטומטית מ-Dokka'}</small></div>`
      : inv && inv.source === 'gmail'
      ? `<div class="inv-gmail-src">✉ <b>${esc(inv.gmailFrom || '')}</b> · ${esc(inv.gmailSubject || '')}${inv.gmailDate ? ' · ' + fmtDate(inv.gmailDate) : ''}<br><small>תיבה: ${esc(acctOf(inv))}${inv.emailPrint ? ' · נשמר כ-PDF מגוף המייל (ללא קובץ מצורף)' : ''}</small></div>` : '';
    M('delete').hidden = !inv;
    M('printed').innerHTML = inv ? (inv.printedAt ? `<span class="pill printed">🖨 הודפס ${esc(fmtDate(inv.printedAt))}${inv.printedBy ? ' · ' + esc(displayName(inv.printedBy)) : ''}${Number(inv.printCount) > 1 ? ' · ' + inv.printCount + ' פעמים' : ''}</span> <button type="button" class="btn-ghost lw-mini" id="im-unprint">ביטול סימון</button>` : `<span class="pill pending">טרם הודפס</span> <button type="button" class="btn-ghost lw-mini" id="im-unprint">סימון כהודפס</button>`) : '';
    const tb = $('im-unprint'); if (tb) tb.onclick = () => markPrinted([inv], !inv.printedAt).then(() => openModal(all.find((x) => x.id === inv.id) || inv));
    M('dokka').innerHTML = inv ? (inv.dokkaSentAt ? `<span class="pill dokka">📤 נשלח ל-Dokka ${esc(fmtDate(inv.dokkaSentAt))}${inv.dokkaSentBy ? ' מ-' + esc(inv.dokkaSentBy) : ''}</span> <button type="button" class="btn-ghost lw-mini" id="im-dokka-again">שליחה חוזרת</button> <button type="button" class="btn-ghost lw-mini" id="im-dokka-un">ביטול סימון</button>` : `<span class="pill pending">טרם נשלח ל-Dokka</span> <button type="button" class="btn-ghost lw-mini" id="im-dokka-send">📤 שליחה ל-Dokka</button> <button type="button" class="btn-ghost lw-mini" id="im-dokka-mark" title="אם נשלח בדרך אחרת">סימון כנשלח</button>`) : '';
    const reopen = () => openModal(all.find((x) => x.id === inv.id) || inv);
    const bs = $('im-dokka-send') || $('im-dokka-again'); if (bs) bs.onclick = () => sendToDokka([inv], true).then(reopen);
    const bm = $('im-dokka-mark'); if (bm) bm.onclick = () => markDokka([inv], true, '').then(reopen);
    const bu = $('im-dokka-un'); if (bu) bu.onclick = () => markDokka([inv], false).then(reopen);
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
        if (current.source === 'dokka') upd.manualEdit = true;   // תיקון ידני — הסנכרון מ-DOKKA לא ידרוס אותו
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
    const rows = targetRows(); if (!rows.length) { alert('אין שורות לייצוא.'); return; }
    const cols = [['תאריך', (i) => fmtDay(i.date)], ['ספק / לקוח', (i) => i.supplier], ['מספר חשבונית', (i) => i.number], ['סוג', (i) => INVOICE_KINDS[i.kind] || 'הוצאה'],
      ['קטגוריה', (i) => i.category], ['סכום', (i) => i.amount || 0], ['מטבע', (i) => i.currency || 'ILS'], ['שולם', (i) => i.paid === false ? 'לא' : 'כן'],
      ['הערה', (i) => i.note], ['קובץ', (i) => i.fileName], ['קישור', (i) => i.url], ['מקור', (i) => i.source === 'gmail' ? 'מייל' : 'ידני'], ['תיבת מייל', (i) => i.source === 'gmail' ? acctOf(i) : ''], ['הודפס', (i) => i.printedAt ? fmtDay(String(i.printedAt).slice(0, 10)) : 'לא'], ['נשלח ל-Dokka', (i) => i.dokkaSentAt ? fmtDay(String(i.dokkaSentAt).slice(0, 10)) : 'לא'], ['נושא המייל', (i) => i.gmailSubject], ['שולח המייל', (i) => i.gmailFrom]];
    const cell = (v) => { const s = String(v == null ? '' : v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const csv = '﻿' + cols.map((c) => cell(c[0])).join(',') + '\r\n' + rows.map((i) => cols.map((c) => cell(c[1](i))).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'חשבוניות' + (periodF ? '-' + periodF.replace('y:', '') : '') + (supF ? '-' + safeSeg(supF, 20) : '') + '.csv';
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  async function downloadZip() {
    const rows = targetRows().filter((i) => i.url); if (!rows.length) { alert('אין קבצים להורדה.'); return; }
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
      a.download = 'חשבוניות' + (periodF ? '-' + periodF.replace('y:', '') : '') + (supF ? '-' + safeSeg(supF, 20) : '') + '.zip';
      document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    } catch (e) { alert('הורדת ה-ZIP נכשלה: ' + (e.message || e) + (e instanceof TypeError ? '\n(ייתכן שחסרה הגדרת CORS על ה-bucket — ראו README-STORAGE-CORS.md)' : '')); }
    btn.disabled = false; btn.textContent = orig;
  }

  /* ============================================================
     Dokka — גשר במייל: כל חשבונית נשלחת כמייל נפרד עם הקובץ המצורף לתיבת הקליטה של Dokka,
     מחשבון ה-Gmail המחובר (Gmail API, הרשאת send). נשמר dokkaSentAt/By/MsgId על המסמך.
     ============================================================ */
  async function markDokka(rows, on, msgIdBy) {
    const me = ctx.me(); const at = nowISO();
    await Promise.all(rows.map((i) => fs.updateDoc(fs.doc(db, 'invoices', i.id), on
      ? { dokkaSentAt: at, dokkaSentBy: (msgIdBy && msgIdBy[i.id] && msgIdBy[i.id].by) || gmailAccount || me.email || '', dokkaMsgId: (msgIdBy && msgIdBy[i.id] && msgIdBy[i.id].id) || '', dokkaCount: (Number(i.dokkaCount) || 0) + 1 }
      : { dokkaSentAt: '', dokkaSentBy: '', dokkaMsgId: '' }).catch((e) => console.warn('markDokka', e))));
    rows.forEach((i) => { i.dokkaSentAt = on ? at : ''; i.dokkaSentBy = on ? (gmailAccount || me.email || '') : ''; });
    render();
  }
  const utf8b64 = (str) => { const u = new TextEncoder().encode(str); let bin = ''; for (let k = 0; k < u.length; k += 0x8000) bin += String.fromCharCode.apply(null, u.subarray(k, k + 0x8000)); return btoa(bin); };
  const bytesB64 = (u) => { let bin = ''; for (let k = 0; k < u.length; k += 0x8000) bin += String.fromCharCode.apply(null, u.subarray(k, k + 0x8000)); return btoa(bin).replace(/(.{76})/g, '$1\r\n'); };
  const encHdr = (str) => '=?UTF-8?B?' + utf8b64(str) + '?=';
  function buildMime(to, subject, text, attName, attType, attBytes) {
    const b = 'hpg_' + Date.now().toString(36);
    const fn = encHdr(attName);
    return ['From: me', 'To: ' + to, 'Subject: ' + encHdr(subject), 'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="' + b + '"', '',
      '--' + b, 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', utf8b64(text).replace(/(.{76})/g, '$1\r\n'), '',
      '--' + b, 'Content-Type: ' + (attType || 'application/pdf') + '; name="' + fn + '"', 'Content-Disposition: attachment; filename="' + fn + '"', 'Content-Transfer-Encoding: base64', '', bytesB64(attBytes), '',
      '--' + b + '--', ''].join('\r\n');
  }
  async function gmailSendRaw(mime, retry) {
    const token = await getGmailToken();
    while (Date.now() < quotaPause) await new Promise((r) => setTimeout(r, 500));
    await throttle();
    const r = await fetch('https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'message/rfc822' }, body: mime });
    if (r.status === 401) { gmailToken = null; throw new Error('ההרשאה פגה — נסו שוב.'); }
    if (r.status === 403) { gmailToken = null; gmailPrompt = 'consent'; throw new Error('חסרה הרשאת שליחה — לחצו שוב ואשרו את ההרשאה בחלון של Google.'); }
    if (!r.ok) {
      let msg = 'HTTP ' + r.status; try { const j = await r.json(); msg = (j.error && j.error.message) || msg; } catch (e) {}
      if ((r.status === 429 || r.status >= 500) && (retry || 0) < 5) { await new Promise((w) => setTimeout(w, 2000 * Math.pow(2, retry || 0))); return gmailSendRaw(mime, (retry || 0) + 1); }
      throw new Error(msg);
    }
    return r.json();
  }
  async function sendToDokka(rowsArg, force) {
    if (!GMAIL_CLIENT_ID) { alert('חיבור Gmail לא הוגדר (GMAIL_CLIENT_ID).'); return; }
    const base = (Array.isArray(rowsArg) ? rowsArg : targetRows()).filter((i) => i.url);
    if (!base.length) { alert('אין חשבוניות לשליחה.'); return; }
    const income = base.filter((i) => i.kind === 'income').length;
    const sent = base.filter((i) => i.dokkaSentAt).length;
    const rows = force ? base : base.filter((i) => i.kind !== 'income' && !i.dokkaSentAt);
    if (!rows.length) {
      if (sent && confirm('כל ' + base.length + ' החשבוניות כבר נשלחו ל-Dokka. לשלוח שוב?')) return sendToDokka(base.filter((i) => i.kind !== 'income'), true);
      alert('אין מה לשלוח: ' + (income ? income + ' הכנסות (לא נשלחות ל-Dokka)' : '') + (sent ? (income ? ', ' : '') + sent + ' כבר נשלחו' : '') + '.'); return;
    }
    if (!force || rows.length > 1) {
      const note = [income ? income + ' הכנסות לא ייכללו' : '', sent && !force ? sent + ' כבר נשלחו וידולגו' : ''].filter(Boolean).join(' · ');
      if (!confirm('לשלוח ' + rows.length + ' חשבוניות ל-Dokka (' + DOKKA_EMAIL + ')?\nכל חשבונית נשלחת כמייל נפרד' + (gmailAccount ? ' מ-' + gmailAccount : ' מחשבון ה-Gmail שתאשרו') + '.' + (note ? '\n' + note : ''))) return;
    }
    const btn = $('inv-dokka'); const orig = btn ? btn.textContent : ''; if (btn) btn.disabled = true;
    let done = 0, failed = [], ids = {};
    try {
      if (!gmailAccount) { const prof = await gapi('profile'); gmailAccount = String(prof.emailAddress || '').toLowerCase(); }
      for (const i of rows) {
        if (btn) btn.textContent = 'שולח ' + (done + failed.length + 1) + '/' + rows.length + '…';
        try {
          const r = await fetch(i.url); if (!r.ok) throw new Error('HTTP ' + r.status);
          const bytes = new Uint8Array(await r.arrayBuffer());
          const subject = ['חשבונית', i.supplier, i.date ? fmtDay(i.date) : '', i.number ? '#' + i.number : ''].filter(Boolean).join(' · ');
          const text = ['חשבונית מארכיון Desk — הורייזון פסגות גרופ', 'ספק: ' + (i.supplier || '—'), 'תאריך: ' + fmtDay(i.date), 'מספר: ' + (i.number || '—'), 'סכום: ' + (i.amount ? fmtMoney(i.amount, i.currency) : '—'), 'קטגוריה: ' + (i.category || '—'), i.note ? 'הערה: ' + i.note : '', '', 'מזהה פנימי: ' + i.id].filter((x) => x !== '').join('\n');
          const ext = (i.fileName || '').match(/\.[a-z0-9]+$/i); const e = ext ? ext[0] : (isPdf(i) ? '.pdf' : '');
          const name = ([i.date, safeSeg(i.supplier, 40), i.number ? safeSeg(i.number, 20) : ''].filter(Boolean).join(' ') || safeSeg(i.fileName, 60) || 'invoice') + e;
          const res = await gmailSendRaw(buildMime(DOKKA_EMAIL, subject, text, name, i.contentType || (isPdf(i) ? 'application/pdf' : 'application/octet-stream'), bytes));
          ids[i.id] = { id: res.id || '', by: gmailAccount };
          done++;
          await markDokka([i], true, ids);
        } catch (err) { failed.push((i.supplier || '') + ' ' + (i.fileName || '') + ': ' + (err.message || err)); console.warn('dokka send', i, err); if (/הרשאת שליחה|ההרשאה פגה/.test(err.message || '')) break; }
      }
    } catch (err) { failed.push(err.message || String(err)); }
    if (btn) { btn.disabled = false; btn.textContent = orig; }
    render();
    alert('נשלחו ל-Dokka ' + done + ' חשבוניות' + (failed.length ? '.\nנכשלו ' + failed.length + ':\n' + failed.slice(0, 8).join('\n') : '.'));
  }

  /* ============================================================
     הדפסה — (1) המסמכים עצמם: איחוד כל הקבצים ל-PDF אחד (pdf-lib) ופתיחה להדפסה
             (2) הרשימה: דוח מעוצב עם סיכומים בחלון חדש → דיאלוג הדפסה
     פועל על הנבחרים, ואם לא נבחר כלום — על כל מה שמסונן.
     ============================================================ */
  // פותחים חלון מיד בלחיצה (אחרת הדפדפן חוסם פופאפ אחרי await), וממלאים אותו כשמוכן
  function openWaitWindow(title) {
    const w = window.open('', '_blank');
    if (!w) return null;
    w.document.write('<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>' + esc(title) + '</title></head><body style="font-family:Arial,sans-serif;padding:2rem;color:#333"><p id="st">מכין את הקובץ להדפסה…</p></body></html>');
    w.document.close();
    return w;
  }
  const wsay = (w, t) => { try { const el = w.document.getElementById('st'); if (el) el.textContent = t; } catch (e) {} };
  function loadPdfLib() { return loadLib('pdf-lib', 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js', () => !!window.PDFLib); }
  async function imageToPng(blob) {
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('תמונה לא נתמכת')); im.src = url; });
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      const out = await new Promise((res) => c.toBlob(res, 'image/png'));
      return new Uint8Array(await out.arrayBuffer());
    } finally { URL.revokeObjectURL(url); }
  }
  async function printDocs() {
    const rows = targetRows().filter((i) => i.url);
    if (!rows.length) { alert('אין מסמכים להדפסה.'); return; }
    if (rows.length > 60 && !confirm('להדפיס ' + rows.length + ' מסמכים בקובץ אחד? זה עלול לקחת זמן.')) return;
    const w = openWaitWindow('הדפסת חשבוניות');
    if (!w) { alert('הדפדפן חסם את החלון. אפשרו חלונות קופצים לאתר ונסו שוב.'); return; }
    const btn = $('inv-print-btn'); const orig = btn.textContent; btn.disabled = true;
    try {
      await loadPdfLib();
      const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
      const out = await PDFDocument.create();
      const font = await out.embedFont(StandardFonts.Helvetica);
      let n = 0, failed = [];
      for (const i of rows) {
        btn.textContent = 'מכין ' + (++n) + '/' + rows.length + '…'; wsay(w, 'מכין ' + n + '/' + rows.length + ' — ' + (i.supplier || i.fileName || ''));
        try {
          const r = await fetch(i.url); if (!r.ok) throw new Error('HTTP ' + r.status);
          const blob = await r.blob();
          const pdfish = isPdf(i) || /pdf/i.test(blob.type);
          if (pdfish) {
            const src = await PDFDocument.load(await blob.arrayBuffer(), { ignoreEncryption: true });
            const pages = await out.copyPages(src, src.getPageIndices());
            pages.forEach((pg) => out.addPage(pg));
          } else {
            let img; try { img = await out.embedJpg(await blob.arrayBuffer()); } catch (e) { img = await out.embedPng(await imageToPng(blob)); }
            const pg = out.addPage([595.28, 841.89]);   // A4
            const scale = Math.min((595.28 - 40) / img.width, (841.89 - 40) / img.height, 1.5);
            const wdt = img.width * scale, hgt = img.height * scale;
            pg.drawImage(img, { x: (595.28 - wdt) / 2, y: 841.89 - 20 - hgt, width: wdt, height: hgt });
          }
          // כותרת קטנה (לטינית בלבד — פונט סטנדרטי) בתחתית העמוד הראשון של כל מסמך: תאריך וסכום
          const last = out.getPage(out.getPageCount() - 1);
          const label = [i.date, i.number ? '#' + i.number : '', i.amount ? Number(i.amount).toFixed(2) + ' ' + (i.currency || 'ILS') : ''].filter(Boolean).join('  ');
          if (label) last.drawText(label, { x: 20, y: 8, size: 7, font, color: rgb(0.5, 0.5, 0.5) });
        } catch (e) { failed.push((i.supplier || '') + ' ' + (i.fileName || '')); console.warn('print merge', i, e); }
      }
      if (!out.getPageCount()) throw new Error('לא הצלחתי לקרוא אף מסמך' + (failed.length ? ' (' + failed.length + ' נכשלו)' : ''));
      const bytes = await out.save();
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      w.location.href = url;
      markPrinted(rows.filter((i) => !failed.includes((i.supplier || '') + ' ' + (i.fileName || ''))), true);
      if (failed.length) setTimeout(() => alert(failed.length + ' מסמכים לא נכללו בהדפסה (קובץ פגום או לא נתמך):\n' + failed.slice(0, 10).join('\n')), 500);
    } catch (e) {
      wsay(w, 'ההכנה נכשלה: ' + (e.message || e));
      alert('הכנת ההדפסה נכשלה: ' + (e.message || e) + (e instanceof TypeError ? '\n(ייתכן שחסרה הגדרת CORS על ה-bucket — ראו README-STORAGE-CORS.md)' : ''));
    }
    btn.disabled = false; btn.textContent = orig;
  }
  /* ---- הדפסה בנפרד: מסמך אחרי מסמך, כל אחד עבודת הדפסה משלו ----
     הקובץ נטען ל-iframe (PDF בצופה של הדפדפן, תמונה בעמוד HTML) ו-print() נקרא עליו.
     "ברצף": print() חוסם עד שסוגרים את דיאלוג ההדפסה, לכן אפשר פשוט לעבור בלולאה. */
  const P = (id) => $('ip-' + id);
  let pq = [], pi = 0, pUrl = '', pRun = false;
  function closePrint() { pRun = false; $('inv-print-modal').hidden = true; P('frame').src = 'about:blank'; if (pUrl) { URL.revokeObjectURL(pUrl); pUrl = ''; } }
  $('inv-print-close').addEventListener('click', closePrint);
  P('done').addEventListener('click', closePrint);
  function printSeparately() {
    pq = targetRows().filter((i) => i.url);
    if (!pq.length) { alert('אין מסמכים להדפסה.'); return; }
    pi = 0; $('inv-print-modal').hidden = false; loadPrintDoc();
  }
  async function loadPrintDoc() {
    const i = pq[pi]; if (!i) return;
    P('title').textContent = 'הדפסה בנפרד — מסמך ' + (pi + 1) + ' מתוך ' + pq.length;
    P('name').textContent = [fmtDay(i.date), i.supplier, i.number ? '#' + i.number : '', i.amount ? fmtMoney(i.amount, i.currency) : '', i.fileName].filter(Boolean).join(' · ');
    P('prev').disabled = pi === 0; P('next').disabled = pi >= pq.length - 1; P('print').disabled = true; P('all').disabled = true;
    P('printed').innerHTML = i.printedAt ? `<span class="pill printed">🖨 הודפס ${esc(fmtDate(i.printedAt))}</span>` : '<span class="pill pending">טרם הודפס</span>';
    P('unmark').textContent = i.printedAt ? 'ביטול סימון "הודפס"' : 'סימון כהודפס';
    P('status').textContent = 'טוען…';
    if (pUrl) { URL.revokeObjectURL(pUrl); pUrl = ''; }
    try {
      const r = await fetch(i.url); if (!r.ok) throw new Error('HTTP ' + r.status);
      const blob = await r.blob();
      if (isPdf(i) || /pdf/i.test(blob.type)) pUrl = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
      else {
        const imgUrl = URL.createObjectURL(blob);
        pUrl = URL.createObjectURL(new Blob(['<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%}img{display:block;max-width:100%;max-height:100vh;margin:auto}@media print{@page{margin:10mm}img{max-height:none;width:100%}}</style></head><body><img src="' + imgUrl + '"></body></html>'], { type: 'text/html' }));
      }
      await new Promise((res, rej) => { const f = P('frame'); f.onload = () => res(); f.onerror = () => rej(new Error('טעינה נכשלה')); f.src = pUrl; });
      await new Promise((res) => setTimeout(res, 400));   // לצופה ה-PDF לסיים לצייר
      P('status').textContent = ''; P('print').disabled = false; P('all').disabled = false;
    } catch (e) { P('status').textContent = 'לא ניתן לטעון את הקובץ: ' + (e.message || e) + (e instanceof TypeError ? ' (CORS?)' : ''); console.warn('print sep', i, e); }
  }
  function printFrame() {
    const f = P('frame');
    try { f.contentWindow.focus(); f.contentWindow.print(); return true; }
    catch (e) { console.warn('frame print', e); window.open(pUrl, '_blank'); return false; }
  }
  P('print').addEventListener('click', () => { if (printFrame()) markPrinted([pq[pi]], true); else loadPrintDoc(); });
  P('unmark').addEventListener('click', () => { const i = pq[pi]; if (i) markPrinted([i], !i.printedAt).then(loadPrintDoc); });
  P('prev').addEventListener('click', () => { if (pi > 0) { pi--; loadPrintDoc(); } });
  P('next').addEventListener('click', () => { if (pi < pq.length - 1) { pi++; loadPrintDoc(); } });
  P('all').addEventListener('click', async () => {
    // ברצף מהמסמך הנוכחי: לכל מסמך נפתח דיאלוג הדפסה משלו (print חוסם עד שסוגרים אותו); ביטול בדיאלוג = דילוג
    pRun = true; P('all').disabled = true;
    let sent = 0;
    while (pRun && pi < pq.length) {
      if (P('print').disabled) await loadPrintDoc();
      if (!pRun) break;
      if (!P('print').disabled) { P('status').textContent = 'שולח להדפסה ' + (pi + 1) + '/' + pq.length + '…'; if (printFrame()) { markPrinted([pq[pi]], true); sent++; } }
      if (pi >= pq.length - 1) break;
      pi++; await loadPrintDoc();
    }
    if (pRun) P('status').textContent = sent + ' מסמכים נשלחו להדפסה.';
    pRun = false; P('all').disabled = false;
  });
  function printList() {
    const rows = targetRows();
    if (!rows.length) { alert('אין שורות להדפסה.'); return; }
    const w = window.open('', '_blank');
    if (!w) { alert('הדפדפן חסם את החלון. אפשרו חלונות קופצים לאתר ונסו שוב.'); return; }
    const [from, to] = periodRange();
    const sums = {}; rows.forEach((i) => { const c = i.currency || 'ILS'; sums[c] = sums[c] || { expense: 0, income: 0 }; sums[c][i.kind === 'income' ? 'income' : 'expense'] += num(i.amount); });
    const title = 'חשבוניות' + (selected.size ? ' — נבחרות' : '') + (from || to ? ' · ' + (from ? fmtDay(from) : '…') + ' – ' + (to ? fmtDay(to) : '…') : '') + (supF ? ' · ' + (rows[0] && rows[0].supplier || supF) : '');
    const filters = [periodF && periodF !== 'custom' ? (PERIODS.find((x) => x[0] === periodF) || [, 'שנת ' + periodF.replace('y:', '')])[1] : '', kindF ? INVOICE_KINDS[kindF] : '', catF, acctF ? acctLabel(acctF) : '', paidF ? { paid: 'שולם', unpaid: 'לא שולם', missing: 'חסרים פרטים', emailprint: 'מגוף המייל' }[paidF] : '', minF !== '' || maxF !== '' ? 'סכום ' + (minF || '0') + '–' + (maxF || '∞') : '', q.trim() ? 'חיפוש: ' + q.trim() : ''].filter(Boolean);
    const tr = rows.map((i) => `<tr><td>${fmtDay(i.date)}</td><td>${esc(i.supplier || '—')}</td><td>${esc(i.number || '—')}</td><td>${esc(i.category || '—')}</td><td>${INVOICE_KINDS[i.kind] || 'הוצאה'}</td><td class="n">${i.amount ? fmtMoney(i.amount, i.currency) : '—'}</td><td>${i.paid === false ? 'לא' : 'כן'}</td><td>${i.printedAt ? fmtDay(String(i.printedAt).slice(0, 10)) : '—'}</td><td>${i.source === 'gmail' ? esc(acctShort(acctOf(i))) : 'ידני'}</td></tr>`).join('');
    const totals = Object.keys(sums).map((c) => `<tr class="t"><td colspan="5">סה״כ הוצאות (${c})</td><td class="n">${fmtMoney(sums[c].expense, c)}</td><td colspan="3"></td></tr>` + (sums[c].income ? `<tr class="t"><td colspan="5">סה״כ הכנסות (${c})</td><td class="n">${fmtMoney(sums[c].income, c)}</td><td colspan="3"></td></tr>` : '')).join('');
    w.document.write(`<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font-family:Arial,Helvetica,sans-serif;color:#222;margin:24px;font-size:12px}h1{font-size:18px;margin:0 0 4px}.sub{color:#666;font-size:11px;margin-bottom:14px}table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #ddd;padding:6px 8px;text-align:right;vertical-align:top}th{background:#f3efe9;font-size:11px}td.n{direction:ltr;text-align:right;white-space:nowrap;font-weight:700}tr.t td{border-top:2px solid #333;font-weight:700;background:#faf7f2}@media print{body{margin:10mm}button{display:none}}</style></head><body>
<h1>הורייזון פסגות גרופ — ${esc(title)}</h1>
<div class="sub">${rows.length} מסמכים${filters.length ? ' · סינון: ' + esc(filters.join(' · ')) : ''} · הופק ${fmtDate(nowISO())}</div>
<table><thead><tr><th>תאריך</th><th>ספק / מוצר</th><th>מס׳ חשבונית</th><th>קטגוריה</th><th>סוג</th><th>סכום</th><th>שולם</th><th>הודפס</th><th>מקור</th></tr></thead><tbody>${tr}${totals}</tbody></table>
<p style="margin-top:16px"><button onclick="window.print()" style="font:inherit;padding:8px 16px;cursor:pointer">🖨 הדפסה</button></p>
<script>setTimeout(function(){window.print()},300)<\/script></body></html>`);
    w.document.close();
  }

  /* ============================================================
     ייבוא מ-Gmail — כפתור אחד, בלי אפשרויות:
     סורק את כל התיבה מההתחלה · כל קובץ מצורף (PDF/תמונה) + כל מייל שנראה כמו חשבונית גם בלי קובץ
     (CapCut, Apple, Google, Meta…) · מדרג לבד מה חשבונית · מה שזוהה מסומן, השאר מוצג לבחירה.
     מיילים שכבר יובאו לא נסרקים שוב. רץ כולו בדפדפן (Google Identity Services + Gmail REST, קריאה בלבד).
     ============================================================ */
  const G = (id) => $('ig-' + id);
  let scanning = false;
  $('inv-gmail').addEventListener('click', openGmail);
  function openGmail() {
    gmailResults = []; gmailBody = [];
    G('setup').hidden = !!GMAIL_CLIENT_ID;
    G('body').hidden = !GMAIL_CLIENT_ID;
    G('list').innerHTML = '';
    G('status').textContent = '';
    G('import').disabled = true;
    G('filter').value = '';
    renderAcct();
    $('inv-gmail-modal').hidden = false;
  }
  function renderAcct() { G('acct').textContent = gmailAccount || 'עדיין לא מחובר — בלחיצה על סריקה ייפתח חלון התחברות של Google'; }
  G('switch').addEventListener('click', () => { gmailToken = null; gmailAccount = ''; gmailPrompt = 'select_account'; renderAcct(); G('status').textContent = 'בסריקה הבאה תתבקשו לבחור חשבון Google אחר.'; });
  const closeGmail = () => { if (scanning && !confirm('הסריקה עדיין רצה. לסגור בכל זאת?')) return; $('inv-gmail-modal').hidden = true; };
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
        client_id: GMAIL_CLIENT_ID, scope: GMAIL_SCOPE, prompt: gmailPrompt, ...(gmailPrompt ? {} : { hint: GMAIL_LOGIN_HINT }),
        callback: (r) => { if (r.error) { rej(new Error(r.error_description || r.error)); return; } gmailToken = { token: r.access_token, exp: Date.now() + (Number(r.expires_in) || 3600) * 1000 }; gmailPrompt = ''; res(r.access_token); },
        error_callback: (e) => rej(new Error(e && e.type === 'popup_closed' ? 'חלון ההתחברות נסגר' : (e && e.message) || 'שגיאת התחברות ל-Google')),
      });
      client.requestAccessToken();
    });
  }
  // ויסות קצב: מכסת Gmail היא 15,000 יחידות לדקה למשתמש (כל קריאה ≈ 5) → עד ~40 קריאות בשנייה בבטחה
  const RATE = 35; let stamps = [];
  async function throttle() {
    for (;;) {
      const now = Date.now(); stamps = stamps.filter((t) => now - t < 1000);
      if (stamps.length < RATE) { stamps.push(now); return; }
      await new Promise((r) => setTimeout(r, 1000 - (now - stamps[0]) + 5));
    }
  }
  let quotaPause = 0;   // כשגוגל מחזיר "quota exceeded" — כל הקריאות ממתינות יחד
  async function gapi(path, params, retry) {
    const token = await getGmailToken();
    while (Date.now() < quotaPause) await new Promise((r) => setTimeout(r, 500));
    await throttle();
    const sp = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => (Array.isArray(v) ? v : [v]).forEach((x) => sp.append(k, x)));
    const url = 'https://gmail.googleapis.com/gmail/v1/users/me/' + path + (params ? '?' + sp : '');
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    if (r.status === 401) { gmailToken = null; throw new Error('ההרשאה פגה — נסו שוב.'); }
    if (!r.ok) {
      let msg = 'HTTP ' + r.status; try { const j = await r.json(); msg = (j.error && j.error.message) || msg; } catch (e) {}
      const quota = r.status === 429 || /quota|rate ?limit|too many/i.test(msg);
      if ((quota || r.status >= 500) && (retry || 0) < 10) {
        // מכסה לדקה: עוצרים את כולם ל-20–30 שניות ומנסים שוב; שגיאת שרת: המתנה קצרה
        const wait = quota ? 20000 + Math.random() * 10000 : Math.min(8000, 500 * Math.pow(2, retry || 0));
        if (quota) { quotaPause = Math.max(quotaPause, Date.now() + wait); if (scanning) G('status').textContent = 'Gmail ביקש להאט — ממתין ' + Math.round(wait / 1000) + ' שניות וממשיך אוטומטית…'; }
        await new Promise((w) => setTimeout(w, wait));
        return gapi(path, params, (retry || 0) + 1);
      }
      throw new Error(msg);
    }
    return r.json();
  }
  // הרצה במקביל (עד N בו-זמנית) עם דיווח התקדמות
  async function pmap(items, n, fn, onStep) {
    let i = 0, done = 0; const out = new Array(items.length);
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) { const k = i++; try { out[k] = await fn(items[k], k); } catch (e) { out[k] = null; console.warn('gmail item', e); } done++; if (onStep) onStep(done); }
    }));
    return out;
  }
  async function listIds(q, cap) {
    let ids = [], pageToken = '';
    do {
      const r = await gapi('messages', { q, maxResults: 500, ...(pageToken ? { pageToken } : {}) });
      ids = ids.concat((r.messages || []).map((m) => m.id)); pageToken = r.nextPageToken || '';
      G('status').textContent = 'נמצאו ' + ids.length + ' מיילים…';
    } while (pageToken && ids.length < cap);
    return { ids, capped: !!pageToken };
  }
  const hdr = (msg, name) => { const h = ((msg.payload || {}).headers || []).find((x) => x.name.toLowerCase() === name); return h ? h.value : ''; };
  function attachmentsOf(payload, out) {
    out = out || [];
    if (!payload) return out;
    const name = payload.filename || (/pdf/i.test(payload.mimeType || '') ? 'attachment.pdf' : '');
    const size = (payload.body && payload.body.size) || 0;
    const isImg = /^image\//i.test(payload.mimeType || '') || /\.(jpe?g|png|webp|heic)$/i.test(name);
    const inline = (payload.headers || []).some((h) => h.name.toLowerCase() === 'content-disposition' && /^inline/i.test(h.value || ''));
    // תמונות: מדלגים על לוגואים בחתימה (inline) ועל תמונות קטנות מ-30KB — חשבונית מצולמת גדולה בהרבה
    const skipImg = isImg && (inline || size < 30 * 1024 || /^(image\d{3}|outlook-|logo|signature|icon)/i.test(name));
    if (name && payload.body && payload.body.attachmentId && okType(payload.mimeType, name) && !skipImg)
      out.push({ id: payload.body.attachmentId, name, size, mime: payload.mimeType });
    (payload.parts || []).forEach((p) => attachmentsOf(p, out));
    return out;
  }
  /* ---- דירוג: האם זה נראה כמו חשבונית? ----
     חזק = מילה מפורשת בנושא/בשם הקובץ · בינוני = שולח של חיובים/ספק מוכר · חלש = סכומים בתקציר */
  const RX_STRONG = /חשבונית|קבלה|אישור תשלום|דרישת תשלום|invoice|receipt|tax[ -]?invoice|payment (confirmation|received|successful)|your (order|purchase|subscription|payment)|order confirmation|billing statement|statement of account/i;
  const RX_SENDER = /billing|invoice|receipt|payment|pay(ments)?@|accounts?@|finance|noreply@(apple|google|meta|facebookmail|capcut|bytedance|canva|adobe|microsoft|wix|godaddy|namecheap|cloudflare|monday|notion|zoom|slack|openai|anthropic|make|elementor|shopify|aws|amazon|digitalocean|hostinger|paypal|stripe|cardcom|tranzila|icount|greeninvoice|morning|ezcount|sumit|bezeq|partner|cellcom|hot|pelephone|golan|019|012|013)|apple\.com|google\.com|facebookmail\.com|capcut|bytedance|canva\.com|adobe\.com|paypal|stripe|cardcom|tranzila|icount|greeninvoice|ezcount|sumit|morning|בזק|פרטנר|סלקום|הוט|פלאפון|חברת החשמל|עיריית|מי /i;
  const RX_WEAK = /סה["״]?כ|סכום|לתשלום|שולם|total|amount|paid|₪|nis|ils|\$\s?\d|\d\s?\$|usd|eur|€/i;
  const RX_NOT = /newsletter|unsubscribe|webinar|promo|sale|discount|הנחה|מבצע|ניוזלטר|הרשמה|job|career|resume|קורות חיים|linkedin|facebook notification|security alert|verify your|verification code|קוד אימות|password/i;
  function invoiceScore(x) {
    const subj = x.subject || '', from = x.from || '', fname = x.fileName || '', snip = x.snippet || '';
    let s = 0;
    if (RX_STRONG.test(subj) || RX_STRONG.test(fname)) s += 2;
    if (RX_SENDER.test(from)) s += 1;
    if (RX_WEAK.test(snip) || RX_WEAK.test(subj)) s += 1;
    if (/\.pdf$/i.test(fname) && /^(inv|rec|חש|קב|bill|order|\d{4,})/i.test(fname)) s += 1;
    if (RX_NOT.test(subj) && !RX_STRONG.test(subj)) s -= 2;
    return s;
  }
  const likely = (x) => invoiceScore(x) >= 2;
  const alreadyImported = (msgId, name) => all.some((i) => i.gmailMessageId === msgId && i.fileName === name);
  const alreadyPrinted = (msgId) => all.some((i) => i.gmailMessageId === msgId && i.emailPrint);
  const importedMsgIds = () => new Set(all.filter((i) => i.gmailMessageId).map((i) => i.gmailMessageId));
  // אותה חשבונית שהגיעה לשתי תיבות: אותו שם קובץ + אותו גודל + אותו יום — לא מסומנת כברירת מחדל
  const inOtherAcct = (r) => all.some((i) => i.source === 'gmail' && acctOf(i) !== gmailAccount && i.fileName === r.att.name && i.size === r.att.size && i.gmailDate && i.gmailDate.slice(0, 10) === (r.date || '').slice(0, 10));
  const fromName = (f) => String(f || '').replace(/<.*>/, '').replace(/"/g, '').trim();
  const dayOf = (d) => isNaN(d) ? '' : `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;

  /* ---- הסריקה המלאה ---- */
  G('search').addEventListener('click', async () => {
    if (scanning) return;
    scanning = true; G('search').disabled = true;
    G('status').textContent = 'מתחבר ל-Gmail…'; G('list').innerHTML = ''; G('import').disabled = true; G('import').textContent = 'ייבוא נבחרים'; gmailResults = []; gmailBody = [];
    try {
      if (!gmailAccount) { const prof = await gapi('profile'); gmailAccount = String(prof.emailAddress || '').toLowerCase(); renderAcct(); }
      const skip = importedMsgIds();
      // שלב 1: כל המיילים עם PDF/תמונה מצורפים — כל ההיסטוריה
      const a = await listIds('has:attachment (filename:pdf OR filename:jpg OR filename:jpeg OR filename:png OR filename:webp OR filename:heic)', GMAIL_MAX_MSGS);
      const aIds = a.ids.filter((id) => !skip.has(id));
      let skippedA = a.ids.length - aIds.length;
      await pmap(aIds, 6, async (id) => {
        const m = await gapi('messages/' + id, { format: 'full' });
        const atts = attachmentsOf(m.payload);
        if (!atts.length) return;
        const d = new Date(Number(m.internalDate)), from = hdr(m, 'from'), subject = hdr(m, 'subject');
        atts.forEach((att) => gmailResults.push({ msgId: id, att, from, subject, snippet: m.snippet || '', date: isNaN(d) ? '' : d.toISOString(), day: dayOf(d), fileName: att.name }));
      }, (n) => { if (Date.now() >= quotaPause) G('status').textContent = 'שלב 1/2 · קורא מיילים עם קבצים ' + n + '/' + aIds.length + (aIds.length > 600 ? ' (בתיבה גדולה זה כמה דקות — אפשר להשאיר פתוח)' : '') + '…'; });
      // שלב 2: מיילים שנראים כמו חשבונית בלי קובץ מצורף (נשמרים כ-PDF של המייל)
      const b = await listIds(GMAIL_KEYWORDS + ' -has:attachment', GMAIL_MAX_BODY);
      const bIds = b.ids.filter((id) => !skip.has(id));
      await pmap(bIds, 6, async (id) => {
        const m = await gapi('messages/' + id, { format: 'metadata', metadataHeaders: ['From', 'Subject'] });
        const d = new Date(Number(m.internalDate));
        gmailBody.push({ msgId: id, from: hdr(m, 'from'), subject: hdr(m, 'subject'), snippet: m.snippet || '', date: isNaN(d) ? '' : d.toISOString(), day: dayOf(d) });
      }, (n) => { if (Date.now() >= quotaPause) G('status').textContent = 'שלב 2/2 · בודק מיילים ללא קובץ ' + n + '/' + bIds.length + '…'; });
      gmailResults.sort((x, y) => (y.date || '').localeCompare(x.date || ''));
      gmailBody.sort((x, y) => (y.date || '').localeCompare(x.date || ''));
      const notes = [];
      if (skippedA + (b.ids.length - bIds.length)) notes.push((skippedA + (b.ids.length - bIds.length)) + ' מיילים כבר יובאו בעבר ודולגו');
      if (a.capped || b.capped) notes.push('התיבה גדולה מאוד — נסרקו ' + GMAIL_MAX_MSGS + ' המיילים האחרונים עם קבצים; ייבאו אותם והריצו שוב לסריקת השאר');
      renderGmailList(notes.length ? ' · ' + notes.join(' · ') : '');
    } catch (e) {
      console.warn('gmail scan', e);
      if (gmailResults.length || gmailBody.length) renderGmailList(' · הסריקה נעצרה באמצע (' + (e.message || e) + ') — אפשר לייבא את מה שנמצא ולהריץ שוב');
      else G('status').textContent = 'שגיאה: ' + (e.message || e);
    }
    scanning = false; G('search').disabled = false;
  });

  function itemHTML(r, k, isBody) {
    const dup = isBody ? alreadyPrinted(r.msgId) : alreadyImported(r.msgId, r.att.name);
    const other = !isBody && !dup && inOtherAcct(r);
    const on = !dup && !other && likely(r);
    const txt = esc((r.from + ' ' + r.subject + ' ' + (isBody ? r.snippet : r.att.name)).toLowerCase());
    const head = isBody
      ? `📧 ${esc(fromName(r.from))} <small style="display:inline">${fmtDay(r.day)}</small>`
      : `${isPdf({ contentType: r.att.mime, fileName: r.att.name }) ? '📄' : '🖼'} ${esc(r.att.name)} <small style="display:inline">${fmtSize(r.att.size)} · ${fmtDay(r.day)}</small>`;
    const sub = isBody ? `${esc(r.subject)}${r.snippet ? ' — ' + esc(r.snippet.slice(0, 90)) : ''}` : `${esc(fromName(r.from))} · ${esc(r.subject)}`;
    const tag = dup ? '<span class="pill received">יובא</span>' : other ? '<span class="pill pending" title="קובץ זהה כבר יובא מתיבה אחרת">קיים בתיבה אחרת</span>' : isBody ? '<span class="pill pending" title="אין קובץ מצורף — המייל עצמו יישמר כ-PDF">מייל→PDF</span>' : '';
    return `<label class="lw-item ig-item${dup ? ' dup' : ''}" data-txt="${txt}" data-on="${on ? 1 : 0}"><input type="checkbox" data-${isBody ? 'b' : 'k'}="${k}"${dup ? ' disabled' : on ? ' checked' : ''}><span><b>${head}</b><small>${sub}</small></span>${tag}</label>`;
  }
  function renderGmailList(extra) {
    const items = gmailResults.map((r, k) => ({ r, k, body: false })).concat(gmailBody.map((r, k) => ({ r, k, body: true })));
    const isDup = (it) => it.body ? alreadyPrinted(it.r.msgId) : alreadyImported(it.r.msgId, it.r.att.name);
    const yes = items.filter((it) => !isDup(it) && likely(it.r) && !(it.body ? false : inOtherAcct(it.r)));
    const maybe = items.filter((it) => !isDup(it) && !yes.includes(it));
    const dups = items.filter(isDup);
    const byDate = (x, y) => (y.r.date || '').localeCompare(x.r.date || '');
    const sec = (title, arr) => arr.length ? `<h5 class="ig-sec">${title} (${arr.length})</h5>` + arr.sort(byDate).map((it) => itemHTML(it.r, it.k, it.body)).join('') : '';
    G('status').textContent = (items.length ? `זוהו ${yes.length} חשבוניות · עוד ${maybe.length} פריטים לבדיקה` + (dups.length ? ` · ${dups.length} כבר יובאו` : '') : 'לא נמצאו קבצים מצורפים או מיילים של חשבוניות.') + (extra || '');
    G('list').innerHTML =
      sec('✅ זוהו כחשבוניות — מסומנות לייבוא', yes) +
      sec('❓ לא בטוח — עברו ברשימה וסמנו מה שרלוונטי (קבצים מצורפים אחרים ומיילים עם מילות תשלום)', maybe) +
      sec('כבר בארכיון', dups);
    const upd = () => { const n = G('list').querySelectorAll('input:checked:not(:disabled)').length; G('import').disabled = !n; G('import').textContent = 'ייבוא ' + (n ? n + ' פריטים' : 'נבחרים'); };
    G('list').querySelectorAll('input').forEach((c) => c.onchange = upd); upd();
    const visible = () => Array.from(G('list').querySelectorAll('.ig-item')).filter((el) => !el.hidden);
    const applyFilter = () => { const f = G('filter').value.trim().toLowerCase(); G('list').querySelectorAll('.ig-item').forEach((el) => { el.hidden = !!f && !(el.dataset.txt || '').includes(f); }); };
    G('filter').oninput = applyFilter; applyFilter();
    G('all').onclick = () => { visible().forEach((el) => { const c = el.querySelector('input'); if (!c.disabled) c.checked = true; }); upd(); };
    G('none').onclick = () => { visible().forEach((el) => { el.querySelector('input').checked = false; }); upd(); };
  }

  /* ---- שמירת מייל כ-PDF (html2canvas + jsPDF, נטענים לפי צורך) ---- */
  const libP = {};
  function loadLib(key, src, ready) {
    if (ready()) return Promise.resolve();
    if (!libP[key]) libP[key] = new Promise((res, rej) => { const el = document.createElement('script'); el.src = src; el.onload = res; el.onerror = () => { libP[key] = null; rej(new Error('טעינת ' + key + ' נכשלה')); }; document.head.appendChild(el); });
    return libP[key];
  }
  const b64 = (d) => { const bin = atob(String(d || '').replace(/-/g, '+').replace(/_/g, '/')); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
  const b64text = (d) => new TextDecoder('utf-8').decode(b64(d));
  function bodyPart(payload, mime) {
    if (!payload) return '';
    if ((payload.mimeType || '').toLowerCase() === mime && payload.body && payload.body.data) return b64text(payload.body.data);
    for (const p of payload.parts || []) { const r = bodyPart(p, mime); if (r) return r; }
    return '';
  }
  async function emailToPdfBlob(msgId, info) {
    await Promise.all([
      loadLib('html2canvas', 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js', () => !!window.html2canvas),
      loadLib('jspdf', 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', () => !!(window.jspdf && window.jspdf.jsPDF)),
    ]);
    const m = await gapi('messages/' + msgId, { format: 'full' });
    let html = bodyPart(m.payload, 'text/html');
    if (!html) { const t = bodyPart(m.payload, 'text/plain') || m.snippet || ''; html = '<pre style="white-space:pre-wrap;font:14px/1.6 sans-serif">' + esc(t) + '</pre>'; }
    // ניקוי: בלי סקריפטים/טפסים/אירועים — רק תצוגה
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script,iframe,object,embed,form,link,meta,base').forEach((n) => n.remove());
    doc.querySelectorAll('*').forEach((n) => { Array.from(n.attributes).forEach((at) => { if (/^on/i.test(at.name) || (at.name === 'href' && /^javascript:/i.test(at.value))) n.removeAttribute(at.name); }); });
    const styles = Array.from(doc.querySelectorAll('style')).map((st) => st.outerHTML).join('');
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:-20000px;top:0;width:794px;background:#fff;color:#000;padding:28px;box-sizing:border-box;direction:ltr;font:14px/1.5 Arial,sans-serif;z-index:-1';
    box.innerHTML = styles + '<div style="border-bottom:1px solid #ccc;padding-bottom:10px;margin-bottom:14px;font:12px/1.6 Arial,sans-serif;color:#333;direction:ltr">' +
      '<div><b>From:</b> ' + esc(info.from) + '</div><div><b>Subject:</b> ' + esc(info.subject) + '</div><div><b>Date:</b> ' + esc(info.date ? new Date(info.date).toLocaleString('en-GB') : '') + '</div>' +
      '<div><b>Gmail account:</b> ' + esc(gmailAccount) + ' · message id ' + esc(msgId) + '</div></div>' + doc.body.innerHTML;
    box.querySelectorAll('img').forEach((im) => { im.setAttribute('crossorigin', 'anonymous'); im.style.maxWidth = '100%'; });
    document.body.appendChild(box);
    try {
      await new Promise((r) => setTimeout(r, 400));   // לתת לתמונות להיטען
      const canvas = await window.html2canvas(box, { scale: 1.5, useCORS: true, allowTaint: false, logging: false, backgroundColor: '#ffffff', imageTimeout: 4000 });
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
      const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight();
      const pageH = Math.floor(canvas.width * ph / pw);
      let y = 0, first = true;
      while (y < canvas.height) {
        const h = Math.min(pageH, canvas.height - y);
        const slice = document.createElement('canvas'); slice.width = canvas.width; slice.height = h;
        slice.getContext('2d').drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
        if (!first) pdf.addPage(); first = false;
        pdf.addImage(slice.toDataURL('image/jpeg', 0.85), 'JPEG', 0, 0, pw, h * pw / canvas.width);
        y += h;
      }
      return pdf.output('blob');
    } finally { box.remove(); }
  }

  /* ---- ייבוא הנבחרים ---- */
  G('import').addEventListener('click', async () => {
    const checked = Array.from(G('list').querySelectorAll('input:checked:not(:disabled)'));
    const picks = checked.filter((c) => c.dataset.k != null).map((c) => gmailResults[Number(c.dataset.k)]);
    const bodyPicks = checked.filter((c) => c.dataset.b != null).map((c) => gmailBody[Number(c.dataset.b)]);
    if (!picks.length && !bodyPicks.length) return;
    G('import').disabled = true; scanning = true; let done = 0, failed = 0;
    const total = picks.length + bodyPicks.length;
    for (const r of picks) {
      G('status').textContent = 'מייבא ' + (done + failed + 1) + '/' + total + ' — ' + r.att.name + '…';
      try {
        const a = await gapi('messages/' + r.msgId + '/attachments/' + r.att.id);
        const blob = new Blob([b64(a.data)], { type: r.att.mime || 'application/pdf' });
        await uploadOne(blob, r.att.name, {
          source: 'gmail', gmailAccount, gmailMessageId: r.msgId, gmailSubject: r.subject, gmailFrom: r.from, gmailDate: r.date,
          date: datePartsFromName(r.att.name) || r.day || todayStr(), supplier: fromName(r.from).slice(0, 80),
        });
        done++;
      } catch (e) { failed++; console.warn('gmail import', r, e); }
    }
    for (const r of bodyPicks) {
      G('status').textContent = 'שומר מייל כ-PDF ' + (done + failed + 1) + '/' + total + ' — ' + fromName(r.from) + '…';
      try {
        const blob = await emailToPdfBlob(r.msgId, r);
        const name = ((r.day || todayStr()) + ' ' + safeSeg(fromName(r.from), 30) + ' ' + safeSeg(r.subject, 40)).replace(/\s+/g, ' ').trim() + '.pdf';
        await uploadOne(blob, name, {
          source: 'gmail', emailPrint: true, gmailAccount, gmailMessageId: r.msgId, gmailSubject: r.subject, gmailFrom: r.from, gmailDate: r.date,
          date: r.day || todayStr(), supplier: fromName(r.from).slice(0, 80),
        });
        done++;
      } catch (e) { failed++; console.warn('email print', r, e); }
    }
    scanning = false;
    G('status').textContent = 'יובאו ' + done + ' פריטים' + (failed ? ', ' + failed + ' נכשלו (ראו קונסול)' : '') + '. הספק מולא לפי שם השולח — כדאי לעבור ולמלא סכומים.';
    renderGmailList();
  });

  return { setOwner, refresh: render, detach, openNew: () => openModal(null) };
}
