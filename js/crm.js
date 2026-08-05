/* ============================================================
   הורייזון פסגות גרופ — crm.js  (module)
   פאנל ניהול מאוחד: לידים · עסקאות · מאמרים (Firebase)
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
      $('login-view').hidden = true; $('app-view').hidden = false;
      $('user-email').textContent = user.email;
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
  const STATUS = { new:{he:'חדש',cls:'new'}, contacted:{he:'יצרתי קשר',cls:'contacted'}, in_progress:{he:'בטיפול',cls:'contacted'}, closed:{he:'נסגר',cls:'closed'} };
  let allLeads = [], leadFilter = 'all';

  function listenLeads() {
    fs.onSnapshot(fs.query(fs.collection(db, 'leads'), fs.orderBy('createdAt', 'desc')), (snap) => {
      allLeads = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderLeadStats(); renderLeads();
    }, (err) => { console.warn(err); $('leads-body').innerHTML = '<tr><td colspan="7" class="empty-state">שגיאה בטעינה. בדקו כללי אבטחה.</td></tr>'; });
  }
  function renderLeadStats() {
    const m = new Date(); const monthStart = new Date(m.getFullYear(), m.getMonth(), 1);
    $('stat-total').textContent = allLeads.length;
    $('stat-new').textContent = allLeads.filter((l) => (l.status || 'new') === 'new').length;
    $('stat-closed').textContent = allLeads.filter((l) => l.status === 'closed').length;
    $('stat-month').textContent = allLeads.filter((l) => { const d = toDateObj(l.createdAt); return d && d >= monthStart; }).length;
  }
  $('filters').addEventListener('click', (e) => {
    const b = e.target.closest('.filter-btn'); if (!b) return;
    leadFilter = b.dataset.filter;
    document.querySelectorAll('.filter-btn').forEach((x) => x.classList.toggle('active', x === b));
    renderLeads();
  });
  // תומך ב-Firestore Timestamp, מחרוזת ISO, או מספר (לגמישות מול Make/פייסבוק)
  function toDateObj(ts) {
    if (!ts) return null;
    if (ts.toDate) return ts.toDate();
    const d = new Date(ts);
    return isNaN(d.getTime()) ? null : d;
  }
  function fmtDate(ts) { const d = toDateObj(ts); if (!d) return '—'; const p = (n) => ('0' + n).slice(-2); return `${p(d.getDate())}/${p(d.getMonth()+1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`; }
  function phoneIntl(p) { let d = String(p || '').replace(/\D/g, ''); if (d.startsWith('0')) d = '972' + d.slice(1); return d; }
  function renderLeads() {
    let rows = allLeads;
    if (['new','contacted','closed'].includes(leadFilter)) rows = rows.filter((l) => (l.status||'new')===leadFilter || (leadFilter==='contacted'&&l.status==='in_progress'));
    else if (['website','facebook'].includes(leadFilter)) rows = rows.filter((l) => (l.source||'website')===leadFilter);
    const body = $('leads-body');
    if (!rows.length) { body.innerHTML = '<tr><td colspan="7" class="empty-state">אין פניות להצגה.</td></tr>'; return; }
    body.innerHTML = rows.map((l) => {
      const st = STATUS[l.status||'new'] || STATUS.new;
      const src = (l.source||'website')==='facebook' ? '<span class="src-badge src-facebook">פייסבוק</span>' : '<span class="src-badge src-website">אתר</span>';
      const opts = Object.keys(STATUS).filter((k)=>k!=='in_progress').map((k)=>`<option value="${k}"${(l.status||'new')===k?' selected':''}>${STATUS[k].he}</option>`).join('');
      const topic = [l.audience, l.topic].filter(Boolean).join(' · ') || '—';
      const sub = l.message || (l.hasAsset ? 'נכס: ' + l.hasAsset : '');
      return `<tr><td class="lead-date">${fmtDate(l.createdAt)}</td>`+
        `<td><div class="lead-name">${esc(l.name)}</div>${sub?`<div class="lead-sub">${esc(sub)}</div>`:''}</td>`+
        `<td class="lead-contact"><a href="tel:${esc(l.phone)}">${esc(l.phone)}</a>${l.email?`<a href="mailto:${esc(l.email)}">${esc(l.email)}</a>`:''}</td>`+
        `<td>${esc(topic)}</td><td>${src}</td>`+
        `<td><select class="status-select ${st.cls}" data-id="${l.id}">${opts}</select></td>`+
        `<td><div class="row-actions"><a class="icon-btn" href="https://wa.me/${phoneIntl(l.phone)}" target="_blank" rel="noopener" title="וואטסאפ"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15l-1.3 4.7 4.8-1.3A10 10 0 1 0 12 2z"/></svg></a>`+
        `<button class="icon-btn danger" data-del-lead="${l.id}" title="מחיקה"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg></button></div></td></tr>`;
    }).join('');
    body.querySelectorAll('.status-select').forEach((s) => s.addEventListener('change', () => fs.updateDoc(fs.doc(db,'leads',s.dataset.id), { status: s.value })));
    body.querySelectorAll('[data-del-lead]').forEach((b) => b.addEventListener('click', () => { if (confirm('למחוק את הפנייה?')) fs.deleteDoc(fs.doc(db,'leads',b.dataset.delLead)); }));
  }

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
      allDeals = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderDeals();
    }, (err) => { console.warn(err); $('deals-grid').innerHTML = '<p class="empty-state">שגיאה בטעינה.</p>'; });
  }
  function renderDeals() {
    const grid = $('deals-grid');
    if (!allDeals.length) {
      grid.innerHTML = '<div class="empty-state"><p>אין עסקאות במערכת עדיין.</p>'+
        '<button class="crm-btn" style="width:auto;margin-top:12px" id="seed-deals">ייבוא העסקאות הקיימות מהאתר</button></div>';
      const sb = $('seed-deals');
      if (sb) sb.addEventListener('click', async () => {
        sb.disabled = true; sb.textContent = 'מייבא…';
        try {
          const r = await fetch('/data/deals.json', { cache: 'no-cache' });
          const data = await r.json();
          const deals = (data && data.deals) || [];
          for (let i = 0; i < deals.length; i++) {
            await fs.addDoc(fs.collection(db, 'deals'), { ...deals[i], order: i, createdAt: fs.serverTimestamp() });
          }
          alert('יובאו ' + deals.length + ' עסקאות בהצלחה.');
        } catch (err) { alert('שגיאה בייבוא: ' + err.message); sb.disabled = false; sb.textContent = 'ייבוא העסקאות הקיימות מהאתר'; }
      });
      return;
    }
    grid.innerHTML = allDeals.map((d) => `<div class="editor-card">`+
      (d.image ? `<img class="ec-img" src="${esc(d.image)}" alt="" onerror="this.style.display='none'">` : '')+
      `<span class="ec-cat">${esc(d.category_he || '')}</span>`+
      `<span class="ec-title">${esc(d.title_he || '(ללא כותרת)')}</span>`+
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
      const input = f.t === 'textarea'
        ? `<textarea data-k="${f.k}">${esc(v)}</textarea>`
        : `<input type="text" data-k="${f.k}" value="${esc(v)}">`;
      return `<div class="field"><label>${f.l}</label>${input}${f.hint?`<div class="field-hint">${f.hint}</div>`:''}</div>`;
    }).join('');
    $('modal').hidden = false;
    $('modal-save').onclick = async () => {
      const data = {};
      $('modal-form').querySelectorAll('[data-k]').forEach((el) => { data[el.dataset.k] = el.value.trim(); });
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
