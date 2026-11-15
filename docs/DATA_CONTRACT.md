# Sales Ops Portal: data contract

The frontend (`api.js`) and the database (`supabase/migrations/`) agree on
exactly these tables, columns and functions. Change both together.

Roles: `rep`, `manager`, `finance`, `admin` (Sales Ops). Access is an
allowlist: only an **active row in `app_users`** whose email equals the
Google sign-in email gets in. Everyone else is recorded in
`access_attempts` and sees "No access. Contact the sales management for
access." All emails are stored lowercase and trimmed.

## Tables

| Table | Columns | Who reads | Who writes |
|---|---|---|---|
| `app_users` | `id uuid pk`, `email text unique`, `name text`, `role text` (rep/manager/finance/admin), `active bool`, `hubspot_owner_id text`, `plan text`, `title text`, `created_at`, `created_by text` | every member | admin, manager (managers may not create or edit admins) |
| `access_attempts` | `email text pk`, `name text`, `avatar text`, `first_at`, `last_at`, `attempts int`, `status text` (pending/approved/denied), `deny_reason text` | admin, manager | the `log_access_attempt()` RPC; admin/manager update status |
| `deals` | `hubspot_deal_id text pk`, `deal_name`, `store_id`, `owner_id`, `owner_email`, `owner_name`, `pipeline`, `stage`, `stage_label`, `is_won bool`, `is_closed bool`, `amount numeric` (HubSpot, excl. VAT), `close_date timestamptz`, `created_at_hs timestamptz`, `deal_type text`, `category text`, `updated_at_hs`, `synced_at` | rep: own (`owner_email` = me); others: all | sync only (service role) |
| `invoices` | `item_id text pk`, `hubspot_deal_id`, `store_id`, `invoice_number`, `purchase_date date`, `period text` (YYYY-MM), `purchasable_name`, `action`, `purchase_gender`, `net numeric`, `gross numeric`, `rep_email`, `synced_at` | rep: own (rep_email = me or deal is theirs); others: all | sync only |
| `targets` | `id bigserial`, `rep_email`, `month text` (YYYY-MM), `plan text`, `target numeric`, `store_exception bool`, `sector_met bool`, `updated_by`, `updated_at`; unique (`rep_email`,`month`) | rep: own; others: all | admin, manager |
| `rule_versions` | `version int pk`, `config jsonb`, `saved_by`, `saved_at` | every member | admin |
| `issue_states` | `hubspot_deal_id text`, `kind text`, `status text` (open/waiting/resolved/dismissed), `assignee text`, `note text`, `decision text`, `updated_by`, `updated_at`; pk (`hubspot_deal_id`,`kind`) | rep: own deals; others: all | rep: own deals (status open/waiting only); admin, manager: all |
| `issue_comments` | `id bigserial`, `hubspot_deal_id`, `kind`, `author_email`, `body`, `created_at` | same as issue_states | any member who can read the deal |
| `payouts` | `id bigserial`, `rep_email`, `month`, `amount numeric`, `paid_on date`, `pay_ref`, `paid_by`, `reversed_at timestamptz`, `created_at` | rep: own; manager, admin: all; finance: months with an active grant | finance with an active grant for that month; admin |
| `finance_grants` | `id bigserial`, `grantee_email`, `month`, `ends_on date`, `active bool`, `created_by`, `created_at` | finance: own; manager, admin: all | admin, manager |
| `audit_log` | `id bigserial`, `at`, `actor_email`, `action`, `detail` | admin, manager | the `audit()` RPC and triggers |
| `integration_config` | `name text pk` (hubspot/metabase/metabase_ssh), `settings jsonb`, `secret_set bool`, `last_synced_at`, `last_status` | admin | admin (settings), `set_integration_secret()` |
| `integration_secrets` | `name pk`, `secret bytea` (pgp_sym_encrypt, key in Vault) | nobody | `set_integration_secret()` only |
| `sync_runs` | `id bigserial`, `at`, `source`, `status` (ok/error), `rows int`, `note` | admin, manager | sync functions |
| `store_showcase` | `store_id text pk`, `name`, `category`, `orders_count`, `orders_total_sar`, `rank_in_category int`, `store_url`, `synced_at` | admin only | sync-metabase |
| `store_showcase_lite` (view, security_invoker off) | `store_id`, `name`, `category`, `rank_in_category`, `store_url` | every active member | n/a |
| `settings` | `key text pk`, `value text` (hubspot_portal_id, hubspot_ui_domain) | every member | sync, admin |

## Functions (PostgREST RPC)

- `current_member()` → the caller's `app_users` row, or nothing. Matches
  `auth.jwt()->>'email'` lowercased; requires the session to come from
  Google (`auth.jwt()->'app_metadata'->>'provider' = 'google'`).
- `log_access_attempt(p_name text, p_avatar text)` → `text`: `'member'`
  if the caller is an active member, `'disabled'` if they exist but are
  inactive, else upserts `access_attempts` and returns `'no_access'`
  (or `'denied'` with the reason when management denied them).
- `leaderboard(p_month text)` → rows `(rep_email, name, closed numeric,
  stores int)` for every active rep: closed-won invoiced net in that
  month and distinct stores. Lets reps see the leaderboard without
  reading other reps' deals.
- `audit(p_action text, p_detail text)` → inserts into `audit_log` as the caller.
- `set_integration_secret(p_name text, p_secret text)` → admin only.
- `request_sync(p_source text)` → admin/manager: calls the sync function now
  (pg_net), returns the request id.

## Rule config (`rule_versions.config`)

```json
{
  "plans": [{"id": "standard", "name": "Standard", "target": 100000},
            {"id": "senior", "name": "Senior", "target": 150000, "sector_bonus_pct": 1},
            {"id": "lead", "name": "Team lead", "target": 200000}],
  "tiers": [{"from": 0, "rate": 0}, {"from": 50, "rate": 3}, {"from": 80, "rate": 5},
            {"from": 100, "rate": 7}, {"from": 130, "rate": 9}],
  "accelerator": {"above_pct": 150, "block_sar": 10000, "per_block": 3000},
  "min_stores": 15,
  "tolerance_pct": 5,
  "cutoff_day": 3,
  "exclusions": ["Renewal", "Themes", "Apps"],
  "rule_text": ["...six plain-language rules shown to reps..."]
}
```

Commission for a rep in a month = counted SAR × the rate of the tier their
achievement (counted ÷ target) reaches, plus `per_block` for every full
`block_sar` above `above_pct` of target, plus the plan's
`sector_bonus_pct` of counted SAR when `sector_met`. It is **held** while
the rep has fewer than `min_stores` distinct counted stores and no
`store_exception` for that month.

A deal **counts** in the month of its invoice when it is Closed Won in
HubSpot, has a Metabase invoice line that is a subscription and not of an
excluded action, and is owned by the rep. Its counted amount is the
invoice net (Metabase is the source of truth for money).

## Backend notes and additions (from `supabase/migrations/`)

Nothing above was renamed. These are details the frontend can rely on,
and the backend-only additions.

**RPC return shapes**

- `current_member()` returns `setof app_users`: zero rows or one (the
  caller's **active** row; inactive members get nothing). Via supabase-js
  `rpc('current_member')` gives an array; `.maybeSingle()` gives the row
  or `null`.
- `log_access_attempt(p_name, p_avatar)` returns plain text, exactly one
  of `'member'`, `'disabled'`, `'no_access'`, `'denied:<reason>'` (no
  space after the colon; the reason may be empty, i.e. `'denied:'`). A
  session that did not come from Google always gets `'no_access'` and is
  not recorded. Only a Google photo URL (`https://lhN.googleusercontent.com/...`)
  is kept as `avatar`.
- `leaderboard(p_month)` returns every active `rep` (zero rows included),
  ordered by `closed` descending. "Counted" here = invoice `net` of lines
  whose deal `is_won`, attributed to the deal's `owner_email` (else the
  line's `rep_email`), `purchase_gender` empty or `subscriptions`, and
  `action` not in the newest rule version's `exclusions`
  (case-insensitive). Callable by any member.
- `request_sync(p_source)`: `p_source` is `'hubspot'` or `'metabase'`. At
  most one manual run per source per minute (raises otherwise).
- `set_integration_secret(p_name, p_secret)`: an empty `p_secret`
  removes the stored secret. Sets `secret_set` and
  `settings.secret_hint` (last 4 characters; not for `metabase_ssh`).

**Server-set columns** (the client never sends them; values sent are overwritten)

- `updated_by` + `updated_at` on `targets` and `issue_states` (every write).
- `created_by` on `app_users` and `finance_grants`, `author_email` on
  `issue_comments`, `paid_by` on `payouts`, `saved_by` + `saved_at` on
  `rule_versions` (insert only; kept on update).
- All email columns are lowercased and trimmed by triggers, so
  `on_conflict=email` / `on_conflict=rep_email,month` upserts match
  whatever case the client sends.

**Write rules the policies enforce beyond the table above**

- `issue_states`: a rep's `decision` is ignored (kept as stored; null on
  insert), so the frontend may upsert the whole row. Status must be
  `open`/`waiting` for a rep. Upsert `on_conflict=hubspot_deal_id,kind`.
- `issue_comments`: insert only (admin may delete).
- `rule_versions`: INSERT `{version, config}` only; versions are
  immutable (no update/delete).
- `payouts`: nobody records or edits a payout to their own email.
  Finance writes only months it holds an active grant for (`active` and
  `ends_on` null or not past). Admin may delete; everyone else reverses
  with `reversed_at`.
- `app_users`: a manager's insert/update/delete on a row whose role is
  `admin`, or that would make someone `admin`, is refused (an update of
  an admin row simply matches 0 rows). Upsert `on_conflict=email`.
- `access_attempts`: admin/manager PATCH `status`, `deny_reason` (and may delete).
- `integration_config`: rows `hubspot`, `metabase`, `metabase_ssh`
  exist from the start; admins may only PATCH `settings`
  (`secret_set`, `last_synced_at`, `last_status` are server-owned).
  Changing `metabase.settings.base_url` deletes the Metabase key.
  Changing `metabase_ssh` `host`/`port`/`username`/`target_url` deletes
  the SSH key **and** the Metabase key and clears `host_fingerprint`.
- `settings`: every member reads; admin writes.
- `store_showcase`: admin only; everyone else reads `store_showcase_lite`.

**`integration_config.settings` keys**

- `hubspot`: `pipelines` (array of pipeline ids, required),
  `amount_prop` (default `amount_without_vat`, falls back to `amount`),
  `close_date_prop` (default `closedate`), `category_prop`,
  `deal_type_prop`, `store_id_prop`. Changing any of them makes the next
  sync start over from the first deal.
- `metabase`: `base_url`, `card_invoices` (saved card id).
- `metabase_ssh`: `enabled`, `host`, `port`, `username`, `target_url`,
  `host_fingerprint` (saved on first connect).
- `last_status` is `'ok'`, `'skipped: <why>'`, `'error: <message>'`, or
  for Metabase `'partial: <part>: <message>'` when one of its two parts
  failed.

**`sync_runs.source` values**: `hubspot`, `metabase_invoices`,
`metabase_top_stores` (one row per part per run; the two Metabase parts
run independently).

**Backend-only tables** (no client access except as noted)

| Table | Columns | Purpose |
|---|---|---|
| `sync_state` | `source text pk`, `bookmark text`, `scope text`, `last_run_at`, `last_status`, `last_error` | sync-hubspot's `hs_lastmodifieddate` bookmark (`source = 'hubspot'`); `scope` fingerprints the settings it was taken under. Admin may read. |
| `deal_merges` | `old_id text pk`, `canonical_id text`, `checked_at` | sync-metabase's cache of HubSpot merged-deal lookups. Service role only. |
