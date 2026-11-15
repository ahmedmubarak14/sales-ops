/* ============================================================
   Sales Ops Portal: Team, Leaderboard, Analytics, Sectors,
   Top Zid Stores
   ============================================================ */

function boardRows(month) {
  // Reps read only their own deals (RLS), so their leaderboard comes from
  // the leaderboard() RPC; everyone else computes it from the deals.
  if (isRep() && ST.snap.leaderboard && SO_API.live()) {
    return ST.snap.leaderboard.map(function (r) {
      return { email: lcEmail(r.rep_email), name: r.name, closed: Number(r.closed) || 0, stores: Number(r.stores) || 0, ach: null, streak: null, best: null, band: '' };
    }).sort(function (a, b) { return b.closed - a.closed; });
  }
  return activeReps().map(function (u) {
    var e = lcEmail(u.email), rm = SO.repMonth(ST.model, e, month);
    var best = 0;
    SO.monthsBack(month, 12).forEach(function (mk) { best = Math.max(best, SO.repMonth(ST.model, e, mk).closed); });
    return { email: e, name: u.name, closed: rm.closed, stores: rm.stores, ach: rm.target ? rm.closed / rm.target : 0,
      streak: SO.streak(ST.model, e, month), best: best, band: tierName(rm.calc.tierIndex) + ' · ' + rm.calc.rate + '%', rm: rm };
  }).sort(function (a, b) { return b.closed - a.closed; });
}

/* ---------------- Team ---------------- */
VIEWS.team = {
  title: function () { return L('Team', 'الفريق'); },
  sub: function () { return L('Every employee\'s month: target, what counts, stores, commission and open issues.', 'شهر كل موظف: الهدف والمحسوب والمتاجر والعمولة والمشكلات.'); },
  controls: { month: true, reps: true },
  render: function (el) {
    var rows = scopeEmails().map(function (e) { return SO.repMonth(ST.model, e, ST.month); });
    rows = applySort('team', rows, {
      name: function (r) { return nameOf(r.email); }, closed: function (r) { return r.closed; }, stores: function (r) { return r.stores; },
      comm: function (r) { return r.calc.amount; }, issues: function (r) { return r.issues.length; }, gap: function (r) { return r.hsClosed - r.closed; }
    }, 'closed');
    el.innerHTML = '<section class="card so-flush"><div class="tbl-wrap"><table><thead><tr>' +
      sortHead('team', 'name', L('Employee', 'الموظف')) + '<th>' + L('Plan', 'الخطة') + '</th><th class="num">' + L('Target', 'الهدف') + '</th>' +
      sortHead('team', 'closed', L('Counted', 'المحسوب')) + sortHead('team', 'stores', L('Stores', 'المتاجر'), 'num') + '<th class="num">' + L('To target', 'للهدف') + '</th>' +
      sortHead('team', 'comm', L('Commission', 'العمولة'), 'num') + sortHead('team', 'issues', L('Issues', 'المشكلات'), 'num') + sortHead('team', 'gap', L('HubSpot gap', 'فرق HubSpot'), 'num') +
      '</tr></thead><tbody>' + rows.map(function (r) {
        var u = userByEmail(r.email) || {};
        return '<tr class="rowlink" data-rep="' + esc(r.email) + '"><td><span class="u-cell"><span class="avatar so-av">' + esc(initials(u.name)) + '</span><b>' + esc(u.name || r.email) + '</b></span></td>' +
          '<td>' + esc(r.plan.name) + '</td><td class="num">' + moneyC(r.target) + '</td>' +
          '<td><div class="so-cellbar">' + bar(r.target ? r.closed / r.target : 0, r.closed >= r.target ? 'good' : '') + '<span>' + moneyC(r.closed) + ' · ' + pct(r.target ? r.closed / r.target : 0) + '</span></div></td>' +
          '<td class="num">' + r.stores + (r.stores < ST.model.rules.min_stores && !r.exception ? ' <span class="so-neg">!</span>' : '') + '</td>' +
          '<td class="num">' + (r.gap ? moneyC(r.gap) : '✓') + '</td>' +
          '<td class="num">' + money(r.calc.amount) + (r.calc.held ? '<span class="cell-sub so-neg">' + L('held', 'محجوزة') + '</span>' : '') + '</td>' +
          '<td class="num">' + (r.issues.length ? '<span class="so-badge-n">' + r.issues.length + '</span>' : '') + '</td>' +
          '<td class="num">' + signed(r.hsClosed - r.closed) + '</td></tr>';
      }).join('') + '</tbody></table></div></section>';
    wireSort(el, 'team', function () { VIEWS.team.render(el); });
    on(el, '[data-rep]', 'click', function (n) { ST.repSel = [n.getAttribute('data-rep')]; location.hash = '#/overview'; });
  }
};

/* ---------------- Leaderboard ---------------- */
VIEWS.leaderboard = {
  title: function () { return L('Leaderboard', 'لوحة الصدارة'); },
  sub: function () { return L('Ranked by counted SAR this month: invoiced, Closed Won, owned.', 'الترتيب حسب المحسوب هذا الشهر: مفوتر ومغلق ومملوك.'); },
  controls: { month: true },
  render: function (el) {
    var rows = boardRows(ST.month), mine = lcEmail(me().email);
    var full = rows.length && rows[0].ach !== null;
    el.innerHTML = '<section class="card so-flush"><div class="tbl-wrap"><table><thead><tr><th>#</th><th>' + L('Employee', 'الموظف') + '</th><th class="num">' + L('Counted', 'المحسوب') + '</th><th class="num">' + L('Stores', 'المتاجر') + '</th>' +
      (full ? '<th class="num">' + L('Of target', 'من الهدف') + '</th><th class="num" title="' + L('Months in a row at target', 'أشهر متتالية بلغت الهدف') + '">🔥</th><th class="num">' + L('Best month', 'أفضل شهر') + '</th><th>' + L('Tier', 'الشريحة') + '</th>' : '') +
      '</tr></thead><tbody>' + rows.map(function (r, i) {
        return '<tr class="' + (r.email === mine ? 'so-here' : '') + '"><td><span class="rank-badge ' + (i === 0 ? 'top1' : i === 1 ? 'top2' : i === 2 ? 'top3' : '') + '">' + (i + 1) + '</span></td>' +
          '<td><b>' + esc(r.name) + '</b>' + (r.email === mine ? ' <span class="so-pill muted"><i></i>' + L('You', 'أنت') + '</span>' : '') + '</td><td class="num">' + money(r.closed) + '</td><td class="num">' + r.stores + '</td>' +
          (full ? '<td class="num">' + pct(r.ach) + '</td><td class="num">' + (r.streak || '—') + '</td><td class="num">' + moneyC(r.best) + '</td><td>' + esc(r.band) + '</td>' : '') + '</tr>';
      }).join('') + '</tbody></table></div></section>';
  }
};

/* ---------------- Analytics ---------------- */
VIEWS.analytics = {
  title: function () { return L('Analytics', 'التحليلات'); },
  sub: function () { return L('Twelve months of counted revenue, win rates and deal mix.', 'اثنا عشر شهرًا من الإيراد المحسوب ونسب الفوز ومزيج الصفقات.'); },
  controls: { month: true, reps: true },
  render: function (el) {
    var s = ST.v.analytics = ST.v.analytics || { tab: 'perf', plan: '', type: '', cat: '', open: null };
    var months = SO.monthsBack(ST.month, 12), labels = months.map(function (k) { return monthName(k, true); });
    var emails = scopeEmails().filter(function (e) { if (!s.plan) return true; return SO.targetFor(ST.model, e, ST.month).plan.id === s.plan; });
    var rowsAll = ST.model.rows.filter(function (r) {
      return (emails.indexOf(r.owner) >= 0 || emails.indexOf(r.countsFor) >= 0) && months.indexOf(r.month) >= 0 &&
        (!s.type || r.type === s.type) && (!s.cat || r.category === s.cat);
    });
    var types = {}, cats = {};
    ST.model.rows.forEach(function (r) { types[r.type] = 1; cats[r.category] = 1; });
    var menus = [
      { key: 'plan', label: L('Plan', 'الخطة'), opts: ST.model.rules.plans.map(function (p) { return [p.id, p.name]; }) },
      { key: 'type', label: L('Deal type', 'نوع الصفقة'), opts: Object.keys(types).sort().map(function (k) { return [k, k]; }) },
      { key: 'cat', label: L('Sector', 'القطاع'), opts: Object.keys(cats).sort().map(function (k) { return [k, trCat(k)]; }) }
    ];
    var html = '<div class="filter-row">' + menus.map(function (m) {
      var cur = s[m.key], curLabel = cur ? (m.opts.filter(function (o) { return o[0] === cur; })[0] || [0, cur])[1] : L('All', 'الكل');
      return '<label class="so-inline"><span class="sub">' + esc(m.label) + '</span><select data-f="' + m.key + '"><option value="">' + L('All', 'الكل') + '</option>' +
        m.opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === cur ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></label>';
    }).join('') + '<span class="spacer"></span>' +
      '<button class="btn secondary so-ib" id="an-link">' + ICON.link + L('Copy link', 'نسخ الرابط') + '</button>' +
      '<button class="btn secondary so-ib" id="an-csv">' + ICON.download + L('Export', 'تصدير') + '</button></div>';
    html += '<div class="seg so-tabs">' + [['perf', L('Performance', 'الأداء')], ['win', L('Win rates', 'نسب الفوز')], ['mix', L('Deal mix', 'مزيج الصفقات')]]
      .map(function (x) { return '<button data-tab="' + x[0] + '" class="' + (s.tab === x[0] ? 'active' : '') + '">' + esc(x[1]) + '</button>'; }).join('') + '</div>';

    var counted = months.map(function (mk) { return rowsAll.filter(function (r) { return r.counted && r.month === mk; }).reduce(function (a, r) { return a + r.countedAmount; }, 0); });
    var hsWon = months.map(function (mk) { return rowsAll.filter(function (r) { return r.won && r.closeMonth === mk; }).reduce(function (a, r) { return a + r.hs; }, 0); });
    var decided = function (mk) { return rowsAll.filter(function (r) { return r.closed && r.closeMonth === mk; }); };
    var win = months.map(function (mk) { var d = decided(mk); return d.length ? d.filter(function (r) { return r.won; }).length / d.length : null; });
    var exportRows = [];

    if (isRep() && emails.length === 1 && s.tab === 'perf') {
      var hist = months.map(function (mk) { return boardRowsSafe(mk).map(function (r) { return r.email; }).indexOf(emails[0]) + 1; });
      var pos = hist[hist.length - 1], of = activeReps().length;
      html += '<section class="card so-rankhero"><div><p class="t-label">' + L('Your rank this month', 'ترتيبك هذا الشهر') + '</p><p class="so-hero-value">#' + (pos || '—') + ' <span class="sub">' + L('of ', 'من ') + of + '</span></p>' +
        '<p class="sub">' + ICON.flame + ' ' + SO.streak(ST.model, emails[0], ST.month) + ' ' + L('months in a row at target', 'أشهر متتالية بلغت الهدف') + '</p></div>' +
        '<div class="so-rankhist">' + hist.map(function (p, i) { return '<div title="' + esc(labels[i]) + ': #' + p + '"><span style="height:' + (p ? Math.max(8, (of - p + 1) / of * 100) : 0) + '%"></span><em>' + esc(labels[i]) + '</em></div>'; }).join('') + '</div></section>';
    }

    if (s.tab === 'perf') {
      var tot = counted.reduce(function (a, b) { return a + b; }, 0);
      var wonN = rowsAll.filter(function (r) { return r.counted; }).length;
      html += kpis([tile(L('Counted, 12 months', 'المحسوب، 12 شهرًا'), moneyC(tot)), tile(L('Deals counted', 'صفقات محسوبة'), fmtNum(wonN)),
        tile(L('Average deal', 'متوسط الصفقة'), moneyC(wonN ? tot / wonN : 0)), tile(L('Monthly average', 'المتوسط الشهري'), moneyC(tot / 12))]);
      html += chartCard({ title: L('Counted vs HubSpot closed won', 'المحسوب مقابل المغلق في HubSpot'), subtitle: L('Where the two drift apart, look at Reconciliation', 'عند التباعد راجع المطابقة'),
        legend: [{ cls: 's1', label: L('Counted (Metabase)', 'المحسوب (Metabase)') }, { cls: 's2', label: 'HubSpot' }],
        svg: groupedColumnsSVG(labels, counted, hsWon, { nameA: L('Counted', 'المحسوب'), nameB: 'HubSpot' }),
        table: { head: [L('Month', 'الشهر'), L('Counted', 'المحسوب'), 'HubSpot'], rows: months.map(function (k, i) { return [monthName(k), money(counted[i]), money(hsWon[i])]; }) } });
      var reps = emails.map(function (e) {
        var tot2 = 0, tg = 0;
        months.forEach(function (mk) { var rm = SO.repMonth(ST.model, e, mk); tot2 += rm.closed; tg += rm.target; });
        return [nameOf(e), tot2, tg];
      }).sort(function (a, b) { return b[1] - a[1]; });
      exportRows = reps.map(function (r) { return [r[0], Math.round(r[1]), Math.round(r[2]), r[2] ? Math.round(r[1] / r[2] * 100) + '%' : '']; });
      html += card(L('By employee, 12 months', 'حسب الموظف، 12 شهرًا'), '', '<div class="tbl-wrap"><table><thead><tr><th>' + L('Employee', 'الموظف') + '</th><th class="num">' + L('Counted', 'المحسوب') + '</th><th class="num">' + L('Target', 'الهدف') + '</th><th class="num">' + L('Of target', 'من الهدف') + '</th></tr></thead><tbody>' +
        reps.map(function (r) { return '<tr><td>' + esc(r[0]) + '</td><td class="num">' + money(r[1]) + '</td><td class="num">' + money(r[2]) + '</td><td class="num">' + pct(r[2] ? r[1] / r[2] : 0) + '</td></tr>'; }).join('') + '</tbody></table></div>');
    } else if (s.tab === 'win') {
      var dec = rowsAll.filter(function (r) { return r.closed; });
      var w = dec.filter(function (r) { return r.won; }).length;
      html += kpis([tile(L('Win rate, 12 months', 'نسبة الفوز، 12 شهرًا'), pct(dec.length ? w / dec.length : 0)), tile(L('Decided deals', 'صفقات محسومة'), fmtNum(dec.length)),
        tile(L('Won', 'فائزة'), fmtNum(w)), tile(L('Open now', 'مفتوحة الآن'), fmtNum(rowsAll.filter(function (r) { return !r.closed; }).length))]);
      html += chartCard({ title: L('Win rate by month', 'نسبة الفوز شهريًا'), subtitle: L('Won ÷ decided, by close month', 'الفائزة ÷ المحسومة حسب شهر الإغلاق'),
        svg: lineSVG(labels, win, { pct: true }), table: { head: [L('Month', 'الشهر'), L('Win rate', 'نسبة الفوز')], rows: months.map(function (k, i) { return [monthName(k), win[i] === null ? '—' : pct(win[i])]; }) } });
      var byRep = emails.map(function (e) {
        var d = dec.filter(function (r) { return r.owner === e; }), ww = d.filter(function (r) { return r.won; }).length;
        return [nameOf(e), d.length, ww, d.length ? ww / d.length : 0];
      }).sort(function (a, b) { return b[3] - a[3]; });
      exportRows = byRep.map(function (r) { return [r[0], r[1], r[2], Math.round(r[3] * 100) + '%']; });
      html += card(L('Win rate by employee', 'نسبة الفوز لكل موظف'), '', '<div class="tbl-wrap"><table><thead><tr><th>' + L('Employee', 'الموظف') + '</th><th class="num">' + L('Decided', 'محسومة') + '</th><th class="num">' + L('Won', 'فائزة') + '</th><th>' + L('Win rate', 'نسبة الفوز') + '</th></tr></thead><tbody>' +
        byRep.map(function (r) { return '<tr><td>' + esc(r[0]) + '</td><td class="num">' + r[1] + '</td><td class="num">' + r[2] + '</td><td><div class="so-cellbar">' + bar(r[3]) + '<span>' + pct(r[3]) + '</span></div></td></tr>'; }).join('') + '</tbody></table></div>');
    } else {
      var byType = {}, byPlan = {};
      rowsAll.filter(function (r) { return r.counted; }).forEach(function (r) {
        byType[r.type] = (byType[r.type] || 0) + 1;
        var p = (r.invoices[0] || {}).purchasable_name || '—';
        byPlan[p] = (byPlan[p] || 0) + r.countedAmount;
      });
      var segs = Object.keys(byType).map(function (k, i) { return { label: k, count: byType[k], cls: ['f3', 'f5', 'f1', 'f6'][i % 4] }; });
      html += chartCard({ title: L('Counted deals by type', 'الصفقات المحسوبة حسب النوع'), svg: segs.length ? stackedBarSVG(segs, { unit: L('deals', 'صفقة') }) : '<div class="empty">' + t('noData') + '</div>',
        table: { head: [L('Type', 'النوع'), L('Deals', 'الصفقات')], rows: segs.map(function (x) { return [x.label, fmtNum(x.count)]; }) } });
      var plans = Object.keys(byPlan).map(function (k) { return { label: k, count: Math.round(byPlan[k]) }; }).sort(function (a, b) { return b.count - a.count; });
      exportRows = plans.map(function (p) { return [p.label, p.count]; });
      html += card(L('Counted SAR by Zid plan', 'المحسوب حسب باقة زد'), L('From the invoice line\'s plan name', 'من اسم الباقة في الفاتورة'),
        plans.map(function (p) { return '<div class="so-rank"><div class="so-rank-top"><span>' + esc(p.label) + '</span><b>' + moneyC(p.count) + '</b></div>' + bar(p.count / ((plans[0] || {}).count || 1)) + '</div>'; }).join('') || '<p class="sub">' + t('noData') + '</p>');
    }
    if (isRep()) html += '<p class="sub so-note">' + L('Only your own deals are shown. Team totals are on the leaderboard.', 'تظهر صفقاتك فقط. مجاميع الفريق في لوحة الصدارة.') + '</p>';
    el.innerHTML = html;
    on(el, '[data-tab]', 'click', function (b) { s.tab = b.getAttribute('data-tab'); VIEWS.analytics.render(el); });
    on(el, '[data-f]', 'change', function (sel) { s[sel.getAttribute('data-f')] = sel.value; VIEWS.analytics.render(el); });
    el.querySelector('#an-link').addEventListener('click', function () { copyText(location.href); });
    el.querySelector('#an-csv').addEventListener('click', function () { csvDownload('analytics-' + s.tab + '-' + ST.month + '.csv', [L('Item', 'البند'), 'A', 'B', 'C'], exportRows); });
    initTooltip(el);
  }
};
function boardRowsSafe(mk) {
  return activeReps().map(function (u) { var e = lcEmail(u.email); return { email: e, closed: SO.repMonth(ST.model, e, mk).closed }; })
    .sort(function (a, b) { return b.closed - a.closed; });
}

/* ---------------- Sectors ---------------- */
var SECTOR_COLORS = ['#7c40c8', '#0d9488', '#d97706', '#db2777', '#2563eb', '#65a30d', '#9333ea', '#dc2626', '#0891b2', '#78716c'];
VIEWS.sectors = {
  title: function () { return L('Sectors', 'القطاعات'); },
  sub: function () { return L('Which store sectors the team closes, from the HubSpot company industry.', 'القطاعات التي يغلقها الفريق، من قطاع الشركة في HubSpot.'); },
  controls: { month: true, reps: true },
  render: function (el) {
    var months = SO.monthsBack(ST.month, 12);
    var rows = ST.model.rows.filter(function (r) { return r.counted && inScope(r) && months.indexOf(r.month) >= 0; });
    var tot = rows.reduce(function (a, r) { return a + r.countedAmount; }, 0) || 1;
    var mix = {};
    rows.forEach(function (r) { var m = mix[r.category] = mix[r.category] || { sar: 0, n: 0 }; m.sar += r.countedAmount; m.n += 1; });
    var cats = Object.keys(mix).sort(function (a, b) { return mix[b].sar - mix[a].sar; });
    var color = {}; cats.forEach(function (c, i) { color[c] = SECTOR_COLORS[i % SECTOR_COLORS.length]; });
    var top = cats.slice(0, 8);
    var byMonth = months.map(function (mk) {
      var m = {}; rows.filter(function (r) { return r.month === mk; }).forEach(function (r) { m[r.category] = (m[r.category] || 0) + r.countedAmount; });
      var best = Object.keys(m).sort(function (a, b) { return m[b] - m[a]; })[0];
      var all = Object.keys(m).reduce(function (a, k) { return a + m[k]; }, 0);
      return { mk: mk, cat: best, sar: best ? m[best] : 0, share: all && best ? m[best] / all : 0 };
    });
    var reps = scopeEmails();
    var grid = reps.map(function (e) {
      var m = {}, all = 0;
      rows.filter(function (r) { return r.countsFor === e; }).forEach(function (r) { m[r.category] = (m[r.category] || 0) + r.countedAmount; all += r.countedAmount; });
      var best = Object.keys(m).sort(function (a, b) { return m[b] - m[a]; })[0];
      return { e: e, m: m, all: all, best: best };
    });
    el.innerHTML = '<p class="sub">' + L('Counted SAR over the 12 months to ', 'المحسوب خلال 12 شهرًا حتى ') + monthName(ST.month) + '.</p>' +
      '<div class="grid-2">' +
      card(L('Sector mix', 'مزيج القطاعات'), '', cats.length ? cats.map(function (c) {
        return '<div class="so-mix"><span class="so-sw" style="background:' + color[c] + '"></span><span>' + esc(trCat(c)) + '</span>' + bar(mix[c].sar / mix[cats[0]].sar) + '<b>' + moneyC(mix[c].sar) + '</b><span class="sub">' + pct(mix[c].sar / tot) + ' · ' + mix[c].n + '</span></div>';
      }).join('') : '<p class="sub">' + t('noData') + '</p>') +
      card(L('Top sector each month', 'القطاع الأول كل شهر'), L('Bar height is that sector\'s share of the month', 'الارتفاع حصة القطاع من الشهر'),
        '<div class="so-monthbars">' + byMonth.map(function (b) { return '<div title="' + esc(monthName(b.mk) + ' · ' + trCat(b.cat || '—') + ' · ' + moneyC(b.sar) + ' · ' + pct(b.share)) + '"><span style="height:' + Math.max(4, b.share * 100) + '%;background:' + (color[b.cat] || 'var(--mark-muted)') + '"></span><em>' + esc(monthName(b.mk, true)) + '</em></div>'; }).join('') + '</div>' +
        '<div class="legend">' + top.map(function (c) { return '<span class="lg"><i class="sw" style="background:' + color[c] + '"></i>' + esc(trCat(c)) + '</span>'; }).join('') + '</div>') +
      '</div>' +
      card(L('Employee × sector', 'الموظف × القطاع'), L('Counted SAR, top sectors', 'المحسوب لأعلى القطاعات'),
        '<div class="tbl-wrap"><table class="so-grid-t"><thead><tr><th>' + L('Employee', 'الموظف') + '</th>' + top.map(function (c) { return '<th class="num">' + esc(trCat(c)) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        grid.map(function (g) {
          var mx = Math.max.apply(null, top.map(function (c) { return g.m[c] || 0; }).concat([1]));
          return '<tr><td><b>' + esc(nameOf(g.e)) + '</b></td>' + top.map(function (c) { var v = g.m[c] || 0; return '<td class="num so-heat" style="--a:' + (v / mx * 0.5).toFixed(2) + '">' + (v ? moneyC(v) : '—') + '</td>'; }).join('') + '</tr>';
        }).join('') + '</tbody></table></div>') +
      card(L('Each employee\'s strongest sector', 'أقوى قطاع لكل موظف'), '',
        '<div class="tbl-wrap"><table><thead><tr><th>' + L('Employee', 'الموظف') + '</th><th>' + L('Top sector', 'القطاع الأول') + '</th><th class="num">' + L('Counted there', 'المحسوب فيه') + '</th><th>' + L('Share of employee', 'حصته من الموظف') + '</th></tr></thead><tbody>' +
        grid.filter(function (g) { return g.best; }).map(function (g) { var v = g.m[g.best]; return '<tr><td><b>' + esc(nameOf(g.e)) + '</b></td><td><span class="so-sw" style="background:' + (color[g.best] || '#999') + '"></span> ' + esc(trCat(g.best)) + '</td><td class="num">' + moneyC(v) + '</td><td><div class="so-cellbar">' + bar(v / g.all) + '<span>' + pct(v / g.all) + '</span></div></td></tr>'; }).join('') +
        '</tbody></table></div>');
  }
};

/* ---------------- Top Zid Stores ----------------
   The same page and the same data as Sales Hunter's hunter view: the
   Metabase sync ranks platinum.zid_insights__stores (top ten per
   category by all-time orders, paid-active, test/spam excluded) into
   store_showcase, and everyone here reads store_showcase_lite: names,
   ranks and addresses, never order counts or revenue. Categories A to
   Z in the language on screen, Other/Others last; open one for its
   ranked stores. */
function storeLink(st) {
  var host = String(st.url || st.store_url || '').trim().toLowerCase().replace(/^https?:\/\//, '').split(/[/?#]/)[0];
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return null;
  return { host: host, href: 'https://' + host };
}
VIEWS.stores = {
  title: function () { return L('Top Zid Stores', 'أفضل متاجر زد'); },
  sub: function () { return L('The best-selling Zid stores in each category, to show a merchant what good looks like.', 'أكثر متاجر زد مبيعًا في كل فئة، لتُري التاجر أمثلة ناجحة.'); },
  controls: {},
  render: function (el) {
    var byCat = {};
    (ST.snap.showcase || []).forEach(function (r) {
      var c = String(r.category || '').trim();
      if (!c) return;
      (byCat[c] = byCat[c] || []).push({ name: r.name, url: r.store_url || null, rank: r.rank_in_category || 999 });
    });
    var showcase = Object.keys(byCat).map(function (c) { return { category: c, stores: byCat[c].sort(function (a, b) { return a.rank - b.rank; }) }; });
    // program-wide win rate per category, as a hint
    var catWin = {};
    ST.model.rows.forEach(function (r) { if (!r.closed) return; var c = catWin[r.category] = catWin[r.category] || { d: 0, w: 0 }; c.d += 1; if (r.won) c.w += 1; });
    var mineByCat = {};
    if (isRep()) ST.model.rows.forEach(function (r) { if (r.owner === lcEmail(me().email) && r.won) mineByCat[r.category] = (mineByCat[r.category] || 0) + 1; });
    var s = ST.v.stores = ST.v.stores || { cat: null };

    function header() {
      return '<div class="card" style="display:flex; justify-content:space-between; gap:14px; flex-wrap:wrap; align-items:center">' +
        '<div><h2>' + L('Top Zid Stores by category', 'أفضل متاجر زد حسب الفئة') + '</h2><p class="sub">' + L('Ranked by all-time orders. Pick a category to see its top stores.', 'مرتبة حسب إجمالي الطلبات. اختر فئة لعرض أفضل متاجرها.') + '</p></div></div>';
    }
    function renderCategories() {
      if (!showcase.length) {
        el.innerHTML = header() + '<div class="card" style="text-align:center; padding:44px 24px"><h3>' + L('No stores yet', 'لا توجد متاجر بعد') + '</h3>' +
          '<p class="sub" style="margin-top:6px">' + L('They appear after the next Metabase sync.', 'تظهر بعد مزامنة Metabase القادمة.') + '</p></div>';
        return;
      }
      var order = showcase.map(function (c, i) { return i; }).sort(function (a, b) {
        var la = /^others?$/i.test(showcase[a].category), lb = /^others?$/i.test(showcase[b].category);
        if (la !== lb) return la ? 1 : -1;
        return trCat(showcase[a].category).localeCompare(trCat(showcase[b].category), isAr() ? 'ar' : 'en');
      });
      el.innerHTML = header() + '<div class="store-grid cat-grid">' + order.map(function (i) {
        return '<button type="button" class="card cat-card" data-cat="' + i + '"><h3>' + esc(trCat(showcase[i].category)) + '</h3><span class="s-go" aria-hidden="true">' + (isAr() ? '←' : '→') + '</span></button>';
      }).join('') + '</div>';
      on(el, '[data-cat]', 'click', function (b) { s.cat = showcase[Number(b.getAttribute('data-cat'))].category; renderCategory(); window.scrollTo(0, 0); });
    }
    function renderCategory() {
      var c = showcase.filter(function (x) { return x.category === s.cat; })[0];
      if (!c) { s.cat = null; return renderCategories(); }
      var w = catWin[c.category], wr = w && w.d >= 5 ? w.w / w.d : null, mine = mineByCat[c.category] || 0;
      el.innerHTML = '<div class="filter-row"><button class="ghost-btn" id="back-cats">' + L('← All categories', 'كل الفئات →') + '</button></div>' +
        '<div class="card" style="display:flex; justify-content:space-between; gap:14px; flex-wrap:wrap; align-items:center"><div><h2>' + esc(trCat(c.category)) + '</h2>' +
        '<p class="sub">' + L('Top stores in this category, by all-time orders.', 'أفضل المتاجر في هذه الفئة حسب إجمالي الطلبات.') +
          (wr !== null ? L(' The team wins ' + pct(wr) + ' of deals here.', ' يفوز الفريق بـ ' + pct(wr) + ' من الصفقات هنا.') : '') +
          (mine ? L(' You have won ' + mine + ' here.', ' فزت بـ ' + mine + ' هنا.') : '') + '</p></div></div>' +
        '<div class="store-grid">' + c.stores.map(function (st, i) {
          var link = storeLink(st);
          return '<section class="card store-card"><div class="s-cat"><span class="rank-badge ' + (i === 0 ? 'top1' : i === 1 ? 'top2' : i === 2 ? 'top3' : '') + '">' + (i + 1) + '</span></div>' +
            '<div><h3 dir="auto">' + esc(st.name) + '</h3>' + (link ? '<span class="s-url">' + ICON.globe + esc(link.host) + '</span>' : '') + '</div>' +
            (link ? '<a class="s-visit" href="' + esc(link.href) + '" target="_blank" rel="noopener noreferrer">' + L('Visit store', 'زيارة المتجر') + ICON.ext + '</a>' : '') + '</section>';
        }).join('') + '</div>';
      el.querySelector('#back-cats').addEventListener('click', function () { s.cat = null; renderCategories(); window.scrollTo(0, 0); });
    }
    if (s.cat) renderCategory(); else renderCategories();
  }
};
