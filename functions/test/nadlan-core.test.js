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
  const ref = (n, id) => ({ _n: n, id, set: async (v, o) => { col(n)[id] = (o && o.merge) ? { ...(col(n)[id] || {}), ...clone(v) } : clone(v); } });
  return {
    data, writes: 0,
    collection: (n) => ({ doc: (id) => ref(n, id) }),
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
