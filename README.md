# הורייזון פסגות גרופ — אתר תדמית

אתר סטטי רב-עמודי בעברית (RTL), בנוי ב-HTML / CSS / JavaScript בלבד — ללא frameworks ו-build steps.

## איך לפתוח את האתר

### דרך מומלצת: VS Code + Live Server
1. פתח את התיקייה ב-VS Code
2. התקן את התוסף **Live Server** של Ritwick Dey
3. קליק ימני על `index.html` → "Open with Live Server"
4. הדפדפן ייפתח, ובכל שמירה הדף יתרענן אוטומטית

### דרך פשוטה: דאבל-קליק
לחיצה כפולה על `index.html` תפתח אותו בדפדפן (בלי ריענון אוטומטי בשמירה).

## מבנה התיקיות

```
business-website/
├── index.html              דף בית
├── about.html              אודות
├── financial.html          ליווי פיננסי-עסקי
├── real-estate.html        נדל"ן והשקעות
├── solutions.html          פתרונות לפי קהל יעד
├── team.html               צוות ושותפים
├── testimonials.html       המלצות
├── faq.html                שאלות נפוצות
├── blog.html               בלוג
├── article.html            תבנית מאמר בודד
├── contact.html            יצירת קשר
├── accessibility.html      הצהרת נגישות
├── sitemap.xml             מפת אתר (לקידום SEO)
├── robots.txt              הנחיות למנועי חיפוש
├── css/
│   ├── main.css            משתני עיצוב, איפוס, טיפוגרפיה (אבן יסוד)
│   ├── layout.css          Header, Footer, Hero, סקציות
│   ├── components.css      כפתורים, כרטיסים, טפסים, אקורדיון
│   └── animations.css      אנימציות עדינות בגלילה
├── js/
│   ├── main.js             תפריט נייד, scroll, smooth scroll
│   ├── animations.js       Intersection Observer לאנימציות
│   └── form.js             אימות טופס יצירת קשר
├── assets/
│   ├── images/             תמונות עתידיות
│   ├── icons/              SVG icons
│   └── logo/               מקום לקובץ SVG של הלוגו
├── articles/               מאמרי בלוג עתידיים
└── brand/                  נכסי מותג (לוגו, תמונות מקור)ם


## נגישות

- תקן ישראלי 5568 / WCAG 2.0 AA
- ראה הצהרת נגישות מלאה ב-`accessibility.html`

## הערה משפטית

הורייזון פסגות גרופ אינה מוסד פיננסי ואינה מנהלת כספי לקוחות.
טיפול משפטי מבוצע בשיתוף עורכי דין חיצוניים.
