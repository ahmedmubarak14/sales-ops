-- ============================================================
-- Sales Ops Portal — 005 the real sales plan, and names from Google
--
-- 1. app_users.start_date: the month a new employee joined (their
--    first-month target is 15,000, then 30,000, then 50,000 SAR).
--    app_users.sector: the sector a senior / sector lead owns (their
--    commission needs at least 5 stores from it).
-- 2. Rule version 2: the plan management shared on 15 Nov 2026
--    (New employee / Junior / Senior, targets incl. VAT, 15 stores).
-- 3. Names come from each person's Google account: on every sign-in,
--    log_access_attempt copies the Google profile name (from the JWT the
--    Google sign-in issued, never from what the browser sends).
-- ============================================================

alter table app_users add column if not exists start_date date;
alter table app_users add column if not exists sector text;

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
  if exists (select 1 from app_users where email = v_email and active) then
    -- The name people see is the one on their Google account.
    if v_google_name is not null then
      update app_users set name = left(v_google_name, 200)
       where email = v_email and name is distinct from left(v_google_name, 200);
    end if;
    return 'member';
  end if;
  if exists (select 1 from app_users where email = v_email and not active) then
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

-- Anyone who has already signed in gets their Google name now.
update app_users a set name = left(trim(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name')), 200)
  from auth.users u
 where lower(u.email) = a.email
   and nullif(trim(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name')), '') is not null;

insert into rule_versions (version, config, saved_by) values (2, $json$
{
  "vat_pct": 15,
  "target_includes_vat": true,
  "plans": [
    {"id": "probation", "name": "New employee", "name_ar": "موظف جديد", "probation_targets": [15000, 30000, 50000],
     "tiers": [{"from": 0, "rate": 0}], "min_stores": 0},
    {"id": "junior", "name": "Junior", "name_ar": "جونيور", "target": 70000,
     "tiers": [{"from": 0, "rate": 0}, {"from": 70, "rate": 5}, {"from": 100, "rate": 10}]},
    {"id": "senior", "name": "Senior / sector lead", "name_ar": "سينيور / مسؤول قطاع", "target": 70000,
     "tiers": [{"from": 0, "rate": 0}, {"from": 70, "rate": 7}], "sector_min_stores": 5}
  ],
  "min_stores": 15,
  "tolerance_pct": 5,
  "cutoff_day": 3,
  "exclusions": ["Renewal", "Themes", "Apps"],
  "rule_text": [
    "Monthly target: SAR 70,000 including VAT. Commission is paid on net sales (excluding VAT).",
    "Junior: 5% of net sales from 70% of target, 10% from 100% of target.",
    "Senior and sector leads: 7% of net sales from 70% of target, with at least 5 stores from your sector; no commission without them.",
    "New employees: SAR 15,000 in the first month, 30,000 in the second and 50,000 in the third. Missing them means no renewal or confirmation.",
    "Minimum of 15 stores a month. Below it, commission is not paid even when the target is met, unless management grants an exception.",
    "A deal counts when it is Closed Won in HubSpot and paid in Metabase, in the month of its invoice."
  ],
  "rule_text_ar": [
    "الهدف الشهري: 70,000 ريال شامل الضريبة. تُحتسب العمولة على صافي المبيعات (بدون الضريبة).",
    "جونيور: 5% من صافي المبيعات عند تحقيق 70% من المستهدف، و10% عند تحقيق 100%.",
    "سينيور ومسؤولو القطاعات: 7% من صافي المبيعات عند تحقيق 70% من المستهدف، مع 5 متاجر على الأقل من القطاع، ولا عمولة بدونها.",
    "الموظفون الجدد: 15,000 ريال في الشهر الأول، و30,000 في الثاني، و50,000 في الثالث. عدم تحقيقها يعني عدم التجديد أو التثبيت.",
    "الحد الأدنى 15 متجرًا شهريًا. دونه لا تُستحق العمولة حتى مع تحقيق المستهدف المالي، إلا باستثناء خاص.",
    "تُحتسب الصفقة عندما تكون مغلقة بنجاح في HubSpot ومدفوعة في Metabase، في شهر فاتورتها."
  ]
}
$json$::jsonb, 'setup')
on conflict (version) do nothing;

-- Plans: everyone starts as Junior; the two employees in their third
-- month (Nov 2026) joined in September 2026.
update app_users set plan = 'junior' where role = 'rep' and (plan is null or plan in ('standard', 'lead'));
update app_users set plan = 'probation', start_date = date '2026-09-01'
 where email in ('mohammed.alkhumiri@zid.sa', 'maram.alamri@zid.sa');
