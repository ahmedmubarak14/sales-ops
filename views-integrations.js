/* ============================================================
   Sales Ops Portal: Integrations
   A port of Sales Hunter's Integrations page (app.js viewIntegrations):
   the same cards, sections, status badges, pipeline picker and SSH
   tunnel flow, with the fields Sales Ops syncs. Settings go to
   integration_config; keys go to set_integration_secret() and are never
   read back (migration 003).
   ============================================================ */

// HubSpot deal pipelines in Zid's portal (as in Sales Hunter's app.js).
var HS_ALL_PIPELINES = [
  { id: '4104812', label: 'Enterprise Pipeline' }, { id: '12664947', label: "NGO's Pipeline" },
  { id: '20116133', label: 'ZidPOS Pipeline' }, { id: '77452599', label: 'Pre-Sales 2025' },
  { id: '891587615', label: 'SDR - Whatsapp Qualification' }, { id: '897552273', label: 'Pre-Sales' },
  { id: '78432319', label: 'Growth Pipeline' }, { id: '113684560', label: 'Enterprise Pipeline Revamp' },
  { id: '26669937', label: 'PLG' }, { id: '653632624', label: 'ZidHub  Deals Pipeline' },
  { id: '672915820', label: 'Financing' }, { id: '686408229', label: 'MR Mazeed Packages' },
  { id: '39948135', label: 'Sales Pipeline' }, { id: '686111358', label: 'Mazeed Package Pipeline' },
  { id: '820236450', label: 'GCC- Oman' }, { id: '820236454', label: 'GCC- Kuwait' },
  { id: '831963487', label: 'GCC - UAE' }, { id: '833718609', label: 'Zammit' },
  { id: '888536756', label: 'GCC' }, { id: '894816055', label: 'Western Region' },
  { id: '895151464', label: 'Syria Pipeline' }, { id: '39707223', label: 'Nurturing' },
  { id: '699701572', label: 'ZAD(NGO) Pipeline' }, { id: '705217563', label: 'Up/Cross-selling' }
];

VIEWS.integrations = {
  title: function () { return L('Integrations', 'التكاملات'); },
  sub: function () { return ''; },
  controls: {},
  render: function (content) {
    var cfg = {};
    (ST.snap.integrations || []).forEach(function (r) { cfg[r.name] = r; });

    function statusPill(row) {
      if (!row) return '<span class="dot-badge off"><i></i>' + t('intgNotConfigured') + '</span>';
      if (row.last_status && /error|fail|partial/i.test(row.last_status)) return '<span class="dot-badge off" style="color:var(--critical)"><i style="background:var(--critical)"></i>' + t('intgError') + '</span>';
      if (row.secret_set) return '<span class="dot-badge active"><i></i>' + t('intgConnected') + '</span>';
      return '<span class="dot-badge off"><i></i>' + t('intgNotConfigured') + '</span>';
    }
    function lastSync(row) {
      return row && row.last_synced_at ? t('intgLastSync', { when: fmtDate(new Date(row.last_synced_at)) }) : t('intgNeverSynced');
    }
    function fieldRow(id, label, val, ph, type, hint) {
      return '<div><label class="f-label" for="' + id + '">' + esc(label) + '</label>' +
        '<input type="' + (type || 'text') + '" id="' + id + '" value="' + esc(val || '') + '" placeholder="' + esc(ph || '') + '">' +
        (hint ? '<p class="f-hint">' + esc(hint) + '</p>' : '') + '</div>';
    }
    function pipelineRows(q, picked) {
      var ql = String(q || '').trim().toLowerCase();
      var items = HS_ALL_PIPELINES.filter(function (p) { return !ql || p.label.toLowerCase().indexOf(ql) >= 0 || p.id.indexOf(ql) >= 0; });
      if (!items.length) return '<p class="f-hint" style="padding:10px">' + t('intgNoPipelineMatch') + '</p>';
      return items.map(function (p) {
        return '<label class="pipeline-chk"><input type="checkbox" class="hs-pipeline-cb" value="' + esc(p.id) + '"' + (picked[p.id] ? ' checked' : '') + '>' +
          '<span>' + esc(p.label) + '</span><span class="cell-sub">' + p.id + '</span></label>';
      }).join('');
    }

    var hs = cfg.hubspot, mb = cfg.metabase, sh = cfg.metabase_ssh;
    var hsS = (hs && hs.settings) || {}, mbS = (mb && mb.settings) || {}, shS = (sh && sh.settings) || {};
    var picked = {};
    (hsS.pipelines || []).forEach(function (id) { picked[id] = true; });
    // A pipeline saved by id that is not in the list above still shows.
    (hsS.pipelines || []).forEach(function (id) {
      if (!HS_ALL_PIPELINES.some(function (p) { return p.id === id; })) HS_ALL_PIPELINES.push({ id: id, label: id });
    });
    function pickedCount() { return Object.keys(picked).filter(function (k) { return picked[k]; }).length; }

    content.innerHTML =
      '<div class="filter-row"><div><h2>' + L('Integrations', 'التكاملات') + '</h2>' +
        '<p class="sub">' + t('intgSub') + '</p></div></div>' +
      '<section class="card intg-card">' +
        '<div class="intg-head"><div class="intg-title"><span class="intg-logo hs">H</span>' +
          '<div><h3>HubSpot</h3><p class="sub">' + t('intgHubspotSub') + '</p></div></div>' + statusPill(hs) + '</div>' +
        '<form id="hs-form" class="intg-body">' +
          '<h4 class="intg-sub-h">' + t('intgSecAuth') + '</h4>' +
          '<div class="form-grid">' +
            fieldRow('hs-token', t('intgToken'), '', hs && hs.secret_set ? t('intgSecretSaved', { hint: hsS.secret_hint || '••••' }) : 'pat-…', 'password', t('intgTokenHint')) +
          '</div>' +
          '<h4 class="intg-sub-h">' + t('intgSecPipelines') + '</h4>' +
          '<p class="f-hint" style="margin-bottom:8px">' + t('intgPipelinesHint') + '</p>' +
          '<input type="search" id="hs-pipeline-search" class="tbl-search" style="width:100%; margin-bottom:8px" placeholder="' + t('intgPipelineSearchPh') + '">' +
          '<div class="pipeline-grid" id="hs-pipeline-list">' + pipelineRows('', picked) + '</div>' +
          '<p class="f-hint" id="hs-pipeline-count" style="margin-top:6px">' + t('intgPipelinesSelected', { n: pickedCount() }) + '</p>' +
          '<h4 class="intg-sub-h">' + t('intgSecFields') + '</h4>' +
          '<p class="f-hint" style="margin-bottom:8px">' + t('intgFieldsHint') + '</p>' +
          '<div class="form-grid">' +
            fieldRow('hs-amount', t('intgAmountProp'), hsS.amount_prop || '', 'amount_without_vat') +
            fieldRow('hs-close', t('intgCloseProp'), hsS.close_date_prop || '', 'closedate') +
            fieldRow('hs-category', t('intgSectorProp'), hsS.category_prop || '', 'industry') +
            fieldRow('hs-type', t('intgDealTypeProp'), hsS.deal_type_prop || '', 'dealtype') +
            fieldRow('hs-store', t('intgStoreIdProp'), hsS.store_id_prop || '', 'store_id', 'text', t('intgStoreIdHint')) +
          '</div>' +
          '<div class="intg-actions"><span class="sub">' + lastSync(hs) + '</span>' +
            '<button type="submit" class="btn">' + t('saveChanges') + '</button></div>' +
        '</form>' +
      '</section>' +

      '<section class="card intg-card">' +
        '<div class="intg-head"><div class="intg-title"><span class="intg-logo mb">M</span>' +
          '<div><h3>Metabase</h3><p class="sub">' + t('intgMetabaseSub') + '</p></div></div>' + statusPill(mb) + '</div>' +
        '<form id="mb-form" class="intg-body">' +
          '<div class="form-grid">' +
            fieldRow('mb-url', t('intgMbUrl'), mbS.base_url || '', 'https://metabase.your-co.com') +
            fieldRow('mb-key', t('intgMbKey'), '', mb && mb.secret_set ? t('intgSecretSaved', { hint: mbS.secret_hint || '••••' }) : 'mb_…', 'password') +
            fieldRow('mb-inv', t('intgCardInv'), mbS.card_invoices || '', 'e.g. 22032', 'text', t('intgCardInvHint')) +
          '</div>' +
          '<p class="f-hint">' + t('intgStoresAuto') + '</p>' +
          '<div class="intg-actions"><span class="sub">' + lastSync(mb) + '</span>' +
            '<button type="submit" class="btn">' + t('saveChanges') + '</button></div>' +
        '</form>' +
        '<form id="ssh-form" class="intg-body intg-ssh">' +
          '<h4 class="intg-sub-h">' + t('intgSshTitle') + '</h4>' +
          '<div class="f-check"><label class="ui-toggle"><input type="checkbox" class="switch" role="switch" id="ssh-on"' + (shS.enabled ? ' checked' : '') + '>' +
            '<span class="ui-toggle-text"><b>' + t('intgSshOn') + '</b><span>' + t('intgSshOnHint') + '</span></span></label></div>' +
          '<div id="ssh-fields"' + (shS.enabled ? '' : ' hidden') + '>' +
            '<div class="ssh-step"><b>' + t('intgSshStep1') + '</b>' +
              (shS.public_key
                ? '<p class="f-hint">' + t('intgSshPubHint') + '</p>' +
                  '<div class="ssh-pub"><code id="ssh-pub">' + esc(shS.public_key) + '</code>' +
                    '<button type="button" class="btn secondary" id="ssh-copy">' + t('intgSshCopy') + '</button></div>' +
                  '<button type="button" class="link-btn" id="ssh-gen">' + t('intgSshRegen') + '</button>'
                : '<p class="f-hint">' + t('intgSshGenHint') + '</p>' +
                  '<button type="button" class="btn secondary" id="ssh-gen">' + t('intgSshGen') + '</button>') +
            '</div>' +
            '<div class="ssh-step"><b>' + t('intgSshStep2') + '</b>' +
            '<div class="form-grid">' +
              fieldRow('ssh-host', t('intgSshHost'), shS.host || '', t('intgSshHostPh'), 'text', t('intgSshHostHint')) +
              fieldRow('ssh-port', t('intgSshPort'), shS.port || '22', '22') +
              fieldRow('ssh-user', t('intgSshUser'), shS.username || '', t('intgSshUserPh'), 'text', t('intgSshUserHint')) +
              fieldRow('ssh-target', t('intgSshTarget'), shS.target_url || '', mbS.base_url || t('intgSshTargetPh'), 'text', t('intgSshTargetHint')) +
            '</div></div>' +
            '<details class="ssh-own"><summary>' + t('intgSshOwnKey') + '</summary>' +
              '<label class="f-label" for="ssh-key">' + t('intgSshKey') + '</label>' +
              '<textarea id="ssh-key" class="ssh-key" rows="4" spellcheck="false" autocomplete="off" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"></textarea>' +
              '<p class="f-hint">' + t('intgSshKeyHint') + '</p></details>' +
            (shS.host_fingerprint
              ? '<p class="f-hint ssh-fp">' + t('intgSshFp') + ' <code>' + esc(shS.host_fingerprint) + '</code> ' +
                  '<button type="button" class="link-btn" id="ssh-fp-clear">' + t('intgSshFpClear') + '</button></p>'
              : '<p class="f-hint">' + t('intgSshFpNone') + '</p>') +
          '</div>' +
          '<div class="intg-actions"><span class="sub">' + (sh && sh.secret_set ? t('intgSshKeyIsSaved') : t('intgSshNoKey')) + '</span>' +
            '<button type="submit" class="btn">' + t('saveChanges') + '</button></div>' +
        '</form>' +
      '</section>' +
      '<p class="sub" style="text-align:center">' + t('intgSecurityNote') + '</p>';

    // Settings first, then the key: a changed address forgets the stored
    // key (migration 003), so the new key must land after it.
    function save(name, settings, secret) {
      SO_API.W.saveIntegration(name, settings)
        .then(function () { return secret && secret.trim() ? SO_API.W.setSecret(name, secret.trim()) : null; })
        .then(function () { toast(t('intgSaved')); reload(); })
        .catch(function (e) { toast(String(e.message || e)); });
    }

    var list = document.getElementById('hs-pipeline-list');
    var count = document.getElementById('hs-pipeline-count');
    list.addEventListener('change', function (e) {
      if (!e.target.classList.contains('hs-pipeline-cb')) return;
      picked[e.target.value] = e.target.checked;
      count.textContent = t('intgPipelinesSelected', { n: pickedCount() });
    });
    document.getElementById('hs-pipeline-search').addEventListener('input', function () { list.innerHTML = pipelineRows(this.value, picked); });

    document.getElementById('hs-form').addEventListener('submit', function (e) {
      e.preventDefault();
      save('hubspot', Object.assign({}, hsS, {
        pipelines: Object.keys(picked).filter(function (k) { return picked[k]; }),
        amount_prop: document.getElementById('hs-amount').value.trim(),
        close_date_prop: document.getElementById('hs-close').value.trim(),
        category_prop: document.getElementById('hs-category').value.trim(),
        deal_type_prop: document.getElementById('hs-type').value.trim(),
        store_id_prop: document.getElementById('hs-store').value.trim()
      }), document.getElementById('hs-token').value);
    });
    document.getElementById('mb-form').addEventListener('submit', function (e) {
      e.preventDefault();
      save('metabase', Object.assign({}, mbS, {
        base_url: document.getElementById('mb-url').value.trim(),
        card_invoices: document.getElementById('mb-inv').value.trim()
      }), document.getElementById('mb-key').value);
    });

    var sshOn = document.getElementById('ssh-on');
    // Hosts, addresses and keys read left to right in Arabic too.
    ['ssh-host', 'ssh-port', 'ssh-user', 'ssh-target', 'ssh-key', 'mb-url', 'mb-inv', 'hs-token', 'mb-key'].forEach(function (id) { document.getElementById(id).dir = 'ltr'; });
    sshOn.addEventListener('change', function () { document.getElementById('ssh-fields').hidden = !sshOn.checked; });
    function sshSettings(fp) {
      return {
        enabled: sshOn.checked,
        host: document.getElementById('ssh-host').value.trim(),
        port: document.getElementById('ssh-port').value.trim() || '22',
        username: document.getElementById('ssh-user').value.trim(),
        target_url: document.getElementById('ssh-target').value.trim().replace(/\/+$/, ''),
        host_fingerprint: fp,
        public_key: shS.public_key,
        key_created_at: shS.key_created_at
      };
    }
    var sshGen = document.getElementById('ssh-gen');
    sshGen.addEventListener('click', function () {
      if (shS.public_key && !confirm(t('intgSshRegenConfirm'))) return;
      sshGen.disabled = true;
      SO_API.W.createSshKey().then(function (r) {
        if (!r || !r.ok) throw new Error((r && r.error) || 'failed');
        toast(t('intgSshGenDone'));
        reload();
      }).catch(function (e2) { sshGen.disabled = false; toast(String(e2.message || e2)); });
    });
    var sshCopy = document.getElementById('ssh-copy');
    if (sshCopy) sshCopy.addEventListener('click', function () {
      var txt = shS.public_key;
      (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function () { toast(t('intgSshCopied')); }, function () {
        var r = document.createRange(); r.selectNodeContents(document.getElementById('ssh-pub'));
        var sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
      });
    });
    var fpClear = document.getElementById('ssh-fp-clear');
    if (fpClear) fpClear.addEventListener('click', function () { save('metabase_ssh', sshSettings(''), ''); });
    document.getElementById('ssh-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var v = sshSettings(shS.host_fingerprint || '');
      var key = document.getElementById('ssh-key').value.trim();
      if (v.enabled) {
        if (!v.host || !v.username || (!key && !(sh && sh.secret_set))) { toast(t('intgSshMissing')); return; }
        if (v.target_url && !/^https?:\/\//i.test(v.target_url)) { toast(t('intgSshTargetHttp')); return; }
        if (key && !/^-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(key)) { toast(t('intgSshKeyBad')); return; }
        if (/ENCRYPTED/.test(key)) { toast(t('intgSshKeyPass')); return; }
      }
      // A pasted key replaces the one we made, so its public half is gone.
      if (key) { v.public_key = ''; v.key_created_at = ''; }
      // A different host is a different server: forget the old fingerprint.
      if (v.host !== (shS.host || '') || String(v.port) !== String(shS.port || '22')) v.host_fingerprint = '';
      save('metabase_ssh', v, key);
    });
  }
};
