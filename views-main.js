/* ============================================================
   Sales Ops Portal: Overview, Deals, Issues, Queue, Calculator
   ============================================================ */

function monthRows() { return ST.model.rows.filter(function (r) { return r.month === ST.month && inScope(r); }); }
function teamMonth(month) {
  var out = { closed: 0, target: 0, stores: 0, comm: 0, held: 0, atStake: 0, reps: [] };
  scopeEmails().forEach(function (e) {
    var rm = SO.repMonth(ST.model, e, month);
    out.reps.push(rm);
    out.closed += rm.closed; out.target += rm.target; out.stores += rm.stores; out.atStake += rm.atStake;
    if (rm.calc.held) out.held += rm.calc.amount; else out.comm += rm.calc.amount;
  });
  return out;
}
function tierName(i) { return L('Tier ', 'الشريحة ') + (i + 1); }

/* ---------------- Overview ---------------- */
VIEWS.overview = {
  title: function () { return L('Overview', 'نظرة عامة'); },
  sub: function () { return isRep() ? L('Your month at a glance: what counts, what pays, what needs fixing.', 'شهرك باختصار: ما يُحتسب، وما يُصرف، وما يحتاج إصلاحًا.') : L('The team this month, from HubSpot deals and Metabase invoices.', 'الفريق هذا الشهر من صفقات HubSpot وفواتير Metabase.'); },
  controls: { month: true, reps: true },
  render: function (el) {
    var m = ST.month, months = SO.monthsBack(m, 12);
    var single = scopeEmails().length === 1;
    var rm = single ? SO.repMonth(ST.model, scopeEmails()[0], m) : null;
    var tm = teamMonth(m);
    var html = '';

    if (rm) {
      var c = rm.calc, rules = ST.model.rules;
      var planTiers = SO.tierFor(rules, 0, rm.plan).all;
      var maxPct = Math.max(130, (planTiers[planTiers.length - 1] || {}).from + 30, (rules.accelerator || {}).above_pct || 0);
      var marks = planTiers.filter(function (t) { return t.from > 0; }).map(function (t) { return { at: t.from / maxPct, label: t.from + '% · ' + t.rate + '%' }; });
      var next = c.nextTier;
      var nextNeed = next ? Math.max(0, rm.target * next.from / 100 - rm.closed) : 0;
      var nextComm = next ? SO.whatIf(ST.model, rm, nextNeed, 0) : null;
      html += '<section class="card so-hero">' +
        '<div class="so-hero-top"><div>' +
          '<p class="t-label">' + L('Commission this month', 'عمولة هذا الشهر') + ' <span class="so-plan">' + esc(planName(rm.plan)) + (rm.tenure ? ' · ' + L('month ' + rm.tenure, 'الشهر ' + rm.tenure) : '') + '</span></p>' +
          '<p class="so-hero-value">' + money(c.amount) + '</p>' +
          '<p class="sub">' + tierName(c.tierIndex) + ' · ' + c.rate + '% ' + L('on', 'على') + ' ' + money(rm.closed) + ' ' + L('counted', 'محسوبة') +
            (c.accel ? ' · ' + L('accelerator', 'مسرّع') + ' ' + money(c.accel) : '') +
            (c.sectorBlocked ? ' <span class="so-held">' + ICON.lock + L('No commission until the sector minimum is met', 'لا عمولة حتى تحقيق حد القطاع') + '</span>' : '') +
            (c.held ? ' <span class="so-held">' + ICON.lock + L('Held: ' + c.storesShort + ' more ' + (c.storesShort === 1 ? 'store' : 'stores') + ' needed', 'محجوزة: تحتاج ' + c.storesShort + ' متاجر إضافية') + '</span>' : '') + '</p>' +
        '</div><div class="so-checks">' +
          check(rm.target > 0, L('Target set', 'الهدف محدد') + ' · ' + moneyC(rm.target)) +
          check(rm.stores >= c.minStores || rm.exception, rm.stores + ' / ' + c.minStores + ' ' + L('stores', 'متجر') + (rm.exception ? ' · ' + L('exception', 'استثناء') : '')) +
          (rm.plan.sector_min_stores ? check(rm.sectorOk, rm.sector ? rm.sectorStores + ' / ' + rm.plan.sector_min_stores + ' ' + L('stores in ', 'متاجر في ') + trCat(rm.sector) : L('Sector not set yet', 'لم يُحدد القطاع بعد')) : '') +
          check(!rm.issues.length, rm.issues.length ? rm.issues.length + ' ' + L('open issues', 'مشكلات مفتوحة') : L('No open issues', 'لا مشكلات مفتوحة')) +
        '</div></div>' +
        progress(rm.target ? rm.closed / rm.target * 100 / maxPct : 0, marks) +
        '<div class="so-hero-legend"><span>' + L('Counted', 'المحسوب') + ' <b>' + money(rm.closed) + '</b></span>' +
          '<span>' + pct(rm.target ? rm.closed / rm.target : 0) + ' ' + L('of target', 'من الهدف') + '</span>' +
          '<span>' + L('Target', 'الهدف') + ' <b>' + money(rm.target) + '</b>' + (rm.targetStated !== rm.target ? ' <span class="sub">(' + money(rm.targetStated) + L(' incl. VAT', ' شامل الضريبة') + ')</span>' : '') + '</span></div>' +
        (next ? '<div class="so-next"><div class="so-next-ic">' + ICON.target + '</div><div><p><b>' + L('Next: ', 'التالي: ') + tierName(c.tierIndex + 1) + ' (' + next.rate + '%) ' + L('at', 'عند') + ' ' + next.from + '%</b></p>' +
          '<p class="sub">' + L('Close ', 'أغلق ') + money(nextNeed) + L(' more to get there.', ' إضافية للوصول.') + '</p></div>' +
          '<div class="so-next-r"><p class="sub">' + L('Commission then', 'العمولة حينها') + '</p><p><b>' + money(nextComm.amount) + '</b> <span class="money-pos">' + signed(nextComm.amount - c.amount) + '</span></p></div></div>' : '') +
      '</section>';
      html += kpis([
        tile(L('Counted', 'المحسوب'), moneyC(rm.closed), L('Invoice net, this month', 'صافي الفواتير هذا الشهر')),
        tile(L('Stores', 'المتاجر'), fmtNum(rm.stores), L('Minimum ', 'الحد الأدنى ') + c.minStores),
        tile(L('HubSpot closed won', 'المغلق في HubSpot'), moneyC(rm.hsClosed), L('Before invoice checks', 'قبل مطابقة الفواتير')),
        tile(L('At stake', 'معرّض للخسارة'), moneyC(rm.atStake), L('Not counted until fixed', 'غير محسوب حتى الإصلاح'))
      ]);
    } else {
      html += kpis([
        tile(L('Team counted', 'محسوب الفريق'), moneyC(tm.closed), pct(tm.target ? tm.closed / tm.target : 0) + ' ' + L('of target', 'من الهدف')),
        tile(L('Stores closed', 'المتاجر المغلقة'), fmtNum(tm.stores), tm.reps.length + ' ' + L('employees', 'موظف') + ' · ' + L('target ', 'الهدف ') + moneyC(tm.target)),
        tile(L('Commission due', 'العمولة المستحقة'), moneyC(tm.comm), L('Held: ', 'محجوز: ') + moneyC(tm.held)),
        tile(L('At stake', 'معرّض للخسارة'), moneyC(tm.atStake), L('Open issues, not counted', 'مشكلات مفتوحة غير محسوبة'))
      ]);
    }

    // needs attention
    var att = [];
    monthRows().forEach(function (r) { r.issues.forEach(function (i) { att.push({ r: r, i: i }); }); });
    att.sort(function (a, b) { return (SEV_ORDER[a.i.sev] - SEV_ORDER[b.i.sev]) || (b.i.stake - a.i.stake); });
    var rc = SO.recon(ST.model, m, scopeEmails());
    html += '<div class="grid-2">' +
      card(L('Needs attention', 'يحتاج انتباهك'), L('Biggest open issues this month', 'أكبر المشكلات المفتوحة هذا الشهر'),
        att.length ? '<div class="tbl-wrap"><table><thead><tr><th>' + L('Merchant', 'التاجر') + '</th><th>' + L('Issue', 'المشكلة') + '</th><th class="num">' + L('At stake', 'المبلغ') + '</th></tr></thead><tbody>' +
          att.slice(0, 6).map(function (x) {
            return '<tr class="rowlink" data-deal="' + esc(x.r.id) + '"><td><b dir="auto">' + esc(x.r.merchant) + '</b><span class="cell-sub">' + esc(nameOf(x.r.owner)) + '</span></td>' +
              '<td>' + sevDot(x.i.sev) + ' ' + esc(issueTitle(x.i.kind)) + '</td><td class="num">' + money(x.i.stake) + '</td></tr>';
          }).join('') + '</tbody></table></div>' : '<p class="sub so-ok">' + ICON.check + L('Nothing needs fixing. Every won deal lines up with an invoice.', 'لا شيء يحتاج إصلاحًا. كل صفقة مغلقة تطابقها فاتورة.') + '</p>',
        att.length > 6 ? '<a class="ghost-btn" href="#/issues">' + L('See all ', 'عرض الكل ') + att.length + '</a>' : '') +
      card(L('HubSpot vs Metabase', 'HubSpot مقابل Metabase'), L('Closed won against invoiced, this month', 'المغلق مقابل المفوتر هذا الشهر'),
        '<div class="so-recon-mini"><div><span>HubSpot</span><b>' + money(rc.hs) + '</b></div><div><span>Metabase</span><b>' + money(rc.mb) + '</b></div>' +
        '<div><span>' + L('Gap', 'الفرق') + '</span><b class="' + (rc.gap < 0 ? 'so-neg' : 'money-pos') + '">' + signed(rc.gap) + '</b></div></div>',
        isRep() && !isFin() ? '' : '<a class="ghost-btn" href="#/recon">' + L('Reconcile', 'المطابقة') + '</a>') +
    '</div>';

    // trends
    var counted = months.map(function (mk) { return scopeEmails().reduce(function (s, e) { return s + SO.repMonth(ST.model, e, mk).closed; }, 0); });
    var targets = months.map(function (mk) { return scopeEmails().reduce(function (s, e) { return s + SO.targetFor(ST.model, e, mk).target; }, 0); });
    var labels = months.map(function (k) { return monthName(k, true); });
    html += '<div class="grid-2">' +
      chartCard({ title: L('Counted vs target', 'المحسوب مقابل الهدف'), subtitle: L('Last 12 months', 'آخر 12 شهرًا'),
        legend: [{ cls: 's1', label: L('Counted', 'المحسوب') }, { cls: 's2', label: L('Target', 'الهدف') }],
        svg: groupedColumnsSVG(labels, counted, targets, { nameA: L('Counted', 'المحسوب'), nameB: L('Target', 'الهدف'), aria: 'Counted vs target' }),
        table: { head: [L('Month', 'الشهر'), L('Counted', 'المحسوب'), L('Target', 'الهدف')], rows: months.map(function (k, i) { return [monthName(k), money(counted[i]), money(targets[i])]; }) } }) +
      pipelineCard() + '</div>';

    if (!rm) html += ranksRow(tm, m);
    el.innerHTML = html;
    on(el, '[data-deal]', 'click', function (n) { openDeal(n.getAttribute('data-deal')); });
  }
};
function check(ok, text) { return '<span class="so-check ' + (ok ? 'ok' : 'no') + '"><span>' + (ok ? '✓' : '!') + '</span>' + esc(text) + '</span>'; }
function pipelineCard() {
  var open = ST.model.rows.filter(function (r) { return !r.closed && inScope(r); });
  var order = ['Prospect', 'Qualified', 'SQL', 'Commit'];
  var by = {};
  open.forEach(function (r) { by[r.stage] = (by[r.stage] || 0) + 1; });
  var stages = order.filter(function (s) { return by[s]; }).concat(Object.keys(by).filter(function (s) { return order.indexOf(s) < 0; }));
  var rows = stages.map(function (s) { return { stage: s, count: by[s] }; });
  var val = open.reduce(function (s, r) { return s + r.hs; }, 0);
  return chartCard({ title: L('Open pipeline', 'الصفقات المفتوحة'), subtitle: fmtNum(open.length) + ' ' + L('deals', 'صفقة') + ' · ' + moneyC(val) + ' ' + L('in HubSpot', 'في HubSpot'),
    svg: rows.length ? funnelSVG(rows) : '<div class="empty">' + t('noData') + '</div>',
    table: { head: [L('Stage', 'المرحلة'), L('Deals', 'الصفقات')], rows: rows.map(function (r) { return [r.stage, fmtNum(r.count)]; }) } });
}
function ranksRow(tm, m) {
  function list(title, sub, rows) {
    var max = Math.max.apply(null, rows.map(function (r) { return r.v; }).concat([1]));
    return '<section class="card"><div class="card-head"><div><h3>' + esc(title) + '</h3><p class="sub">' + esc(sub) + '</p></div></div>' +
      (rows.length ? rows.map(function (r) {
        return '<div class="so-rank"' + (r.href ? ' data-href="' + r.href + '"' : '') + '><div class="so-rank-top"><span><b dir="auto">' + esc(r.label) + '</b>' + (r.sub ? '<span class="cell-sub">' + esc(r.sub) + '</span>' : '') + '</span><b>' + r.fmt + '</b></div>' + bar(r.v / max) + '</div>';
      }).join('') : '<p class="sub">' + t('noData') + '</p>') + '</section>';
  }
  var byRep = tm.reps.slice().sort(function (a, b) { return b.closed - a.closed; }).slice(0, 5)
    .map(function (rm) { return { label: nameOf(rm.email), sub: pct(rm.target ? rm.closed / rm.target : 0) + ' ' + L('of target', 'من الهدف'), v: rm.closed, fmt: moneyC(rm.closed) }; });
  var cat = {};
  monthRows().forEach(function (r) { if (r.counted) cat[r.category] = (cat[r.category] || 0) + r.countedAmount; });
  var bySec = Object.keys(cat).map(function (k) { return { label: trCat(k), v: cat[k], fmt: moneyC(cat[k]) }; }).sort(function (a, b) { return b.v - a.v; }).slice(0, 5);
  var stake = tm.reps.filter(function (r) { return r.atStake > 0; }).sort(function (a, b) { return b.atStake - a.atStake; }).slice(0, 5)
    .map(function (rm) { return { label: nameOf(rm.email), sub: rm.issues.length + ' ' + L('issues', 'مشكلة'), v: rm.atStake, fmt: moneyC(rm.atStake) }; });
  return '<div class="so-grid-3">' + list(L('Top employees', 'أفضل الموظفين'), L('Counted this month', 'المحسوب هذا الشهر'), byRep) +
    list(L('Top sectors', 'أعلى القطاعات'), L('Counted SAR by store sector', 'المحسوب حسب قطاع المتجر'), bySec) +
    list(L('Most at stake', 'الأكثر عرضة'), L('Not counted until fixed', 'غير محسوب حتى الإصلاح'), stake) + '</div>';
}

/* ---------------- Deals ---------------- */
VIEWS.deals = {
  title: function () { return isRep() ? L('My deals', 'صفقاتي') : L('Deals', 'الصفقات'); },
  sub: function () { return L('Every deal for the month, with its HubSpot and invoice amounts side by side.', 'كل صفقات الشهر بمبلغ HubSpot ومبلغ الفاتورة جنبًا إلى جنب.'); },
  controls: { month: true, reps: true },
  render: function (el) {
    var s = ST.v.deals = ST.v.deals || { q: '', chip: 'all' };
    var all = monthRows();
    var chips = [
      ['all', L('All', 'الكل'), function () { return true; }],
      ['counted', L('Counted', 'محسوبة'), function (r) { return r.counted; }],
      ['not', L('Not counted', 'غير محسوبة'), function (r) { return !r.counted && (r.won || r.inv); }],
      ['issue', L('With an issue', 'بها مشكلة'), function (r) { return r.issues.length > 0; }],
      ['open', L('Open pipeline', 'مفتوحة'), function (r) { return !r.closed; }]
    ];
    var f = chips.filter(function (c) { return c[0] === s.chip; })[0][2];
    var q = s.q.trim().toLowerCase();
    var rows = all.filter(f).filter(function (r) {
      return !q || (r.merchant + ' ' + r.id + ' ' + r.storeId + ' ' + nameOf(r.owner) + ' ' + r.invoiceNo).toLowerCase().indexOf(q) >= 0;
    });
    rows = applySort('deals', rows, { merchant: function (r) { return r.merchant; }, date: function (r) { return new Date(r.deal.close_date || 0).getTime(); }, hs: function (r) { return r.hs; }, inv: function (r) { return r.inv; } }, 'date');
    var counted = rows.filter(function (r) { return r.counted; }).reduce(function (a, r) { return a + r.countedAmount; }, 0);
    el.innerHTML =
      '<div class="filter-row"><input type="search" class="search-input" id="dl-q" placeholder="' + L('Search merchant, deal, store, invoice', 'ابحث بالتاجر أو الصفقة أو المتجر أو الفاتورة') + '" value="' + esc(s.q) + '">' +
        '<div class="seg">' + chips.map(function (c) { return '<button data-chip="' + c[0] + '" class="' + (c[0] === s.chip ? 'active' : '') + '">' + esc(c[1]) + '</button>'; }).join('') + '</div>' +
        '<span class="spacer"></span><button class="btn secondary so-ib" id="dl-csv">' + ICON.download + L('Export CSV', 'تصدير CSV') + '</button></div>' +
      '<p class="sub">' + fmtNum(rows.length) + ' ' + L('deals', 'صفقة') + ' · ' + money(counted) + ' ' + L('counted', 'محسوبة') + '</p>' +
      '<section class="card so-flush"><div class="tbl-wrap"><table><thead><tr>' +
        sortHead('deals', 'merchant', L('Merchant', 'التاجر')) + '<th>' + L('Type', 'النوع') + '</th>' + sortHead('deals', 'date', L('Close date', 'الإغلاق')) +
        sortHead('deals', 'hs', 'HubSpot', 'num') + sortHead('deals', 'inv', L('Invoice', 'الفاتورة'), 'num') +
        '<th>' + L('Counts?', 'محسوبة؟') + '</th><th>' + L('Issue', 'المشكلة') + '</th><th></th></tr></thead><tbody>' +
        (rows.length ? rows.slice(0, 400).map(function (r) {
          var i = r.issues[0];
          return '<tr><td><button class="linklike" data-deal="' + esc(r.id) + '" dir="auto">' + esc(r.merchant) + '</button><span class="cell-sub">' + esc(nameOf(r.owner)) + (r.storeId ? ' · ' + esc(r.storeId) : '') + '</span></td>' +
            '<td>' + pill('muted', r.type) + '</td><td>' + dateShort(r.deal.close_date) + '<span class="cell-sub">' + esc(r.stage) + '</span></td>' +
            '<td class="num">' + money(r.hs) + '</td><td class="num">' + (r.invoices.length ? money(r.inv) : '—') + '</td>' +
            '<td>' + countedPill(r) + '</td><td>' + (i ? sevDot(i.sev) + ' ' + esc(issueTitle(i.kind)) : '') + '</td>' +
            '<td><a class="ghost-btn" href="' + esc(hsLink(r.id)) + '" target="_blank" rel="noopener">HubSpot ↗</a></td></tr>';
        }).join('') : '<tr><td colspan="8"><p class="sub" style="padding:18px 0;text-align:center">' + L('No deals match.', 'لا توجد صفقات مطابقة.') + ' <button class="linklike" id="dl-clear">' + L('Clear filters', 'مسح الفلاتر') + '</button></p></td></tr>') +
      '</tbody></table></div></section>';
    var qi = el.querySelector('#dl-q');
    qi.addEventListener('input', function () { s.q = qi.value; VIEWS.deals.render(el); var n = el.querySelector('#dl-q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); });
    on(el, '[data-chip]', 'click', function (b) { s.chip = b.getAttribute('data-chip'); VIEWS.deals.render(el); });
    on(el, '[data-deal]', 'click', function (b) { openDeal(b.getAttribute('data-deal')); });
    var cl = el.querySelector('#dl-clear'); if (cl) cl.addEventListener('click', function () { s.q = ''; s.chip = 'all'; VIEWS.deals.render(el); });
    wireSort(el, 'deals', function () { VIEWS.deals.render(el); });
    el.querySelector('#dl-csv').addEventListener('click', function () {
      csvDownload('deals-' + ST.month + '.csv', ['Deal ID', 'Merchant', 'Rep', 'Store ID', 'Type', 'Stage', 'Close date', 'HubSpot amount', 'Invoice net', 'Invoice', 'Counted', 'Issue'],
        rows.map(function (r) { return [r.id, r.merchant, nameOf(r.owner), r.storeId, r.type, r.stage, (r.deal.close_date || '').slice(0, 10), r.hs, r.inv, r.invoiceNo, r.counted ? r.countedAmount : 0, r.issues.map(function (i) { return issueTitle(i.kind); }).join('; ')]; }));
    });
  }
};

/* ---------------- Issues ---------------- */
VIEWS.issues = {
  title: function () { return L('Issues', 'المشكلات'); },
  sub: function () { return L('Mismatches between HubSpot and Metabase that change what counts. Fix them in HubSpot; the next sync confirms.', 'اختلافات بين HubSpot وMetabase تغيّر ما يُحتسب. أصلحها في HubSpot وتؤكدها المزامنة.'); },
  controls: { month: true, reps: true },
  render: function (el) {
    var s = ST.v.issues = ST.v.issues || { tab: 'open', group: 'impact' };
    var list = [], hist = [];
    monthRows().forEach(function (r) {
      r.allIssues.forEach(function (i) { (i.status === 'open' || i.status === 'waiting' ? list : hist).push({ r: r, i: i }); });
    });
    var stake = list.filter(function (x) { return !x.i.counts; }).reduce(function (a, x) { return a + x.i.stake; }, 0);
    var cutoff = SO.cutoffOf(ST.model.rules, ST.month);
    var html = kpis([
      tile(L('Open', 'مفتوحة'), fmtNum(list.filter(function (x) { return x.i.status === 'open'; }).length)),
      tile(L('Not counted', 'غير محسوبة'), moneyC(stake), L('Until fixed', 'حتى الإصلاح')),
      tile(L('Waiting for sync', 'بانتظار المزامنة'), fmtNum(list.filter(function (x) { return x.i.status === 'waiting'; }).length)),
      tile(L('Resolved this month', 'حُلّت هذا الشهر'), fmtNum(hist.filter(function (x) { return x.i.status === 'resolved'; }).length))
    ]);
    html += '<section class="card so-flush"><div class="so-tabbar"><div class="seg"><button data-tab="open" class="' + (s.tab === 'open' ? 'active' : '') + '">' + L('Open', 'المفتوحة') + ' (' + list.length + ')</button>' +
      '<button data-tab="hist" class="' + (s.tab === 'hist' ? 'active' : '') + '">' + L('History', 'السجل') + ' (' + hist.length + ')</button></div>' +
      '<span class="sub">' + L('Fix by ', 'أصلح قبل ') + dateShort(cutoff) + L(' to count in this payout', ' لتُحتسب في هذا الصرف') + '</span><span class="spacer"></span>' +
      (s.tab === 'open' ? '<div class="seg"><button data-group="impact" class="' + (s.group === 'impact' ? 'active' : '') + '">' + L('By impact', 'حسب الأثر') + '</button><button data-group="fix" class="' + (s.group === 'fix' ? 'active' : '') + '">' + L('By fix', 'حسب الحل') + '</button></div>' : '') + '</div>';
    if (s.tab === 'open') {
      if (!list.length) html += '<div class="empty-state"><div class="es-icon">' + ICON.check + '</div><h3>' + L('All clear', 'لا مشكلات') + '</h3><p class="sub">' + L('Every won deal this month lines up with its invoice.', 'كل صفقة مغلقة هذا الشهر تطابق فاتورتها.') + '</p></div>';
      else {
        var groups = {};
        list.forEach(function (x) { var k = s.group === 'fix' ? x.i.kind : x.i.sev; (groups[k] = groups[k] || []).push(x); });
        var keys = Object.keys(groups).sort(function (a, b) { return s.group === 'fix' ? a.localeCompare(b) : SEV_ORDER[a] - SEV_ORDER[b]; });
        html += '<div class="tbl-wrap"><table><thead><tr><th>' + L('Merchant', 'التاجر') + '</th><th>' + L('Age', 'العمر') + '</th><th>' + L('Issue', 'المشكلة') + '</th><th>' + L('Counts?', 'محسوبة؟') + '</th><th class="num">' + L('At stake', 'المبلغ') + '</th><th>' + L('Status', 'الحالة') + '</th><th></th></tr></thead><tbody>' +
          keys.map(function (k) {
            var g = groups[k].sort(function (a, b) { return b.i.stake - a.i.stake; });
            return '<tr class="so-group"><td colspan="7"><b>' + esc(s.group === 'fix' ? issueTitle(k) : sevLabel(k) + L(' impact', ' الأثر')) + '</b>' + (s.group === 'fix' ? ' <span class="sub">' + L('Fix', 'الحل') + ': ' + esc(issueFix(k)) + '</span>' : '') + '</td></tr>' +
              g.map(function (x) {
                var r = x.r, i = x.i;
                var mine = r.owner === lcEmail(me().email);
                var canFix = i.status === 'open' && (mine || isMgr()) && i.kind !== 'duplicate' && i.kind !== 'owner_gap';
                return '<tr class="rowlink" data-deal="' + esc(r.id) + '"><td>' + sevDot(i.sev) + ' <b dir="auto">' + esc(r.merchant) + '</b><span class="cell-sub">' + esc(nameOf(r.owner)) + ' · ' + esc(r.invoiceNo || r.id) + '</span></td>' +
                  '<td>' + daysSince(r.deal.close_date) + L('d', 'ي') + '</td><td>' + esc(issueTitle(i.kind)) + '<span class="cell-sub">' + esc(issueWhy(i.kind)) + '</span></td>' +
                  '<td>' + (i.counts ? L('Yes', 'نعم') : '<b class="so-neg">' + L('No', 'لا') + '</b>') + '</td><td class="num">' + money(i.stake) + '</td>' +
                  '<td>' + pill(i.status === 'waiting' ? 'warn' : 'muted', statusLabel(i.status)) + '</td>' +
                  '<td class="so-acts"><a class="icon-btn" href="' + esc(hsLink(r.id)) + '" target="_blank" rel="noopener" title="' + L('Open in HubSpot', 'افتح في HubSpot') + '">' + ICON.ext + '</a>' +
                  (r.invoiceNo ? '<button class="icon-btn" data-copy="' + esc(r.invoiceNo) + '" title="' + L('Copy invoice number', 'نسخ رقم الفاتورة') + '">' + ICON.copy + '</button>' : '') +
                  (canFix ? '<button class="icon-btn so-cta-ic" data-fix="' + esc(r.id) + '|' + i.kind + '" title="' + L('I fixed it', 'أصلحتها') + '">' + ICON.tick + '</button>' : '') + '</td></tr>';
              }).join('');
          }).join('') + '</tbody></table></div>';
      }
    } else {
      html += hist.length ? '<div class="tbl-wrap"><table><thead><tr><th>' + L('Merchant', 'التاجر') + '</th><th>' + L('Issue', 'المشكلة') + '</th><th>' + L('Status', 'الحالة') + '</th><th class="num">' + L('Amount', 'المبلغ') + '</th></tr></thead><tbody>' +
        hist.map(function (x) { return '<tr class="rowlink" data-deal="' + esc(x.r.id) + '"><td dir="auto">' + esc(x.r.merchant) + '</td><td>' + esc(issueTitle(x.i.kind)) + '</td><td>' + pill(x.i.status === 'resolved' ? 'good' : 'muted', statusLabel(x.i.status)) + '</td><td class="num">' + money(x.i.stake) + '</td></tr>'; }).join('') +
        '</tbody></table></div>' : '<p class="sub" style="padding:20px">' + L('No resolved or dismissed issues for this month yet.', 'لا توجد مشكلات محلولة أو مغلقة لهذا الشهر بعد.') + '</p>';
    }
    html += '</section>';
    el.innerHTML = html;
    on(el, '[data-tab]', 'click', function (b) { s.tab = b.getAttribute('data-tab'); VIEWS.issues.render(el); });
    on(el, '[data-group]', 'click', function (b) { s.group = b.getAttribute('data-group'); VIEWS.issues.render(el); });
    on(el, 'tr[data-deal]', 'click', function (n, e) { if (e.target.closest('a,button')) return; openDeal(n.getAttribute('data-deal')); });
    on(el, '[data-copy]', 'click', function (b) { copyText(b.getAttribute('data-copy')); });
    on(el, '[data-fix]', 'click', function (b) { var p = b.getAttribute('data-fix').split('|'); markFixed(p[0], p[1]); });
  }
};

/* ---------------- Exception queue (management) ---------------- */
VIEWS.queue = {
  title: function () { return L('Exception queue', 'قائمة الاستثناءات'); },
  sub: function () { return L('Cases an employee cannot fix alone: duplicates, ownership, and anything assigned to management.', 'حالات لا يحلها الموظف وحده: التكرار والملكية وما أُسند للإدارة.'); },
  controls: { month: true, reps: true },
  render: function (el) {
    var s = ST.v.queue = ST.v.queue || { rule: '', rep: '' };
    var items = [];
    monthRows().forEach(function (r) { r.issues.forEach(function (i) { items.push({ r: r, i: i }); }); });
    var rows = items.filter(function (x) { return (!s.rule || x.i.kind === s.rule) && (!s.rep || x.r.owner === s.rep); })
      .sort(function (a, b) { return daysSince(b.r.deal.close_date) - daysSince(a.r.deal.close_date); });
    var mgrs = ST.model.users.filter(function (u) { return (u.role === 'manager' || u.role === 'admin') && u.active !== false; });
    var comments = ST.snap.comments || [];
    // month over month counts per rule
    var prev = SO.addMonths(ST.month, -1);
    var trend = Object.keys(ISSUE).map(function (k) {
      var c = function (mk) { return ST.model.rows.filter(function (r) { return r.month === mk && inScope(r) && r.allIssues.some(function (i) { return i.kind === k; }); }).length; };
      return { k: k, a: c(prev), b: c(ST.month) };
    });
    el.innerHTML =
      '<div class="filter-row"><select id="q-rule"><option value="">' + L('All rules', 'كل القواعد') + '</option>' + Object.keys(ISSUE).map(function (k) { return '<option value="' + k + '"' + (s.rule === k ? ' selected' : '') + '>' + esc(issueTitle(k)) + '</option>'; }).join('') + '</select>' +
        '<select id="q-rep"><option value="">' + L('All employees', 'كل الموظفين') + '</option>' + activeReps().map(function (u) { return '<option value="' + esc(lcEmail(u.email)) + '"' + (s.rep === lcEmail(u.email) ? ' selected' : '') + '>' + esc(u.name) + '</option>'; }).join('') + '</select>' +
        '<span class="spacer"></span><span class="sub">' + rows.length + ' ' + L('cases', 'حالة') + '</span></div>' +
      '<div class="so-split"><section class="card so-flush"><div class="tbl-wrap"><table><thead><tr><th>' + L('Age', 'العمر') + '</th><th>' + L('Rule', 'القاعدة') + '</th><th>' + L('Employee', 'الموظف') + '</th><th>' + L('Merchant', 'التاجر') + '</th><th class="num">' + L('Amount', 'المبلغ') + '</th><th>' + L('Assigned', 'المسؤول') + '</th><th>' + L('Actions', 'الإجراءات') + '</th></tr></thead><tbody>' +
        (rows.length ? rows.map(function (x) {
          var r = x.r, i = x.i, key = r.id + '|' + i.kind;
          var n = comments.filter(function (c) { return c.hubspot_deal_id === r.id && c.kind === i.kind; }).length;
          var decide = i.kind === 'duplicate' || i.kind === 'owner_gap';
          return '<tr><td>' + daysSince(r.deal.close_date) + L('d', 'ي') + '</td><td>' + sevDot(i.sev) + ' ' + esc(issueTitle(i.kind)) + '<span class="cell-sub">' + esc(statusLabel(i.status)) + '</span></td>' +
            '<td>' + esc(nameOf(r.owner)) + '</td><td><button class="linklike" data-deal="' + esc(r.id) + '" dir="auto">' + esc(r.merchant) + '</button></td><td class="num">' + money(i.stake) + '</td>' +
            '<td><select class="status-select" data-assign="' + esc(key) + '"><option value="">' + L('Nobody', 'لا أحد') + '</option>' + mgrs.map(function (u) { return '<option value="' + esc(u.email) + '"' + (i.assignee === u.email ? ' selected' : '') + '>' + esc(firstName(u.name)) + '</option>'; }).join('') + '</select></td>' +
            '<td class="so-acts">' + (decide ? '<button class="btn so-sm" data-decide="' + esc(key) + '">' + L('Decide', 'قرّر') + '</button>' : '') +
            '<button class="icon-btn" data-comment="' + esc(key) + '" title="' + L('Comment', 'تعليق') + '">' + ICON.chat + (n ? '<span class="so-badge">' + n + '</span>' : '') + '</button>' +
            '<button class="ghost-btn" data-dismiss="' + esc(key) + '">' + L('Dismiss', 'إغلاق') + '</button>' +
            '<a class="icon-btn" href="' + esc(hsLink(r.id)) + '" target="_blank" rel="noopener" title="HubSpot">' + ICON.ext + '</a></td></tr>';
        }).join('') : '<tr><td colspan="7"><p class="sub" style="padding:18px;text-align:center">' + L('Nothing in the queue.', 'لا شيء في القائمة.') + '</p></td></tr>') +
      '</tbody></table></div></section>' +
      card(L('Trends', 'الاتجاهات'), L('Deals per rule, last month against this month', 'الصفقات لكل قاعدة: الشهر الماضي مقابل هذا الشهر'),
        '<div class="so-trend">' + trend.map(function (x) { var d = x.b - x.a; return '<div><span>' + esc(issueTitle(x.k)) + '</span><span>' + x.a + '</span><span>→</span><b>' + x.b + '</b><span class="' + (d > 0 ? 'so-neg' : 'money-pos') + '">' + (d > 0 ? '+' : '') + d + '</span></div>'; }).join('') + '</div>') + '</div>';

    el.querySelector('#q-rule').addEventListener('change', function () { s.rule = this.value; VIEWS.queue.render(el); });
    el.querySelector('#q-rep').addEventListener('change', function () { s.rep = this.value; VIEWS.queue.render(el); });
    on(el, '[data-deal]', 'click', function (b) { openDeal(b.getAttribute('data-deal')); });
    function split(b, attr) { return b.getAttribute(attr).split('|'); }
    on(el, '[data-assign]', 'change', function (sel) {
      var p = split(sel, 'data-assign');
      SO_API.W.setIssue(p[0], p[1], { assignee: sel.value || null }).then(function () {
        SO_API.W.audit('queue', 'Assigned ' + ST.model.byId[p[0]].merchant + ' to ' + (sel.value || 'nobody'));
        toast(L('Assigned', 'تم الإسناد')); reload();
      }, failToast);
    });
    on(el, '[data-dismiss]', 'click', function (b) {
      var p = split(b, 'data-dismiss'), r = ST.model.byId[p[0]];
      dialog({ title: L('Dismiss this issue?', 'إغلاق هذه المشكلة؟'), sub: esc(r.merchant) + ' · ' + esc(issueTitle(p[1])),
        body: '<label class="f-label">' + L('Why (kept in the audit log)', 'السبب (يُحفظ في السجل)') + '<input id="dlg-why" type="text"></label>',
        confirm: L('Dismiss', 'إغلاق'), onConfirm: function (d) {
          var why = d.querySelector('#dlg-why').value.trim();
          SO_API.W.setIssue(p[0], p[1], { status: 'dismissed', note: why || null }).then(function () {
            SO_API.W.audit('queue', 'Dismissed ' + issueTitle(p[1]) + ' on ' + r.merchant + (why ? ': ' + why : ''));
            toast(L('Issue dismissed and logged', 'أُغلقت المشكلة وسُجلت')); reload();
          }, failToast);
        } });
    });
    on(el, '[data-comment]', 'click', function (b) {
      var p = split(b, 'data-comment'), r = ST.model.byId[p[0]];
      var list = comments.filter(function (c) { return c.hubspot_deal_id === p[0] && c.kind === p[1]; });
      dialog({ title: L('Comments', 'التعليقات'), sub: esc(r.merchant),
        body: list.map(function (c) { return '<div class="so-comment"><b>' + esc(nameOf(c.author_email)) + '</b> <span class="sub">' + agoText(c.created_at) + '</span><p>' + esc(c.body) + '</p></div>'; }).join('') +
          '<label class="f-label">' + L('Add a comment', 'أضف تعليقًا') + '<input id="dlg-c" type="text"></label>',
        confirm: L('Add', 'إضافة'), onConfirm: function (d) {
          var v = d.querySelector('#dlg-c').value.trim();
          if (!v) return false;
          SO_API.W.addComment(p[0], p[1], v).then(function () { toast(L('Comment added', 'أُضيف التعليق')); reload(); }, failToast);
        } });
    });
    on(el, '[data-decide]', 'click', function (b) {
      var p = split(b, 'data-decide'), r = ST.model.byId[p[0]];
      var issue = r.allIssues.filter(function (i) { return i.kind === p[1]; })[0];
      var other = issue.pairId ? ST.model.byId[issue.pairId] : null;
      var side = function (label, x, rep) { return '<div class="so-pair"><p class="sub">' + esc(label) + '</p><b dir="auto">' + esc(x.merchant) + '</b><span class="cell-sub">' + esc(nameOf(rep)) + ' · ' + esc(x.stage) + '</span><span class="cell-sub">' + money(x.inv || x.hs) + ' · #' + esc(x.id) + '</span></div>'; };
      var invRep = (r.invoices[0] || {}).rep_email;
      var body = '<div class="so-pairs">' + side(L('This deal', 'هذه الصفقة'), r, r.owner) +
        (p[1] === 'duplicate' && other ? side(L('Same store', 'نفس المتجر'), other, other.owner) : side(L('Invoice says', 'الفاتورة تقول'), r, invRep)) + '</div>' +
        '<div class="so-row" style="margin-top:12px">' +
          '<button class="btn" data-k="keep">' + (p[1] === 'duplicate' ? L('Keep this deal', 'أبقِ هذه الصفقة') : L('Keep the HubSpot owner', 'أبقِ مالك HubSpot')) + '</button>' +
          (p[1] === 'owner_gap' ? '<button class="btn secondary" data-k="reassign">' + L('Give it to ', 'أسندها إلى ') + esc(firstName(nameOf(invRep))) + '</button>' : '') +
          '<button class="btn secondary" data-k="dismiss">' + (p[1] === 'duplicate' ? L('Do not count this one', 'لا تحتسب هذه') : L('Dismiss', 'إغلاق')) + '</button></div>';
      dialog({ title: L('Attribution decision', 'قرار الإسناد'), sub: esc(issueTitle(p[1])), body: body, wire: function (d) {
        on(d, '[data-k]', 'click', function (bb) {
          var k = bb.getAttribute('data-k');
          SO_API.W.setIssue(p[0], p[1], { status: 'resolved', decision: k }).then(function () {
            SO_API.W.audit('attribution', 'Decision on ' + r.merchant + ': ' + k);
            closeDialog(); toast(L('Decision saved and logged', 'حُفظ القرار وسُجل')); reload();
          }, failToast);
        });
      } });
    });
  }
};

/* ---------------- Calculator ---------------- */
VIEWS.calc = {
  title: function () { return L('Commission calculator', 'حاسبة العمولة'); },
  sub: function () { return L('What closing more this month would pay, on the current rules.', 'كم ستكسب إن أغلقت المزيد هذا الشهر وفق القواعد الحالية.'); },
  controls: { month: true },
  render: function (el) {
    var s = ST.v.calc = ST.v.calc || { extra: 0, stores: 0, rep: null };
    var email = isRep() ? lcEmail(me().email) : s.rep;
    if (!email) {
      el.innerHTML = card(L('Pick an employee', 'اختر موظفًا'), L('The calculator works on one employee\'s month.', 'تعمل الحاسبة على شهر موظف واحد.'),
        '<div class="so-row so-wrap">' + activeReps().map(function (u) { return '<button class="btn secondary" data-rep="' + esc(lcEmail(u.email)) + '">' + esc(u.name) + '</button>'; }).join('') + '</div>');
      on(el, '[data-rep]', 'click', function (b) { s.rep = b.getAttribute('data-rep'); VIEWS.calc.render(el); });
      return;
    }
    var rules = ST.model.rules, rm = SO.repMonth(ST.model, email, ST.month);
    var nowC = rm.calc, after = SO.whatIf(ST.model, rm, s.extra, s.stores);
    var lad = SO.ladder(ST.model, rm);
    var curClosed = rm.closed + s.extra;
    var here = -1;
    lad.forEach(function (l, i) { if (curClosed >= l.closed) here = i; });
    el.innerHTML = '<section class="so-calc">' +
      '<div class="card">' +
        (isRep() ? '' : '<div class="filter-row" style="margin-bottom:10px"><button class="ghost-btn" id="cc-back">← ' + L('All employees', 'كل الموظفين') + '</button><b>' + esc(nameOf(email)) + '</b></div>') +
        '<h2>' + L('If you close more', 'إن أغلقت المزيد') + '</h2>' +
        '<p class="sub">' + esc(planName(rm.plan)) + ' · ' + L('counted so far', 'المحسوب حتى الآن') + ' ' + money(rm.closed) + ' · ' + rm.stores + ' ' + L('stores', 'متجر') + ' · ' + L('target', 'الهدف') + ' ' + money(rm.target) + '</p>' +
        '<label class="so-slider"><span>' + L('Extra closed', 'إغلاق إضافي') + ' · <b>' + money(s.extra) + '</b></span><input type="range" id="cc-extra" min="0" max="' + Math.max(80000, Math.round(rm.target)) + '" step="1000" value="' + s.extra + '"></label>' +
        '<div class="so-row so-wrap">' + [0, 10000, 25000, 50000].concat(nowC.nextTier ? [Math.ceil((rm.target * nowC.nextTier.from / 100 - rm.closed) / 1000) * 1000] : []).filter(function (v, i, a) { return v >= 0 && a.indexOf(v) === i; })
          .map(function (v) { return '<button class="ghost-btn' + (v === s.extra ? ' so-on' : '') + '" data-extra="' + v + '">' + (v ? '+' + moneyC(v) : L('Now', 'الآن')) + '</button>'; }).join('') + '</div>' +
        '<div class="so-row so-wrap" style="margin-top:8px"><span class="sub">' + L('Extra stores', 'متاجر إضافية') + '</span>' + [0, 2, 5, 10].map(function (v) { return '<button class="ghost-btn' + (v === s.stores ? ' so-on' : '') + '" data-stores="' + v + '">+' + v + '</button>'; }).join('') + '</div>' +
        '<div class="so-calc-out"><div><p class="sub">' + L('Commission now', 'العمولة الآن') + '</p><p class="so-big">' + money(nowC.amount) + '</p>' + (nowC.held ? '<p class="sub so-neg">' + L('Held', 'محجوزة') + '</p>' : '') + '</div>' +
          '<div><p class="sub">' + L('After', 'بعد') + '</p><p class="so-big">' + money(after.amount) + '</p><p class="sub">' + tierName(after.tierIndex) + ' · ' + pct(after.ach / 100) + '</p></div>' +
          '<div><p class="sub">' + L('Change', 'الفرق') + '</p><p class="so-big money-pos">' + signed(after.amount - nowC.amount) + '</p></div></div>' +
        (after.held ? '<p class="so-warnline">' + ICON.lock + L('Still held: needs ' + after.storesShort + ' more ' + (after.storesShort === 1 ? 'store' : 'stores') + ' (minimum ' + after.minStores + ').', 'ما زالت محجوزة: تحتاج ' + after.storesShort + ' متاجر إضافية (الحد ' + after.minStores + ').') + '</p>' : '') +
        (after.tierIndex > nowC.tierIndex ? '<p class="so-infoline">' + L('Crossing into a higher tier re-rates the whole month, not just the extra.', 'الانتقال لشريحة أعلى يعيد احتساب الشهر كله، لا الإضافة فقط.') + '</p>' : '') +
      '</div>' +
      card(L('Rules', 'القواعد'), '<a href="#/rules">' + L('Open the full rules', 'افتح القواعد كاملة') + '</a>', '<div class="so-calc-rules">' + rulesDocHtml(rules, isAr() ? 'ar' : 'en') + '</div>') +
      '</section>' +
      card(L('Ladder', 'السلم'), L('Commission at each step for this target', 'العمولة عند كل خطوة لهذا الهدف'),
        '<div class="tbl-wrap"><table><thead><tr><th>' + L('Closed', 'المغلق') + '</th><th>' + L('Achievement', 'الإنجاز') + '</th><th>' + L('Tier', 'الشريحة') + '</th><th class="num">' + L('Commission', 'العمولة') + '</th><th></th></tr></thead><tbody>' +
        lad.map(function (l, i) {
          return '<tr class="' + (i === here ? 'so-here' : '') + '"><td>' + money(l.closed) + (l.cliff && rules.accelerator ? ' <span class="so-pill muted"><i></i>' + moneyC(rules.accelerator.per_block) + ' / ' + L('block', 'كتلة') + '</span>' : '') + '</td><td>' + Math.round(l.pct) + '%</td><td>' + tierName(l.tierIndex) + ' · ' + l.rate + '%</td><td class="num">' + money(l.comm) + '</td><td>' + (i === here ? '<b>' + L('You are here', 'أنت هنا') + '</b>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>');
    var x = el.querySelector('#cc-extra');
    x.addEventListener('input', function () { s.extra = Number(x.value); VIEWS.calc.render(el); var n = el.querySelector('#cc-extra'); if (n) n.focus(); });
    on(el, '[data-extra]', 'click', function (b) { s.extra = Number(b.getAttribute('data-extra')); VIEWS.calc.render(el); });
    on(el, '[data-stores]', 'click', function (b) { s.stores = Number(b.getAttribute('data-stores')); VIEWS.calc.render(el); });
    var bk = el.querySelector('#cc-back'); if (bk) bk.addEventListener('click', function () { s.rep = null; VIEWS.calc.render(el); });
  }
};
