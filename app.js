/* ============================================================
   Sales Ops Portal: shell, sign-in and routing
   Sign-in is Google only. The database allowlist (app_users) decides
   who gets in; anyone else sees "No access" and is listed for
   management under Access > Requests.
   ============================================================ */

(function () {
  'use strict';
  var app = document.getElementById('app');
  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem('so.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('so.' + k, JSON.stringify(v)); } catch (e) {} }
  };

  /* ---------------- routes ----------------
     who: roles that may open the page. Section order builds the nav. */
  var ROUTES = {
    '/overview':     { view: 'overview',     icon: 'dash',   sec: 'main',  who: ['rep', 'manager', 'admin'] },
    '/deals':        { view: 'deals',        icon: 'deals',  sec: 'main',  who: ['rep', 'manager', 'finance', 'admin'] },
    '/issues':       { view: 'issues',       icon: 'alert',  sec: 'main',  who: ['rep', 'manager', 'admin'], badge: 'issues' },
    '/queue':        { view: 'queue',        icon: 'queue',  sec: 'main',  who: ['manager', 'admin'] },
    '/team':         { view: 'team',         icon: 'team',   sec: 'perf',  who: ['manager', 'admin'] },
    '/leaderboard':  { view: 'leaderboard',  icon: 'trophy', sec: 'perf',  who: ['rep', 'manager', 'admin'] },
    '/analytics':    { view: 'analytics',    icon: 'chart',  sec: 'perf',  who: ['rep', 'manager', 'admin'] },
    '/sectors':      { view: 'sectors',      icon: 'pie',    sec: 'perf',  who: ['manager', 'admin'] },
    '/calc':         { view: 'calc',         icon: 'calc',   sec: 'perf',  who: ['rep', 'manager', 'admin'] },
    '/stores':       { view: 'stores',       icon: 'store',  sec: 'perf',  who: ['rep', 'manager', 'finance', 'admin'] },
    '/recon':        { view: 'recon',        icon: 'scale',  sec: 'money', who: ['manager', 'finance', 'admin'] },
    '/payouts':      { view: 'payouts',      icon: 'money',  sec: 'money', who: ['manager', 'finance', 'admin'] },
    '/grants':       { view: 'grants',       icon: 'key',    sec: 'money', who: ['manager', 'admin'] },
    '/targets':      { view: 'targets',      icon: 'target', sec: 'money', who: ['manager', 'admin'] },
    '/rules':        { view: 'rules',        icon: 'gear',   sec: 'admin', who: ['admin'] },
    '/integrations': { view: 'integrations', icon: 'plug',   sec: 'admin', who: ['admin'] },
    '/access':       { view: 'access',       icon: 'users',  sec: 'admin', who: ['manager', 'admin'], badge: 'requests' }
  };
  var SECTIONS = [
    { key: 'main', label: null },
    { key: 'perf', label: ['Performance', 'الأداء'] },
    { key: 'money', label: ['Money', 'المال'] },
    { key: 'admin', label: ['Settings', 'الإعدادات'] }
  ];
  function homeOf(r) { return r === 'finance' ? '/payouts' : '/overview'; }
  function allowed(path) { var r = ROUTES[path]; return !!r && r.who.indexOf(role()) >= 0; }
  function badgeOf(kind) {
    if (kind === 'issues') { var n = 0; ST.model.rows.forEach(function (r) { if (r.month === ST.month && inScope(r)) n += r.issues.filter(function (i) { return i.status === 'open'; }).length; }); return n; }
    if (kind === 'requests') return (ST.snap.attempts || []).filter(function (a) { return a.status === 'pending'; }).length;
    return 0;
  }

  /* ---------------- data ---------------- */
  function setSnap(snap) {
    ST.snap = snap;
    ST.model = SO.buildModel(snap);
    ST.lastLoad = new Date();
  }
  window.reload = function () {
    if (!SO_API.live()) { setSnap(SO_API.mockSnap()); route(); return Promise.resolve(); }
    return SO_API.loadSnapshot().then(function (s) { setSnap(s); route(); }, function (e) { console.error(e); toast(L('Could not refresh the data.', 'تعذر تحديث البيانات.')); });
  };

  /* ---------------- sign-in screens ---------------- */
  function loginFrame(inner) {
    app.innerHTML =
      '<div class="login-wrap">' +
        '<div class="login-left"><div class="login-card">' +
          '<div class="brand so-login-brand">' + ZID_MARK + '<div><b>' + L('Sales Ops Portal', 'بوابة عمليات المبيعات') + '</b><small>' + L('Zid sales team', 'فريق مبيعات زد') + '</small></div></div>' +
          inner +
        '</div>' +
        '<div class="login-tools"><button class="icon-btn lang-btn" id="login-lang" aria-label="' + L('Language', 'اللغة') + '">' + (isAr() ? 'EN' : 'ع') + '</button></div></div>' +
        '<div class="login-hero">' + heroRings() +
          '<h2>' + L('Every deal, every invoice, one number to trust.', 'كل صفقة وكل فاتورة، ورقم واحد تثق به.') + '</h2>' +
          '<p>' + L('Sales Ops lines HubSpot up with Metabase, so employees see exactly what counts, managers see the team, and finance pays on the invoice.', 'تطابق عمليات المبيعات بين HubSpot وMetabase، ليرى الموظف ما يُحتسب، والمدير فريقه، وتصرف المالية على الفاتورة.') + '</p>' +
          '<div class="hero-zid">' + L('by', 'من') + ' ' + ZID_LOGO + '</div>' +
        '</div>' +
      '</div>';
    document.getElementById('login-lang').addEventListener('click', function () { setLang(isAr() ? 'en' : 'ar'); boot(); });
  }
  function heroRings() {
    return '<svg class="hero-rings" viewBox="0 0 580 580" fill="none" aria-hidden="true">' +
      [250, 205, 160, 115, 70].map(function (r, i) { return '<circle cx="290" cy="290" r="' + r + '" stroke="rgba(174,114,255,' + (0.16 + i * 0.1) + ')" stroke-width="2"/>'; }).join('') +
      '<g transform="translate(250 250) scale(1.25)"><path fill="none" stroke="#ae72ff" stroke-width="5.5" stroke-linejoin="round" d="M 20 36 L 36 20 C 39.5 13.5, 37.5 7.5, 32 7.5 C 26.5 7.5, 24.5 13.5, 28 20 L 44 36 C 50.5 39.5, 56.5 37.5, 56.5 32 C 56.5 26.5, 50.5 24.5, 44 28 L 28 44 C 24.5 50.5, 26.5 56.5, 32 56.5 C 37.5 56.5, 39.5 50.5, 36 44 L 20 28 C 13.5 24.5, 7.5 26.5, 7.5 32 C 7.5 37.5, 13.5 39.5, 20 36 Z"/></g></svg>';
  }
  function renderSignIn() {
    var live = SO_API.live();
    var demo = live ? '' :
      '<div class="card" style="margin-top:14px"><h2>' + L('Demo: pick a person', 'تجربة: اختر شخصًا') + '</h2><p class="sub">' + L('Generated data. Live sign-in starts once config.js names the Supabase project.', 'بيانات مولدة. يبدأ الدخول الفعلي بعد ضبط config.js.') + '</p>' +
        '<div class="persona-list">' + SO_MOCK.USERS.filter(function (u, i) { return u.role !== 'rep' || i === 0 || i === 3; }).concat([{ email: 'someone.else@zid.sa', name: L('Someone not on the list', 'شخص خارج القائمة'), role: 'none' }]).map(function (u) {
          return '<button class="persona" data-demo="' + esc(u.email) + '"><span class="avatar">' + esc(initials(u.name)) + '</span><span class="who"><b>' + esc(u.name) + '</b><span>' + esc(u.role === 'none' ? L('Shows the no-access screen', 'تظهر شاشة عدم الوصول') : roleLabel(u.role)) + '</span></span><span class="go">→</span></button>';
        }).join('') + '</div></div>';
    loginFrame(
      '<div class="card"><h2>' + L('Sign in', 'تسجيل الدخول') + '</h2><p class="sub">' + L('Use your Zid Google account.', 'استخدم حساب Google الخاص بزد.') + '</p>' +
        (window.SO_AUTH_ERROR ? '<p class="f-error" style="margin-top:8px">' + L('Google sign-in did not finish. Try again.', 'لم يكتمل الدخول عبر Google. حاول مرة أخرى.') + '</p>' : '') +
        '<button class="btn so-google" id="google"' + (live ? '' : ' disabled') + '>' + GOOGLE_G + L('Continue with Google', 'المتابعة عبر Google') + '</button>' +
        '<p class="login-note">' + L('Only people on the Sales Ops access list can sign in.', 'لا يدخل إلا من في قائمة الوصول.') + '</p></div>' + demo);
    if (live) document.getElementById('google').addEventListener('click', SO_API.signInWithGoogle);
    app.querySelectorAll('[data-demo]').forEach(function (b) {
      b.addEventListener('click', function () { LS.set('demoUser', b.getAttribute('data-demo')); boot(); });
    });
  }
  function renderNoAccess(g) {
    var denied = g.state === 'denied', disabled = g.state === 'disabled';
    loginFrame('<div class="card so-gate"><span class="so-gate-ic">' + ICON.lock + '</span>' +
      '<h2>' + (disabled ? L('Your access was removed', 'سُحب وصولك') : L('No access', 'لا يوجد وصول')) + '</h2>' +
      '<p class="sub">' + (denied && g.reason ? esc(g.reason) + ' ' : '') +
        L('Your account <b dir="ltr">' + esc(g.email) + '</b> is not on the Sales Ops access list. Contact the sales management for access.',
          'حسابك <b dir="ltr">' + esc(g.email) + '</b> ليس في قائمة الوصول. تواصل مع إدارة المبيعات للحصول على الوصول.') + '</p>' +
      '<div class="so-row" style="margin-top:14px"><button class="btn" id="other">' + L('Use another account', 'استخدم حسابًا آخر') + '</button></div></div>');
    document.getElementById('other').addEventListener('click', function () {
      SO_API.signOut(); LS.set('demoUser', null);
      if (SO_API.live()) SO_API.signInWithGoogle(); else boot();
    });
  }

  /* ---------------- shell ---------------- */
  function route() {
    if (!ST.snap) return;
    var h = location.hash.replace(/^#/, '') || '';
    if (!allowed(h)) { location.replace('#' + homeOf(role())); h = homeOf(role()); }
    renderShell(h);
  }
  function previewOptions() {
    var r = realUser(), out = [{ v: '', label: L('Myself', 'أنا') + ' · ' + roleLabel(r.role) }];
    ST.model.users.filter(function (u) { return u.active !== false && lcEmail(u.email) !== lcEmail(r.email); })
      .filter(function (u) { return r.role === 'admin' || u.role === 'rep' || u.role === 'finance'; })
      .forEach(function (u) { out.push({ v: lcEmail(u.email), label: u.name + ' · ' + roleLabel(u.role) }); });
    return out;
  }
  function renderShell(path) {
    var r = ROUTES[path], view = VIEWS[r.view], u = me(), real = realUser();
    var collapsed = LS.get('navCollapsed', false);
    var nav = SECTIONS.map(function (sec, si) {
      var items = Object.keys(ROUTES).filter(function (p) { return ROUTES[p].sec === sec.key && allowed(p); });
      if (!items.length) return '';
      return (si > 0 ? '<div class="nav-divider"></div>' : '') + (sec.label ? '<p class="nav-sec">' + L(sec.label[0], sec.label[1]) + '</p>' : '') +
        items.map(function (p) {
          var b = ROUTES[p].badge ? badgeOf(ROUTES[p].badge) : 0, title = VIEWS[ROUTES[p].view].title();
          return '<a href="#' + p + '" class="' + (p === path ? 'active' : '') + '" title="' + esc(title) + '">' + ICON[ROUTES[p].icon] + '<span class="nav-label">' + esc(title) + '</span>' + (b ? '<span class="nav-badge">' + b + '</span>' : '') + '</a>';
        }).join('');
    }).join('');
    var c = view.controls || {};
    var months = SO.monthsBack(SO.monthKey(new Date()), 13).reverse();
    var ctrl = '';
    if (c.reps && !isRep()) {
      var sel = ST.repSel && ST.repSel.length ? ST.repSel : null;
      ctrl += '<div class="so-ms"><button class="drp-trigger" id="ms-btn" aria-expanded="false">' + ICON.team + '<span>' + (sel ? (sel.length === 1 ? esc(nameOf(sel[0])) : sel.length + L(' employees', ' موظفين')) : L('All employees', 'كل الموظفين')) + '</span></button></div>';
    }
    if (c.month) ctrl += '<select class="so-month" id="month-sel" aria-label="' + L('Month', 'الشهر') + '">' + months.map(function (m) { return '<option value="' + m + '"' + (m === ST.month ? ' selected' : '') + '>' + esc(monthName(m)) + '</option>'; }).join('') + '</select>';

    app.innerHTML =
      '<div class="shell' + (collapsed ? ' nav-collapsed' : '') + '">' +
        '<aside class="sidebar">' +
          '<div class="brand">' + ZID_MARK + '<div class="brand-txt"><b>' + L('Sales Ops', 'عمليات المبيعات') + '</b><small>' + L('by Zid', 'من زد') + '</small></div>' +
            '<button class="nav-toggle" id="nav-toggle" aria-label="' + L('Collapse menu', 'طي القائمة') + '">' + ICON.chevronLeft + '</button>' +
            '<button class="mobile-menu-btn" id="mobile-menu" aria-label="' + L('Menu', 'القائمة') + '" aria-expanded="false">' + ICON.menu + '</button></div>' +
          '<nav class="nav">' + nav + '</nav>' +
          '<div class="side-foot">' +
            (canPreview() ? '<label class="so-preview"><span>' + L('Preview as', 'عرض بصفة') + '</span><select id="preview">' + previewOptions().map(function (o) { return '<option value="' + esc(o.v) + '"' + (o.v === (ST.previewEmail || '') ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join('') + '</select></label>' : '') +
            '<div class="userchip"><span class="avatar">' + esc(initials(u.name)) + '</span><span class="who"><b>' + esc(u.name) + '</b><span>' + esc(roleLabel(u.role)) + '</span></span></div>' +
            '<button class="link-btn" id="logout">' + L('Sign out', 'تسجيل الخروج') + '</button></div>' +
        '</aside>' +
        '<div class="main">' +
          (ST.previewEmail ? '<div class="viewas-bar" role="status"><span class="va-txt">' + L('Previewing as ', 'تعرض بصفة ') + esc(u.name) + '</span><span class="va-note">' + L('You see what they see. Changes are made as you.', 'ترى ما يراه، والتغييرات باسمك.') + '</span><button class="va-exit" id="exit-preview">' + L('Exit preview', 'إنهاء العرض') + '</button></div>' : '') +
          '<div class="topbar"><div class="crumbs"><h1>' + esc(view.title()) + '</h1>' + (SO_API.live() ? '' : '<span class="demo-pill">' + L('Demo data', 'بيانات تجريبية') + '</span>') + '</div>' +
            '<div class="actions">' + (SO_API.live() ? '<span class="freshness">' + L('Updated ', 'حُدّث ') + agoText(ST.lastLoad) + '</span>' : '') +
              '<button class="icon-btn" id="refresh" title="' + L('Refresh data', 'تحديث البيانات') + '" aria-label="' + L('Refresh data', 'تحديث البيانات') + '">' + ICON.refresh + '</button>' +
              '<button class="icon-btn lang-btn" id="lang" aria-label="' + L('Language', 'اللغة') + '">' + (isAr() ? 'EN' : 'ع') + '</button>' +
              '<button class="icon-btn" id="theme" title="' + L('Theme', 'المظهر') + '" aria-label="' + L('Theme', 'المظهر') + '">' + ICON.sun + '</button></div></div>' +
          '<div class="content"><div class="so-pagehead"' + (view.sub() || ctrl ? '' : ' hidden') + '><p class="sub">' + esc(view.sub()) + '</p><div class="so-controls">' + ctrl + '</div></div><div id="view"></div></div>' +
        '</div></div>';

    var v = document.getElementById('view');
    try { view.render(v); } catch (e) { console.error(e); v.innerHTML = emptyBox('alert', L('This page hit an error', 'حدث خطأ في الصفحة'), esc(e.message)); }
    initTooltip(v); wireCardToggles(v);
    wireShell();
  }
  function wireShell() {
    var $ = function (id) { return document.getElementById(id); };
    $('logout').addEventListener('click', function () { SO_API.signOut(); LS.set('demoUser', null); ST.snap = null; ST.previewEmail = null; location.hash = ''; boot(); });
    $('refresh').addEventListener('click', function () { var b = $('refresh'); b.classList.add('spinning'); reload(); });
    $('lang').addEventListener('click', function () { setLang(isAr() ? 'en' : 'ar'); route(); });
    $('theme').addEventListener('click', function () {
      var cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', cur); LS.set('theme', cur);
    });
    $('nav-toggle').addEventListener('click', function () { var s = app.querySelector('.shell'), n = !s.classList.contains('nav-collapsed'); s.classList.toggle('nav-collapsed', n); LS.set('navCollapsed', n); });
    $('mobile-menu').addEventListener('click', function () { var s = app.querySelector('.shell'), o = !s.classList.contains('nav-open'); s.classList.toggle('nav-open', o); this.setAttribute('aria-expanded', String(o)); });
    var ms = $('month-sel'); if (ms) ms.addEventListener('change', function () { ST.month = ms.value; route(); });
    var pv = $('preview'); if (pv) pv.addEventListener('change', function () { ST.previewEmail = pv.value || null; ST.repSel = null; ST.v = {}; route(); });
    var ex = $('exit-preview'); if (ex) ex.addEventListener('click', function () { ST.previewEmail = null; ST.v = {}; route(); });
    var mb = $('ms-btn'); if (mb) mb.addEventListener('click', openRepPicker);
  }
  // Multi-select rep picker for management views.
  function openRepPicker() {
    var picked = {}; (ST.repSel || []).forEach(function (e) { picked[e] = true; });
    var reps = activeReps();
    dialog({ title: L('Employees', 'الموظفون'), sub: L('Pick one or more. None picked means the whole team.', 'اختر واحدًا أو أكثر. بدون اختيار يعني الفريق كله.'),
      body: '<input type="search" id="ms-q" placeholder="' + L('Search employees', 'ابحث عن موظف') + '" style="width:100%;margin-bottom:8px"><div class="so-msl">' + reps.map(function (u) {
        var e = lcEmail(u.email);
        return '<label class="so-msi" data-name="' + esc(u.name.toLowerCase()) + '"><input type="checkbox" value="' + esc(e) + '"' + (picked[e] ? ' checked' : '') + '><span><b>' + esc(u.name) + '</b><span class="cell-sub">' + esc(SO.planOf(ST.model.rules, u.plan).name) + '</span></span></label>';
      }).join('') + '</div><div class="so-row" style="margin-top:8px"><button class="ghost-btn" id="ms-none">' + L('Reset', 'إعادة') + '</button></div>',
      confirm: L('Apply', 'تطبيق'),
      wire: function (d) {
        var q = d.querySelector('#ms-q');
        q.addEventListener('input', function () { d.querySelectorAll('.so-msi').forEach(function (l) { l.hidden = l.getAttribute('data-name').indexOf(q.value.toLowerCase()) < 0; }); });
        d.querySelector('#ms-none').addEventListener('click', function () { d.querySelectorAll('.so-msi input').forEach(function (c) { c.checked = false; }); });
      },
      onConfirm: function (d) {
        var sel = []; d.querySelectorAll('.so-msi input:checked').forEach(function (c) { sel.push(c.value); });
        ST.repSel = sel.length ? sel : null; setTimeout(route, 0);
      } });
  }

  /* ---------------- boot ---------------- */
  function loading() { app.innerHTML = '<div class="so-loading"><span class="so-spin"></span>' + L('Loading…', 'جارٍ التحميل…') + '</div>'; }
  function boot() {
    var th = LS.get('theme', null); if (th) document.documentElement.setAttribute('data-theme', th);
    if (!SO_API.live()) {
      var email = LS.get('demoUser', null);
      if (!email) return renderSignIn();
      var snap = SO_API.mockSnap();
      var u = snap.users.filter(function (x) { return x.email === email && x.active !== false; })[0];
      if (!u) {
        var a = snap.attempts.filter(function (x) { return x.email === email; })[0];
        if (!a) snap.attempts.unshift({ email: email, name: '', first_at: new Date().toISOString(), last_at: new Date().toISOString(), attempts: 1, status: 'pending' });
        return renderNoAccess({ state: 'no_access', email: email });
      }
      SO_API.setMockActor(email);
      ST.realEmail = email; setSnap(snap); route(); return;
    }
    loading();
    SO_API.gate().then(function (g) {
      if (g.state === 'out') return renderSignIn();
      if (g.state === 'error') { loginFrame('<div class="card"><h2>' + L('Could not reach the server', 'تعذر الوصول للخادم') + '</h2><p class="sub">' + esc(g.error) + '</p><button class="btn" id="retry" style="margin-top:12px">' + L('Try again', 'حاول مرة أخرى') + '</button></div>'); document.getElementById('retry').addEventListener('click', boot); return; }
      if (g.state !== 'member') return renderNoAccess(g);
      ST.realEmail = g.email;
      return SO_API.loadSnapshot().then(function (s) { setSnap(s); route(); });
    }).catch(function (e) { console.error(e); renderSignIn(); });
  }
  window.addEventListener('hashchange', function () { closeDrawer(); closeDialog(); route(); });
  // Live data refreshes every five minutes, unless a dialog is open.
  setInterval(function () { if (SO_API.live() && ST.snap && !document.getElementById('so-dlg') && !document.hidden) reload(); }, 5 * 60 * 1000);
  boot();
})();
