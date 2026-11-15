/* ============================================================
   Sales Ops Portal: Team & Access
   A port of Sales Hunter's Team & Access page (app.js viewTeam): the
   header with a user count, search and "+ Add user"; the access
   requests table; the people table with tabs, sortable columns, row
   selection, a bulk-action bar and paging; and the Add / Edit drawer.
   Built on the same table helper (tables.js).

   Managers may only add employees and turn employees' access off or
   on (the database enforces it too, migration 007). Admins do it all.
   ============================================================ */

VIEWS.access = {
  title: function () { return L('Team & Access', 'الفريق والوصول'); },
  sub: function () { return ''; },
  controls: {},
  render: function (content) {
    var s = ST.v.access = ST.v.access || { q: '', show: 'all', page: 1 };
    var me = lcEmail(ST.realEmail);
    var ROLES = isAdmin() ? ['rep', 'manager', 'finance', 'admin'] : ['rep'];
    function canManage(u) { return isAdmin() || u.role === 'rep'; }
    function joined(u) { return u.created_at ? fmtDate(new Date(u.created_at)) : '—'; }
    function avatar(u) { return '<span class="avatar u-av">' + esc(initials(u.name || u.email)) + '</span>'; }
    function statusPill(active) {
      return active ? '<span class="dot-badge active"><i></i>' + t('active') + '</span>' : '<span class="dot-badge off"><i></i>' + L('Revoked', 'مسحوب') + '</span>';
    }

    function render(focusSearch) {
      var everyone = ST.model.users.slice();
      var SHOW = [['all', L('Everyone', 'الجميع')], ['rep', L('Employees', 'الموظفون')], ['mgmt', L('Management & finance', 'الإدارة والمالية')], ['off', L('Revoked', 'المسحوب')]];
      var q = s.q.trim().toLowerCase();
      var filtered = everyone.filter(function (u) {
        if (s.show === 'rep' && !(u.role === 'rep' && u.active !== false)) return false;
        if (s.show === 'mgmt' && !(u.role !== 'rep' && u.active !== false)) return false;
        if (s.show === 'off' && u.active !== false) return false;
        return !q || ((u.name || '') + ' ' + u.email + ' ' + (u.email_aliases || []).join(' ') + ' ' + roleLabel(u.role)).toLowerCase().indexOf(q) >= 0;
      });
      var DFLT = { k: 'name', d: 'asc' };
      var st = Tbl.sortState('team', DFLT);
      filtered = Tbl.sort(filtered, 'team', {
        name: function (u) { return (u.name || u.email).toLowerCase(); },
        status: function (u) { return u.active === false ? 1 : 0; },
        plan: function (u) { return u.role === 'rep' ? planName(SO.planOf(ST.model.rules, u.plan)) : ''; },
        access: function (u) { return roleLabel(u.role); },
        joined: function (u) { return u.created_at ? new Date(u.created_at).getTime() : 0; }
      }, DFLT);
      var PER = Tbl.perPage('team', 10);
      var pages = Math.max(1, Math.ceil(filtered.length / PER));
      s.page = Math.min(Math.max(1, s.page), pages);
      var pageUsers = filtered.slice((s.page - 1) * PER, s.page * PER);
      var pageIds = pageUsers.filter(function (u) { return canManage(u) && lcEmail(u.email) !== me; }).map(function (u) { return u.email; });
      Tbl.prune('team', filtered.map(function (u) { return u.email; }));

      var rows = pageUsers.map(function (u) {
        var self = lcEmail(u.email) === me, can = canManage(u) && !self;
        var plan = u.role === 'rep' ? SO.planOf(ST.model.rules, u.plan) : null;
        return '<tr' + (u.active === false ? ' class="row-off"' : '') + '>' +
          (can ? Tbl.selTd('team', u.email, u.name || u.email) : '<td class="sel-col"></td>') +
          '<td class="tc-main"><div class="u-cell">' + avatar(u) +
            '<div class="u-meta"><b>' + esc(u.name || u.email) + (self ? ' · ' + t('you') : '') + '</b>' +
            '<span class="cell-sub" dir="ltr">' + esc(u.email) + ((u.email_aliases || []).length ? ' · ' + esc(u.email_aliases.join(', ')) : '') + '</span></div></div></td>' +
          '<td>' + statusPill(u.active !== false) + '</td>' +
          '<td>' + (plan ? esc(planName(plan)) + (plan.probation_targets && u.start_date ? '<span class="cell-sub">' + L('Joined ', 'انضم ') + esc(monthName(String(u.start_date).slice(0, 7))) + '</span>' : '') +
            (plan.sector_min_stores && u.sector ? '<span class="cell-sub">' + esc(trCat(u.sector)) + '</span>' : '') : '—') + '</td>' +
          '<td>' + (isAdmin() && !self
            ? '<select class="dd-select so-role" data-role="' + esc(u.email) + '">' + ['rep', 'manager', 'finance', 'admin'].map(function (r) { return '<option value="' + r + '"' + (r === u.role ? ' selected' : '') + '>' + esc(roleLabel(r)) + '</option>'; }).join('') + '</select>'
            : esc(roleLabel(u.role))) + '</td>' +
          '<td>' + joined(u) + '</td>' +
          '<td class="tc-actions" style="white-space:nowrap; text-align:end">' +
            (canManage(u) ? '<button class="tbl-icon" data-edit="' + esc(u.email) + '" title="' + t('editBtn') + '" aria-label="' + t('editBtn') + '">' + ICON.pencil + '</button>' : '') +
            (can ? '<button class="tbl-icon" data-toggle="' + esc(u.email) + '" title="' + (u.active !== false ? L('Revoke access', 'سحب الوصول') : L('Restore access', 'استعادة الوصول')) + '" aria-label="' + (u.active !== false ? L('Revoke access', 'سحب الوصول') : L('Restore access', 'استعادة الوصول')) + '">' + (u.active !== false ? ICON.ban : ICON.check) + '</button>' : '') +
          '</td></tr>';
      }).join('');

      // ---- access requests: Google sign-ins not on the list ----
      var reqs = (ST.snap.attempts || []).filter(function (a) { return a.status !== 'approved'; });
      var RD = { k: 'requested', d: 'desc' };
      var rst = Tbl.sortState('requests', RD);
      reqs = Tbl.sort(reqs, 'requests', {
        name: function (r) { return (r.name || r.email).toLowerCase(); },
        requested: function (r) { return new Date(r.last_at || r.first_at || 0).getTime(); },
        tries: function (r) { return r.attempts || 0; },
        status: function (r) { return r.status === 'pending' ? 0 : 1; }
      }, RD);
      var reqIds = reqs.map(function (r) { return r.email; });
      Tbl.prune('requests', reqIds);
      var pendingN = reqs.filter(function (r) { return r.status === 'pending'; }).length;
      var reqCard = !reqs.length ? '' :
        '<section class="card" id="requests-card">' +
          '<div class="card-head"><div><h3>' + L('Access requests', 'طلبات الوصول') + ' <span class="count-badge">' + pendingN + '</span></h3>' +
            '<p class="sub">' + L('People who signed in with Google but are not on the access list. Approving gives them Employee access.', 'أشخاص دخلوا بحساب Google وليسوا في قائمة الوصول. القبول يمنحهم وصول موظف.') + '</p></div></div>' +
          Tbl.bar('requests', [{ act: 'approve', label: t('approve'), cls: '' }, { act: 'reject', label: t('reject') }]) +
          '<div class="tbl-wrap"><table>' +
            '<thead><tr>' + Tbl.selTh('requests', reqIds) +
              Tbl.th('requests', rst, 'name', L('Applicant', 'المتقدم'), { first: 'asc' }) +
              Tbl.th('requests', rst, 'requested', L('Last tried', 'آخر محاولة')) +
              Tbl.th('requests', rst, 'tries', L('Tries', 'المحاولات'), { num: true }) +
              Tbl.th('requests', rst, 'status', t('status'), { first: 'asc' }) +
              '<th></th></tr></thead>' +
            '<tbody>' + reqs.map(function (r) {
              return '<tr>' + Tbl.selTd('requests', r.email, r.name || r.email) +
                '<td class="tc-main"><b>' + esc(r.name || r.email) + '</b><span class="cell-sub" dir="ltr">' + esc(r.email) + '</span></td>' +
                '<td>' + (r.last_at ? fmtDate(new Date(r.last_at)) : '—') + '</td>' +
                '<td class="num">' + (r.attempts || 1) + '</td>' +
                '<td>' + (r.status === 'pending' ? '<span class="dot-badge pending"><i></i>' + t('reqPending') + '</span>' : '<span class="dot-badge off"><i></i>' + t('reqRejected') + '</span>') + '</td>' +
                '<td class="tc-actions" style="white-space:nowrap; text-align:end">' +
                  '<button class="tbl-icon" data-approve="' + esc(r.email) + '" title="' + t('approve') + '" aria-label="' + esc(t('approve') + ' ' + (r.name || r.email)) + '">' + ICON.check + '</button>' +
                  (r.status === 'pending' ? '<button class="tbl-icon" data-reject="' + esc(r.email) + '" title="' + t('reject') + '" aria-label="' + esc(t('reject') + ' ' + (r.name || r.email)) + '">' + ICON.ban + '</button>' : '') +
                '</td></tr>';
            }).join('') + '</tbody></table></div></section>';

      content.innerHTML =
        '<div class="filter-row">' +
          '<div style="display:flex; align-items:center; gap:10px"><h2>' + L('Team & access', 'الفريق والوصول') + '</h2>' +
            '<span class="count-badge">' + t('usersCount', { n: everyone.length }) + '</span></div>' +
          '<div class="spacer"></div>' +
          '<input type="search" id="tbl-search" class="tbl-search" placeholder="' + t('searchUsers') + '" value="' + esc(s.q) + '">' +
          '<button class="btn" id="add-user-btn">' + (isAdmin() ? t('addUser') : L('+ Add employee', '+ إضافة موظف')) + '</button>' +
        '</div>' +
        reqCard +
        '<section class="card">' +
          '<div class="card-head"><div class="seg" id="team-show">' + SHOW.map(function (o) {
            return '<button data-seg="' + o[0] + '" class="' + (o[0] === s.show ? 'active' : '') + '">' + esc(o[1]) + '</button>';
          }).join('') + '</div></div>' +
          Tbl.bar('team', [{ act: 'enable', label: L('Restore access', 'استعادة الوصول') }, { act: 'disable', label: L('Revoke access', 'سحب الوصول') }, { act: 'csv', label: t('exportSelected') }]) +
          '<div class="tbl-wrap"><table>' +
            '<thead><tr>' + Tbl.selTh('team', pageIds) +
              Tbl.th('team', st, 'name', t('user'), { first: 'asc' }) +
              Tbl.th('team', st, 'status', t('status'), { first: 'asc' }) +
              Tbl.th('team', st, 'plan', L('Plan', 'الخطة'), { first: 'asc' }) +
              Tbl.th('team', st, 'access', t('accessCol'), { first: 'asc' }) +
              Tbl.th('team', st, 'joined', t('joinedCol')) +
              '<th></th></tr></thead>' +
            '<tbody>' + (rows || '<tr><td colspan="7"><div class="empty">' + t('noneFound') + '</div></td></tr>') + '</tbody>' +
          '</table></div>' +
          Tbl.pager({ id: 'team', page: s.page, per: PER, total: filtered.length }) +
        '</section>' +
        '<p class="sub" style="text-align:center">' + (isAdmin()
          ? L('You cannot change or revoke your own access. Revoked people keep their history but can no longer sign in.', 'لا يمكنك تغيير وصولك أو سحبه. من يُسحب وصوله يبقى سجله لكنه لا يستطيع الدخول.')
          : L('Managers can add employees and revoke or restore employees\' access. Other roles are set by Sales Ops.', 'يمكن للمدير إضافة الموظفين وسحب وصولهم أو استعادته. وتضبط عمليات المبيعات الأدوار الأخرى.')) + '</p>';

      var searchEl = document.getElementById('tbl-search');
      searchEl.addEventListener('input', function () { s.q = this.value; s.page = 1; render(true); });
      if (focusSearch) { searchEl.focus(); searchEl.setSelectionRange(searchEl.value.length, searchEl.value.length); }
      on(content, '#team-show [data-seg]', 'click', function (b) { s.show = b.getAttribute('data-seg'); s.page = 1; Tbl.clear('team'); render(); });
      Tbl.wireSort(content, 'team', DFLT, render);
      Tbl.wireSort(content, 'requests', RD, render);
      Tbl.wirePager(content, 'team', { page: function (n) { s.page = n; render(); }, per: function () { s.page = 1; render(); } });
      Tbl.wireSelect(content, 'team', pageIds, render, function (act, ids) {
        var list = everyone.filter(function (u) { return ids.indexOf(u.email) >= 0 && canManage(u) && lcEmail(u.email) !== me; });
        if (act === 'csv') {
          csvDownload('team.csv', ['Name', 'Email', 'Role', 'Plan', 'Status'], list.map(function (u) { return [u.name, u.email, roleLabel(u.role), u.role === 'rep' ? planName(SO.planOf(ST.model.rules, u.plan)) : '', u.active !== false ? 'Active' : 'Revoked']; }));
          return false;
        }
        var activeVal = act === 'enable';
        return Promise.all(list.map(function (u) { return SO_API.W.updateUser(u.email, { active: activeVal }); })).then(function () {
          SO_API.W.audit('access', (activeVal ? 'Restored' : 'Revoked') + ' access for ' + list.map(function (u) { return u.email; }).join(', '));
          toast(activeVal ? L('Access restored', 'استُعيد الوصول') : L('Access revoked', 'سُحب الوصول')); reload();
        }, failToast);
      });
      Tbl.wireSelect(content, 'requests', reqIds, render, function (act, ids) {
        var work = act === 'approve'
          ? ids.reduce(function (p, e) { var r = reqs.filter(function (x) { return x.email === e; })[0]; return p.then(function () { return SO_API.W.addUser({ email: e, name: (r && r.name) || e.split('@')[0], role: 'rep', plan: 'junior' }); }); }, Promise.resolve())
          : Promise.all(ids.map(function (e) { return SO_API.W.denyAttempt(e, ''); }));
        return work.then(function () { toast(act === 'approve' ? L('Approved as employees', 'قُبلوا كموظفين') : L('Requests rejected', 'رُفضت الطلبات')); reload(); }, failToast);
      });
      on(content, '[data-approve]', 'click', function (b) {
        var r = reqs.filter(function (x) { return x.email === b.getAttribute('data-approve'); })[0];
        SO_API.W.addUser({ email: r.email, name: r.name || r.email.split('@')[0], role: 'rep', plan: 'junior' }).then(function () {
          SO_API.W.audit('access', 'Approved ' + r.email + ' as an employee');
          toast((r.name || r.email) + L(' can now sign in', ' يمكنه الدخول الآن')); reload();
        }, failToast);
      });
      on(content, '[data-reject]', 'click', function (b) {
        var e = b.getAttribute('data-reject');
        SO_API.W.denyAttempt(e, '').then(function () { SO_API.W.audit('access', 'Rejected ' + e); toast(L('Request rejected', 'رُفض الطلب')); reload(); }, failToast);
      });
      on(content, '[data-toggle]', 'click', function (b) {
        var u = everyone.filter(function (x) { return x.email === b.getAttribute('data-toggle'); })[0], v = u.active === false;
        SO_API.W.updateUser(u.email, { active: v }).then(function () {
          SO_API.W.audit('access', (v ? 'Restored' : 'Revoked') + ' access for ' + u.email);
          toast(v ? L('Access restored', 'استُعيد الوصول') : L('Access revoked', 'سُحب الوصول')); reload();
        }, failToast);
      });
      on(content, '[data-role]', 'change', function (sel) {
        var e = sel.getAttribute('data-role');
        SO_API.W.updateUser(e, { role: sel.value }).then(function () { SO_API.W.audit('access', 'Changed role of ' + e + ' to ' + sel.value); toast(L('Role updated', 'تغيّر الدور')); reload(); }, failToast);
      });
      document.getElementById('add-user-btn').addEventListener('click', function () { openDrawer(null); });
      on(content, '[data-edit]', 'click', function (b) { openDrawer(everyone.filter(function (x) { return x.email === b.getAttribute('data-edit'); })[0]); });
    }

    // Add / Edit drawer, as on Sales Hunter.
    function openDrawer(u) {
      closeDrawer();
      var edit = !!u, r = u || { role: 'rep', plan: 'junior' };
      var cats = {};
      ST.model.rows.forEach(function (x) { if (x.category && x.category !== 'Other') cats[x.category] = 1; });
      (ST.snap.showcase || []).forEach(function (x) { if (x.category) cats[String(x.category).trim()] = 1; });
      var bg = document.createElement('div'); bg.className = 'drawer-backdrop'; bg.id = 'so-drawer-bg';
      var d = document.createElement('div'); d.className = 'drawer au-drawer'; d.id = 'so-drawer';
      d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true');
      d.innerHTML =
        '<div class="d-head"><h3>' + (edit ? L('Edit ', 'تعديل ') + esc(r.name || r.email) : (isAdmin() ? L('Add user', 'إضافة مستخدم') : L('Add employee', 'إضافة موظف'))) + '</h3>' +
          '<button class="icon-btn" id="au-close" aria-label="' + t('cancel') + '">✕</button></div>' +
        '<form id="au-form" style="margin-top:14px"><div class="au-fields">' +
          '<div><label class="f-label" for="nu-name">' + t('fullName') + '</label><input type="text" id="nu-name" value="' + esc(r.name || '') + '">' +
            '<p class="f-hint">' + L('Replaced by the name on their Google account when they sign in.', 'يُستبدل باسم حساب Google عند دخوله.') + '</p></div>' +
          '<div><label class="f-label" for="nu-email">' + t('emailLbl') + ' *</label><input type="email" id="nu-email" required dir="ltr" placeholder="name@zid.sa" value="' + esc(r.email || '') + '"' + (edit ? ' disabled' : '') + '>' +
            '<p class="f-hint">' + L('Signs in with Google using this Zid address.', 'يدخل عبر Google بعنوان زد هذا.') + '</p></div>' +
          (isAdmin() ? '<div><label class="f-label" for="nu-alias">' + L('Also known as (aliases)', 'عناوين أخرى (أسماء مستعارة)') + '</label><input type="text" id="nu-alias" dir="ltr" placeholder="alias@zid.sa" value="' + esc((r.email_aliases || []).join(', ')) + '">' +
            '<p class="f-hint">' + L('Other Zid addresses of the same person, comma separated.', 'عناوين زد أخرى لنفس الشخص، مفصولة بفواصل.') + '</p></div>' : '') +
          '<div><label class="f-label" for="nu-title">' + t('jobTitle') + '</label><input type="text" id="nu-title" value="' + esc(r.title || '') + '"></div>' +
          '<div><label class="f-label" for="nu-role">' + t('role') + '</label><select id="nu-role"' + (ROLES.length < 2 ? ' disabled' : '') + '>' +
            ROLES.concat(ROLES.indexOf(r.role) < 0 ? [r.role] : []).map(function (x) { return '<option value="' + x + '"' + (x === r.role ? ' selected' : '') + '>' + esc(roleLabel(x)) + '</option>'; }).join('') + '</select></div>' +
          '<div id="nu-plan-group"><label class="f-label" for="nu-plan">' + L('Plan', 'الخطة') + '</label><select id="nu-plan">' +
            ST.model.rules.plans.map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === (r.plan || 'junior') ? ' selected' : '') + '>' + esc(planName(p)) + '</option>'; }).join('') + '</select></div>' +
          '<div id="nu-start-group"><label class="f-label" for="nu-start">' + L('Joined (month)', 'شهر الانضمام') + '</label><input type="month" id="nu-start" dir="ltr" value="' + esc(String(r.start_date || '').slice(0, 7)) + '"></div>' +
          '<div id="nu-sector-group"><label class="f-label" for="nu-sector">' + L('Sector', 'القطاع') + '</label><select id="nu-sector"><option value="">' + L('Not set', 'غير محدد') + '</option>' +
            Object.keys(cats).sort().concat(r.sector && !cats[r.sector] ? [r.sector] : []).map(function (c) { return '<option value="' + esc(c) + '"' + (c === r.sector ? ' selected' : '') + '>' + esc(trCat(c)) + '</option>'; }).join('') + '</select></div>' +
        '</div>' +
        '<p class="f-error" id="au-err" hidden></p>' +
        '<div class="au-actions"><button type="button" class="btn secondary" id="au-cancel">' + t('cancel') + '</button>' +
          '<button type="submit" class="btn">' + (edit ? L('Save changes', 'حفظ التغييرات') : t('createUser')) + '</button></div></form>';
      document.body.appendChild(bg); document.body.appendChild(d);
      var roleSel = d.querySelector('#nu-role'), planSel = d.querySelector('#nu-plan');
      function showGroups() {
        var rep = roleSel.value === 'rep', p = SO.planOf(ST.model.rules, planSel.value);
        d.querySelector('#nu-plan-group').hidden = !rep;
        d.querySelector('#nu-start-group').hidden = !(rep && p.probation_targets);
        d.querySelector('#nu-sector-group').hidden = !(rep && p.sector_min_stores);
      }
      roleSel.addEventListener('change', showGroups); planSel.addEventListener('change', showGroups); showGroups();
      bg.addEventListener('click', closeDrawer);
      d.querySelector('#au-close').addEventListener('click', closeDrawer);
      d.querySelector('#au-cancel').addEventListener('click', closeDrawer);
      d.querySelector(edit ? '#nu-name' : '#nu-email').focus();
      d.querySelector('#au-form').addEventListener('submit', function (e) {
        e.preventDefault();
        var err = d.querySelector('#au-err');
        var email = lcEmail(edit ? r.email : d.querySelector('#nu-email').value);
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { err.textContent = L('Enter a valid email', 'أدخل بريدًا صحيحًا'); err.hidden = false; return; }
        var role = roleSel.value, rep = role === 'rep', p = SO.planOf(ST.model.rules, planSel.value);
        var row = { name: d.querySelector('#nu-name').value.trim() || email.split('@')[0], title: d.querySelector('#nu-title').value.trim() || null, role: role,
          plan: rep ? planSel.value : null,
          start_date: rep && p.probation_targets && d.querySelector('#nu-start').value ? d.querySelector('#nu-start').value + '-01' : (rep && p.probation_targets ? r.start_date || null : null),
          sector: rep && p.sector_min_stores ? (d.querySelector('#nu-sector').value || null) : null };
        var alias = d.querySelector('#nu-alias');
        if (alias) row.email_aliases = alias.value.split(/[,\s]+/).map(function (x) { return lcEmail(x); }).filter(function (x) { return /@/.test(x); });
        var work = edit ? SO_API.W.updateUser(email, row) : SO_API.W.addUser(Object.assign({ email: email }, row));
        work.then(function () {
          SO_API.W.audit('access', (edit ? 'Edited ' : 'Gave access to ') + email + ' (' + role + ')');
          closeDrawer(); toast(edit ? L('Saved', 'حُفظ') : (row.name + L(' can now sign in', ' يمكنه الدخول الآن'))); reload();
        }, function (e2) { err.textContent = String(e2.message || e2); err.hidden = false; });
      });
    }
    render();
  }
};
