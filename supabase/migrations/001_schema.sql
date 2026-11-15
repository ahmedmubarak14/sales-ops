-- ============================================================
-- Sales Ops Portal — 001 schema
--
-- Every table, column and index named in docs/DATA_CONTRACT.md, plus
-- the sync bookkeeping the edge functions need (sync_state,
-- deal_merges; see the contract's "Backend-only additions").
-- Row-level security, roles and RPCs are in 002; integrations in 003;
-- the Top Zid Stores showcase in 004.
--
-- Run the migrations in order in the SQL editor (or `supabase db push`).
-- Patterns follow Sales Hunter (sibling app), migrations 001–052.
-- ============================================================

create extension if not exists pgcrypto with schema extensions;

-- ------------------------------------------------------------
-- Email normalisation
-- ------------------------------------------------------------
-- All emails are stored lowercase and trimmed (contract). A BEFORE
-- trigger normalises whatever the client sends (so an upsert on
-- on_conflict=email with "Name@Zid.sa" still hits the existing row:
-- BEFORE INSERT triggers run before the conflict check), and a check
-- constraint on the identity columns is the backstop.
--
-- normalize_emails(col1, col2, ...) — trigger arguments name the
-- columns to normalise. Blank becomes null.
create or replace function normalize_emails()
returns trigger language plpgsql set search_path = public as $$
declare
  col text;
  patch jsonb := '{}'::jsonb;
  v text;
begin
  foreach col in array tg_argv loop
    v := to_jsonb(new) ->> col;
    if v is not null then
      patch := patch || jsonb_build_object(col, nullif(lower(trim(v)), ''));
    end if;
  end loop;
  if patch <> '{}'::jsonb then
    new := jsonb_populate_record(new, patch);
  end if;
  return new;
end $$;

-- ------------------------------------------------------------
-- Members (allowlist)
-- ------------------------------------------------------------
create table app_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(trim(email)) and email <> ''),
  name text,
  role text not null default 'rep' check (role in ('rep', 'manager', 'finance', 'admin')),
  active boolean not null default true,
  hubspot_owner_id text,
  plan text,
  title text,
  created_at timestamptz not null default now(),
  created_by text
);
create index app_users_owner_idx on app_users (hubspot_owner_id);
create trigger app_users_emails before insert or update on app_users
  for each row execute function normalize_emails('email', 'created_by');

-- Everyone who signed in with Google but is not an active member.
create table access_attempts (
  email text primary key check (email = lower(trim(email)) and email <> ''),
  name text,
  avatar text,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  attempts integer not null default 1,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  deny_reason text
);
create index access_attempts_last_idx on access_attempts (last_at desc);
create trigger access_attempts_emails before insert or update on access_attempts
  for each row execute function normalize_emails('email');

-- ------------------------------------------------------------
-- HubSpot mirror (sync-hubspot writes, service role only)
-- ------------------------------------------------------------
create table deals (
  hubspot_deal_id text primary key,
  deal_name text,
  store_id text,
  owner_id text,
  owner_email text,
  owner_name text,
  pipeline text,
  stage text,
  stage_label text,
  is_won boolean not null default false,
  is_closed boolean not null default false,
  amount numeric,                 -- HubSpot, excl. VAT
  close_date timestamptz,
  created_at_hs timestamptz,
  deal_type text,
  category text,
  updated_at_hs timestamptz,
  synced_at timestamptz not null default now()
);
create index deals_owner_email_idx on deals (owner_email);
create index deals_owner_id_idx on deals (owner_id);
create index deals_close_date_idx on deals (close_date);
create index deals_won_idx on deals (is_won) where is_won;
create index deals_store_idx on deals (store_id);
create trigger deals_emails before insert or update on deals
  for each row execute function normalize_emails('owner_email');

-- ------------------------------------------------------------
-- Metabase invoice lines (sync-metabase writes, service role only)
-- ------------------------------------------------------------
create table invoices (
  item_id text primary key,       -- Purchase Item ID
  hubspot_deal_id text,
  store_id text,
  invoice_number text,
  purchase_date date,
  period text check (period is null or period ~ '^\d{4}-\d{2}$'),  -- YYYY-MM
  purchasable_name text,
  action text,                    -- Metabase "Actiono": First Subscription, Renewal, ...
  purchase_gender text,           -- subscriptions, themes, ...
  net numeric,                    -- VAT excluded
  gross numeric,                  -- amount paid
  rep_email text,
  synced_at timestamptz not null default now()
);
create index invoices_deal_idx on invoices (hubspot_deal_id);
create index invoices_rep_idx on invoices (rep_email);
create index invoices_period_idx on invoices (period);
create index invoices_synced_idx on invoices (synced_at);
create trigger invoices_emails before insert or update on invoices
  for each row execute function normalize_emails('rep_email');

-- ------------------------------------------------------------
-- Targets, rules, issues, payouts
-- ------------------------------------------------------------
create table targets (
  id bigserial primary key,
  rep_email text not null,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  plan text,
  target numeric,
  store_exception boolean not null default false,
  sector_met boolean not null default false,
  updated_by text,
  updated_at timestamptz not null default now(),
  unique (rep_email, month)
);
create index targets_month_idx on targets (month);
create trigger targets_emails before insert or update on targets
  for each row execute function normalize_emails('rep_email', 'updated_by');

create table rule_versions (
  version integer primary key check (version > 0),
  config jsonb not null,
  saved_by text,
  saved_at timestamptz not null default now()
);
create trigger rule_versions_emails before insert or update on rule_versions
  for each row execute function normalize_emails('saved_by');

create table issue_states (
  hubspot_deal_id text not null,
  kind text not null,
  status text not null default 'open' check (status in ('open', 'waiting', 'resolved', 'dismissed')),
  assignee text,
  note text,
  decision text,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (hubspot_deal_id, kind)
);
create index issue_states_status_idx on issue_states (status);
create trigger issue_states_emails before insert or update on issue_states
  for each row execute function normalize_emails('assignee', 'updated_by');

create table issue_comments (
  id bigserial primary key,
  hubspot_deal_id text not null,
  kind text not null,
  author_email text,
  body text not null check (length(body) between 1 and 5000),
  created_at timestamptz not null default now()
);
create index issue_comments_issue_idx on issue_comments (hubspot_deal_id, kind, created_at);
create trigger issue_comments_emails before insert or update on issue_comments
  for each row execute function normalize_emails('author_email');

create table payouts (
  id bigserial primary key,
  rep_email text not null,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  amount numeric not null,
  paid_on date,
  pay_ref text,
  paid_by text,
  reversed_at timestamptz,
  created_at timestamptz not null default now()
);
create index payouts_rep_idx on payouts (rep_email);
create index payouts_month_idx on payouts (month);
create trigger payouts_emails before insert or update on payouts
  for each row execute function normalize_emails('rep_email', 'paid_by');

create table finance_grants (
  id bigserial primary key,
  grantee_email text not null,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  ends_on date,
  active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now()
);
create index finance_grants_grantee_idx on finance_grants (grantee_email, month) where active;
create trigger finance_grants_emails before insert or update on finance_grants
  for each row execute function normalize_emails('grantee_email', 'created_by');

-- ------------------------------------------------------------
-- Audit, sync bookkeeping, settings
-- ------------------------------------------------------------
create table audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor_email text,
  action text not null,
  detail text
);
create index audit_log_at_idx on audit_log (at desc);
create trigger audit_log_emails before insert or update on audit_log
  for each row execute function normalize_emails('actor_email');

-- One row per sync part per run. source values:
--   'hubspot', 'metabase_invoices', 'metabase_top_stores'
create table sync_runs (
  id bigserial primary key,
  at timestamptz not null default now(),
  source text not null,
  status text not null check (status in ('ok', 'error')),
  rows integer,
  note text
);
create index sync_runs_source_at_idx on sync_runs (source, at desc);

-- Backend-only (not read by the frontend): incremental bookmarks.
-- sync-hubspot keeps its hs_lastmodifieddate bookmark here under
-- source 'hubspot'. scope is a fingerprint of the settings the bookmark
-- was taken under (pipelines + property names): when an admin changes
-- them, the sync starts over from the beginning instead of only seeing
-- deals modified from then on.
create table sync_state (
  source text primary key,
  bookmark text,
  scope text,
  last_run_at timestamptz,
  last_status text,
  last_error text
);

-- Backend-only: HubSpot merged-deal resolution cache for sync-metabase.
-- The warehouse keeps reporting invoices under a deal id that a merge in
-- HubSpot removed; a GET by the old id returns the surviving deal. The
-- answer (canonical_id = old_id when it was not merged) is kept so the
-- same ids are not asked again on every run; non-merged answers are
-- re-checked after 7 days.
create table deal_merges (
  old_id text primary key,
  canonical_id text not null,
  checked_at timestamptz not null default now()
);

create table settings (
  key text primary key,
  value text
);
insert into settings (key, value) values
  ('hubspot_portal_id', null),
  ('hubspot_ui_domain', 'app.hubspot.com')
on conflict (key) do nothing;

-- ------------------------------------------------------------
-- Default commission rules (version 1)
-- ------------------------------------------------------------
insert into rule_versions (version, config, saved_by) values (1, $json$
{
  "plans": [
    {"id": "standard", "name": "Standard", "target": 100000},
    {"id": "senior", "name": "Senior", "target": 150000, "sector_bonus_pct": 1},
    {"id": "lead", "name": "Team lead", "target": 200000}
  ],
  "tiers": [
    {"from": 0, "rate": 0},
    {"from": 50, "rate": 3},
    {"from": 80, "rate": 5},
    {"from": 100, "rate": 7},
    {"from": 130, "rate": 9}
  ],
  "accelerator": {"above_pct": 150, "block_sar": 10000, "per_block": 3000},
  "min_stores": 15,
  "tolerance_pct": 5,
  "cutoff_day": 3,
  "exclusions": ["Renewal", "Themes", "Apps"],
  "rule_text": [
    "A deal counts in the month of its invoice, once it is Closed Won in HubSpot and you are its owner.",
    "Only subscription invoices count (not renewals, themes or apps), at the amount before VAT that Metabase records.",
    "Your rate is set by how much of your monthly target you reach: 3% from 50%, 5% from 80%, 7% from 100% and 9% from 130%, applied to everything you counted.",
    "Above 150% of target you also earn 3,000 SAR for every full 10,000 SAR counted beyond that point.",
    "On the Senior plan you earn an extra 1% of your counted amount in a month when the sector target is met.",
    "Commission is held until you have at least 15 different counted stores in the month, unless management grants a store exception."
  ]
}
$json$::jsonb, 'system')
on conflict (version) do nothing;
