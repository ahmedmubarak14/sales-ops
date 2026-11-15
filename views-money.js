/* ============================================================
   Sales Ops Portal: Reconciliation, Payouts, Finance access,
   Targets, Rules, Integrations, Access
   ============================================================ */

/* ---------------- Reconciliation ---------------- */
var RECON_STEP = {
  noInvoice: ['Won, no invoice', 'مغلقة بلا فاتورة', 'Closed Won in HubSpot, nothing paid in Metabase', 'مغلقة في HubSpot ولا دفع في Metabase'],
  excluded: ['Excluded invoice types', 'أنواع فواتير مستثناة', 'Only renewals or other excluded actions', 'تجديدات أو أنواع مستثناة فقط'],
  otherMonth: ['Invoiced in another month', 'فُوترت في شهر آخر', 'Closed this month, paid in another', 'أُغلقت هذا الشهر ودُفعت في غيره'],
  amountDiff: ['Amount differences', 'فروقات المبالغ', 'Invoice net minus HubSpot amount', 'صافي الفاتورة ناقص مبلغ HubSpot'],
  fromOtherMonth: ['Closed in another month', 'أُغلقت في شهر آخر', 'Paid this month, closed in another', 'دُفعت هذا الشهر وأُغلقت في غيره'],
  notWon: ['Paid, not Closed Won', 'مدفوعة وغير مغلقة', 'Invoice exists, deal still open', 'فاتورة موجودة والصفقة مفتوحة']
};
VIEWS.recon = {
  title: function () { return L('Reconciliation', 'المطابقة'); },
  sub: function () { return L('HubSpot closed won walked, step by step, to what Metabase invoiced.', 'من المغلق في HubSpot خطوة بخطوة إلى ما فوترته Metabase.'); },
  controls: { month: true, reps: true },
  render: function (el) {
    var s = ST.v.recon = ST.v.recon || { open: null };
    var hsAt = ((ST.snap.integrations || []).filter(function (i) { return i.name === 'hubspot'; })[0] || {}).last_synced_at;
    var mbAt = ((ST.snap.integrations || []).filter(function (i) { return i.name === 'metabase'; })[0] || {}).last_synced_at;
    var rc = SO.recon(ST.model, ST.month, isFin() ? null : scopeEmails());
    var ok = Math.abs(rc.unexplained) < 1;
    var maxAbs = Math.max.apply(null, rc.steps.map(function (x) { return Math.abs(x.amount); }).concat([1]));
    var html = '<section class="so-recon3">' +
      '<div class="card"><p class="t-label"><span class="so-sw" style="background:var(--s2)"></span>' + L('HubSpot closed won', 'المغلق في HubSpot') + '</p><p class="so-big">' + money(rc.hs) + '</p><p class="sub">' + rc.hsDeals + ' ' + L('deals', 'صفقة') + ' · ' + rc.hsStores + ' ' + L('stores', 'متجر') + ' · ' + L('synced ', 'مزامنة ') + agoText(hsAt) + '</p></div>' +
      '<div class="card"><p class="t-label"><span class="so-sw" style="background:var(--s1)"></span>' + L('Metabase invoiced', 'المفوتر في Metabase') + '</p><p class="so-big">' + money(rc.mb) + '</p><p class="sub">' + rc.mbDeals + ' ' + L('deals', 'صفقة') + ' · ' + rc.mbStores + ' ' + L('stores', 'متجر') + ' · ' + L('read ', 'قراءة ') + agoText(mbAt) + '</p></div>' +
      '<div class="card"><p class="t-label">' + L('Gap', 'الفرق') + '</p><p class="so-big ' + (rc.gap < 0 ? 'so-neg' : '') + '">' + signed(rc.gap) + '</p><p class="sub">' + (rc.mbDeals - rc.hsDeals) + ' ' + L('deals', 'صفقة') + ' · ' + pct(rc.hs ? rc.gap / rc.hs : 0, 1) + '</p>' +
        (ok ? '<span class="so-pill good"><i></i>' + L('Fully explained by the steps below', 'مفسَّر بالكامل بالخطوات أدناه') + '</span>' : '<span class="so-pill bad"><i></i>' + L('Unexplained: ', 'غير مفسَّر: ') + money(rc.unexplained) + '</span>') + '</div></section>';
    html += card(L('From HubSpot to Metabase', 'من HubSpot إلى Metabase'), L('Open a step for its deals', 'افتح خطوة لعرض صفقاتها'),
      '<div class="so-steps"><div class="so-step so-step-total"><span>HubSpot</span><span></span><b>' + money(rc.hs) + '</b><span></span></div>' +
      rc.steps.map(function (st) {
        var lab = RECON_STEP[st.key], isOpen = s.open === st.key;
        return '<div class="so-step' + (st.items.length ? ' so-click' : '') + '" data-step="' + st.key + '"><span><b>' + esc(L(lab[0], lab[1])) + '</b><span class="cell-sub">' + esc(L(lab[2], lab[3])) + ' · ' + st.items.length + '</span></span>' +
          '<span class="so-wf"><span class="' + (st.amount < 0 ? 'neg' : 'pos') + '" style="width:' + (Math.abs(st.amount) / maxAbs * 100).toFixed(1) + '%"></span></span>' +
          '<b class="' + (st.amount < 0 ? 'so-neg' : 'money-pos') + '">' + signed(st.amount) + '</b><span>' + (st.items.length ? (isOpen ? '▾' : '▸') : '') + '</span></div>' +
          (isOpen ? '<div class="so-drill">' + st.items.sort(function (a, b) { return Math.abs(b.amount) - Math.abs(a.amount); }).slice(0, 50).map(function (x) {
            return '<div class="so-drill-row" data-deal="' + esc(x.r.id) + '"><span dir="auto">' + esc(x.r.merchant) + '</span><span>' + esc(nameOf(x.r.owner)) + '</span><span>' + esc(x.r.invoiceNo || '—') + '</span><b>' + signed(x.amount) + '</b><a href="' + esc(hsLink(x.r.id)) + '" target="_blank" rel="noopener" aria-label="HubSpot">' + ICON.ext + '</a></div>';
          }).join('') + '</div>' : '');
      }).join('') + '<div class="so-step so-step-total"><span>Metabase</span><span></span><b>' + money(rc.mb) + '</b><span></span></div></div>');
    // per rep
    var reps = (isFin() ? activeReps().map(function (u) { return lcEmail(u.email); }) : scopeEmails()).map(function (e) {
      var r = SO.recon(ST.model, ST.month, [e]);
      var big = r.steps.slice().sort(function (a, b) { return Math.abs(b.amount) - Math.abs(a.amount); })[0];
      return { e: e, hs: r.hs, mb: r.mb, gap: r.gap, big: big && Math.abs(big.amount) > 0 ? big : null };
    }).sort(function (a, b) { return Math.abs(b.gap) - Math.abs(a.gap); });
    var notCounted = rc.hsRows.filter(function (r) { return !r.counted; }).concat(rc.mbRows.filter(function (r) { return !r.won; }));
    html += '<div class="grid-2">' + card(L('By employee', 'حسب الموظف'), L('Largest gaps first', 'الأكبر فرقًا أولًا'),
      '<div class="tbl-wrap"><table><thead><tr><th>' + L('Employee', 'الموظف') + '</th><th class="num">HubSpot</th><th class="num">Metabase</th><th class="num">' + L('Gap', 'الفرق') + '</th><th>' + L('Biggest reason', 'السبب الأكبر') + '</th></tr></thead><tbody>' +
      reps.map(function (r) { return '<tr><td>' + esc(nameOf(r.e)) + '</td><td class="num">' + moneyC(r.hs) + '</td><td class="num">' + moneyC(r.mb) + '</td><td class="num">' + signed(r.gap) + '</td><td>' + (r.big ? esc(L(RECON_STEP[r.big.key][0], RECON_STEP[r.big.key][1])) : '—') + '</td></tr>'; }).join('') + '</tbody></table></div>') +
      card(L('Deals that do not count', 'صفقات غير محسوبة'), L('In one system but not the other', 'في نظام دون الآخر'),
        notCounted.length ? '<div class="tbl-wrap"><table><thead><tr><th>' + L('Merchant', 'التاجر') + '</th><th>' + L('Reason', 'السبب') + '</th><th class="num">SAR</th></tr></thead><tbody>' +
          notCounted.slice(0, 30).map(function (r) { var i = r.issues[0] || r.allIssues[0]; return '<tr class="rowlink" data-deal="' + esc(r.id) + '"><td><b dir="auto">' + esc(r.merchant) + '</b><span class="cell-sub">' + esc(nameOf(r.owner)) + '</span></td><td>' + (i ? esc(issueTitle(i.kind)) : L('Excluded type', 'نوع مستثنى')) + '</td><td class="num">' + money(r.inv || r.hs) + '</td></tr>'; }).join('') + '</tbody></table></div>'
          : '<p class="sub">' + L('Every deal lines up.', 'كل الصفقات متطابقة.') + '</p>') + '</div>';
    html += '<p class="sub so-note">' + L('Metabase is the source of truth for money: commission is always paid on the invoice net. HubSpot decides who owns a deal and whether it is won.', 'Metabase مرجع المبالغ: تُصرف العمولة دائمًا على صافي الفاتورة. وHubSpot يحدد مالك الصفقة وحالتها.') + '</p>';
    el.innerHTML = html;
    on(el, '[data-step]', 'click', function (n) { var k = n.getAttribute('data-step'); s.open = s.open === k ? null : k; VIEWS.recon.render(el); });
    on(el, '[data-deal]', 'click', function (n, e) { if (e.target.closest('a')) return; e.stopPropagation(); openDeal(n.getAttribute('data-deal')); });
  }
};

/* ---------------- Payouts ---------------- */
function grantFor(email, month) {
  var today = new Date().toISOString().slice(0, 10);
  return (ST.snap.grants || []).filter(function (g) { return g.active && lcEmail(g.grantee_email) === lcEmail(email) && g.month === month && g.ends_on >= today; })[0] || null;
}
function paidFor(email, month) {
  return (ST.snap.payouts || []).filter(function (p) { return lcEmail(p.rep_email) === lcEmail(email) && p.month === month && !p.reversed_at; })[0] || null;
}
VIEWS.payouts = {
  title: function () { return L('Payouts', 'الصرف'); },
  sub: function () { return L('Commission due per employee for the month. Finance marks it paid once it is in the payroll run.', 'العمولة المستحقة لكل موظف. تسجلها المالية مصروفة بعد إدراجها في الرواتب.'); },
  controls: { month: true },
  render: function (el) {
    var s = ST.v.payouts = ST.v.payouts || { picked: {}, date: new Date().toISOString().slice(0, 10), ref: '' };
    var grant = isFin() ? grantFor(me().email, ST.month) : null;
    if (isFin() && !grant) {
      el.innerHTML = emptyBox('lock', L('No access to this month', 'لا صلاحية لهذا الشهر'), L('Finance sees a month\'s payouts only while management has granted access to it. Ask the sales manager to grant it on Finance access.', 'ترى المالية صرف الشهر فقط أثناء منح الإدارة صلاحيته. اطلب من مدير المبيعات منحها من صفحة صلاحيات المالية.'));
      return;
    }
    var canPay = (isFin() && !!grant) || isAdmin();
    var rows = activeReps().map(function (u) {
      var e = lcEmail(u.email), rm = SO.repMonth(ST.model, e, ST.month), p = paidFor(e, ST.month);
      return { e: e, u: u, rm: rm, paid: p, status: p ? 'paid' : rm.calc.held ? 'held' : rm.calc.amount > 0 ? 'due' : 'none' };
    });
    var due = rows.filter(function (r) { return r.status === 'due'; });
    var sum = function (l) { return l.reduce(function (a, r) { return a + (r.paid && Number(r.paid.amount) ? Number(r.paid.amount) : r.rm.calc.amount); }, 0); };
    var picked = due.filter(function (r) { return s.picked[r.e]; });
    var html = '<section class="so-recon3">' +
      '<div class="card"><p class="t-label">' + L('Total due', 'إجمالي المستحق') + '</p><p class="so-big">' + money(sum(due)) + '</p><p class="sub">' + due.length + ' ' + L('employees', 'موظف') + '</p></div>' +
      '<div class="card"><p class="t-label">' + L('Paid', 'مصروف') + '</p><p class="so-big money-pos">' + money(sum(rows.filter(function (r) { return r.paid; }))) + '</p></div>' +
      '<div class="card"><p class="t-label">' + L('On hold', 'محجوز') + '</p><p class="so-big">' + money(sum(rows.filter(function (r) { return r.status === 'held'; }))) + '</p><p class="sub">' + L('Below the store minimum', 'أقل من الحد الأدنى للمتاجر') + '</p></div></section>';
    html += '<div class="filter-row">' + (grant ? pill('good', L('Access to ', 'صلاحية ') + monthName(ST.month) + L(' until ', ' حتى ') + dateShort(grant.ends_on)) : isMgr() && !isAdmin() ? pill('muted', L('Read only: finance records payments', 'للعرض فقط: المالية تسجل الصرف')) : '') +
      '<span class="spacer"></span>' + (canPay && due.length ? '<button class="ghost-btn" id="po-all">' + L('Select all due', 'تحديد كل المستحق') + '</button>' : '') +
      '<button class="btn secondary so-ib" id="po-csv">' + ICON.download + L('Export CSV', 'تصدير CSV') + '</button></div>';
    html += '<section class="card so-flush"><div class="tbl-wrap"><table><thead><tr><th></th><th>' + L('Employee', 'الموظف') + '</th><th>' + L('Plan', 'الخطة') + '</th><th class="num">' + L('Counted', 'المحسوب') + '</th><th class="num">' + L('Stores', 'المتاجر') + '</th><th class="num">' + L('Commission', 'العمولة') + '</th><th>' + L('Status', 'الحالة') + '</th><th></th></tr></thead><tbody>' +
      rows.map(function (r) {
        var st = { paid: pill('good', L('Paid', 'مصروف')), held: pill('warn', L('Held', 'محجوز')), due: pill('muted', L('Due', 'مستحق')), none: '<span class="sub">—</span>' }[r.status];
        return '<tr><td>' + (canPay && r.status === 'due' ? '<input type="checkbox" data-pick="' + esc(r.e) + '"' + (s.picked[r.e] ? ' checked' : '') + ' aria-label="' + esc(r.u.name) + '">' : '') + '</td>' +
          '<td><span class="u-cell"><span class="avatar so-av">' + esc(initials(r.u.name)) + '</span><b>' + esc(r.u.name) + '</b></span></td><td>' + esc(planName(r.rm.plan)) + '</td>' +
          '<td class="num">' + money(r.rm.closed) + '</td><td class="num">' + r.rm.stores + '</td><td class="num"><b>' + money(r.paid && Number(r.paid.amount) ? Number(r.paid.amount) : r.rm.calc.amount) + '</b></td>' +
          '<td>' + st + (r.paid ? '<span class="cell-sub">' + esc(r.paid.pay_ref || '') + ' · ' + dateShort(r.paid.paid_on) + '</span>' : '') + '</td>' +
          '<td>' + (canPay && r.paid ? '<button class="ghost-btn" data-rev="' + esc(r.paid.id) + '">' + L('Reverse', 'عكس') + '</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div></section>';
    if (picked.length) html += '<div class="bulk-bar"><b>' + picked.length + ' ' + L('selected', 'محدد') + ' · ' + money(sum(picked)) + '</b>' +
      '<label class="so-inline">' + L('Paid on', 'تاريخ الصرف') + ' <input type="date" id="po-date" value="' + esc(s.date) + '"></label>' +
      '<label class="so-inline">' + L('Reference', 'المرجع') + ' <input id="po-ref" value="' + esc(s.ref) + '" placeholder="PAY-' + s.date.replace(/-/g, '') + '"></label>' +
      '<span class="bulk-acts"></span><button class="btn secondary" id="po-cancel">' + L('Cancel', 'إلغاء') + '</button><button class="btn" id="po-pay">' + L('Mark as paid', 'تسجيل كمصروف') + '</button></div>';
    el.innerHTML = html;
    on(el, '[data-pick]', 'change', function (c) { s.picked[c.getAttribute('data-pick')] = c.checked; VIEWS.payouts.render(el); });
    var all = el.querySelector('#po-all'); if (all) all.addEventListener('click', function () { due.forEach(function (r) { s.picked[r.e] = true; }); VIEWS.payouts.render(el); });
    var cn = el.querySelector('#po-cancel'); if (cn) cn.addEventListener('click', function () { s.picked = {}; VIEWS.payouts.render(el); });
    var dt = el.querySelector('#po-date'); if (dt) dt.addEventListener('change', function () { s.date = dt.value; });
    var rf = el.querySelector('#po-ref'); if (rf) rf.addEventListener('input', function () { s.ref = rf.value; });
    var pay = el.querySelector('#po-pay');
    if (pay) pay.addEventListener('click', function () {
      var ref = s.ref.trim() || 'PAY-' + s.date.replace(/-/g, '');
      SO_API.W.markPaid(picked.map(function (r) { return { rep_email: r.e, month: ST.month, amount: Math.round(r.rm.calc.amount * 100) / 100, paid_on: s.date, pay_ref: ref }; })).then(function () {
        SO_API.W.audit('payout', 'Marked ' + picked.length + ' payouts as paid for ' + ST.month + ', ' + ref);
        s.picked = {}; toast(picked.length + L(' payouts marked as paid', ' عمليات صرف سُجلت')); reload();
      }, failToast);
    });
    on(el, '[data-rev]', 'click', function (b) {
      var id = b.getAttribute('data-rev');
      dialog({ title: L('Reverse this payment?', 'عكس هذا الصرف؟'), sub: L('It goes back to due. The reversal is logged.', 'يعود مستحقًا ويُسجَّل العكس.'), confirm: L('Reverse', 'عكس'), onConfirm: function () {
        SO_API.W.reversePaid(isNaN(Number(id)) ? id : Number(id)).then(function () { SO_API.W.audit('payout', 'Reversed payout ' + id); toast(L('Paid status reversed', 'عُكس الصرف')); reload(); }, failToast);
      } });
    });
    el.querySelector('#po-csv').addEventListener('click', function () {
      csvDownload('payouts-' + ST.month + '.csv', ['Rep', 'Email', 'Plan', 'Counted SAR', 'Stores', 'Tier rate %', 'Commission', 'Status', 'Reference'],
        rows.map(function (r) { return [r.u.name, r.e, planName(r.rm.plan), Math.round(r.rm.closed), r.rm.stores, r.rm.calc.rate, Math.round(r.rm.calc.amount), r.status, r.paid ? r.paid.pay_ref : '']; }));
    });
  }
};

/* ---------------- Finance access (grants) ---------------- */
VIEWS.grants = {
  title: function () { return L('Finance access', 'صلاحيات المالية'); },
  sub: function () { return L('Finance sees a month\'s payouts only while a grant is active. Grants end on their date.', 'ترى المالية صرف الشهر أثناء سريان الصلاحية فقط، وتنتهي في تاريخها.'); },
  controls: {},
  render: function (el) {
    var fins = ST.model.users.filter(function (u) { return u.role === 'finance' && u.active !== false; });
    var s = ST.v.grants = ST.v.grants || { who: fins[0] ? fins[0].email : '', month: SO.addMonths(SO.monthKey(new Date()), -1), ends: '' };
    if (!s.ends) { var d = new Date(); d.setDate(d.getDate() + 14); s.ends = d.toISOString().slice(0, 10); }
    var today = new Date().toISOString().slice(0, 10);
    var months = SO.monthsBack(SO.monthKey(new Date()), 6).reverse();
    el.innerHTML = card(L('New grant', 'صلاحية جديدة'), L('Granting a month again replaces the earlier grant for it.', 'منح نفس الشهر مجددًا يستبدل الصلاحية السابقة.'),
      fins.length ? '<div class="form-grid so-grid-4"><label class="f-label">' + L('Person', 'الشخص') + '<select id="g-who">' + fins.map(function (u) { return '<option value="' + esc(u.email) + '"' + (u.email === s.who ? ' selected' : '') + '>' + esc(u.name) + '</option>'; }).join('') + '</select></label>' +
        '<label class="f-label">' + L('Month', 'الشهر') + '<select id="g-month">' + months.map(function (m) { return '<option value="' + m + '"' + (m === s.month ? ' selected' : '') + '>' + esc(monthName(m)) + '</option>'; }).join('') + '</select></label>' +
        '<label class="f-label">' + L('Ends on', 'تنتهي في') + '<input type="date" id="g-ends" value="' + esc(s.ends) + '"></label>' +
        '<div class="so-end"><button class="btn" id="g-create">' + L('Grant access', 'منح الصلاحية') + '</button></div></div>'
        : '<p class="sub">' + L('Add a finance user on Access first.', 'أضف مستخدم مالية من صفحة الوصول أولًا.') + '</p>') +
      '<section class="card so-flush"><div class="tbl-wrap"><table><thead><tr><th>' + L('Person', 'الشخص') + '</th><th>' + L('Month', 'الشهر') + '</th><th>' + L('Ends on', 'تنتهي في') + '</th><th>' + L('Status', 'الحالة') + '</th><th></th></tr></thead><tbody>' +
      (ST.snap.grants || []).map(function (g) {
        var live = g.active && g.ends_on >= today;
        return '<tr><td><b>' + esc(nameOf(g.grantee_email)) + '</b></td><td>' + esc(monthName(g.month)) + '</td><td>' + dateShort(g.ends_on) + '</td><td>' + (live ? pill('good', L('Active', 'سارية')) : pill('muted', L('Ended', 'منتهية'))) + '</td>' +
          '<td>' + (live ? '<button class="ghost-btn" data-end="' + esc(g.id) + '">' + L('End now', 'إنهاء الآن') + '</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div></section>';
    var w = el.querySelector('#g-who'); if (w) w.addEventListener('change', function () { s.who = w.value; });
    var mo = el.querySelector('#g-month'); if (mo) mo.addEventListener('change', function () { s.month = mo.value; });
    var en = el.querySelector('#g-ends'); if (en) en.addEventListener('change', function () { s.ends = en.value; });
    var cr = el.querySelector('#g-create');
    if (cr) cr.addEventListener('click', function () {
      if (!s.ends || s.ends < today) return toast(L('Pick an end date in the future', 'اختر تاريخ انتهاء مستقبليًا'));
      SO_API.W.createGrant({ grantee_email: s.who, month: s.month, ends_on: s.ends }).then(function () {
        SO_API.W.audit('grant', 'Granted ' + nameOf(s.who) + ' access to ' + s.month + ' until ' + s.ends);
        toast(L('Finance access granted', 'مُنحت صلاحية المالية')); reload();
      }, failToast);
    });
    on(el, '[data-end]', 'click', function (b) {
      var id = b.getAttribute('data-end');
      SO_API.W.endGrant(isNaN(Number(id)) ? id : Number(id)).then(function () { SO_API.W.audit('grant', 'Ended finance grant ' + id); toast(L('Grant ended', 'انتهت الصلاحية')); reload(); }, failToast);
    });
  }
};

/* ---------------- Targets & plans ---------------- */
VIEWS.targets = {
  title: function () { return L('Targets & plans', 'الأهداف والخطط'); },
  sub: function () { return L('Each employee\'s plan and monthly target (as stated, including VAT). Changes apply to the month you pick and carry forward.', 'خطة كل موظف وهدفه الشهري (كما هو، شامل الضريبة). تسري على الشهر المختار وما بعده.'); },
  controls: { month: true },
  render: function (el) {
    var s = ST.v.targets = ST.v.targets || { dirty: {} };
    var rules = ST.model.rules, plans = rules.plans;
    var cats = {};
    ST.model.rows.forEach(function (r) { if (r.category && r.category !== 'Other') cats[r.category] = 1; });
    (ST.snap.showcase || []).forEach(function (r) { if (r.category) cats[String(r.category).trim()] = 1; });
    var catList = Object.keys(cats).sort();
    var rows = activeReps().map(function (u) {
      var e = lcEmail(u.email), tg = SO.targetFor(ST.model, e, ST.month), d = s.dirty[e] || {};
      var planId = d.plan || tg.plan.id, p = SO.planOf(rules, planId);
      return { e: e, u: u, plan: planId, p: p, target: d.target != null ? d.target : tg.targetStated, eff: d.eff || 'this',
        exc: d.exc != null ? d.exc : tg.exception, sectorMet: d.sectorMet != null ? d.sectorMet : tg.sectorMet,
        start: d.start != null ? d.start : (u.start_date || '').slice(0, 7), sector: d.sector != null ? d.sector : (u.sector || ''),
        tenure: tg.tenure, inherited: !tg.explicit };
    });
    var n = Object.keys(s.dirty).length;
    el.innerHTML = '<section class="card so-flush"><div class="tbl-wrap"><table><thead><tr><th>' + L('Employee', 'الموظف') + '</th><th>' + L('Plan', 'الخطة') + '</th><th>' + L('Monthly target (SAR, incl. VAT)', 'الهدف الشهري (ريال، شامل الضريبة)') + '</th><th>' + L('Applies from', 'يسري من') + '</th>' +
      '<th>' + L('Joined (new employees)', 'الانضمام (للموظف الجديد)') + '</th><th>' + L('Sector (sector leads)', 'القطاع (لمسؤول القطاع)') + '</th>' +
      '<th title="' + L('Pays commission below the store minimum', 'صرف العمولة دون الحد الأدنى للمتاجر') + '">' + L('Store exception', 'استثناء المتاجر') + '</th><th>' + L('Sector met (manual)', 'تحقق القطاع (يدويًا)') + '</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var probation = !!r.p.probation_targets, lead = !!r.p.sector_min_stores;
        return '<tr' + (s.dirty[r.e] ? ' class="so-here"' : '') + '><td><b>' + esc(r.u.name) + '</b>' +
            (probation && r.tenure ? '<span class="cell-sub">' + L('Month ' + r.tenure + ' since joining', 'الشهر ' + r.tenure + ' من الانضمام') + '</span>' : r.inherited && !s.dirty[r.e] ? '<span class="cell-sub">' + L('Carried from an earlier month', 'منقول من شهر سابق') + '</span>' : '') + '</td>' +
          '<td><select style="min-width:170px" data-k="plan" data-e="' + esc(r.e) + '">' + plans.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === r.plan ? ' selected' : '') + '>' + esc(planName(x)) + '</option>'; }).join('') + '</select></td>' +
          '<td><input type="number" min="0" step="5000" data-k="target" data-e="' + esc(r.e) + '" value="' + Math.round(r.target) + '" style="max-width:130px" dir="ltr">' +
            (probation ? '<span class="cell-sub">' + L('Set by month since joining', 'حسب شهر الانضمام') + '</span>' : '') + '</td>' +
          '<td><select data-k="eff" data-e="' + esc(r.e) + '"><option value="this"' + (r.eff === 'this' ? ' selected' : '') + '>' + esc(monthName(ST.month)) + '</option><option value="next"' + (r.eff === 'next' ? ' selected' : '') + '>' + esc(monthName(SO.addMonths(ST.month, 1))) + '</option></select></td>' +
          '<td>' + (probation ? '<input type="month" data-k="start" data-e="' + esc(r.e) + '" value="' + esc(r.start) + '" dir="ltr" style="max-width:150px">' : '<span class="sub">—</span>') + '</td>' +
          '<td>' + (lead ? '<select data-k="sector" data-e="' + esc(r.e) + '"><option value="">' + L('Not set', 'غير محدد') + '</option>' + catList.concat(r.sector && catList.indexOf(r.sector) < 0 ? [r.sector] : []).map(function (c) { return '<option value="' + esc(c) + '"' + (c === r.sector ? ' selected' : '') + '>' + esc(trCat(c)) + '</option>'; }).join('') + '</select>' : '<span class="sub">—</span>') + '</td>' +
          '<td><input type="checkbox" data-k="exc" data-e="' + esc(r.e) + '"' + (r.exc ? ' checked' : '') + '></td>' +
          '<td>' + (lead ? '<input type="checkbox" data-k="sectorMet" data-e="' + esc(r.e) + '"' + (r.sectorMet ? ' checked' : '') + '>' : '<span class="sub">—</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div></section>' +
      (n ? '<div class="bulk-bar"><b>' + n + ' ' + L('unsaved changes', 'تغييرات غير محفوظة') + '</b><span class="bulk-acts"></span><button class="btn secondary" id="tg-discard">' + L('Discard', 'تجاهل') + '</button><button class="btn" id="tg-save">' + L('Save targets', 'حفظ الأهداف') + '</button></div>' : '');
    on(el, '[data-k]', 'change', function (inp) {
      var e = inp.getAttribute('data-e'), k = inp.getAttribute('data-k');
      var d = s.dirty[e] = s.dirty[e] || {};
      d[k] = inp.type === 'checkbox' ? inp.checked : k === 'target' ? Number(inp.value) || 0 : inp.value;
      if (k === 'plan') { var np = SO.planOf(rules, inp.value); d.target = np.probation_targets ? np.probation_targets[0] : np.target; }
      VIEWS.targets.render(el);
    });
    var dc = el.querySelector('#tg-discard'); if (dc) dc.addEventListener('click', function () { s.dirty = {}; VIEWS.targets.render(el); });
    var sv = el.querySelector('#tg-save');
    if (sv) sv.addEventListener('click', function () {
      var changed = rows.filter(function (r) { return s.dirty[r.e]; });
      var targetRows = changed.map(function (r) {
        return { rep_email: r.e, month: r.eff === 'next' ? SO.addMonths(ST.month, 1) : ST.month, plan: r.plan, target: r.target, store_exception: !!r.exc, sector_met: !!r.sectorMet };
      });
      // Joining month and sector belong to the person, not the month.
      var people = changed.filter(function (r) { var d = s.dirty[r.e]; return d.start != null || d.sector != null || d.plan != null; });
      SO_API.W.saveTargets(targetRows).then(function () {
        return Promise.all(people.map(function (r) {
          var d = s.dirty[r.e], patch = { plan: r.plan };
          if (d.start != null) patch.start_date = d.start ? d.start + '-01' : null;
          if (d.sector != null) patch.sector = d.sector || null;
          return SO_API.W.updateUser(r.e, patch);
        }));
      }).then(function () {
        SO_API.W.audit('targets', 'Changed targets or plans for ' + targetRows.map(function (r) { return nameOf(r.rep_email) + ' (' + r.month + ')'; }).join(', '));
        s.dirty = {}; toast(L('Targets and plans saved', 'حُفظت الأهداف والخطط')); reload();
      }, failToast);
    });
  }
};

/* ---------------- Access ---------------- */
VIEWS.access = {
  title: function () { return L('Access', 'الوصول'); },
  sub: function () { return L('Only the people listed here can sign in. Anyone else who tries is told to contact sales management, and shows up under requests.', 'لا يدخل إلا من في هذه القائمة. من يحاول غيرهم يُطلب منه التواصل مع إدارة المبيعات ويظهر في الطلبات.'); },
  controls: {},
  render: function (el) {
    // Managers add employees and revoke employees' access, nothing more
    // (the database enforces the same rule, migration 007).
    var roles = isAdmin() ? ['rep', 'manager', 'finance', 'admin'] : ['rep'];
    var reqs = (ST.snap.attempts || []).filter(function (a) { return a.status === 'pending'; });
    var users = ST.model.users.slice().sort(function (a, b) { return (b.active !== false) - (a.active !== false) || a.name.localeCompare(b.name); });
    var roleSel = function (cur, attr) { return '<select ' + attr + '>' + roles.map(function (r) { return '<option value="' + r + '"' + (r === cur ? ' selected' : '') + '>' + esc(roleLabel(r)) + '</option>'; }).join('') + (roles.indexOf(cur) < 0 ? '<option selected disabled>' + esc(roleLabel(cur)) + '</option>' : '') + '</select>'; };
    el.innerHTML =
      card(isAdmin() ? L('Add people', 'إضافة أشخاص') : L('Add employees', 'إضافة موظفين'), L('Use their Zid Google address. Employees also need their HubSpot owner email to match.', 'استخدم بريد زد في Google. ويجب أن يطابق بريد الموظف بريد المالك في HubSpot.') + (isAdmin() ? '' : ' ' + L('Managers can add employees and revoke employees\' access; other roles are set by Sales Ops.', 'يمكن للمدير إضافة الموظفين وسحب وصولهم فقط، وتضبط عمليات المبيعات الأدوار الأخرى.')),
        '<div class="form-grid so-grid-4"><label class="f-label">' + L('Email', 'البريد') + '<input id="au-email" type="email" dir="ltr" placeholder="name@zid.sa"></label>' +
        '<label class="f-label">' + L('Name', 'الاسم') + '<input id="au-name" type="text"></label>' +
        (isAdmin() ? '<label class="f-label">' + L('Role', 'الدور') + roleSel('rep', 'id="au-role"') + '</label>' : '<input type="hidden" id="au-role" value="rep">') + '<div class="so-end"><button class="btn" id="au-add">' + L('Give access', 'منح الوصول') + '</button></div></div>' +
        '<p class="sub" style="margin-top:8px">' + (isAdmin() ? L('Several at once: paste one "email, name, role" per line.', 'عدة أشخاص: الصق "البريد، الاسم، الدور" في كل سطر.') : L('Several at once: paste one "email, name" per line.', 'عدة أشخاص: الصق "البريد، الاسم" في كل سطر.')) + ' <button class="linklike" id="au-bulk">' + L('Paste a list', 'لصق قائمة') + '</button></p>') +
      '<section class="card"><div class="card-head"><div><h3>' + L('Requests', 'الطلبات') + '</h3><p class="sub">' + L('People who signed in with Google but are not on the list', 'أشخاص دخلوا بحساب Google وليسوا في القائمة') + '</p></div>' + (reqs.length ? '<span class="count-badge">' + reqs.length + '</span>' : '') + '</div>' +
        (reqs.length ? reqs.map(function (q) {
          return '<div class="so-req"><span class="u-cell"><span class="avatar so-av">' + esc(initials(q.name || q.email)) + '</span><span><b>' + esc(q.name || q.email) + '</b><span class="cell-sub" dir="ltr">' + esc(q.email) + '</span></span></span>' +
            '<span class="sub">' + agoText(q.last_at) + (q.attempts > 1 ? ' · ' + q.attempts + L(' tries', ' محاولات') : '') + '</span>' +
            '<span class="so-row"><button class="ghost-btn" data-deny="' + esc(q.email) + '">' + L('Deny', 'رفض') + '</button><button class="btn so-sm" data-approve="' + esc(q.email) + '">' + L('Approve', 'قبول') + '</button></span></div>';
        }).join('') : '<p class="sub">' + L('No one is waiting.', 'لا يوجد طلبات.') + '</p>') + '</section>' +
      '<div class="so-split">' +
      '<section class="card so-flush"><div class="card-head" style="padding:16px 18px 0"><div><h3>' + L('Everyone with access', 'كل من لديه وصول') + '</h3><p class="sub">' + users.filter(function (u) { return u.active !== false; }).length + L(' active', ' نشط') + '</p></div></div><div class="tbl-wrap"><table><tbody>' +
        users.map(function (u) {
          var self = lcEmail(u.email) === lcEmail(ST.realEmail), locked = self || (!isAdmin() && u.role !== 'rep');
          return '<tr class="' + (u.active === false ? 'row-off' : '') + '"><td><b>' + esc(u.name) + '</b><span class="cell-sub" dir="ltr">' + esc(u.email) + '</span></td>' +
            '<td>' + (locked || !isAdmin() ? esc(roleLabel(u.role)) : roleSel(u.role, 'class="status-select" data-role="' + esc(u.email) + '"')) + '</td>' +
            '<td>' + (u.active === false ? pill('muted', L('Revoked', 'مسحوب')) : pill('good', L('Active', 'نشط'))) + '</td>' +
            '<td>' + (locked ? '' : u.active === false ? '<button class="ghost-btn" data-restore="' + esc(u.email) + '">' + L('Restore', 'استعادة') + '</button>' : '<button class="ghost-btn" data-revoke="' + esc(u.email) + '">' + L('Revoke', 'سحب') + '</button>') + '</td></tr>';
        }).join('') + '</tbody></table></div></section>' +
      card(L('Audit log', 'سجل التدقيق'), L('Every change to access, targets, rules and payouts', 'كل تغيير على الوصول والأهداف والقواعد والصرف'),
        '<div class="so-audit">' + (ST.snap.audit || []).slice(0, 60).map(function (a) { return '<div><p>' + esc(a.detail || a.action) + '</p><p class="sub">' + esc(nameOf(a.actor_email)) + ' · ' + agoText(a.at) + '</p></div>'; }).join('') + '</div>') + '</div>';

    function add(list) {
      SO_API.W.addUser(list[0]).then(function () {
        return list.slice(1).reduce(function (p, u) { return p.then(function () { return SO_API.W.addUser(u); }); }, Promise.resolve());
      }).then(function () {
        SO_API.W.audit('access', 'Gave access to ' + list.map(function (u) { return u.email + ' (' + u.role + ')'; }).join(', '));
        toast(list.length === 1 ? list[0].name + L(' can now sign in', ' يمكنه الدخول الآن') : list.length + L(' people added', ' أشخاص أُضيفوا')); reload();
      }, failToast);
    }
    el.querySelector('#au-add').addEventListener('click', function () {
      var email = lcEmail(el.querySelector('#au-email').value), name = el.querySelector('#au-name').value.trim(), r = el.querySelector('#au-role').value;
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast(L('Enter a valid email', 'أدخل بريدًا صحيحًا'));
      add([{ email: email, name: name || email.split('@')[0], role: r }]);
    });
    el.querySelector('#au-bulk').addEventListener('click', function () {
      dialog({ title: L('Paste a list', 'لصق قائمة'), sub: isAdmin() ? L('One per line: email, name, role (employee, manager, finance, admin). Role defaults to employee.', 'سطر لكل شخص: البريد، الاسم، الدور. الافتراضي موظف.') : L('One per line: email, name. Everyone is added as an employee.', 'سطر لكل شخص: البريد، الاسم. يُضاف الجميع كموظفين.'),
        body: '<textarea id="dlg-list" rows="8" dir="ltr" style="width:100%" placeholder="sara@zid.sa, Sara Alharbi, employee"></textarea>', confirm: L('Add all', 'إضافة الكل'),
        onConfirm: function (d) {
          var list = d.querySelector('#dlg-list').value.split(/\n+/).map(function (line) {
            var p = line.split(/[,\t;]/).map(function (x) { return x.trim(); });
            var r = (p[2] || 'rep').toLowerCase();
            if (r === 'employee' || r === 'موظف') r = 'rep';
            return { email: lcEmail(p[0]), name: p[1] || (p[0] || '').split('@')[0], role: roles.indexOf(r) >= 0 ? r : 'rep' };
          }).filter(function (u) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(u.email); });
          if (!list.length) { toast(L('No valid emails found', 'لا توجد عناوين صحيحة')); return false; }
          add(list);
        } });
    });
    on(el, '[data-approve]', 'click', function (b) {
      var q = (ST.snap.attempts || []).filter(function (a) { return a.email === b.getAttribute('data-approve'); })[0];
      dialog({ title: L('Approve ', 'قبول ') + (q.name || q.email), sub: esc(q.email) + (isAdmin() ? '' : ' · ' + L('as an employee', 'كموظف')),
        body: isAdmin() ? '<label class="f-label">' + L('Role', 'الدور') + roleSel('rep', 'id="dlg-role"') + '</label>' : '<input type="hidden" id="dlg-role" value="rep">', confirm: L('Approve', 'قبول'),
        onConfirm: function (d) { add([{ email: q.email, name: q.name || q.email.split('@')[0], role: d.querySelector('#dlg-role').value }]); } });
    });
    on(el, '[data-deny]', 'click', function (b) {
      var email = b.getAttribute('data-deny');
      dialog({ title: L('Deny access?', 'رفض الوصول؟'), sub: esc(email), body: '<label class="f-label">' + L('Reason they will see (optional)', 'سبب يراه (اختياري)') + '<input id="dlg-why"></label>', confirm: L('Deny', 'رفض'),
        onConfirm: function (d) { var why = d.querySelector('#dlg-why').value.trim(); SO_API.W.denyAttempt(email, why).then(function () { SO_API.W.audit('access', 'Denied ' + email + (why ? ': ' + why : '')); toast(L('Request denied', 'رُفض الطلب')); reload(); }, failToast); } });
    });
    on(el, '[data-role]', 'change', function (sel) { var e = sel.getAttribute('data-role'); SO_API.W.updateUser(e, { role: sel.value }).then(function () { SO_API.W.audit('access', 'Changed role of ' + e + ' to ' + sel.value); toast(L('Role updated', 'تغيّر الدور')); reload(); }, failToast); });
    on(el, '[data-revoke]', 'click', function (b) { var e = b.getAttribute('data-revoke'); SO_API.W.updateUser(e, { active: false }).then(function () { SO_API.W.audit('access', 'Revoked access for ' + e); toast(L('Access revoked', 'سُحب الوصول')); reload(); }, failToast); });
    on(el, '[data-restore]', 'click', function (b) { var e = b.getAttribute('data-restore'); SO_API.W.updateUser(e, { active: true }).then(function () { SO_API.W.audit('access', 'Restored access for ' + e); toast(L('Access restored', 'استُعيد الوصول')); reload(); }, failToast); });
  }
};
