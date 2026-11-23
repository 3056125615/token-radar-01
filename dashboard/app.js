(function () {
  'use strict';

  var R = window.RADAR;
  var snapLine = document.getElementById('snap-line');
  if (!R || !Array.isArray(R.rows)) {
    snapLine.textContent = 'Radar data is not loaded. Build the board so data.js sits next to the dashboard folder.';
    return;
  }

  var rows = R.rows;
  var model = R.model;
  var stats = R.stats;
  var funnel = R.funnel;
  var excluded = Array.isArray(R.excluded) ? R.excluded : [];
  var TOTAL = stats.selected;
  var state = { q: '', cat: '', chain: '', watch: false, min: 0, sort: 'rank', dir: 1 };
  var bySlug = Object.create(null);
  rows.forEach(function (row) { bySlug[row.slug] = row; });
  var maxImplied = rows.reduce(function (max, row) {
    return row.implied_value_usd > max ? row.implied_value_usd : max;
  }, 0) || 1;

  var listView = document.getElementById('list-view');
  var detailView = document.getElementById('detail-view');
  var tbody = document.getElementById('rows');
  var countEl = document.getElementById('count');
  var savedScroll = 0;

  function $(id) { return document.getElementById(id); }

  function esc(value) {
    return String(value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function fmtNum(value) { return Math.round(value).toLocaleString('en-US'); }
  function fmtUsdFull(value) { return '$' + fmtNum(value); }

  function fmtUsd(value) {
    if (value >= 1e9) return '$' + (value / 1e9).toFixed(2) + 'B';
    if (value >= 1e6) return '$' + (value / 1e6).toFixed(1) + 'M';
    if (value >= 1e3) return '$' + Math.round(value / 1e3) + 'K';
    return '$' + Math.round(value);
  }

  function fmtFloor(value) {
    if (value >= 1e6 && value % 1e6 === 0) return '$' + (value / 1e6) + 'M';
    return fmtUsd(value);
  }

  function fmtAge(days) {
    if (days === null) return 'unknown';
    return days >= 365 ? (days / 365).toFixed(1) + ' yr' : days + ' days';
  }

  function fmtAgeLong(days) {
    if (days === null) return 'unknown';
    return days + ' days (' + (days / 365).toFixed(1) + ' yr)';
  }

  function fmtChg(value) {
    if (value === null) return '—';
    return (value > 0 ? '+' : '') + value.toFixed(2) + '%';
  }

  function chgClass(value) {
    if (value === null || value === 0) return 'flat';
    return value > 0 ? 'up' : 'down';
  }

  function chainText(chains) {
    if (!chains.length) return '—';
    var head = chains.slice(0, 3).join(', ');
    return chains.length > 3 ? head + ' +' + (chains.length - 3) : head;
  }

  function fmtMultiple(value) { return '×' + value.toFixed(2); }

  var REASON_ORDER = ['CATEGORY_DERIVATIVE', 'PRODUCT_FORM', 'TOKEN_LINEAGE', 'EXCHANGE_BRAND'];
  var REASON_INFO = {
    CATEGORY_DERIVATIVE: {
      short: 'category derivative',
      tiny: 'category derivatives',
      rule: 'The category field marks a derivative venue (CEX, liquid staking/restaking, bridges).'
    },
    PRODUCT_FORM: {
      short: 'product form',
      tiny: 'product-form',
      rule: 'The name field itself declares a wrapped or staked product form.'
    },
    TOKEN_LINEAGE: {
      short: 'token lineage',
      tiny: 'lineage',
      rule: 'The name stem is identical to a token-bearing protocol in the same snapshot.'
    },
    EXCHANGE_BRAND: {
      short: 'exchange brand',
      tiny: 'exchange-brand',
      rule: 'The name opens with an exchange brand — an external common-knowledge rule, the only screen not derived from the snapshot.'
    }
  };

  function renderFunnel() {
    if (!funnel) {
      $('funnel').hidden = true;
      $('funnel-reasons').hidden = true;
      return;
    }
    var stages = [
      { value: funnel.snapshot, label: 'in snapshot', end: false },
      { value: funnel.tokenless, label: 'record no token', end: false },
      { value: funnel.excluded, label: 'set aside', end: false },
      { value: funnel.ranked, label: 'ranked', end: true }
    ];
    var total = funnel.snapshot > 0 ? funnel.snapshot : 1;
    var html = '';
    stages.forEach(function (stage, index) {
      if (index) html += '<div class="farrow" aria-hidden="true">→</div>';
      html += '<div class="fstage' + (stage.end ? ' end' : '') + '">' +
        '<b>' + fmtNum(stage.value) + '</b><span>' + stage.label + '</span>' +
        '<i class="fm" style="width:' + (stage.value / total * 100).toFixed(1) + '%"></i></div>';
    });
    $('funnel').innerHTML = html;
    $('funnel').setAttribute('aria-label', 'Funnel: ' + fmtNum(funnel.snapshot) + ' in snapshot, ' +
      fmtNum(funnel.tokenless) + ' record no token, ' + fmtNum(funnel.excluded) + ' set aside, ' +
      fmtNum(funnel.ranked) + ' ranked');
    var parts = REASON_ORDER.map(function (code) {
      return '<b>' + fmtNum((funnel.by_reason && funnel.by_reason[code]) || 0) + '</b> ' + REASON_INFO[code].tiny;
    });
    $('funnel-reasons').innerHTML = 'Set aside by first-hit reason: ' + parts.join(' · ');
  }

  function renderCoverage() {
    if (!funnel) {
      $('cover').hidden = true;
      return;
    }
    var html = '';
    REASON_ORDER.forEach(function (code) {
      var count = (funnel.by_reason && funnel.by_reason[code]) || 0;
      html += '<tr><td><code>' + code + '</code>' +
        (code === 'EXCHANGE_BRAND' ? '<span class="ext">external</span>' : '') +
        '</td><td class="num">' + fmtNum(count) + '</td><td>' + REASON_INFO[code].rule + '</td></tr>';
    });
    $('cov-body').innerHTML = html;
    $('ledger-btn').textContent = 'Show the ' + fmtNum(excluded.length) + '-row ledger';
  }

  // The board at a glance: every ranked row on log axes, drawn inline.
  var glancePlot = $('glance-plot');
  var glanceLegend = $('glance-legend');
  var glanceWidth = 0;
  var GLANCE_H = 320;

  function fmtTick(value) {
    if (value >= 1e9) return '$' + Math.round(value / 1e9) + 'B';
    if (value >= 1e6) return '$' + Math.round(value / 1e6) + 'M';
    return '$' + Math.round(value / 1e3) + 'K';
  }

  function renderGlance() {
    if (listView.hidden) return;
    var width = Math.round(glancePlot.clientWidth);
    if (width < 220 || width === glanceWidth) return;
    glanceWidth = width;
    var L = 52, R = 14, T = 16, B = 30;
    var iw = width - L - R;
    var ih = GLANCE_H - T - B;
    var xLo = Infinity, xHi = -Infinity, yLo = Infinity, yHi = -Infinity;
    rows.forEach(function (row) {
      var x = Math.log10(row.tvl_usd);
      var y = Math.log10(row.implied_value_usd);
      if (x < xLo) xLo = x;
      if (x > xHi) xHi = x;
      if (y < yLo) yLo = y;
      if (y > yHi) yHi = y;
    });
    xLo -= 0.06; xHi += 0.06; yLo -= 0.06; yHi += 0.06;
    function px(value) { return L + (value - xLo) / (xHi - xLo) * iw; }
    function py(value) { return T + ih - (value - yLo) / (yHi - yLo) * ih; }

    var svg = '<svg class="glance-svg" viewBox="0 0 ' + width + ' ' + GLANCE_H + '" role="img" ' +
      'aria-label="All ' + rows.length + ' ranked protocols: TVL versus implied value on log scales, with the global median multiple as a dashed line.">';
    var p;
    for (p = Math.ceil(xLo); p <= Math.floor(xHi); p += 1) {
      var gx = px(p);
      svg += '<line class="tick" x1="' + gx.toFixed(1) + '" y1="' + T + '" x2="' + gx.toFixed(1) + '" y2="' + (T + ih) + '"/>' +
        '<text x="' + gx.toFixed(1) + '" y="' + (T + ih + 16) + '" text-anchor="middle">' + fmtTick(Math.pow(10, p)) + '</text>';
    }
    for (p = Math.ceil(yLo); p <= Math.floor(yHi); p += 1) {
      var gy = py(p);
      svg += '<line class="tick" x1="' + L + '" y1="' + gy.toFixed(1) + '" x2="' + (L + iw) + '" y2="' + gy.toFixed(1) + '"/>' +
        '<text x="' + (L - 8) + '" y="' + (gy + 3.5).toFixed(1) + '" text-anchor="end">' + fmtTick(Math.pow(10, p)) + '</text>';
    }
    svg += '<line x1="' + L + '" y1="' + T + '" x2="' + L + '" y2="' + (T + ih) + '" stroke="#1b2939"/>' +
      '<line x1="' + L + '" y1="' + (T + ih) + '" x2="' + (L + iw) + '" y2="' + (T + ih) + '" stroke="#1b2939"/>' +
      '<text class="axis-title" x="' + L + '" y="10">implied value ↑</text>' +
      '<text class="axis-title" x="' + (L + iw) + '" y="' + (GLANCE_H - 4) + '" text-anchor="end">TVL →</text>';

    // The reference line: implied = TVL × global multiple, clipped to the plot.
    var glog = Math.log10(model.global_multiple);
    var ax = xLo, ay = ax + glog;
    if (ay < yLo) { ay = yLo; ax = ay - glog; }
    if (ay > yHi) { ay = yHi; ax = ay - glog; }
    var bx = xHi, by = bx + glog;
    if (by > yHi) { by = yHi; bx = by - glog; }
    if (by < yLo) { by = yLo; bx = by - glog; }
    svg += '<line x1="' + px(ax).toFixed(1) + '" y1="' + py(ay).toFixed(1) + '" x2="' + px(bx).toFixed(1) +
      '" y2="' + py(by).toFixed(1) + '" stroke="#f2b64c" stroke-opacity=".5" stroke-dasharray="5 4" stroke-width="1.2"/>';
    var lxData = xLo + (xHi - xLo) * 0.68;
    var lx = px(lxData);
    var ly = py(lxData + glog) - 7;
    if (ly < T + 10) ly = py(lxData + glog) + 15;
    svg += '<text class="line-label" x="' + lx.toFixed(1) + '" y="' + ly.toFixed(1) + '" text-anchor="middle">' +
      'global median multiple ×' + model.global_multiple.toFixed(3) + '</text>';

    // Watchlist points last so they sit above the rest.
    rows.slice().sort(function (a, b) {
      return (a.watchlist ? 1 : 0) - (b.watchlist ? 1 : 0);
    }).forEach(function (row) {
      svg += '<circle data-slug="' + esc(row.slug) + '" cx="' + px(Math.log10(row.tvl_usd)).toFixed(1) +
        '" cy="' + py(Math.log10(row.implied_value_usd)).toFixed(1) + '" r="3.1" fill="' +
        (row.watchlist ? '#f2b64c' : '#5b7590') + '"' + (row.watchlist ? '' : ' fill-opacity=".8"') + '>' +
        '<title>' + esc(row.name) + ' · TVL ' + fmtUsd(row.tvl_usd) + ' · implied ' + fmtUsd(row.implied_value_usd) + '</title></circle>';
    });
    svg += '</svg>';
    glancePlot.innerHTML = svg;

    var watchCount = 0;
    rows.forEach(function (row) { if (row.watchlist) watchCount += 1; });
    glanceLegend.innerHTML = '<span class="lg"><i class="w"></i>Watchlist (' + watchCount + ')</span>' +
      '<span class="lg"><i></i>Other ranked (' + (rows.length - watchCount) + ')</span>';
  }

  glancePlot.addEventListener('click', function (event) {
    var dot = event.target.closest ? event.target.closest('circle[data-slug]') : null;
    if (dot) openSlug(dot.getAttribute('data-slug'));
  });
  window.addEventListener('resize', function () { requestAnimationFrame(renderGlance); });

  var ledgerBuilt = false;
  function buildLedger() {
    var body = excluded.map(function (row) {
      var info = REASON_INFO[row.reason_code];
      var short = info ? info.short : row.reason_code;
      return '<tr><td class="lname">' + esc(row.name) + '</td>' +
        '<td>' + esc(row.category || '—') + '</td>' +
        '<td class="num">' + fmtUsd(row.tvl_usd) + '</td>' +
        '<td class="lreason" title="' + esc(row.reason_label || short) + '">' + esc(short) + '</td></tr>';
    }).join('');
    $('ledger').innerHTML = '<table class="ledger-table">' +
      '<caption class="sr-only">Protocols set aside, in TVL order, with the first screen that caught each.</caption>' +
      '<thead><tr><th scope="col">Name</th><th scope="col">Category</th>' +
      '<th scope="col" class="num">TVL</th><th scope="col">Reason</th></tr></thead>' +
      '<tbody>' + body + '</tbody></table>';
    ledgerBuilt = true;
  }

  $('ledger-btn').addEventListener('click', function () {
    var open = this.getAttribute('aria-expanded') === 'true';
    if (!open && !ledgerBuilt) buildLedger();
    this.setAttribute('aria-expanded', String(!open));
    $('ledger').hidden = open;
    this.textContent = (open ? 'Show' : 'Hide') + ' the ' + fmtNum(excluded.length) + '-row ledger';
  });

  snapLine.innerHTML =
    'Snapshot: DefiLlama protocols, as of ' + esc(R.as_of) +
    ' · <b>' + stats.watchlist + '</b> on the house watchlist';
  $('foot').textContent = 'Data: DefiLlama snapshot as of ' + R.as_of + ' · Model ' + R.model_version +
    ' · Implied values are model estimates, not predictions that a token will be issued.';
  document.querySelectorAll('[data-samples]').forEach(function (el) {
    el.textContent = model.min_category_samples;
  });
  if (typeof R.floor_usd === 'number') $('floor-usd').textContent = fmtFloor(R.floor_usd);

  // Category multiple table: the global fallback plus every category whose own median replaced it.
  var global = model.global_multiple;
  var detail = Array.isArray(model.multiples_detail) ? model.multiples_detail : null;
  var entries = [{ label: 'Global median (fallback)', value: global, n: model.global_samples, g: true }];
  if (detail) {
    detail.filter(function (item) { return item.basis === 'category-median'; })
      .sort(function (a, b) { return b.multiple - a.multiple; })
      .forEach(function (item) {
        entries.push({ label: item.category, value: item.multiple, n: item.n, g: false });
      });
  } else {
    Object.keys(model.multiples)
      .filter(function (key) { return Math.abs(model.multiples[key] - global) > 1e-12; })
      .sort(function (a, b) { return model.multiples[b] - model.multiples[a]; })
      .forEach(function (key) {
        entries.push({ label: key, value: model.multiples[key], n: null, g: false });
      });
  }
  function nLabel(n) {
    return n === null || n === undefined ? '' : '<span class="n">n=' + n + '</span>';
  }
  var multHtml = '';
  for (var i = 0; i < entries.length; i += 2) {
    var a = entries[i];
    var b = entries[i + 1];
    multHtml += '<tr><td' + (a.g ? ' class="g"' : '') + '>' + esc(a.label) + nLabel(a.n) +
      '</td><td class="num' + (a.g ? ' g' : '') + '">×' + a.value.toFixed(3) + '</td>';
    multHtml += b
      ? '<td' + (b.g ? ' class="g"' : '') + '>' + esc(b.label) + nLabel(b.n) +
        '</td><td class="num' + (b.g ? ' g' : '') + '">×' + b.value.toFixed(3) + '</td>'
      : '<td></td><td class="num"></td>';
    multHtml += '</tr>';
  }
  $('mult-body').innerHTML = multHtml;
  renderFunnel();
  renderCoverage();

  // Filter options come from the rows themselves.
  var categories = [];
  var chains = [];
  rows.forEach(function (row) {
    if (row.category && categories.indexOf(row.category) < 0) categories.push(row.category);
    row.chains.forEach(function (chain) {
      if (chains.indexOf(chain) < 0) chains.push(chain);
    });
  });
  categories.sort(function (a, b) { return a.localeCompare(b); });
  chains.sort(function (a, b) { return a.localeCompare(b); });

  function fillSelect(id, allLabel, values) {
    var html = '<option value="">' + allLabel + '</option>';
    values.forEach(function (value) {
      html += '<option value="' + esc(value) + '">' + esc(value) + '</option>';
    });
    $(id).innerHTML = html;
  }
  fillSelect('cat', 'All categories', categories);
  fillSelect('chain', 'All chains', chains);

  var SORTS = {
    rank: function (row) { return row.rank; },
    name: function (row) { return row.name.toLowerCase(); },
    tvl: function (row) { return row.tvl_usd; },
    chg: function (row) { return row.change_7d === null ? -1e9 : row.change_7d; },
    age: function (row) { return row.age_days === null ? -1 : row.age_days; },
    multiple: function (row) { return row.multiple; },
    implied: function (row) { return row.implied_value_usd; }
  };

  function visibleRows() {
    return rows.filter(function (row) {
      if (state.q && row.name.toLowerCase().indexOf(state.q) < 0 && row.slug.toLowerCase().indexOf(state.q) < 0) return false;
      if (state.cat && row.category !== state.cat) return false;
      if (state.chain && row.chains.indexOf(state.chain) < 0) return false;
      if (state.watch && !row.watchlist) return false;
      if (row.tvl_usd < state.min) return false;
      return true;
    });
  }

  function sortRows(list) {
    var get = SORTS[state.sort] || SORTS.rank;
    var dir = state.dir;
    return list.slice().sort(function (a, b) {
      var av = get(a);
      var bv = get(b);
      if (typeof av === 'string' && typeof bv === 'string') {
        var compared = av.localeCompare(bv);
        if (compared !== 0) return compared * dir;
      } else if (av !== bv) {
        return (av < bv ? -1 : 1) * dir;
      }
      return a.rank - b.rank;
    });
  }

  function updateHeaders() {
    document.querySelectorAll('th[data-sort]').forEach(function (th) {
      var on = th.getAttribute('data-sort') === state.sort;
      if (on) {
        th.classList.add('sorted');
        th.setAttribute('data-dir', state.dir === 1 ? 'asc' : 'desc');
        th.setAttribute('aria-sort', state.dir === 1 ? 'ascending' : 'descending');
      } else {
        th.classList.remove('sorted');
        th.removeAttribute('data-dir');
        th.removeAttribute('aria-sort');
      }
    });
  }

  function render() {
    var list = sortRows(visibleRows());
    var html = list.map(function (row) {
      var barWidth = Math.max(0, Math.min(100, row.implied_value_usd / maxImplied * 100));
      return '<tr data-slug="' + esc(row.slug) + '" tabindex="0">' +
        '<td class="num rank' + (row.rank <= 3 ? ' top' : '') + '">' + row.rank + '</td>' +
        '<td class="proto" title="' + esc(row.name) + '">' + esc(row.name) +
          (row.watchlist ? '<span class="badge">Watchlist</span>' : '') + '</td>' +
        '<td class="cat">' + esc(row.category || '—') + '</td>' +
        '<td class="chains" title="' + esc(row.chains.join(', ')) + '">' + esc(chainText(row.chains)) + '</td>' +
        '<td class="num">' + fmtUsd(row.tvl_usd) + '</td>' +
        '<td class="num ' + chgClass(row.change_7d) + '">' + fmtChg(row.change_7d) + '</td>' +
        '<td class="num age">' + fmtAge(row.age_days) + '</td>' +
        '<td class="num mult">' + fmtMultiple(row.multiple) + '</td>' +
        '<td class="num implied">' + fmtUsd(row.implied_value_usd) +
          '<span class="ibar" aria-hidden="true"><span style="width:' + barWidth.toFixed(2) + '%"></span></span></td>' +
        '</tr>';
    }).join('');
    tbody.innerHTML = html || '<tr class="empty"><td colspan="9">No protocols match these filters.</td></tr>';
    countEl.innerHTML = 'Showing <b>' + list.length + '</b> of ' + TOTAL;
    updateHeaders();
  }

  document.querySelectorAll('th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      var key = th.getAttribute('data-sort');
      if (state.sort === key) {
        state.dir = -state.dir;
      } else {
        state.sort = key;
        state.dir = key === 'name' || key === 'rank' ? 1 : -1;
      }
      render();
    });
    th.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        th.click();
      }
    });
  });

  $('q').addEventListener('input', function (event) {
    state.q = event.target.value.trim().toLowerCase();
    render();
  });
  $('cat').addEventListener('change', function (event) {
    state.cat = event.target.value;
    render();
  });
  $('chain').addEventListener('change', function (event) {
    state.chain = event.target.value;
    render();
  });
  $('watch').addEventListener('change', function (event) {
    state.watch = event.target.checked;
    render();
  });
  $('min').addEventListener('change', function (event) {
    state.min = Number(event.target.value) || 0;
    render();
  });

  function openSlug(slug) {
    location.hash = '#/p/' + encodeURIComponent(slug);
  }

  tbody.addEventListener('click', function (event) {
    var tr = event.target.closest('tr[data-slug]');
    if (tr) openSlug(tr.getAttribute('data-slug'));
  });
  tbody.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    var tr = event.target.closest('tr[data-slug]');
    if (!tr) return;
    event.preventDefault();
    openSlug(tr.getAttribute('data-slug'));
  });

  // Age is rebuilt from as_of and listed_at, the way lib/model.ts does it.
  function ageFromRow(row) {
    if (row.listed_at === null) return null;
    var end = Date.parse(R.as_of + 'T00:00:00Z');
    var start = Date.parse(row.listed_at + 'T00:00:00Z');
    if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
    return Math.max(0, Math.floor((end - start) / 86400000));
  }

  // The same arithmetic as lib/model.ts, from this row and RADAR.model.
  function compute(row) {
    var key = row.category === null ? 'Uncategorized' : row.category;
    var multiple = Object.prototype.hasOwnProperty.call(model.multiples, key)
      ? model.multiples[key]
      : model.global_multiple;
    var ageDays = ageFromRow(row);
    var change = row.change_7d === null
      ? 0
      : Math.min(model.growth_clamp_pct, Math.max(-model.growth_clamp_pct, row.change_7d));
    var growth = 1 + (change / 100) * model.growth_weight;
    var ratio = null;
    var maturity = 1;
    if (ageDays !== null) {
      ratio = Math.log10(1 + ageDays / 30) / Math.log10(1 + model.age_full_days / 30);
      maturity = 1 + model.age_weight * Math.min(1, ratio);
    }
    var product = row.tvl_usd * multiple * growth * maturity;
    return {
      multiple: multiple,
      growth: growth,
      maturity: maturity,
      ratio: ratio,
      age: ageDays,
      implied: Math.max(model.implied_floor_usd, Math.round(product)),
      own: Math.abs(multiple - model.global_multiple) > 1e-12
    };
  }

  function median(values) {
    var list = values.slice().sort(function (a, b) { return a - b; });
    var mid = list.length >> 1;
    return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
  }

  function ordinal(value) {
    var rem = value % 100;
    if (rem >= 11 && rem <= 13) return value + 'th';
    return value + ({ 1: 'st', 2: 'nd', 3: 'rd' }[value % 10] || 'th');
  }

  // Standing is derived from RADAR.rows, not read off the row itself.
  function standingHtml(row) {
    var n = rows.length;
    var rank = 1;
    var tvlRank = 1;
    var atOrBelow = 0;
    rows.forEach(function (other) {
      if (other.implied_value_usd > row.implied_value_usd) rank += 1;
      if (other.tvl_usd > row.tvl_usd) tvlRank += 1;
      if (other.implied_value_usd <= row.implied_value_usd) atOrBelow += 1;
    });
    var pct = Math.max(1, Math.round(atOrBelow / n * 100));
    var boardMedian = median(rows.map(function (other) { return other.multiple; }));
    function delta(value, base) {
      var change = (value / base - 1) * 100;
      return (change > 0 ? '+' : '') + change.toFixed(0) + '%';
    }
    return '<section class="box standing">' +
      '<h3>Standing on this board</h3>' +
      '<p>Rank <b>#' + rank + '</b> of ' + n + ' by implied value · <b>' + ordinal(pct) +
        ' percentile</b> · TVL ranks <b>#' + tvlRank + '</b> of ' + n + '</p>' +
      '<p>Multiple <b>×' + row.multiple.toFixed(3) + '</b> vs board median <b>×' + boardMedian.toFixed(3) +
        '</b> (' + delta(row.multiple, boardMedian) + ') · vs global median <b>×' +
        model.global_multiple.toFixed(3) + '</b> (' + delta(row.multiple, model.global_multiple) + ')</p>' +
      '</section>';
  }

  function detailHtml(row) {
    var calc = compute(row);
    var ok = calc.implied === row.implied_value_usd;
    var multipleNote = esc(row.category || 'Uncategorized') + (calc.own ? ' median' : ' · global median');
    var growthNote;
    if (row.change_7d === null) {
      growthNote = 'no 7d change in this snapshot → 1';
    } else {
      var clamped = Math.min(model.growth_clamp_pct, Math.max(-model.growth_clamp_pct, row.change_7d));
      growthNote = '7d ' + fmtChg(row.change_7d) + ' → clamp ' + (clamped > 0 ? '+' : '') +
        clamped.toFixed(2) + '% ÷ 100 × ' + model.growth_weight;
    }
    var ageNote;
    if (calc.age === null) {
      ageNote = 'no listed_at date → 1';
    } else {
      ageNote = calc.age + ' days from ' + row.listed_at + ' → log10(1 + ' + calc.age +
        '/30) ÷ log10(' + (1 + model.age_full_days / 30) + ') = ' + calc.ratio.toFixed(3) +
        (calc.ratio >= 1 ? ' → capped at 1' : '');
    }
    var steps = row.farm_steps.map(function (step) {
      return '<li>' + esc(step) + '</li>';
    }).join('');
    var chainList = row.chains.length ? row.chains.join(', ') : '—';
    var changeClass = chgClass(row.change_7d);

    return '<a class="back" href="#/">← Back to the board</a>' +
      '<div class="dhead">' +
        '<div>' +
          '<p class="eyebrow">Protocol detail</p>' +
          '<h2>' + esc(row.name) + '</h2>' +
          '<div class="tags">' +
            '<span class="tag">Rank #' + row.rank + '</span>' +
            '<span class="tag">' + esc(row.category || 'Uncategorized') + '</span>' +
            '<span class="tag">Records no token in this snapshot</span>' +
            (row.watchlist ? '<span class="tag watch">Watchlist</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="dval"><span>Implied value</span><b>' + fmtUsd(row.implied_value_usd) + '</b></div>' +
      '</div>' +
      '<div class="facts">' +
        '<div class="fact"><span>Category</span><b>' + esc(row.category || 'Uncategorized') + '</b></div>' +
        '<div class="fact"><span>Rank</span><b>#' + row.rank + '</b></div>' +
        '<div class="fact"><span>TVL</span><b>' + fmtUsdFull(row.tvl_usd) + '</b></div>' +
        '<div class="fact"><span>7d change</span><b class="' + changeClass + '">' + fmtChg(row.change_7d) + '</b></div>' +
        '<div class="fact"><span>Listed</span><b>' + esc(row.listed_at || 'unknown') + '</b></div>' +
        '<div class="fact"><span>Tokenless for</span><b>' + fmtAgeLong(row.age_days) + '</b></div>' +
        '<div class="fact"><span>Category multiple</span><b>×' + calc.multiple.toFixed(4) + '</b></div>' +
        '<div class="fact"><span>House watchlist</span><b>' + (row.watchlist ? 'Yes' : 'No') + '</b></div>' +
        '<div class="fact wide"><span>Chains (' + row.chains.length + ')</span><b>' + esc(chainList) + '</b></div>' +
      '</div>' +
      standingHtml(row) +
      '<section class="box">' +
        '<h3>Recompute from the model</h3>' +
        '<p class="lede">The same arithmetic as lib/model.ts, run here from this row and RADAR.model.</p>' +
        '<div class="mline"><span>TVL</span><b>' + fmtUsdFull(row.tvl_usd) + '</b><em>tvl_usd</em></div>' +
        '<div class="mline"><span>× category multiple</span><b>' + calc.multiple.toFixed(6) + '</b><em>' + multipleNote + '</em></div>' +
        '<div class="mline"><span>× growth adjustment</span><b>' + calc.growth.toFixed(6) + '</b><em>' + growthNote + '</em></div>' +
        '<div class="mline"><span>× age adjustment</span><b>' + calc.maturity.toFixed(6) + '</b><em>' + ageNote + '</em></div>' +
        '<div class="mline total"><span>Implied value</span><b>' + fmtUsdFull(calc.implied) + '</b><em>max(' + fmtUsdFull(model.implied_floor_usd) + ', round(product))</em></div>' +
        '<p class="expr">' + fmtNum(row.tvl_usd) + ' × ' + calc.multiple.toFixed(6) + ' × ' +
          calc.growth.toFixed(6) + ' × ' + calc.maturity.toFixed(6) + ' = <b>' + fmtNum(calc.implied) + '</b></p>' +
        '<p class="match ' + (ok ? 'ok' : 'bad') + '">' +
          (ok ? 'matches board.json' : 'differs from board.json (' + fmtUsdFull(row.implied_value_usd) + ')') + '</p>' +
        '<p class="fine">Factors are rounded to six decimals for display; the calculation uses full precision, then rounds to the nearest dollar with a $1 floor.</p>' +
      '</section>' +
      '<section class="box">' +
        '<h3>Farm plan</h3>' +
        '<p class="lede">' + row.farm_steps.length + ' steps, rendered verbatim from board.json.</p>' +
        '<ol class="steps">' + steps + '</ol>' +
      '</section>' +
      '<a class="back" href="#/">← Back to the board</a>';
  }

  function enterDetail() {
    if (!listView.hidden) savedScroll = window.scrollY || 0;
    listView.hidden = true;
    detailView.hidden = false;
    window.scrollTo(0, 0);
  }

  function showDetail(row) {
    enterDetail();
    detailView.innerHTML = detailHtml(row);
    document.title = row.name + ' · Token Launch Radar';
  }

  function showNotFound(hash) {
    enterDetail();
    detailView.innerHTML = '<a class="back" href="#/">← Back to the board</a>' +
      '<div class="box"><h3>Protocol not found</h3>' +
      '<p class="lede">No row in this snapshot matches <b>' + esc(hash || '(empty)') +
      '</b>. Return to the board and pick a protocol.</p></div>';
    document.title = 'Protocol not found · Token Launch Radar';
  }

  function showList() {
    var returning = !detailView.hidden;
    detailView.hidden = true;
    listView.hidden = false;
    document.title = 'Token Launch Radar';
    renderGlance();
    if (returning && savedScroll) {
      requestAnimationFrame(function () { window.scrollTo(0, savedScroll); });
    }
  }

  function route() {
    var hash = location.hash || '';
    if (hash.slice(0, 4) === '#/p/') {
      var slug = '';
      try {
        slug = decodeURIComponent(hash.slice(4));
      } catch (error) {
        slug = '';
      }
      var row = bySlug[slug];
      if (row) showDetail(row);
      else showNotFound(slug);
      return;
    }
    showList();
  }

  window.addEventListener('hashchange', route);
  $('glance-n').textContent = fmtNum(rows.length);
  render();
  renderGlance();
  route();
  requestAnimationFrame(renderGlance);
})();
