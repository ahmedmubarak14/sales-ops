/* ============================================================
   Sales Ops Portal: demo data (?mode=mock, or no Supabase config)
   Shaped exactly like the live tables (docs/DATA_CONTRACT.md) so
   every view runs on the same code path. Deterministic: the same
   numbers on every load.
   ============================================================ */

var SO_MOCK = (function () {
  'use strict';
  var seed = 20261115;
  function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
  function pick(a) { return a[Math.floor(rnd() * a.length)]; }
  function between(a, b) { return Math.round(a + rnd() * (b - a)); }

  var NOW = new Date();
  var THIS_MONTH = SO.monthKey(NOW);

  var USERS = [
    { email: 'sara.alharbi@zid.sa', name: 'Sara Alharbi', role: 'rep', plan: 'senior', title: 'Senior Account Executive' },
    { email: 'faisal.alotaibi@zid.sa', name: 'Faisal Alotaibi', role: 'rep', plan: 'standard', title: 'Account Executive' },
    { email: 'noura.alqahtani@zid.sa', name: 'Noura Alqahtani', role: 'rep', plan: 'senior', title: 'Senior Account Executive' },
    { email: 'omar.alshehri@zid.sa', name: 'Omar Alshehri', role: 'rep', plan: 'standard', title: 'Account Executive' },
    { email: 'reem.aldosari@zid.sa', name: 'Reem Aldosari', role: 'rep', plan: 'standard', title: 'Account Executive' },
    { email: 'khalid.almutairi@zid.sa', name: 'Khalid Almutairi', role: 'rep', plan: 'lead', title: 'Team Lead' },
    { email: 'lama.alzahrani@zid.sa', name: 'Lama Alzahrani', role: 'rep', plan: 'standard', title: 'Account Executive' },
    { email: 'yousef.alghamdi@zid.sa', name: 'Yousef Alghamdi', role: 'rep', plan: 'standard', title: 'Account Executive' },
    { email: 'hind.alanazi@zid.sa', name: 'Hind Alanazi', role: 'manager', title: 'Sales Manager' },
    { email: 'majed.alsubaie@zid.sa', name: 'Majed Alsubaie', role: 'finance', title: 'Finance Specialist' },
    { email: 'dana.alrashid@zid.sa', name: 'Dana Alrashid', role: 'admin', title: 'Sales Operations' }
  ].map(function (u, i) { return Object.assign({ id: 'u' + i, active: true, hubspot_owner_id: String(9100 + i) }, u); });

  var CATS = ['Fashion', 'Electronics', 'Beauty & Perfumes', 'Food & Beverages', 'Home & Furniture', 'Health', 'Gifts & Flowers', 'Sports', 'Kids & Toys', 'Others'];
  var CAT_W = [18, 12, 16, 14, 9, 7, 8, 6, 6, 4];
  function pickCat() {
    var tot = CAT_W.reduce(function (a, b) { return a + b; }, 0), x = rnd() * tot;
    for (var i = 0; i < CATS.length; i++) { x -= CAT_W[i]; if (x <= 0) return CATS[i]; }
    return CATS[0];
  }
  var P1 = ['Noor', 'Layali', 'Bayt', 'Oud', 'Dar', 'Zahra', 'Rawda', 'Sama', 'Lulu', 'Najd', 'Hijaz', 'Wadi', 'Areej', 'Fanar', 'Misk', 'Qamar', 'Yasmin', 'Tala', 'Jood', 'Ruh'];
  var P2 = ['Store', 'Boutique', 'House', 'Market', 'Corner', 'Studio', 'Co.', 'Trading', 'Gallery', 'Lab'];
  var PLANS = [['Growth Monthly', 0.35], ['Growth Yearly', 1.0], ['Professional Monthly', 0.6], ['Professional Yearly', 1.7], ['Enterprise Yearly', 3.0]];
  var STAGES_OPEN = ['Prospect', 'Qualified', 'SQL', 'Commit'];

  var deals = [], invoices = [], storeSeq = 40000, dealSeq = 31000000, inv = 0;
  var reps = USERS.filter(function (u) { return u.role === 'rep'; });
  var skill = { 0: 1.35, 1: 0.9, 2: 1.2, 3: 0.75, 4: 1.0, 5: 1.5, 6: 0.85, 7: 0.65 };

  for (var back = 11; back >= 0; back--) {
    var mk = SO.addMonths(THIS_MONTH, -back);
    var y = Number(mk.slice(0, 4)), m = Number(mk.slice(5, 7)) - 1;
    var lastDay = back === 0 ? NOW.getDate() : new Date(y, m + 1, 0).getDate();
    reps.forEach(function (rep, ri) {
      var n = Math.round((back === 0 ? lastDay / 30 : 1) * between(26, 38) * skill[ri]);
      for (var k = 0; k < n; k++) {
        var day = between(1, lastDay);
        var close = new Date(y, m, day, 12);
        var plan = pick(PLANS);
        var amount = Math.round((between(2400, 4200) * plan[1]) / 10) * 10;
        var storeId = String(storeSeq++);
        var id = String(dealSeq++);
        var cat = pickCat();
        var name = pick(P1) + ' ' + pick(P2);
        var roll = rnd();
        var won = roll < 0.78, lost = !won && roll < 0.9;
        var d = {
          hubspot_deal_id: id, deal_name: name, store_id: storeId,
          owner_id: rep.hubspot_owner_id, owner_email: rep.email, owner_name: rep.name,
          pipeline: 'sales', stage: won ? 'closedwon' : lost ? 'closedlost' : 'open',
          stage_label: won ? 'Closed Won' : lost ? 'Closed Lost' : pick(STAGES_OPEN),
          is_won: won, is_closed: won || lost, amount: amount,
          close_date: close.toISOString(), created_at_hs: new Date(close.getTime() - between(5, 40) * 864e5).toISOString(),
          deal_type: rnd() < 0.86 ? 'New' : 'Upgrade', category: cat
        };
        deals.push(d);
        // Invoices: most won deals invoiced in the same month at the same amount.
        var invRoll = rnd();
        if (won) {
          if (invRoll < 0.06 && back <= 2) continue; // no invoice yet
          var net = amount;
          if (invRoll > 0.94) net = Math.round(amount * (0.82 + rnd() * 0.1)); // discount after the fact
          var pd = new Date(close.getTime());
          if (invRoll > 0.9 && invRoll <= 0.94 && day > 24) pd = new Date(y, m + 1, between(1, 4), 12); // paid next month
          if (pd > NOW) pd = new Date(close.getTime());
          var repEmail = invRoll > 0.885 && invRoll <= 0.9 ? reps[(ri + 1) % reps.length].email : rep.email;
          invoices.push({
            item_id: 'I' + (inv++), hubspot_deal_id: id, store_id: storeId, invoice_number: 'INV-' + (500000 + inv),
            purchase_date: pd.toISOString().slice(0, 10), period: SO.monthKey(pd), purchasable_name: plan[0],
            action: rnd() < 0.04 ? 'Renewal' : 'First Subscription', purchase_gender: 'subscriptions',
            net: net, gross: Math.round(net * 1.15), rep_email: repEmail
          });
        } else if (!lost && invRoll < 0.08 && back <= 1) {
          // paid but the deal was left open in HubSpot
          invoices.push({
            item_id: 'I' + (inv++), hubspot_deal_id: id, store_id: storeId, invoice_number: 'INV-' + (500000 + inv),
            purchase_date: close.toISOString().slice(0, 10), period: mk, purchasable_name: plan[0],
            action: 'First Subscription', purchase_gender: 'subscriptions', net: amount, gross: Math.round(amount * 1.15), rep_email: rep.email
          });
        }
      }
    });
  }
  // two duplicates: the same store won twice by different reps this month
  var thisWon = deals.filter(function (d) { return d.is_won && SO.monthKey(d.close_date) === THIS_MONTH; });
  if (thisWon.length > 6) {
    var a = thisWon.filter(function (d) { return d.owner_email === reps[1].email; }), b2 = thisWon.filter(function (d) { return d.owner_email === reps[4].email; });
    if (a[0] && b2[0]) b2[0].store_id = a[0].store_id;
  }

  // targets: this month and last, with one exception and one sector flag
  var targets = [];
  [SO.addMonths(THIS_MONTH, -1), THIS_MONTH].forEach(function (mk) {
    reps.forEach(function (r, i) {
      var p = SO.planOf(SO.DEFAULT_RULES, r.plan);
      targets.push({ rep_email: r.email, month: mk, plan: r.plan, target: p.target + (i % 3) * 10000,
        store_exception: mk === THIS_MONTH && i === 7, sector_met: r.plan === 'senior' && i === 0 });
    });
  });

  // Top Zid Stores: ten per category (made-up names, demo only)
  var showcase = [];
  CATS.forEach(function (c, ci) {
    for (var i = 1; i <= 10; i++) {
      var nm = pick(P1) + ' ' + pick(P1) + (i % 3 ? '' : ' ' + pick(P2));
      showcase.push({ store_id: 'S' + ci + '-' + i, name: nm, category: c, rank_in_category: i,
        store_url: i % 4 === 0 ? null : nm.toLowerCase().replace(/[^a-z]+/g, '') + '.zid.store' });
    }
  });

  var today = NOW.toISOString().slice(0, 10);
  var lastMonth = SO.addMonths(THIS_MONTH, -1);
  var ago = function (min) { return new Date(NOW.getTime() - min * 60000).toISOString(); };

  function snapshot() {
    return {
      users: USERS.slice(), deals: deals, invoices: invoices, targets: targets,
      rules: SO.DEFAULT_RULES, ruleVersion: 3,
      issueStates: [], comments: [],
      payouts: reps.slice(0, 3).map(function (r, i) {
        return { id: i + 1, rep_email: r.email, month: SO.addMonths(THIS_MONTH, -2), amount: 0, paid_on: SO.addMonths(THIS_MONTH, -1) + '-05', pay_ref: 'PAY-' + SO.addMonths(THIS_MONTH, -1).replace('-', '') + '05', paid_by: 'majed.alsubaie@zid.sa' };
      }),
      grants: [{ id: 1, grantee_email: 'majed.alsubaie@zid.sa', month: lastMonth, ends_on: SO.addMonths(THIS_MONTH, 1) + '-10', active: true, created_by: 'hind.alanazi@zid.sa', created_at: ago(60 * 24 * 3) }],
      audit: [
        { at: ago(35), actor_email: 'hind.alanazi@zid.sa', action: 'targets', detail: 'Changed target for Omar Alshehri, ' + THIS_MONTH },
        { at: ago(60 * 26), actor_email: 'dana.alrashid@zid.sa', action: 'rules', detail: 'Saved commission rules, version 3' },
        { at: ago(60 * 24 * 3), actor_email: 'hind.alanazi@zid.sa', action: 'grant', detail: 'Granted Majed Alsubaie access to ' + lastMonth }
      ],
      attempts: [
        { email: 'turki.alhamdan@zid.sa', name: 'Turki Alhamdan', first_at: ago(60 * 5), last_at: ago(60 * 2), attempts: 2, status: 'pending' },
        { email: 'abeer.saleh@zid.sa', name: 'Abeer Saleh', first_at: ago(60 * 30), last_at: ago(60 * 30), attempts: 1, status: 'pending' }
      ],
      integrations: [
        { name: 'hubspot', settings: { pipelines: ['sales'], amount_prop: 'amount_without_vat', category_prop: 'industry' }, secret_set: true, last_synced_at: ago(3), last_status: 'ok' },
        { name: 'metabase', settings: { base_url: 'https://bi-new.mszid.com', card_invoices: '' }, secret_set: true, last_synced_at: ago(14), last_status: 'ok' },
        { name: 'metabase_ssh', settings: { enabled: true, host: 'gateway.example', port: '22', username: 'sales-ops', target_url: 'https://bi-new.mszid.com' }, secret_set: true }
      ],
      runs: [
        { at: ago(3), source: 'hubspot', status: 'ok', rows: 42, note: 'Scheduled' },
        { at: ago(14), source: 'metabase', status: 'ok', rows: invoices.length, note: 'Invoices' },
        { at: ago(14), source: 'metabase', status: 'ok', rows: showcase.length, note: 'Top stores' },
        { at: ago(8), source: 'hubspot', status: 'ok', rows: 17, note: 'Scheduled' },
        { at: ago(44), source: 'metabase', status: 'error', rows: 0, note: 'Metabase did not answer within 90 s' }
      ],
      showcase: showcase,
      settings: { hubspot_portal_id: '0000000', hubspot_ui_domain: 'app.hubspot.com' },
      today: today
    };
  }
  return { USERS: USERS, snapshot: snapshot };
})();
