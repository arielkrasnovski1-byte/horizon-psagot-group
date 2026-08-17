/* ============================================================
   case-templates.js — הגדרת סוגי השירות ותבניות המסמכים
   משותף לפורטל הלקוחות (/portal) ולמערכת הצוות (/crm).
   כל תבנית: stage1 (מסמכים ראשוניים) · business (נוסף לבעלי עסק) · stage2 (בהמשך).
   ============================================================ */

export const SERVICE_TYPES = [
  { key: 'mortgage',   label: 'פתרונות מימון ומשכנתאות', cat: 'פיננסי' },
  { key: 'recovery',   label: 'ליווי והבראה פיננסית',      cat: 'פיננסי' },
  { key: 'debt',       label: 'ניהול חוב והתנהלות מול נושים', cat: 'פיננסי' },
  { key: 'business',   label: 'ייעוץ עסקי ואסטרטגיה לצמיחה', cat: 'פיננסי' },
  { key: 're_israel',  label: 'נדל"ן והשקעות בישראל',       cat: 'נדל"ן' },
  { key: 're_abroad',  label: 'השקעות נדל"ן בחו"ל',          cat: 'נדל"ן' },
  { key: 'urban',      label: 'התחדשות עירונית',            cat: 'נדל"ן' },
];

// תבנית מסמכים לכל סוג שירות. כרגע מפורט: mortgage. השאר — שלד ריק להשלמה.
export const TEMPLATES = {
  mortgage: {
    stage1: [
      { key: 'id',        label: 'תעודת זהות' },
      { key: 'tabu',      label: 'נסח טאבו' },
      { key: 'payslips',  label: 'תלושי שכר — 3 חודשים אחרונים' },
      { key: 'bank',      label: 'תדפיסי חשבון בנק — 3 חודשים אחרונים' },
      { key: 'balances',  label: 'ריכוז יתרות' },
    ],
    business: [
      { key: 'biz_bank',   label: 'תדפיסי חשבון בנק עסקי' },
      { key: 'income',     label: 'דוח הכנסות' },
      { key: 'accountant', label: 'מסמכי רואה חשבון' },
      { key: 'tax',        label: 'שומת מס' },
    ],
    stage2: [
      { key: 'appraisal',  label: 'שמאות' },
      { key: 'signatures', label: 'חתימות' },
      { key: 'poa',        label: 'ייפוי כוח' },
      { key: 'credit',     label: 'דוח נתוני אשראי' },
    ],
  },
  // recovery / debt / business / re_israel / re_abroad / urban — יוגדרו בהמשך
};

export function serviceLabel(key) {
  const s = SERVICE_TYPES.find((x) => x.key === key);
  return s ? s.label : key;
}

// בונה את רשימת פריטי המסמכים לתיק לפי סוג שירות + האם בעל עסק.
// כל פריט: { key, label, stage, status:'pending', files:[] }
export function buildItems(serviceKey, isBusiness) {
  const t = TEMPLATES[serviceKey] || { stage1: [], business: [], stage2: [] };
  const items = [];
  (t.stage1 || []).forEach((d) => items.push({ key: d.key, label: d.label, stage: 1 }));
  if (isBusiness) (t.business || []).forEach((d) => items.push({ key: d.key, label: d.label, stage: 1 }));
  (t.stage2 || []).forEach((d) => items.push({ key: d.key, label: d.label, stage: 2 }));
  return items.map((it) => ({ ...it, status: 'pending', files: [] }));
}
