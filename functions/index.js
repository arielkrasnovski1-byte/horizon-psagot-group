/* ============================================================
   הורייזון פסגות גרופ — Cloud Functions · נקודת הכניסה
   כל פונקציה יושבת בקובץ משלה ונטענת מכאן.

   חשוב: בזמן העלאה (firebase deploy) הכלי דורש ערך לכל סוד שמוגדר בקוד שנטען כאן —
   גם כשמעלים פונקציה אחת בלבד. לכן מודול שהסודות שלו עוד לא הוגדרו נשאר בהערה,
   ומפעילים אותו רק כשהוא מוכן לעלות.
   ============================================================ */
const admin = require('firebase-admin');
const { setGlobalOptions } = require('firebase-functions/v2');

admin.initializeApp();
setGlobalOptions({ region: 'europe-west1', memory: '512MiB', timeoutSeconds: 540, maxInstances: 1 });

/* ---------- קליטת נכסים מסורק הנדל"ן (nadlanIngest) — nadlan.js / nadlan-core.js · README-NADLAN.md ---------- */
exports.nadlanIngest = require('./nadlan').nadlanIngest;

/* ---------- בוט וואטסאפ לצוות (whatsappWebhook) — whatsapp.js / wa-core.js · README-WHATSAPP-BOT.md ----------
   עוד לא עלה. להפעלה: להגדיר את הסודות WA_TOKEN / WA_APP_SECRET / WA_VERIFY_TOKEN ואז להסיר את ההערה. */
// exports.whatsappWebhook = require('./whatsapp').whatsappWebhook;

/* ---------- סנכרון DOKKA → חשבוניות (dokkaSyncScheduled / dokkaSyncNow) — dokka.js · README-DOKKA.md ----------
   מושבת (הוחלט לא להמשיך עם Dokka, 2026-11-02). להפעלה: להגדיר את הסוד DOKKA_TOKEN ואז להסיר את ההערה. */
// Object.assign(exports, require('./dokka'));
