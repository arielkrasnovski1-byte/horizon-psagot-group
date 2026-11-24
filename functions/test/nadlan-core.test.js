/* בדיקות מקומיות לקליטת הנכסים מסורק הנדל"ן — בלי Firebase.
   הרצה:  cd functions && npm test
   הנתונים כאן מומצאים. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../nadlan-core');

function fakeDb(seed) {
  const data = JSON.parse(JSON.stringify(seed || {}));
  const col = (n) => (data[n] = data[n] || {});
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const snap = (n, id) => ({ id, exists: id in col(n), data: () => (id in col(n) ? clone(col(n)[id]) : undefined) });
  const ref = (n, id) => ({ _n: n, id, get: async () => snap(n, id), set: async (v, o) => { col(n)[id] = (o && o.merge) ? { ...(col(n)[id] || {}), ...clone(v) } : clone(v); } });
  return {
    data, writes: 0,
    collection: (n) => ({ doc: (id) => ref(n, id), get: async () => ({ forEach: (fn) => Object.keys(col(n)).forEach((id) => fn(snap(n, id))) }) }),
    getAll: async (...refs) => refs.map((r) => ({ id: r.id, exists: r.id in col(r._n), data: () => clone(col(r._n)[r.id]) })),
    batch() { const ops = []; const self = this; return { set: (r, v, o) => ops.push([r, v, o]), commit: async () => { for (const [r, v, o] of ops) { await r.set(v, o); self.writes++; } } }; },
  };
}
const NOW = new Date('2026-11-24T10:00:00Z');
const deps = (db, when) => ({ db, now: () => when || NOW });
const listing = (over) => ({
  source: 'yad2', listing_id: 'abc123', url: 'https://www.yad2.co.il/realestate/item/abc123', image_url: 'https://img.yad2.co.il/Pic/1.jpeg',
  price: 1500000, city: 'עיר לדוגמה', neighborhood: 'שכונה', street: 'הרחוב', house_number: 4, address: 'הרחוב 4, שכונה, עיר לדוגמה',
  rooms: 4, floor: 0, size_sqm: 110, property_type: 'דירת גן', first_seen: '2026-11-20 09:00', is_new: true,
  est_value: 2000000, est_basis: 'עסקאות שנסגרו · עיר · דירת גן', est_method: 'sqm', comp_count: 12, comp_spread: 1.2,
  is_below_market: true, needs_review: false, discount_pct: 25, raw_discount_pct: 25, confidence: 'בינונית', quality_note: '', ...over,
});
const body = (listings, extra) => ({ v: 1, scanned_at: 1795513880, threshold_pct: 30, search: { cities: ['עיר לדוגמה'], min_price: 1000000, max_price: 1800000, min_rooms: 4, property_types: ['צמוד קרקע'], sources: ['yad2'] }, listings, ...extra });

test('נכס חדש נשמר עם שדות נקיים וברירות מחדל של מעקב', async () => {
  const db = fakeDb();
  const out = await core.ingest(deps(db), body([listing()]));
  assert.deepEqual({ saved: out.saved, created: out.created }, { saved: 1, created: 1 });
  const p = db.data.properties.yad2_abc123;
  assert.equal(p.price, 1500000); assert.equal(p.size, 110); assert.equal(p.type, 'דירת גן');
  assert.equal(p.below, true); assert.equal(p.discount, 25); assert.equal(p.confidence, 'בינונית');
  assert.deepEqual([p.status, p.notes, p.favorite], ['', '', false]);
  assert.equal(p.lastSeenAt, NOW.toISOString());
  const s = db.data.settings.nadlanScan;
  assert.equal(s.count, 1); assert.equal(s.belowCount, 1); assert.deepEqual(s.search.cities, ['עיר לדוגמה']); assert.equal(s.search.maxPrice, 1800000);
});

test('סריקה חוזרת לא דורסת מעקב שנעשה בדסק, ושינוי מחיר נרשם', async () => {
  const db = fakeDb();
  await core.ingest(deps(db), body([listing()]));
  Object.assign(db.data.properties.yad2_abc123, { status: 'contacted', notes: 'דיברתי עם המוכר', favorite: true, trackUpdatedAt: '2026-11-24T11:00:00Z' });
  const later = new Date('2026-11-25T10:00:00Z');
  const out = await core.ingest(deps(db, later), body([listing({ price: 1400000, is_new: false })], { marks: { 'yad2:abc123': { status: 'לא רלוונטי', notes: 'מקומי', favorite: false } } }));
  const p = db.data.properties.yad2_abc123;
  assert.equal(out.created, 0); assert.equal(out.priceChanges, 1); assert.equal(out.marksApplied, 0);
  assert.deepEqual([p.status, p.notes, p.favorite], ['contacted', 'דיברתי עם המוכר', true]);
  assert.equal(p.price, 1400000); assert.equal(p.prevPrice, 1500000);
  assert.deepEqual(p.priceHistory, [{ price: 1500000, until: later.toISOString() }]);
  assert.equal(p.createdAt, NOW.toISOString());
});

test('סימוני מעקב מהמחשב של הסורק נקלטים כשאף אחד לא נגע בנכס בדסק', async () => {
  const db = fakeDb();
  const out = await core.ingest(deps(db), body([listing()], { marks: { 'yad2:abc123': { status: 'לבדיקה', notes: 'לבדוק נסח טאבו', favorite: true }, 'yad2:zzz': { status: 'משהו לא מוכר' } } }));
  const p = db.data.properties.yad2_abc123;
  assert.equal(out.marksApplied, 1);
  assert.deepEqual([p.status, p.notes, p.favorite, p.trackSource], ['check', 'לבדוק נסח טאבו', true, 'local']);
});

test('קלט עוין: זיהוי לא תקין נזרק, קישורים זרים נמחקים, טקסט נחתך', async () => {
  const db = fakeDb();
  const out = await core.ingest(deps(db), body([
    listing({ listing_id: '../../leads/x' }),
    listing({ source: 'evil', listing_id: 'a1' }),
    listing({ listing_id: 'ok1', url: 'javascript:alert(1)', image_url: 'https://evil.example/x.png', address: 'א'.repeat(5000), price: 'לא מספר', confidence: '<b>', quality_note: 5 }),
    listing({ listing_id: 'ok2', url: 'https://www.yad2.co.il.evil.example/item', image_url: 'http://img.yad2.co.il/a.jpg' }),
    null, 'טקסט',
  ]));
  assert.equal(out.saved, 2); assert.equal(out.skipped, 4);
  assert.deepEqual(Object.keys(db.data.properties).sort(), ['yad2_ok1', 'yad2_ok2']);
  const p = db.data.properties.yad2_ok1;
  assert.equal(p.url, ''); assert.equal(p.image, ''); assert.equal(p.address.length, 200); assert.equal(p.price, null); assert.equal(p.confidence, '');
  assert.equal(db.data.properties.yad2_ok2.url, ''); assert.equal(db.data.properties.yad2_ok2.image, '');
});

test('מחיר פיקטיבי אף פעם לא נשמר כמציאה; מציאה ו"לבדוק נתונים" לא יחד', async () => {
  const db = fakeDb();
  await core.ingest(deps(db), body([listing({ listing_id: 'fake', price: 1111111, price_suspect: true }), listing({ listing_id: 'both', needs_review: true })]));
  assert.deepEqual([db.data.properties.yad2_fake.below, db.data.properties.yad2_fake.discount], [false, null]);
  assert.deepEqual([db.data.properties.yad2_both.below, db.data.properties.yad2_both.review], [true, false]);
});

test('גוף בקשה לא תקין או גדול מדי נדחה', async () => {
  const db = fakeDb();
  await assert.rejects(core.ingest(deps(db), {}), (e) => e.status === 400);
  await assert.rejects(core.ingest(deps(db), null), (e) => e.status === 400);
  const many = Array.from({ length: core.MAX_LISTINGS + 1 }, (_, i) => listing({ listing_id: 'n' + i }));
  await assert.rejects(core.ingest(deps(db), body(many)), (e) => e.status === 413);
  assert.equal(db.writes, 0);
});

test('הרבה נכסים נכתבים בכמה אצוות, וכפילויות באותה סריקה מתאחדות', async () => {
  const db = fakeDb();
  const many = Array.from({ length: 450 }, (_, i) => listing({ listing_id: 'n' + i }));
  const out = await core.ingest(deps(db), body([...many, listing({ listing_id: 'n0', price: 999999 })]));
  assert.equal(out.saved, 450); assert.equal(Object.keys(db.data.properties).length, 450);
  assert.equal(db.data.properties.yad2_n0.price, 999999);
});

test('בדיקת הקוד הסודי', () => {
  const { _validToken } = require('../nadlan');
  const secret = 'a'.repeat(48);
  assert.equal(_validToken(secret, secret), true);
  assert.equal(_validToken(secret + 'x', secret), false);
  assert.equal(_validToken('', secret), false);
  assert.equal(_validToken('short', 'short'), false);
});

/* ---------- חיפושים מנוהלים בדסק ---------- */
const searchDoc = (over) => ({ name: 'עיר לדוגמה · דירת גן', cities: ['עיר לדוגמה'], neighborhoods: [], propertyTypes: ['דירת גן'], minPrice: 1000000, maxPrice: 1800000, minRooms: 4, maxRooms: 0, requireMamad: false, thresholdPct: 25, active: true, ...over });

test('poll: מחזיר רק חיפושים פעילים, בצורה שהסורק מבין, ומסמן שהמחשב מחובר', async () => {
  const db = fakeDb({ property_searches: { s1: searchDoc({ scanRequestedAt: '2026-11-24T09:00:00Z' }), s2: searchDoc({ active: false }), s3: searchDoc({ cities: [] }), 'bad id!': searchDoc() } });
  const out = await core.poll(deps(db), { op: 'poll', v: 2 });
  assert.deepEqual(out.searches.map((s) => s.id), ['s1']);
  const s = out.searches[0];
  assert.deepEqual([s.cities, s.property_types, s.min_price, s.max_price, s.min_rooms, s.below_market_threshold, s.scan_requested_at], [['עיר לדוגמה'], ['דירת גן'], 1000000, 1800000, 4, 0.25, '2026-11-24T09:00:00Z']);
  assert.equal(db.data.settings.nadlanScan.agentSeenAt, NOW.toISOString());
  assert.equal(out.imported, false);
});

test('poll: כשאין חיפושים בדסק, החיפוש המקומי של הסורק מיובא פעם אחת', async () => {
  const db = fakeDb();
  const local = { cities: ['עיר לדוגמה'], property_types: ['צמוד קרקע', 'סוג לא מוכר'], min_price: 1000000, max_price: 1800000, min_rooms: 4, below_market_threshold: 0.3 };
  const out = await core.poll(deps(db), { op: 'poll', local_search: local });
  assert.equal(out.imported, true); assert.equal(out.searches.length, 1); assert.equal(out.searches[0].id, 'local');
  const d = db.data.property_searches.local;
  assert.deepEqual([d.name, d.propertyTypes, d.thresholdPct, d.active], ['עיר לדוגמה · צמוד קרקע', ['צמוד קרקע'], 30, true]);
  const again = await core.poll(deps(db), { op: 'poll', local_search: { cities: ['עיר אחרת'] } });
  assert.equal(again.imported, false); assert.deepEqual(Object.keys(db.data.property_searches), ['local']);
});

test('report + ingest עם search_id: מצב החיפוש מתעדכן והנכסים מתויגים', async () => {
  const db = fakeDb({ property_searches: { s1: searchDoc({ scanRequestedAt: '2026-11-24T09:00:00Z' }), s2: searchDoc() } });
  await core.report(deps(db), { op: 'report', search_id: 's1', state: 'running' });
  assert.equal(db.data.property_searches.s1.scanState, 'running');
  const out = await core.ingest(deps(db), body([listing(), listing({ listing_id: 'r1', is_below_market: false, needs_review: true })], { search_id: 's1', deals_count: 433, deals_note: 'עסקאות מהתוכנה' }));
  assert.equal(out.saved, 2);
  const s = db.data.property_searches.s1;
  assert.deepEqual([s.scanState, s.lastScanAt, s.scanRequestedAt, s.lastCount, s.lastBelow, s.lastReview, s.dealsCount], ['done', NOW.toISOString(), '', 2, 1, 1, 433]);
  assert.deepEqual(db.data.properties.yad2_abc123.searchIds, ['s1']);
  // אותו נכס עולה גם בחיפוש אחר — מתויג בשניהם, בלי כפילות
  await core.ingest(deps(db), body([listing()], { search_id: 's2' }));
  await core.ingest(deps(db), body([listing()], { search_id: 's2' }));
  assert.deepEqual(db.data.properties.yad2_abc123.searchIds, ['s1', 's2']);
  assert.equal(db.data.settings.nadlanScan.count, 1);
});

test('report: תקלה נרשמת ומנקה את בקשת הסריקה; חיפוש לא קיים נדחה', async () => {
  const db = fakeDb({ property_searches: { s1: searchDoc({ scanRequestedAt: '2026-11-24T09:00:00Z' }) } });
  await core.report(deps(db), { search_id: 's1', state: 'error', message: 'העיר לא נמצאה' });
  assert.deepEqual([db.data.property_searches.s1.scanState, db.data.property_searches.s1.lastError, db.data.property_searches.s1.scanRequestedAt], ['error', 'העיר לא נמצאה', '']);
  await assert.rejects(core.report(deps(db), { search_id: 'nope', state: 'running' }), (e) => e.status === 404);
  await assert.rejects(core.report(deps(db), { search_id: '../x', state: 'running' }), (e) => e.status === 400);
  await assert.rejects(core.report(deps(db), { search_id: 's1', state: 'whatever' }), (e) => e.status === 400);
  await assert.rejects(core.ingest(deps(db), body([listing()], { search_id: 'nope' })), (e) => e.status === 404);
  assert.equal(db.data.properties, undefined);
});
