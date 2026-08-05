# הורייזון פסגות גרופ — מערכת ניהול לידים (CRM)

פניות מהטופס באתר → נשמרות ב-Firestore ומופיעות בדשבורד ב-**`/crm`** מאחורי התחברות.
**המיילים הקיימים (Web3Forms) ממשיכים לעבוד כרגיל** — ה-CRM נוסף מעליהם, לא מחליף.

זמן הקמה: ~15 דקות, חד-פעמי.

---

## שלב 1 — פרויקט Firebase (נפרד להורייזון)
1. https://console.firebase.google.com ← **Add project** (שם: `horizon-psagot`, אפשר לכבות Analytics).
2. **Build → Firestore Database → Create database** → **Production** → אזור `eur3`.
3. **Build → Authentication → Get started → Email/Password → Enable**.

## שלב 2 — חיבור האתר
1. **Project settings** → **Your apps** → אייקון `</>` (Web) → **Register app**.
2. מהאובייקט `firebaseConfig` שמופיע — העתיקו את הערכים לקובץ **`js/firebase-config.js`** (החלפת `REPLACE_ME`).

## שלב 3 — משתמש לצוות
**Authentication → Users → Add user**: אימייל + סיסמה. אלה פרטי הכניסה ל-`/crm`. אפשר להוסיף כמה אנשי צוות.

## שלב 4 — כללי אבטחה
**Firestore → Rules** → הדביקו והחליפו הכל → **Publish**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // לידים — כל אחד שולח, רק צוות רואה/עורך
    match /leads/{doc} {
      allow create: if request.resource.data.name is string
                    && request.resource.data.phone is string;
      allow read, update, delete: if request.auth != null;
    }
    // עסקאות — כולם רואים (מוצג באתר), רק צוות עורך
    match /deals/{doc} {
      allow read: if true;
      allow write: if request.auth != null;
    }
    // מאמרים — כולם רואים, רק צוות עורך
    match /articles/{doc} {
      allow read: if true;
      allow write: if request.auth != null;
    }
  }
}
```

זהו — היכנסו ל-`https://horizonpsagotgroup.com/crm`, התחברו, וכל פנייה חדשה מהטופס תופיע בדשבורד בזמן אמת. ✅

---

## שלב 5 (אופציונלי) — אוטומציה מפייסבוק
**Facebook Lead Ads → CRM** דרך Zapier/Make:
- Trigger: **Facebook Lead Ads → New Lead**
- Action: **Firestore → Create Document** בקולקשן `leads`, עם `name`, `phone`, `email`, `source: facebook`, `status: new`, `createdAt`.
- לידים מהמודעות יופיעו עם תגית "פייסבוק" לצד לידים מהאתר.

---

## הערות
- **Decap CMS** (ניהול העסקאות) נשאר ב-`/admin` — ה-CRM נפרד, ב-`/crm`. הם לא מתנגשים.
- מפתח ה-`apiKey` מיועד להיחשף בצד-לקוח; האבטחה על כללי ה-Rules.
- כל עוד `firebase-config.js` לא מולא — הטופס שולח מייל רגיל בלבד (בלי CRM). אין סיכון לאובדן פניות.
- הדשבורד מתעדכן בזמן אמת.
