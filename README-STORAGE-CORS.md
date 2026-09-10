# הורדת כל מסמכי התיק (ZIP) — הגדרת CORS חד-פעמית

הכפתור "⬇ הורדת כל המסמכים" ב-Desk מוריד את הקבצים לדפדפן ואורז אותם ל-ZIP.
Firebase Storage חוסם הורדה כזו מדף אינטרנט עד שמגדירים לו CORS (פעם אחת, לכל ה-bucket).

## איך מגדירים (5 דקות, בלי להתקין כלום)

1. פותחים https://console.cloud.google.com/?project=horizon-psagot-group-ccbe6 ומתחברים עם ariel@horizon-psagot-group.com
2. לוחצים על אייקון **Cloud Shell** (מסוף `>_` בפינה הימנית-עליונה) וממתינים שייפתח.
3. מדביקים ומריצים:

```bash
cat > cors.json <<'EOF'
[{"origin":["https://horizonpsagotgroup.com","https://www.horizonpsagotgroup.com"],"method":["GET","HEAD"],"responseHeader":["Content-Type","Content-Disposition","Content-Length"],"maxAgeSeconds":3600}]
EOF
gsutil cors set cors.json gs://horizon-psagot-group-ccbe6.firebasestorage.app
gsutil cors get gs://horizon-psagot-group-ccbe6.firebasestorage.app
```

הפלט של השורה האחרונה צריך להראות את ההגדרה. מרגע זה כפתור ה-ZIP עובד.

ההגדרה מאפשרת **רק קריאה (GET/HEAD) מהדומיין של האתר** — היא לא פותחת את הקבצים לאף אחד;
ההרשאות עצמן ממשיכות להיאכף ע"י storage.rules.
