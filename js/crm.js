/* ============================================================
   הורייזון פסגות גרופ — crm.js  (module)
   פאנל ניהול: לידים (ריבוי משתמשים, כרטיס ליד, חיפוש, דוחות,
   ייצוא, פולו-אפ) · עסקאות · מאמרים (בגל הבא)
   ============================================================ */
import { firebaseConfig, isConfigured } from '/js/firebase-config.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

if (!isConfigured) { $('login-view').hidden = true; $('setup-view').hidden = false; }
else boot();

async function boot() {
  const [{ initializeApp }, auth, fs] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js'),
    import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js')
  ]);
  const app = initializeApp(firebaseConfig);
  const authInstance = auth.getAuth(app);
  const db = fs.getFirestore(app);
  let currentEmail = '';

  const STATUS = {
    new:        { he: 'חדש',      cls: 'new' },
    contacted:  { he: 'יצרתי קשר', cls: 'contacted' },
    in_progress:{ he: 'בטיפול',   cls: 'contacted' },
    closed:     { he: 'נסגר',     cls: 'closed' }
  };
  const STATUS_KEYS = ['new', 'contacted', 'in_progress', 'closed'];

  /* ---------- עזרי תאריך ---------- */
  function toDateObj(ts) { if (!ts) return null; if (ts.toDate) return ts.toDate(); const d = new Date(ts); return isNaN(d.getTime()) ? null : d; }
  function nowISO() { return new Date().toISOString(); }
  const p2 = (n) => ('0' + n).slice(-2);
  function fmtDate(ts) { const d = toDateObj(ts); if (!d) return '—'; return `${p2(d.getDate())}/${p2(d.getMonth()+1)}/${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`; }
  function fmtDay(ts) { const d = toDateObj(ts); if (!d) return ''; return `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}`; }
  function todayStr() { const d = new Date(); return `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}`; }
  function phoneIntl(p) { let d = String(p || '').replace(/\D/g, ''); if (d.startsWith('0')) d = '972' + d.slice(1); return d; }

  /* ---------- התחברות ---------- */
  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault(); $('login-error').textContent = '';
    try { await auth.signInWithEmailAndPassword(authInstance, $('email').value.trim(), $('password').value); }
    catch (err) {
      $('login-error').textContent = ['auth/invalid-credential','auth/wrong-password','auth/user-not-found'].includes(err.code)
        ? 'אימייל או סיסמה שגויים.' : err.code === 'auth/too-many-requests' ? 'יותר מדי ניסיונות. נסו מאוחר יותר.' : 'שגיאת התחברות.';
    }
  });
  $('logout-btn').addEventListener('click', () => auth.signOut(authInstance));
  auth.onAuthStateChanged(authInstance, (user) => {
    if (user) {
      currentEmail = user.email;
      $('login-view').hidden = true; $('app-view').hidden = false; $('user-email').textContent = user.email;
      listenLeads(); listenDeals();
    } else { $('app-view').hidden = true; $('login-view').hidden = false; }
  });

  /* ---------- טאבים ---------- */
  document.querySelectorAll('.crm-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.crm-tab').forEach((t) => t.classList.toggle('active', t === tab));
      ['leads', 'deals', 'articles'].forEach((k) => { $('panel-' + k).hidden = (k !== tab.dataset.tab); });
    });
  });

  /* ============================================================
     לידים
     ============================================================ */
  let allLeads = [], leadFilter = 'all', searchQ = '';

  function listenLeads() {
    fs.onSnapshot(fs.collection(db, 'leads'), (snap) => {
      allLeads = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (toDateObj(b.createdAt)?.getTime() || 0) - (toDateObj(a.createdAt)?.getTime() || 0));
      renderLeadStats(); renderLeads();
    }, (err) => { console.warn(err); $('leads-body').innerHTML = '<tr><td colspan="8" class="empty-state">שגיאה בטעינה. בדקו כללי אבטחה.</td></tr>'; });
  }

  function isFollowUpDue(l) { return l.followUpAt && l.followUpAt <= todayStr() && l.status !== 'closed'; }

  function renderLeadStats() {
    const now = new Date(); const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    $('stat-total').textContent = allLeads.length;
    $('stat-new').textContent = allLeads.filter((l) => (l.status || 'new') === 'new').length;
    $('stat-month').textContent = allLeads.filter((l) => { const d = toDateObj(l.createdAt); return d && d >= monthStart; }).length;
    $('stat-followup').textContent = allLeads.filter(isFollowUpDue).length;
  }

  /* חיפוש + סינון */
  $('lead-search').addEventListener('input', (e) => { searchQ = e.target.value.trim().toLowerCase(); renderLeads(); });
  $('date-from').addEventListener('change', renderLeads);
  $('date-to').addEventListener('change', renderLeads);
  $('filters').addEventListener('click', (e) => {
    const b = e.target.closest('.filter-btn'); if (!b) return;
    leadFilter = b.dataset.filter;
    document.querySelectorAll('.filter-btn').forEach((x) => x.classList.toggle('active', x === b));
    renderLeads();
  });

  function filteredLeads() {
    let rows = allLeads;
    const f = leadFilter;
    if (['new','contacted','closed'].includes(f)) rows = rows.filter((l) => (l.status||'new')===f || (f==='contacted'&&l.status==='in_progress'));
    else if (['website','facebook'].includes(f)) rows = rows.filter((l) => (l.source||'website')===f);
    else if (f === 'mine') rows = rows.filter((l) => (l.assignedTo||'') === currentEmail);
    else if (f === 'followup') rows = rows.filter(isFollowUpDue);
    if (searchQ) rows = rows.filter((l) => [l.name,l.phone,l.email,l.message,l.topic,l.audience].filter(Boolean).join(' ').toLowerCase().includes(searchQ));
    const from = $('date-from').value, to = $('date-to').value;
    if (from) rows = rows.filter((l) => fmtDay(l.createdAt) >= from);
    if (to) rows = rows.filter((l) => fmtDay(l.createdAt) <= to);
    return rows;
  }

  function renderLeads() {
    const rows = filteredLeads();
    const body = $('leads-body');
    if (!rows.length) { body.innerHTML = '<tr><td colspan="8" class="empty-state">אין פניות להצגה.</td></tr>'; return; }
    body.innerHTML = rows.map((l) => {
      const st = STATUS[l.status||'new'] || STATUS.new;
      const src = (l.source||'website')==='facebook' ? '<span class="src-badge src-facebook">פייסבוק</span>' : '<span class="src-badge src-website">אתר</span>';
      const opts = STATUS_KEYS.filter((k)=>k!=='in_progress').map((k)=>`<option value="${k}"${(l.status||'new')===k?' selected':''}>${STATUS[k].he}</option>`).join('');
      const topic = [l.audience, l.topic].filter(Boolean).join(' · ') || '—';
      const assigned = l.assignedTo ? esc(l.assignedTo.split('@')[0]) : '<span style="color:var(--color-warm-gray)">—</span>';
      const fu = isFollowUpDue(l) ? ' <span class="fu-dot" title="ממתין לפולו-אפ"></span>' : '';
      return `<tr data-lead="${l.id}" class="lead-row">`+
        `<td class="lead-date">${fmtDate(l.createdAt)}</td>`+
        `<td><div class="lead-name">${esc(l.name)}${fu}</div>${l.message?`<div class="lead-sub">${esc(l.message)}</div>`:''}</td>`+
        `<td class="lead-contact"><a href="tel:${esc(l.phone)}" onclick="event.stopPropagation()">${esc(l.phone)}</a>${l.email?`<a href="mailto:${esc(l.email)}" onclick="event.stopPropagation()">${esc(l.email)}</a>`:''}</td>`+
        `<td>${esc(topic)}</td><td>${src}</td><td>${assigned}</td>`+
        `<td><select class="status-select ${st.cls}" data-id="${l.id}" onclick="event.stopPropagation()">${opts}</select></td>`+
        `<td><div class="row-actions"><span class="open-hint">פרטים ›</span><a class="icon-btn" href="https://wa.me/${phoneIntl(l.phone)}" target="_blank" rel="noopener" title="וואטסאפ" onclick="event.stopPropagation()"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15l-1.3 4.7 4.8-1.3A10 10 0 1 0 12 2z"/></svg></a></div></td></tr>`;
    }).join('');
    body.querySelectorAll('.status-select').forEach((s) => s.addEventListener('change', () => changeStatus(s.dataset.id, s.value)));
    body.querySelectorAll('.lead-row').forEach((r) => r.addEventListener('click', () => openLeadModal(allLeads.find((x) => x.id === r.dataset.lead))));
  }

  /* עדכון סטטוס עם רישום פעילות */
  async function changeStatus(id, status) {
    const lead = allLeads.find((x) => x.id === id); if (!lead) return;
    const updates = { status };
    const act = (lead.activity || []).slice();
    act.push({ at: nowISO(), by: currentEmail, action: 'שינה סטטוס ל: ' + (STATUS[status]?.he || status) });
    if (status === 'closed') { updates.closedBy = currentEmail; updates.closedAt = nowISO(); }
    updates.activity = act;
    await fs.updateDoc(fs.doc(db, 'leads', id), updates);
  }

  /* ---------- כרטיס ליד ---------- */
  let currentLead = null;
  function openLeadModal(lead) {
    if (!lead) return; currentLead = lead;
    $('lc-name').textContent = lead.name || '—';
    $('lc-sub').innerHTML = [fmtDate(lead.createdAt), (lead.source||'website')==='facebook'?'פייסבוק':'אתר', [lead.audience,lead.topic].filter(Boolean).join(' · ')].filter(Boolean).map(esc).join(' · ');
    $('lc-quick').innerHTML =
      `<a class="crm-btn" style="width:auto" href="https://wa.me/${phoneIntl(lead.phone)}" target="_blank" rel="noopener">וואטסאפ</a>`+
      `<a class="btn-ghost" href="tel:${esc(lead.phone)}">${esc(lead.phone)}</a>`+
      (lead.email?`<a class="btn-ghost" href="mailto:${esc(lead.email)}">${esc(lead.email)}</a>`:'');
    $('lc-status').innerHTML = STATUS_KEYS.filter((k)=>k!=='in_progress').map((k)=>`<option value="${k}"${(lead.status||'new')===k?' selected':''}>${STATUS[k].he}</option>`).join('');
    $('lc-status').className = 'status-select ' + (STATUS[lead.status||'new']?.cls||'new');
    $('lc-assigned').value = lead.assignedTo || '';
    $('lc-followup').value = lead.followUpAt || '';
    $('lc-notes').value = lead.notes || '';
    renderActivity(lead.activity || []);
    $('lead-modal').hidden = false;
  }
  function renderActivity(act) {
    const list = $('lc-activity-list');
    if (!act.length) { list.innerHTML = '<li class="lc-empty">אין פעילות עדיין.</li>'; return; }
    list.innerHTML = act.slice().reverse().map((a) =>
      `<li><span class="act-when">${fmtDate(a.at)}</span> <b>${esc((a.by||'').split('@')[0])}</b> — ${esc(a.action)}</li>`).join('');
  }
  $('lc-assign-me').addEventListener('click', () => { $('lc-assigned').value = currentEmail; });
  $('lc-close').addEventListener('click', () => $('lead-modal').hidden = true);
  $('lc-cancel').addEventListener('click', () => $('lead-modal').hidden = true);
  $('lead-modal').addEventListener('click', (e) => { if (e.target === $('lead-modal')) $('lead-modal').hidden = true; });
  $('lc-delete').addEventListener('click', async () => {
    if (currentLead && confirm('למחוק את הפנייה לצמיתות?')) { await fs.deleteDoc(fs.doc(db, 'leads', currentLead.id)); $('lead-modal').hidden = true; }
  });
  $('lc-save').addEventListener('click', async () => {
    if (!currentLead) return;
    const l = currentLead;
    const newStatus = $('lc-status').value, newAssigned = $('lc-assigned').value.trim(), newFollow = $('lc-followup').value, newNotes = $('lc-notes').value;
    const act = (l.activity || []).slice();
    const updates = { status: newStatus, assignedTo: newAssigned, followUpAt: newFollow, notes: newNotes };
    if (newStatus !== (l.status || 'new')) {
      act.push({ at: nowISO(), by: currentEmail, action: 'שינה סטטוס ל: ' + (STATUS[newStatus]?.he || newStatus) });
      if (newStatus === 'closed') { updates.closedBy = currentEmail; updates.closedAt = nowISO(); }
    }
    if (newAssigned !== (l.assignedTo || '')) act.push({ at: nowISO(), by: currentEmail, action: newAssigned ? ('הקצה ל: ' + newAssigned.split('@')[0]) : 'ביטל הקצאה' });
    if (newNotes !== (l.notes || '')) act.push({ at: nowISO(), by: currentEmail, action: 'עדכן הערות' });
    if (newFollow !== (l.followUpAt || '')) act.push({ at: nowISO(), by: currentEmail, action: newFollow ? ('קבע פולו-אפ ל: ' + newFollow) : 'הסיר פולו-אפ' });
    updates.activity = act;
    $('lc-save').disabled = true;
    try { await fs.updateDoc(fs.doc(db, 'leads', l.id), updates); $('lead-modal').hidden = true; }
    catch (err) { alert('שגיאה בשמירה: ' + err.message); }
    $('lc-save').disabled = false;
  });

  /* ---------- ייצוא Excel (CSV) ---------- */
  $('export-csv').addEventListener('click', () => {
    const rows = filteredLeads();
    const head = ['תאריך','שם','טלפון','אימייל','קהל','נושא','מקור','סטטוס','מטופל ע"י','פולו-אפ','הערות'];
    const csvRows = [head];
    rows.forEach((l) => csvRows.push([
      fmtDate(l.createdAt), l.name||'', l.phone||'', l.email||'', l.audience||'', l.topic||'',
      (l.source||'website')==='facebook'?'פייסבוק':'אתר', STATUS[l.status||'new']?.he||'', l.assignedTo||'', l.followUpAt||'', (l.notes||'').replace(/\n/g,' ')
    ]));
    const csv = '﻿' + csvRows.map((r) => r.map((c) => '"' + String(c).replace(/"/g,'""') + '"').join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'leads-' + todayStr() + '.csv'; a.click();
    URL.revokeObjectURL(url);
  });

  /* ============================================================
     עסקאות
     ============================================================ */
  const DEAL_FIELDS = [
    { k: 'title_he', l: 'כותרת (עברית)', t: 'text' },
    { k: 'title_en', l: 'Title (English)', t: 'text' },
    { k: 'desc_he', l: 'תיאור (עברית)', t: 'textarea' },
    { k: 'desc_en', l: 'Description (English)', t: 'textarea' },
    { k: 'category_he', l: 'קטגוריה (עברית)', t: 'text' },
    { k: 'category_en', l: 'Category (English)', t: 'text' },
    { k: 'location', l: 'מיקום', t: 'text' },
    { k: 'amount', l: 'היקף / סכום', t: 'text', hint: 'לדוגמה: ₪620,000' },
    { k: 'year', l: 'שנה', t: 'text' },
    { k: 'image', l: 'נתיב תמונה', t: 'text', hint: 'לדוגמה: /assets/images/deals/deal1.jpg' },
  ];
  let allDeals = [];
  function listenDeals() {
    fs.onSnapshot(fs.query(fs.collection(db, 'deals'), fs.orderBy('order', 'asc')), (snap) => {
      allDeals = snap.docs.map((d) => ({ id: d.id, ...d.data() })); renderDeals();
    }, (err) => { console.warn(err); $('deals-grid').innerHTML = '<p class="empty-state">שגיאה בטעינה.</p>'; });
  }
  function renderDeals() {
    const grid = $('deals-grid');
    if (!allDeals.length) {
      grid.innerHTML = '<div class="empty-state"><p>אין עסקאות במערכת עדיין.</p><button class="crm-btn" style="width:auto;margin-top:12px" id="seed-deals">ייבוא העסקאות הקיימות מהאתר</button></div>';
      const sb = $('seed-deals');
      if (sb) sb.addEventListener('click', async () => {
        sb.disabled = true; sb.textContent = 'מייבא…';
        try {
          const r = await fetch('/data/deals.json', { cache: 'no-cache' }); const data = await r.json(); const deals = (data && data.deals) || [];
          for (let i = 0; i < deals.length; i++) await fs.addDoc(fs.collection(db, 'deals'), { ...deals[i], order: i, createdAt: fs.serverTimestamp() });
          alert('יובאו ' + deals.length + ' עסקאות בהצלחה.');
        } catch (err) { alert('שגיאה בייבוא: ' + err.message); sb.disabled = false; sb.textContent = 'ייבוא העסקאות הקיימות מהאתר'; }
      });
      return;
    }
    grid.innerHTML = allDeals.map((d) => `<div class="editor-card">`+
      (d.image ? `<img class="ec-img" src="${esc(d.image)}" alt="" onerror="this.style.display='none'">` : '')+
      `<span class="ec-cat">${esc(d.category_he || '')}</span><span class="ec-title">${esc(d.title_he || '(ללא כותרת)')}</span>`+
      `<span class="ec-meta">${esc([d.location, d.amount, d.year].filter(Boolean).join(' · '))}</span>`+
      `<div class="ec-actions"><button class="crm-btn" style="width:auto;font-size:.85rem;padding:.5em 1em" data-edit-deal="${d.id}">עריכה</button>`+
      `<button class="icon-btn danger" data-del-deal="${d.id}" title="מחיקה"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg></button></div></div>`).join('');
    grid.querySelectorAll('[data-edit-deal]').forEach((b) => b.addEventListener('click', () => openDealModal(allDeals.find((x) => x.id === b.dataset.editDeal))));
    grid.querySelectorAll('[data-del-deal]').forEach((b) => b.addEventListener('click', () => { if (confirm('למחוק את העסקה?')) fs.deleteDoc(fs.doc(db,'deals',b.dataset.delDeal)); }));
  }
  $('add-deal').addEventListener('click', () => openDealModal(null));
  function openDealModal(deal) {
    const editing = !!deal;
    $('modal-title').textContent = editing ? 'עריכת עסקה' : 'עסקה חדשה';
    $('modal-form').innerHTML = DEAL_FIELDS.map((f) => {
      const v = editing ? (deal[f.k] || '') : '';
      const input = f.t === 'textarea' ? `<textarea data-k="${f.k}">${esc(v)}</textarea>` : `<input type="text" data-k="${f.k}" value="${esc(v)}">`;
      return `<div class="field"><label>${f.l}</label>${input}${f.hint?`<div class="field-hint">${f.hint}</div>`:''}</div>`;
    }).join('');
    $('modal').hidden = false;
    $('modal-save').onclick = async () => {
      const data = {}; $('modal-form').querySelectorAll('[data-k]').forEach((el) => { data[el.dataset.k] = el.value.trim(); });
      $('modal-save').disabled = true;
      try {
        if (editing) await fs.updateDoc(fs.doc(db, 'deals', deal.id), data);
        else await fs.addDoc(fs.collection(db, 'deals'), { ...data, order: allDeals.length, createdAt: fs.serverTimestamp() });
        closeModal();
      } catch (err) { alert('שגיאה בשמירה: ' + err.message); }
      $('modal-save').disabled = false;
    };
  }
  function closeModal() { $('modal').hidden = true; $('modal-form').innerHTML = ''; }
  $('modal-cancel').addEventListener('click', closeModal);
  $('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeModal(); });
}
