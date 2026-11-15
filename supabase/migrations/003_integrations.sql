-- ============================================================
-- Sales Ops Portal — 003 integrations, secrets, scheduled syncs
--
-- Same model as Sales Hunter (013, 031 §7, 033, 049):
--   * integration_config holds non-secret settings (base URL, card id,
--     pipelines, property names). Admin only.
--   * integration_secrets holds the HubSpot token, the Metabase API key
--     and the SSH tunnel's private key, encrypted with pgp_sym_encrypt
--     under a key kept in Supabase Vault. No client role can read it,
--     ever; admins write it only through set_integration_secret(), and
--     the edge functions (service role) read it through
--     get_integration_secret().
--   * The syncs run from pg_cron through pg_net and only answer a
--     caller that presents the x-sync-secret held in Vault.
--
-- Vault secrets (names are fixed; see docs/SUPABASE.md):
--   integration_key  created here (random)  encrypts integration_secrets
--   sync_secret      created here (random)  x-sync-secret header
--   project_url      YOU create it          https://<ref>.supabase.co
--   anon_key         optional, YOU create   sent as apikey/Authorization
--                                           (not needed when the functions
--                                           are deployed with --no-verify-jwt)
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ------------------------------------------------------------
-- Tables
-- ------------------------------------------------------------
create table integration_config (
  name text primary key check (name in ('hubspot', 'metabase', 'metabase_ssh')),
  settings jsonb not null default '{}'::jsonb,
  secret_set boolean not null default false,
  last_synced_at timestamptz,
  last_status text,
  updated_at timestamptz not null default now()
);

create table integration_secrets (
  name text primary key references integration_config (name) on delete cascade,
  secret bytea not null,          -- pgp_sym_encrypt(secret, integration_key())
  updated_at timestamptz not null default now()
);

-- One row per integration, so the Integrations page only ever PATCHes
-- settings (it never inserts).
insert into integration_config (name, settings) values
  ('hubspot', jsonb_build_object(
      'pipelines', '[]'::jsonb,
      'amount_prop', 'amount_without_vat',
      'close_date_prop', 'closedate',
      'category_prop', '',
      'deal_type_prop', '',
      'store_id_prop', '')),
  ('metabase', jsonb_build_object('base_url', '', 'card_invoices', '')),
  ('metabase_ssh', jsonb_build_object('enabled', false))
on conflict (name) do nothing;

alter table integration_config enable row level security;
alter table integration_secrets enable row level security;

create policy integration_config_read on integration_config for select to authenticated
  using ((select is_role('admin')));
create policy integration_config_update on integration_config for update to authenticated
  using ((select is_role('admin')))
  with check ((select is_role('admin')));
-- integration_secrets: no policies at all.

-- Admins change settings only; secret_set / last_* are the server's.
revoke all on integration_config from anon, authenticated;
grant select on integration_config to authenticated;
grant update (settings) on integration_config to authenticated;
-- Closed even if a policy were added by mistake later (SH 049).
revoke all on integration_secrets from anon, authenticated;

create trigger integration_config_audit after update on integration_config
  for each row execute function audit_row_change();

-- ------------------------------------------------------------
-- Vault-held keys
-- ------------------------------------------------------------
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'integration_key',
                           'Symmetric key for integration_secrets (pgp_sym_encrypt)')
where not exists (select 1 from vault.secrets where name = 'integration_key');

select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'sync_secret',
                           'x-sync-secret header the cron jobs send to sync-hubspot / sync-metabase')
where not exists (select 1 from vault.secrets where name = 'sync_secret');

create or replace function integration_key()
returns text language sql stable security definer set search_path = public, vault as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'integration_key' limit 1;
$$;
revoke all on function integration_key() from public, anon, authenticated;

-- ------------------------------------------------------------
-- Changing where a key is sent forgets the key (SH 031 §7)
-- ------------------------------------------------------------
-- The syncs send the Metabase key to whatever base_url says, so an
-- admin session (or a stolen one) could point it at another server and
-- collect the key. A new address needs the key typed in again. The SSH
-- tunnel is a second way to redirect it (curl on the gateway receives
-- the Metabase key), so changing the gateway's host, port, user or
-- target forgets both the SSH key and the Metabase key, and the saved
-- host fingerprint.
create or replace function integration_address_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (old.settings ->> 'base_url') is distinct from (new.settings ->> 'base_url') then
    delete from integration_secrets where name = new.name;
    new.secret_set := false;
    new.settings := new.settings - 'secret_hint';
  end if;
  if new.name = 'metabase_ssh' and (
       (old.settings ->> 'host') is distinct from (new.settings ->> 'host')
    or (old.settings ->> 'port') is distinct from (new.settings ->> 'port')
    or (old.settings ->> 'username') is distinct from (new.settings ->> 'username')
    or (old.settings ->> 'target_url') is distinct from (new.settings ->> 'target_url')) then
    delete from integration_secrets where name in ('metabase_ssh', 'metabase');
    new.secret_set := false;
    new.settings := new.settings - 'host_fingerprint';
    update integration_config
       set secret_set = false, settings = settings - 'secret_hint', updated_at = now()
     where name = 'metabase';
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function integration_address_guard() from public, anon, authenticated;
create trigger integration_address_guard before update on integration_config
  for each row execute function integration_address_guard();

-- ------------------------------------------------------------
-- Secrets in and out
-- ------------------------------------------------------------
-- Admin saves (or, with an empty value, removes) an integration's
-- secret. It is never returned; only its last four characters are kept
-- in settings.secret_hint so the page can show WHICH key is saved (not
-- for the SSH private key, whose tail is PEM armour).
create or replace function set_integration_secret(p_name text, p_secret text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  v_secret text := nullif(trim(p_secret), '');
begin
  if not is_role('admin') then raise exception 'admin only'; end if;
  if not exists (select 1 from integration_config where name = p_name) then
    raise exception 'unknown integration %', p_name;
  end if;
  if v_secret is null then
    delete from integration_secrets where name = p_name;
    update integration_config
       set secret_set = false, settings = settings - 'secret_hint'
     where name = p_name;
    insert into audit_log (actor_email, action, detail)
    values (member_email(), 'integration_secret.remove', p_name);
    return;
  end if;
  insert into integration_secrets (name, secret, updated_at)
  values (p_name, pgp_sym_encrypt(v_secret, integration_key()), now())
  on conflict (name) do update set secret = excluded.secret, updated_at = now();
  update integration_config
     set secret_set = true,
         settings = case when p_name = 'metabase_ssh' then settings - 'secret_hint'
                         else settings || jsonb_build_object('secret_hint', right(v_secret, 4)) end
   where name = p_name;
  insert into audit_log (actor_email, action, detail)
  values (member_email(), 'integration_secret.set', p_name);
end $$;
revoke all on function set_integration_secret(text, text) from public, anon;
grant execute on function set_integration_secret(text, text) to authenticated;

-- Edge functions (service role) read the decrypted secret.
create or replace function get_integration_secret(p_name text)
returns text language plpgsql stable security definer set search_path = public, extensions as $$
begin
  return pgp_sym_decrypt((select secret from integration_secrets where name = p_name), integration_key());
end $$;
revoke all on function get_integration_secret(text) from public, anon, authenticated;
grant execute on function get_integration_secret(text) to service_role;

-- For the functions: true when the x-sync-secret header matches Vault.
-- To rotate:
--   select vault.update_secret(id, encode(extensions.gen_random_bytes(32), 'hex'))
--   from vault.secrets where name = 'sync_secret';
create or replace function sync_secret_ok(p_secret text)
returns boolean language sql stable security definer set search_path = public, vault as $$
  select coalesce(p_secret, '') <> '' and exists (
    select 1 from vault.decrypted_secrets where name = 'sync_secret' and decrypted_secret = p_secret);
$$;
revoke all on function sync_secret_ok(text) from public, anon, authenticated;
grant execute on function sync_secret_ok(text) to service_role;

-- ------------------------------------------------------------
-- Calling the syncs
-- ------------------------------------------------------------
-- Internal: POST to the edge function with the scheduler's secret. The
-- project URL and the secret are read from Vault when this runs, so
-- neither appears in this file, in git, or in cron.job.
create or replace function invoke_sync(p_source text)
returns bigint language plpgsql security definer set search_path = public, vault as $$
declare
  v_url text;
  v_anon text;
  v_secret text;
  v_fn text;
  v_timeout integer;
begin
  v_fn := case p_source when 'hubspot' then 'sync-hubspot' when 'metabase' then 'sync-metabase' end;
  if v_fn is null then raise exception 'unknown sync source %', p_source; end if;
  select rtrim(decrypted_secret, '/') into v_url from vault.decrypted_secrets where name = 'project_url' limit 1;
  if coalesce(v_url, '') = '' then
    raise exception 'Vault secret project_url is not set (see docs/SUPABASE.md)';
  end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'sync_secret' limit 1;
  select decrypted_secret into v_anon from vault.decrypted_secrets where name = 'anon_key' limit 1;
  -- pg_net only logs the answer; a longer wait keeps that log honest
  -- (SH 028). Metabase runs make 90 s requests.
  v_timeout := case p_source when 'metabase' then 300000 else 60000 end;
  return net.http_post(
    url := v_url || '/functions/v1/' || v_fn,
    headers := jsonb_strip_nulls(jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', v_secret,
      'apikey', nullif(v_anon, ''),
      'Authorization', case when coalesce(v_anon, '') <> '' then 'Bearer ' || v_anon end
    )),
    body := '{}'::jsonb,
    timeout_milliseconds := v_timeout
  );
end $$;
revoke all on function invoke_sync(text) from public, anon, authenticated, service_role;

-- RPC: admin or manager runs a sync now. Returns the pg_net request id.
-- One manual run per source per minute, so the button cannot be used to
-- burn the HubSpot / Metabase API allowance.
create or replace function request_sync(p_source text)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_id bigint;
begin
  if not is_role('admin', 'manager') then raise exception 'admin or manager only'; end if;
  if p_source not in ('hubspot', 'metabase') then raise exception 'unknown sync source %', p_source; end if;
  if exists (select 1 from audit_log
              where action = 'request_sync' and detail = p_source
                and at > now() - interval '60 seconds') then
    raise exception 'a % sync was requested less than a minute ago', p_source;
  end if;
  v_id := invoke_sync(p_source);
  insert into audit_log (actor_email, action, detail) values (member_email(), 'request_sync', p_source);
  return v_id;
end $$;
revoke all on function request_sync(text) from public, anon;
grant execute on function request_sync(text) to authenticated;

-- ------------------------------------------------------------
-- Schedules
-- ------------------------------------------------------------
-- cron.schedule with an existing job name replaces that job, so this
-- block can be re-run safely.
select cron.schedule('sales-ops-sync-hubspot', '*/5 * * * *', $$ select public.invoke_sync('hubspot'); $$);
select cron.schedule('sales-ops-sync-metabase', '*/30 * * * *', $$ select public.invoke_sync('metabase'); $$);
