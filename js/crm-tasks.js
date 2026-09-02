/* ============================================================
   הורייזון פסגות גרופ — crm-tasks.js  (module)
   ניהול משימות לצוות: רשימה · לוח (קנבן) · לוח שנה · לוח צוות
   התראות פנימיות · משימות חוזרות · אוטומציות · קישור לליד/תיק
   נטען מתוך crm.js עם ctx (Firebase + עזרים + מצב המשתמש).
   ============================================================ */

export const TASK_STATUS = {
  open:        { he: 'חדשה',        cls: 'open' },
  in_progress: { he: 'בטיפול',      cls: 'progress' },
  waiting:     { he: 'ממתין ללקוח', cls: 'waiting' },
  done:        { he: 'הושלמה',      cls: 'done' },
  cancelled:   { he: 'בוטלה',       cls: 'cancelled' },
};
const STATUS_KEYS = Object.keys(TASK_STATUS);
const BOARD_COLS = ['open', 'in_progress', 'waiting', 'done'];
const PRIO = { normal: { he: 'רגילה', cls: 'normal' }, high: { he: 'גבוהה', cls: 'high' }, urgent: { he: 'דחוף', cls: 'urgent' } };
const REPEAT = { '': 'חד-פעמי', daily: 'כל יום', weekly: 'כל שבוע', monthly: 'כל חודש' };
const OPEN = (t) => t.status !== 'done' && t.status !== 'cancelled';
const STALE_LEAD_HOURS = 24;

export function initTasks(ctx) {
  const { fs, db, $, esc, track, nowISO, fmtDate, todayStr, toDateObj, displayName } = ctx;

  let allTasks = [];
  let unsub = null, listenAs = null;      // 'owner' → כל המשימות · אחרת → רק private == false
  let view = 'list', filter = 'mine', q = '', userF = '', prioF = '';
  let calMonth = null;                    // Date של החודש המוצג בלוח השנה
  let current = null;                     // המשימה הפתוחה בכרטיס
  let link = null;                        // {type, id, name} של הקישור בכרטיס
  let bellSeen = 0;                       // חותמת "נראה" להתראות (localStorage לפי משתמש)

  const me = () => ctx.me();
  const role = () => ctx.role();
  const isOwner = () => role() === 'owner';
  const isMgr = () => role() === 'owner' || role() === 'manager';
  const users = () => ctx.users();
  const userByUid = (uid) => users().find((u) => u.uid === uid);
  const nameOfUid = (uid) => { const u = userByUid(uid); return u ? (u.name || displayName(u.email)) : '—'; };
  const roleOfUid = (uid) => { const u = userByUid(uid); return u ? (u.role || 'agent') : 'agent'; };

  /* ---------- תאריכים ---------- */
  const p2 = (n) => ('0' + n).slice(-2);
  const dayStr = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  const addDays = (ymd, n) => { const d = new Date(ymd + 'T00:00:00'); d.setDate(d.getDate() + n); return dayStr(d); };
  const addMonths = (ymd, n) => { const d = new Date(ymd + 'T00:00:00'); d.setMonth(d.getMonth() + n); return dayStr(d); };
  const weekEnd = () => addDays(todayStr(), 7);
  const nowHM = () => { const d = new Date(); return `${p2(d.getHours())}:${p2(d.getMinutes())}`; };
  const fmtDue = (t) => {
    if (!t.dueDate) return 'ללא תאריך';
    const [y, m, d] = t.dueDate.split('-');
    const today = todayStr();
    let s = t.dueDate === today ? 'היום' : t.dueDate === addDays(today, 1) ? 'מחר' : t.dueDate === addDays(today, -1) ? 'אתמול' : `${d}/${m}/${y.slice(2)}`;
    if (t.dueTime) s += ' ' + t.dueTime;
    return s;
  };
  function isOverdue(t) {
    if (!OPEN(t) || t.status === 'waiting' || !t.dueDate) return false;   // "ממתין ללקוח" לא נספר כאיחור
    const today = todayStr();
    if (t.dueDate < today) return true;
    return t.dueDate === today && !!t.dueTime && t.dueTime < nowHM();
  }
  const isToday = (t) => OPEN(t) && t.dueDate === todayStr();
  const isMine = (t) => t.assignedUid === me().uid;
  const daysBetween = (a, b) => Math.round((toDateObj(b) - toDateObj(a)) / 864e5);

  /* ---------- הרשאות (מראה ל-UI; נאכף גם ב-firestore.rules) ---------- */
  function canEditFull(t) {
    if (!t) return true;
    if (isOwner()) return true;
    const creatorIsOwner = roleOfUid(t.createdByUid) === 'owner';
    if (role() === 'manager') return !creatorIsOwner;
    return t.createdByUid === me().uid;                    // נציג: רק משימות שיצר לעצמו
  }
  function canProgress(t) {                                // סטטוס / תגובות
    if (isOwner()) return true;
    if (role() === 'manager') return true;
    return t.assignedUid === me().uid || t.createdByUid === me().uid;
  }
  function canDelete(t) {
    if (isOwner()) return true;
    if (role() === 'manager') return roleOfUid(t.createdByUid) !== 'owner';
    return t.createdByUid === me().uid && t.assignedUid === me().uid;
  }

  /* ---------- האזנה ---------- */
  function listen() {
    const want = isOwner() ? 'owner' : 'team';
    if (unsub && listenAs === want) return;
    if (unsub) { try { unsub(); } catch (e) {} }
    listenAs = want;
    const col = fs.collection(db, 'tasks');
    const ref = want === 'owner' ? col : fs.query(col, fs.where('private', '==', false));
    unsub = track(fs.onSnapshot(ref, (snap) => {
      allTasks = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
      sortTasks(allTasks);
      renderAll();
      runReminders();
      if (current) { const fresh = allTasks.find((t) => t.id === current.id); if (fresh) { current = fresh; renderComments(fresh); renderActivity(fresh); } }
      runAutomations();
    }, (err) => { console.warn('tasks listener', err); $('tasks-list').innerHTML = '<div class="empty-state">שגיאה בטעינת משימות. בדקו שכללי האבטחה (firestore.rules) פורסמו.</div>'; }));
  }
  const PRIO_RANK = { urgent: 0, high: 1, normal: 2 };
  function sortTasks(arr) {
    arr.sort((a, b) => {
      const oa = OPEN(a) ? 0 : 1, ob = OPEN(b) ? 0 : 1; if (oa !== ob) return oa - ob;
      const da = a.dueDate || '9999', dbb = b.dueDate || '9999'; if (da !== dbb) return da < dbb ? -1 : 1;
      const pa = PRIO_RANK[a.priority] ?? 2, pb = PRIO_RANK[b.priority] ?? 2; if (pa !== pb) return pa - pb;
      return (b.createdAt || '') < (a.createdAt || '') ? -1 : 1;
    });
  }

  /* ---------- סינון ---------- */
  function visibleTasks() {
    let rows = allTasks;
    switch (filter) {
      case 'mine': rows = rows.filter((t) => isMine(t) && OPEN(t)); break;
      case 'today': rows = rows.filter((t) => isToday(t) || isOverdue(t)); break;
      case 'overdue': rows = rows.filter(isOverdue); break;
      case 'week': rows = rows.filter((t) => OPEN(t) && t.dueDate && t.dueDate <= weekEnd()); break;
      case 'waiting': rows = rows.filter((t) => t.status === 'waiting'); break;
      case 'open': rows = rows.filter(OPEN); break;
      case 'done': rows = rows.filter((t) => t.status === 'done'); break;
    }
    if (userF) rows = rows.filter((t) => t.assignedUid === userF);
    if (prioF) rows = rows.filter((t) => (t.priority || 'normal') === prioF);
    if (q) rows = rows.filter((t) => [t.title, t.desc, t.link && t.link.name, nameOfUid(t.assignedUid)].filter(Boolean).join(' ').toLowerCase().includes(q));
    return rows;
  }

  /* ---------- רינדור ---------- */
  function renderAll() {
    renderStats(); renderBadge(); renderBell(); renderAutoNotes();
    if (view === 'list') renderList();
    else if (view === 'board') renderBoard();
    else if (view === 'calendar') renderCalendar();
    else renderTeam();
    renderLinked('lead'); renderLinked('case');
  }
  function renderStats() {
    const mine = isMgr() && !userF ? allTasks : allTasks.filter((t) => userF ? t.assignedUid === userF : isMine(t));
    const weekAgo = addDays(todayStr(), -7);
    $('ts-open').textContent = mine.filter(OPEN).length;
    $('ts-today').textContent = mine.filter(isToday).length;
    $('ts-overdue').textContent = mine.filter(isOverdue).length;
    $('ts-done').textContent = mine.filter((t) => t.status === 'done' && t.completedAt && t.completedAt.slice(0, 10) >= weekAgo).length;
  }
  function renderBadge() {
    const n = allTasks.filter((t) => isMine(t) && isOverdue(t)).length;
    const b = $('tasks-badge'); b.textContent = n; b.hidden = !n;
  }
  const prioTag = (t) => (t.priority && t.priority !== 'normal') ? `<span class="t-prio ${PRIO[t.priority].cls}">${PRIO[t.priority].he}</span>` : '';
  const linkTag = (t) => t.link ? `<span class="t-link">${t.link.type === 'case' ? '📁' : '👤'} ${esc(t.link.name || '')}</span>` : '';
  const repeatTag = (t) => t.repeat ? `<span class="t-repeat" title="${REPEAT[t.repeat]}">⟳</span>` : '';

  function taskRow(t) {
    const st = TASK_STATUS[t.status] || TASK_STATUS.open;
    const od = isOverdue(t);
    const checkable = canProgress(t) && OPEN(t);
    return `<div class="task-row st-${st.cls}${od ? ' overdue' : ''}${!OPEN(t) ? ' closed' : ''}" data-task="${t.id}">` +
      `<button type="button" class="t-check${t.status === 'done' ? ' on' : ''}" data-done="${t.id}" title="${t.status === 'done' ? 'הושלמה' : 'סימון כהושלמה'}" ${checkable ? '' : 'disabled'}>${t.status === 'done' ? '✓' : ''}</button>` +
      `<div class="t-main"><div class="t-title">${esc(t.title)} ${prioTag(t)} ${repeatTag(t)}</div>` +
      `<div class="t-meta">${linkTag(t)}<span class="t-assignee">${esc(nameOfUid(t.assignedUid))}</span>` +
      `${t.createdByUid !== t.assignedUid ? `<span class="t-by">מאת ${esc(nameOfUid(t.createdByUid))}</span>` : ''}` +
      `${(t.comments || []).length ? `<span class="t-cc">💬 ${t.comments.length}</span>` : ''}` +
      `${t.private ? '<span class="t-private" title="נסתר מהצוות">🔒</span>' : ''}</div></div>` +
      `<div class="t-side"><span class="t-due${od ? ' late' : ''}">${fmtDue(t)}</span><span class="t-status ${st.cls}">${st.he}</span></div></div>`;
  }
  function bindRows(root) {
    root.querySelectorAll('[data-task]').forEach((r) => r.addEventListener('click', () => openTask(allTasks.find((t) => t.id === r.dataset.task))));
    root.querySelectorAll('[data-done]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); if (!b.disabled) completeTask(allTasks.find((t) => t.id === b.dataset.done)); }));
  }
  function renderList() {
    const rows = visibleTasks(), el = $('tasks-list');
    if (!rows.length) { el.innerHTML = `<div class="empty-state">${allTasks.length ? 'אין משימות בסינון הזה.' : 'אין משימות עדיין. צרו את הראשונה עם "+ משימה חדשה".'}</div>`; return; }
    // קיבוץ: באיחור / היום / השבוע / בהמשך / ללא תאריך / סגורות
    const groups = [['באיחור', (t) => isOverdue(t)], ['היום', (t) => isToday(t) && !isOverdue(t)], ['השבוע', (t) => OPEN(t) && t.dueDate && t.dueDate <= weekEnd()],
      ['בהמשך', (t) => OPEN(t) && t.dueDate && t.dueDate > weekEnd()], ['ללא תאריך', (t) => OPEN(t) && !t.dueDate], ['סגורות', (t) => !OPEN(t)]];
    const used = new Set(); let html = '';
    groups.forEach(([name, fn]) => {
      const g = rows.filter((t) => !used.has(t.id) && fn(t)); g.forEach((t) => used.add(t.id));
      if (g.length) html += `<div class="t-group"><h4>${name} <span>${g.length}</span></h4>${g.map(taskRow).join('')}</div>`;
    });
    el.innerHTML = html; bindRows(el);
  }

  /* --- לוח (קנבן) עם גרירה --- */
  function renderBoard() {
    const base = allTasks.filter((t) => (filter === 'mine' ? isMine(t) : true) && (!userF || t.assignedUid === userF) && (!prioF || (t.priority || 'normal') === prioF) && (!q || [t.title, t.link && t.link.name].filter(Boolean).join(' ').toLowerCase().includes(q)));
    const weekAgo = addDays(todayStr(), -7);
    const el = $('tasks-board');
    el.innerHTML = BOARD_COLS.map((k) => {
      const items = base.filter((t) => t.status === k && (k !== 'done' || (t.completedAt || '').slice(0, 10) >= weekAgo));
      return `<div class="board-col st-${TASK_STATUS[k].cls}" data-col="${k}"><h4>${TASK_STATUS[k].he} <span>${items.length}</span>${k === 'done' ? '<small>7 ימים אחרונים</small>' : ''}</h4>` +
        `<div class="board-cards">${items.map((t) => `<div class="board-card${isOverdue(t) ? ' overdue' : ''}" draggable="${canProgress(t)}" data-task="${t.id}">` +
          `<div class="t-title">${esc(t.title)} ${prioTag(t)}</div><div class="t-meta">${linkTag(t)}<span class="t-assignee">${esc(nameOfUid(t.assignedUid))}</span></div>` +
          `<span class="t-due${isOverdue(t) ? ' late' : ''}">${fmtDue(t)}</span></div>`).join('') || '<div class="board-empty">—</div>'}</div></div>`;
    }).join('');
    bindRows(el);
    let dragId = null;
    el.querySelectorAll('.board-card[draggable="true"]').forEach((c) => {
      c.addEventListener('dragstart', (e) => { dragId = c.dataset.task; c.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
      c.addEventListener('dragend', () => c.classList.remove('dragging'));
    });
    el.querySelectorAll('.board-col').forEach((col) => {
      col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('over'); });
      col.addEventListener('dragleave', () => col.classList.remove('over'));
      col.addEventListener('drop', (e) => { e.preventDefault(); col.classList.remove('over'); const t = allTasks.find((x) => x.id === dragId); if (t && t.status !== col.dataset.col) setStatus(t, col.dataset.col); });
    });
  }

  /* --- לוח שנה חודשי --- */
  function renderCalendar() {
    if (!calMonth) { const d = new Date(); calMonth = new Date(d.getFullYear(), d.getMonth(), 1); }
    const y = calMonth.getFullYear(), m = calMonth.getMonth();
    const first = new Date(y, m, 1), startDow = first.getDay();           // 0 = ראשון
    const days = new Date(y, m + 1, 0).getDate();
    const base = allTasks.filter((t) => t.dueDate && (filter === 'mine' ? isMine(t) : true) && (!userF || t.assignedUid === userF) && (!prioF || (t.priority || 'normal') === prioF));
    const monthName = first.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
    let cells = '';
    for (let i = 0; i < startDow; i++) cells += '<div class="cal-cell empty"></div>';
    for (let d = 1; d <= days; d++) {
      const ymd = `${y}-${p2(m + 1)}-${p2(d)}`;
      const items = base.filter((t) => t.dueDate === ymd);
      cells += `<div class="cal-cell${ymd === todayStr() ? ' today' : ''}" data-day="${ymd}"><div class="cal-day">${d}</div>` +
        items.slice(0, 4).map((t) => `<div class="cal-item st-${(TASK_STATUS[t.status] || TASK_STATUS.open).cls}${isOverdue(t) ? ' late' : ''}" data-task="${t.id}" title="${esc(t.title)} · ${esc(nameOfUid(t.assignedUid))}">${t.dueTime ? `<b>${t.dueTime}</b> ` : ''}${esc(t.title)}</div>`).join('') +
        (items.length > 4 ? `<div class="cal-more">+${items.length - 4}</div>` : '') + '</div>';
    }
    $('tasks-calendar').innerHTML = `<div class="cal-head"><button class="btn-ghost" type="button" data-cal="-1">‹ הקודם</button><h4>${monthName}</h4><button class="btn-ghost" type="button" data-cal="1">הבא ›</button><button class="btn-ghost" type="button" data-cal="0">היום</button></div>` +
      `<div class="cal-grid"><div class="cal-dow">א</div><div class="cal-dow">ב</div><div class="cal-dow">ג</div><div class="cal-dow">ד</div><div class="cal-dow">ה</div><div class="cal-dow">ו</div><div class="cal-dow">ש</div>${cells}</div>`;
    const el = $('tasks-calendar');
    el.querySelectorAll('[data-cal]').forEach((b) => b.addEventListener('click', () => { const n = +b.dataset.cal; if (n === 0) calMonth = null; else calMonth = new Date(y, m + n, 1); renderCalendar(); }));
    el.querySelectorAll('[data-task]').forEach((c) => c.addEventListener('click', (e) => { e.stopPropagation(); openTask(allTasks.find((t) => t.id === c.dataset.task)); }));
    el.querySelectorAll('.cal-cell[data-day]').forEach((c) => c.addEventListener('dblclick', () => openNew({ dueDate: c.dataset.day })));
  }

  /* --- לוח צוות (בעלים/מנהל) --- */
  function renderTeam() {
    const el = $('tasks-team');
    if (!isMgr()) { el.innerHTML = ''; return; }
    const weekAgo = addDays(todayStr(), -7);
    const list = users().filter((u) => u.uid).map((u) => {
      const ts = allTasks.filter((t) => t.assignedUid === u.uid);
      const open = ts.filter(OPEN), overdue = ts.filter(isOverdue), waiting = ts.filter((t) => t.status === 'waiting');
      const done7 = ts.filter((t) => t.status === 'done' && (t.completedAt || '').slice(0, 10) >= weekAgo);
      const durs = ts.filter((t) => t.status === 'done' && t.completedAt && t.createdAt).map((t) => daysBetween(t.createdAt, t.completedAt));
      const avg = durs.length ? (durs.reduce((a, b) => a + b, 0) / durs.length) : null;
      const urgent = open.filter((t) => t.priority === 'urgent').length;
      return { u, open: open.length, overdue: overdue.length, waiting: waiting.length, done7: done7.length, avg, urgent, total: ts.length };
    }).sort((a, b) => b.overdue - a.overdue || b.open - a.open);
    el.innerHTML = `<div class="team-grid">` + list.map((r) => {
      const load = r.overdue ? 'bad' : r.open > 8 ? 'warn' : 'ok';
      return `<div class="team-card ${load}" data-uid="${r.u.uid}">` +
        `<div class="team-head"><b>${esc(r.u.name || displayName(r.u.email))}</b><span class="t-role">${{ owner: 'בעלים', manager: 'מנהל', agent: 'נציג' }[r.u.role] || 'נציג'}</span></div>` +
        `<div class="team-nums"><div><i>${r.open}</i>פתוחות</div><div class="${r.overdue ? 'late' : ''}"><i>${r.overdue}</i>באיחור</div><div><i>${r.waiting}</i>ממתין ללקוח</div><div><i>${r.done7}</i>הושלמו השבוע</div></div>` +
        `<div class="team-foot">${r.urgent ? `<span class="t-prio urgent">${r.urgent} דחוף</span>` : ''}<span>${r.avg == null ? 'אין נתוני ביצוע' : 'זמן ביצוע ממוצע: ' + (r.avg < 1 ? 'פחות מיום' : r.avg.toFixed(1) + ' ימים')}</span></div>` +
        `<div class="team-bar"><span style="width:${r.total ? Math.round(100 * (r.total - r.open) / r.total) : 0}%"></span></div>` +
        `<div class="team-actions"><button class="btn-ghost" type="button" data-assign="${r.u.uid}">+ משימה</button>` +
        `${(r.open || r.overdue) && r.u.uid !== me().uid ? `<button class="btn-ghost" type="button" data-remind="${r.u.uid}" title="${phoneOfUid(r.u.uid) ? 'שליחת תזכורת בוואטסאפ' : 'אין טלפון — ההודעה תועתק'}">📲 תזכורת</button>` : ''}</div></div>`;
    }).join('') + `</div>`;
    el.querySelectorAll('.team-card').forEach((c) => c.addEventListener('click', () => { userF = c.dataset.uid; $('task-user-filter').value = userF; filter = 'open'; setFilterBtn('open'); switchView('list'); }));
    el.querySelectorAll('[data-assign]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); openNew({ assignedUid: b.dataset.assign }); }));
    el.querySelectorAll('[data-remind]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); sendReminder(b.dataset.remind, reminderMsgForUser(b.dataset.remind)); }));
  }

  /* --- משימות מקושרות בכרטיס ליד / תיק --- */
  function renderLinked(type) {
    const box = $(type === 'lead' ? 'lc-tasks' : 'cm-tasks'); if (!box) return;
    const obj = type === 'lead' ? ctx.currentLead() : ctx.currentCase();
    if (!obj) { box.innerHTML = ''; return; }
    const ts = allTasks.filter((t) => t.link && t.link.type === type && t.link.id === obj.id);
    const name = type === 'lead' ? (obj.name || '') : (obj.clientName || '');
    box.innerHTML = `<div class="lt-head"><h4>משימות ${ts.length ? `<span>${ts.filter(OPEN).length} פתוחות</span>` : ''}</h4>` +
      `<div><button class="btn-ghost" type="button" data-newlinked="1">+ משימה</button>${type === 'case' && isMgr() ? '<button class="btn-ghost" type="button" data-casetpl="1">משימות סטנדרטיות לתיק</button>' : ''}</div></div>` +
      (ts.length ? ts.map((t) => `<div class="lt-row${!OPEN(t) ? ' closed' : ''}" data-task="${t.id}"><span class="t-status ${(TASK_STATUS[t.status] || TASK_STATUS.open).cls}">${(TASK_STATUS[t.status] || TASK_STATUS.open).he}</span><span class="lt-title">${esc(t.title)}</span><span class="t-assignee">${esc(nameOfUid(t.assignedUid))}</span><span class="t-due${isOverdue(t) ? ' late' : ''}">${fmtDue(t)}</span></div>`).join('') : '<div class="lt-empty">אין משימות מקושרות.</div>');
    box.querySelector('[data-newlinked]').addEventListener('click', () => openNew({ link: { type, id: obj.id, name }, assignedUid: (type === 'lead' ? uidOfEmail(obj.assignedTo) : uidOfEmail(obj.createdBy)) || me().uid }));
    const tpl = box.querySelector('[data-casetpl]'); if (tpl) tpl.addEventListener('click', () => createCaseTemplate(obj));
    box.querySelectorAll('[data-task]').forEach((r) => r.addEventListener('click', () => openTask(allTasks.find((t) => t.id === r.dataset.task))));
  }
  const uidOfEmail = (email) => { const u = users().find((x) => x.email === email); return u ? u.uid : ''; };

  /* ---------- הודעות אוטומטיות בראש הטאב ---------- */
  function renderAutoNotes() {
    const el = $('tasks-auto-notes'); if (!isMgr()) { el.innerHTML = ''; return; }
    const cutoff = Date.now() - STALE_LEAD_HOURS * 36e5;
    const stale = ctx.leads().filter((l) => (l.status || 'new') === 'new' && !l.assignedTo && toDateObj(l.createdAt) && toDateObj(l.createdAt).getTime() < cutoff);
    el.innerHTML = stale.length ? `<div class="auto-note"><b>${stale.length}</b> לידים חדשים ללא מטפל מעל ${STALE_LEAD_HOURS} שעות — שייכו מטפל וייווצרו להם משימות אוטומטיות. <button class="btn-ghost" type="button" data-goleads="1">ללידים ›</button></div>` : '';
    const b = el.querySelector('[data-goleads]'); if (b) b.addEventListener('click', () => document.querySelector('.crm-tab[data-tab="leads"]').click());
  }

  /* ---------- פעמון התראות ---------- */
  function bellKey() { return 'hp_bell_' + me().uid; }
  function loadSeen() { try { bellSeen = +localStorage.getItem(bellKey()) || 0; } catch (e) { bellSeen = 0; } }
  function bellItems() {
    const myUid = me().uid, items = [];
    allTasks.forEach((t) => {
      const created = toDateObj(t.createdAt)?.getTime() || 0;
      if (t.assignedUid === myUid && t.createdByUid !== myUid && OPEN(t))
        items.push({ ts: created, cls: 'assign', text: `${nameOfUid(t.createdByUid)} הקצה לך: ${t.title}`, t });
      if (t.assignedUid === myUid && isOverdue(t))
        items.push({ ts: new Date(t.dueDate + 'T' + (t.dueTime || '23:59')).getTime(), cls: 'late', text: `באיחור: ${t.title}`, t });
      (t.comments || []).forEach((c) => { if (c.byUid !== myUid && (t.assignedUid === myUid || t.createdByUid === myUid)) items.push({ ts: toDateObj(c.at)?.getTime() || 0, cls: 'comment', text: `${displayName(c.by)} הגיב על "${t.title}": ${c.text}`, t }); });
      if (isMgr() && t.assignedUid !== myUid) {
        if (t.status === 'done' && t.completedAt) items.push({ ts: toDateObj(t.completedAt)?.getTime() || 0, cls: 'done', text: `${nameOfUid(t.completedByUid || t.assignedUid)} השלים: ${t.title}`, t });
        if (isOverdue(t)) items.push({ ts: new Date(t.dueDate + 'T' + (t.dueTime || '23:59')).getTime(), cls: 'late', text: `${nameOfUid(t.assignedUid)} באיחור: ${t.title}`, t });
      }
    });
    const weekAgo = Date.now() - 7 * 864e5;
    return items.filter((i) => i.ts >= weekAgo || i.cls === 'late').sort((a, b) => b.ts - a.ts).slice(0, 40);
  }
  function renderBell() {
    const items = bellItems(), unread = items.filter((i) => i.ts > bellSeen).length;
    const c = $('bell-count'); c.textContent = unread; c.hidden = !unread;
    document.title = (unread ? `(${unread}) ` : '') + 'Desk — הורייזון פסגות גרופ';
    const p = $('bell-panel');
    p.innerHTML = `<div class="bell-head">התראות</div>` + (items.length ? items.map((i) => `<div class="bell-item ${i.cls}${i.ts > bellSeen ? ' unread' : ''}" data-task="${i.t.id}"><span>${esc(i.text)}</span><small>${fmtDate(new Date(i.ts))}</small></div>`).join('') : '<div class="bell-empty">אין התראות חדשות.</div>');
    p.querySelectorAll('[data-task]').forEach((r) => r.addEventListener('click', () => { $('bell-panel').hidden = true; openTask(allTasks.find((t) => t.id === r.dataset.task)); }));
  }
  $('bell-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    const p = $('bell-panel'); p.hidden = !p.hidden;
    if (!p.hidden) { bellSeen = Date.now(); try { localStorage.setItem(bellKey(), String(bellSeen)); } catch (x) {} $('bell-count').hidden = true; document.title = 'Desk — הורייזון פסגות גרופ'; }
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('#bell-panel') && !e.target.closest('#bell-btn')) $('bell-panel').hidden = true; });

  /* ---------- פעולות ---------- */
  const act = (t, text) => { const a = (t.activity || []).slice(); a.push({ at: nowISO(), by: me().email, action: text }); return a; };
  async function setStatus(t, status) {
    if (!canProgress(t)) return;
    if (status === 'done') return completeTask(t);
    const upd = { status, activity: act(t, 'שינה סטטוס ל: ' + TASK_STATUS[status].he), updatedAt: nowISO(), updatedBy: me().email };
    if (t.status === 'done') { upd.completedAt = ''; upd.completedBy = ''; upd.completedByUid = ''; }
    try { await fs.updateDoc(fs.doc(db, 'tasks', t.id), upd); } catch (e) { alert('שגיאה: ' + e.message); }
  }
  async function completeTask(t) {
    if (!canProgress(t) || t.status === 'done') return;
    const upd = { updatedAt: nowISO(), updatedBy: me().email };
    if (t.repeat && t.dueDate) {
      // משימה חוזרת: לא נסגרת — נרשם ביצוע והיעד זז קדימה
      const next = t.repeat === 'daily' ? addDays(t.dueDate, 1) : t.repeat === 'weekly' ? addDays(t.dueDate, 7) : addMonths(t.dueDate, 1);
      // אם היעד עבר מזמן — קופצים קדימה עד אחרי היום
      let due = next; const today = todayStr(); let guard = 0;
      while (due <= today && guard++ < 400) due = t.repeat === 'daily' ? addDays(due, 1) : t.repeat === 'weekly' ? addDays(due, 7) : addMonths(due, 1);
      upd.status = 'open'; upd.dueDate = due;
      upd.occurrences = (t.occurrences || []).concat([{ at: nowISO(), by: me().email, forDate: t.dueDate }]);
      upd.activity = act(t, `סימן כהושלמה (${t.dueDate}) · הבאה: ${due}`);
    } else {
      upd.status = 'done'; upd.completedAt = nowISO(); upd.completedBy = me().email; upd.completedByUid = me().uid;
      upd.activity = act(t, 'סימן כהושלמה');
    }
    try { await fs.updateDoc(fs.doc(db, 'tasks', t.id), upd); } catch (e) { alert('שגיאה: ' + e.message); }
  }


  /* ---------- תזכורת לעובד בוואטסאפ (קליק אחד, ללא עלות) ---------- */
  const phoneOfUid = (uid) => { const u = userByUid(uid); return (u && u.phone) ? ctx.phoneIntl(u.phone) : ''; };
  function reminderMsgForUser(uid) {
    const name = nameOfUid(uid);
    const mine = allTasks.filter((t) => t.assignedUid === uid && OPEN(t));
    const late = mine.filter(isOverdue), today = mine.filter((t) => isToday(t) && !isOverdue(t));
    const rest = mine.filter((t) => !isOverdue(t) && !isToday(t));
    const line = (t) => '• ' + t.title + (t.dueDate ? ' (יעד: ' + fmtDue(t) + ')' : '') + (t.priority === 'urgent' ? ' — דחוף!' : '');
    let msg = 'היי ' + name + ', תזכורת מהמערכת של הורייזון פסגות 🔔\n';
    if (late.length) msg += '\nבאיחור:\n' + late.map(line).join('\n') + '\n';
    if (today.length) msg += '\nלהיום:\n' + today.map(line).join('\n') + '\n';
    if (!late.length && !today.length && rest.length) msg += '\nמשימות פתוחות:\n' + rest.slice(0, 5).map(line).join('\n') + '\n';
    msg += '\nהכל מחכה לך במערכת: ' + location.origin + '/desk/';
    return msg;
  }
  function reminderMsgForTask(t) {
    return 'היי ' + nameOfUid(t.assignedUid) + ', תזכורת למשימה 🔔\n\n' +
      '• ' + t.title + (t.dueDate ? '\n• יעד: ' + fmtDue(t) : '') +
      (t.priority === 'urgent' ? '\n• דחוף!' : t.priority === 'high' ? '\n• עדיפות גבוהה' : '') +
      (t.link ? '\n• לקוח: ' + t.link.name : '') +
      (t.desc ? '\n\n' + t.desc : '') +
      '\n\nהמשימה במערכת: ' + location.origin + '/desk/';
  }
  async function sendReminder(uid, msg, task) {
    const phone = phoneOfUid(uid);
    if (phone) {
      window.open('https://wa.me/' + phone + '?text=' + encodeURIComponent(msg), '_blank', 'noopener');
    } else {
      try { await navigator.clipboard.writeText(msg); alert('ל"' + nameOfUid(uid) + '" אין טלפון במערכת — ההודעה הועתקה, הדביקו בוואטסאפ.\n(אפשר להוסיף טלפון בטאב "משתמשים")'); }
      catch (e) { window.prompt('העתיקו את התזכורת:', msg); return; }
    }
    if (task) {   // רישום ביומן הפעילות של המשימה
      try { await fs.updateDoc(fs.doc(db, 'tasks', task.id), { activity: act(task, 'שלח תזכורת בוואטסאפ ל' + nameOfUid(uid)) }); } catch (e) {}
    }
  }

  /* ---------- כרטיס משימה ---------- */
  function assigneeOptions(selected) {
    let list = users().filter((u) => u.uid);
    if (role() === 'agent') list = list.filter((u) => u.uid === me().uid);
    if (!list.some((u) => u.uid === selected)) selected = me().uid;
    return list.map((u) => `<option value="${u.uid}"${u.uid === selected ? ' selected' : ''}>${esc(u.name || displayName(u.email))}${u.role === 'owner' ? ' (בעלים)' : u.role === 'manager' ? ' (מנהל)' : ''}</option>`).join('');
  }
  function fillLinkList() {
    const dl = $('tm-link-list');
    dl.innerHTML = ctx.leads().slice(0, 300).map((l) => `<option value="👤 ${esc(l.name || '')} · ${esc(l.phone || '')}" data-type="lead" data-id="${l.id}"></option>`).join('') +
      ctx.cases().map((c) => `<option value="📁 ${esc(c.clientName || '')} · ${esc(ctx.serviceLabel(c.serviceType))}" data-type="case" data-id="${c.id}"></option>`).join('');
  }
  function setLink(l) {
    link = l || null;
    $('tm-link-search').value = link ? link.name : '';
    $('tm-link-clear').hidden = !link;
    $('tm-link-hint').textContent = link ? (link.type === 'case' ? 'מקושר לתיק לקוח' : 'מקושר לליד') : 'הקלידו שם לקוח ובחרו מהרשימה (לא חובה)';
  }
  $('tm-link-search').addEventListener('input', () => {
    const v = $('tm-link-search').value;
    const opt = [...$('tm-link-list').options].find((o) => o.value === v);
    if (opt) setLink({ type: opt.dataset.type, id: opt.dataset.id, name: v.replace(/^[👤📁]\s*/, '').split(' · ')[0] });
    else if (link) { link = null; $('tm-link-clear').hidden = true; $('tm-link-hint').textContent = 'בחרו מהרשימה כדי לקשר'; }
  });
  $('tm-link-clear').addEventListener('click', () => setLink(null));
  $('tm-assignee').addEventListener('change', updatePrivateVisibility);
  function updatePrivateVisibility() {
    // תיבת "גלוי לצוות" — רק כשבעלים יוצר/עורך משימה שהאחראי בה הוא בעלים
    const show = isOwner() && roleOfUid($('tm-assignee').value) === 'owner' && (!current || roleOfUid(current.createdByUid) === 'owner');
    $('tm-private-wrap').hidden = !show;
  }

  function openNew(prefill) {
    prefill = prefill || {};
    current = null;
    $('tm-title-h').textContent = 'משימה חדשה'; $('tm-sub').textContent = '';
    $('tm-title').value = prefill.title || ''; $('tm-desc').value = prefill.desc || '';
    $('tm-assignee').innerHTML = assigneeOptions(prefill.assignedUid || me().uid);
    $('tm-status').innerHTML = STATUS_KEYS.filter((k) => k !== 'done' && k !== 'cancelled').map((k) => `<option value="${k}">${TASK_STATUS[k].he}</option>`).join('');
    $('tm-status').className = 'status-select open';
    $('tm-due').value = prefill.dueDate || ''; $('tm-due-time').value = '';
    $('tm-prio').value = prefill.priority || 'normal'; $('tm-repeat').value = '';
    fillLinkList(); setLink(prefill.link || null);
    $('tm-private').checked = false; updatePrivateVisibility();
    ['tm-title', 'tm-desc', 'tm-assignee', 'tm-due', 'tm-due-time', 'tm-prio', 'tm-repeat', 'tm-link-search', 'tm-status'].forEach((id) => { $(id).disabled = false; });
    $('tm-comments-wrap').hidden = true; $('tm-activity-wrap').hidden = true;
    $('tm-done').hidden = true; $('tm-delete').hidden = true; $('tm-remind').hidden = true; $('tm-save').hidden = false; $('tm-save').textContent = 'יצירת משימה';
    $('task-modal').hidden = false; setTimeout(() => $('tm-title').focus(), 50);
  }
  function openTask(t) {
    if (!t) return; current = t;
    const full = canEditFull(t), prog = canProgress(t);
    $('tm-title-h').textContent = t.title;
    $('tm-sub').innerHTML = `נוצרה ${fmtDate(t.createdAt)} ע״י <b>${esc(nameOfUid(t.createdByUid))}</b>` + (t.repeat ? ` · ${REPEAT[t.repeat]}` : '') + (t.auto ? ' · נוצרה אוטומטית' : '') +
      (t.status === 'done' && t.completedAt ? ` · הושלמה ${fmtDate(t.completedAt)} ע״י ${esc(displayName(t.completedBy))}` : '') +
      ((t.occurrences || []).length ? ` · בוצעה ${t.occurrences.length} פעמים` : '');
    $('tm-title').value = t.title || ''; $('tm-desc').value = t.desc || '';
    $('tm-assignee').innerHTML = full ? assigneeOptions(t.assignedUid) : `<option value="${t.assignedUid}">${esc(nameOfUid(t.assignedUid))}</option>`;
    $('tm-status').innerHTML = STATUS_KEYS.map((k) => `<option value="${k}"${t.status === k ? ' selected' : ''}>${TASK_STATUS[k].he}</option>`).join('');
    $('tm-status').className = 'status-select ' + (TASK_STATUS[t.status] || TASK_STATUS.open).cls;
    $('tm-due').value = t.dueDate || ''; $('tm-due-time').value = t.dueTime || '';
    $('tm-prio').value = t.priority || 'normal'; $('tm-repeat').value = t.repeat || '';
    fillLinkList(); setLink(t.link || null);
    $('tm-private').checked = !t.private; updatePrivateVisibility();
    ['tm-title', 'tm-desc', 'tm-assignee', 'tm-due', 'tm-due-time', 'tm-prio', 'tm-repeat', 'tm-link-search'].forEach((id) => { $(id).disabled = !full; });
    $('tm-status').disabled = !prog;
    $('tm-comments-wrap').hidden = false; $('tm-activity-wrap').hidden = false;
    $('tm-comment-input').disabled = !prog; $('tm-comment-add').disabled = !prog;
    renderComments(t); renderActivity(t);
    $('tm-done').hidden = !(prog && OPEN(t)); $('tm-delete').hidden = !canDelete(t);
    $('tm-remind').hidden = !(isMgr() && OPEN(t) && t.assignedUid !== me().uid);
    $('tm-save').textContent = 'שמירה'; $('tm-save').hidden = !(full || prog);
    $('task-modal').hidden = false;
  }
  function renderComments(t) {
    const ul = $('tm-comments'), cs = t.comments || [];
    ul.innerHTML = cs.length ? cs.map((c) => `<li><b>${esc(displayName(c.by))}</b> <span class="act-when">${fmtDate(c.at)}</span><div>${esc(c.text)}</div></li>`).join('') : '<li class="lc-empty">אין תגובות עדיין.</li>';
  }
  function renderActivity(t) {
    const ul = $('tm-activity'), a = t.activity || [];
    ul.innerHTML = a.length ? a.slice().reverse().map((x) => `<li><span class="act-when">${fmtDate(x.at)}</span> <b>${esc(displayName(x.by))}</b> — ${esc(x.action)}</li>`).join('') : '<li class="lc-empty">אין פעילות.</li>';
  }
  const closeModal = () => { $('task-modal').hidden = true; current = null; };
  $('tm-close').addEventListener('click', closeModal); $('tm-cancel').addEventListener('click', closeModal);
  $('task-modal').addEventListener('click', (e) => { if (e.target === $('task-modal')) closeModal(); });
  $('tm-status').addEventListener('change', () => { $('tm-status').className = 'status-select ' + (TASK_STATUS[$('tm-status').value] || TASK_STATUS.open).cls; });

  $('tm-comment-add').addEventListener('click', addComment);
  $('tm-comment-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addComment(); } });
  async function addComment() {
    const text = $('tm-comment-input').value.trim(); if (!current || !text) return;
    const comments = (current.comments || []).concat([{ at: nowISO(), by: me().email, byUid: me().uid, text }]);
    try { await fs.updateDoc(fs.doc(db, 'tasks', current.id), { comments, activity: act(current, 'הוסיף תגובה'), updatedAt: nowISO(), updatedBy: me().email }); $('tm-comment-input').value = ''; }
    catch (e) { alert('שגיאה: ' + e.message); }
  }
  $('tm-done').addEventListener('click', async () => { if (current) { await completeTask(current); closeModal(); } });
  $('tm-remind').addEventListener('click', () => { if (current) sendReminder(current.assignedUid, reminderMsgForTask(current), current); });
  $('tm-delete').addEventListener('click', async () => {
    if (!current || !confirm('למחוק את המשימה לצמיתות? (אפשר במקום זה לסמן "בוטלה" ולשמור היסטוריה)')) return;
    try { await fs.deleteDoc(fs.doc(db, 'tasks', current.id)); closeModal(); } catch (e) { alert('שגיאה: ' + e.message); }
  });

  $('tm-save').addEventListener('click', async () => {
    const title = $('tm-title').value.trim(); if (!title) { alert('כותרת היא שדה חובה.'); $('tm-title').focus(); return; }
    const assignedUid = $('tm-assignee').value;
    const privateFlag = !$('tm-private-wrap').hidden && !$('tm-private').checked;   // "גלוי לצוות" לא מסומן → פרטי
    const fields = { title, desc: $('tm-desc').value.trim(), assignedUid, assignedTo: (userByUid(assignedUid) || {}).email || '', dueDate: $('tm-due').value, dueTime: $('tm-due-time').value,
      priority: $('tm-prio').value, repeat: $('tm-repeat').value, link: link || null, private: privateFlag };
    $('tm-save').disabled = true;
    try {
      if (!current) {
        await fs.addDoc(fs.collection(db, 'tasks'), { ...fields, status: $('tm-status').value, createdByUid: me().uid, createdBy: me().email, createdAt: nowISO(), comments: [], activity: [{ at: nowISO(), by: me().email, action: 'יצר את המשימה' + (assignedUid !== me().uid ? ' עבור ' + nameOfUid(assignedUid) : '') }] });
      } else {
        const t = current, upd = { updatedAt: nowISO(), updatedBy: me().email };
        let a = t.activity || [];
        const push = (s) => { a = a.concat([{ at: nowISO(), by: me().email, action: s }]); };
        const newStatus = $('tm-status').value;
        if (canEditFull(t)) {
          Object.assign(upd, fields);
          if (fields.assignedUid !== t.assignedUid) push('העביר ל: ' + nameOfUid(fields.assignedUid));
          if (fields.dueDate !== (t.dueDate || '')) push(fields.dueDate ? 'קבע יעד: ' + fields.dueDate : 'הסיר תאריך יעד');
          if (fields.priority !== (t.priority || 'normal')) push('עדיפות: ' + PRIO[fields.priority].he);
          if (fields.title !== t.title || fields.desc !== (t.desc || '')) push('ערך את הפרטים');
          if (!isOwner()) upd.private = false;
        }
        if (newStatus !== t.status) {
          if (newStatus === 'done') { $('tm-save').disabled = false; await completeTask(t); closeModal(); return; }
          upd.status = newStatus; push('שינה סטטוס ל: ' + TASK_STATUS[newStatus].he);
          if (t.status === 'done') { upd.completedAt = ''; upd.completedBy = ''; upd.completedByUid = ''; }
        }
        upd.activity = a;
        await fs.updateDoc(fs.doc(db, 'tasks', t.id), upd);
      }
      closeModal();
    } catch (e) { alert('שגיאה בשמירה: ' + e.message); }
    $('tm-save').disabled = false;
  });

  /* ---------- תבנית משימות לתיק ---------- */
  async function createCaseTemplate(c) {
    const uid = uidOfEmail(c.createdBy) || me().uid, today = todayStr();
    const tpl = [['שליחת רשימת המסמכים ללקוח', 0, 'high'], ['מעקב: האם הלקוח התחיל להעלות מסמכים?', 2, 'normal'], ['בדיקה ואישור המסמכים שהועלו', 5, 'normal'], ['פתיחת שלב 2 ללקוח', 7, 'normal']];
    const existing = allTasks.filter((t) => t.link && t.link.type === 'case' && t.link.id === c.id).map((t) => t.title);
    const todo = tpl.filter(([title]) => !existing.includes(title));
    if (!todo.length) { alert('המשימות הסטנדרטיות כבר קיימות בתיק הזה.'); return; }
    if (!confirm(`ליצור ${todo.length} משימות לתיק של ${c.clientName} עבור ${nameOfUid(uid)}?`)) return;
    try {
      await Promise.all(todo.map(([title, days, priority]) => fs.addDoc(fs.collection(db, 'tasks'), {
        title, desc: '', assignedUid: uid, assignedTo: (userByUid(uid) || {}).email || '', dueDate: addDays(today, days), dueTime: '', priority, repeat: '',
        link: { type: 'case', id: c.id, name: c.clientName || '' }, private: false, status: 'open', createdByUid: me().uid, createdBy: me().email, createdAt: nowISO(), comments: [],
        activity: [{ at: nowISO(), by: me().email, action: 'נוצרה מתבנית תיק' }],
      })));
    } catch (e) { alert('שגיאה: ' + e.message); }
  }

  /* ---------- אוטומציות (בעלים/מנהל, אידמפוטנטי) ----------
     · ליד "חדש" עם מטפל שלא טופל 24 שעות → משימה "לחזור לליד" למטפל
     · מסמך בתיק שנדחה → משימה "לעדכן את הלקוח" לפותח התיק
     · מסמכים שהועלו וממתינים לבדיקה → משימה "לבדוק מסמכים" לפותח התיק
     מזהה מסמך דטרמיניסטי (auto_<type>_<ref>) מונע כפילויות. */
  let autoRan = false;
  async function runAutomations() {
    if (!isMgr() || autoRan || !allTasks) return;
    autoRan = true; setTimeout(() => { autoRan = false; }, 60000);   // לכל היותר פעם בדקה
    const jobs = [];
    const mk = (id, data) => { if (allTasks.some((t) => t.id === id)) return; jobs.push(fs.setDoc(fs.doc(db, 'tasks', id), data)); allTasks.push({ ...data, id }); };
    const base = (uid, title, desc, link, priority, auto) => ({ title, desc, assignedUid: uid, assignedTo: (userByUid(uid) || {}).email || '', dueDate: todayStr(), dueTime: '', priority, repeat: '', link, private: false, status: 'open',
      createdByUid: me().uid, createdBy: me().email, createdAt: nowISO(), comments: [], auto, activity: [{ at: nowISO(), by: me().email, action: 'נוצרה אוטומטית' }] });
    const cutoff = Date.now() - STALE_LEAD_HOURS * 36e5;
    ctx.leads().forEach((l) => {
      if ((l.status || 'new') !== 'new' || !l.assignedTo) return;
      const d = toDateObj(l.createdAt); if (!d || d.getTime() > cutoff) return;
      const uid = uidOfEmail(l.assignedTo); if (!uid) return;
      mk('auto_lead_' + l.id, base(uid, 'לחזור לליד: ' + (l.name || ''), `ליד חדש שלא טופל מעל ${STALE_LEAD_HOURS} שעות. טלפון: ${l.phone || ''}`, { type: 'lead', id: l.id, name: l.name || '' }, 'high', 'lead_stale'));
    });
    ctx.cases().forEach((c) => {
      if (c.status === 'closed') return;
      const uid = uidOfEmail(c.createdBy); if (!uid) return;
      const items = c.items || [];
      const rejected = items.filter((i) => i.status === 'rejected');
      rejected.forEach((i) => mk('auto_rej_' + c.id + '_' + String(i.key).replace(/[^\w-]/g, ''), base(uid, 'לעדכן את הלקוח: מסמך נדחה — ' + (i.label || ''), `בתיק של ${c.clientName || ''} נדחה המסמך "${i.label || ''}"${i.rejectReason ? ' (' + i.rejectReason + ')' : ''}. יש לוודא שהלקוח יודע ומעלה מחדש.`, { type: 'case', id: c.id, name: c.clientName || '' }, 'normal', 'case_rejected')));
      if (c.clientDoneAt) {
        const stg = c.clientDoneStage === 2 ? '2' : '1';
        mk('auto_done_' + c.id + '_s' + stg, base(uid, 'לבדוק תיק — הלקוח סיים להעלות: ' + (c.clientName || ''), 'הלקוח סימן בפורטל שסיים להעלות את כל המסמכים' + (stg === '2' ? ' (שלב 2)' : '') + '. יש לעבור על התיק ולאשר/לדחות.', { type: 'case', id: c.id, name: c.clientName || '' }, 'high', 'case_done'));
      }
      const toReview = items.filter((i) => i.status === 'pending' && (i.files || []).length);
      const reviewOpen = allTasks.some((t) => t.auto === 'case_review' && OPEN(t) && t.link && t.link.id === c.id);
      if (toReview.length && !reviewOpen) {
        const latest = toReview.flatMap((i) => i.files.map((f) => f.at || '')).sort().pop() || '';
        mk('auto_rev_' + c.id + '_' + String(latest).replace(/[^\w-]/g, '').slice(0, 20), base(uid, 'לבדוק מסמכים שהועלו: ' + (c.clientName || ''), `${toReview.length} מסמכים ממתינים לאישור/דחייה בתיק.`, { type: 'case', id: c.id, name: c.clientName || '' }, 'normal', 'case_review'));
      }
    });
    if (jobs.length) { try { await Promise.all(jobs); } catch (e) { console.warn('automation', e); } }
  }


  /* ---------- תזכורות בתוך המערכת (Notification API, ללא backend) ----------
     · סיכום בוקר בכניסה הראשונה של היום (באנר + התראת דפדפן)
     · התראה 15 דק׳ לפני שעת יעד ובשעת היעד, למשימות שלי להיום
     · התראה כשמישהו מקצה לי משימה חדשה
     עובד כל עוד ה-CRM פתוח (גם בטאב ברקע). */
  const notifOK = () => ('Notification' in window) && Notification.permission === 'granted';
  let timers = [], knownIds = null, digestShown = false;
  function notify(title, body, taskId) {
    if (!notifOK()) return;
    try {
      const n = new Notification(title, { body, icon: '/assets/logo/logo-mark.png', tag: 'hp-' + (taskId || title), renotify: false, dir: 'rtl', lang: 'he' });
      n.onclick = () => { window.focus(); n.close(); if (taskId) { const t = allTasks.find((x) => x.id === taskId); if (t) { document.querySelector('.crm-tab[data-tab="tasks"]').click(); openTask(t); } } };
    } catch (e) { /* דפדפנים ניידים לא תומכים ב-new Notification */ }
  }
  function renderNotifButton() {
    const b = $('notif-btn'); if (!b) return;
    const supported = 'Notification' in window;
    b.hidden = !supported || Notification.permission === 'granted';
    b.disabled = supported && Notification.permission === 'denied';
    if (b.disabled) b.title = 'ההתראות חסומות בדפדפן — יש לאפשר בהגדרות האתר';
  }
  $('notif-btn') && $('notif-btn').addEventListener('click', async () => {
    try { const p = await Notification.requestPermission(); renderNotifButton(); if (p === 'granted') { notify('התזכורות הופעלו', 'תקבלו התראה לפני שעת היעד של משימות ובהקצאה חדשה.'); scheduleReminders(); } } catch (e) {}
  });
  function scheduleReminders() {
    timers.forEach(clearTimeout); timers = [];
    if (!notifOK()) return;
    const today = todayStr(), now = Date.now();
    allTasks.filter((t) => isMine(t) && OPEN(t) && t.status !== 'waiting' && t.dueDate === today && t.dueTime).forEach((t) => {
      const due = new Date(`${today}T${t.dueTime}:00`).getTime();
      [[due - 15 * 60000, 'בעוד 15 דקות'], [due, 'עכשיו']].forEach(([at, label]) => {
        const ms = at - now; if (ms < 0 || ms > 12 * 36e5) return;
        timers.push(setTimeout(() => notify(`${label}: ${t.title}`, (t.link ? t.link.name + ' · ' : '') + 'יעד ' + t.dueTime, t.id), ms));
      });
    });
  }
  function checkNewAssignments() {
    const ids = new Set(allTasks.map((t) => t.id));
    if (knownIds) allTasks.forEach((t) => { if (!knownIds.has(t.id) && isMine(t) && t.createdByUid !== me().uid && OPEN(t)) notify('משימה חדשה מ' + nameOfUid(t.createdByUid), t.title + (t.dueDate ? ' · ' + fmtDue(t) : ''), t.id); });
    knownIds = ids;
  }
  function dailyDigest() {
    if (digestShown) return;
    const mine = allTasks.filter(isMine), today = mine.filter(isToday), late = mine.filter(isOverdue);
    const el = $('tasks-digest'); if (!el) return;
    if (!today.length && !late.length) { el.innerHTML = ''; return; }
    const parts = []; if (late.length) parts.push(`<b class="late">${late.length} באיחור</b>`); if (today.length) parts.push(`<b>${today.length} להיום</b>`);
    el.innerHTML = `<div class="auto-note digest">☀️ בוקר טוב, ${esc(nameOfUid(me().uid))} — יש לך ${parts.join(' ו-')}. <button class="btn-ghost" type="button" data-showtoday="1">הצג ›</button><button class="icon-btn" type="button" data-dismiss="1" title="סגירה">✕</button></div>`;
    el.querySelector('[data-showtoday]').addEventListener('click', () => { filter = 'today'; setFilterBtn('today'); switchView('list'); });
    el.querySelector('[data-dismiss]').addEventListener('click', () => { el.innerHTML = ''; digestShown = true; });
    const key = 'hp_digest_' + me().uid; let last = '';
    try { last = localStorage.getItem(key) || ''; } catch (e) {}
    if (last !== todayStr()) {
      try { localStorage.setItem(key, todayStr()); } catch (e) {}
      notify('סיכום היום', `${today.length} משימות להיום${late.length ? ', ' + late.length + ' באיחור' : ''}`);
    }
    digestShown = true;
  }
  function runReminders() { renderNotifButton(); scheduleReminders(); checkNewAssignments(); dailyDigest(); }

  /* ---------- שליטה בטאב ---------- */
  function switchView(v) {
    view = v;
    $('tasks-view').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
    ['list', 'board', 'calendar', 'team'].forEach((k) => { $('tasks-' + k).hidden = (k !== v); });
    document.querySelector('#task-filters').hidden = (v === 'team');
    renderAll();
  }
  function setFilterBtn(f) { $('task-filters').querySelectorAll('.filter-btn').forEach((b) => b.classList.toggle('active', b.dataset.filter === f)); }
  $('tasks-view').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) switchView(b.dataset.view); });
  $('task-filters').addEventListener('click', (e) => { const b = e.target.closest('.filter-btn'); if (!b) return; filter = b.dataset.filter; setFilterBtn(filter); renderAll(); });
  $('task-search').addEventListener('input', (e) => { q = e.target.value.trim().toLowerCase(); renderAll(); });
  $('task-user-filter').addEventListener('change', (e) => { userF = e.target.value; renderAll(); });
  $('task-prio-filter').addEventListener('change', (e) => { prioF = e.target.value; renderAll(); });
  $('add-task').addEventListener('click', () => openNew());

  function onUsersChanged() {
    const fu = $('task-user-filter'), cur = fu.value;
    fu.innerHTML = '<option value="">כל העובדים</option>' + users().filter((u) => u.uid).map((u) => `<option value="${u.uid}">${esc(u.name || displayName(u.email))}</option>`).join('');
    fu.value = cur;
    $('tasks-team-btn').hidden = !isMgr();
    if (view === 'team' && !isMgr()) switchView('list');
    if (filter === 'mine' && isMgr() && !allTasks.length) { /* בעלים/מנהל מתחיל ב"שלי" גם כן — עקבי */ }
    loadSeen();
    listen();
    renderAll();
  }

  return { onUsersChanged, refresh: renderAll, openNew, detach: () => { if (unsub) { try { unsub(); } catch (e) {} } unsub = null; listenAs = null; allTasks = []; timers.forEach(clearTimeout); timers = []; knownIds = null; digestShown = false; } };
}
