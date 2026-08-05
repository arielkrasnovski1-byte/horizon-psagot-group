/* ============================================================
   הורייזון פסגות גרופ — firebase-config.js
   ------------------------------------------------------------
   הדביקו כאן את פרטי הפרויקט מ-Firebase:
   Firebase Console → Project settings → General → Your apps → Web app → Config
   כל עוד הערכים "REPLACE_ME" — הטופס ממשיך לשלוח מייל כרגיל (Web3Forms),
   וברגע שתמלאו — כל פנייה תיכתב גם ל-CRM ב-/crm.
   ============================================================ */
export const firebaseConfig = {
  apiKey:            "AIzaSyDcVepmWtFaSLhHylQIuxvoHTZWdSyOAsk",
  authDomain:        "horizon-psagot-group-ccbe6.firebaseapp.com",
  projectId:         "horizon-psagot-group-ccbe6",
  storageBucket:     "horizon-psagot-group-ccbe6.firebasestorage.app",
  messagingSenderId: "579496667206",
  appId:             "1:579496667206:web:ab5b247bb582153d070247",
  measurementId:     "G-49Y3FBJ101"
};

export const isConfigured =
  !!firebaseConfig.apiKey && firebaseConfig.apiKey !== "REPLACE_ME";
