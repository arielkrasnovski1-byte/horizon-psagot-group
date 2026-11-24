# לשונית "נכסים" ב-Desk — קליטה מסורק הנדל"ן

הסורק רץ על מחשב חיצוני (אצל השמאי). בסוף כל סריקה הוא שולח את הנכסים לכתובת קליטה אחת, וה-Desk מציג אותם.

```
מחשב הסריקה ──POST + קוד סודי──▶ nadlanIngest (Cloud Function) ──▶ Firestore properties/{id}
                                                                  └▶ settings/nadlanScan
Desk (בעלים בלבד) ◀── קריאה + עדכון שדות מעקב בלבד ── Firestore
```

## קבצים

| קובץ | תפקיד |
|---|---|
| `functions/nadlan.js` | הכתובת עצמה: בדיקת הקוד הסודי (`NADLAN_TOKEN`) |
| `functions/nadlan-core.js` | ניקוי הקלט, שמירה, היסטוריית מחיר, קליטת סימוני מעקב |
| `functions/test/nadlan-core.test.js` | בדיקות (`cd functions && npm test`) |
| `js/crm-properties.js` | הלשונית ב-Desk |
| `firestore.rules` → `properties` | בעלים קוראים; מעדכנים רק `status / notes / favorite` |

## מה הקוד הסודי מאפשר

רק להוסיף ולעדכן נכסים. אי אפשר לקרוא דרכו שום דבר (לידים, תיקים, מסמכים), ואי אפשר לשנות דרכו את שדות המעקב אחרי שמישהו נגע בנכס ב-Desk.

## התקנה (פעם אחת)

1. יצירת קוד ושמירתו כסוד (הקוד נשמר גם בקובץ בשולחן העבודה, כדי להעביר אותו למחשב הסריקה):

   ```
   openssl rand -hex 24 | tee ~/Desktop/nadlan-desk/קוד-חיבור.txt | firebase functions:secrets:set NADLAN_TOKEN --data-file=- --project horizon-psagot-group-ccbe6
   ```

2. העלאת הפונקציה והחוקים:

   ```
   firebase deploy --only functions:nadlanIngest,firestore:rules --project horizon-psagot-group-ccbe6
   ```

3. במחשב הסריקה: להתקין את חבילת העדכון ולהריץ `הגדרת דסק.bat` עם הקוד.

## החלפת קוד

להריץ שוב את שלב 1 ואת ההעלאה של הפונקציה, ולהריץ שוב `הגדרת דסק.bat` במחשב הסריקה. הקוד הישן מפסיק לעבוד.

## מגבלות ידועות

- יש חיפוש אחד בכל רגע; נכס שלא הופיע בסריקות 3 ימים מוצג כ"ירד מהאתר".
- ההערכה היא כלי לאיתור ולא שומה.
- נתוני העסקאות של מידע נדל"ן לא נשלחים ל-Desk, רק תוצאת ההערכה.
