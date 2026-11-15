-- ============================================================
-- Sales Ops Portal — 006 email aliases
--
-- One person can have more than one Zid address (a Google Workspace
-- alias). Google signs them in under whichever address is primary, so a
-- member is matched on app_users.email OR any address in email_aliases.
-- a.ghanem@zid.sa and mlk@zid.sa are the same person: one row, with
-- mlk@zid.sa as an alias.
-- ============================================================

alter table app_users add column if not exists email_aliases text[] not null default '{}';

-- Aliases are stored lowercase and trimmed, like every other email.
create or replace function normalize_aliases()
returns trigger language plpgsql set search_path = public as $$
begin
  new.email_aliases := coalesce(array(
    select distinct lower(trim(x)) from unnest(new.email_aliases) x
     where nullif(trim(x), '') is not null and lower(trim(x)) <> new.email), '{}');
  return new;
end $$;
revoke all on function normalize_aliases() from public, anon, authenticated;
drop trigger if exists app_users_aliases on app_users;
create trigger app_users_aliases before insert or update on app_users
  for each row execute function normalize_aliases();

create or replace function current_member()
returns setof app_users
language sql stable security definer set search_path = public rows 1 as $$
  select u.*
  from app_users u
  where u.active
    and (u.email = jwt_google_email() or jwt_google_email() = any (u.email_aliases))
  limit 1;
$$;

create or replace function log_access_attempt(p_name text, p_avatar text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_email text := jwt_google_email();
  v_avatar text := nullif(trim(p_avatar), '');
  v_google_name text := nullif(trim(coalesce(auth.jwt() -> 'user_metadata' ->> 'full_name',
                                              auth.jwt() -> 'user_metadata' ->> 'name')), '');
  v_row access_attempts;
begin
  if v_email is null then
    return 'no_access';
  end if;
  if exists (select 1 from app_users where active and (email = v_email or v_email = any (email_aliases))) then
    if v_google_name is not null then
      update app_users set name = left(v_google_name, 200)
       where (email = v_email or v_email = any (email_aliases)) and name is distinct from left(v_google_name, 200);
    end if;
    return 'member';
  end if;
  if exists (select 1 from app_users where not active and (email = v_email or v_email = any (email_aliases))) then
    return 'disabled';
  end if;
  if v_avatar is not null and v_avatar !~ '^https://lh[0-9]+\.googleusercontent\.com/' then
    v_avatar := null;
  end if;
  insert into access_attempts as a (email, name, avatar, first_at, last_at, attempts, status)
  values (v_email, left(coalesce(v_google_name, nullif(trim(p_name), '')), 200), left(v_avatar, 1000), now(), now(), 1, 'pending')
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
revoke all on function log_access_attempt(text, text) from public, anon;
grant execute on function log_access_attempt(text, text) to authenticated;
grant execute on function current_member() to authenticated, service_role;

-- One person, two addresses.
update app_users set email_aliases = array['mlk@zid.sa'] where email = 'a.ghanem@zid.sa';
delete from app_users where email = 'mlk@zid.sa';
