# חשבוניות ב-Desk — ייבוא מהמייל (הגדרה חד-פעמית)

הטאב **חשבוניות** ב-/desk נגיש **לבעלים בלבד** (role = owner ב-crm_users).
ההרשאה נאכפת בחוקי Firestore (`invoices/{id}`) ובחוקי Storage (`invoices/**`) — לא רק בממשק.

הקבצים נשמרים ב-Storage תחת `invoices/{שנה}/{חודש}/{timestamp}-{שם קובץ}`,
והמטא-דאטה (ספק, מספר, תאריך, סכום, קטגוריה, שולם, מקור) ב-Firestore באוסף `invoices`.

## העלאה ידנית
עובד מיד אחרי פריסת החוקים (`firebase deploy --only firestore:rules,storage`):
גרירת קבצים לאזור ההעלאה, או "+ חשבונית חדשה" עם פרטים.

## ייבוא מ-Gmail (office@horizon-psagot-group.com)
הייבוא רץ כולו בדפדפן: Google Identity Services מבקש הרשאת **קריאה בלבד** ל-Gmail,
הדסק מחפש מיילים עם קבצים מצורפים, מציג רשימה לבחירה, ומעלה את הנבחרים לארכיון.
כדי שזה יעבוד צריך OAuth Client ID של הפרויקט:

1. פותחים https://console.cloud.google.com עם **ariel@horizon-psagot-group.com**
   ובוחרים את הפרויקט **horizon-psagot-group-ccbe6** (זה פרויקט ה-Firebase).
2. **APIs & Services → Library** → מחפשים **Gmail API** → Enable.
3. **APIs & Services → OAuth consent screen**:
   - User type: **Internal** אם Google Workspace של הארגון (מומלץ — אין צורך באישור Google),
     אחרת External + הוספת office@horizon-psagot-group.com תחת **Test users**.
   - App name: Horizon Desk · Support email: office@…
   - Scopes: להוסיף `https://www.googleapis.com/auth/gmail.readonly`.
4. **APIs & Services → Credentials → + Create credentials → OAuth client ID**:
   - Application type: **Web application** · Name: Horizon Desk
   - Authorized JavaScript origins:
     - `https://horizonpsagotgroup.com`
     - `https://www.horizonpsagotgroup.com`
   - (אין צורך ב-Redirect URI — משתמשים ב-token flow)
5. מעתיקים את ה-**Client ID** (מסתיים ב-`.apps.googleusercontent.com`)
   ומדביקים ב-`js/crm-invoices.js`:
   ```js
   export const GMAIL_CLIENT_ID = '1234567890-xxxx.apps.googleusercontent.com';
   ```
6. מעלים גרסה (`?v=` בכל קובצי ה-JS/HTML), commit + push.

### שימוש
Desk → חשבוניות → **✉ ייבוא מהמייל** → בוחרים טווח → "חיפוש במייל" → בפעם הראשונה Google יבקש להתחבר
ל-office@… ולאשר קריאה → מסמנים את הקבצים → "ייבוא".
- קבצים שכבר יובאו (לפי מזהה המייל + שם הקובץ) מסומנים "יובא" ולא ניתנים לבחירה שוב.
- הספק מתמלא אוטומטית משם השולח, התאריך מתאריך המייל (או משם הקובץ אם יש בו תאריך).
- את הסכום ומספר החשבונית ממלאים ידנית בלחיצה על השורה (אפשר לסנן "חסרים פרטים" לפי הסיכום למעלה).

### שאילתת החיפוש
ברירת המחדל: `(חשבונית OR קבלה OR invoice OR receipt OR "חשבונית מס") has:attachment`.
אפשר לערוך בחלון הייבוא — תחביר Gmail רגיל (למשל `from:billing@google.com has:attachment`).

## ייצוא
- **CSV** — הטבלה המסוננת (נפתח באקסל, כולל קישורים לקבצים) — למשל לרו"ח.
- **ZIP** — כל הקבצים המסוננים, בתיקייה לפי שנה, בשם `תאריך ספק מספר.pdf`.
  דורש CORS על ה-bucket (כבר הוגדר, ראו README-STORAGE-CORS.md).
