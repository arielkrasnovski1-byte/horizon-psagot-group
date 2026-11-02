/* ============================================================
   הורייזון פסגות גרופ — Cloud Functions
   סנכרון DOKKA → ארכיון החשבוניות ב-Desk (Firestore `invoices` + Storage `invoices/…`)
   · רץ אוטומטית כל 30 דקות (Cloud Scheduler) + ידנית מהדסק (callable, בעלים בלבד)
   · מושך את כל המסמכים הפיננסיים מ-DOKKA, מוריד את הקובץ, יוצר/מעדכן חשבונית
   · זיהוי כפילויות לפי dokkaDocumentId · תיקונים ידניים ב-Desk (manualEdit) לא נדרסים
   DOKKA API: https://api.dokka.com/  (header DOKKA-AUTH-ID + companyID)
   ============================================================ */
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret, defineString } = require('firebase-functions/params');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const crypto = require('crypto');

admin.initializeApp();
setGlobalOptions({ region: 'europe-west1', memory: '512MiB', timeoutSeconds: 540, maxInstances: 1 });

const DOKKA_TOKEN = defineSecret('DOKKA_TOKEN');
const DOKKA_COMPANY_ID = defineString('DOKKA_COMPANY_ID');
const API = 'https://api.dokka.com';
const PAGE = 100;

/* ---------- עזרים ---------- */
const p2 = (n) => ('0' + n).slice(-2);
const nowISO = () => new Date().toISOString();
const today = () => { const d = new Date(); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
const safe = (s, max) => String(s || '').replace(/[\/\\#?\[\]*:"<>|%\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 60);
const num = (v) => { const n = parseFloat(String(v == null ? '' : v).replace(/[^\d.\-]/g, '')); return isNaN(n) ? 0 : n; };
// תאריך מ-DOKKA: ISO, או %m/%d/%Y (הפורמט שה-API שלהם משתמש בו), או dd.mm.yyyy
function parseDate(s) {
  if (!s) return '';
  const str = String(s).trim();
  let m = str.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) { const a = +m[1], b = +m[2]; const [mo, da] = a > 12 ? [b, a] : [a, b]; return `${m[3]}-${p2(mo)}-${p2(da)}`; }
  m = str.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/); if (m) return `${m[3]}-${p2(m[2])}-${p2(m[1])}`;
  const d = new Date(str); return isNaN(d) ? '' : `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}
function mapFields(d) {
  const g = d.general || {}, t = d.transaction_general || {}, pay = d.payment || {};
  const date = parseDate(t.date) || parseDate(g.created) || today();
  const [y, m] = date.split('-');
  const type = String(t.type || '').toLowerCase();
  return {
    supplier: String(t.supplier_name || '').trim().slice(0, 120),
    number: String(t.reference_id || '').trim().slice(0, 60),
    date, year: Number(y), month: Number(m),
    amount: num(t.gross_amount),
    paid: pay.is_paid === true ? true : pay.is_paid === false ? false : true,
    kind: /customer|sales|income|outgoing|receivable/.test(type) ? 'income' : 'expense',
    dokkaType: type, dokkaSupplierCode: t.supplier_code || '', dokkaPublished: !!t.is_published,
  };
}
async function dokka(path, params, raw) {
  const u = new URL(API + path);
  u.searchParams.set('companyID', DOKKA_COMPANY_ID.value());
  Object.entries(params || {}).forEach(([k, v]) => { if (v == null || v === '') return; (Array.isArray(v) ? v : [v]).forEach((x) => u.searchParams.append(k, x)); });
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(u, { headers: { 'DOKKA-AUTH-ID': DOKKA_TOKEN.value(), Accept: raw ? '*/*' : 'application/json' } });
    if ((r.status === 429 || r.status >= 500) && attempt < 4) { await new Promise((w) => setTimeout(w, 1500 * Math.pow(2, attempt))); continue; }
    if (!r.ok) throw new Error('DOKKA ' + path + ' → HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200));
    return raw ? r : r.json();
  }
}

/* ---------- הסנכרון עצמו ---------- */
async function runSync({ trigger, sinceDays }) {
  const db = admin.firestore(), bucket = admin.storage().bucket();
  const stateRef = db.doc('settings/dokkaSync');
  const started = nowISO();
  await stateRef.set({ running: true, runningSince: started, lastTrigger: trigger }, { merge: true });
  const result = { seen: 0, added: 0, updated: 0, skipped: 0, nonFinancial: 0, errors: [] };
  try {
    // מפה של מה שכבר קיים: dokkaDocumentId → {ref, data} (שאילתה אחת במקום קריאה לכל מסמך)
    const known = new Map();
    (await db.collection('invoices').where('source', '==', 'dokka').get()).forEach((s) => { const x = s.data(); if (x.dokkaDocumentId) known.set(x.dokkaDocumentId, { ref: s.ref, data: x }); });
    const sinceMs = sinceDays > 0 ? Date.now() - sinceDays * 86400000 : 0;
    let pageToken = '', pages = 0;
    do {
      const res = await dokka('/public/documents', { maxResults: PAGE, pageToken: pageToken || undefined });
      for (const d of res.documents || []) {
        result.seen++;
        const g = d.general || {};
        if (!g.document_id) continue;
        if (g.is_financial === false) { result.nonFinancial++; continue; }
        const createdMs = Date.parse(g.created || '') || 0;
        if (sinceMs && createdMs && createdMs < sinceMs) { result.skipped++; continue; }
        const fields = mapFields(d);
        const tags = [...(d.users_tags || []), ...(d.classification_tags || [])].filter(Boolean).slice(0, 20);
        try {
          const ex = known.get(g.document_id);
          if (ex) {
            // עדכון נתונים שהשתנו ב-DOKKA (סכום/ספק/תשלום) — אלא אם תוקנו ידנית בדסק
            const upd = {};
            const protectedKeys = ex.data.manualEdit ? ['supplier', 'number', 'date', 'year', 'month', 'amount', 'kind'] : [];
            Object.entries({ ...fields, dokkaTags: tags }).forEach(([k, v]) => { if (protectedKeys.includes(k)) return; if (JSON.stringify(ex.data[k]) !== JSON.stringify(v)) upd[k] = v; });
            if (Object.keys(upd).length) { upd.dokkaUpdatedAt = nowISO(); await ex.ref.update(upd); result.updated++; }
            continue;
          }
          // מסמך חדש: הורדת הקובץ → Storage → Firestore
          const fr = await dokka('/public/get_document/' + encodeURIComponent(g.document_id), {}, true);
          const ct = (fr.headers.get('content-type') || 'application/pdf').split(';')[0].trim();
          const buf = Buffer.from(await fr.arrayBuffer());
          if (!buf.length) throw new Error('קובץ ריק');
          const ext = /pdf/i.test(ct) ? '.pdf' : /jpe?g/i.test(ct) ? '.jpg' : /png/i.test(ct) ? '.png' : /webp/i.test(ct) ? '.webp' : '.pdf';
          const contentType = ext === '.pdf' ? 'application/pdf' : ct;
          const [y, m] = fields.date.split('-');
          const fileName = ([fields.date, safe(fields.supplier, 40), fields.number ? safe(fields.number, 20) : ''].filter(Boolean).join(' ') || 'dokka ' + g.document_id) + ext;
          const path = `invoices/${y}/${m}/dokka-${safe(g.document_id, 80)}${ext}`;
          const dlToken = crypto.randomUUID();
          await bucket.file(path).save(buf, { contentType, resumable: false, metadata: { metadata: { firebaseStorageDownloadTokens: dlToken } } });
          const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${dlToken}`;
          const doc = {
            ...fields, fileName, path, url, size: buf.length, contentType,
            currency: 'ILS', category: '', note: '', printedAt: '', printedBy: '',
            source: 'dokka', dokkaDocumentId: g.document_id, dokkaCreated: g.created || '', dokkaCreatedBy: g.created_by || '', dokkaFromEmail: !!g.from_email, dokkaTags: tags,
            // הגיע מ-DOKKA → כבר "נמצא ב-DOKKA" (לא יישלח אליהם שוב מהדסק)
            dokkaSentAt: g.created || nowISO(), dokkaSentBy: 'dokka', dokkaSyncedAt: nowISO(),
            uploadedAt: nowISO(), uploadedBy: 'dokka-sync',
          };
          const ref = await db.collection('invoices').add(doc);
          known.set(g.document_id, { ref, data: doc });
          result.added++;
        } catch (e) { result.errors.push(g.document_id + ': ' + (e.message || e)); console.warn('dokka doc', g.document_id, e); }
      }
      pageToken = res.next_page_token || ''; pages++;
    } while (pageToken && pages < 500);
  } catch (e) { result.errors.unshift('FATAL: ' + (e.message || e)); console.error('dokka sync', e); }
  await stateRef.set({ running: false, lastSyncAt: nowISO(), lastStartedAt: started, lastTrigger: trigger, lastResult: { ...result, errors: result.errors.slice(0, 15), errorCount: result.errors.length } }, { merge: true });
  return result;
}

/* ---------- טריגרים ---------- */
exports.dokkaSyncScheduled = onSchedule({ schedule: 'every 30 minutes', timeZone: 'Asia/Jerusalem', secrets: [DOKKA_TOKEN] }, async () => {
  if (!DOKKA_COMPANY_ID.value() || DOKKA_COMPANY_ID.value() === 'REPLACE_ME') { console.log('DOKKA_COMPANY_ID not set — skipping'); return; }
  await runSync({ trigger: 'schedule', sinceDays: 0 });
});

// סנכרון ידני מהדסק — בעלים בלבד. data: { sinceDays?: number } (0/חסר = הכל)
exports.dokkaSyncNow = onCall({ secrets: [DOKKA_TOKEN], cors: ['https://horizonpsagotgroup.com', 'https://www.horizonpsagotgroup.com'] }, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'נדרשת התחברות');
  const me = await admin.firestore().doc('crm_users/' + req.auth.uid).get();
  if (!me.exists || me.data().role !== 'owner') throw new HttpsError('permission-denied', 'בעלים בלבד');
  if (!DOKKA_COMPANY_ID.value() || DOKKA_COMPANY_ID.value() === 'REPLACE_ME') throw new HttpsError('failed-precondition', 'DOKKA_COMPANY_ID לא הוגדר בפונקציה');
  const state = (await admin.firestore().doc('settings/dokkaSync').get()).data() || {};
  if (state.running && state.runningSince && Date.now() - Date.parse(state.runningSince) < 10 * 60000) throw new HttpsError('already-exists', 'סנכרון כבר רץ — נסו שוב בעוד דקה');
  return runSync({ trigger: 'manual:' + (req.auth.token.email || req.auth.uid), sinceDays: Number(req.data && req.data.sinceDays) || 0 });
});
