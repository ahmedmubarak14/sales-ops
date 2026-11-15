/* ============================================================
   Sales Hunter (shared by Sales Ops): table helpers shared by every list in the app:
   sortable column headers, row selection, and the bulk-action bar.

   A table is named by an id ('team', 'payouts', ...). Its sort order
   lives in sessionStorage, so it survives the live auto-refresh and a
   reload but not a new tab — the same rule as the page filters.
   Selections are in memory only: an action applies to what is on screen.
   ============================================================ */

var Tbl = (function () {
  'use strict';

  var mem = {};
  function load(k) {
    if (k in mem) return mem[k];
    try { return JSON.parse(sessionStorage.getItem('sh.tbl.' + k)); } catch (e) { return null; }
  }
  function save(k, v) {
    mem[k] = v;
    try { sessionStorage.setItem('sh.tbl.' + k, JSON.stringify(v)); } catch (e) { /* in-memory still holds it */ }
  }

  /* ---------------- sorting ---------------- */
  // Untitled UI's table icons: a chevron pair on unsorted columns, an
  // arrow (flipped for ascending) on the sorted one.
  var ICON_SELECTOR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m7 15 5 5 5-5M7 9l5-5 5 5"/></svg>';
  var ICON_ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14m0 0 7-7m-7 7-7-7"/></svg>';
  // dflt: { k: column key, d: 'asc' | 'desc' }
  function sortState(id, dflt) {
    var s = load(id + '.sort');
    return s && s.k ? s : dflt;
  }
  function blank(v) {
    return v === null || v === undefined || v === '' || (typeof v === 'number' && isNaN(v));
  }
  function cmp(a, b) {
    if (a instanceof Date) a = a.getTime();
    if (b instanceof Date) b = b.getTime();
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    if (typeof a === 'boolean' && typeof b === 'boolean') return (a ? 1 : 0) - (b ? 1 : 0);
    return String(a).localeCompare(String(b), (typeof isAr === 'function' && isAr()) ? 'ar' : 'en',
      { numeric: true, sensitivity: 'base' });
  }
  /* Rows sorted by the table's current column. cols maps a column key to
     a function returning the row's value for it. Empty values always go
     last, whichever way the column is sorted; ties keep their order. */
  function sort(rows, id, cols, dflt) {
    var st = sortState(id, dflt);
    var get = cols[st.k] || cols[dflt.k];
    if (!get) return rows.slice();
    var dir = st.d === 'asc' ? 1 : -1;
    return rows.map(function (r, i) { return { r: r, v: get(r), i: i }; }).sort(function (x, y) {
      var xb = blank(x.v), yb = blank(y.v);
      if (xb || yb) return xb && yb ? x.i - y.i : xb ? 1 : -1;
      return cmp(x.v, y.v) * dir || x.i - y.i;
    }).map(function (x) { return x.r; });
  }
  /* A sortable header cell. opts.num right-aligns it; opts.first is the
     direction a first click sorts in ('desc' for amounts and dates, the
     default; 'asc' for names). */
  function th(id, st, key, label, opts) {
    opts = opts || {};
    var on = st.k === key;
    var dir = on ? st.d : null;
    return '<th' + (opts.num ? ' class="num"' : '') + ' aria-sort="' +
        (dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none') + '">' +
      '<button type="button" class="th-sort' + (on ? ' on' : '') + '" data-tbl="' + esc(id) + '" data-key="' + esc(key) +
        '" data-first="' + (opts.first || 'desc') + '">' + label +
        '<span class="th-arrow' + (dir === 'asc' ? ' asc' : '') + '" aria-hidden="true">' + (dir ? ICON_ARROW : ICON_SELECTOR) + '</span>' +
      '</button></th>';
  }
  /* Phones show lists as cards with no header row, so the same choice is
     offered as a select. options: [[key, label, first], ...] */
  function sortPicker(id, st, options) {
    return '<div class="sort-picker">' +
      '<label class="sr-only" for="sp-' + esc(id) + '">' + t('sortBy') + '</label>' +
      '<select id="sp-' + esc(id) + '" class="sort-select" data-tbl="' + esc(id) + '">' +
        options.map(function (o) {
          return '<option value="' + esc(o[0]) + '" data-first="' + (o[2] || 'desc') + '"' + (o[0] === st.k ? ' selected' : '') + '>' +
            t('sortByX', { col: o[1] }) + '</option>';
        }).join('') +
      '</select>' +
      '<button type="button" class="icon-btn sort-dir" data-tbl="' + esc(id) + '" aria-label="' +
        (st.d === 'asc' ? t('sortAsc') : t('sortDesc')) + '" title="' + (st.d === 'asc' ? t('sortAsc') : t('sortDesc')) + '">' +
        '<span class="th-arrow' + (st.d === 'asc' ? ' asc' : '') + '">' + ICON_ARROW + '</span></button>' +
    '</div>';
  }
  function wireSort(root, id, dflt, rerender) {
    root.querySelectorAll('.th-sort[data-tbl="' + id + '"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var cur = sortState(id, dflt), k = btn.getAttribute('data-key');
        var d = cur.k === k ? (cur.d === 'asc' ? 'desc' : 'asc') : btn.getAttribute('data-first');
        save(id + '.sort', { k: k, d: d });
        rerender();
      });
    });
    var pick = root.querySelector('.sort-select[data-tbl="' + id + '"]');
    if (pick) pick.addEventListener('change', function () {
      var o = pick.options[pick.selectedIndex];
      save(id + '.sort', { k: pick.value, d: o.getAttribute('data-first') || 'desc' });
      rerender();
    });
    var flip = root.querySelector('.sort-dir[data-tbl="' + id + '"]');
    if (flip) flip.addEventListener('click', function () {
      var cur = sortState(id, dflt);
      save(id + '.sort', { k: cur.k, d: cur.d === 'asc' ? 'desc' : 'asc' });
      rerender();
    });
  }

  /* ---------------- selection + bulk bar ---------------- */
  var picked = {};   // table id -> { rowId: true }
  function sel(id) { return picked[id] || (picked[id] = {}); }
  function selectedIds(id) { return Object.keys(sel(id)); }
  function clear(id) { picked[id] = {}; }
  // Forget rows that are no longer listed (filtered out, or gone).
  function prune(id, visibleIds) {
    var s = sel(id), keep = {};
    visibleIds.forEach(function (v) { if (s[v]) keep[v] = true; });
    picked[id] = keep;
  }
  function selTh(id, visibleIds) {
    var s = sel(id);
    var all = visibleIds.length > 0 && visibleIds.every(function (v) { return s[v]; });
    var some = !all && visibleIds.some(function (v) { return s[v]; });
    return '<th class="sel-col"><input type="checkbox" class="sel-all" data-tbl="' + esc(id) + '"' +
      (all ? ' checked' : '') + (some ? ' data-some="1"' : '') + ' aria-label="' + t('selectAll') + '"' +
      (visibleIds.length ? '' : ' disabled') + '></th>';
  }
  function selTd(id, rowId, label) {
    return '<td class="sel-col"><input type="checkbox" class="sel-row" data-tbl="' + esc(id) + '" data-id="' + esc(rowId) +
      '"' + (sel(id)[rowId] ? ' checked' : '') + ' aria-label="' + esc(t('selectRow', { name: label || rowId })) + '"></td>';
  }
  /* actions: [{ act, label, cls }]. Nothing selected, no bar. */
  function bar(id, actions) {
    var n = selectedIds(id).length;
    if (!n) return '';
    return '<div class="bulk-bar" role="region" aria-label="' + t('bulkActions') + '" data-tbl="' + esc(id) + '">' +
      '<b>' + t('nSelected', { n: n }) + '</b>' +
      '<div class="bulk-acts">' + actions.map(function (a) {
        return '<button type="button" class="btn ' + (a.cls || 'secondary') + '" data-bulk="' + esc(a.act) + '">' + a.label + '</button>';
      }).join('') + '</div>' +
      '<button type="button" class="link-btn" data-bulk-clear>' + t('clearSelection') + '</button>' +
    '</div>';
  }
  /* onAction(act, ids) runs a bulk action; rerender() redraws the table
     (and the bar) after a selection change. */
  function wireSelect(root, id, visibleIds, rerender, onAction) {
    var s = sel(id);
    var all = root.querySelector('.sel-all[data-tbl="' + id + '"]');
    if (all) {
      if (all.getAttribute('data-some')) all.indeterminate = true;
      all.addEventListener('click', function (e) { e.stopPropagation(); });
      all.addEventListener('change', function () {
        visibleIds.forEach(function (v) { if (all.checked) s[v] = true; else delete s[v]; });
        rerender();
      });
    }
    root.querySelectorAll('.sel-row[data-tbl="' + id + '"]').forEach(function (cb) {
      // A row that opens a drawer must not open it for a tick.
      cb.addEventListener('click', function (e) { e.stopPropagation(); });
      cb.closest('td').addEventListener('click', function (e) { e.stopPropagation(); });
      cb.addEventListener('change', function () {
        var v = cb.getAttribute('data-id');
        if (cb.checked) s[v] = true; else delete s[v];
        rerender();
      });
    });
    var b = root.querySelector('.bulk-bar[data-tbl="' + id + '"]');
    if (!b) return;
    b.querySelector('[data-bulk-clear]').addEventListener('click', function () { clear(id); rerender(); });
    b.querySelectorAll('[data-bulk]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var ids = selectedIds(id);
        if (!ids.length) return;
        b.querySelectorAll('button').forEach(function (x) { x.disabled = true; });
        Promise.resolve(onAction(btn.getAttribute('data-bulk'), ids)).then(function (done) {
          if (done !== false) clear(id);
          rerender();
        }, function () {
          b.querySelectorAll('button').forEach(function (x) { x.disabled = false; });
        });
      });
    });
  }

  /* ---------------- pagination ----------------
     Untitled UI's PaginationCardAdvanced (align center): "Page [n] of N"
     with a box to jump to a page, first / previous, the page numbers,
     next / last, and "Rows per page" (10, 25, 50, 100). Plus which rows
     are on screen ("1–10 of 13"). Phones keep the arrows and "Page n of
     N". The rows-per-page choice is kept per table (localStorage). */
  var PG_ICON = {
    first: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 17-5-5 5-5M11 17l-5-5 5-5"/></svg>',
    prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
    last: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 17 5-5-5-5M13 17l5-5-5-5"/></svg>'
  };
  var PER_OPTIONS = [10, 25, 50, 100];
  function perPage(id, dflt) {
    var v = null;
    try { v = JSON.parse(localStorage.getItem('sh.per.' + id)); } catch (e) { /* default */ }
    return PER_OPTIONS.indexOf(v) >= 0 ? v : dflt;
  }
  // As Untitled UI (one page either side): 1 2 3 4 5 … 10 near the start,
  // 1 … 4 5 6 … 10 in the middle, 1 … 6 7 8 9 10 near the end.
  function pageList(page, pages) {
    var range = function (a, b) { var r = []; for (var i = a; i <= b; i++) r.push(i); return r; };
    if (pages <= 7) return range(1, pages);
    if (page <= 4) return range(1, 5).concat(['…', pages]);
    if (page >= pages - 3) return [1, '…'].concat(range(pages - 4, pages));
    return [1, '…', page - 1, page, page + 1, '…', pages];
  }
  // o: { id, page, per, total (rows) }
  function pager(o) {
    var pages = Math.max(1, Math.ceil(o.total / o.per));
    var page = Math.min(Math.max(1, o.page), pages);
    var from = o.total ? (page - 1) * o.per + 1 : 0, to = Math.min(page * o.per, o.total);
    function btn(act, icon, off, label) {
      return '<button type="button" class="pg-btn" data-pg="' + act + '" aria-label="' + esc(label) + '"' + (off ? ' disabled' : '') + '>' + icon + '</button>';
    }
    return '<nav class="pg-bar" data-pager="' + esc(o.id) + '" data-pages="' + pages + '" aria-label="' + esc(t('pagination')) + '">' +
      '<div class="pg-where">' + t('pgPage') +
        ' <input class="pg-input" type="text" inputmode="numeric" aria-label="' + esc(t('pgPage')) + '" value="' + page + '" size="' + String(pages).length + '"> ' +
        t('pgOf', { n: pages }) +
        '<span class="pg-rows">' + t('pgRows', { a: from, b: to, n: o.total }) + '</span></div>' +
      '<div class="pg-nav">' +
        '<div class="pg-group">' + btn('first', PG_ICON.first, page <= 1, t('pgFirst')) + btn('prev', PG_ICON.prev, page <= 1, t('prev')) + '</div>' +
        '<div class="pg-nums">' + pageList(page, pages).map(function (n) {
          return n === '…' ? '<span class="pg-gap">…</span>'
            : '<button type="button" class="pg-num' + (n === page ? ' on' : '') + '" data-pg="' + n + '"' + (n === page ? ' aria-current="page"' : '') + '>' + n + '</button>';
        }).join('') + '</div>' +
        '<span class="pg-mobile">' + t('pageOf', { p: page, n: pages }) + '</span>' +
        '<div class="pg-group">' + btn('last', PG_ICON.last, page >= pages, t('pgLast')) + btn('next', PG_ICON.next, page >= pages, t('next')) + '</div>' +
      '</div>' +
      '<label class="pg-size"><span>' + t('pgPerPage') + '</span><select class="pg-per">' +
        PER_OPTIONS.map(function (n) { return '<option value="' + n + '"' + (n === o.per ? ' selected' : '') + '>' + n + '</option>'; }).join('') +
      '</select></label>' +
    '</nav>';
  }
  // on.page(n): go to page n; on.per(n): rows per page changed (saved here).
  function wirePager(root, id, on) {
    var bar = root.querySelector('[data-pager="' + id + '"]');
    if (!bar) return;
    var pages = Number(bar.getAttribute('data-pages'));
    var cur = Number(bar.querySelector('.pg-input').value);
    bar.addEventListener('click', function (e) {
      var b = e.target.closest('[data-pg]');
      if (!b || b.disabled) return;
      var a = b.getAttribute('data-pg');
      on.page(a === 'first' ? 1 : a === 'last' ? pages : a === 'prev' ? cur - 1 : a === 'next' ? cur + 1 : Number(a));
    });
    var input = bar.querySelector('.pg-input');
    function jump() {
      var n = parseInt(String(input.value).replace(/[^\d]/g, ''), 10);
      if (!n || n === cur) { input.value = cur; return; }
      on.page(Math.min(Math.max(1, n), pages));
    }
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); jump(); } });
    input.addEventListener('change', jump);
    bar.querySelector('.pg-per').addEventListener('change', function () {
      var n = Number(this.value);
      try { localStorage.setItem('sh.per.' + id, JSON.stringify(n)); } catch (e) { /* this session only */ }
      on.per(n);
    });
  }

  return {
    sortState: sortState, sort: sort, th: th, sortPicker: sortPicker, wireSort: wireSort,
    selectedIds: selectedIds, clear: clear, prune: prune, selTh: selTh, selTd: selTd, bar: bar, wireSelect: wireSelect,
    load: load, save: save, perPage: perPage, pager: pager, wirePager: wirePager
  };
})();
