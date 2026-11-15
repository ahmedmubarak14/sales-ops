-- ============================================================
-- Sales Ops Portal — 002 identity, roles, row-level security, RPCs
--
-- Access is an allowlist. Signing in to Supabase Auth proves only that
-- someone holds a Google account; it never makes them a member. A
-- member is an ACTIVE app_users row whose email equals the Google
-- sign-in email, and only a session that came from Google counts
-- (app_metadata.provider = 'google'), so an account opened any other
-- way (were email sign-ups ever re-enabled) matches nobody.
--
-- There is deliberately NO trigger on auth.users: nobody becomes a
-- member by signing in. Admins and managers add people (Team page), or
-- approve them from access_attempts.
--
-- Policy style (Sales Hunter migration 042): every helper call in a
-- policy is wrapped in (select ...) so Postgres evaluates it once per
-- query (an initplan), not once per row.
-- ============================================================

-- ------------------------------------------------------------
-- Who is calling
-- ------------------------------------------------------------

-- The caller's email from the JWT, lowercased, but only for a Google
-- session. Null otherwise. Internal building block.
create or replace function jwt_google_email()
returns text language sql stable security definer set search_path = public as $$
  select case
    when (auth.jwt() -> 'app_metadata' ->> 'provider') = 'google'
    then nullif(lower(trim(auth.jwt() ->> 'email')), '')
  end;
$$;

-- The caller's active app_users row, or no row at all.
create or replace function current_member()
returns setof app_users
language sql stable security definer set search_path = public rows 1 as $$
  select u.*
  from app_users u
  where u.active
    and u.email = jwt_google_email()
  limit 1;
$$;

create or replace function member_email()
returns text language sql stable security definer set search_path = public as $$
  select email from current_member();
$$;

create or replace function is_member()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from current_member());
$$;

-- is_role('admin'), is_role('admin', 'manager'), ...
create or replace function is_role(variadic p_roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from current_member() m where m.role = any (p_roles));
$$;

-- Months the calling finance user currently holds an active grant for.
create or replace function finance_months()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct g.month), '{}'::text[])
  from finance_grants g
  where g.grantee_email = member_email()
    and g.active
    and (g.ends_on is null or g.ends_on >= current_date)
    and is_role('finance');
$$;

-- ------------------------------------------------------------
-- Server-side actor stamping
-- ------------------------------------------------------------
-- The client never sends updated_by / author_email / created_by /
-- paid_by / saved_by: this trigger fills them from the caller's member
-- email (and refreshes updated_at). Arguments name the columns:
--   'col'   set on insert only; kept unchanged on update
--   '*col'  set on insert and on every update
-- When the writer is not a member (service role, SQL editor) the values
-- given are left alone.
create or replace function stamp_actor()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  me text := member_email();
  arg text;
  col text;
  patch jsonb := '{}'::jsonb;
begin
  if me is not null then
    foreach arg in array tg_argv loop
      if left(arg, 1) = '*' then
        patch := patch || jsonb_build_object(substr(arg, 2), me);
      elsif tg_op = 'INSERT' then
        patch := patch || jsonb_build_object(arg, me);
      else
        patch := patch || jsonb_build_object(arg, to_jsonb(old) -> arg);
      end if;
    end loop;
  end if;
  if to_jsonb(new) ? 'updated_at' then
    patch := patch || jsonb_build_object('updated_at', now());
  end if;
  if patch <> '{}'::jsonb then
    new := jsonb_populate_record(new, patch);
  end if;
  return new;
end $$;

create trigger app_users_stamp before insert or update on app_users
  for each row execute function stamp_actor('created_by');
create trigger targets_stamp before insert or update on targets
  for each row execute function stamp_actor('*updated_by');
create trigger rule_versions_stamp before insert or update on rule_versions
  for each row execute function stamp_actor('saved_by');
create trigger issue_states_stamp before insert or update on issue_states
  for each row execute function stamp_actor('*updated_by');
create trigger issue_comments_stamp before insert or update on issue_comments
  for each row execute function stamp_actor('author_email');
create trigger payouts_stamp before insert or update on payouts
  for each row execute function stamp_actor('paid_by');
create trigger finance_grants_stamp before insert or update on finance_grants
  for each row execute function stamp_actor('created_by');

-- rule_versions.saved_at is always the server's clock.
create or replace function rule_versions_saved_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.saved_at := now();
  return new;
end $$;
create trigger rule_versions_saved_at before insert on rule_versions
  for each row execute function rule_versions_saved_at();

-- Reps may open or move their own deals' issues between open and
-- waiting (RLS below); the decision is management's. The frontend
-- upserts the whole row including decision, so a rep's value is
-- quietly ignored rather than refused.
create or replace function issue_states_rep_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if is_role('rep') then
    if tg_op = 'INSERT' then
      new.decision := null;
    else
      new.decision := old.decision;
    end if;
  end if;
  return new;
end $$;
create trigger issue_states_rep_guard before insert or update on issue_states
  for each row execute function issue_states_rep_guard();

-- ------------------------------------------------------------
-- Audit
-- ------------------------------------------------------------

-- RPC: write an audit line as the caller (members only).
create or replace function audit(p_action text, p_detail text)
returns void language plpgsql security definer set search_path = public as $$
declare me text := member_email();
begin
  if me is null then raise exception 'members only'; end if;
  if nullif(trim(p_action), '') is null then raise exception 'action is required'; end if;
  insert into audit_log (actor_email, action, detail)
  values (me, left(trim(p_action), 200), left(p_detail, 4000));
end $$;

-- Row-change audit for the tables people edit. Sync writes (service
-- role) are not audited: they are recorded in sync_runs instead.
create or replace function audit_row_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  actor text;
  detail jsonb;
  o jsonb;
  n jsonb;
begin
  -- (AFTER trigger: the return value is ignored.)
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
    return null;
  end if;
  actor := coalesce(member_email(), lower(auth.jwt() ->> 'email'), session_user::text);
  if tg_op = 'UPDATE' then
    o := to_jsonb(old);
    n := to_jsonb(new);
    select coalesce(jsonb_object_agg(k, jsonb_build_array(o -> k, n -> k)), '{}'::jsonb)
      into detail
      from jsonb_object_keys(n) k
     where (o -> k) is distinct from (n -> k)
       and k not in ('updated_at', 'updated_by', 'last_synced_at', 'last_status')
       -- a repeat sign-in attempt is not an edit
       and not (tg_table_name = 'access_attempts' and k in ('last_at', 'attempts', 'name', 'avatar'));
    if detail = '{}'::jsonb then
      return null;
    end if;
    -- identify the row
    detail := jsonb_build_object('row', coalesce(n -> 'email', n -> 'id', n -> 'name', n -> 'version',
                                                 n -> 'hubspot_deal_id'),
                                 'changes', detail);
    if tg_table_name = 'issue_states' then
      detail := detail || jsonb_build_object('kind', n -> 'kind');
    end if;
  elsif tg_op = 'INSERT' then
    detail := to_jsonb(new);
  else
    detail := to_jsonb(old);
  end if;
  insert into audit_log (actor_email, action, detail)
  values (actor, tg_table_name || '.' || lower(tg_op), left(detail::text, 4000));
  return null;
end $$;

create trigger app_users_audit after insert or update or delete on app_users
  for each row execute function audit_row_change();
create trigger access_attempts_audit after update or delete on access_attempts
  for each row execute function audit_row_change();
create trigger targets_audit after insert or update or delete on targets
  for each row execute function audit_row_change();
create trigger rule_versions_audit after insert or update or delete on rule_versions
  for each row execute function audit_row_change();
create trigger issue_states_audit after insert or update or delete on issue_states
  for each row execute function audit_row_change();
create trigger payouts_audit after insert or update or delete on payouts
  for each row execute function audit_row_change();
create trigger finance_grants_audit after insert or update or delete on finance_grants
  for each row execute function audit_row_change();
create trigger settings_audit after insert or update or delete on settings
  for each row execute function audit_row_change();

-- ------------------------------------------------------------
-- Sign-in gate
-- ------------------------------------------------------------
-- Called by the app right after Google sign-in. Returns plain text:
--   'member'          active member: load the app
--   'disabled'        on the team but switched off
--   'no_access'       unknown: recorded in access_attempts
--   'denied:<reason>' management denied the request (reason may be empty)
create or replace function log_access_attempt(p_name text, p_avatar text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_email text := jwt_google_email();
  v_avatar text := nullif(trim(p_avatar), '');
  v_row access_attempts;
begin
  if v_email is null then
    -- Not a Google session (or no email): never a member, nothing to record.
    return 'no_access';
  end if;
  if exists (select 1 from app_users where email = v_email and active) then
    return 'member';
  end if;
  if exists (select 1 from app_users where email = v_email and not active) then
    return 'disabled';
  end if;
  -- Only a Google profile photo is kept: any other address would be a
  -- tracking pixel on the admin's Access page (Sales Hunter 031 §5).
  if v_avatar is not null and v_avatar !~ '^https://lh[0-9]+\.googleusercontent\.com/' then
    v_avatar := null;
  end if;
  insert into access_attempts as a (email, name, avatar, first_at, last_at, attempts, status)
  values (v_email, left(nullif(trim(p_name), ''), 200), left(v_avatar, 1000), now(), now(), 1, 'pending')
  on conflict (email) do update set
    name = coalesce(excluded.name, a.name),
    avatar = coalesce(excluded.avatar, a.avatar),
    last_at = now(),
    attempts = a.attempts + 1
  returning * into v_row;
  if v_row.status = 'denied' then
    return 'denied:' || coalesce(v_row.deny_reason, '');
  end if;
  return 'no_access';
end $$;

-- ------------------------------------------------------------
-- Leaderboard (reps cannot read each other's deals)
-- ------------------------------------------------------------
-- Every active rep, with what they counted in p_month: invoice net of
-- Closed Won deals they own, subscription lines only, minus the actions
-- excluded by the newest rule version; plus distinct stores. Same
-- counting rule as the contract's "A deal counts" section (without the
-- commission maths, which the app does).
create or replace function leaderboard(p_month text)
returns table (rep_email text, name text, closed numeric, stores integer)
language sql stable security definer set search_path = public as $$
  with cfg as (
    select coalesce(array(select lower(trim(x))
                          from jsonb_array_elements_text(coalesce(r.config -> 'exclusions', '[]'::jsonb)) x),
                    '{}'::text[]) as excl
    from rule_versions r
    order by r.version desc
    limit 1
  ),
  counted as (
    select coalesce(d.owner_email, i.rep_email) as who, i.store_id, i.net
    from invoices i
    join deals d on d.hubspot_deal_id = i.hubspot_deal_id
    where i.period = p_month
      and d.is_won
      and (coalesce(trim(i.purchase_gender), '') = '' or lower(trim(i.purchase_gender)) = 'subscriptions')
      and lower(trim(coalesce(i.action, ''))) <> all (coalesce((select c.excl from cfg c), '{}'::text[]))
  )
  select u.email, u.name, coalesce(sum(c.net), 0)::numeric, count(distinct c.store_id)::integer
  from app_users u
  left join counted c on c.who = u.email
  where u.active
    and u.role = 'rep'
    and (select is_member())
  group by u.email, u.name
  order by 3 desc, u.email;
$$;

-- ------------------------------------------------------------
-- Row-level security
-- ------------------------------------------------------------
alter table app_users enable row level security;
alter table access_attempts enable row level security;
alter table deals enable row level security;
alter table invoices enable row level security;
alter table targets enable row level security;
alter table rule_versions enable row level security;
alter table issue_states enable row level security;
alter table issue_comments enable row level security;
alter table payouts enable row level security;
alter table finance_grants enable row level security;
alter table audit_log enable row level security;
alter table sync_runs enable row level security;
alter table sync_state enable row level security;
alter table deal_merges enable row level security;
alter table settings enable row level security;

-- app_users: every member reads; admin and manager write, but a manager
-- can neither touch an admin's row nor make anyone an admin.
create policy app_users_read on app_users for select to authenticated
  using ((select is_member()));
create policy app_users_insert on app_users for insert to authenticated
  with check ((select is_role('admin')) or ((select is_role('manager')) and role <> 'admin'));
create policy app_users_update on app_users for update to authenticated
  using ((select is_role('admin')) or ((select is_role('manager')) and role <> 'admin'))
  with check ((select is_role('admin')) or ((select is_role('manager')) and role <> 'admin'));
create policy app_users_delete on app_users for delete to authenticated
  using ((select is_role('admin')) or ((select is_role('manager')) and role <> 'admin'));

-- access_attempts: written by log_access_attempt(); admin and manager
-- read and set status / deny_reason.
create policy access_attempts_read on access_attempts for select to authenticated
  using ((select is_role('admin', 'manager')));
create policy access_attempts_update on access_attempts for update to authenticated
  using ((select is_role('admin', 'manager')))
  with check ((select is_role('admin', 'manager')));
create policy access_attempts_delete on access_attempts for delete to authenticated
  using ((select is_role('admin', 'manager')));

-- deals: a rep sees their own; manager, finance, admin see all.
-- Written by sync-hubspot only (service role bypasses RLS).
create policy deals_read on deals for select to authenticated
  using ((select is_role('manager', 'finance', 'admin'))
         or owner_email = (select member_email()));

-- invoices: a rep sees lines carrying their email or on their deals.
create policy invoices_read on invoices for select to authenticated
  using ((select is_role('manager', 'finance', 'admin'))
         or rep_email = (select member_email())
         or hubspot_deal_id in (select d.hubspot_deal_id from deals d
                                where d.owner_email = (select member_email())));

-- targets: rep reads own; others read all; admin and manager write.
create policy targets_read on targets for select to authenticated
  using ((select is_role('manager', 'finance', 'admin'))
         or rep_email = (select member_email()));
create policy targets_insert on targets for insert to authenticated
  with check ((select is_role('admin', 'manager')));
create policy targets_update on targets for update to authenticated
  using ((select is_role('admin', 'manager')))
  with check ((select is_role('admin', 'manager')));
create policy targets_delete on targets for delete to authenticated
  using ((select is_role('admin', 'manager')));

-- rule_versions: every member reads; admin inserts a new version.
-- Versions are history: no update or delete.
create policy rule_versions_read on rule_versions for select to authenticated
  using ((select is_member()));
create policy rule_versions_insert on rule_versions for insert to authenticated
  with check ((select is_role('admin')));

-- issue_states: rep reads and writes their own deals' issues, with
-- status open or waiting only; admin and manager everything.
create policy issue_states_read on issue_states for select to authenticated
  using ((select is_role('manager', 'finance', 'admin'))
         or hubspot_deal_id in (select d.hubspot_deal_id from deals d
                                where d.owner_email = (select member_email())));
create policy issue_states_insert on issue_states for insert to authenticated
  with check ((select is_role('admin', 'manager'))
              or ((select is_role('rep'))
                  and status in ('open', 'waiting')
                  and hubspot_deal_id in (select d.hubspot_deal_id from deals d
                                          where d.owner_email = (select member_email()))));
create policy issue_states_update on issue_states for update to authenticated
  using ((select is_role('admin', 'manager'))
         or ((select is_role('rep'))
             and hubspot_deal_id in (select d.hubspot_deal_id from deals d
                                     where d.owner_email = (select member_email()))))
  with check ((select is_role('admin', 'manager'))
              or ((select is_role('rep'))
                  and status in ('open', 'waiting')
                  and hubspot_deal_id in (select d.hubspot_deal_id from deals d
                                          where d.owner_email = (select member_email()))));
create policy issue_states_delete on issue_states for delete to authenticated
  using ((select is_role('admin', 'manager')));

-- issue_comments: readable like issue_states; any member who can read
-- the deal adds one, always as themselves (author_email is stamped).
create policy issue_comments_read on issue_comments for select to authenticated
  using ((select is_role('manager', 'finance', 'admin'))
         or hubspot_deal_id in (select d.hubspot_deal_id from deals d
                                where d.owner_email = (select member_email())));
create policy issue_comments_insert on issue_comments for insert to authenticated
  with check (author_email = (select member_email())
              and ((select is_role('manager', 'finance', 'admin'))
                   or hubspot_deal_id in (select d.hubspot_deal_id from deals d
                                          where d.owner_email = (select member_email()))));
create policy issue_comments_delete on issue_comments for delete to authenticated
  using ((select is_role('admin')));

-- payouts: rep reads own; manager and admin read all; finance reads and
-- writes only months it holds an active grant for. Admin writes any
-- month. Nobody records or reverses a payout to themselves.
create policy payouts_read on payouts for select to authenticated
  using ((select is_role('manager', 'admin'))
         or rep_email = (select member_email())
         or month = any (coalesce((select finance_months()), '{}'::text[])));
create policy payouts_insert on payouts for insert to authenticated
  with check (rep_email is distinct from (select member_email())
              and ((select is_role('admin'))
                   or month = any (coalesce((select finance_months()), '{}'::text[]))));
create policy payouts_update on payouts for update to authenticated
  using ((select is_role('admin'))
         or month = any (coalesce((select finance_months()), '{}'::text[])))
  with check (rep_email is distinct from (select member_email())
              and ((select is_role('admin'))
                   or month = any (coalesce((select finance_months()), '{}'::text[]))));
create policy payouts_delete on payouts for delete to authenticated
  using ((select is_role('admin')));

-- finance_grants: finance reads its own; admin and manager everything.
create policy finance_grants_read on finance_grants for select to authenticated
  using ((select is_role('admin', 'manager'))
         or ((select is_role('finance')) and grantee_email = (select member_email())));
create policy finance_grants_insert on finance_grants for insert to authenticated
  with check ((select is_role('admin', 'manager')));
create policy finance_grants_update on finance_grants for update to authenticated
  using ((select is_role('admin', 'manager')))
  with check ((select is_role('admin', 'manager')));
create policy finance_grants_delete on finance_grants for delete to authenticated
  using ((select is_role('admin', 'manager')));

-- audit_log: admin and manager read; written by audit() and triggers.
create policy audit_log_read on audit_log for select to authenticated
  using ((select is_role('admin', 'manager')));

-- sync_runs: admin and manager read; written by the sync functions.
create policy sync_runs_read on sync_runs for select to authenticated
  using ((select is_role('admin', 'manager')));

-- sync_state: backend bookkeeping; admin may look.
create policy sync_state_read on sync_state for select to authenticated
  using ((select is_role('admin')));

-- deal_merges: no policies (service role only).

-- settings: every member reads; admin writes; the syncs write too.
create policy settings_read on settings for select to authenticated
  using ((select is_member()));
create policy settings_insert on settings for insert to authenticated
  with check ((select is_role('admin')));
create policy settings_update on settings for update to authenticated
  using ((select is_role('admin')))
  with check ((select is_role('admin')));

-- ------------------------------------------------------------
-- Table privileges (defence in depth on top of RLS)
-- ------------------------------------------------------------
-- The public (anon) key reaches nothing. Sync-owned and log tables take
-- no client writes even if a policy were added by mistake later.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke insert, update, delete, truncate on deals, invoices, sync_runs, sync_state, audit_log from authenticated;
revoke all on deal_merges from authenticated;
revoke insert, truncate on access_attempts from authenticated;
revoke update, delete, truncate on rule_versions from authenticated;
revoke update, truncate on issue_comments from authenticated;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- ------------------------------------------------------------
-- Function privileges
-- ------------------------------------------------------------
-- Supabase grants EXECUTE on every new function to anon (and PUBLIC);
-- take that away everywhere and grant back only what the app calls
-- (Sales Hunter 031 §2).
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
  end loop;
end $$;
alter default privileges in schema public revoke execute on functions from public, anon;

-- Helpers used inside policies and triggers (called with the caller's
-- rights, so the roles that write tables need them).
grant execute on function jwt_google_email() to authenticated, service_role;
grant execute on function current_member() to authenticated, service_role;
grant execute on function member_email() to authenticated, service_role;
grant execute on function is_member() to authenticated, service_role;
grant execute on function is_role(text[]) to authenticated, service_role;
grant execute on function finance_months() to authenticated, service_role;
-- RPCs
grant execute on function log_access_attempt(text, text) to authenticated;
grant execute on function leaderboard(text) to authenticated;
grant execute on function audit(text, text) to authenticated;
-- Trigger functions are never called directly.
revoke all on function normalize_emails() from authenticated;
revoke all on function stamp_actor() from authenticated;
revoke all on function rule_versions_saved_at() from authenticated;
revoke all on function issue_states_rep_guard() from authenticated;
revoke all on function audit_row_change() from authenticated;

-- ------------------------------------------------------------
-- First admin (run by hand once, in the SQL editor — see docs/SUPABASE.md)
-- ------------------------------------------------------------
-- No real address is seeded here. Example:
--
-- insert into app_users (email, name, role, title, created_by)
-- values ('first.last@zid.sa', 'First Last', 'admin', 'Sales Operations', 'setup');
