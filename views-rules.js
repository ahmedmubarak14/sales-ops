/* ============================================================
   Sales Ops Portal: Commission rules
   Laid out like Sales Hunter's Terms & Conditions page: everyone
   reads the rules as one document; admins get the same page with an
   Edit / Preview switch and Sales Hunter's publish bar. The document
   is written from the rule numbers themselves (rule_versions.config),
   so what people read is always what the engine pays.
   ============================================================ */

function planName(p) { return p ? L(p.name, p.name_ar || p.name) : ''; }
function fmtInt(n) { return Math.round(Number(n) || 0).toLocaleString('en-US'); }
function ratesLine(t, lang) {
  return lang === 'ar'
    ? 'عند تحقيق ' + t.from + '% من المستهدف: ' + t.rate + '% من صافي المبيعات'
    : 'From ' + t.from + '% of target: ' + t.rate + '% of net sales';
}

// The rules as a document, in one language. Shared by this page and the
// calculator.
function rulesDocHtml(r, lang) {
  var ar = lang === 'ar', vat = Number(r.vat_pct) || 0;
  var T = function (en, a) { return ar ? a : en; };
  var net = function (v) { return r.target_includes_vat && vat ? v / (1 + vat / 100) : v; };
  var sar = function (v) { return ar ? fmtInt(v) + ' ريال' : 'SAR ' + fmtInt(v); };
  var html = '';
  html += '<h3>' + T('Targets and how commission is worked out', 'المستهدفات وطريقة احتساب العمولة') + '</h3>' +
    '<p>' + (r.target_includes_vat
      ? T('Targets include VAT (' + vat + '%). Commission is paid on net sales, the invoice amount without VAT, so a target of SAR 70,000 means SAR ' + fmtInt(net(70000)) + ' of net sales.',
          'المستهدفات شاملة الضريبة (' + vat + '%). تُحتسب العمولة على صافي المبيعات، أي مبلغ الفاتورة بدون الضريبة، فالمستهدف 70,000 ريال يعادل ' + fmtInt(net(70000)) + ' ريال من صافي المبيعات.')
      : T('Targets and commission are both on net sales (without VAT).', 'المستهدفات والعمولة كلها على صافي المبيعات (بدون الضريبة).')) + '</p>';
  (r.plans || []).forEach(function (p) {
    html += '<h3>' + esc(ar ? (p.name_ar || p.name) : p.name) + '</h3><ul>';
    if (p.probation_targets && p.probation_targets.length) {
      p.probation_targets.forEach(function (v, i) {
        html += '<li>' + T('Month ' + (i + 1) + ' after joining: ', 'الشهر ' + (i + 1) + ' من الانضمام: ') + sar(v) + '</li>';
      });
      html += '<li>' + T('If the target is not met during the trial period, the contract is not renewed or confirmed.', 'في حال عدم تحقيق المستهدف خلال فترة التجربة لا يتم التجديد أو تثبيت الموظف.') + '</li>';
      var paid = (p.tiers || []).filter(function (t) { return Number(t.rate) > 0; });
      if (!paid.length) html += '<li>' + T('No commission during the trial period.', 'لا عمولة خلال فترة التجربة.') + '</li>';
      else paid.forEach(function (t) { html += '<li>' + ratesLine(t, lang) + '</li>'; });
    } else {
      html += '<li>' + T('Monthly target: ', 'الهدف الشهري: ') + sar(p.target) + (r.target_includes_vat ? T(' including VAT', ' شامل الضريبة') : '') + '</li>';
      var tiers = (p.tiers || []).filter(function (t) { return Number(t.rate) > 0; }).sort(function (a, b) { return a.from - b.from; });
      tiers.forEach(function (t) {
        html += '<li>' + ratesLine(t, lang) + ' (' + sar(net(p.target) * t.from / 100 * t.rate / 100) + T(' at exactly ' + t.from + '%', ' عند ' + t.from + '% تمامًا') + ')</li>';
      });
      if (tiers.length) html += '<li>' + T('Below ' + tiers[0].from + '% of target: no commission.', 'أقل من ' + tiers[0].from + '% من المستهدف: لا عمولة.') + '</li>';
      if (p.sector_min_stores) html += '<li>' + T('At least ' + p.sector_min_stores + ' stores from your own sector each month. Without them, no commission.', 'على الأقل ' + p.sector_min_stores + ' متاجر من ضمن القطاع شهريًا، ولا يحصل الموظف على عمولة عند عدم تحقيقها.') + '</li>';
    }
    html += '</ul>';
  });
  html += '<h3>' + T('Number of stores', 'عدد المتاجر') + '</h3><ul>' +
    '<li>' + T('Monthly minimum: ' + (r.min_stores || 0) + ' stores per employee.', 'الهدف الشهري (الحد الأدنى): ' + (r.min_stores || 0) + ' متجر لكل موظف.') + '</li>' +
    '<li>' + T('Below the minimum, commission is not paid even when the sales target is met, unless management grants a special exception.', 'في حال عدم تحقيق الحد الأدنى من المتاجر، مع تحقيق المستهدف المالي، لا تستحق العمولة إلا باستثناء خاص.') + '</li></ul>';
  html += '<h3>' + T('What counts', 'ما يُحتسب') + '</h3><ol>' +
    '<li>' + T('A deal counts when it is Closed Won in HubSpot and paid in Metabase, in the month of its invoice.', 'تُحتسب الصفقة عندما تكون مغلقة بنجاح في HubSpot ومدفوعة في Metabase، في شهر فاتورتها.') + '</li>' +
    '<li>' + T('The amount that counts is the invoice net, never the HubSpot amount.', 'المبلغ المحتسب هو صافي الفاتورة، وليس مبلغ HubSpot.') + '</li>' +
    ((r.exclusions || []).length ? '<li>' + T('Not counted: ', 'لا يُحتسب: ') + esc(r.exclusions.join(ar ? '، ' : ', ')) + '.</li>' : '') +
    '<li>' + T('Fix data issues by the ' + ordinal(r.cutoff_day || 3) + ' of the next month to count in that payout.', 'أصلح مشكلات البيانات قبل يوم ' + (r.cutoff_day || 3) + ' من الشهر التالي لتُحتسب في صرف ذلك الشهر.') + '</li></ol>';
  return '<div class="terms-body" lang="' + lang + '" dir="' + (ar ? 'rtl' : 'ltr') + '">' + html + '</div>';
}
function ordinal(n) { n = Number(n); var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

VIEWS.rules = {
  title: function () { return L('Commission rules', 'قواعد العمولة'); },
  sub: function () { return ''; },
  controls: {},
  render: function (content) {
    var rules = ST.model.rules, meta = ST.snap.ruleMeta || {}, version = ST.snap.ruleVersion || 1;
    var updated = meta.saved_at ? fmtDate(new Date(meta.saved_at)) : '';
    var statusLine = L('Version ', 'الإصدار ') + version + (updated ? L(' · published ', ' · نُشر ') + updated : '') + (meta.saved_by ? L(' by ', ' بواسطة ') + esc(nameOf(meta.saved_by)) : '');

    if (!isAdmin()) {
      content.innerHTML = '<section class="card terms-card"><div class="card-head"><div><h3>' + L('Commission rules', 'قواعد العمولة') + '</h3>' +
        '<p class="sub">' + L('Last updated ', 'آخر تحديث ') + (updated || '—') + L(' · version ', ' · الإصدار ') + version + '</p></div></div>' +
        rulesDocHtml(rules, isAr() ? 'ar' : 'en') + '</section>';
      return;
    }

    var s = ST.v.rules = ST.v.rules || {};
    var base = JSON.stringify(rules);
    if (!s.draft || s.base !== base) { s.draft = JSON.parse(base); s.base = base; s.mode = 'edit'; s.lang = isAr() ? 'ar' : 'en'; s.confirming = false; s.version = String(version + 1); }
    var d = s.draft;
    function dirty() { return JSON.stringify(d) !== s.base; }

    function num(path, val, w) { return '<input type="number" class="so-rnum" data-path="' + path + '" value="' + esc(val) + '" style="width:' + (w || 110) + 'px" dir="ltr">'; }
    function editorHtml() {
      var ar = s.lang === 'ar', T = function (en, a) { return ar ? a : en; };
      var h = '<div class="terms-body so-redit" lang="' + s.lang + '" dir="' + (ar ? 'rtl' : 'ltr') + '">';
      h += '<h3>' + T('Targets and how commission is worked out', 'المستهدفات وطريقة احتساب العمولة') + '</h3>' +
        '<p><label class="so-rline"><input type="checkbox" data-bool="target_includes_vat"' + (d.target_includes_vat ? ' checked' : '') + '> ' + T('Targets include VAT at', 'المستهدفات شاملة الضريبة بنسبة') + ' ' + num('vat_pct', d.vat_pct, 70) + ' %</label></p>';
      d.plans.forEach(function (p, pi) {
        h += '<h3>' + esc(ar ? (p.name_ar || p.name) : p.name) + '</h3><ul>';
        if (p.probation_targets) {
          p.probation_targets.forEach(function (v, i) {
            h += '<li class="so-rline">' + T('Month ' + (i + 1) + ' after joining:', 'الشهر ' + (i + 1) + ' من الانضمام:') + ' ' + num('plans.' + pi + '.probation_targets.' + i, v) + ' ' + T('SAR', 'ريال') + '</li>';
          });
        } else {
          h += '<li class="so-rline">' + T('Monthly target:', 'الهدف الشهري:') + ' ' + num('plans.' + pi + '.target', p.target, 120) + ' ' + T('SAR', 'ريال') + '</li>';
          p.tiers.forEach(function (t, ti) {
            if (!Number(t.from) && !Number(t.rate)) return;
            h += '<li class="so-rline">' + T('From', 'عند تحقيق') + ' ' + num('plans.' + pi + '.tiers.' + ti + '.from', t.from, 70) + ' % ' + T('of target:', 'من المستهدف:') + ' ' +
              num('plans.' + pi + '.tiers.' + ti + '.rate', t.rate, 70) + ' % ' + T('of net sales', 'من صافي المبيعات') +
              ' <button type="button" class="linklike so-rx" data-deltier="' + pi + '.' + ti + '" title="' + T('Remove', 'حذف') + '">×</button></li>';
          });
          h += '<li class="so-rline"><button type="button" class="link-btn" data-addtier="' + pi + '">+ ' + T('Add a step', 'إضافة شريحة') + '</button></li>';
          if (p.sector_min_stores != null) h += '<li class="so-rline">' + T('Stores from own sector, at least:', 'متاجر من ضمن القطاع، على الأقل:') + ' ' + num('plans.' + pi + '.sector_min_stores', p.sector_min_stores, 70) + '</li>';
        }
        h += '</ul>';
      });
      h += '<h3>' + T('Number of stores', 'عدد المتاجر') + '</h3><ul><li class="so-rline">' + T('Monthly minimum per employee:', 'الحد الأدنى الشهري لكل موظف:') + ' ' + num('min_stores', d.min_stores, 70) + ' ' + T('stores', 'متجر') + '</li></ul>';
      h += '<h3>' + T('What counts', 'ما يُحتسب') + '</h3><ul>' +
        '<li class="so-rline">' + T('Not counted (invoice type):', 'لا يُحتسب (نوع الفاتورة):') + ' ' + SO.ALL_EXCLUSIONS.map(function (x) {
          return '<button type="button" class="ghost-btn' + (d.exclusions.indexOf(x) >= 0 ? ' so-on' : '') + '" data-excl="' + esc(x) + '">' + esc(x) + '</button>';
        }).join(' ') + '</li>' +
        '<li class="so-rline">' + T('Amount difference allowed before it is flagged:', 'فرق المبلغ المسموح قبل التنبيه:') + ' ' + num('tolerance_pct', d.tolerance_pct, 70) + ' %</li>' +
        '<li class="so-rline">' + T('Fix cutoff: day', 'آخر موعد للإصلاح: يوم') + ' ' + num('cutoff_day', d.cutoff_day, 70) + ' ' + T('of the next month', 'من الشهر التالي') + '</li></ul>';
      return h + '</div>';
    }
    function seg(id, items, cur) {
      return '<div class="seg" id="' + id + '">' + items.map(function (x) { return '<button type="button" data-v="' + x[0] + '" class="' + (x[0] === cur ? 'active' : '') + '">' + esc(x[1]) + '</button>'; }).join('') + '</div>';
    }
    function render() {
      var dt = dirty();
      content.innerHTML =
        '<section class="card"><div class="card-head"><div><h3>' + L('Commission rules', 'قواعد العمولة') + '</h3>' +
          '<p class="sub">' + L('Set the numbers of the sales plan. Everyone reads the rules in the language they use the app in, and the commission engine pays exactly these.', 'اضبط أرقام خطة المبيعات. يقرأ الجميع القواعد بلغة استخدامهم للتطبيق، ويصرف محرك العمولة وفقها تمامًا.') + '</p>' +
          '<p class="sub">' + statusLine + '</p></div></div></section>' +
        '<section class="card terms-edit-card" data-unsaved="' + (dt || s.confirming ? '1' : '0') + '"><div class="card-head terms-edit-head">' +
          seg('rl-lang', [['en', 'English'], ['ar', 'العربية']], s.lang) +
          seg('rl-mode', [['edit', L('Edit', 'تعديل')], ['preview', L('Preview', 'معاينة')]], s.mode) + '</div>' +
          (s.mode === 'edit' ? editorHtml() : rulesDocHtml(d, s.lang)) +
          '<p class="f-hint terms-hint">' + L('Both languages are written from the same numbers, so they always agree.', 'اللغتان تُكتبان من نفس الأرقام، فتتطابقان دائمًا.') + '</p></section>' +
        '<div class="set-save"><p class="sub" style="flex:1 1 280px; margin:0">' +
          (s.confirming ? L('Publishing applies the new rules to every open month. Click again to confirm.', 'النشر يطبق القواعد الجديدة على كل الأشهر المفتوحة. اضغط مرة أخرى للتأكيد.') : dt ? L('Unsaved changes.', 'تغييرات غير محفوظة.') : L('No changes since the last publish.', 'لا تغييرات منذ آخر نشر.')) + '</p>' +
          '<div class="terms-ver"><label class="f-label" for="rl-version">' + L('Version', 'الإصدار') + '</label>' +
          '<input type="text" id="rl-version" dir="ltr" value="' + esc(s.version) + '" disabled></div>' +
          '<button type="button" class="btn secondary" id="rl-discard"' + (dt || s.confirming ? '' : ' disabled') + '>' + (s.confirming ? L('Cancel', 'إلغاء') : L('Discard changes', 'تجاهل التغييرات')) + '</button>' +
          '<button type="button" class="btn' + (s.confirming ? ' confirming' : '') + '" id="rl-publish"' + (dt ? '' : ' disabled') + '>' + (s.confirming ? L('Publish version ', 'انشر الإصدار ') + esc(s.version) : L('Publish', 'نشر')) + '</button></div>';
      wire();
    }
    function wire() {
      on(content, '#rl-lang button', 'click', function (b) { s.lang = b.getAttribute('data-v'); render(); });
      on(content, '#rl-mode button', 'click', function (b) { s.mode = b.getAttribute('data-v'); render(); });
      on(content, '[data-path]', 'change', function (inp) {
        var p = inp.getAttribute('data-path').split('.'), o = d;
        for (var i = 0; i < p.length - 1; i++) o = o[p[i]];
        o[p[p.length - 1]] = Number(inp.value) || 0;
        s.confirming = false; render();
      });
      on(content, '[data-bool]', 'change', function (c) { d[c.getAttribute('data-bool')] = c.checked; s.confirming = false; render(); });
      on(content, '[data-excl]', 'click', function (b) { var x = b.getAttribute('data-excl'), i = d.exclusions.indexOf(x); if (i >= 0) d.exclusions.splice(i, 1); else d.exclusions.push(x); s.confirming = false; render(); });
      on(content, '[data-addtier]', 'click', function (b) {
        var tiers = d.plans[Number(b.getAttribute('data-addtier'))].tiers, last = tiers[tiers.length - 1] || { from: 0, rate: 0 };
        tiers.push({ from: Math.min(200, Number(last.from) + 30), rate: Number(last.rate) + 2 }); s.confirming = false; render();
      });
      on(content, '[data-deltier]', 'click', function (b) { var p = b.getAttribute('data-deltier').split('.'); d.plans[Number(p[0])].tiers.splice(Number(p[1]), 1); s.confirming = false; render(); });
      content.querySelector('#rl-discard').addEventListener('click', function () {
        if (s.confirming) { s.confirming = false; return render(); }
        s.draft = null; VIEWS.rules.render(content);
      });
      content.querySelector('#rl-publish').addEventListener('click', function () {
        if (!dirty()) return;
        if (!s.confirming) { s.confirming = true; return render(); }
        d.plans.forEach(function (p) { if (p.tiers) p.tiers.sort(function (a, b) { return a.from - b.from; }); });
        var v = version + 1;
        SO_API.W.saveRules(d, v).then(function () {
          SO_API.W.audit('rules', 'Published commission rules, version ' + v);
          s.draft = null; toast(L('Rules published · version ', 'نُشرت القواعد · الإصدار ') + v); reload();
        }, failToast);
      });
    }
    render();
  }
};
