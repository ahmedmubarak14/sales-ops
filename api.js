/* ============================================================
   Sales Ops Portal: data adapter
   Live: Supabase Auth (Google only), PostgREST and RPCs with plain
   fetch. Row-level security decides what each person sees; the
   allowlist is app_users (docs/DATA_CONTRACT.md).
   Demo: the same calls against the in-memory SO_MOCK snapshot.
   Session handling follows Sales Hunter's api.js.
   ============================================================ */

window.SO_API = (function () {
  'use strict';

  var cfg = window.SO_CONFIG || {};
  var SESSION_KEY = 'so.live.session';
  var STARTED_KEY = 'so.live.signinStarted';

  function live() {
    if (!cfg.url || !cfg.key) return false;
    if (/[?&]mode=mock/.test(location.search)) return false;
    return true;
  }

  /* ---------------- session ---------------- */
  function getSession() { try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || null; } catch (e) { return null; } }
  function setSession(s) {
    try { if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s)); else localStorage.removeItem(SESSION_KEY); } catch (e) {}
  }
  // Tokens are only taken from the address when this browser started the
  // sign-in (within the hour), so a link carrying someone else's tokens
  // can't silently sign the reader in as them.
  function markStarted() { try { localStorage.setItem(STARTED_KEY, String(Date.now())); } catch (e) {} }
  function takeStarted() {
    var at = 0;
    try { at = Number(localStorage.getItem(STARTED_KEY)) || 0; localStorage.removeItem(STARTED_KEY); } catch (e) {}
    return at > 0 && Date.now() - at < 3600 * 1000;
  }
  function captureHash() {
    var h = location.hash;
    if (/error_code=|[#&]error=/.test(h)) {
      var m = h.match(/error_description=([^&]+)/);
      window.SO_AUTH_ERROR = m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : 'auth_error';
      history.replaceState(null, '', location.pathname + location.search);
      return;
    }
    if (h.indexOf('access_token=') < 0) return;
    var p = {};
    h.replace(/^#/, '').split('&').forEach(function (kv) { var a = kv.split('='); p[a[0]] = decodeURIComponent(a[1] || ''); });
    history.replaceState(null, '', location.pathname + location.search);
    if (!p.access_token || !p.refresh_token || !takeStarted()) return;
    var payload = {};
    try { payload = JSON.parse(atob(p.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch (e) {}
    var meta = payload.user_metadata || {};
    setSession({
      access_token: p.access_token, refresh_token: p.refresh_token,
      email: String(payload.email || '').toLowerCase(),
      name: meta.full_name || meta.name || '', avatar: meta.avatar_url || meta.picture || '',
      expires_at: payload.exp ? payload.exp * 1000 : Date.now() + 3600 * 1000
    });
  }

  /* ---------------- HTTP ---------------- */
  function headers(extra) {
    var s = getSession();
    return Object.assign({ apikey: cfg.key, 'Content-Type': 'application/json', Authorization: 'Bearer ' + (s ? s.access_token : cfg.key) }, extra || {});
  }
  async function refresh() {
    var s = getSession();
    if (!s || !s.refresh_token) return false;
    var res = await fetch(cfg.url + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST', headers: { apikey: cfg.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: s.refresh_token })
    });
    if (!res.ok) { setSession(null); return false; }
    var j = await res.json();
    setSession(Object.assign({}, s, { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in || 3600) * 1000 }));
    return true;
  }
  async function req(path, opts, retried) {
    opts = opts || {};
    var s = getSession();
    if (s && s.expires_at && s.expires_at - Date.now() < 60000 && !retried) await refresh();
    var res = await fetch(cfg.url + path, {
      method: opts.method || 'GET', headers: headers(opts.headers),
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    });
    if (res.status === 401 && !retried && getSession() && await refresh()) return req(path, opts, true);
    if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + (await res.text()).slice(0, 300));
    if (res.status === 204) return null;
    var ct = res.headers.get('content-type') || '';
    if (opts.withTotal) {
      var mm = /\/(\d+)$/.exec(res.headers.get('content-range') || '');
      return { rows: await res.json(), total: mm ? Number(mm[1]) : null };
    }
    return ct.indexOf('json') >= 0 ? res.json() : res.text();
  }
  // PostgREST stops every response at max-rows (1000), so whole tables are
  // read in pages behind a unique order, until a short page proves the end.
  var PAGE = 1000;
  async function reqAll(path, order) {
    var base = path + (path.indexOf('?') >= 0 ? '&' : '?') + 'order=' + order + '&limit=' + PAGE + '&offset=';
    var first = await req(base + 0, { headers: { Prefer: 'count=exact' }, withTotal: true });
    var out = first.rows, last = first.rows, off = PAGE;
    if (last.length === PAGE && first.total) {
      var offs = [];
      for (var o = PAGE; o < first.total; o += PAGE) offs.push(o);
      var pages = await Promise.all(offs.map(function (x) { return req(base + x); }));
      pages.forEach(function (p) { out = out.concat(p); last = p; });
      off += offs.length * PAGE;
    }
    while (last.length === PAGE) { last = await req(base + off); out = out.concat(last); off += PAGE; }
    return out;
  }
  function rpc(name, body) { return req('/rest/v1/rpc/' + name, { method: 'POST', body: body || {} }); }
  function soft(p, dflt) { return p.catch(function () { return dflt; }); }

  /* ---------------- auth ---------------- */
  function signInWithGoogle() {
    markStarted();
    var back = location.origin + location.pathname;
    // hd= asks Google to show Zid Workspace accounts first; the allowlist
    // in the database is what actually decides access.
    location.href = cfg.url + '/auth/v1/authorize?provider=google&redirect_to=' + encodeURIComponent(back) +
      '&query_params=' + encodeURIComponent('hd=zid.sa&prompt=select_account');
  }
  function signOut() {
    var s = getSession();
    setSession(null);
    if (s && s.access_token && live()) {
      fetch(cfg.url + '/auth/v1/logout', { method: 'POST', headers: { apikey: cfg.key, Authorization: 'Bearer ' + s.access_token } }).catch(function () {});
    }
  }

  /* Who is this? 'out' (no session), 'no_access' / 'denied' / 'disabled'
     (signed in with Google but not allowed), or 'member'. */
  async function gate() {
    captureHash();
    var s = getSession();
    if (!s) return { state: 'out' };
    try {
      var st = await rpc('log_access_attempt', { p_name: s.name || '', p_avatar: s.avatar || '' });
      var v = typeof st === 'string' ? st : (st && st.status) || st;
      if (v === 'member') return { state: 'member', email: s.email, avatar: s.avatar };
      return { state: String(v || 'no_access').split(':')[0], reason: String(v || '').split(':').slice(1).join(':'), email: s.email };
    } catch (e) {
      if (/HTTP 401/.test(e.message)) { setSession(null); return { state: 'out' }; }
      return { state: 'error', email: s.email, error: e.message };
    }
  }

  /* ---------------- reads ---------------- */
  async function loadSnapshot() {
    var me = await rpc('current_member');
    me = Array.isArray(me) ? me[0] : me;
    var admin = me && (me.role === 'admin');
    var mgr = me && (me.role === 'manager' || admin);
    var r = await Promise.all([
      reqAll('/rest/v1/app_users?select=*', 'email.asc'),
      reqAll('/rest/v1/deals?select=*', 'hubspot_deal_id.asc'),
      reqAll('/rest/v1/invoices?select=*', 'item_id.asc'),
      reqAll('/rest/v1/targets?select=*', 'id.asc'),
      req('/rest/v1/rule_versions?select=*&order=version.desc&limit=1'),
      soft(reqAll('/rest/v1/issue_states?select=*', 'hubspot_deal_id.asc,kind.asc'), []),
      soft(reqAll('/rest/v1/issue_comments?select=*', 'id.asc'), []),
      soft(reqAll('/rest/v1/payouts?select=*', 'id.asc'), []),
      soft(reqAll('/rest/v1/finance_grants?select=*', 'id.asc'), []),
      mgr ? soft(req('/rest/v1/audit_log?select=*&order=at.desc&limit=200'), []) : Promise.resolve([]),
      mgr ? soft(reqAll('/rest/v1/access_attempts?select=*', 'email.asc'), []) : Promise.resolve([]),
      admin ? soft(req('/rest/v1/integration_config?select=*'), []) : Promise.resolve([]),
      mgr ? soft(req('/rest/v1/sync_runs?select=*&order=at.desc&limit=30'), []) : Promise.resolve([]),
      soft(reqAll('/rest/v1/store_showcase_lite?select=*', 'store_id.asc'), []),
      soft(req('/rest/v1/settings?select=*'), [])
    ]);
    var settings = {};
    (r[14] || []).forEach(function (x) { settings[x.key] = x.value; });
    var rv = (r[4] || [])[0];
    var snap = {
      me: me, users: r[0], deals: r[1], invoices: r[2], targets: r[3],
      rules: rv ? rv.config : null, ruleVersion: rv ? rv.version : 1,
      issueStates: r[5], comments: r[6], payouts: r[7], grants: r[8], audit: r[9],
      attempts: r[10], integrations: r[11], runs: r[12], showcase: r[13], settings: settings
    };
    // A rep can only read their own deals, so the leaderboard comes from
    // an RPC that returns totals for everyone.
    if (me && me.role === 'rep') snap.leaderboard = await soft(rpc('leaderboard', { p_month: SO.monthKey(new Date()) }), []);
    return snap;
  }

  /* ---------------- writes ----------------
     Each returns a promise. In demo mode they change the in-memory
     snapshot so the UI behaves exactly as it will live. */
  var MOCK = null;
  function mockSnap() { if (!MOCK) MOCK = SO_MOCK.snapshot(); return MOCK; }
  function now() { return new Date().toISOString(); }
  var mockActor = '';
  function mockAudit(action, detail) { mockSnap().audit.unshift({ at: now(), actor_email: mockActor, action: action, detail: detail }); }

  var W = {
    audit: function (action, detail) {
      if (!live()) { mockAudit(action, detail); return Promise.resolve(); }
      return rpc('audit', { p_action: action, p_detail: detail }).catch(function () {});
    },
    setIssue: function (dealId, kind, patch) {
      var row = Object.assign({ hubspot_deal_id: dealId, kind: kind, updated_at: now(), updated_by: mockActor }, patch);
      if (!live()) {
        var list = mockSnap().issueStates, ex = list.filter(function (s) { return s.hubspot_deal_id === dealId && s.kind === kind; })[0];
        if (ex) Object.assign(ex, row); else list.push(Object.assign({ status: 'open' }, row));
        return Promise.resolve();
      }
      delete row.updated_by;
      return req('/rest/v1/issue_states?on_conflict=hubspot_deal_id,kind', { method: 'POST', body: row, headers: { Prefer: 'resolution=merge-duplicates' } });
    },
    addComment: function (dealId, kind, body) {
      var row = { hubspot_deal_id: dealId, kind: kind, body: body, author_email: mockActor, created_at: now() };
      if (!live()) { mockSnap().comments.push(row); return Promise.resolve(); }
      delete row.author_email; delete row.created_at;
      return req('/rest/v1/issue_comments', { method: 'POST', body: row });
    },
    saveTargets: function (rows) {
      if (!live()) {
        rows.forEach(function (r) {
          var list = mockSnap().targets, ex = list.filter(function (t) { return t.rep_email === r.rep_email && t.month === r.month; })[0];
          if (ex) Object.assign(ex, r); else list.push(r);
        });
        return Promise.resolve();
      }
      return req('/rest/v1/targets?on_conflict=rep_email,month', { method: 'POST', body: rows, headers: { Prefer: 'resolution=merge-duplicates' } });
    },
    saveRules: function (config, version) {
      if (!live()) { var s = mockSnap(); s.rules = config; s.ruleVersion = version; return Promise.resolve(); }
      return req('/rest/v1/rule_versions', { method: 'POST', body: { version: version, config: config } });
    },
    markPaid: function (rows) {
      if (!live()) { rows.forEach(function (r, i) { mockSnap().payouts.push(Object.assign({ id: Date.now() + i, paid_by: mockActor }, r)); }); return Promise.resolve(); }
      return req('/rest/v1/payouts', { method: 'POST', body: rows });
    },
    reversePaid: function (id) {
      if (!live()) { mockSnap().payouts.forEach(function (p) { if (p.id === id) p.reversed_at = now(); }); return Promise.resolve(); }
      return req('/rest/v1/payouts?id=eq.' + encodeURIComponent(id), { method: 'PATCH', body: { reversed_at: now() } });
    },
    createGrant: function (g) {
      if (!live()) {
        var s = mockSnap();
        s.grants.forEach(function (x) { if (x.grantee_email === g.grantee_email && x.month === g.month) x.active = false; });
        s.grants.unshift(Object.assign({ id: Date.now(), active: true, created_by: mockActor, created_at: now() }, g));
        return Promise.resolve();
      }
      return req('/rest/v1/finance_grants', { method: 'POST', body: Object.assign({ active: true }, g) });
    },
    endGrant: function (id) {
      if (!live()) { mockSnap().grants.forEach(function (g) { if (g.id === id) g.active = false; }); return Promise.resolve(); }
      return req('/rest/v1/finance_grants?id=eq.' + encodeURIComponent(id), { method: 'PATCH', body: { active: false } });
    },
    addUser: function (u) {
      u = Object.assign({ active: true }, u, { email: SO.lc(u.email) });
      if (!live()) {
        var s = mockSnap();
        var ex = s.users.filter(function (x) { return x.email === u.email; })[0];
        if (ex) Object.assign(ex, u); else s.users.push(Object.assign({ id: 'u' + Date.now() }, u));
        s.attempts.forEach(function (a) { if (a.email === u.email) a.status = 'approved'; });
        return Promise.resolve();
      }
      return req('/rest/v1/app_users?on_conflict=email', { method: 'POST', body: u, headers: { Prefer: 'resolution=merge-duplicates' } })
        .then(function () { return req('/rest/v1/access_attempts?email=eq.' + encodeURIComponent(u.email), { method: 'PATCH', body: { status: 'approved' } }).catch(function () {}); });
    },
    updateUser: function (email, patch) {
      if (!live()) { mockSnap().users.forEach(function (u) { if (u.email === email) Object.assign(u, patch); }); return Promise.resolve(); }
      return req('/rest/v1/app_users?email=eq.' + encodeURIComponent(email), { method: 'PATCH', body: patch });
    },
    denyAttempt: function (email, reason) {
      if (!live()) { mockSnap().attempts.forEach(function (a) { if (a.email === email) { a.status = 'denied'; a.deny_reason = reason; } }); return Promise.resolve(); }
      return req('/rest/v1/access_attempts?email=eq.' + encodeURIComponent(email), { method: 'PATCH', body: { status: 'denied', deny_reason: reason || null } });
    },
    saveIntegration: function (name, settings) {
      if (!live()) { mockSnap().integrations.forEach(function (i) { if (i.name === name) i.settings = settings; }); return Promise.resolve(); }
      return req('/rest/v1/integration_config?name=eq.' + encodeURIComponent(name), { method: 'PATCH', body: { settings: settings } });
    },
    setSecret: function (name, secret) {
      if (!live()) { mockSnap().integrations.forEach(function (i) { if (i.name === name) i.secret_set = true; }); return Promise.resolve(); }
      return rpc('set_integration_secret', { p_name: name, p_secret: secret });
    },
    requestSync: function (source) {
      if (!live()) {
        var s = mockSnap();
        s.runs.unshift({ at: now(), source: source, status: 'ok', rows: source === 'hubspot' ? 23 : s.invoices.length, note: 'Manual sync' });
        s.integrations.forEach(function (i) { if (i.name === source) { i.last_synced_at = now(); i.last_status = 'ok'; } });
        return new Promise(function (res) { setTimeout(res, 1200); });
      }
      return rpc('request_sync', { p_source: source });
    }
  };

  return {
    live: live, getSession: getSession, gate: gate, signInWithGoogle: signInWithGoogle, signOut: signOut,
    loadSnapshot: loadSnapshot, mockSnap: mockSnap, setMockActor: function (e) { mockActor = e; }, W: W
  };
})();
