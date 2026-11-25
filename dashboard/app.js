// Token Launch Radar — page logic. No network: every number comes from
// ../data.js, which main.ts writes from the sealed snapshot.
(function () {
  'use strict';
  var R = window.RADAR;
  if (!R) {
    document.getElementById('rows').innerHTML =
      '<tr><td colspan="8">Radar data (data.js) did not load.</td></tr>';
    return;
  }
  var rows = R.rows;
  var meta = R.meta;

  function money(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(n >= 1e10 ? 0 : 2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + Math.round(n);
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function growthCell(v) {
    if (v === null || v === undefined) return '<span>&mdash;</span>';
    var cls = v >= 0 ? 'pos' : 'neg';
    return '<span class="' + cls + '">' + (v >= 0 ? '+' : '') + v.toFixed(1) + '%</span>';
  }
  function ageCell(y) {
    if (y === null || y === undefined) return '<span>&mdash;</span>';
    return y.toFixed(1) + 'y';
  }

  // ---- header -------------------------------------------------------------
  document.getElementById('asof').textContent = 'SNAPSHOT ' + meta.as_of;
  document.getElementById('modeltext').textContent = meta.model;
  var watchN = rows.filter(function (r) { return r.on_watchlist; }).length;
  var top = rows[0];
  document.getElementById('stats').innerHTML =
    '<span class="chip"><b>' + rows.length + '</b> pre-token protocols ranked</span>' +
    '<span class="chip"><b>' + watchN + '</b> of ' + meta.watchlist_total + ' watchlist covered</span>' +
    '<span class="chip">Top: <b>' + esc(top.name) + '</b> &mdash; ' + money(top.implied_value_usd) + '</span>' +
    '<span class="chip">Global comp multiple <b>' + meta.global_multiple + 'x</b></span>' +
    '<span class="chip">Floor <b>' + money(meta.floor_usd) + '</b></span>';

  // ---- controls -----------------------------------------------------------
  var qEl = document.getElementById('q');
  var catEl = document.getElementById('cat');
  var scopeEl = document.getElementById('scope');
  var sortEl = document.getElementById('sort');
  var cats = [];
  rows.forEach(function (r) {
    var c = r.category || '(no category)';
    if (cats.indexOf(c) === -1) cats.push(c);
  });
  cats.sort();
  catEl.innerHTML = '<option value="">All categories</option>' +
    cats.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');

  function currentFilter() {
    return {
      q: qEl.value.trim().toLowerCase(),
      cat: catEl.value,
      scope: scopeEl.value,
      sort: sortEl.value,
    };
  }
  function applyFilter(f) {
    var list = rows.filter(function (r) {
      if (f.scope === 'watchlist' && !r.on_watchlist) return false;
      if (f.scope === 'below' && r.on_watchlist) return false;
      if (f.cat && (r.category || '(no category)') !== f.cat) return false;
      if (f.q && (r.name + ' ' + r.slug).toLowerCase().indexOf(f.q) === -1) return false;
      return true;
    });
    var key = f.sort;
    list = list.slice().sort(function (a, b) {
      if (key === 'tvl') return b.tvl_usd - a.tvl_usd;
      if (key === 'growth') return (b.change_7d || -1e9) - (a.change_7d || -1e9);
      if (key === 'age') return (b.age_years || 0) - (a.age_years || 0);
      return a.rank - b.rank;
    });
    return list;
  }

  var tbody = document.getElementById('rows');
  var countEl = document.getElementById('count');
  var emptyEl = document.getElementById('empty');
  var selectedSlug = null;

  function render() {
    var list = applyFilter(currentFilter());
    countEl.textContent = list.length + ' of ' + rows.length + ' shown';
    emptyEl.hidden = list.length !== 0;
    tbody.innerHTML = list.map(function (r) {
      var chains = r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '');
      return '<tr data-slug="' + esc(r.slug) + '"' + (r.slug === selectedSlug ? ' class="sel"' : '') + '>' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><b>' + esc(r.name) + '</b>' +
        (r.on_watchlist ? '<span class="badge">WATCHLIST</span>' : '') +
        '<br><span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + esc(chains) + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + growthCell(r.change_7d) + '</td>' +
        '<td class="num">' + ageCell(r.age_years) + '</td>' +
        '<td class="num"><b>' + money(r.implied_value_usd) + '</b></td>' +
        '</tr>';
    }).join('');
  }

  tbody.addEventListener('click', function (ev) {
    var tr = ev.target.closest('tr[data-slug]');
    if (tr) location.hash = '#/detail/' + tr.getAttribute('data-slug');
  });

  // ---- detail view --------------------------------------------------------
  var detailEl = document.getElementById('detail');
  function showDetail(slug) {
    var r = null;
    for (var i = 0; i < rows.length; i++) if (rows[i].slug === slug) { r = rows[i]; break; }
    selectedSlug = r ? r.slug : null;
    render();
    if (!r) { detailEl.hidden = true; return; }
    var math = money(r.tvl_usd) + ' TVL &times; ' + r.multiple.toFixed(3) + 'x multiple &times; ' +
      r.growth_factor.toFixed(3) + ' growth &times; ' + r.age_factor.toFixed(3) + ' age &times; ' +
      r.chain_factor.toFixed(3) + ' chains = <b>' + money(r.implied_value_usd) + '</b>';
    var comps = r.comparables.length ? r.comparables.map(function (c) {
      return '<tr><td>' + esc(c.name) + '</td><td class="num">' + money(c.tvl_usd) +
        '</td><td class="num">' + money(c.mcap_usd) + '</td><td class="num">' +
        c.multiple.toFixed(3) + 'x</td></tr>';
    }).join('') : '<tr><td colspan="4">No in-category token-bearing comparables; the global median was used.</td></tr>';
    detailEl.innerHTML =
      '<p class="back"><a href="#/">&#8592; Back to the full board</a></p>' +
      '<h2>' + esc(r.name) + (r.on_watchlist ? ' <span class="badge">WATCHLIST</span>' : '') + '</h2>' +
      '<p class="sub">Rank #' + r.rank + ' of ' + rows.length + ' &middot; ' + esc(r.slug) +
      ' &middot; ' + esc(r.category || 'no category') + ' &middot; ' + esc(r.chains.join(', ')) + '</p>' +
      '<dl class="facts">' +
      '<div><dt>TVL</dt><dd>' + money(r.tvl_usd) + '</dd></div>' +
      '<div><dt>7-day TVL change</dt><dd>' + (r.change_7d === null ? 'not reported' : growthCell(r.change_7d)) + '</dd></div>' +
      '<div><dt>Tracked since</dt><dd>' + (r.listed_at || 'not reported') + (r.age_years !== null ? ' (' + r.age_years.toFixed(1) + 'y)' : '') + '</dd></div>' +
      '<div><dt>Implied value</dt><dd>' + money(r.implied_value_usd) + '</dd></div>' +
      '</dl>' +
      '<h3>Why this value</h3>' +
      '<p class="math">' + math + '</p>' +
      '<p class="fine">Multiple basis: ' + esc(r.multiple_basis) + '. The growth factor uses the 7-day TVL change, ' +
      'the age factor the years listed with no token recorded, the chain factor the number of chains.</p>' +
      '<h3>Nearest comparables (token already trading)</h3>' +
      '<table><thead><tr><th>Protocol</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">Mcap / TVL</th></tr></thead>' +
      '<tbody>' + comps + '</tbody></table>' +
      '<h3>How to farm it</h3>' +
      '<ol class="steps">' + r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
    detailEl.hidden = false;
    detailEl.scrollIntoView({ block: 'start' });
  }

  // ---- comparables table --------------------------------------------------
  document.getElementById('comps').innerHTML = R.trading.slice(0, 15).map(function (t) {
    return '<tr><td><b>' + esc(t.name) + '</b><br><span class="slug">' + esc(t.slug) + '</span></td>' +
      '<td class="num">' + money(t.tvl_usd) + '</td>' +
      '<td class="num">' + money(t.mcap_usd) + '</td>' +
      '<td class="num">' + t.multiple.toFixed(3) + 'x</td></tr>';
  }).join('');

  // ---- hash routing (also drives the screenshots) -------------------------
  function route() {
    var h = location.hash || '';
    var m;
    if ((m = h.match(/^#\/detail\/(.+)$/))) { showDetail(decodeURIComponent(m[1])); return; }
    if ((m = h.match(/^#\/cat\/(.+)$/))) {
      catEl.value = decodeURIComponent(m[1]);
      selectedSlug = null; detailEl.hidden = true; render(); return;
    }
    if ((m = h.match(/^#\/q\/(.+)$/))) {
      qEl.value = decodeURIComponent(m[1]);
      selectedSlug = null; detailEl.hidden = true; render(); return;
    }
    if (h === '#/watchlist') {
      scopeEl.value = 'watchlist';
      selectedSlug = null; detailEl.hidden = true; render(); return;
    }
    selectedSlug = null; detailEl.hidden = true; render();
  }
  ['q', 'cat', 'scope', 'sort'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', render);
    document.getElementById(id).addEventListener('change', render);
  });
  window.addEventListener('hashchange', route);
  route();
})();
