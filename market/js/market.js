/* ============================================================
   HORIZON MARKET — market.js
   כרטיסי נכס חיים (CoinGecko, ללא מפתח) + sparklines מצוירים
   ============================================================ */
(function () {
  'use strict';
  var host = document.getElementById('market-quotes');
  if (!host) return;

  var COINS = [
    { id: 'bitcoin',  name: 'Bitcoin',  sym: 'BTC', logo: '₿' },
    { id: 'ethereum', name: 'Ethereum', sym: 'ETH', logo: 'Ξ' },
    { id: 'solana',   name: 'Solana',   sym: 'SOL', logo: '◎' },
    { id: 'ripple',   name: 'XRP',      sym: 'XRP', logo: '✕' }
  ];

  /* שלד טעינה */
  COINS.forEach(function (c) {
    var el = document.createElement('div');
    el.className = 'quote-card loading';
    el.setAttribute('data-id', c.id);
    el.innerHTML =
      '<div class="q-head">' +
        '<span class="q-logo">' + c.logo + '</span>' +
        '<span class="q-meta"><span class="q-name">' + c.name + '</span>' +
        '<span class="q-sym">' + c.sym + '/USD</span></span>' +
      '</div>' +
      '<div class="q-spark"><svg viewBox="0 0 100 42" preserveAspectRatio="none"></svg></div>' +
      '<div class="q-foot"><span class="q-price">—</span><span class="q-chg flat">—</span></div>';
    host.appendChild(el);
  });

  function fmtPrice(p) {
    if (p >= 1000) return '$' + p.toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (p >= 1)    return '$' + p.toLocaleString('en-US', { maximumFractionDigits: 2 });
    return '$' + p.toLocaleString('en-US', { maximumFractionDigits: 4 });
  }

  function cssVar(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name);
    return (v && v.trim()) || fallback;
  }

  function sparkPath(prices, w, h) {
    if (!prices || prices.length < 2) return { line: '', area: '' };
    var min = Math.min.apply(null, prices), max = Math.max.apply(null, prices);
    var range = (max - min) || 1, n = prices.length, pts = [];
    for (var i = 0; i < n; i++) {
      var x = (i / (n - 1)) * w;
      var y = h - ((prices[i] - min) / range) * (h - 4) - 2;
      pts.push([x, y]);
    }
    var line = 'M' + pts.map(function (p) { return p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' L');
    var area = line + ' L' + w + ' ' + h + ' L0 ' + h + ' Z';
    return { line: line, area: area };
  }

  function render(data) {
    var upC = cssVar('--up', '#16C784');
    var downC = cssVar('--down', '#EA3943');
    var mutedC = cssVar('--text-muted', '#5E6B85');

    data.forEach(function (coin) {
      var card = host.querySelector('[data-id="' + coin.id + '"]');
      if (!card) return;
      card.classList.remove('loading');

      var chg = coin.price_change_percentage_24h || 0;
      var dir = chg > 0.001 ? 'up' : (chg < -0.001 ? 'down' : 'flat');
      var color = dir === 'up' ? upC : dir === 'down' ? downC : mutedC;

      card.querySelector('.q-price').textContent = fmtPrice(coin.current_price);

      var chgEl = card.querySelector('.q-chg');
      chgEl.className = 'q-chg ' + dir;
      chgEl.textContent = (chg > 0 ? '+' : '') + chg.toFixed(2) + '%';

      var prices = (coin.sparkline_in_7d && coin.sparkline_in_7d.price) || [];
      if (prices.length > 48) {
        var step = Math.ceil(prices.length / 48), ds = [];
        for (var i = 0; i < prices.length; i += step) ds.push(prices[i]);
        prices = ds;
      }
      var p = sparkPath(prices, 100, 42);
      var gid = 'grad_' + coin.id;
      var svg = card.querySelector('.q-spark svg');
      svg.innerHTML =
        '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="' + color + '" stop-opacity="0.30"/>' +
          '<stop offset="1" stop-color="' + color + '" stop-opacity="0"/>' +
        '</linearGradient></defs>' +
        (p.area ? '<path d="' + p.area + '" fill="url(#' + gid + ')"/>' : '') +
        (p.line ? '<path d="' + p.line + '" fill="none" stroke="' + color + '" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>' : '');
    });
  }

  var url = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=' +
            COINS.map(function (c) { return c.id; }).join(',') +
            '&order=market_cap_desc&sparkline=true&price_change_percentage=24h';

  fetch(url, { headers: { accept: 'application/json' } })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(render)
    .catch(function (err) {
      // כשל טעינה — מסירים את מצב השלד כדי שלא ייתקע
      var cards = host.querySelectorAll('.quote-card');
      for (var i = 0; i < cards.length; i++) cards[i].classList.remove('loading');
      if (window.console) console.warn('Live market data unavailable:', err);
    });
})();
