/* ============================================================
   Sales Ops Portal: business logic (no DOM)
   - which deals count, in which month, for how much
   - data issues between HubSpot (pipeline) and Metabase (money)
   - the commission engine (tiers, accelerator, store minimum)
   - reconciliation (HubSpot total -> Metabase total)
   Metabase owns the money: a deal counts at its invoice net, in the
   month of its invoice. HubSpot owns ownership and stage.
   ============================================================ */

var SO = (function () {
  'use strict';

  var DEFAULT_RULES = {
    plans: [
      { id: 'standard', name: 'Standard', target: 100000 },
      { id: 'senior', name: 'Senior', target: 150000, sector_bonus_pct: 1 },
      { id: 'lead', name: 'Team lead', target: 200000 }
    ],
    tiers: [
      { from: 0, rate: 0 }, { from: 50, rate: 3 }, { from: 80, rate: 5 },
      { from: 100, rate: 7 }, { from: 130, rate: 9 }
    ],
    accelerator: { above_pct: 150, block_sar: 10000, per_block: 3000 },
    min_stores: 15,
    tolerance_pct: 5,
    cutoff_day: 3,
    exclusions: ['Renewal', 'Themes', 'Apps'],
    rule_text: [
      'A deal counts when it is Closed Won in HubSpot and has a paid Metabase invoice.',
      'The amount that counts is the invoice net (excl. VAT), never the HubSpot amount.',
      'A deal counts in the month of its invoice, whatever its close date says.',
      'Your tier is set by achievement against your monthly target, and applies to the whole month.',
      'Commission is held until you have closed at least 15 stores in the month, unless management grants an exception.',
      'Fix data issues before the cutoff on the 3rd of the next month; later fixes count in the following payout.'
    ]
  };

  var ALL_EXCLUSIONS = ['Renewal', 'Themes', 'Apps', 'Upgrade', 'Add-on'];

  function monthKey(d) {
    if (!d) return null;
    if (typeof d === 'string') return d.slice(0, 7);
    var x = new Date(d);
    if (isNaN(x)) return null;
    return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0');
  }
  function addMonths(key, n) {
    var y = Number(key.slice(0, 4)), m = Number(key.slice(5, 7)) - 1 + n;
    var d = new Date(y, m, 1);
    return monthKey(d);
  }
  function monthsBack(key, n) { // n keys ending at key, oldest first
    var out = [];
    for (var i = n - 1; i >= 0; i--) out.push(addMonths(key, -i));
    return out;
  }
  function lc(s) { return String(s || '').trim().toLowerCase(); }

  /* ---------------- model ---------------- */
  /* snap: { users, deals, invoices, targets, issueStates, rules }
     Returns indexes every view reads. */
  function buildModel(snap) {
    var rules = Object.assign({}, DEFAULT_RULES, snap.rules || {});
    var invByDeal = {}, invByStore = {};
    (snap.invoices || []).forEach(function (v) {
      (invByDeal[v.hubspot_deal_id] = invByDeal[v.hubspot_deal_id] || []).push(v);
    });
    var stateOf = {};
    (snap.issueStates || []).forEach(function (s) { stateOf[s.hubspot_deal_id + '|' + s.kind] = s; });

    var excl = (rules.exclusions || []).map(lc);
    var tol = (Number(rules.tolerance_pct) || 0) / 100;

    // The store a deal is for: HubSpot's store ID property when it is set,
    // else the Store ID on the deal's Metabase invoice (always present).
    function storeOf(d) {
      if (d.store_id) return String(d.store_id);
      var v = (invByDeal[d.hubspot_deal_id] || []).filter(function (x) { return x.store_id; })[0];
      return v ? String(v.store_id) : '';
    }
    var wonByStore = {};
    (snap.deals || []).forEach(function (d) {
      var st = storeOf(d);
      if (d.is_won && st) (wonByStore[st] = wonByStore[st] || []).push(d.hubspot_deal_id);
    });

    var rows = (snap.deals || []).map(function (d) {
      var inv = invByDeal[d.hubspot_deal_id] || [];
      var subInv = inv.filter(function (v) { return !v.purchase_gender || lc(v.purchase_gender) === 'subscriptions'; });
      var countable = subInv.filter(function (v) { return excl.indexOf(lc(v.action)) < 0; });
      var excluded = subInv.filter(function (v) { return excl.indexOf(lc(v.action)) >= 0; });
      var invNet = countable.reduce(function (s, v) { return s + Number(v.net || 0); }, 0);
      var exclNet = excluded.reduce(function (s, v) { return s + Number(v.net || 0); }, 0);
      var invMonth = countable.map(function (v) { return v.period || monthKey(v.purchase_date); }).sort()[0] || null;
      var closeMonth = monthKey(d.close_date);
      var invNums = countable.map(function (v) { return v.invoice_number; }).filter(Boolean);
      var hs = Number(d.amount || 0);
      var r = {
        id: d.hubspot_deal_id, deal: d, merchant: d.deal_name || d.hubspot_deal_id,
        owner: lc(d.owner_email), ownerName: d.owner_name || '', storeId: storeOf(d),
        category: (d.category || '').trim() || 'Other', type: d.deal_type || 'New',
        stage: d.stage_label || d.stage || '', won: !!d.is_won, closed: !!d.is_closed,
        hs: hs, inv: invNet, exclNet: exclNet, invoices: inv, invoiceNo: invNums[0] || '',
        invMonth: invMonth, closeMonth: closeMonth,
        month: invMonth || closeMonth || monthKey(d.created_at_hs),
        counted: false, countedAmount: 0, countsFor: lc(d.owner_email),
        issues: [], allIssues: []
      };
      var issues = [];
      function add(kind, sev, counts, stake) { issues.push({ kind: kind, sev: sev, counts: counts, stake: stake }); }
      if (r.won && !countable.length && !excluded.length) add('no_invoice', 'high', false, hs);
      if (!r.won && countable.length) add('not_won', 'high', false, invNet);
      if (r.won && countable.length && invNet > 0 && Math.abs(hs - invNet) / invNet > tol) add('amount_gap', 'medium', true, Math.abs(hs - invNet));
      if (r.won && countable.length && closeMonth && invMonth && closeMonth !== invMonth) add('month_gap', 'low', true, invNet);
      var invRep = countable.map(function (v) { return lc(v.rep_email); }).filter(Boolean)[0];
      if (r.won && invRep && r.owner && invRep !== r.owner) add('owner_gap', 'medium', true, invNet);
      if (r.won && r.storeId && (wonByStore[r.storeId] || []).length > 1) add('duplicate', 'medium', true, invNet || hs);

      // management decisions and fixes recorded on the issue
      issues.forEach(function (i) {
        var st = stateOf[r.id + '|' + i.kind];
        i.status = st ? st.status : 'open';
        i.assignee = st ? st.assignee || '' : '';
        i.decision = st ? st.decision || '' : '';
        i.updatedAt = st ? st.updated_at : null;
      });
      r.allIssues = issues;
      r.issues = issues.filter(function (i) { return i.status === 'open' || i.status === 'waiting'; });

      // counting
      var dup = issues.filter(function (i) { return i.kind === 'duplicate'; })[0];
      var dupOut = dup && dup.decision === 'dismiss';
      if (r.won && countable.length && !dupOut) {
        r.counted = true; r.countedAmount = invNet;
      }
      var own = issues.filter(function (i) { return i.kind === 'owner_gap'; })[0];
      if (own && own.decision === 'reassign') r.countsFor = invRep;
      return r;
    });

    var byId = {};
    rows.forEach(function (r) { byId[r.id] = r; });
    rows.forEach(function (r) {
      var dup = r.allIssues.filter(function (i) { return i.kind === 'duplicate'; })[0];
      if (dup) dup.pairId = (wonByStore[r.storeId] || []).filter(function (x) { return x !== r.id; })[0] || null;
    });

    var users = snap.users || [];
    var reps = users.filter(function (u) { return u.role === 'rep'; });
    return {
      rules: rules, rows: rows, byId: byId, users: users, reps: reps,
      targets: snap.targets || [],
      userByEmail: users.reduce(function (m, u) { m[lc(u.email)] = u; return m; }, {})
    };
  }

  /* ---------------- targets & plans ---------------- */
  function planOf(rules, id) {
    return (rules.plans || []).filter(function (p) { return p.id === id; })[0] || (rules.plans || [])[0] || { id: 'standard', name: 'Standard', target: 0 };
  }
  // The target row in force for a month: that month's, else the latest
  // earlier one, else the plan default from the user record.
  function targetFor(model, email, month) {
    email = lc(email);
    var own = model.targets.filter(function (t) { return lc(t.rep_email) === email && t.month <= month; })
      .sort(function (a, b) { return a.month < b.month ? 1 : -1; });
    var exact = own.filter(function (t) { return t.month === month; })[0];
    var row = exact || own[0];
    var u = model.userByEmail[email] || {};
    var plan = planOf(model.rules, (row && row.plan) || u.plan);
    return {
      plan: plan,
      target: row && row.target != null ? Number(row.target) : Number(plan.target || 0),
      exception: !!(exact && exact.store_exception),
      sectorMet: !!(exact && exact.sector_met),
      explicit: !!exact
    };
  }

  /* ---------------- commission engine ---------------- */
  function tierFor(rules, achPct) {
    var tiers = (rules.tiers || []).slice().sort(function (a, b) { return a.from - b.from; });
    var cur = tiers[0] || { from: 0, rate: 0 }, idx = 0;
    tiers.forEach(function (t, i) { if (achPct >= t.from) { cur = t; idx = i; } });
    return { tier: cur, index: idx, next: tiers[idx + 1] || null, all: tiers };
  }
  function commission(rules, plan, target, counted, stores, exception, sectorMet) {
    var ach = target > 0 ? counted / target * 100 : 0;
    var tf = tierFor(rules, ach);
    var base = counted * (Number(tf.tier.rate) || 0) / 100;
    var a = rules.accelerator || {};
    var accel = 0, blocks = 0;
    if (a.above_pct && a.block_sar && target > 0) {
      var over = counted - target * a.above_pct / 100;
      if (over > 0) { blocks = Math.floor(over / a.block_sar); accel = blocks * (Number(a.per_block) || 0); }
    }
    var sector = sectorMet && plan && plan.sector_bonus_pct ? counted * plan.sector_bonus_pct / 100 : 0;
    var minStores = Number(rules.min_stores) || 0;
    var held = stores < minStores && !exception;
    return {
      ach: ach, tier: tf.tier, tierIndex: tf.index, nextTier: tf.next, rate: Number(tf.tier.rate) || 0,
      base: base, accel: accel, blocks: blocks, sector: sector,
      amount: base + accel + sector, held: held, storesShort: Math.max(0, minStores - stores)
    };
  }

  // Everything one rep has for one month.
  function repMonth(model, email, month) {
    email = lc(email);
    var rows = model.rows.filter(function (r) { return r.month === month && (r.countsFor === email || r.owner === email); });
    var counted = rows.filter(function (r) { return r.counted && r.countsFor === email; });
    var closed = counted.reduce(function (s, r) { return s + r.countedAmount; }, 0);
    var hsClosed = rows.filter(function (r) { return r.won && r.owner === email; }).reduce(function (s, r) { return s + r.hs; }, 0);
    var storeSet = {};
    counted.forEach(function (r) { storeSet[r.storeId || r.id] = 1; });
    var stores = Object.keys(storeSet).length;
    var tg = targetFor(model, email, month);
    var c = commission(model.rules, tg.plan, tg.target, closed, stores, tg.exception, tg.sectorMet);
    var issues = [];
    rows.forEach(function (r) { r.issues.forEach(function (i) { issues.push({ row: r, issue: i }); }); });
    var atStake = issues.filter(function (x) { return !x.issue.counts; }).reduce(function (s, x) { return s + x.issue.stake; }, 0);
    return {
      email: email, month: month, rows: rows, countedRows: counted, closed: closed, hsClosed: hsClosed,
      stores: stores, plan: tg.plan, target: tg.target, exception: tg.exception, sectorMet: tg.sectorMet,
      calc: c, issues: issues, atStake: atStake, gap: Math.max(0, tg.target - closed)
    };
  }

  // What-if: the same month with extra SAR and stores.
  function whatIf(model, rm, extra, extraStores) {
    return commission(model.rules, rm.plan, rm.target, rm.closed + extra, rm.stores + extraStores, rm.exception, rm.sectorMet);
  }

  // Commission at each tier boundary and accelerator step, for the ladder.
  function ladder(model, rm) {
    var rules = model.rules, out = [], tiers = tierFor(rules, 0).all;
    tiers.forEach(function (t, i) {
      var amt = rm.target * t.from / 100;
      var c = commission(rules, rm.plan, rm.target, amt, Math.max(rm.stores, rules.min_stores), true, rm.sectorMet);
      out.push({ closed: amt, pct: t.from, rate: t.rate, comm: c.amount, tierIndex: i, cliff: false });
    });
    var a = rules.accelerator || {};
    if (a.above_pct && a.block_sar) {
      for (var b = 0; b <= 3; b++) {
        var amt2 = rm.target * a.above_pct / 100 + b * a.block_sar;
        var c2 = commission(rules, rm.plan, rm.target, amt2, Math.max(rm.stores, rules.min_stores), true, rm.sectorMet);
        out.push({ closed: amt2, pct: rm.target ? amt2 / rm.target * 100 : 0, rate: c2.rate, comm: c2.amount, tierIndex: c2.tierIndex, cliff: b === 0 });
      }
    }
    out.sort(function (x, y) { return x.closed - y.closed; });
    return out;
  }

  // Consecutive months at or above target, ending with `month`.
  function streak(model, email, month) {
    var n = 0, m = month;
    for (var i = 0; i < 24; i++) {
      var rm = repMonth(model, email, m);
      if (rm.target > 0 && rm.closed >= rm.target) { n += 1; m = addMonths(m, -1); } else break;
    }
    return n;
  }

  /* ---------------- reconciliation ---------------- */
  // HubSpot closed-won total for the month, walked step by step to the
  // Metabase invoiced total. Every step is a list of deals.
  function recon(model, month, emails) {
    var inScope = function (r) { return !emails || emails.indexOf(r.owner) >= 0 || emails.indexOf(r.countsFor) >= 0; };
    var hsRows = model.rows.filter(function (r) { return r.won && (r.closeMonth === month) && inScope(r); });
    var mbRows = model.rows.filter(function (r) { return r.invMonth === month && r.inv > 0 && inScope(r); });
    var hs = hsRows.reduce(function (s, r) { return s + r.hs; }, 0);
    var mb = mbRows.reduce(function (s, r) { return s + r.inv; }, 0);
    function pick(list, fn) { return list.map(function (r) { return { r: r, amount: fn(r) }; }).filter(function (x) { return Math.abs(x.amount) > 0.5; }); }
    var steps = [
      { key: 'noInvoice', items: pick(hsRows.filter(function (r) { return !r.invoices.length; }), function (r) { return -r.hs; }) },
      { key: 'excluded', items: pick(hsRows.filter(function (r) { return r.exclNet > 0 && !r.inv; }), function (r) { return -r.hs; }) },
      { key: 'otherMonth', items: pick(hsRows.filter(function (r) { return r.inv > 0 && r.invMonth !== month; }), function (r) { return -r.hs; }) },
      { key: 'amountDiff', items: pick(hsRows.filter(function (r) { return r.inv > 0 && r.invMonth === month; }), function (r) { return r.inv - r.hs; }) },
      { key: 'fromOtherMonth', items: pick(mbRows.filter(function (r) { return r.won && r.closeMonth !== month; }), function (r) { return r.inv; }) },
      { key: 'notWon', items: pick(mbRows.filter(function (r) { return !r.won; }), function (r) { return r.inv; }) }
    ];
    steps.forEach(function (s) { s.amount = s.items.reduce(function (a, x) { return a + x.amount; }, 0); });
    var explained = steps.reduce(function (a, s) { return a + s.amount; }, 0);
    var storesOf = function (list) { var o = {}; list.forEach(function (r) { o[r.storeId || r.id] = 1; }); return Object.keys(o).length; };
    return {
      hs: hs, mb: mb, gap: mb - hs, steps: steps, unexplained: (mb - hs) - explained,
      hsDeals: hsRows.length, mbDeals: mbRows.length, hsStores: storesOf(hsRows), mbStores: storesOf(mbRows),
      hsRows: hsRows, mbRows: mbRows
    };
  }

  // The cutoff for fixing a month's issues: cutoff_day of the next month.
  function cutoffOf(rules, month) {
    var next = addMonths(month, 1);
    return new Date(Number(next.slice(0, 4)), Number(next.slice(5, 7)) - 1, Number(rules.cutoff_day) || 3, 23, 59);
  }

  return {
    DEFAULT_RULES: DEFAULT_RULES, ALL_EXCLUSIONS: ALL_EXCLUSIONS,
    monthKey: monthKey, addMonths: addMonths, monthsBack: monthsBack, lc: lc,
    buildModel: buildModel, targetFor: targetFor, planOf: planOf, tierFor: tierFor,
    commission: commission, repMonth: repMonth, whatIf: whatIf, ladder: ladder, streak: streak,
    recon: recon, cutoffOf: cutoffOf
  };
})();
