/* ============================================================
   Desk — המרת מסמכים
   תמונות (וגם קובצי PDF קיימים) → PDF: קובץ אחד משותף או קובץ נפרד לכל מסמך.
   הכול נעשה בדפדפן של המשתמש — שום קובץ לא עולה לשרת ולא נשמר במערכת.
   ============================================================ */
export function initConvert(ctx) {
  const { $, esc, loadJSZip } = ctx;
  const A4 = [595.28, 841.89];
  const QUALITY = { normal: { max: 1800, q: 0.8 }, high: { max: 2800, q: 0.92 } };

  let items = [];      // { id, file, kind: 'img'|'pdf', name (ללא סיומת), rot, thumb }
  let results = [];    // { name, blob, url }
  let failed = [];
  let seq = 0, busy = false, dragId = null;
  const opts = { mode: 'one', page: 'a4', quality: 'normal', name: '' };

  /* ---------- עזר ---------- */
  let pdfLibP = null;
  function loadPdfLib() {
    if (window.PDFLib) return Promise.resolve(window.PDFLib);
    if (!pdfLibP) pdfLibP = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js';
      s.onload = () => res(window.PDFLib);
      s.onerror = () => { pdfLibP = null; rej(new Error('טעינת ספריית ה-PDF נכשלה — בדקו את החיבור לאינטרנט ונסו שוב')); };
      document.head.appendChild(s);
    });
    return pdfLibP;
  }
  const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
  const isImg = (f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(f.name);
  const baseName = (n) => String(n || '').replace(/\.[a-z0-9]{2,5}$/i, '');
  const safeName = (n) => String(n || '').replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  const fmtSize = (b) => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
  const today = () => { const d = new Date(); const p = (x) => String(x).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };
  const defaultName = () => items.length === 1 ? (safeName(items[0].name) || 'מסמך') : 'מסמכים ' + today();
  const isOne = () => opts.mode === 'one' || items.length === 1;
  const say = (t) => { const el = $('cv-status'); if (el) { el.textContent = t || ''; el.hidden = !t; } };

  function clearResults() {
    results.forEach((r) => { try { URL.revokeObjectURL(r.url); } catch (e) {} });
    results = []; failed = [];
  }

  /* ---------- הוספת קבצים ---------- */
  function addFiles(list) {
    const skipped = [];
    Array.from(list || []).forEach((f) => {
      const kind = isPdf(f) ? 'pdf' : (isImg(f) ? 'img' : '');
      if (!kind) { skipped.push(f.name); return; }
      items.push({ id: 'cv' + (++seq), file: f, kind, name: baseName(f.name), rot: 0, thumb: kind === 'img' ? URL.createObjectURL(f) : '' });
    });
    clearResults();
    render();
    if (skipped.length) say('קבצים שאינם תמונה או PDF לא נוספו: ' + skipped.join(', '));
  }
  function removeItem(id) {
    const i = items.findIndex((x) => x.id === id); if (i < 0) return;
    if (items[i].thumb) URL.revokeObjectURL(items[i].thumb);
    items.splice(i, 1);
  }
  function clearAll() {
    items.forEach((it) => { if (it.thumb) URL.revokeObjectURL(it.thumb); });
    items = []; opts.name = ''; clearResults(); render();
  }

  /* ---------- תמונה → JPEG (מתקן כיוון צילום, מסובב, מקטין תמונות ענק) ---------- */
  async function decode(file) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { /* ננסה דרך <img> */ }
    }
    return await new Promise((res, rej) => {
      const u = URL.createObjectURL(file); const im = new Image();
      im.onload = () => { URL.revokeObjectURL(u); res(im); };
      im.onerror = () => { URL.revokeObjectURL(u); rej(new Error('הדפדפן לא מצליח לקרוא את התמונה')); };
      im.src = u;
    });
  }
  async function imageToJpeg(it) {
    const src = await decode(it.file);
    const sw = src.naturalWidth || src.width, sh = src.naturalHeight || src.height;
    if (!sw || !sh) throw new Error('תמונה ריקה');
    const { max, q } = QUALITY[opts.quality] || QUALITY.normal;
    const k = Math.min(1, max / Math.max(sw, sh));
    const w = Math.round(sw * k), h = Math.round(sh * k);
    const turned = it.rot === 90 || it.rot === 270;
    const c = document.createElement('canvas');
    c.width = turned ? h : w; c.height = turned ? w : h;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.translate(c.width / 2, c.height / 2); g.rotate(it.rot * Math.PI / 180);
    g.drawImage(src, -w / 2, -h / 2, w, h);
    if (src.close) src.close();
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', q));
    if (!blob) throw new Error('עיבוד התמונה נכשל');
    return { bytes: await blob.arrayBuffer(), w: c.width, h: c.height };
  }

  async function addItemToDoc(PDFDocument, doc, it) {
    if (it.kind === 'pdf') {
      const src = await PDFDocument.load(await it.file.arrayBuffer());
      const pages = await doc.copyPages(src, src.getPageIndices());
      pages.forEach((p) => doc.addPage(p));
      return;
    }
    const { bytes, w, h } = await imageToJpeg(it);
    const img = await doc.embedJpg(bytes);
    const land = w > h;
    if (opts.page === 'fit') {
      const pw = land ? A4[1] : A4[0], ph = pw * h / w;
      doc.addPage([pw, ph]).drawImage(img, { x: 0, y: 0, width: pw, height: ph });
    } else {
      const pw = land ? A4[1] : A4[0], ph = land ? A4[0] : A4[1], m = 18;
      const s = Math.min((pw - 2 * m) / w, (ph - 2 * m) / h);
      const dw = w * s, dh = h * s;
      doc.addPage([pw, ph]).drawImage(img, { x: (pw - dw) / 2, y: (ph - dh) / 2, width: dw, height: dh });
    }
  }
  const docBlob = async (doc) => new Blob([await doc.save()], { type: 'application/pdf' });

  /* ---------- המרה ---------- */
  async function convert() {
    if (busy || !items.length) return;
    busy = true; clearResults(); render(); say('מכין…');
    try {
      const { PDFDocument } = await loadPdfLib();
      const one = isOne(), used = new Set(), out = [];
      const uniq = (n) => { let x = n || 'מסמך', i = 2; while (used.has(x)) x = n + ' (' + (i++) + ')'; used.add(x); return x; };
      const merged = one ? await PDFDocument.create() : null;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        say('מעבד ' + (i + 1) + ' מתוך ' + items.length + '…');
        try {
          if (one) { await addItemToDoc(PDFDocument, merged, it); continue; }
          const name = uniq(safeName(it.name)) + '.pdf';
          if (it.kind === 'pdf') { out.push({ name, blob: it.file }); continue; }   // כבר PDF — נשאר כמו שהוא
          const d = await PDFDocument.create();
          await addItemToDoc(PDFDocument, d, it);
          out.push({ name, blob: await docBlob(d) });
        } catch (e) {
          console.error('convert', it.file.name, e);
          failed.push(it.file.name + (it.kind === 'pdf' ? ' (קובץ מוגן או פגום)' : ' (פורמט שהדפדפן לא קורא)'));
        }
      }
      if (one && merged.getPageCount()) out.push({ name: (safeName(opts.name) || defaultName()) + '.pdf', blob: await docBlob(merged), pages: merged.getPageCount() });
      results = out.map((r) => Object.assign(r, { url: URL.createObjectURL(r.blob) }));
      busy = false; render();
      if (results.length === 1) download(results[0]);
    } catch (e) {
      console.error(e); busy = false; render(); say('ההמרה נכשלה: ' + (e.message || e));
    }
  }
  function download(r) {
    const a = document.createElement('a'); a.href = r.url; a.download = r.name;
    document.body.appendChild(a); a.click(); a.remove();
  }
  async function downloadZip() {
    try {
      say('אורז ל-ZIP…');
      const JSZip = await loadJSZip(); const zip = new JSZip();
      results.forEach((r) => zip.file(r.name, r.blob));
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      download({ url, name: 'מסמכים ' + today() + '.zip' });
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      say('');
    } catch (e) { say('יצירת ה-ZIP נכשלה: ' + (e.message || e)); }
  }

  /* ---------- תצוגה ---------- */
  function cardHTML(it, i) {
    const one = isOne();
    const thumb = it.kind === 'pdf'
      ? '<div class="cv-thumb cv-thumb-pdf">PDF</div>'
      : '<div class="cv-thumb"><img src="' + it.thumb + '" alt="" style="transform:rotate(' + it.rot + 'deg)" draggable="false"></div>';
    const name = (!one)
      ? '<input class="cv-name" data-name="' + it.id + '" value="' + esc(it.name) + '" title="שם הקובץ שייווצר" aria-label="שם הקובץ">'
      : '<div class="cv-name-txt" title="' + esc(it.file.name) + '">' + esc(it.file.name) + '</div>';
    return '<div class="cv-card" draggable="true" data-id="' + it.id + '">' +
      '<span class="cv-num">' + (i + 1) + '</span>' + thumb + name +
      '<div class="cv-card-actions">' +
        '<button type="button" data-act="up" data-id="' + it.id + '" title="הזזה קדימה"' + (i === 0 ? ' disabled' : '') + '>→</button>' +
        '<button type="button" data-act="down" data-id="' + it.id + '" title="הזזה אחורה"' + (i === items.length - 1 ? ' disabled' : '') + '>←</button>' +
        (it.kind === 'img' ? '<button type="button" data-act="rot" data-id="' + it.id + '" title="סיבוב 90°">⟳</button>' : '') +
        '<button type="button" data-act="del" data-id="' + it.id + '" title="הסרה" class="cv-del">✕</button>' +
      '</div></div>';
  }
  function render() {
    const body = $('cv-body'); if (!body) return;
    if (!items.length) { body.innerHTML = ''; return; }
    const n = items.length, one = isOne();
    const modeHTML = n > 1
      ? '<div class="cv-modes">' +
          '<label class="cv-mode' + (opts.mode === 'one' ? ' on' : '') + '"><input type="radio" name="cv-mode" value="one"' + (opts.mode === 'one' ? ' checked' : '') + '><b>קובץ אחד משותף</b><span>כל ' + n + ' המסמכים בקובץ אחד, לפי הסדר שלמעלה</span></label>' +
          '<label class="cv-mode' + (opts.mode === 'sep' ? ' on' : '') + '"><input type="radio" name="cv-mode" value="sep"' + (opts.mode === 'sep' ? ' checked' : '') + '><b>קובץ נפרד לכל מסמך</b><span>' + n + ' קבצים נפרדים — אפשר לתת שם לכל אחד</span></label>' +
        '</div>'
      : '';
    const resHTML = results.length
      ? '<div class="cv-results"><div class="cv-results-head"><b>✅ ' + (results.length === 1 ? 'הקובץ מוכן' : results.length + ' קבצים מוכנים') + '</b>' +
          (results.length > 1 ? '<button type="button" class="crm-btn" style="width:auto" data-act="zip">⬇ הורדת כולם (ZIP)</button>' : '') + '</div>' +
          results.map((r, i) => '<div class="cv-res"><span class="cv-res-name">' + esc(r.name) + '</span><span class="cv-res-size">' + (r.pages ? r.pages + ' עמ׳ · ' : '') + fmtSize(r.blob.size) + '</span>' +
            '<a class="btn-ghost" href="' + r.url + '" target="_blank" rel="noopener">צפייה</a>' +
            '<button type="button" class="btn-ghost" data-act="dl" data-i="' + i + '">⬇ הורדה</button></div>').join('') +
        '</div>'
      : '';
    const failHTML = failed.length ? '<div class="cv-fail">לא הומרו: ' + failed.map(esc).join(' · ') + '</div>' : '';
    body.innerHTML =
      '<div class="cv-list-head"><b>' + n + (n === 1 ? ' מסמך' : ' מסמכים') + '</b><span>' + (n > 1 ? 'גררו כדי לשנות סדר' : '') + '</span>' +
        '<button type="button" class="btn-ghost" data-act="more">+ הוספת קבצים</button><button type="button" class="btn-ghost" data-act="clear">ניקוי הכול</button></div>' +
      '<div class="cv-list">' + items.map(cardHTML).join('') + '</div>' +
      modeHTML +
      '<div class="cv-opts">' +
        (one ? '<label class="cv-opt cv-opt-name">שם הקובץ<input id="cv-outname" value="' + esc(opts.name) + '" placeholder="' + esc(defaultName()) + '"></label>' : '') +
        '<label class="cv-opt">גודל עמוד<select id="cv-page"><option value="a4"' + (opts.page === 'a4' ? ' selected' : '') + '>A4 (מומלץ להדפסה)</option><option value="fit"' + (opts.page === 'fit' ? ' selected' : '') + '>לפי התמונה, בלי שוליים</option></select></label>' +
        '<label class="cv-opt">איכות<select id="cv-quality"><option value="normal"' + (opts.quality === 'normal' ? ' selected' : '') + '>רגילה — קובץ קל</option><option value="high"' + (opts.quality === 'high' ? ' selected' : '') + '>גבוהה — קובץ כבד יותר</option></select></label>' +
      '</div>' +
      '<div class="cv-go"><button type="button" class="crm-btn" style="width:auto" data-act="go"' + (busy ? ' disabled' : '') + '>' + (busy ? 'ממיר…' : (one ? 'המרה ל-PDF' : 'המרה ל-' + n + ' קובצי PDF')) + '</button>' +
        '<span class="cv-status" id="cv-status" hidden></span></div>' +
      failHTML + resHTML;
  }

  /* ---------- אירועים ---------- */
  const drop = $('cv-drop'), input = $('cv-files'), body = $('cv-body');
  if (!drop || !input || !body) return { addFiles, convert };
  drop.addEventListener('click', (e) => { if (e.target !== input) input.click(); });
  input.addEventListener('change', () => { addFiles(input.files); input.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => { if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });

  body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b || busy) return;
    const act = b.dataset.act, id = b.dataset.id, i = items.findIndex((x) => x.id === id);
    if (act === 'go') return convert();
    if (act === 'zip') return downloadZip();
    if (act === 'dl') { const r = results[+b.dataset.i]; if (r) download(r); return; }
    if (act === 'more') return input.click();
    if (act === 'clear') return clearAll();
    if (i < 0) return;
    if (act === 'del') removeItem(id);
    else if (act === 'rot') items[i].rot = (items[i].rot + 90) % 360;
    else if (act === 'up' && i > 0) items.splice(i - 1, 0, items.splice(i, 1)[0]);
    else if (act === 'down' && i < items.length - 1) items.splice(i + 1, 0, items.splice(i, 1)[0]);
    clearResults(); render();
  });
  body.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'cv-outname') opts.name = t.value;
    else if (t.dataset && t.dataset.name) { const it = items.find((x) => x.id === t.dataset.name); if (it) it.name = t.value; }
  });
  body.addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'cv-mode') { opts.mode = t.value; clearResults(); render(); }
    else if (t.id === 'cv-page') { opts.page = t.value; clearResults(); render(); }
    else if (t.id === 'cv-quality') { opts.quality = t.value; clearResults(); render(); }
  });
  // שינוי סדר בגרירה
  body.addEventListener('dragstart', (e) => {
    const c = e.target.closest && e.target.closest('.cv-card');
    if (!c || (e.target.matches && e.target.matches('input'))) return;
    dragId = c.dataset.id; e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', dragId); } catch (err) {}
    c.classList.add('dragging');
  });
  body.addEventListener('dragover', (e) => { if (dragId && e.target.closest('.cv-card')) e.preventDefault(); });
  body.addEventListener('drop', (e) => {
    const c = e.target.closest('.cv-card'); if (!dragId || !c) return;
    e.preventDefault();
    const from = items.findIndex((x) => x.id === dragId), to = items.findIndex((x) => x.id === c.dataset.id);
    dragId = null;
    if (from < 0 || to < 0 || from === to) return render();
    items.splice(to, 0, items.splice(from, 1)[0]);
    clearResults(); render();
  });
  body.addEventListener('dragend', () => { dragId = null; body.querySelectorAll('.dragging').forEach((x) => x.classList.remove('dragging')); });

  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) window.__cvTest = { addFiles, convert, opts, items: () => items, results: () => results, failed: () => failed, render };
  return { addFiles, convert };
}
