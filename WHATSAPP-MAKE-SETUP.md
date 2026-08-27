# חיבור לידים מוואטסאפ ל-CRM (קמפיין Click-to-WhatsApp, דרך Make.com)

מטרה: מישהו לוחץ על מודעת "שלח הודעה בוואטסאפ" → כותב לכם הודעה → הליד נכתב אוטומטית
ל-Firestore → מופיע בטבלת הלידים ב-`/crm` עם תגית **"וואטסאפ"**.

> **שיטה:** אותה שיטה כמו הלידים מפייסבוק ([FACEBOOK-MAKE-SETUP.md](FACEBOOK-MAKE-SETUP.md)) —
> כתיבה ישירה ל-Firestore דרך ה-API הציבורי. לא צריך Service Account.

---

## חלק א' — תנאי מקדים: המספר חייב להיות על WhatsApp Business **Cloud API**

זה החלק החשוב והיחיד שמסובך. לאפליקציית WhatsApp Business הרגילה בטלפון **אין API** —
אי אפשר "להאזין" להודעות שנכנסות אליה. כדי לאוטמט, המספר צריך לעבור ל-
**WhatsApp Business Platform (Cloud API)** של Meta.

שימו לב לפני שמתחילים:
- מספר שעובר ל-Cloud API **מפסיק לעבוד באפליקציה בטלפון** — עונים ללקוחות דרך פלטפורמה
  (למשל האינבוקס של Meta Business Suite, או ספק כמו Wati/Glassix/Timelines).
  אם אתם רוצים להמשיך לענות מהטלפון — עדיף **מספר ייעודי חדש לקמפיין** (וזה גם מה שממליצים).
- יש עלות קטנה של Meta לפי שיחות (Conversation-based pricing). הודעות שירות שהלקוח פתח — זולות/חינם ב-24 שעות הראשונות.

### הקמה (חד-פעמית, ~30 דק')
1. https://developers.facebook.com → **Create App** → סוג **Business** → חברו ל-Business Portfolio של הורייזון.
2. בתוך האפליקציה: הוסיפו את מוצר **WhatsApp** → **API Setup**.
3. הוסיפו/אמתו את מספר הטלפון של הקמפיין (או השתמשו במספר בדיקה בשלב הניסוי).
4. את המודעה ב-Ads Manager מגדירים כקמפיין **הודעות → WhatsApp** שמפנה למספר הזה.

## חלק ב' — תרחיש (Scenario) ב-Make.com

### מודול 1 — טריגר: הודעת וואטסאפ נכנסת
1. הוסיפו מודול: **WhatsApp Business Cloud** → **Watch Events**.
2. Make ייצור כתובת Webhook — העתיקו אותה.
3. חזרו לאפליקציה ב-developers.facebook.com → WhatsApp → **Configuration**:
   - הדביקו את כתובת ה-Webhook + ה-Verify Token ש-Make נתן.
   - ב-**Webhook fields** עשו Subscribe ל-**messages**.
4. שלחו הודעת בדיקה למספר — ההודעה אמורה להופיע ב-Make.

### מודול 2 — סינון כפילויות (מומלץ)
כל הודעה נכנסת מפעילה את התרחיש — בלי סינון, לקוח שכותב 5 הודעות = 5 לידים.
1. הוסיפו **Data store** ב-Make (שם: `whatsapp-leads`, מבנה: שדה `phone` אחד).
2. לפני הכתיבה ל-Firestore: מודול **Data store → Get a record** עם המפתח `{{wa_id}}`,
   ואחריו **Filter** שממשיך רק אם לא נמצאה רשומה (Record "does not exist").
3. אחרי הכתיבה ל-Firestore: **Data store → Add a record** עם המפתח `{{wa_id}}` — כדי שהפעם הבאה תיחסם.

(אפשר לדלג על זה בהתחלה ופשוט למחוק כפילויות ידנית ב-CRM.)

### מודול 3 — כתיבה ל-Firestore (מודול HTTP)
בדיוק כמו בפייסבוק, רק עם `source: "whatsapp"`:

- **URL:**
  ```
  https://firestore.googleapis.com/v1/projects/horizon-psagot-group-ccbe6/databases/(default)/documents/leads?key=AIzaSyDcVepmWtFaSLhHylQIuxvoHTZWdSyOAsk
  ```
- **Method:** `POST`
- **Headers:** `Content-Type: application/json`
- **Body type:** `Raw` · **Content type:** `JSON (application/json)`
- **Request content:**
  ```json
  {
    "fields": {
      "name":      { "stringValue": "{{שם הפרופיל — profile name}}" },
      "phone":     { "stringValue": "+{{wa_id}}" },
      "email":     { "stringValue": "" },
      "message":   { "stringValue": "{{טקסט ההודעה — message body}}" },
      "source":    { "stringValue": "whatsapp" },
      "status":    { "stringValue": "new" },
      "notes":     { "stringValue": "" },
      "createdAt": { "timestampValue": "{{formatDate(now; \"YYYY-MM-DDTHH:mm:ss[Z]\"; \"UTC\")}}" }
    }
  }
  ```
  הערות מיפוי:
  - `wa_id` מגיע מוואטסאפ **בלי +** (למשל `972501234567`) — לכן מוסיפים `+` לפני, כדי
    שכפתור הוואטסאפ בכרטיס הליד ב-CRM יעבוד ישר.
  - בקליק-טו-וואטסאפ מקבלים בדרך כלל רק **שם פרופיל + מספר + טקסט ההודעה** — אין אימייל. זה בסדר.
  - אם רוצים לדעת מאיזו מודעה הגיע הליד: להודעה הראשונה מצורף אובייקט `referral`
    (כותרת המודעה/כתובת) — אפשר למפות את `{{referral.headline}}` לתוך `notes`.

### הפעלה
1. **Run once** → שלחו הודעה אמיתית למספר מהטלפון שלכם.
2. ודאו שהליד הופיע ב-`/crm` עם תגית **"וואטסאפ"**, שההודעה מופיעה מתחת לשם, ושכפתור
   הוואטסאפ בכרטיס הליד פותח את השיחה הנכונה.
3. **Scheduling → ON**.

---

## חלופה: ספק מנוהל במקום Meta ישירות
אם ההקמה מול developers.facebook.com מסורבלת מדי — ספקים כמו **Wati / Glassix / Timelines**
מנהלים את ה-Cloud API בשבילכם (כולל אינבוקס נוח לצוות לענות ללקוחות), ולכולם יש
Webhook או מודול Make. במקרה כזה רק מודול 1 מתחלף — מודולים 2–3 נשארים זהים.
עלות: ~‏$30–60 לחודש, אבל חוסך את כאב הראש של ניהול ה-API והאינבוקס.

## הערות
- ההודעות עצמן (השיחה) לא נשמרות ב-CRM — רק ההודעה הראשונה כליד. את השיחה מנהלים באינבוקס.
- לידים מהאתר/פייסבוק/וואטסאפ נוחתים באותה טבלה; מבדילים לפי תגית מקור, ויש פילטר "מוואטסאפ".
- האבטחה זהה לפייסבוק: המפתח בכתובת ציבורי במכוון, הכללים ב-Firestore הם ההגנה.
