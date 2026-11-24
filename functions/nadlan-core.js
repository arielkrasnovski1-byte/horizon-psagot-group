/* ============================================================
   הורייזון פסגות גרופ — קליטת נכסים מסורק הנדל"ן (לשונית "נכסים" ב-Desk)
   הלוגיקה בלבד, בלי Firebase: מקבלת db מוזרק, כדי שאפשר לבדוק אותה בלי ענן.
   · כל נכס נשמר ב-properties/{source_listingId}
   · שדות הסריקה נדרסים בכל סריקה; שדות המעקב של הדסק (status / notes / favorite) לא נוגעים בהם
   · שינוי מחיר נרשם ב-priceHistory
   · סימוני מעקב מהמחשב של הסורק נקלטים רק כל עוד אף אחד לא נגע בנכס בדסק
   · חיפושים מנוהלים בדסק (property_searches/{id}); מחשב הסריקה מושך אותם (poll),
     מדווח התחלה/תקלה (report), ושולח תוצאות לכל חיפוש (ingest עם search_id)
   הקלט מגיע ממחשב חיצוני — כל שדה מנוקה ומוגבל כאן לפני שמירה.
   ============================================================ */
'use strict';

const MAX_LISTINGS = 600;
const BATCH = 400;
const HISTORY_MAX = 20;

// סטטוסים של המסך המקומי אצל הסורק → מפתחות בדסק
const STATUS_MAP = { 'חדש': 'new', 'לבדיקה': 'check', 'יצרתי קשר': 'contacted', 'במשא ומתן': 'negotiation', 'נסגר': 'closed', 'לא רלוונטי': 'irrelevant' };
const CONFIDENCE = ['גבוהה', 'בינונית', 'נמוכה'];
// מאיפה מותר לקבל קישור מודעה / תמונה (הדסק מציג אותם כקישור וכתמונה)
// סוגי נכס שהסורק מכיר (ערכים של config.json אצלו)
const SEARCH_TYPES = ['צמוד קרקע', 'דירה', 'דירת גן', 'פנטהאוז', 'דופלקס', 'נחלה'];
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const HOSTS = { yad2: /(^|\.)yad2\.co\.il$/i, madlan: /(^|\.)madlan\.co\.il$/i };

/* ---------- ניקוי ערכים ---------- */
const str = (v, max) => (typeof v === 'string' || typeof v === 'number') ? String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';
const num = (v, min, max) => { const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN); return Number.isFinite(n) && n >= min && n <= max ? n : null; };
const int = (v, min, max) => { const n = num(v, min, max); return n == null ? null : Math.round(n); };
const bool = (v) => v === true;
const strList = (v, maxItems, maxLen) => Array.isArray(v) ? v.map((x) => str(x, maxLen)).filter(Boolean).slice(0, maxItems) : [];

function safeLink(v, source, anyKnownHost) {
  const s = str(v, 500);
  if (!s) return '';
  let u; try { u = new URL(s); } catch (e) { return ''; }
  if (u.protocol !== 'https:' || u.username || u.password) return '';
  const ok = anyKnownHost ? Object.values(HOSTS).some((re) => re.test(u.hostname)) : (HOSTS[source] && HOSTS[source].test(u.hostname));
  return ok ? u.href : '';
}

/** נכס אחד מהסורק → { id, data } נקי, או null אם אין לו זיהוי תקין. */
function cleanListing(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const source = str(raw.source, 20).toLowerCase();
  const listingId = str(raw.listing_id, 60);
  if (!HOSTS[source] || !/^[A-Za-z0-9_-]{1,60}$/.test(listingId)) return null;
  const confidence = str(raw.confidence, 20);
  const data = {
    source, listingId,
    url: safeLink(raw.url, source, false),
    image: safeLink(raw.image_url, source, true),
    price: int(raw.price, 1, 1e9),
    priceBefore: int(raw.price_before, 1, 1e9),
    city: str(raw.city, 60), neighborhood: str(raw.neighborhood, 80), street: str(raw.street, 80),
    houseNumber: str(raw.house_number, 12), address: str(raw.address, 200),
    rooms: num(raw.rooms, 0, 50), floor: int(raw.floor, -5, 200), size: int(raw.size_sqm, 1, 100000),
    type: str(raw.property_type, 60), adType: str(raw.ad_type, 30), tags: str(raw.tags, 300), condition: str(raw.condition, 40),
    firstSeen: /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(str(raw.first_seen, 16)) ? str(raw.first_seen, 16) : '',
    isNew: bool(raw.is_new),
    // הערכת שווי
    estValue: int(raw.est_value, 1, 1e10), estBasis: str(raw.est_basis, 300), estMethod: ['sqm', 'rooms'].includes(raw.est_method) ? raw.est_method : '',
    compCount: int(raw.comp_count, 0, 100000) || 0, compSpread: num(raw.comp_spread, 0, 1000),
    closedMedian: int(raw.closed_median, 1, 1e10), closedBasis: str(raw.closed_basis, 120), closedTrend: num(raw.closed_trend_pct, -100, 1000),
    below: bool(raw.is_below_market), review: bool(raw.needs_review),
    discount: int(raw.discount_pct, -1000, 100), rawDiscount: int(raw.raw_discount_pct, -1000, 100),
    confidence: CONFIDENCE.includes(confidence) ? confidence : '',
    qualityNote: str(raw.quality_note, 400),
    priceSuspect: bool(raw.price_suspect), areaSuspect: bool(raw.area_suspect),
  };
  // "מציאה" ו"לבדוק נתונים" לא יכולים להיות יחד; מחיר פיקטיבי אף פעם לא מציאה
  if (data.priceSuspect) { data.below = false; data.discount = null; }
  if (data.below) data.review = false;
  return { id: source + '_' + listingId, key: source + ':' + listingId, data };
}

function cleanSearch(raw) {
  const s = (raw && typeof raw === 'object') ? raw : {};
  return {
    sources: strList(s.sources, 5, 20), cities: strList(s.cities, 10, 60), neighborhoods: strList(s.neighborhoods, 20, 80),
    propertyTypes: strList(s.property_types, 20, 60),
    minPrice: int(s.min_price, 0, 1e9) || 0, maxPrice: int(s.max_price, 0, 1e9) || 0,
    minRooms: num(s.min_rooms, 0, 50) || 0, maxRooms: num(s.max_rooms, 0, 50) || 0,
    requireMamad: bool(s.require_mamad),
  };
}

function cleanMark(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const status = STATUS_MAP[str(raw.status, 40)] || '';
  const notes = str(raw.notes, 2000);
  const favorite = bool(raw.favorite);
  return (status || notes || favorite) ? { status, notes, favorite } : null;
}

/** הגדרת חיפוש מהדסק → הצורה שהסורק מבין (שמות השדות של config.json אצלו). */
function searchForAgent(id, d) {
  d = d || {};
  const thr = int(d.thresholdPct, 5, 90) || 30;
  return {
    id,
    name: str(d.name, 100),
    cities: strList(d.cities, 1, 60),                       // עיר אחת לחיפוש — ההערכה נשענת על עסקאות של אותה עיר
    neighborhoods: strList(d.neighborhoods, 10, 80),
    min_price: int(d.minPrice, 0, 1e9) || 0, max_price: int(d.maxPrice, 0, 1e9) || 0,
    min_rooms: num(d.minRooms, 0, 50) || 0, max_rooms: num(d.maxRooms, 0, 50) || 0,
    property_types: strList(d.propertyTypes, 10, 60).filter((t) => SEARCH_TYPES.includes(t)),
    require_mamad: bool(d.requireMamad),
    below_market_threshold: thr / 100,
    scan_requested_at: str(d.scanRequestedAt, 40),
    last_scan_at: str(d.lastScanAt, 40),
  };
}

/** החיפוש המקומי של הסורק (config.json) → מסמך חיפוש בדסק. משמש פעם אחת, כשאין עדיין חיפושים בדסק. */
function searchFromLocal(raw, nowISO) {
  const s = cleanSearch(raw);
  if (!s.cities.length) return null;
  const types = s.propertyTypes.filter((t) => SEARCH_TYPES.includes(t));
  const thr = int(((raw && raw.below_market_threshold) || 0) * 100, 5, 90) || 30;
  return {
    name: [s.cities[0], types.join(', ')].filter(Boolean).join(' · ').slice(0, 100),
    cities: s.cities.slice(0, 1), neighborhoods: s.neighborhoods, propertyTypes: types,
    minPrice: s.minPrice, maxPrice: s.maxPrice, minRooms: s.minRooms, maxRooms: s.maxRooms,
    requireMamad: s.requireMamad, thresholdPct: thr, active: true,
    createdAt: nowISO, createdBy: 'scanner', importedFromScanner: true,
  };
}

/**
 * מחשב הסריקה שואל: אילו חיפושים פעילים יש, ומה ביקשו לסרוק עכשיו.
 * גם מסמן "המחשב מחובר" (agentSeenAt) בשביל שורת המצב בדסק.
 */
async function poll(deps, body) {
  const { db } = deps;
  const nowISO = (deps.now ? deps.now() : new Date()).toISOString();
  const col = db.collection('property_searches');
  const docs = [];
  (await col.get()).forEach((snap) => docs.push({ id: snap.id, data: snap.data() || {} }));
  let imported = false;
  if (!docs.length && body && body.local_search) {
    const first = searchFromLocal(body.local_search, nowISO);
    if (first) { await col.doc('local').set(first); docs.push({ id: 'local', data: first }); imported = true; }
  }
  await db.collection('settings').doc('nadlanScan').set({ agentSeenAt: nowISO, agentVersion: int(body && body.v, 0, 1000) || 0 }, { merge: true });
  const searches = docs.filter((d) => ID_RE.test(d.id) && d.data.active !== false).map((d) => searchForAgent(d.id, d.data)).filter((x) => x.cities.length);
  return { ok: true, now: nowISO, imported, searches };
}

/** מחשב הסריקה מדווח על חיפוש: התחיל לסרוק / נכשל / דילג. */
async function report(deps, body) {
  const { db } = deps;
  const nowISO = (deps.now ? deps.now() : new Date()).toISOString();
  const fail = (status, message) => { const e = new Error(message); e.status = status; return e; };
  const id = str(body && body.search_id, 40);
  if (!ID_RE.test(id)) throw fail(400, 'search_id missing');
  const ref = db.collection('property_searches').doc(id);
  if (!(await ref.get()).exists) throw fail(404, 'search not found');
  const state = str(body.state, 20);
  if (state === 'running') await ref.set({ scanState: 'running', scanStartedAt: nowISO }, { merge: true });
  else if (state === 'error' || state === 'skipped') await ref.set({ scanState: state, lastError: str(body.message, 400), lastErrorAt: nowISO, scanRequestedAt: '' }, { merge: true });
  else throw fail(400, 'unknown state');
  return { ok: true };
}

/**
 * קליטת סריקה אחת.
 * deps: { db (Firestore Admin), now: () => Date }
 * מחזירה { ok, saved, created, priceChanges, skipped } או זורקת שגיאה עם .status (400 / 413).
 */
async function ingest(deps, body) {
  const { db } = deps;
  const now = deps.now ? deps.now() : new Date();
  const nowISO = now.toISOString();
  const fail = (status, message) => { const e = new Error(message); e.status = status; return e; };

  if (!body || typeof body !== 'object' || !Array.isArray(body.listings)) throw fail(400, 'listings missing');
  if (body.listings.length > MAX_LISTINGS) throw fail(413, 'too many listings');

  // ניקוי + הסרת כפילויות (האחרון קובע)
  const byId = new Map();
  let skipped = 0;
  body.listings.forEach((raw) => { const c = cleanListing(raw); if (c) byId.set(c.id, c); else skipped++; });
  const items = [...byId.values()];
  const marks = (body.marks && typeof body.marks === 'object') ? body.marks : {};

  // סריקה של חיפוש מסוים מהדסק (search_id) — הנכסים מתויגים בו, ומצב החיפוש מתעדכן בסוף
  let searchRef = null;
  const searchId = str(body.search_id, 40);
  if (searchId) {
    if (!ID_RE.test(searchId)) throw fail(400, 'bad search_id');
    searchRef = db.collection('property_searches').doc(searchId);
    if (!(await searchRef.get()).exists) throw fail(404, 'search not found');
  }

  const col = db.collection('properties');
  const existing = new Map();
  for (let i = 0; i < items.length; i += BATCH) {
    const refs = items.slice(i, i + BATCH).map((it) => col.doc(it.id));
    if (!refs.length) continue;
    (await db.getAll(...refs)).forEach((snap) => { if (snap.exists) existing.set(snap.id, snap.data() || {}); });
  }

  let created = 0, priceChanges = 0, marksApplied = 0;
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = db.batch();
    items.slice(i, i + BATCH).forEach((it) => {
      const old = existing.get(it.id);
      const doc = { ...it.data, lastSeenAt: nowISO };
      if (searchId) doc.searchIds = [...new Set([...((old && Array.isArray(old.searchIds)) ? old.searchIds : []), searchId])].slice(-20);
      if (!old) {
        created++;
        Object.assign(doc, { createdAt: nowISO, status: '', notes: '', favorite: false, priceHistory: [] });
      } else if (old.price && doc.price && old.price !== doc.price) {
        priceChanges++;
        const hist = Array.isArray(old.priceHistory) ? old.priceHistory : [];
        doc.priceHistory = [...hist, { price: old.price, until: nowISO }].slice(-HISTORY_MAX);
        doc.prevPrice = old.price;
        doc.priceChangedAt = nowISO;
      }
      // סימוני מעקב מהמסך המקומי של הסורק — רק כל עוד אף אחד לא עדכן את הנכס בדסק
      const mark = cleanMark(marks[it.key]);
      if (mark && !(old && old.trackUpdatedAt)) { Object.assign(doc, mark, { trackSource: 'local' }); marksApplied++; }
      batch.set(col.doc(it.id), doc, { merge: true });
    });
    await batch.commit();
  }

  const scannedAt = num(body.scanned_at, 1e9, 1e11);
  await db.collection('settings').doc('nadlanScan').set({
    lastReceivedAt: nowISO,
    scannedAt: scannedAt ? new Date(scannedAt * 1000).toISOString() : nowISO,
    count: items.length,
    belowCount: items.filter((it) => it.data.below).length,
    reviewCount: items.filter((it) => it.data.review).length,
    newCount: created,
    thresholdPct: int(body.threshold_pct, 0, 100),
    search: cleanSearch(body.search),
    clientVersion: int(body.v, 0, 1000) || 0,
  }, { merge: true });

  if (searchRef) {
    await searchRef.set({
      scanState: 'done', lastScanAt: nowISO, scanRequestedAt: '', lastError: '',
      lastCount: items.length, lastBelow: items.filter((it) => it.data.below).length, lastReview: items.filter((it) => it.data.review).length, lastNew: created,
      // על כמה עסקאות שנסגרו נשענה ההערכה בחיפוש הזה (הנתונים עצמם נשארים אצל הסורק)
      dealsCount: int(body.deals_count, 0, 1e6) || 0, dealsNote: str(body.deals_note, 300),
    }, { merge: true });
  }

  return { ok: true, saved: items.length, created, priceChanges, marksApplied, skipped };
}

module.exports = { ingest, poll, report, cleanListing, cleanSearch, cleanMark, searchForAgent, searchFromLocal, STATUS_MAP, MAX_LISTINGS, SEARCH_TYPES };
