/* Horizon Market — מחשבון ריבית דריבית (המחשה בלבד) */
(function () {
  var box = document.getElementById('calc'); if (!box) return;
  var $ = function (id) { return document.getElementById(id); };
  var fmt = function (n) { return '₪' + Math.round(n).toLocaleString('en-US'); };
  var NS = 'http://www.w3.org/2000/svg';
  function num(id, max) { var v = parseFloat($(id).value); if (!isFinite(v) || v < 0) v = 0; return Math.min(v, max); }
  function draw() {
    var init = num('c-init', 1e9), mon = num('c-mon', 1e7), yrs = Math.max(1, Math.round(num('c-yrs', 40))), rate = num('c-rate', 12) / 100;
    $('o-yrs').textContent = yrs; $('o-rate').textContent = (rate * 100).toFixed(1).replace('.0', '');
    var rm = Math.pow(1 + rate, 1 / 12) - 1, val = init, dep = init, vals = [init], deps = [init];
    for (var m = 1; m <= yrs * 12; m++) { val = val * (1 + rm) + mon; dep += mon; if (m % 12 === 0) { vals.push(val); deps.push(dep); } }
    $('r-dep').textContent = fmt(dep); $('r-fin').textContent = fmt(val); $('r-gain').textContent = fmt(val - dep);
    var svg = $('c-svg'), W = 640, H = 260, pl = 8, pr = 8, pt = 14, pb = 26, max = Math.max(val, dep, 1);
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var x = function (i) { return pl + (W - pl - pr) * i / yrs; }, y = function (v) { return pt + (H - pt - pb) * (1 - v / max); };
    function path(arr, close) { var d = arr.map(function (v, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); }).join(' '); return close ? d + ' L' + x(yrs) + ' ' + y(0) + ' L' + x(0) + ' ' + y(0) + ' Z' : d; }
    function el(tag, a) { var n = document.createElementNS(NS, tag); for (var k in a) n.setAttribute(k, a[k]); svg.appendChild(n); return n; }
    for (var g = 0; g <= 4; g++) el('line', { x1: pl, x2: W - pr, y1: y(max * g / 4), y2: y(max * g / 4), stroke: 'rgba(255,255,255,.07)', 'stroke-width': 1 });
    el('path', { d: path(vals, true), fill: 'rgba(22,227,155,.16)' });
    el('path', { d: path(deps, true), fill: 'rgba(124,108,255,.18)' });
    el('path', { d: path(vals), fill: 'none', stroke: '#16E39B', 'stroke-width': 2.5, 'stroke-linejoin': 'round' });
    el('path', { d: path(deps), fill: 'none', stroke: '#9A8CFF', 'stroke-width': 2, 'stroke-dasharray': '5 4' });
    var step = yrs <= 10 ? 1 : yrs <= 20 ? 5 : 10;
    for (var i = 0; i <= yrs; i += step) { var t = el('text', { x: x(i), y: H - 8, fill: '#97A3BC', 'font-size': 12, 'text-anchor': 'middle', direction: 'ltr' }); t.textContent = i === 0 ? '0' : i; }
  }
  ['c-init', 'c-mon', 'c-yrs', 'c-rate'].forEach(function (id) { $(id).addEventListener('input', draw); });
  draw();
})();
