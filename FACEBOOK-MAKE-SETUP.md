# חיבור לידים מפייסבוק ל-CRM (דרך Make.com)

מטרה: כשמישהו ממלא טופס במודעת לידים בפייסבוק → הליד נכתב אוטומטית ל-Firestore → מופיע בטבלת הלידים ב-`/crm` עם תגית "פייסבוק".

> **שיטה:** כתיבה ישירה ל-Firestore דרך ה-API הציבורי (בדיוק כמו שהטופס באתר עושה).
> **לא צריך Service Account** — כך שאין בעיה עם המדיניות הארגונית של Google.

זמן הקמה: ~15 דקות, חד-פעמי.

---

## חלק א' — תרחיש (Scenario) ב-Make.com

היכנסו ל-https://make.com (הרשמה חינם) → **Create a new scenario**.

### מודול 1 — טריגר מפייסבוק
1. הוסיפו מודול: **Facebook Lead Ads** → **Watch Leads**.
2. חברו את חשבון הפייסבוק (הרשאות אדמין לדף העסקי).
3. בחרו את **הדף** ואת **טופס הלידים** שממנו יגיעו הלידים.

### מודול 2 — כתיבה ל-Firestore (מודול HTTP)
4. הוסיפו מודול: **HTTP** → **Make a request**.
5. הגדירו כך:

   - **URL:**
     ```
     https://firestore.googleapis.com/v1/projects/horizon-psagot-group-ccbe6/databases/(default)/documents/leads?key=AIzaSyDcVepmWtFaSLhHylQIuxvoHTZWdSyOAsk
     ```
   - **Method:** `POST`
   - **Headers:** הוסיפו כותרת אחת:
     - Name: `Content-Type` · Value: `application/json`
   - **Body type:** `Raw` · **Content type:** `JSON (application/json)`
   - **Request content (גוף הבקשה):** הדביקו את זה, והחליפו את `{{...}}` בשדות שגררתם מהמודול של פייסבוק:
     ```json
     {
       "fields": {
         "name":      { "stringValue": "{{שם מהטופס}}" },
         "phone":     { "stringValue": "{{טלפון מהטופס}}" },
         "email":     { "stringValue": "{{אימייל מהטופס}}" },
         "source":    { "stringValue": "facebook" },
         "status":    { "stringValue": "new" },
         "notes":     { "stringValue": "" },
         "createdAt": { "timestampValue": "{{formatDate(now; \"YYYY-MM-DDTHH:mm:ss[Z]\"; \"UTC\")}}" }
       }
     }
     ```
     > הערה: את `{{שם מהטופס}}` / `{{טלפון מהטופס}}` / `{{אימייל מהטופס}}` מחליפים ע"י גרירת השדה המתאים מהמודול של פייסבוק (Make מציג רשימת שדות). את `source`, `status`, `notes`, `createdAt` משאירים כמו שהם.

### הפעלה
6. לחצו **Run once** לבדיקה (אפשר להשתמש ב-*Meta Lead Ads Testing Tool* כדי לשלוח ליד דמה).
7. ודאו שהליד הופיע בטבלת הלידים ב-`/crm` עם תגית **"פייסבוק"**.
8. הפעילו את התרחיש (**Scheduling → ON**). Make יבדוק לידים חדשים אוטומטית כל כמה דקות.

---

## הערות
- מפתח ה-Web שבכתובת הוא **ציבורי ומכוון** (אותו מפתח שכבר באתר); האבטחה נאכפת ע"י כללי ה-Firestore.
- לידים מהאתר ומפייסבוק נוחתים באותה טבלה; מבדילים לפי תגית **מקור** (אתר / פייסבוק).
- רק **טופס לידים של מודעה** נתמך. לידים שמגיעים כ-DM/תגובות — לא ניתנים לאוטומציה (מגבלת Meta).
- אם תרצו למנוע ספאם בעתיד — אפשר להוסיף שכבת הגנה, אבל בשלב זה הסיכון זהה לזה של הטופס באתר (נמוך).
- המסלול החינמי של Make מספיק בדרך כלל (בדקו את מכסת הפעולות החודשית).
