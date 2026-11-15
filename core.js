/* ============================================================
   Sales Ops Portal: shared state and view helpers
   Views (views-*.js) render HTML strings with these helpers;
   app.js owns the shell, routing and sign-in.
   ============================================================ */

var VIEWS = {};
var ST = {
  snap: null, model: null,
  realEmail: '', previewEmail: null,
  month: SO.monthKey(new Date()),
  repSel: null,              // manager filter: array of rep emails or null (= all)
  v: {},                     // per-view UI state (tabs, sorts, filters)
  lastLoad: null
};

/* ---------------- who ---------------- */
function lcEmail(e) { return SO.lc(e); }
function userByEmail(e) { return ST.model ? ST.model.userByEmail[lcEmail(e)] : null; }
function realUser() { return userByEmail(ST.realEmail) || (ST.snap && ST.snap.me) || null; }
function me() { return (ST.previewEmail && userByEmail(ST.previewEmail)) || realUser(); }
function role() { var u = me(); return u ? u.role : 'rep'; }
function isRep() { return role() === 'rep'; }
function isMgr() { return role() === 'manager' || role() === 'admin'; }
function isFin() { return role() === 'finance'; }
function isAdmin() { return role() === 'admin'; }
function canPreview() { var r = realUser(); return !!r && (r.role === 'admin' || r.role === 'manager'); }
function nameOf(email) { var u = userByEmail(email); return u ? u.name : (email || '—'); }
function firstName(n) { return String(n || '').split(' ')[0]; }
function initials(n) { return String(n || '?').split(/\s+/).map(function (p) { return p.charAt(0); }).slice(0, 2).join('').toUpperCase(); }
function activeReps() { return ST.model.reps.filter(function (u) { return u.active !== false; }); }
// The reps a page is about: yourself as a rep, else the picker's choice.
function scopeEmails() {
  if (isRep()) return [lcEmail(me().email)];
  var all = activeReps().map(function (u) { return lcEmail(u.email); });
  if (!ST.repSel || !ST.repSel.length) return all;
  return all.filter(function (e) { return ST.repSel.indexOf(e) >= 0; });
}
function inScope(row) { var s = scopeEmails(); return s.indexOf(row.owner) >= 0 || s.indexOf(row.countsFor) >= 0; }

/* ---------------- format ---------------- */
function money(n) { return fmtMoney(n || 0); }
function moneyC(n) { return fmtMoneyC(n || 0); }
function pct(x, dp) { return fmtPct(x || 0, dp === undefined ? 0 : dp); }
function signed(n) { return (n > 0 ? '+' : n < 0 ? '−' : '') + fmtMoney(Math.abs(n)).replace('-', ''); }
var MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
function monthName(key, short) {
  var m = Number(key.slice(5, 7)) - 1, y = key.slice(0, 4);
  var n = isAr() ? MONTHS_AR[m] : MONTHS_EN[m];
  return short ? n.slice(0, isAr() ? 20 : 3) : n + ' ' + y;
}
function dateShort(d) {
  if (!d) return '—';
  var x = new Date(d);
  if (isNaN(x)) return '—';
  return x.getDate() + ' ' + (isAr() ? MONTHS_AR : MONTHS_EN)[x.getMonth()] + ' ' + x.getFullYear();
}
function agoText(d) {
  if (!d) return '—';
  var min = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  if (min < 1) return L('just now', 'الآن');
  if (min < 60) return L(min + ' min ago', 'قبل ' + min + ' دقيقة');
  var h = Math.round(min / 60);
  if (h < 24) return L(h + ' h ago', 'قبل ' + h + ' ساعة');
  var dd = Math.round(h / 24);
  return L(dd + ' d ago', 'قبل ' + dd + ' يوم');
}
function daysSince(d) { return d ? Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 864e5)) : 0; }

/* ---------------- labels ---------------- */
var ROLE_LABEL = {
  rep: ['Employee', 'موظف'], manager: ['Sales manager', 'مدير المبيعات'],
  finance: ['Finance', 'المالية'], admin: ['Sales Ops', 'عمليات المبيعات']
};
function roleLabel(r) { var x = ROLE_LABEL[r] || [r]; return L(x[0], x[1]); }
var ISSUE = {
  no_invoice: { t: ['Won, but no invoice', 'مغلقة بنجاح بلا فاتورة'], why: ['Closed Won in HubSpot with no paid invoice in Metabase.', 'مغلقة بنجاح في HubSpot ولا توجد فاتورة مدفوعة في Metabase.'], fix: ['Confirm the merchant paid and the deal carries the right store ID.', 'تأكد أن التاجر دفع وأن الصفقة تحمل رقم المتجر الصحيح.'] },
  not_won: { t: ['Paid, but not Closed Won', 'مدفوعة وغير مغلقة'], why: ['The store paid, but the deal is still open in HubSpot.', 'المتجر دفع لكن الصفقة ما زالت مفتوحة في HubSpot.'], fix: ['Move the deal to Closed Won in HubSpot.', 'انقل الصفقة إلى مغلقة بنجاح في HubSpot.'] },
  amount_gap: { t: ['Amount differs', 'اختلاف في المبلغ'], why: ['The HubSpot amount and the invoice net differ by more than the tolerance.', 'مبلغ HubSpot يختلف عن صافي الفاتورة بأكثر من الحد المسموح.'], fix: ['Update the deal amount in HubSpot to the invoice net.', 'حدّث مبلغ الصفقة في HubSpot ليطابق صافي الفاتورة.'] },
  month_gap: { t: ['Close date in another month', 'تاريخ الإغلاق في شهر آخر'], why: ['The invoice was paid in a different month than the close date.', 'دُفعت الفاتورة في شهر غير شهر تاريخ الإغلاق.'], fix: ['Set the close date to the invoice month.', 'اضبط تاريخ الإغلاق على شهر الفاتورة.'] },
  owner_gap: { t: ['Different owner on the invoice', 'مالك مختلف في الفاتورة'], why: ['The invoice names a different employee than the HubSpot deal owner.', 'الفاتورة تذكر موظفًا غير مالك الصفقة في HubSpot.'], fix: ['Management decides who keeps the deal.', 'تقرر الإدارة من يحتفظ بالصفقة.'] },
  duplicate: { t: ['Same store won twice', 'نفس المتجر في صفقتين'], why: ['Two Closed Won deals carry the same store ID.', 'صفقتان مغلقتان بنجاح بنفس رقم المتجر.'], fix: ['Management decides which deal keeps the store.', 'تقرر الإدارة أي صفقة تحتفظ بالمتجر.'] }
};
function issueTitle(k) { var x = ISSUE[k]; return x ? L(x.t[0], x.t[1]) : k; }
function issueWhy(k) { var x = ISSUE[k]; return x ? L(x.why[0], x.why[1]) : ''; }
function issueFix(k) { var x = ISSUE[k]; return x ? L(x.fix[0], x.fix[1]) : ''; }
var SEV_ORDER = { high: 0, medium: 1, low: 2 };
function sevLabel(s) { return s === 'high' ? L('High', 'مرتفع') : s === 'medium' ? L('Medium', 'متوسط') : L('Low', 'منخفض'); }
function statusLabel(s) {
  return { open: L('Open', 'مفتوحة'), waiting: L('Waiting for sync', 'بانتظار المزامنة'), resolved: L('Resolved', 'محلولة'), dismissed: L('Dismissed', 'مغلقة') }[s] || s;
}
var CAT_AR = { 'Fashion': 'الأزياء', 'Electronics': 'الإلكترونيات', 'Beauty & Perfumes': 'التجميل والعطور', 'Food & Beverages': 'الأطعمة والمشروبات',
  'Home & Furniture': 'المنزل والأثاث', 'Health': 'الصحة', 'Gifts & Flowers': 'الهدايا والورود', 'Sports': 'الرياضة', 'Kids & Toys': 'الأطفال والألعاب', 'Others': 'أخرى', 'Other': 'أخرى' };
function trCat(c) { return isAr() && CAT_AR[c] ? CAT_AR[c] : c; }

/* ---------------- HTML bits ---------------- */
function tile(label, value, sub) {
  return '<div class="tile"><div class="t-label">' + esc(label) + '</div><div class="t-value">' + value + '</div>' +
    (sub ? '<div class="t-delta">' + sub + '</div>' : '') + '</div>';
}
function kpis(tiles) { return '<div class="kpis">' + tiles.join('') + '</div>'; }
function card(title, sub, body, head) {
  return '<section class="card">' + (title ? '<div class="card-head"><div><h3>' + esc(title) + '</h3>' + (sub ? '<p class="sub">' + sub + '</p>' : '') + '</div>' + (head || '') + '</div>' : '') + body + '</section>';
}
function pill(cls, text) { return '<span class="so-pill ' + cls + '"><i></i>' + esc(text) + '</span>'; }
function countedPill(r) {
  if (r.counted) return pill('good', L('Counted', 'محسوبة'));
  if (!r.won && !r.inv) return pill('muted', L('Pipeline', 'قيد العمل'));
  return pill('bad', L('Not counted', 'غير محسوبة'));
}
function sevDot(s) { return '<span class="sev-dot ' + s + '" title="' + esc(sevLabel(s)) + '"></span>'; }
function hsLink(id) {
  var s = (ST.snap && ST.snap.settings) || {};
  if (!s.hubspot_portal_id || s.hubspot_portal_id === '0000000') return 'https://app.hubspot.com/';
  return 'https://' + (s.hubspot_ui_domain || 'app.hubspot.com') + '/contacts/' + s.hubspot_portal_id + '/record/0-3/' + encodeURIComponent(id);
}
function emptyBox(icon, title, sub) {
  return '<div class="card empty-state"><div class="es-icon">' + (ICON[icon] || ICON.check) + '</div><h3>' + esc(title) + '</h3>' + (sub ? '<p class="sub">' + sub + '</p>' : '') + '</div>';
}
function progress(frac, marks) {
  frac = Math.max(0, Math.min(1, frac));
  return '<div class="so-progress"><div class="so-progress-fill" style="width:' + (frac * 100).toFixed(1) + '%"></div>' +
    (marks || []).map(function (m) { return '<span class="so-mark" style="inset-inline-start:' + (Math.min(1, m.at) * 100).toFixed(1) + '%" title="' + esc(m.label) + '"></span>'; }).join('') + '</div>';
}
function bar(frac, cls) {
  return '<span class="so-bar"><span class="' + (cls || '') + '" style="width:' + (Math.max(0, Math.min(1, frac)) * 100).toFixed(1) + '%"></span></span>';
}
function sortHead(view, key, label, cls) {
  var s = ST.v[view] || {}, on = s.sort === key;
  return '<th class="' + (cls || '') + '"><button class="th-sort" data-sort="' + key + '">' + esc(label) +
    (on ? (s.dir > 0 ? ' ↑' : ' ↓') : '') + '</button></th>';
}
function applySort(view, rows, getters, dflt) {
  var s = ST.v[view] = ST.v[view] || {};
  if (!s.sort) { s.sort = dflt; s.dir = -1; }
  var g = getters[s.sort];
  if (!g) return rows;
  return rows.slice().sort(function (a, b) {
    var x = g(a), y = g(b);
    if (typeof x === 'string') return x.localeCompare(y) * s.dir;
    return ((x || 0) - (y || 0)) * s.dir;
  });
}
function wireSort(el, view, rerender) {
  el.querySelectorAll('[data-sort]').forEach(function (b) {
    b.addEventListener('click', function () {
      var s = ST.v[view] = ST.v[view] || {}, k = b.getAttribute('data-sort');
      if (s.sort === k) s.dir = -s.dir; else { s.sort = k; s.dir = -1; }
      rerender();
    });
  });
}
function on(el, sel, ev, fn) { el.querySelectorAll(sel).forEach(function (n) { n.addEventListener(ev, function (e) { fn(n, e); }); }); }

function csvDownload(name, head, rows) {
  var q = function (v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  var txt = '﻿' + [head].concat(rows).map(function (r) { return r.map(q).join(','); }).join('\n');
  var a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([txt], { type: 'text/csv;charset=utf-8' }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
}

/* ---------------- icons (stroke, currentColor) ---------------- */
function svgI(d, sw) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (sw || 2) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>'; }
var ICON = {
  dash: svgI('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'),
  deals: svgI('<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>'),
  alert: svgI('<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17v.01"/>'),
  queue: svgI('<path d="M4 6h16M4 12h10M4 18h7"/><path d="m16 15 2 2 4-4"/>'),
  calc: svgI('<rect x="5" y="2.5" width="14" height="19" rx="2"/><path d="M8.5 6.5h7M8.5 11h.01M12 11h.01M15.5 11h.01M8.5 14.5h.01M12 14.5h.01M15.5 14.5h.01M8.5 18h.01M12 18h3.5"/>'),
  chart: svgI('<path d="M4 20V10m5.5 10V4m5.5 16v-8m5 8V7"/>'),
  team: svgI('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1.2-3 3.7-4.5 6.5-4.5s5.3 1.5 6.5 4.5M16 4.8a3.5 3.5 0 0 1 0 6.4M17.5 15.7c2 .6 3.4 1.9 4 4.3"/>'),
  trophy: svgI('<path d="M8 4h8v5a4 4 0 0 1-8 0V4Z"/><path d="M8 5H5a3 3 0 0 0 3 5M16 5h3a3 3 0 0 1-3 5M12 13v4m-4 4h8m-6.5-4h5"/>'),
  pie: svgI('<path d="M12 3a9 9 0 1 0 9 9h-9V3Z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15V3.5Z"/>'),
  store: svgI('<path d="M4 10 5.5 4h13L20 10M4 10v9a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-9M4 10h16M9.5 20v-6h5v6"/>'),
  scale: svgI('<path d="M12 3v18M5 7h14M5 7l-3 7a3 3 0 0 0 6 0L5 7Zm14 0-3 7a3 3 0 0 0 6 0l-3-7ZM8 21h8"/>'),
  money: svgI('<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/>'),
  key: svgI('<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M14 9l2 2"/>'),
  target: svgI('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>'),
  gear: svgI('<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"/>'),
  doc: svgI('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>'),
  pencil: svgI('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
  ban: svgI('<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>', 1.9),
  plug: svgI('<path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0V8ZM12 17v5"/>'),
  lock: svgI('<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>'),
  users: svgI('<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-3.6 4.5-5 8-5s6.5 1.4 8 5"/>'),
  check: svgI('<circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>'),
  ext: svgI('<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/>'),
  copy: svgI('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>'),
  tick: svgI('<path d="M5 12.5l4.5 4.5L19 7"/>', 2.6),
  x: svgI('<path d="M6 6l12 12M18 6 6 18"/>'),
  chat: svgI('<path d="M4 5h16v11H8l-4 4V5Z"/>'),
  refresh: svgI('<path d="M20 12a8 8 0 1 1-2.5-5.8"/><path d="M20 4v4.5h-4.5"/>'),
  sun: svgI('<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  chevronLeft: svgI('<path d="M15 18l-6-6 6-6"/>', 2.2),
  menu: svgI('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  globe: svgI('<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>'),
  download: svgI('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  link: svgI('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  flame: svgI('<path d="M12 21c4 0 7-2.7 7-6.6 0-3.4-2.3-5.3-3.7-7.4-.6 2-1.6 3-3 3.6.3-2.8-.7-5.6-3.3-7.6.2 3.8-4 6.5-4 11.1C5 18.3 8 21 12 21Z"/>')
};

/* ---------------- toast ---------------- */
var toastTimer = null;
function toast(msg) {
  var el = document.getElementById('so-toast');
  if (!el) { el = document.createElement('div'); el.id = 'so-toast'; el.className = 'so-toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.hidden = true; }, 3400);
}

/* ---------------- dialog ----------------
   opts: { title, sub, body (html), confirm (label), onConfirm(dlgEl) -> false keeps it open } */
function dialog(opts) {
  closeDialog();
  var bg = document.createElement('div');
  bg.className = 'so-dlg-bg'; bg.id = 'so-dlg';
  bg.innerHTML = '<div class="so-dlg card" role="dialog" aria-modal="true" aria-label="' + esc(opts.title) + '">' +
    '<div><h2>' + esc(opts.title) + '</h2>' + (opts.sub ? '<p class="sub">' + opts.sub + '</p>' : '') + '</div>' +
    (opts.body ? '<div class="so-dlg-body">' + opts.body + '</div>' : '') +
    '<div class="so-dlg-foot"><button class="btn secondary" data-dlg="cancel">' + L('Cancel', 'إلغاء') + '</button>' +
    (opts.confirm ? '<button class="btn" data-dlg="ok">' + esc(opts.confirm) + '</button>' : '') + '</div></div>';
  document.body.appendChild(bg);
  bg.addEventListener('click', function (e) { if (e.target === bg) closeDialog(); });
  bg.querySelector('[data-dlg=cancel]').addEventListener('click', closeDialog);
  var ok = bg.querySelector('[data-dlg=ok]');
  if (ok) ok.addEventListener('click', function () { if (opts.onConfirm && opts.onConfirm(bg) === false) return; closeDialog(); });
  if (opts.wire) opts.wire(bg);
  var f = bg.querySelector('input,select,textarea') || ok;
  if (f) f.focus();
  return bg;
}
function closeDialog() { var d = document.getElementById('so-dlg'); if (d) d.remove(); }
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeDialog(); closeDrawer(); } });

/* ---------------- deal drawer ---------------- */
function closeDrawer() { ['so-drawer', 'so-drawer-bg'].forEach(function (id) { var x = document.getElementById(id); if (x) x.remove(); }); }
function openDeal(id) {
  var r = ST.model.byId[id];
  if (!r) return;
  closeDrawer();
  var bg = document.createElement('div'); bg.className = 'drawer-backdrop'; bg.id = 'so-drawer-bg';
  var d = document.createElement('aside'); d.className = 'drawer so-drawer'; d.id = 'so-drawer';
  d.setAttribute('role', 'dialog'); d.setAttribute('aria-label', L('Deal details', 'تفاصيل الصفقة'));
  var issues = r.allIssues.filter(function (i) { return i.status !== 'dismissed'; });
  d.innerHTML =
    '<div class="so-drawer-head"><div><p class="sub">' + esc(nameOf(r.owner)) + ' · ' + esc(r.stage) + ' · #' + esc(r.id) + '</p>' +
      '<h2 dir="auto">' + esc(r.merchant) + '</h2><div class="so-row">' + pill('muted', r.type) + countedPill(r) + '</div></div>' +
      '<button class="icon-btn" data-close aria-label="' + L('Close', 'إغلاق') + '">' + ICON.x + '</button></div>' +
    '<div class="so-drawer-body">' +
      issues.map(function (i) {
        var mine = isRep() && r.owner === lcEmail(me().email);
        var canFix = i.status === 'open' && (mine || isMgr()) && i.kind !== 'duplicate' && i.kind !== 'owner_gap';
        return '<div class="so-issue-box ' + i.sev + '"><p><b>' + sevDot(i.sev) + ' ' + esc(issueTitle(i.kind)) + '</b> · ' + esc(statusLabel(i.status)) + '</p>' +
          '<p class="sub">' + esc(issueWhy(i.kind)) + '</p>' +
          '<p><b>' + L('Fix', 'الحل') + ':</b> ' + esc(issueFix(i.kind)) + '</p>' +
          '<p class="sub">' + (i.counts ? L('Still counts', 'محسوبة رغم ذلك') : L('Not counted until fixed', 'غير محسوبة حتى الحل')) + ' · ' + money(i.stake) + '</p>' +
          (canFix ? '<button class="btn" data-fix="' + i.kind + '" style="margin-top:8px">' + L('I fixed it in HubSpot', 'أصلحتها في HubSpot') + '</button>' : '') +
          (i.status === 'waiting' ? '<p class="sub" style="margin-top:6px">' + L('Waiting for the next sync to confirm the fix.', 'بانتظار المزامنة القادمة لتأكيد الحل.') + '</p>' : '') +
        '</div>';
      }).join('') +
      '<h3 class="so-sec">' + L('Amounts', 'المبالغ') + '</h3>' +
      [[L('HubSpot amount', 'مبلغ HubSpot'), money(r.hs)], [L('Invoice net (Metabase)', 'صافي الفاتورة (Metabase)'), r.invoices.length ? money(r.inv) : '—'],
       [L('Counted', 'المحسوب'), r.counted ? money(r.countedAmount) : '—'], [L('Close date', 'تاريخ الإغلاق'), dateShort(r.deal.close_date)],
       [L('Invoice month', 'شهر الفاتورة'), r.invMonth ? monthName(r.invMonth) : '—'], [L('Invoice', 'الفاتورة'), r.invoiceNo || '—'],
       [L('Store ID', 'رقم المتجر'), r.storeId || '—'], [L('Sector', 'القطاع'), trCat(r.category)]]
        .map(function (kv) { return '<div class="so-kv"><span>' + esc(kv[0]) + '</span><b>' + kv[1] + '</b></div>'; }).join('') +
    '</div>' +
    '<div class="so-drawer-foot"><a class="btn" href="' + esc(hsLink(r.id)) + '" target="_blank" rel="noopener">' + L('Open in HubSpot', 'افتح في HubSpot') + ' ↗</a>' +
      '<button class="btn secondary" data-copy>' + L('Copy deal ID', 'نسخ رقم الصفقة') + '</button></div>';
  document.body.appendChild(bg); document.body.appendChild(d);
  bg.addEventListener('click', closeDrawer);
  d.querySelector('[data-close]').addEventListener('click', closeDrawer);
  d.querySelector('[data-copy]').addEventListener('click', function () { copyText(r.id); });
  on(d, '[data-fix]', 'click', function (b) { markFixed(r.id, b.getAttribute('data-fix')); closeDrawer(); });
}
function copyText(s) {
  (navigator.clipboard ? navigator.clipboard.writeText(s) : Promise.reject()).then(function () { toast(L('Copied', 'تم النسخ')); }, function () { toast(s); });
}
// "I fixed it": the issue waits for the next sync, which confirms it.
function markFixed(id, kind) {
  SO_API.W.setIssue(id, kind, { status: 'waiting' }).then(function () {
    SO_API.W.audit('issue', 'Marked fixed: ' + (ST.model.byId[id] || {}).merchant + ' (' + kind + ')');
    toast(L('Marked as fixed. It counts once the next sync confirms it.', 'سُجلت كمحلولة. تُحتسب بعد تأكيد المزامنة القادمة.'));
    reload();
  }, failToast);
}
function failToast(e) { console.error(e); toast(L('That did not save. Try again.', 'لم يُحفظ. حاول مرة أخرى.')); }
