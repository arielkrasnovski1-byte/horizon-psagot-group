# Dokka ↔ Desk — סנכרון חשבוניות

**הזרימה:** הצוות שולח מסמכים ל‑Dokka (וואטסאפ +972525529256 / מייל horizon-pg@dokka.co.il / העלאה).
Dokka מעבדת אותם (ספק, סכום, מספר, תאריך). **פונקציית ענן** מושכת כל 30 דקות את כל המסמכים הפיננסיים
מ‑Dokka לארכיון החשבוניות בדסק — כולל הקובץ והנתונים שחולצו — ואפשר גם ללחוץ **🔄 סנכרון מ‑Dokka** בדסק.

- Firestore: `invoices/{id}` עם `source: 'dokka'`, `dokkaDocumentId` (מניעת כפילויות), `dokkaType`, `dokkaTags`…
- Storage: `invoices/{שנה}/{חודש}/dokka-{documentId}.pdf`
- מצב הסנכרון: `settings/dokkaSync` (בעלים קוראים; נכתב רק ע"י הפונקציה)
- עריכה ידנית של חשבונית שהגיעה מ‑Dokka מסמנת `manualEdit: true` → הסנכרון לא דורס ספק/סכום/תאריך/מספר.
- הפונקציות: `functions/index.js` — `dokkaSyncScheduled` (כל 30 דק׳, Asia/Jerusalem) + `dokkaSyncNow` (callable, בעלים בלבד).

## מה צריך מ‑Dokka
API של Dokka דורש בכל קריאה:
- **DOKKA‑AUTH‑ID** — טוקן אבטחה (API token)
- **companyID** — מזהה החברה ב‑Dokka

מבקשים מ‑Dokka (מנהל/ת הלקוח או support@dokka.com): "אנחנו רוצים להתחבר ל‑Public API (api.dokka.com)
כדי למשוך את המסמכים של החברה הורייזון פסגות גרופ בע"מ למערכת פנימית. נא לספק API token (DOKKA‑AUTH‑ID) ו‑companyID."
תיעוד ה‑API: https://api.dokka.com/

## הגדרה חד‑פעמית (פעם אחת, במק של אריאל)
1. **Node.js** (נדרש לפריסת פונקציות): להתקין LTS מ‑https://nodejs.org (קובץ .pkg), ואז לפתוח טרמינל חדש.
2. התקנת תלויות:
   ```bash
   cd ~/Desktop/business-website/functions && npm install
   ```
3. מזהה החברה — לערוך את `functions/.env`:
   ```
   DOKKA_COMPANY_ID=<ה-companyID מ-Dokka>
   ```
4. הטוקן — נשמר כ‑Secret (לא בקוד ולא ב‑git):
   ```bash
   cd ~/Desktop/business-website && firebase functions:secrets:set DOKKA_TOKEN --project horizon-psagot-group-ccbe6 --account ariel@horizon-psagot-group.com
   ```
   (מדביקים את הטוקן כשנשאלים.)
5. פריסה (חוקים + פונקציות). בפעם הראשונה Firebase יבקש לאשר הפעלת APIs (Cloud Functions, Cloud Build, Artifact Registry, Cloud Scheduler) — לאשר:
   ```bash
   cd ~/Desktop/business-website && firebase deploy --only firestore:rules,functions --project horizon-psagot-group-ccbe6 --account ariel@horizon-psagot-group.com
   ```
6. בדסק → חשבוניות → **🔄 סנכרון מ‑Dokka**. בסיום מופיע: נבדקו / נוספו / עודכנו. מכאן זה רץ לבד כל 30 דקות.

> חלופה בלי התקנת Node: לפתוח Cloud Shell (https://shell.cloud.google.com, להתחבר כ‑ariel@…),
> `git clone` של הריפו, ואז שלבים 2–5 שם (יש שם node + firebase מותקנים).

## עלויות
דורש תוכנית Blaze (כבר פעילה). 48 ריצות ביום של פונקציה קטנה נכנסות במסגרת החינמית.
שימו לב: קרדיט ה‑Trial מסתיים ב‑17.11.2026 — אחריו צריך אמצעי תשלום בפרויקט כדי שהפונקציות ימשיכו לרוץ.

## פתרון תקלות
- "DOKKA … HTTP 401/403" בשגיאות הסנכרון → טוקן/companyID שגויים או פג תוקף.
- "הפונקציה עדיין לא פרוסה" → שלב 5 לא בוצע.
- מסמך לא פיננסי ב‑Dokka (`is_financial: false`) לא נמשך בכוונה.
- הכפתור "📤 שליחה ל‑Dokka" נשאר לחשבוניות שהועלו ידנית לדסק ולא עברו דרך Dokka; מה שהגיע מ‑Dokka מסומן כבר כ"נמצא ב‑Dokka".
