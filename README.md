# Sales Ops Portal (Zid)

The sales team's commission portal. Reps see exactly which deals count,
what they earn and what to fix. Managers see the team, decide on
exceptions and set targets. Finance pays on the invoice.

It is built the same way as Sales Hunter, and shares its design system,
Zid logos, chart engine and date picker:

- Static files with no build step.
- Supabase for sign-in, database and sync jobs.
- Hosted on Cloudflare Workers.

## How the numbers work

- **HubSpot** says who owns a deal and whether it is Closed Won.
- **Metabase** says what was paid. A deal counts at its invoice net
  (excl. VAT), in the month of the invoice.
- Commission is set by tiers on achievement against the monthly target,
  plus an accelerator per SAR block above 150%.
- Commission is held below the store minimum, unless management grants
  an exception.
- Every rule is editable on **Commission rules** and versioned. Details
  are in `docs/DATA_CONTRACT.md`.
- **Issues**: where HubSpot and Metabase disagree, the deal shows an
  issue. Examples: won but no invoice, paid but not won, amount or month
  differences, a different owner on the invoice, the same store won twice.
- Reps fix issues in HubSpot and mark them fixed; the next sync confirms
  the fix. Ownership and duplicate cases go to management's **Exception
  queue**.

## Who sees what

| Page | Rep | Manager | Finance | Sales Ops (admin) |
|---|---|---|---|---|
| Overview, Issues, Leaderboard, Analytics, Calculator | own | team | – | team |
| Deals | own | team | all | all |
| Top Zid Stores | ✓ | ✓ | ✓ | ✓ |
| Exception queue, Team, Sectors, Targets, Finance access | – | ✓ | – | ✓ |
| Reconciliation | – | ✓ | ✓ | ✓ |
| Payouts | – | read only | only months with an active grant | ✓ |
| Access | – | ✓ (no admins) | – | ✓ |
| Commission rules, Integrations | – | – | – | ✓ |

## Sign-in and access

- Sign-in is Google only.
- Only people on the access list (`app_users`, managed on the **Access**
  page) get in.
- Anyone else sees: "No access. Contact the sales management for
  access." Their attempt then shows up under Access → Requests, where a
  manager can approve or deny it.

## Top Zid Stores

This is the same page and the same data as Sales Hunter's hunter view:

- The Metabase sync ranks `platinum.zid_insights__stores`: the top ten
  per category by all-time orders, paid-active stores only, with test
  and spam stores excluded.
- It runs the same SQL as Sales Hunter.
- Everyone reads names, ranks and addresses only, never order counts or
  revenue.

## Run it

```bash
python3 -m http.server 8080
```

- Open `http://localhost:8080`. With `config.js` blank, it runs on
  generated demo data: pick a person to sign in as, or "Someone not on
  the list" to see the no-access screen.
- `?mode=mock` forces demo mode on a live deployment.

## Go live

1. **Supabase**: follow `docs/SUPABASE.md`. It covers creating the
   project, migrations, Google sign-in, the sync functions and the first
   admin.
2. **Point the app at the project**:
   - Put the project URL and publishable key in `config.js`.
   - Put the same project ref in `_headers` (connect-src).
3. **Deploy**: every push to `main` deploys to the Cloudflare Worker
   `sales-ops` (`.github/workflows/deploy.yml`). This needs the
   `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets.
   To deploy by hand: `npx wrangler@4.151.0 deploy`.
4. **Supabase Auth**: add the app's address to the Redirect URLs.

## Files

| Path | What it is |
|---|---|
| `logic.js` | Counting, issues, commission engine, reconciliation. No DOM. |
| `api.js` | Supabase auth and data, plus an in-memory twin for demo mode. |
| `data.js` | Demo data, shaped exactly like the live tables. |
| `core.js` | Shared state, formatting, icons, drawer, dialog and toast. |
| `views-*.js` | The pages. |
| `app.js` | Shell, sign-in screens and routing. |
| `styles.css`, `charts.js`, `daterange.js` | Copied from Sales Hunter. |
| `ops.css` | Additions for this app. |
| `brand.js` | Zid wordmark, spark and Google mark. |
| `supabase/` | Schema, row-level security, sync functions. |
| `docs/` | Data contract and setup runbook. |
