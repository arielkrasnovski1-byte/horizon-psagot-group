/* ============================================================
   HORIZON MARKET — news.js
   דוחות קרובים (Earnings) + הנפקות (IPOs) דרך Finnhub
   ------------------------------------------------------------
   כדי להפעיל: הירשמו חינם ב-https://finnhub.io , העתיקו את
   ה-API key, והדביקו אותו בשורה FINNHUB_TOKEN למטה. זהו.
   ============================================================ */
(function () {
  'use strict';

  var FINNHUB_TOKEN = 'd9jq3fpr01qr77bno630d9jq3fpr01qr77bno63g'; // מפתח API חינמי של Finnhub

  var earningsHost = document.getElementById('earnings-feed');
  var ipoHost = document.getElementById('ipo-feed');
  if (!earningsHost && !ipoHost) return;

  var isEN = (document.documentElement.lang || 'he').toLowerCase().indexOf('en') === 0;
  var T = isEN ? {
    needKey: 'To show live upcoming earnings & IPOs, add a free Finnhub API key in js/news.js.',
    none: 'No items in the selected range.',
    error: 'Couldn’t load data right now.',
    soon: 'Coming soon'
  } : {
    needKey: 'להצגת דוחות והנפקות חיים — יש להוסיף מפתח API חינמי של Finnhub בקובץ js/news.js.',
    none: 'אין פריטים בטווח הנבחר.',
    error: 'לא ניתן לטעון נתונים כרגע.',
    soon: 'בקרוב'
  };

  function empty(host, msg) {
    host.innerHTML = '<div class="feed-empty"><span class="badge badge-accent">' + T.soon + '</span><p>' + msg + '</p></div>';
  }
  function loading(host) { host.innerHTML = '<div class="feed-loading">…</div>'; }

  function fmtDate(d) {
    if (!d) return '';
    var p = String(d).split('-');
    return p.length === 3 ? p[2] + '/' + p[1] : d;
  }
  function iso(dt) { return dt.toISOString().slice(0, 10); }
  function range(days) {
    var now = new Date();
    return { from: iso(now), to: iso(new Date(now.getTime() + days * 86400000)) };
  }

  if (!FINNHUB_TOKEN) {
    if (earningsHost) empty(earningsHost, T.needKey);
    if (ipoHost) empty(ipoHost, T.needKey);
    return;
  }

  var r = range(21);

  if (earningsHost) {
    loading(earningsHost);
    fetch('https://finnhub.io/api/v1/calendar/earnings?from=' + r.from + '&to=' + r.to + '&token=' + FINNHUB_TOKEN)
      .then(function (res) { if (!res.ok) throw 0; return res.json(); })
      .then(function (data) {
        var list = (data.earningsCalendar || []).filter(function (e) { return e.symbol; }).slice(0, 30);
        if (!list.length) { empty(earningsHost, T.none); return; }
        var hourMap = isEN
          ? { bmo: 'Before open', amc: 'After close', dmh: 'During market' }
          : { bmo: 'לפני הפתיחה', amc: 'אחרי הסגירה', dmh: 'במהלך המסחר' };
        earningsHost.innerHTML = list.map(function (e) {
          var hour = hourMap[e.hour] || '';
          var est = (e.epsEstimate != null) ? 'EPS ~' + e.epsEstimate : (isEN ? 'Estimate n/a' : 'ללא תחזית');
          return '<div class="feed-row"><span class="feed-date">' + fmtDate(e.date) + '</span>' +
                 '<span class="feed-main"><span class="feed-sym">' + e.symbol + '</span>' +
                 (hour ? '<span class="feed-name">' + hour + '</span>' : '') + '</span>' +
                 '<span class="feed-extra">' + est + '</span></div>';
        }).join('');
      })
      .catch(function () { empty(earningsHost, T.error); });
  }

  if (ipoHost) {
    loading(ipoHost);
    fetch('https://finnhub.io/api/v1/calendar/ipo?from=' + r.from + '&to=' + r.to + '&token=' + FINNHUB_TOKEN)
      .then(function (res) { if (!res.ok) throw 0; return res.json(); })
      .then(function (data) {
        var list = (data.ipoCalendar || []).slice(0, 30);
        if (!list.length) { empty(ipoHost, T.none); return; }
        ipoHost.innerHTML = list.map(function (i) {
          var price = i.price ? '$' + i.price : '';
          var name = (i.name || '').replace(/</g, '');
          return '<div class="feed-row"><span class="feed-date">' + fmtDate(i.date) + '</span>' +
                 '<span class="feed-main"><span class="feed-sym">' + (i.symbol || '—') + '</span>' +
                 '<span class="feed-name">' + name + '</span></span>' +
                 '<span class="feed-extra">' + (i.exchange || '') + (price ? ' · ' + price : '') + '</span></div>';
        }).join('');
      })
      .catch(function () { empty(ipoHost, T.error); });
  }
})();
