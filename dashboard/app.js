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
  var TOTAL = stats.selected;
  var state = { q: '', cat: '', chain: '', watch: false, min: 0, sort: 'rank', dir: 1 };
  var bySlug = Object.create(null);
  rows.forEach(function (row) { bySlug[row.slug] = row; });

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

  snapLine.innerHTML =
    'Snapshot: DefiLlama protocols, as of ' + esc(R.as_of) +
    ' · <b>' + stats.protocols + '</b> scanned' +
    ' · <b>' + stats.no_token + '</b> record no token' +
    ' · <b>' + stats.selected + '</b> ranked' +
    ' · <b>' + stats.watchlist + '</b> on the house watchlist';
  $('foot').textContent = 'Data: DefiLlama snapshot as of ' + R.as_of + ' · Model ' + R.model_version +
    ' · Implied values are model estimates, not predictions that a token will be issued.';
  document.querySelectorAll('[data-samples]').forEach(function (el) {
    el.textContent = model.min_category_samples;
  });

  // Category multiple table: the global fallback plus every category whose own median replaced it.
  var global = model.global_multiple;
  var ownCategories = Object.keys(model.multiples)
    .filter(function (key) { return Math.abs(model.multiples[key] - global) > 1e-12; })
    .sort(function (a, b) { return model.multiples[b] - model.multiples[a]; });
  var multHtml = '';
  var entries = [{ label: 'Global median (fallback)', value: global, g: true }];
  ownCategories.forEach(function (key) {
    entries.push({ label: key, value: model.multiples[key], g: false });
  });
  for (var i = 0; i < entries.length; i += 2) {
    var a = entries[i];
    var b = entries[i + 1];
    multHtml += '<tr><td' + (a.g ? ' class="g"' : '') + '>' + esc(a.label) +
      '</td><td class="num' + (a.g ? ' g' : '') + '">×' + a.value.toFixed(3) + '</td>';
    multHtml += b
      ? '<td' + (b.g ? ' class="g"' : '') + '>' + esc(b.label) +
        '</td><td class="num' + (b.g ? ' g' : '') + '">×' + b.value.toFixed(3) + '</td>'
      : '<td></td><td class="num"></td>';
    multHtml += '</tr>';
  }
  $('mult-body').innerHTML = multHtml;

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
        '<td class="num implied">' + fmtUsd(row.implied_value_usd) + '</td>' +
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
  render();
  route();
})();
