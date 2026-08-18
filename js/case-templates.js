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

// מסמכים נוספים ללקוח שהוא בעל עסק — משותף לרוב סוגי השירות.
const BIZ_DOCS = [
  { key: 'biz_bank',   label: 'תדפיסי חשבון בנק עסקי' },
  { key: 'income',     label: 'דוח הכנסות' },
  { key: 'accountant', label: 'מסמכי רואה חשבון' },
  { key: 'tax_assess', label: 'שומת מס' },
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

  recovery: {
    stage1: [
      { key: 'id',        label: 'תעודת זהות' },
      { key: 'bank6',     label: 'תדפיסי חשבון בנק — 6 חודשים אחרונים' },
      { key: 'balances',  label: 'ריכוז יתרות והלוואות' },
      { key: 'payslips',  label: 'תלושי שכר — 3 חודשים אחרונים' },
      { key: 'bdi',       label: 'דוח נתוני אשראי (BDI)' },
      { key: 'expenses',  label: 'פירוט הוצאות קבועות' },
    ],
    business: BIZ_DOCS,
    stage2: [
      { key: 'plan',      label: 'תוכנית הבראה חתומה' },
      { key: 'clearance', label: 'אישורי סגירת חובות' },
    ],
  },

  debt: {
    stage1: [
      { key: 'id',        label: 'תעודת זהות' },
      { key: 'creditors', label: 'ריכוז חובות ונושים' },
      { key: 'demands',   label: 'מכתבי דרישה / עיקולים' },
      { key: 'bank6',     label: 'תדפיסי חשבון בנק — 6 חודשים אחרונים' },
      { key: 'bdi',       label: 'דוח נתוני אשראי (BDI)' },
      { key: 'hotzaa',    label: 'תיק הוצאה לפועל (אם קיים)' },
    ],
    business: BIZ_DOCS,
    stage2: [
      { key: 'settlement', label: 'הסכמי פשרה' },
      { key: 'payments',   label: 'אישורי תשלום' },
    ],
  },

  business: {
    stage1: [
      { key: 'id',        label: 'תעודת זהות + תעודת עוסק / ח.פ' },
      { key: 'financials',label: 'מאזן ודוח רווח והפסד שנתי' },
      { key: 'biz_bank',  label: 'תדפיסי חשבון בנק עסקי — 6 חודשים אחרונים' },
      { key: 'vat',       label: 'דוח מע"מ אחרון' },
      { key: 'liabilities', label: 'פירוט התחייבויות' },
    ],
    business: [],
    stage2: [
      { key: 'bizplan',   label: 'תוכנית עסקית' },
      { key: 'cashflow',  label: 'תחזית תזרים' },
    ],
  },

  re_israel: {
    stage1: [
      { key: 'id',        label: 'תעודת זהות' },
      { key: 'equity',    label: 'אישור הון עצמי / תדפיסי בנק' },
      { key: 'tabu',      label: 'נסח טאבו (אם קיים נכס)' },
      { key: 'approval',  label: 'אישור עקרוני למשכנתא' },
      { key: 'payslips',  label: 'תלושי שכר — 3 חודשים אחרונים' },
    ],
    business: BIZ_DOCS,
    stage2: [
      { key: 'contract',  label: 'זיכרון דברים / חוזה' },
      { key: 'appraisal', label: 'שמאות' },
      { key: 'poa',       label: 'ייפוי כוח' },
    ],
  },

  re_abroad: {
    stage1: [
      { key: 'id',        label: 'תעודת זהות + דרכון' },
      { key: 'source',    label: 'אישור מקור כספים' },
      { key: 'bank',      label: 'תדפיסי חשבון בנק — 3 חודשים אחרונים' },
      { key: 'tax',       label: 'אישור ניכוי מס / תושבות' },
    ],
    business: BIZ_DOCS,
    stage2: [
      { key: 'contract',  label: 'חוזה רכישה' },
      { key: 'poa',       label: 'ייפוי כוח נוטריוני' },
      { key: 'foreign_bank', label: 'פתיחת חשבון בנק זר' },
    ],
  },

  urban: {
    stage1: [
      { key: 'id',        label: 'תעודת זהות' },
      { key: 'tabu',      label: 'נסח טאבו' },
      { key: 'ownership', label: 'הסכם בעלות / צו ירושה' },
      { key: 'rent',      label: 'חוזה שכירות (אם הנכס מושכר)' },
      { key: 'vaad',      label: 'אישור ועד הבית / היזם' },
    ],
    business: BIZ_DOCS,
    stage2: [
      { key: 'developer', label: 'הסכם חתום מול היזם' },
      { key: 'guarantees',label: 'ערבויות' },
      { key: 'poa',       label: 'ייפוי כוח' },
    ],
  },
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
