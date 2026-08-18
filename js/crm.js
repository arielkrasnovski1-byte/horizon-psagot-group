/* ============================================================
   הורייזון פסגות גרופ — crm.js  (module)
   פאנל ניהול: לידים (ריבוי משתמשים, כרטיס ליד, חיפוש, דוחות,
   ייצוא, פולו-אפ) · עסקאות · מאמרים (בגל הבא)
   ============================================================ */
import { firebaseConfig, isConfigured } from '/js/firebase-config.js';
import { SERVICE_TYPES, buildItems, serviceLabel } from '/js/case-templates.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));

if (!isConfigured) { $('login-view').hidden = true; $('setup-view').hidden = false; }
else boot();

async function boot() {
  const [{ initializeApp, deleteApp }, auth, fs, st] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js'),
    import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js'),
    import('https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js')
  ]);
  const app = initializeApp(firebaseConfig);
  const authInstance = auth.getAuth(app);
  const db = fs.getFirestore(app);
  const storage = st.getStorage(app);
  let currentEmail = '', currentUid = '';

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

  // ניהול מנויי onSnapshot — כדי לנתק בהתנתקות ולא לצבור כפילויות בהתחברות חוזרת
  let unsubs = [];
  const track = (unsub) => { if (typeof unsub === 'function') unsubs.push(unsub); return unsub; };
  const detachAll = () => { unsubs.forEach((u) => { try { u(); } catch (e) {} }); unsubs = []; };

  auth.onAuthStateChanged(authInstance, (user) => {
    if (user) {
      detachAll();
      currentEmail = user.email; currentUid = user.uid;
      $('login-view').hidden = true; $('app-view').hidden = false; $('user-email').textContent = user.email;
      // רישום המשתמש לרשימת בעלי הגישה (לצורך הקצאה/סינון)
      fs.setDoc(fs.doc(db, 'crm_users', user.uid), { email: user.email, lastSeen: nowISO() }, { merge: true }).catch(() => {});
      listenUsers();
      listenLeads(); listenCases(); listenDeals(); listenTestimonials(); teamCol.listen(); faqCol.listen(); articlesCol.listen();
    } else { detachAll(); $('app-view').hidden = true; $('login-view').hidden = false; }
  });

  /* ---------- טאבים ---------- */
  document.querySelectorAll('.crm-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.crm-tab').forEach((t) => t.classList.toggle('active', t === tab));
      ['leads', 'cases', 'deals', 'testimonials', 'team', 'faq', 'articles', 'users'].forEach((k) => { $('panel-' + k).hidden = (k !== tab.dataset.tab); });
    });
  });

  /* ============================================================
     לידים
     ============================================================ */
  let allLeads = [], leadFilter = 'all', searchQ = '', userFilter = '';
  let teamUsers = [], allUsers = [], currentRole = 'agent';
  const ROLES = { owner: 'בעלים', manager: 'מנהל', agent: 'נציג' };
  const normRole = (r) => (r === 'owner' || r === 'manager' || r === 'agent') ? r : 'agent';
  // שם תצוגה של מטפל לפי המייל — מהשם שהוגדר, אחרת החלק שלפני ה-@
  const displayName = (email) => { if (!email) return ''; const u = allUsers.find((x) => x.email === email); return (u && u.name) ? u.name : email.split('@')[0]; };

  /* רשימת בעלי גישה — לבחירת מטפל, סינון וניהול משתמשים + הרשאות */
  function listenUsers() {
    track(fs.onSnapshot(fs.collection(db, 'crm_users'), (snap) => {
      allUsers = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
      teamUsers = allUsers.map((u) => u.email).filter(Boolean).sort();
      const me = allUsers.find((u) => u.uid === currentUid);
      currentRole = normRole(me && me.role);
      const ownerExists = allUsers.some((u) => u.role === 'owner');
      const isOwner = currentRole === 'owner';
      const canContent = isOwner || currentRole === 'manager' || !ownerExists;
      // חשיפת טאבים לפי תפקיד: נציג=לידים בלבד · מנהל=+תוכן · בעלים=+משתמשים
      ['deals', 'testimonials', 'team', 'faq', 'articles'].forEach((k) => {
        const btn = document.querySelector('.crm-tab[data-tab="' + k + '"]'); if (btn) btn.hidden = !canContent;
      });
      $('tab-users').hidden = !(isOwner || !ownerExists);
      // אם הטאב הפעיל הוסתר — חוזרים ללידים
      const active = document.querySelector('.crm-tab.active');
      if (active && active.hidden) document.querySelector('.crm-tab[data-tab="leads"]').click();
      $('user-email').textContent = displayName(currentEmail);
      populateUserFilter();
      renderUsers(ownerExists, isOwner);
      renderLeads();   // רענון שמות המטפלים בטבלה כשרשימת המשתמשים נטענת/משתנה
    }, (err) => console.warn('users listener', err)));
  }
  function renderUsers(ownerExists, isOwner) {
    $('owner-claim').hidden = ownerExists;
    const body = $('users-body');
    if (!allUsers.length) { body.innerHTML = '<tr><td colspan="5" class="empty-state">אין משתמשים.</td></tr>'; return; }
    body.innerHTML = allUsers.map((u) => {
      const role = normRole(u.role); const isSelf = u.uid === currentUid;
      const roleCell = (isOwner && !isSelf)
        ? `<select class="status-select" data-role-uid="${u.uid}">${Object.keys(ROLES).map((k) => `<option value="${k}"${role === k ? ' selected' : ''}>${ROLES[k]}</option>`).join('')}</select>`
        : (role === 'owner' ? `<span class="src-badge src-manual">${ROLES[role]}</span>` : ROLES[role]);
      const nameCell = isOwner
        ? `<input class="name-edit" data-name-uid="${u.uid}" value="${esc(u.name || '')}" placeholder="${esc((u.email || '').split('@')[0])}">`
        : esc(u.name || (u.email || '').split('@')[0]);
      return `<tr class="user-row"><td class="lead-name-cell" data-label="שם">${nameCell}</td>`+
        `<td class="lead-contact" data-label="אימייל" style="direction:ltr;text-align:right">${esc(u.email || '')}</td>`+
        `<td data-label="תפקיד">${roleCell}</td>`+
        `<td class="lead-date" data-label="כניסה אחרונה">${u.lastSeen ? fmtDate(u.lastSeen) : '—'}</td>`+
        `<td class="actions-cell"><div class="row-actions">`+
          `${isOwner ? `<button class="icon-btn" data-reset="${esc(u.email || '')}" title="איפוס סיסמה (שליחת מייל)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></button>` : ''}`+
          `${(isOwner && !isSelf) ? `<button class="icon-btn danger" data-del-user="${u.uid}" title="הסרה"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg></button>` : ''}`+
        `</div></td></tr>`;
    }).join('');
    body.querySelectorAll('[data-reset]').forEach((b) => b.addEventListener('click', async () => {
      const email = b.dataset.reset; if (!email) return;
      if (!confirm('לשלוח מייל לאיפוס סיסמה אל:\n' + email + ' ?')) return;
      try { await auth.sendPasswordResetEmail(authInstance, email); alert('נשלח מייל איפוס סיסמה אל ' + email + '.\nהמשתמש יבחר סיסמה חדשה דרך הקישור במייל.'); }
      catch (err) { alert('שגיאה: ' + err.message); }
    }));
    body.querySelectorAll('[data-role-uid]').forEach((s) => s.addEventListener('change', () => fs.updateDoc(fs.doc(db, 'crm_users', s.dataset.roleUid), { role: s.value })));
    body.querySelectorAll('[data-name-uid]').forEach((inp) => inp.addEventListener('change', () => fs.updateDoc(fs.doc(db, 'crm_users', inp.dataset.nameUid), { name: inp.value.trim() })));
    body.querySelectorAll('[data-del-user]').forEach((b) => b.addEventListener('click', () => {
      if (confirm('להסיר את המשתמש מהרשימה?\n(לחסימת התחברות מלאה — יש למחוק אותו גם ב-Firebase Console → Authentication)')) fs.deleteDoc(fs.doc(db, 'crm_users', b.dataset.delUser));
    }));
  }
  $('claim-owner').addEventListener('click', async () => {
    await fs.setDoc(fs.doc(db, 'crm_users', currentUid), { email: currentEmail, role: 'owner', lastSeen: nowISO() }, { merge: true });
  });
  $('add-user').addEventListener('click', () => {
    $('modal-title').textContent = 'משתמש חדש';
    $('modal-form').innerHTML =
      '<div class="field"><label>שם</label><input type="text" data-k="name"></div>'+
      '<div class="field"><label>אימייל</label><input type="email" data-k="email" autocomplete="off"></div>'+
      '<div class="field"><label>סיסמה (לפחות 6 תווים)</label><input type="text" data-k="password"></div>'+
      '<div class="field"><label>תפקיד</label><select data-k="role"><option value="agent">נציג — לידים בלבד</option><option value="manager">מנהל — לידים + תוכן</option><option value="owner">בעלים — הכל</option></select></div>';
    $('modal').hidden = false;
    $('modal-save').onclick = async () => {
      const g = (k) => { const el = $('modal-form').querySelector('[data-k="' + k + '"]'); return el ? el.value.trim() : ''; };
      const email = g('email'), password = g('password'), name = g('name'), role = g('role');
      if (!email || password.length < 6) { alert('נדרש אימייל תקין וסיסמה בת 6 תווים לפחות.'); return; }
      $('modal-save').disabled = true;
      try {
        const secApp = initializeApp(firebaseConfig, 'sec-' + new Date().getTime());
        const secAuth = auth.getAuth(secApp);
        const cred = await auth.createUserWithEmailAndPassword(secAuth, email, password);
        await fs.setDoc(fs.doc(db, 'crm_users', cred.user.uid), { email, name, role, lastSeen: nowISO() });
        await auth.signOut(secAuth);
        await deleteApp(secApp);
        closeModal();
        alert('המשתמש נוצר בהצלחה. הוא יכול להתחבר עם האימייל והסיסמה שהגדרת.');
      } catch (err) {
        alert('שגיאה: ' + (err.code === 'auth/email-already-in-use' ? 'האימייל כבר רשום.' : err.code === 'auth/weak-password' ? 'הסיסמה חלשה מדי.' : err.message));
      }
      $('modal-save').disabled = false;
    };
  });
  function userOptions(selected) {
    const extra = (selected && !teamUsers.includes(selected)) ? `<option value="${esc(selected)}">${esc(selected)}</option>` : '';
    return '<option value="">— לא הוקצה —</option>' + teamUsers.map((e) => `<option value="${esc(e)}"${e === selected ? ' selected' : ''}>${esc(displayName(e))}</option>`).join('') + extra;
  }
  function populateUserFilter() {
    const fu = $('filter-user'); if (!fu) return; const cur = fu.value;
    fu.innerHTML = '<option value="">כל המטפלים</option>' + teamUsers.map((e) => `<option value="${esc(e)}">${esc(displayName(e))}</option>`).join('');
    fu.value = cur;
  }
  $('filter-user').addEventListener('change', (e) => { userFilter = e.target.value; renderLeads(); });

  function listenLeads() {
    track(fs.onSnapshot(fs.collection(db, 'leads'), (snap) => {
      allLeads = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (toDateObj(b.createdAt)?.getTime() || 0) - (toDateObj(a.createdAt)?.getTime() || 0));
      renderLeadStats(); renderLeads();
    }, (err) => { console.warn(err); $('leads-body').innerHTML = '<tr><td colspan="8" class="empty-state">שגיאה בטעינה. בדקו כללי אבטחה.</td></tr>'; }));
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
    if (userFilter) rows = rows.filter((l) => (l.assignedTo || '') === userFilter);
    return rows;
  }
  function srcBadge(source) {
    if (source === 'facebook') return '<span class="src-badge src-facebook">פייסבוק</span>';
    if (source === 'manual') return '<span class="src-badge src-manual">ידני</span>';
    return '<span class="src-badge src-website">אתר</span>';
  }

  function renderLeads() {
    const rows = filteredLeads();
    const body = $('leads-body');
    if (!rows.length) { body.innerHTML = '<tr><td colspan="8" class="empty-state">אין פניות להצגה.</td></tr>'; return; }
    body.innerHTML = rows.map((l) => {
      const st = STATUS[l.status||'new'] || STATUS.new;
      const src = srcBadge(l.source || 'website');
      const opts = STATUS_KEYS.filter((k)=>k!=='in_progress').map((k)=>`<option value="${k}"${(l.status||'new')===k?' selected':''}>${STATUS[k].he}</option>`).join('');
      const topic = [l.audience, l.topic].filter(Boolean).join(' · ') || '—';
      const assigned = l.assignedTo ? esc(displayName(l.assignedTo)) : '<span style="color:var(--color-warm-gray)">—</span>';
      const fu = isFollowUpDue(l) ? ' <span class="fu-clock" title="ממתין לפולו-אפ"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/></svg></span>' : '';
      return `<tr data-lead="${l.id}" class="lead-row ls-${st.cls}">`+
        `<td class="lead-date" data-label="תאריך">${fmtDate(l.createdAt)}</td>`+
        `<td class="lead-name-cell" data-label="שם"><div class="lead-name"><span class="lead-dot"></span>${esc(l.name)}${fu}</div>${l.message?`<div class="lead-sub">${esc(l.message)}</div>`:''}</td>`+
        `<td class="lead-contact" data-label="יצירת קשר"><a href="tel:${esc(l.phone)}" onclick="event.stopPropagation()">${esc(l.phone)}</a>${l.email?`<a href="mailto:${esc(l.email)}" onclick="event.stopPropagation()">${esc(l.email)}</a>`:''}</td>`+
        `<td data-label="קהל / נושא">${esc(topic)}</td><td data-label="מקור">${src}</td><td data-label="מטופל ע״י">${assigned}</td>`+
        `<td data-label="סטטוס"><select class="status-select ${st.cls}" data-id="${l.id}" onclick="event.stopPropagation()">${opts}</select></td>`+
        `<td class="actions-cell"><div class="row-actions"><span class="open-hint">פרטים ›</span><a class="icon-btn" href="https://wa.me/${phoneIntl(l.phone)}" target="_blank" rel="noopener" title="וואטסאפ" onclick="event.stopPropagation()"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15l-1.3 4.7 4.8-1.3A10 10 0 1 0 12 2z"/></svg></a></div></td></tr>`;
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
    const srcTxt = lead.source === 'facebook' ? 'פייסבוק' : lead.source === 'manual' ? 'ידני' : 'אתר';
    $('lc-sub').innerHTML = [fmtDate(lead.createdAt), srcTxt, [lead.audience,lead.topic].filter(Boolean).join(' · ')].filter(Boolean).map(esc).join(' · ');
    $('lc-quick').innerHTML =
      `<a class="crm-btn" style="width:auto" href="https://wa.me/${phoneIntl(lead.phone)}" target="_blank" rel="noopener">וואטסאפ</a>`+
      `<a class="btn-ghost" href="tel:${esc(lead.phone)}">${esc(lead.phone)}</a>`+
      (lead.email?`<a class="btn-ghost" href="mailto:${esc(lead.email)}">${esc(lead.email)}</a>`:'')+
      `<button type="button" class="btn-ghost lc-to-case" id="lc-open-case">פתיחת תיק לקוח ›</button>`;
    $('lc-open-case').onclick = () => {
      $('lead-modal').hidden = true;
      const tabBtn = document.querySelector('.crm-tab[data-tab="cases"]');
      if (tabBtn) tabBtn.click();
      openNewCaseForm({ leadId: lead.id, name: lead.name || '', phone: lead.phone || '', email: lead.email || '' });
    };
    $('lc-status').innerHTML = STATUS_KEYS.filter((k)=>k!=='in_progress').map((k)=>`<option value="${k}"${(lead.status||'new')===k?' selected':''}>${STATUS[k].he}</option>`).join('');
    $('lc-status').className = 'status-select ' + (STATUS[lead.status||'new']?.cls||'new');
    $('lc-assigned').innerHTML = userOptions(lead.assignedTo || '');
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
      `<li><span class="act-when">${fmtDate(a.at)}</span> <b>${esc(displayName(a.by))}</b> — ${esc(a.action)}</li>`).join('');
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
    if (newAssigned !== (l.assignedTo || '')) act.push({ at: nowISO(), by: currentEmail, action: newAssigned ? ('הקצה ל: ' + displayName(newAssigned)) : 'ביטל הקצאה' });
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
      l.source==='facebook'?'פייסבוק':l.source==='manual'?'ידני':'אתר', STATUS[l.status||'new']?.he||'', l.assignedTo||'', l.followUpAt||'', (l.notes||'').replace(/\n/g,' ')
    ]));
    // מונע הזרקת נוסחאות ל-Excel: תא שמתחיל ב- = + - @ מקבל גרש מגן
    const safe = (c) => { let s = String(c == null ? '' : c); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return s.replace(/"/g, '""'); };
    const csv = '﻿' + csvRows.map((r) => r.map((c) => '"' + safe(c) + '"').join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'leads-' + todayStr() + '.csv'; a.click();
    URL.revokeObjectURL(url);
  });

  /* ---------- הוספת לקוח ידנית ---------- */
  $('add-lead').addEventListener('click', () => {
    $('modal-title').textContent = 'לקוח חדש';
    const AUDIENCE = ['משקיע פרטי', 'יזם נדל"ן', 'משפחה / יחיד', 'בעל עסק / חברה', 'זקוק למבנה מימון', 'אחר'];
    const TOPIC = ['מימון ומשכנתאות', 'הבראה פיננסית', 'ניהול חוב', 'ייעוץ עסקי ואסטרטגיה', 'נדל"ן בישראל', 'נדל"ן בחו"ל', 'התחדשות עירונית', 'אחר'];
    const F = [
      { k: 'name', l: 'שם מלא', t: 'text' }, { k: 'phone', l: 'טלפון', t: 'text' },
      { k: 'email', l: 'אימייל', t: 'text' },
      { k: 'audience', l: 'קהל יעד', t: 'select', opts: AUDIENCE },
      { k: 'topic', l: 'נושא / סיבת פנייה', t: 'select', opts: TOPIC },
      { k: 'message', l: 'הערה', t: 'textarea' },
    ];
    $('modal-form').innerHTML = F.map((f) => {
      let inp;
      if (f.t === 'textarea') inp = `<textarea data-k="${f.k}"></textarea>`;
      else if (f.t === 'select') inp = `<select data-k="${f.k}"><option value="">— בחרו —</option>${f.opts.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}</select>`;
      else inp = `<input type="text" data-k="${f.k}">`;
      return `<div class="field"><label>${f.l}</label>${inp}</div>`;
    }).join('');
    $('modal').hidden = false;
    $('modal-save').onclick = async () => {
      const d = {}; $('modal-form').querySelectorAll('[data-k]').forEach((el) => { d[el.dataset.k] = el.value.trim(); });
      if (!d.name || !d.phone) { alert('שם וטלפון הם שדות חובה.'); return; }
      $('modal-save').disabled = true;
      try {
        await fs.addDoc(fs.collection(db, 'leads'), {
          ...d, source: 'manual', status: 'new', notes: '', assignedTo: '', lang: 'he',
          activity: [{ by: currentEmail, at: nowISO(), action: 'נוצר ידנית' }],
          createdAt: fs.serverTimestamp(),
        });
        closeModal();
      } catch (err) { alert('שגיאה: ' + err.message); }
      $('modal-save').disabled = false;
    };
  });

  /* ============================================================
     תיקי לקוחות (פורטל מסמכים)
     ============================================================ */
  let allCases = [];
  const caseToE164 = (raw) => {
    let d = (raw || '').replace(/\D/g, '');
    if (d.indexOf('972') === 0) d = d.slice(3); else if (d.indexOf('0') === 0) d = d.slice(1);
    return /^\d{8,9}$/.test(d) ? '+972' + d : '';
  };
  let pendingOpenCase = null;
  const PORTAL_URL = location.origin + '/portal/';

  /* ---- הודעת קליטה ללקוח (וואטסאפ / מייל) ---- */
  function caseMissingItems(c) {
    return (c.items || []).filter((it) => (c.stage2Open ? it.stage === 2 : it.stage === 1) && it.status !== 'received');
  }
  function caseMessage(c) {
    const missing = caseMissingItems(c);
    const list = missing.map((it) => '\u2022 ' + it.label).join('\n');
    const how = c.clientPhone && c.clientEmail
      ? 'בקוד חד-פעמי שיישלח ב-SMS למספר הזה, או בקישור שיישלח למייל'
      : c.clientPhone ? 'בקוד חד-פעמי שיישלח ב-SMS למספר הזה'
      : 'בקישור חד-פעמי שיישלח לכתובת המייל הזו';
    const head = 'שלום ' + (c.clientName || '') + ',\n\n' +
      (c.stage2Open
        ? 'התהליך שלך בהורייזון פסגות גרופ (' + serviceLabel(c.serviceType) + ') מתקדם, ולשלב הבא נדרשים המסמכים הבאים:'
        : 'פתחנו עבורך תיק אישי בהורייזון פסגות גרופ עבור ' + serviceLabel(c.serviceType) + '.\nכדי להתחיל בתהליך נדרשים המסמכים הבאים:');
    const body = missing.length ? '\n' + list : '\nכרגע לא חסרים מסמכים — נעדכן אותך בהמשך.';
    return head + body + '\n\n' +
      'להעלאה מהנייד, בקישור המאובטח:\n' + PORTAL_URL + '\n' +
      'הכניסה ' + how + ' — ללא סיסמה.\n\n' +
      'בקישור תוכל לראות בכל רגע מה כבר התקבל ומה עוד חסר.\n\n' +
      'בברכה,\nהורייזון פסגות גרופ';
  }
  async function markSent(c, via) {
    const at = nowISO();
    c.lastSentAt = at; c.lastSentBy = currentEmail; c.lastSentVia = via;
    renderSentNote(c);
    try { await fs.updateDoc(fs.doc(db, 'cases', c.id), { lastSentAt: at, lastSentBy: currentEmail, lastSentVia: via }); }
    catch (e) { console.warn(e); }
  }
  function renderSentNote(c) {
    const n = $('cm-sent'); if (!n) return;
    const via = c.lastSentVia === 'email' ? 'במייל' : c.lastSentVia === 'whatsapp' ? 'בוואטסאפ' : '';
    n.textContent = c.lastSentAt
      ? ('נשלח ' + via + ' ' + fmtDate(c.lastSentAt) + (c.lastSentBy ? ' · ' + displayName(c.lastSentBy) : ''))
      : 'טרם נשלח ללקוח';
    n.className = 'cm-sent' + (c.lastSentAt ? ' ok' : '');
  }
  function renderSendBar(c) {
    const wa = $('cm-send-wa'), ml = $('cm-send-mail'), cp = $('cm-copy-msg');
    wa.disabled = !c.clientPhone; wa.title = c.clientPhone ? '' : 'אין טלפון בתיק';
    ml.disabled = !c.clientEmail; ml.title = c.clientEmail ? '' : 'אין אימייל בתיק';
    wa.onclick = () => {
      window.open('https://wa.me/' + phoneIntl(c.clientPhone) + '?text=' + encodeURIComponent(caseMessage(c)), '_blank', 'noopener');
      markSent(c, 'whatsapp');
    };
    ml.onclick = () => {
      const subj = c.stage2Open ? 'מסמכים משלימים — הורייזון פסגות גרופ' : 'פתיחת תיק — המסמכים הנדרשים | הורייזון פסגות גרופ';
      window.location.href = 'mailto:' + c.clientEmail + '?subject=' + encodeURIComponent(subj) + '&body=' + encodeURIComponent(caseMessage(c));
      markSent(c, 'email');
    };
    cp.onclick = async () => {
      try {
        await navigator.clipboard.writeText(caseMessage(c));
        cp.textContent = 'הועתק ✓'; setTimeout(() => { cp.textContent = 'העתקת ההודעה'; }, 1600);
      } catch (e) { window.prompt('העתיקו את ההודעה:', caseMessage(c)); }
    };
    renderSentNote(c);
  }

  function listenCases() {
    track(fs.onSnapshot(fs.collection(db, 'cases'), (snap) => {
      allCases = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (toDateObj(b.createdAt)?.getTime() || 0) - (toDateObj(a.createdAt)?.getTime() || 0));
      renderCases();
    }, (err) => { console.warn(err); $('cases-grid').innerHTML = '<p class="empty-state">שגיאה בטעינה. בדקו כללי אבטחה.</p>'; }));
  }
  function casePct(c) {
    const items = (c.items || []).filter((it) => it.stage === 1 || c.stage2Open);
    if (!items.length) return 0;
    return Math.round(items.filter((it) => it.status === 'received').length / items.length * 100);
  }
  function renderCases() {
    const grid = $('cases-grid');
    if (!allCases.length) { grid.innerHTML = '<div class="empty-state"><p>אין תיקים עדיין. פתחו תיק חדש כדי לשלוח ללקוח קישור להעלאת מסמכים.</p></div>'; return; }
    grid.innerHTML = allCases.map((c) => {
      const p = casePct(c);
      const contact = esc(c.clientPhone || c.clientEmail || '');
      return '<div class="case-card" data-case="' + c.id + '">' +
        '<div class="case-card-head"><b>' + esc(c.clientName || '—') + '</b>' +
        (c.stage2Open ? '<span class="src-badge src-manual">שלב 2</span>' : '') + '</div>' +
        '<div class="case-card-svc">' + esc(serviceLabel(c.serviceType)) + '</div>' +
        '<div class="case-card-contact" style="direction:ltr;text-align:right">' + contact + '</div>' +
        '<div class="case-progress"><div class="case-progress-bar"><span style="width:' + p + '%"></span></div><em>' + p + '%</em></div>' +
        '<div class="case-card-sent' + (c.lastSentAt ? ' ok' : '') + '">' +
          (c.lastSentAt ? '✓ נשלח ללקוח ' + fmtDate(c.lastSentAt) : 'טרם נשלח ללקוח') + '</div>' +
        '</div>';
    }).join('');
    grid.querySelectorAll('.case-card').forEach((el) =>
      el.addEventListener('click', () => openCaseModal(allCases.find((x) => x.id === el.dataset.case))));
    if (pendingOpenCase) {
      const fresh = allCases.find((x) => x.id === pendingOpenCase);
      if (fresh) { pendingOpenCase = null; openCaseModal(fresh); }
    }
  }

  // פתיחת תיק חדש (prefill — פתיחה מתוך כרטיס ליד)
  $('add-case').addEventListener('click', () => openNewCaseForm({}));
  function openNewCaseForm(prefill) {
    prefill = prefill || {};
    $('modal-title').textContent = 'תיק לקוח חדש';
    const svcOpts = SERVICE_TYPES.map((s) => '<option value="' + s.key + '">' + esc(s.label) + '</option>').join('');
    $('modal-form').innerHTML =
      '<div class="field"><label>שם הלקוח</label><input type="text" data-k="clientName" value="' + esc(prefill.name || '') + '"></div>' +
      '<div class="field"><label>טלפון (לכניסה ב-SMS)</label><input type="tel" data-k="clientPhone" placeholder="050-0000000" style="direction:ltr" value="' + esc(prefill.phone || '') + '"></div>' +
      '<div class="field"><label>אימייל (לכניסה במייל)</label><input type="email" data-k="clientEmail" placeholder="you@example.com" style="direction:ltr" value="' + esc(prefill.email || '') + '"></div>' +
      '<div class="field"><label>סוג שירות</label><select data-k="serviceType">' + svcOpts + '</select></div>' +
      '<div class="field"><label style="display:flex;align-items:center;gap:.5rem;font-weight:400"><input type="checkbox" data-k="isBusiness" style="width:auto"> ללקוח יש עסק (מוסיף מסמכים עסקיים)</label></div>';
    $('modal').hidden = false;
    $('modal-save').onclick = async () => {
      const g = (k) => { const el = $('modal-form').querySelector('[data-k="' + k + '"]'); return el ? el.value.trim() : ''; };
      const name = g('clientName'), phoneRaw = g('clientPhone'), emailRaw = g('clientEmail');
      const serviceType = g('serviceType');
      const isBusiness = $('modal-form').querySelector('[data-k="isBusiness"]').checked;
      const phone = phoneRaw ? caseToE164(phoneRaw) : '';
      const email = emailRaw ? emailRaw.toLowerCase() : '';
      if (!name) { alert('יש להזין שם לקוח.'); return; }
      if (!phone && !email) { alert('יש להזין טלפון או אימייל — לפיהם הלקוח נכנס לפורטל.'); return; }
      if (phoneRaw && !phone) { alert('מספר הטלפון אינו תקין.'); return; }
      $('modal-save').disabled = true;
      try {
        const ref = await fs.addDoc(fs.collection(db, 'cases'), {
          clientName: name, clientPhone: phone, clientEmail: email,
          serviceType, isBusiness, stage2Open: false, status: 'active',
          items: buildItems(serviceType, isBusiness),
          fromLead: prefill.leadId || '',
          createdBy: currentEmail, createdAt: fs.serverTimestamp(),
        });
        // רישום בכרטיס הליד שממנו נפתח התיק
        if (prefill.leadId) {
          const l = allLeads.find((x) => x.id === prefill.leadId);
          const act = ((l && l.activity) || []).slice();
          act.push({ at: nowISO(), by: currentEmail, action: 'פתח תיק לקוח בפורטל המסמכים' });
          fs.updateDoc(fs.doc(db, 'leads', prefill.leadId), { activity: act }).catch(() => {});
        }
        pendingOpenCase = ref.id;   // ייפתח אוטומטית כדי לשלוח ללקוח מיד
        closeModal();
      } catch (err) { alert('שגיאה: ' + err.message); }
      $('modal-save').disabled = false;
    };
  }

  /* ---- כרטיס תיק: מעקב, אישור/דחייה, פתיחת שלב 2 ---- */
  let currentCase = null;
  function openCaseModal(c) {
    if (!c) return;
    currentCase = c;
    $('cm-name').textContent = c.clientName || '—';
    $('cm-sub').innerHTML = esc(serviceLabel(c.serviceType)) +
      (c.clientPhone ? ' · <span style="direction:ltr">' + esc(c.clientPhone) + '</span>' : '') +
      (c.clientEmail ? ' · <span style="direction:ltr">' + esc(c.clientEmail) + '</span>' : '') +
      (c.isBusiness ? ' · בעל עסק' : '');
    $('cm-stage2-btn').textContent = c.stage2Open ? 'סגירת שלב 2' : 'פתיחת שלב 2 ללקוח';
    renderSendBar(c);
    renderCaseItems(c);
    $('case-modal').hidden = false;
  }
  function renderCaseItems(c) {
    const items = c.items || [];
    const row = (it, gi) => {
      const files = (it.files || []).map((f) =>
        '<a class="file-chip" href="' + esc(f.url) + '" target="_blank" rel="noopener">📄 ' + esc(f.name) + '</a>').join('');
      const st = it.status === 'received' ? '<span class="pill received">✓ התקבל</span>'
        : it.status === 'rejected' ? '<span class="pill rejected">✕ נדחה</span>'
        : '<span class="pill pending">ממתין</span>';
      return '<div class="cm-item">' +
        '<div class="cm-item-head"><span>' + esc(it.label) + '</span>' + st + '</div>' +
        (files ? '<div class="file-list">' + files + '</div>' : '<div class="cm-nofiles">טרם הועלו קבצים</div>') +
        (it.status === 'rejected' && it.rejectReason ? '<div class="reject-reason">סיבה: ' + esc(it.rejectReason) + '</div>' : '') +
        '<div class="cm-item-actions">' +
          '<button class="btn-ghost" data-approve="' + gi + '">אישור</button>' +
          '<button class="btn-ghost" data-reject="' + gi + '">דחייה</button>' +
          (it.status !== 'pending' ? '<button class="btn-ghost" data-reset="' + gi + '">איפוס</button>' : '') +
        '</div></div>';
    };
    const s1 = items.map((it, i) => ({ it, i })).filter((x) => x.it.stage === 1);
    const s2 = items.map((it, i) => ({ it, i })).filter((x) => x.it.stage === 2);
    let html = '<div class="cm-group"><h4>מסמכים ראשוניים</h4>' + s1.map((x) => row(x.it, x.i)).join('') + '</div>';
    if (s2.length) html += '<div class="cm-group"><h4>שלב 2 — מסמכים משלימים' + (c.stage2Open ? '' : ' (טרם נפתח ללקוח)') + '</h4>' + s2.map((x) => row(x.it, x.i)).join('') + '</div>';
    $('cm-items').innerHTML = html;
    const setStatus = async (gi, status, reason) => {
      const arr = (currentCase.items || []).slice();
      arr[gi] = { ...arr[gi], status, rejectReason: reason || '' };
      try { await fs.updateDoc(fs.doc(db, 'cases', currentCase.id), { items: arr }); currentCase.items = arr; renderCaseItems(currentCase); }
      catch (e) { alert('שגיאה: ' + e.message); }
    };
    $('cm-items').querySelectorAll('[data-approve]').forEach((b) => b.onclick = () => setStatus(+b.dataset.approve, 'received'));
    $('cm-items').querySelectorAll('[data-reset]').forEach((b) => b.onclick = () => setStatus(+b.dataset.reset, 'pending'));
    $('cm-items').querySelectorAll('[data-reject]').forEach((b) => b.onclick = () => {
      const r = prompt('סיבת הדחייה (תוצג ללקוח):', ''); if (r === null) return; setStatus(+b.dataset.reject, 'rejected', r.trim());
    });
  }
  $('cm-close').addEventListener('click', () => $('case-modal').hidden = true);
  $('cm-cancel').addEventListener('click', () => $('case-modal').hidden = true);
  $('case-modal').addEventListener('click', (e) => { if (e.target === $('case-modal')) $('case-modal').hidden = true; });
  $('cm-stage2-btn').addEventListener('click', async () => {
    if (!currentCase) return;
    try {
      await fs.updateDoc(fs.doc(db, 'cases', currentCase.id), { stage2Open: !currentCase.stage2Open });
      currentCase.stage2Open = !currentCase.stage2Open;
      $('cm-stage2-btn').textContent = currentCase.stage2Open ? 'סגירת שלב 2' : 'פתיחת שלב 2 ללקוח';
      renderSendBar(currentCase);
      renderCaseItems(currentCase);
    } catch (e) { alert('שגיאה: ' + e.message); }
  });
  $('cm-delete').addEventListener('click', async () => {
    if (currentCase && confirm('למחוק את התיק לצמיתות? הקבצים שהועלו יישארו ב-Storage.')) {
      try { await fs.deleteDoc(fs.doc(db, 'cases', currentCase.id)); $('case-modal').hidden = true; }
      catch (e) { alert('שגיאה: ' + e.message); }
    }
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
    track(fs.onSnapshot(fs.query(fs.collection(db, 'deals'), fs.orderBy('order', 'asc')), (snap) => {
      allDeals = snap.docs.map((d) => ({ id: d.id, ...d.data() })); renderDeals();
    }, (err) => { console.warn(err); $('deals-grid').innerHTML = '<p class="empty-state">שגיאה בטעינה.</p>'; }));
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

  /* ============================================================
     המלצות לקוחות
     ============================================================ */
  const TESTI_FIELDS = [
    { k: 'quote_he', l: 'ציטוט (עברית)', t: 'textarea' },
    { k: 'quote_en', l: 'Quote (English)', t: 'textarea' },
    { k: 'name', l: 'שם', t: 'text' },
    { k: 'role_he', l: 'תפקיד (עברית)', t: 'text', hint: 'לדוגמה: משקיע פרטי, ת"א' },
    { k: 'role_en', l: 'Role (English)', t: 'text' },
    { k: 'initials', l: 'ראשי תיבות', t: 'text', hint: 'לדוגמה: א.כ' },
  ];
  let allTesti = [];
  function listenTestimonials() {
    track(fs.onSnapshot(fs.query(fs.collection(db, 'testimonials'), fs.orderBy('order', 'asc')), (snap) => {
      allTesti = snap.docs.map((d) => ({ id: d.id, ...d.data() })); renderTestimonials();
    }, (err) => { console.warn(err); $('testimonials-grid').innerHTML = '<p class="empty-state">שגיאה בטעינה.</p>'; }));
  }
  function renderTestimonials() {
    const grid = $('testimonials-grid');
    if (!allTesti.length) {
      grid.innerHTML = '<div class="empty-state"><p>אין המלצות במערכת עדיין.</p><button class="crm-btn" style="width:auto;margin-top:12px" id="seed-testi">ייבוא ההמלצות הקיימות מהאתר</button></div>';
      const sb = $('seed-testi');
      if (sb) sb.addEventListener('click', async () => {
        sb.disabled = true; sb.textContent = 'מייבא…';
        try {
          const r = await fetch('/data/testimonials.json', { cache: 'no-cache' }); const data = await r.json(); const items = (data && data.testimonials) || [];
          for (let i = 0; i < items.length; i++) await fs.addDoc(fs.collection(db, 'testimonials'), { ...items[i], order: i });
          alert('יובאו ' + items.length + ' המלצות בהצלחה.');
        } catch (err) { alert('שגיאה בייבוא: ' + err.message); sb.disabled = false; sb.textContent = 'ייבוא ההמלצות הקיימות מהאתר'; }
      });
      return;
    }
    grid.innerHTML = allTesti.map((t) => `<div class="editor-card">`+
      `<span class="ec-cat">${esc(t.initials || '')}</span><span class="ec-title">${esc(t.name || '(ללא שם)')}</span>`+
      `<span class="ec-meta">${esc(t.role_he || '')}</span>`+
      `<p style="font-size:var(--fs-sm);color:var(--color-charcoal-soft);margin:0">${esc((t.quote_he || '').slice(0, 90))}…</p>`+
      `<div class="ec-actions"><button class="crm-btn" style="width:auto;font-size:.85rem;padding:.5em 1em" data-edit-testi="${t.id}">עריכה</button>`+
      `<button class="icon-btn danger" data-del-testi="${t.id}" title="מחיקה"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg></button></div></div>`).join('');
    grid.querySelectorAll('[data-edit-testi]').forEach((b) => b.addEventListener('click', () => openTestiModal(allTesti.find((x) => x.id === b.dataset.editTesti))));
    grid.querySelectorAll('[data-del-testi]').forEach((b) => b.addEventListener('click', () => { if (confirm('למחוק את ההמלצה?')) fs.deleteDoc(fs.doc(db,'testimonials',b.dataset.delTesti)); }));
  }
  $('add-testimonial').addEventListener('click', () => openTestiModal(null));
  function openTestiModal(item) {
    const editing = !!item;
    $('modal-title').textContent = editing ? 'עריכת המלצה' : 'המלצה חדשה';
    $('modal-form').innerHTML = TESTI_FIELDS.map((f) => {
      const v = editing ? (item[f.k] || '') : '';
      const input = f.t === 'textarea' ? `<textarea data-k="${f.k}">${esc(v)}</textarea>` : `<input type="text" data-k="${f.k}" value="${esc(v)}">`;
      return `<div class="field"><label>${f.l}</label>${input}${f.hint?`<div class="field-hint">${f.hint}</div>`:''}</div>`;
    }).join('');
    $('modal').hidden = false;
    $('modal-save').onclick = async () => {
      const data = {}; $('modal-form').querySelectorAll('[data-k]').forEach((el) => { data[el.dataset.k] = el.value.trim(); });
      $('modal-save').disabled = true;
      try {
        if (editing) await fs.updateDoc(fs.doc(db, 'testimonials', item.id), data);
        else await fs.addDoc(fs.collection(db, 'testimonials'), { ...data, order: allTesti.length });
        closeModal();
      } catch (err) { alert('שגיאה בשמירה: ' + err.message); }
      $('modal-save').disabled = false;
    };
  }

  /* ============================================================
     מנוע גנרי לניהול תוכן (צוות / שאלות נפוצות / ...)
     ============================================================ */
  function contentCollection(o) {
    let items = [];
    function listen() {
      track(fs.onSnapshot(fs.query(fs.collection(db, o.name), fs.orderBy('order', 'asc')), (snap) => {
        items = snap.docs.map((d) => ({ id: d.id, ...d.data() })); render();
      }, (err) => { console.warn(err); $(o.gridId).innerHTML = '<p class="empty-state">שגיאה בטעינה.</p>'; }));
    }
    function render() {
      const grid = $(o.gridId);
      if (!items.length) {
        grid.innerHTML = `<div class="empty-state"><p>אין ${o.labelPlural} במערכת עדיין.</p><button class="crm-btn" style="width:auto;margin-top:12px" id="seed-${o.name}">ייבוא ה${o.labelPlural} הקיימים מהאתר</button></div>`;
        const sb = $('seed-' + o.name);
        if (sb) sb.addEventListener('click', async () => {
          sb.disabled = true; sb.textContent = 'מייבא…';
          try {
            const r = await fetch(o.seedPath, { cache: 'no-cache' }); const data = await r.json(); const arr = (data && data[o.seedKey]) || [];
            for (let i = 0; i < arr.length; i++) await fs.addDoc(fs.collection(db, o.name), { ...arr[i], order: i });
            alert('יובאו ' + arr.length + ' פריטים בהצלחה.');
          } catch (err) { alert('שגיאה בייבוא: ' + err.message); sb.disabled = false; sb.textContent = 'ייבוא ה' + o.labelPlural + ' הקיימים מהאתר'; }
        });
        return;
      }
      grid.innerHTML = items.map(o.card).join('');
      grid.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openModal(items.find((x) => x.id === b.dataset.edit))));
      grid.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => { if (confirm('למחוק פריט זה?')) fs.deleteDoc(fs.doc(db, o.name, b.dataset.del)); }));
    }
    function openModal(item) {
      const editing = !!item;
      $('modal-title').textContent = editing ? ('עריכת ' + o.labelSingular) : (o.labelSingular + ' חדש');
      $('modal-form').innerHTML = o.fields.map((f) => {
        const v = editing ? (item[f.k] || '') : '';
        const inp = f.t === 'textarea' ? `<textarea data-k="${f.k}">${esc(v)}</textarea>` : `<input type="text" data-k="${f.k}" value="${esc(v)}">`;
        return `<div class="field"><label>${f.l}</label>${inp}${f.hint?`<div class="field-hint">${f.hint}</div>`:''}</div>`;
      }).join('');
      $('modal').hidden = false;
      $('modal-save').onclick = async () => {
        const data = {}; $('modal-form').querySelectorAll('[data-k]').forEach((el) => { data[el.dataset.k] = el.value.trim(); });
        $('modal-save').disabled = true;
        try {
          if (editing) await fs.updateDoc(fs.doc(db, o.name, item.id), data);
          else await fs.addDoc(fs.collection(db, o.name), { ...data, order: items.length });
          closeModal();
        } catch (err) { alert('שגיאה בשמירה: ' + err.message); }
        $('modal-save').disabled = false;
      };
    }
    $(o.addBtnId).addEventListener('click', () => openModal(null));

    // ייבוא/סנכרון מהאתר — מוסיף רק פריטים שחסרים (לפי מפתח), בלי כפילויות
    if (o.syncBtnId && $(o.syncBtnId)) {
      $(o.syncBtnId).addEventListener('click', async (e) => {
        const btn = e.currentTarget, orig = btn.textContent; btn.disabled = true; btn.textContent = 'מייבא…';
        try {
          const r = await fetch(o.seedPath, { cache: 'no-cache' });
          const data = await r.json(); const arr = (data && data[o.seedKey]) || [];
          const have = new Set(items.map((x) => String(x[o.dedupKey] || '').trim()));
          let added = 0;
          for (let i = 0; i < arr.length; i++) {
            const key = String(arr[i][o.dedupKey] || '').trim();
            if (have.has(key)) continue;
            await fs.addDoc(fs.collection(db, o.name), { ...arr[i], order: items.length + added });
            added++;
          }
          alert(added ? ('נוספו ' + added + ' פריטים חדשים.') : 'הכל כבר מעודכן — אין מה לייבא.');
        } catch (err) { alert('שגיאה בייבוא: ' + err.message); }
        btn.disabled = false; btn.textContent = orig;
      });
    }
    return { listen };
  }

  const teamCol = contentCollection({
    name: 'team', gridId: 'team-grid-panel', addBtnId: 'add-team', syncBtnId: 'sync-team', dedupKey: 'role_he',
    labelSingular: 'איש צוות', labelPlural: 'אנשי צוות', seedPath: '/data/team.json', seedKey: 'team',
    fields: [
      { k: 'role_he', l: 'תפקיד (עברית)', t: 'text', hint: 'לדוגמה: שותף · ראש תחום נדל"ן' },
      { k: 'role_en', l: 'Role (English)', t: 'text' },
      { k: 'bio_he', l: 'ביו (עברית)', t: 'textarea' },
      { k: 'bio_en', l: 'Bio (English)', t: 'textarea' },
    ],
    card: (t) => `<div class="editor-card"><span class="ec-title">${esc(t.role_he || '(ללא תפקיד)')}</span>`+
      `<p style="font-size:var(--fs-sm);color:var(--color-charcoal-soft);margin:0">${esc((t.bio_he || '').slice(0, 110))}…</p>`+
      `<div class="ec-actions"><button class="crm-btn" style="width:auto;font-size:.85rem;padding:.5em 1em" data-edit="${t.id}">עריכה</button>`+
      `<button class="icon-btn danger" data-del="${t.id}" title="מחיקה"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg></button></div></div>`,
  });

  const faqCol = contentCollection({
    name: 'faq', gridId: 'faq-grid-panel', addBtnId: 'add-faq', syncBtnId: 'sync-faq', dedupKey: 'question_he',
    labelSingular: 'שאלה', labelPlural: 'שאלות', seedPath: '/data/faq.json', seedKey: 'faq',
    fields: [
      { k: 'category_he', l: 'קטגוריה (עברית)', t: 'text', hint: 'לדוגמה: מימון ומשכנתאות' },
      { k: 'category_en', l: 'Category (English)', t: 'text' },
      { k: 'question_he', l: 'שאלה (עברית)', t: 'text' },
      { k: 'question_en', l: 'Question (English)', t: 'text' },
      { k: 'answer_he', l: 'תשובה (עברית)', t: 'textarea' },
      { k: 'answer_en', l: 'Answer (English)', t: 'textarea' },
    ],
    card: (f) => `<div class="editor-card"><span class="ec-cat">${esc(f.category_he || '')}</span>`+
      `<span class="ec-title" style="font-size:var(--fs-base)">${esc(f.question_he || '(ללא שאלה)')}</span>`+
      `<p style="font-size:var(--fs-sm);color:var(--color-charcoal-soft);margin:0">${esc((f.answer_he || '').slice(0, 90))}…</p>`+
      `<div class="ec-actions"><button class="crm-btn" style="width:auto;font-size:.85rem;padding:.5em 1em" data-edit="${f.id}">עריכה</button>`+
      `<button class="icon-btn danger" data-del="${f.id}" title="מחיקה"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg></button></div></div>`,
  });

  const articlesCol = contentCollection({
    name: 'articles', gridId: 'articles-grid', addBtnId: 'add-article', syncBtnId: 'sync-articles', dedupKey: 'title_he',
    labelSingular: 'מאמר', labelPlural: 'מאמרים', seedPath: '/data/articles.json', seedKey: 'articles',
    fields: [
      { k: 'title_he', l: 'כותרת (עברית)', t: 'text' },
      { k: 'title_en', l: 'Title (English)', t: 'text' },
      { k: 'category_he', l: 'קטגוריה (עברית)', t: 'text', hint: 'לדוגמה: מימון' },
      { k: 'category_en', l: 'Category (English)', t: 'text' },
      { k: 'date', l: 'תאריך', t: 'text', hint: 'לדוגמה: 15.04.2026' },
      { k: 'read_he', l: 'זמן קריאה (עברית)', t: 'text', hint: "לדוגמה: 5 דק' קריאה" },
      { k: 'read_en', l: 'Read time (English)', t: 'text', hint: 'e.g. 5 min read' },
      { k: 'image', l: 'נתיב תמונה', t: 'text', hint: '/assets/images/blog-xxx.jpg' },
      { k: 'excerpt_he', l: 'תקציר (עברית)', t: 'textarea' },
      { k: 'excerpt_en', l: 'Excerpt (English)', t: 'textarea' },
      { k: 'body_he', l: 'גוף המאמר (עברית)', t: 'textarea', hint: 'טקסט רגיל — שורה ריקה מפרידה בין פסקאות. אפשר גם HTML.' },
      { k: 'body_en', l: 'Article body (English)', t: 'textarea' },
    ],
    card: (a) => `<div class="editor-card">`+
      (a.image ? `<img class="ec-img" src="${esc(a.image)}" alt="" onerror="this.style.display='none'">` : '')+
      `<span class="ec-cat">${esc(a.category_he || '')} · ${esc(a.date || '')}</span>`+
      `<span class="ec-title" style="font-size:var(--fs-base)">${esc(a.title_he || '(ללא כותרת)')}</span>`+
      `<p style="font-size:var(--fs-sm);color:var(--color-charcoal-soft);margin:0">${esc((a.excerpt_he || '').slice(0, 90))}…</p>`+
      `<div class="ec-actions"><button class="crm-btn" style="width:auto;font-size:.85rem;padding:.5em 1em" data-edit="${a.id}">עריכה</button>`+
      `<button class="icon-btn danger" data-del="${a.id}" title="מחיקה"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg></button></div></div>`,
  });
}
