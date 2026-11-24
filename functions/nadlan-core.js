/* ============================================================
   הורייזון פסגות גרופ — קליטת נכסים מסורק הנדל"ן (לשונית "נכסים" ב-Desk)
   הלוגיקה בלבד, בלי Firebase: מקבלת db מוזרק, כדי שאפשר לבדוק אותה בלי ענן.
   · כל נכס נשמר ב-properties/{source_listingId}
   · שדות הסריקה נדרסים בכל סריקה; שדות המעקב של הדסק (status / notes / favorite) לא נוגעים בהם
   · שינוי מחיר נרשם ב-priceHistory
   · סימוני מעקב מהמחשב של הסורק נקלטים רק כל עוד אף אחד לא נגע בנכס בדסק
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
  });

  return { ok: true, saved: items.length, created, priceChanges, marksApplied, skipped };
}

module.exports = { ingest, cleanListing, cleanSearch, cleanMark, STATUS_MAP, MAX_LISTINGS };
