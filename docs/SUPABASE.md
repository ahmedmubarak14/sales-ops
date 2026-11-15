# Supabase setup: Sales Ops Portal

Step by step, for a **new** Supabase project. Steps 1–6 need no HubSpot
or Metabase credentials; those go in at step 8, from the app.

What is where:

| Path | What |
|---|---|
| `supabase/migrations/001_schema.sql` | tables, indexes, email normalisation, default rules (version 1) |
| `supabase/migrations/002_auth_and_rls.sql` | `current_member()`, role helpers, row-level security, `log_access_attempt`, `leaderboard`, `audit`, audit triggers |
| `supabase/migrations/003_integrations.sql` | `integration_config` / `integration_secrets`, Vault keys, `set_integration_secret`, `request_sync`, pg_cron schedules |
| `supabase/migrations/004_showcase.sql` | `store_showcase` + `store_showcase_lite` (Top Zid Stores) |
| `supabase/functions/sync-hubspot` | deals from HubSpot, every 5 minutes |
| `supabase/functions/sync-metabase` | invoice lines + top stores from Metabase, every 30 minutes |
| `supabase/functions/_shared/ssh-fetch.ts` | optional SSH tunnel to Metabase (same as Sales Hunter) |
| `docs/DATA_CONTRACT.md` | the tables, columns and RPCs the frontend uses |

## 1. Create the project

1. supabase.com → **New project**. Name `sales-ops`, region
   **Frankfurt (eu-central-1)** (same as Sales Hunter). Save the
   database password.
2. Settings → API: note the **Project URL** (`https://<ref>.supabase.co`)
   and the **publishable (anon) key**. Both go in the frontend's
   `config.js`. The `service_role` / secret key never leaves Supabase.

## 2. Run the migrations, in order

SQL Editor → New query → paste each file whole → Run:

1. `001_schema.sql`
2. `002_auth_and_rls.sql`
3. `003_integrations.sql`
4. `004_showcase.sql`

(or `npx supabase link --project-ref <ref>` then `npx supabase db push`).

003 enables `pg_cron` and `pg_net` itself. If your project refuses
`create extension`, enable both under Database → Extensions first and
run 003 again.

## 3. Vault secrets

003 creates two secrets on its own, with random values. Nothing to do
for them, but know their names:

| Vault secret | Created by | Used for |
|---|---|---|
| `integration_key` | 003 (random) | encrypts `integration_secrets` (HubSpot token, Metabase key, SSH key) |
| `sync_secret` | 003 (random) | the `x-sync-secret` header the scheduler sends; the functions refuse any call without it |
| `project_url` | **you** | where the scheduler and `request_sync()` send their calls |
| `anon_key` | you, optional | only if the functions are deployed *with* JWT verification (not recommended, see step 6) |

Create `project_url` now (SQL editor):

```sql
select vault.create_secret('https://<ref>.supabase.co', 'project_url', 'Base URL for scheduled sync calls');
```

Until it exists, every scheduled run fails with "Vault secret
project_url is not set" (visible in `cron.job_run_details`).

Rotating the sync secret (nothing else needs to change; the functions
check against Vault):

```sql
select vault.update_secret(id, encode(extensions.gen_random_bytes(32), 'hex'))
from vault.secrets where name = 'sync_secret';
```

Do not rotate `integration_key` without re-entering every integration
secret afterwards: the stored ones would no longer decrypt.

## 4. Google sign-in, restricted to Zid

Access is an allowlist (`app_users`), and only a Google session counts
(`current_member()` checks `app_metadata.provider = 'google'`). There
is no sign-up trigger: signing in never creates a member.

**Google Cloud console** (a project in the zid.sa organisation):

1. APIs & Services → **OAuth consent screen**: User type **Internal**.
   Internal limits sign-in to accounts in the zid.sa Google Workspace,
   which is the first gate (the allowlist is the second).
2. APIs & Services → **Credentials** → Create credentials → **OAuth
   client ID** → *Web application*.
   - Authorised JavaScript origins: the app's address, e.g.
     `https://sales-ops.<domain>`.
   - Authorised redirect URIs: `https://<ref>.supabase.co/auth/v1/callback`
     (exactly the callback Supabase shows on its Google provider page).
3. Copy the client ID and client secret.

**Supabase** → Authentication:

1. **Sign In / Providers → Google**: enable, paste the client ID and
   secret, save.
2. **Sign In / Providers → Email**: turn **off** "Allow new users to sign
   up" (and Email provider entirely if nothing else needs it). Also turn
   off anonymous sign-ins and phone. Only Google should create sessions.
3. **URL Configuration**:
   - **Site URL**: the app's address, e.g. `https://sales-ops.<domain>`.
   - **Redirect URLs**: `https://sales-ops.<domain>/**` and the
     callback page, e.g. `https://sales-ops.<domain>/auth/callback/**`;
     add `http://localhost:<port>/**` for local development. Google
     sign-in only returns to a listed address; anything else falls back
     to the Site URL.

Someone who signs in but is not a member is recorded in
`access_attempts` (by `log_access_attempt()`), sees "No access", and
gets no rows from any table.

## 5. First admin

The migrations seed no person. In the SQL editor (this bypasses RLS):

```sql
insert into app_users (email, name, role, title, created_by)
values ('first.last@zid.sa', 'First Last', 'admin', 'Sales Operations', 'setup');
```

The email must be exactly the Google address they sign in with (case
does not matter; it is stored lowercase). Everyone else is added from
the app by an admin or manager.

## 6. Deploy the functions

```bash
npx supabase login
npx supabase link --project-ref <ref>
npx supabase functions deploy sync-hubspot --no-verify-jwt
npx supabase functions deploy sync-metabase --no-verify-jwt
```

`--no-verify-jwt` because the caller is the scheduler, not a signed-in
user. They are not open: each refuses any request without the Vault
`sync_secret` in `x-sync-secret` (checked through `sync_secret_ok()`).
`_shared/ssh-fetch.ts` is bundled automatically.

| Function | Called by | Schedule (003) |
|---|---|---|
| `sync-hubspot` | pg_cron job `sales-ops-sync-hubspot`; `request_sync('hubspot')` | every 5 minutes |
| `sync-metabase` | pg_cron job `sales-ops-sync-metabase`; `request_sync('metabase')` | every 30 minutes |

Both do nothing (and report `skipped: ...` in
`integration_config.last_status`) until their connection is saved.
Admins and managers can run either now with the Sync button
(`request_sync`, at most once a minute per source).

## 7. Frontend config

Put the Project URL and publishable key in `config.js`
(`window.SO_CONFIG`). Row-level security does the authorisation; the
publishable key is meant to be public.

## 8. Connect HubSpot and Metabase (Integrations page, admin)

The tokens are not function secrets. An admin enters them on the
Integrations page; they go through `set_integration_secret()`, are
stored encrypted in `integration_secrets`, and are never readable by
any browser role.

**HubSpot** (`integration_config` row `hubspot`)

1. Settings: `pipelines` (the sales pipeline ids: HubSpot → Settings →
   Objects → Deals → Pipelines, or the id in the pipeline's URL). The
   sync does nothing until at least one is set. Optional: `amount_prop`
   (default `amount_without_vat`, else `amount`), `close_date_prop`
   (default `closedate`), `category_prop`, `deal_type_prop`,
   `store_id_prop` (internal property names).
2. Token: a HubSpot private app token with scopes
   `crm.objects.deals.read` and `crm.objects.owners.read`. Without the
   owners scope, names still come from the deal owner property but
   `owner_email` can only come from `app_users.hubspot_owner_id`
   mappings; the run note in `sync_runs` says which source was used and
   which scopes the token has.
3. First run backfills up to 4,000 deals per run (oldest change first)
   and continues every 5 minutes until caught up. Changing pipelines or
   property names starts over from the beginning.

Owner email for each deal: an admin's mapping in
`app_users.hubspot_owner_id` wins, then HubSpot's owner email. Map a
rep whose HubSpot login is not their Google address.

**Metabase** (`integration_config` row `metabase`)

1. Settings: `base_url` (e.g. `https://metabase.zid.sa`) and
   `card_invoices` (the saved card id, see below).
2. Key: a Metabase API key (Admin → Authentication → API keys). Set the
   `base_url` **before** the key: changing the address deletes the key.
3. Optional SSH tunnel (row `metabase_ssh`): if Metabase is only
   reachable from inside the network, set `enabled`, `host`, `port`,
   `username` (and `target_url` if the gateway sees Metabase on another
   address), then the private key. Changing the tunnel's host, port,
   user or target deletes **both** the SSH key and the Metabase key, so
   set up the tunnel first and enter the Metabase key last.

Each Metabase run has two independent parts, each with its own row in
`sync_runs`:

- `metabase_invoices`: the invoices card into `invoices`. Merged HubSpot
  deals are resolved to the surviving deal (needs the HubSpot token).
  Lines the card stops returning are removed, but only after a run that
  returned lines.
- `metabase_top_stores`: a native query on the warehouse (database 2)
  into `store_showcase`, top ten stores per category. Stores that fell
  out are removed only after a non-empty run.

A failure in one (for example a 403 on the card) no longer stops the
other; `last_status` then reads `partial: invoices: ...`.

## Reusing Sales Hunter's credentials

- **HubSpot**: the same private app token works. It needs deals read
  and owners read (`crm.objects.deals.read`, `crm.objects.owners.read`),
  which Sales Hunter's app already has if its owner names come from
  `owners` in its sync response. Pipelines are not part of the token:
  set Sales Ops' own `pipelines` here (all sales pipelines, not only
  Sales Hunter's), since this app has no `target_type` filter.
- **Metabase, top stores**: the same API key works. The top stores part
  is a native query against database 2 (`platinum.zid_insights__stores`,
  `silver.core__dim__store_domains`), exactly Sales Hunter's, so whatever
  lets Sales Hunter's showcase query run lets this one run.
- **Metabase, invoices**: do **not** point `card_invoices` at Sales
  Hunter's card. Make a copy of **"Sales Hunter Deals Details"
  (card 22032)**:
  1. Open card 22032 → … → Duplicate.
  2. In the copy, **remove the Sales Hunter `target_type` filter**, so
     it covers every sales deal, not only Sales Hunter leads. Keep every
     column and its name exactly as they are; the sync reads them by
     name: `id`, `Purchases - invoice → Purchase Item ID`,
     `Purchases - invoice → Store ID`,
     `Purchases - invoice → Purchasable Name`, `VAT Excluded`,
     `Purchases - invoice → Amount Paid`,
     `Purchases - invoice → Purchase Date`,
     `Purchases - invoice → Actiono`,
     `Purchases - invoice → purchase_gender`, `invoice`,
     `Hubspot Fact Deals - Deal → Lead Owner Email`.
  3. Save it in a collection the API key's Metabase user (its group) can
     **read**, and put the new card's id in `card_invoices`.

  Why: Sales Hunter's own card currently fails with HTTP 403 "You do not
  have permissions to view Card 9783" (required permission
  `/collection/760/read/`). Card 22032 most likely uses card 9783
  (in collection 760) as its source, and the API key's group cannot read
  that collection. A copy that keeps the same source has the same problem:
  either grant the API key's group read access to collection 760, or
  rebuild the copy from the underlying tables (or a card in a readable
  collection) instead of from card 9783. Test it from the API key's
  point of view: `POST /api/card/<id>/query/json` with header
  `x-api-key` must return rows, not a 403.

## Checking it works

```sql
-- schedules
select jobname, schedule from cron.job where jobname like 'sales-ops-%';
-- last scheduler calls and their answers
select id, status_code, left(content::text, 200), created
from net._http_response order by id desc limit 10;
-- what the syncs did
select at, source, status, rows, note from sync_runs order by id desc limit 20;
select name, last_synced_at, last_status from integration_config;
```

A 401 `unauthorized` from a function means the `x-sync-secret` did not
match (the functions were redeployed to another project, or the secret
was changed in Vault while a call was in flight).

## Safety notes

- `integration_secrets` has RLS with no policies and no table grants for
  browser roles; only `set_integration_secret()` (admin) writes it and
  `get_integration_secret()` (service role only) reads it.
- Every function in `public` has `EXECUTE` revoked from `anon`; only the
  RPCs listed in the contract are granted to `authenticated`.
- `store_showcase_lite` runs with `security_invoker = false` on purpose
  (see 004). Do not apply the security advisor's suggestion to switch it
  on: every non-admin would see zero stores.
- Edits by people to members, access, targets, rules, issues, payouts,
  grants, settings and integrations are written to `audit_log` by
  triggers; sync writes are not (they are in `sync_runs`).
- Known limits of the HubSpot sync: a deal deleted in HubSpot, or moved
  to a pipeline that is not configured, keeps its last synced state
  here (the incremental query only sees deals still in the configured
  pipelines). Changing `pipelines` re-reads everything, which refreshes
  moved deals but does not delete them.
