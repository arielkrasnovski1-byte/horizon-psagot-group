/* ============================================================
   הורייזון פסגות גרופ — crm-properties.js  (module)
   לשונית "נכסים": נכסים למכירה שסורק הנדל"ן (אצל השמאי) מוצא, עם הערכת שווי.
   · הנתונים מגיעים מהסריקה דרך Cloud Function (nadlanIngest) אל Firestore properties/{id}
   · כאן רק מציגים ומנהלים מעקב: סטטוס, הערות, מועדף, פתיחת משימה
   · מצב הסריקה האחרונה: settings/nadlanScan
   ההרשאה נאכפת בחוקי Firestore (בעלים בלבד; עדכון רק של שדות המעקב), לא רק כאן.
   נטען מתוך crm.js עם ctx (Firebase + עזרים + מצב המשתמש).
   ============================================================ */

export const PROPERTY_STATUS = { new: 'חדש', check: 'לבדיקה', contacted: 'יצרתי קשר', negotiation: 'במשא ומתן', closed: 'נסגר', irrelevant: 'לא רלוונטי' };
const STATUS_CLS = { new: 'new', check: 'contacted', contacted: 'contacted', negotiation: 'contacted', closed: 'closed', irrelevant: 'closed' };
const GONE_AFTER_DAYS = 3;     // נכס שלא הופיע בסריקות 3 ימים נחשב "ירד מהאתר"
const STALE_SCAN_HOURS = 36;   // סריקה יומית שלא הגיעה 36 שעות — מתריעים
const NEW_DAYS = 7;
const CONF_HE = { 'גבוהה': 'גבוה', 'בינונית': 'בינוני', 'נמוכה': 'נמוך' };   // "ביטחון בינוני"

export function initProperties(ctx) {
  const { fs, db, $, esc, nowISO } = ctx;

  let all = [], scan = null, loaded = false, loadError = '';
  let unsub = null, unsubScan = null, ownerMode = false;
  let quick = '', statusF = '', sortF = 'smart', q = '', showGone = false;
  let pendingRender = false;
  const noteTimers = new Map();

  const p2 = (n) => ('0' + n).slice(-2);
  const money = (n) => '₪' + Number(n || 0).toLocaleString('he-IL');
  const ms = (iso) => { const t = Date.parse(iso || ''); return isNaN(t) ? 0 : t; };
  const fmtWhen = (iso) => { const t = ms(iso); if (!t) return '—'; const d = new Date(t); return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`; };
  const firstSeenMs = (p) => ms(String(p.firstSeen || '').replace(' ', 'T')) || ms(p.createdAt);
  const adUrl = (u) => /^https:\/\/([a-z0-9-]+\.)*(yad2|madlan)\.co\.il\//i.test(String(u || '')) ? String(u) : '';
  const lastScanMs = () => ms(scan && scan.lastReceivedAt);

  // "באוויר" = הופיע בסריקות האחרונות. נמדד מול הסריקה האחרונה ולא מול השעון, כדי שסריקה שלא רצה לא תסמן הכל כ"ירד"
  const isGone = (p) => { const ref = lastScanMs(); return !!ref && ref - ms(p.lastSeenAt) > GONE_AFTER_DAYS * 86400000; };
  const isNew = (p) => { const t = firstSeenMs(p); return !!t && Date.now() - t < NEW_DAYS * 86400000; };
  const isDeal = (p) => p.below === true && !p.priceSuspect;
  const isReview = (p) => p.review === true && !isDeal(p);
  const dropped = (p) => (p.prevPrice && p.price && p.prevPrice > p.price) ? p.prevPrice : ((p.priceBefore && p.price && p.priceBefore > p.price) ? p.priceBefore : 0);

  /* ============================================================
     הרשאה: הלשונית והמנוי קיימים רק לבעלים
     ============================================================ */
  function setOwner(isOwner) {
    ownerMode = !!isOwner;
    const tab = $('tab-properties'); if (tab) tab.hidden = !ownerMode;
    if (ownerMode && !unsub) listen();
    if (!ownerMode && unsub) detach();
  }
  function listen() {
    unsub = fs.onSnapshot(fs.collection(db, 'properties'), (snap) => {
      all = snap.docs.map((d) => ({ ...d.data(), id: d.id })); loaded = true; loadError = ''; render();
    }, (err) => { console.warn('properties listener', err); loaded = true; loadError = (err && err.code) || 'error'; render(); });
    unsubScan = fs.onSnapshot(fs.doc(db, 'settings', 'nadlanScan'), (d) => { scan = d.exists() ? d.data() : null; render(); }, (err) => console.warn('nadlanScan listener', err));
  }
  function detach() {
    [unsub, unsubScan].forEach((u) => { if (u) { try { u(); } catch (e) {} } });
    unsub = unsubScan = null; all = []; scan = null; loaded = false;
    noteTimers.forEach(clearTimeout); noteTimers.clear();
  }

  /* ============================================================
     סינון ומיון
     ============================================================ */
  function visible() {
    const text = q.trim().toLowerCase();
    return all.filter((p) => {
      if (!showGone && isGone(p)) return false;
      if (statusF === 'none' ? !!p.status : (statusF && p.status !== statusF)) return false;
      if (!statusF && p.status === 'irrelevant' && quick !== 'fav') return false;   // "לא רלוונטי" מוסתר עד שמסננים אליו
      if (quick === 'deal' && !isDeal(p)) return false;
      if (quick === 'review' && !isReview(p)) return false;
      if (quick === 'new' && !isNew(p)) return false;
      if (quick === 'fav' && !p.favorite) return false;
      if (text && ![p.address, p.city, p.neighborhood, p.street, p.type, p.tags, p.notes].join(' ').toLowerCase().includes(text)) return false;
      return true;
    });
  }
  const rank = (p) => isDeal(p) ? 0 : isReview(p) ? 1 : 2;
  const SORTS = {
    smart: (a, b) => rank(a) - rank(b) || (rank(a) < 2 ? (b.rawDiscount || 0) - (a.rawDiscount || 0) : 0) || firstSeenMs(b) - firstSeenMs(a) || (a.price || 0) - (b.price || 0),
    newest: (a, b) => firstSeenMs(b) - firstSeenMs(a),
    price_asc: (a, b) => (a.price || 1e12) - (b.price || 1e12),
    price_desc: (a, b) => (b.price || 0) - (a.price || 0),
    size_desc: (a, b) => (b.size || 0) - (a.size || 0),
  };

  /* ============================================================
     תצוגה
     ============================================================ */
  function scanLine() {
    const el = $('prop-scan'); if (!el) return;
    if (!scan) { el.className = 'prop-scan'; el.textContent = loaded ? 'עדיין לא התקבלה סריקה.' : ''; return; }
    const s = scan.search || {};
    const parts = [];
    if ((s.cities || []).length) parts.push(s.cities.join(', ') + ((s.neighborhoods || []).length ? ' (' + s.neighborhoods.join(', ') + ')' : ''));
    if ((s.propertyTypes || []).length) parts.push(s.propertyTypes.join(', '));
    if (s.minRooms || s.maxRooms) parts.push(s.maxRooms ? `${s.minRooms || 0}–${s.maxRooms} חדרים` : `${s.minRooms}+ חדרים`);
    if (s.minPrice || s.maxPrice) parts.push(`${s.minPrice ? money(s.minPrice) : '0'} – ${s.maxPrice ? money(s.maxPrice) : 'ללא תקרה'}`);
    if (s.requireMamad) parts.push('עם ממ״ד');
    const hours = (Date.now() - lastScanMs()) / 3600000;
    const stale = hours > STALE_SCAN_HOURS;
    el.className = 'prop-scan' + (stale ? ' stale' : '');
    el.innerHTML = (stale ? `<b>⚠ לא התקבלה סריקה כבר ${Math.floor(hours / 24)} ימים.</b> כדאי לבדוק שהמחשב של הסורק דולק. ` : '') +
      `סריקה אחרונה: <b>${esc(fmtWhen(scan.lastReceivedAt))}</b> · ${esc(String(scan.count || 0))} נכסים` +
      (parts.length ? ` · החיפוש: ${esc(parts.join(' · '))}` : '') +
      (scan.thresholdPct ? ` · סף "מתחת לשוק": ${esc(String(scan.thresholdPct))}%` : '');
  }

  function card(p) {
    const deal = isDeal(p), review = isReview(p), gone = isGone(p);
    const url = adUrl(p.url), img = adUrl(p.image);
    const chips = [];
    if (p.rooms) chips.push(`${esc(String(p.rooms))} חד׳`);
    if (p.size) chips.push(`${esc(String(p.size))} מ״ר`);
    if (p.type) chips.push(esc(p.type));
    if (p.floor) chips.push(`קומה ${esc(String(p.floor))}`);
    if (p.condition) chips.push(esc(p.condition));
    const badges = [];
    if (deal && p.discount != null) badges.push(`<span class="prop-badge deal">${esc(String(p.discount))}% מתחת לשוק</span>`);
    else if (p.priceSuspect) badges.push('<span class="prop-badge warn">מחיר לא אמיתי</span>');
    else if (review) badges.push('<span class="prop-badge warn">לבדוק נתונים</span>');
    if (isNew(p)) badges.push('<span class="prop-badge new">חדש</span>');
    if (gone) badges.push('<span class="prop-badge gone">ירד מהאתר</span>');
    const was = dropped(p);
    let val = '';
    if (p.estValue) {
      val = `<div class="prop-val"><span>הערכת שווי <b>${money(p.estValue)}</b>` +
        (p.rawDiscount != null && !p.priceSuspect ? ` · ${p.rawDiscount >= 0 ? esc(String(p.rawDiscount)) + '% מתחת להערכה' : esc(String(-p.rawDiscount)) + '% מעל ההערכה'}` : '') + '</span>' +
        (p.confidence ? `<span class="prop-conf c-${p.confidence === 'גבוהה' ? 'hi' : p.confidence === 'בינונית' ? 'mid' : 'low'}">ביטחון ${esc(CONF_HE[p.confidence] || p.confidence)}</span>` : '') +
        `<small>${esc(p.estBasis || '')}${p.compCount ? ` · ${esc(String(p.compCount))} עסקאות` : ''}</small></div>`;
    } else if (p.closedMedian) {
      val = `<div class="prop-val"><span>חציון עסקאות שנסגרו <b>${money(p.closedMedian)}</b></span><small>${esc(p.closedBasis || '')}</small></div>`;
    } else {
      val = '<div class="prop-val none"><span>אין הערכת שווי אמינה</span></div>';
    }
    const st = p.status || '';
    return `<article class="prop-card${deal ? ' deal' : review ? ' review' : ''}${gone ? ' gone' : ''}" data-id="${esc(p.id)}">
      <div class="prop-img${img ? '' : ' noimg'}">${img ? `<img loading="lazy" referrerpolicy="no-referrer" alt="" src="${esc(img)}">` : ''}
        <div class="prop-badges">${badges.join('')}</div>
        <button type="button" class="prop-star${p.favorite ? ' on' : ''}" data-act="fav" aria-pressed="${p.favorite ? 'true' : 'false'}" title="מועדף" aria-label="מועדף">★</button>
      </div>
      <div class="prop-body">
        <div class="prop-price">${p.price ? money(p.price) : 'מחיר לא צוין'}${was ? ` <small class="prop-drop">ירד מ-${money(was)}</small>` : ''}</div>
        <div class="prop-addr">${esc(p.address || 'ללא כתובת')}</div>
        <div class="prop-chips">${chips.join(' · ')}</div>
        ${val}
        ${p.qualityNote ? `<div class="prop-note">⚠ ${esc(p.qualityNote)}</div>` : ''}
        ${p.tags ? `<div class="prop-tags">${esc(p.tags)}</div>` : ''}
      </div>
      <div class="prop-foot">
        <select class="status-select ${STATUS_CLS[st] || ''}" data-act="status" aria-label="סטטוס">
          <option value="">— סטטוס —</option>${Object.keys(PROPERTY_STATUS).map((k) => `<option value="${k}"${k === st ? ' selected' : ''}>${PROPERTY_STATUS[k]}</option>`).join('')}
        </select>
        ${url ? `<a class="link-btn" href="${esc(url)}" target="_blank" rel="noopener noreferrer">למודעה ↗</a>` : ''}
        <button type="button" class="btn-ghost prop-task" data-act="task">+ משימה</button>
        <textarea class="prop-notes" data-act="notes" rows="1" maxlength="3500" placeholder="הערות…" aria-label="הערות">${esc(p.notes || '')}</textarea>
      </div>
    </article>`;
  }

  function render() {
    if (!$('panel-properties')) return;
    // לא מציירים מחדש בזמן הקלדת הערה — אחרת הסמן קופץ. מציירים כשיוצאים מהשדה.
    const ae = document.activeElement;
    if (ae && ae.classList && ae.classList.contains('prop-notes')) { pendingRender = true; return; }
    pendingRender = false;
    scanLine();
    const live = all.filter((p) => !isGone(p));
    const count = (fn) => live.filter((p) => p.status !== 'irrelevant' && fn(p)).length;
    $('prop-n-deal').textContent = count(isDeal);
    $('prop-n-review').textContent = count(isReview);
    $('prop-n-new').textContent = count(isNew);
    $('prop-n-fav').textContent = all.filter((p) => p.favorite).length;
    document.querySelectorAll('#prop-attn .attn-item').forEach((b) => b.setAttribute('aria-pressed', b.dataset.quick === quick ? 'true' : 'false'));
    const goneN = all.length - live.length;
    $('prop-gone-wrap').hidden = !goneN; $('prop-gone-n').textContent = goneN;

    const grid = $('prop-grid');
    if (loadError) { grid.innerHTML = `<p class="empty-state">לא ניתן לטעון את הנכסים (${esc(loadError)}). אם הלשונית חדשה — ייתכן שחוקי האבטחה עוד לא פורסמו.</p>`; $('prop-shown').textContent = ''; return; }
    if (!loaded) { grid.innerHTML = '<p class="empty-state">טוען…</p>'; return; }
    if (!all.length) { grid.innerHTML = '<p class="empty-state">עדיין אין נכסים. ברגע שמחשב הסריקה יחובר ותרוץ סריקה — הנכסים יופיעו כאן.</p>'; $('prop-shown').textContent = ''; return; }
    const rows = visible().sort(SORTS[sortF] || SORTS.smart);
    $('prop-shown').textContent = `מוצגים ${rows.length} מתוך ${live.length + (showGone ? goneN : 0)}`;
    grid.innerHTML = rows.length ? rows.map(card).join('') : '<p class="empty-state">אין נכסים שמתאימים לסינון.</p>';
  }

  /* ============================================================
     מעקב: סטטוס / מועדף / הערות / משימה
     ============================================================ */
  const byId = (id) => all.find((p) => p.id === id);
  function saveTrack(id, patch) {
    const p = byId(id); if (p) Object.assign(p, patch);
    return fs.updateDoc(fs.doc(db, 'properties', id), { ...patch, trackUpdatedAt: nowISO(), trackUpdatedBy: ctx.me().email || '' })
      .catch((err) => { console.warn('property save', err); const m = $('prop-msg'); if (m) { m.hidden = false; m.textContent = 'השמירה נכשלה — נסו שוב.'; setTimeout(() => { m.hidden = true; }, 5000); } });
  }
  function bind() {
    const grid = $('prop-grid'); if (!grid || grid.dataset.bound) return; grid.dataset.bound = '1';
    const idOf = (el) => { const c = el.closest('.prop-card'); return c ? c.dataset.id : ''; };
    grid.addEventListener('change', (e) => {
      if (e.target.dataset.act !== 'status') return;
      const st = e.target.value; e.target.className = 'status-select ' + (STATUS_CLS[st] || '');
      saveTrack(idOf(e.target), { status: st });
    });
    grid.addEventListener('click', (e) => {
      const el = e.target.closest('[data-act]'); if (!el) return;
      const id = idOf(el), p = byId(id); if (!p) return;
      if (el.dataset.act === 'fav') {
        const on = !p.favorite; el.classList.toggle('on', on); el.setAttribute('aria-pressed', on ? 'true' : 'false');
        saveTrack(id, { favorite: on });
      } else if (el.dataset.act === 'task' && ctx.openTask) {
        const bits = [p.price ? money(p.price) : '', p.rooms ? p.rooms + ' חד׳' : '', p.size ? p.size + ' מ״ר' : '', p.type || ''].filter(Boolean).join(' · ');
        ctx.openTask({ title: 'נכס: ' + (p.address || p.city || ''), desc: [bits, p.estValue ? 'הערכת שווי: ' + money(p.estValue) + (p.confidence ? ' (ביטחון ' + (CONF_HE[p.confidence] || p.confidence) + ')' : '') : '', p.qualityNote || '', adUrl(p.url)].filter(Boolean).join('\n') });
      }
    });
    grid.addEventListener('input', (e) => {
      if (e.target.dataset.act !== 'notes') return;
      const id = idOf(e.target), val = e.target.value;
      clearTimeout(noteTimers.get(id));
      noteTimers.set(id, setTimeout(() => { noteTimers.delete(id); saveTrack(id, { notes: val }); }, 800));
    });
    grid.addEventListener('focusout', (e) => { if (e.target.dataset && e.target.dataset.act === 'notes' && pendingRender) setTimeout(render, 900); });
    // תמונה שלא נטענה (המודעה הוסרה / האתר חוסם) — מסתירים במקום להציג תמונה שבורה
    grid.addEventListener('error', (e) => { if (e.target.tagName === 'IMG') { const b = e.target.closest('.prop-img'); if (b) b.classList.add('noimg'); e.target.remove(); } }, true);

    $('prop-attn').addEventListener('click', (e) => { const b = e.target.closest('.attn-item'); if (!b) return; quick = quick === b.dataset.quick ? '' : b.dataset.quick; render(); });
    $('prop-search').addEventListener('input', (e) => { q = e.target.value; render(); });
    $('prop-status').innerHTML = '<option value="">כל הסטטוסים</option><option value="none">ללא סטטוס</option>' + Object.keys(PROPERTY_STATUS).map((k) => `<option value="${k}">${PROPERTY_STATUS[k]}</option>`).join('');
    $('prop-status').addEventListener('change', (e) => { statusF = e.target.value; render(); });
    $('prop-sort').addEventListener('change', (e) => { sortF = e.target.value; render(); });
    $('prop-gone').addEventListener('change', (e) => { showGone = e.target.checked; render(); });
  }
  bind();

  return { setOwner, refresh: render, detach };
}
