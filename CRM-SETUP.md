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

## שלב 4 — כללי אבטחה (לפי תפקידים)
כל הכללים נמצאים בקובץ **`firestore.rules`** בשורש הפרויקט.
**Firestore → Rules** → העתיקו את כל תוכן `firestore.rules` → הדביקו במקום הקיים → **Publish**.

מה הכללים עושים:
- **לידים** — כל אחד שולח פנייה (טופס/פייסבוק); רק צוות מחובר רואה ועורך.
- **תוכן** (עסקאות/המלצות/צוות/שאלות/מאמרים) — כולם קוראים (מוצג באתר), רק **owner/manager** עורכים.
- **משתמשים** (`crm_users`) — כל הצוות קורא; רק **owner** מוסיף/מסיר/משנה תפקידים; אף אחד לא יכול לשנות את התפקיד של עצמו (מונע הסלמת הרשאות).

> ⚠️ **חשוב לפני Publish:** ודאו שלמשתמש הראשי שלכם כבר יש מסמך ב-`crm_users/<uid>` עם `role: "owner"` (כבר בוצע דרך "הגדר אותי כבעלים" בפאנל). אחרת — צרו אותו ידנית ב-**Firestore → Data → crm_users** לפני הפרסום, כדי לא לנעול את עצמכם מניהול המשתמשים.

**להוספת בעלים ראשון בפרויקט חדש (bootstrap):** ב-Firebase Console → Firestore → צרו מסמך בקולקשן `crm_users` עם מזהה = ה-UID מ-Authentication, ושדה `role` בערך `owner`.

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
