// Sales Ops Portal — HubSpot deal sync
//
// Pulls every deal in the pipelines configured on the Integrations page
// (integration_config 'hubspot', settings.pipelines) into `deals`,
// incrementally by hs_lastmodifieddate. The token lives encrypted in
// integration_secrets (migration 003). Does nothing until a token and at
// least one pipeline have been saved. Only the scheduler can run it
// (x-sync-secret, see fromScheduler and migration 003).
//
// Settings (all optional except pipelines):
//   pipelines        string[]  pipeline ids to sync
//   amount_prop      default 'amount_without_vat', falls back to 'amount'
//   close_date_prop  default 'closedate'
//   category_prop    deal property holding the store's category
//   deal_type_prop   deal property holding the deal type
//   store_id_prop    deal property holding the Zid store id
//
// Patterns carried over from Sales Hunter's sync-hubspot: paginated reads
// of our own tables (fetchAll), a bookmark with a 5-minute overlap, a cap
// on pages per run (HubSpot search stops at 10,000 results), 429 back-off,
// owner names from the Owners API with the hubspot_owner_id property's
// options as fallback, and the portal id saved to `settings`.

import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// PostgREST caps any single response at max-rows (1000 by default)
// whatever the caller's role, silently. Page with .range() behind a
// stable order until a page comes back short.
const PAGE_SIZE = 1000;
async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) return out;
  }
}

type HSSettings = {
  pipelines?: string[];
  amount_prop?: string;
  close_date_prop?: string;
  category_prop?: string;
  deal_type_prop?: string;
  store_id_prop?: string;
};

type Stage = { label: string; isWon: boolean; isClosed: boolean };

async function loadConnection() {
  // Checked, not swallowed: a transient failure must not read as "not
  // configured" and skip a live run while reporting ok.
  const { data: cfg, error: cfgErr } = await supabase
    .from("integration_config")
    .select("settings, secret_set")
    .eq("name", "hubspot")
    .maybeSingle();
  if (cfgErr) throw new Error(`could not read hubspot integration config: ${cfgErr.message}`);
  if (!cfg?.secret_set) return { configured: false as const, why: "HubSpot is not connected" };
  const settings = (cfg.settings ?? {}) as HSSettings;
  const pipelines = (Array.isArray(settings.pipelines) ? settings.pipelines : [])
    .map((p) => String(p).trim()).filter(Boolean);
  if (!pipelines.length) return { configured: false as const, why: "no HubSpot pipelines are configured" };
  const { data: token, error } = await supabase.rpc("get_integration_secret", { p_name: "hubspot" });
  if (error || !token) throw new Error(`could not read saved HubSpot token: ${error?.message ?? "empty"}`);
  return { configured: true as const, token: token as string, settings: { ...settings, pipelines } };
}

// HubSpot calls share a per-second limit; a 429 means "not this second".
async function hsFetch(url: string, token: string, init: RequestInit = {}): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status !== 429 || attempt >= 4) return res;
    await res.body?.cancel();
    const wait = Number(res.headers.get("retry-after")) * 1000 || 1100 * (attempt + 1);
    await new Promise((r) => setTimeout(r, wait));
  }
}

function truthy(v: unknown): boolean {
  return v === true || String(v ?? "").trim().toLowerCase() === "true";
}

// Stage ids are only unique per pipeline, so labels (and won / closed)
// come from the pipelines API. A stage's metadata says whether it is
// closed (isClosed) and its win probability (1.0 = Closed Won); the
// label is the fallback when a portal's stages carry no metadata.
// Unlike Sales Hunter this throws on failure: without stage metadata
// every deal would be written as not won, un-winning closed deals.
async function fetchStages(token: string): Promise<Record<string, Record<string, Stage>>> {
  const res = await hsFetch("https://api.hubapi.com/crm/v3/pipelines/deals", token);
  if (!res.ok) throw new Error(`HubSpot pipelines: HTTP ${res.status} — ${(await res.text()).slice(0, 300)}`);
  const pipelines = (await res.json()).results ?? [];
  const map: Record<string, Record<string, Stage>> = {};
  for (const p of pipelines) {
    map[p.id] = {};
    for (const s of p.stages ?? []) {
      const label = String(s.label ?? s.id);
      const l = label.toLowerCase();
      const md = s.metadata ?? {};
      const hasClosed = md.isClosed != null && String(md.isClosed).trim() !== "";
      const hasProb = md.probability != null && String(md.probability).trim() !== "" &&
        !Number.isNaN(Number(md.probability));
      const labelWon = /\bwon\b/.test(l);
      const labelClosed = labelWon || /\blost\b/.test(l) || l.includes("closed");
      const isClosed = hasClosed ? truthy(md.isClosed) : labelClosed;
      const isWon = hasProb ? (Number(md.probability) >= 1 && isClosed) : (labelWon && isClosed);
      map[p.id][s.id] = { label, isWon, isClosed };
    }
  }
  return map;
}

// The portal id turns a deal id into a CRM link; stored in `settings`
// (members read it) rather than hard-coded.
async function saveAccountInfo(token: string) {
  const res = await hsFetch("https://api.hubapi.com/account-info/v3/details", token);
  if (!res.ok) { await res.body?.cancel(); return; }
  const info = await res.json();
  if (!info?.portalId) return;
  await supabase.from("settings").upsert([
    { key: "hubspot_portal_id", value: String(info.portalId) },
    { key: "hubspot_ui_domain", value: info.uiDomain || "app.hubspot.com" },
  ]);
}

// Owner id -> name and email. The Owners API (crm.objects.owners.read
// scope; archived owners included so old deals keep their owner) gives
// both. Without that scope, the hubspot_owner_id property's option list
// still gives names (deal read access is enough), but no emails.
type Owner = { name: string | null; email: string | null };
async function fetchOwners(token: string): Promise<{ owners: Map<string, Owner>; source: string }> {
  const owners = new Map<string, Owner>();
  let ok = true;
  let why = "";
  for (const archived of [false, true]) {
    let after: string | null = null;
    do {
      const res = await hsFetch(
        `https://api.hubapi.com/crm/v3/owners?limit=500&archived=${archived}` + (after ? `&after=${after}` : ""),
        token,
      );
      if (!res.ok) { ok = false; why = `owners HTTP ${res.status}`; await res.body?.cancel(); break; }
      const page = await res.json();
      for (const o of page.results ?? []) {
        const id = o.id != null ? String(o.id) : "";
        if (!id || owners.has(id)) continue;
        const email = o.email ? String(o.email).trim().toLowerCase() : null;
        const name = [o.firstName, o.lastName].filter(Boolean).join(" ").trim() || email;
        owners.set(id, { name, email });
      }
      after = page.paging?.next?.after ?? null;
    } while (after);
    if (!ok) break;
  }
  if (ok && owners.size) return { owners, source: "owners" };

  // Say which app the token belongs to and what it is scoped for, so a
  // missing scope gets fixed on the right private app.
  if (why) {
    const info = await fetch("https://api.hubapi.com/oauth/v2/private-apps/get/access-token-info", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ tokenKey: token }),
    }).then((r) => r.ok ? r.json() : null).catch(() => null);
    if (info) why += `; token is for app ${info.appId} in portal ${info.hubId}, scopes: ${(info.scopes ?? []).join(" ")}`;
  }
  owners.clear();
  const res = await hsFetch("https://api.hubapi.com/crm/v3/properties/deals/hubspot_owner_id", token);
  if (res.ok) {
    for (const o of (await res.json()).options ?? []) {
      if (o.value && o.label) owners.set(String(o.value), { name: String(o.label).trim(), email: null });
    }
  } else {
    await res.body?.cancel();
  }
  return {
    owners,
    source: owners.size ? `property (names only: ${why || "owners empty"})` : `none (${why || "owners empty"}, property HTTP ${res.status})`,
  };
}

// HubSpot search refuses to page past 10,000 results. Capping pages per
// run keeps every run well inside that and inside the function's time
// budget; a large backlog just takes several runs, each saving progress.
const MAX_PAGES_PER_RUN = 40; // 4,000 deals per run
// HubSpot's search index lags writes a little: re-read a few minutes
// before the bookmark (upserts are idempotent).
const OVERLAP_MS = 5 * 60 * 1000;

async function fetchModifiedDeals(token: string, pipelines: string[], properties: string[], since: string | null) {
  const filters: Record<string, unknown>[] = [{ propertyName: "pipeline", operator: "IN", values: pipelines }];
  if (since) filters.push({ propertyName: "hs_lastmodifieddate", operator: "GTE", value: since });
  // deno-lint-ignore no-explicit-any
  const all: any[] = [];
  let after: string | null = null;
  let pages = 0;
  let more = false;
  do {
    const body: Record<string, unknown> = {
      filterGroups: [{ filters }],
      properties,
      sorts: [{ propertyName: "hs_lastmodifieddate", direction: "ASCENDING" }],
      limit: 100,
    };
    if (after) body.after = after;
    const res = await hsFetch("https://api.hubapi.com/crm/v3/objects/deals/search", token, {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HubSpot search: HTTP ${res.status} — ${(await res.text()).slice(0, 500)}`);
    const page = await res.json();
    all.push(...(page.results ?? []));
    after = page.paging?.next?.after ?? null;
    pages++;
    if (after && pages >= MAX_PAGES_PER_RUN) { more = true; break; }
  } while (after);
  return { deals: all, more };
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function num(v: unknown): number | null {
  const s = str(v);
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// HubSpot sends dates as ISO strings, or (date-only properties) as
// "YYYY-MM-DD" or epoch milliseconds.
function ts(v: unknown): string | null {
  const s = str(v);
  if (s === null) return null;
  const d = /^\d{11,}$/.test(s) ? new Date(Number(s)) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// The scheduler sends x-sync-secret, read from Vault when the cron job
// fires. Anyone else is turned away before anything runs: this function
// holds the service role and spends HubSpot's API allowance.
async function fromScheduler(req: Request): Promise<boolean> {
  const secret = req.headers.get("x-sync-secret");
  if (!secret) return false;
  const { data, error } = await supabase.rpc("sync_secret_ok", { p_secret: secret });
  return !error && data === true;
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const anyE = e as Record<string, unknown>;
    return String(anyE.message ?? anyE.error ?? anyE.details ?? JSON.stringify(e));
  }
  return String(e);
}

async function logRun(status: "ok" | "error", rows: number | null, note: string | null) {
  const { error } = await supabase.from("sync_runs").insert({ source: "hubspot", status, rows, note: note?.slice(0, 2000) ?? null });
  if (error) console.error("could not write sync_runs:", error.message);
}

Deno.serve(async (req) => {
  if (!(await fromScheduler(req))) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const started = new Date().toISOString();
  let configured = false;
  try {
    const conn = await loadConnection();
    if (!conn.configured) {
      await supabase.from("integration_config").update({ last_status: `skipped: ${conn.why}` }).eq("name", "hubspot");
      return Response.json({ ok: true, skipped: conn.why });
    }
    configured = true;
    const s = conn.settings;
    const amountProp = str(s.amount_prop) ?? "amount_without_vat";
    const closeProp = str(s.close_date_prop) ?? "closedate";
    const categoryProp = str(s.category_prop);
    const dealTypeProp = str(s.deal_type_prop);
    const storeIdProp = str(s.store_id_prop);

    const properties = Array.from(new Set([
      "dealname", "dealstage", "pipeline", "hs_lastmodifieddate", "createdate", "closedate",
      "hubspot_owner_id", "amount", amountProp, closeProp,
      ...(categoryProp ? [categoryProp] : []),
      ...(dealTypeProp ? [dealTypeProp] : []),
      ...(storeIdProp ? [storeIdProp] : []),
    ]));

    // What the bookmark was taken under. A change of pipelines or
    // property names starts over from the beginning, or deals already
    // in a newly added pipeline would never be fetched.
    const scope = JSON.stringify({
      pipelines: [...s.pipelines].sort(), amountProp, closeProp, categoryProp, dealTypeProp, storeIdProp,
    });
    const { data: state, error: stateErr } = await supabase.from("sync_state")
      .select("bookmark, scope").eq("source", "hubspot").maybeSingle();
    if (stateErr) throw stateErr;
    let bookmark: string | null = state && state.scope === scope ? (state.bookmark ?? null) : null;
    const fullResync = !!state?.bookmark && state.scope !== scope;
    const queryFrom = bookmark ? new Date(new Date(bookmark).getTime() - OVERLAP_MS).toISOString() : null;

    const stages = await fetchStages(conn.token);
    const { deals, more } = await fetchModifiedDeals(conn.token, s.pipelines, properties, queryFrom);
    await saveAccountInfo(conn.token);
    const owners = await fetchOwners(conn.token);

    // Owner email. An admin's explicit mapping (app_users.hubspot_owner_id)
    // wins, because the app_users email is the Google sign-in the rep
    // uses here; then HubSpot's owner email; then, when the Owners API is
    // unavailable, the email this owner id already carries on stored
    // deals. Names: HubSpot first, then the stored name for that owner id.
    //
    // Every row carries every column (bulk upserts union the columns
    // across the batch, so an omitted key would be written as NULL):
    // anything unknown this run is carried forward from what is stored.
    const mapped = await fetchAll<{ email: string; hubspot_owner_id: string | null }>((from, to) =>
      supabase.from("app_users").select("email, hubspot_owner_id").not("hubspot_owner_id", "is", null)
        .order("email").range(from, to)
    );
    const emailForOwner = new Map<string, string>();
    for (const u of mapped) {
      const id = str(u.hubspot_owner_id);
      if (id && !emailForOwner.has(id)) emailForOwner.set(id, u.email);
    }
    const current = await fetchAll<{ owner_id: string | null; owner_email: string | null; owner_name: string | null }>(
      (from, to) =>
        supabase.from("deals").select("hubspot_deal_id, owner_id, owner_email, owner_name")
          .not("owner_id", "is", null).order("hubspot_deal_id").range(from, to),
    );
    const storedEmailForOwner = new Map<string, string>();
    const storedNameForOwner = new Map<string, string>();
    for (const r of current) {
      if (!r.owner_id) continue;
      if (r.owner_email && !storedEmailForOwner.has(r.owner_id)) storedEmailForOwner.set(r.owner_id, r.owner_email);
      if (r.owner_name && !storedNameForOwner.has(r.owner_id)) storedNameForOwner.set(r.owner_id, r.owner_name);
    }

    const now = new Date().toISOString();
    const rows: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    for (const d of deals) {
      const id = String(d.id);
      // A duplicate inside one upsert batch fails the whole batch.
      if (seen.has(id)) continue;
      seen.add(id);
      const p = d.properties ?? {};
      const stage = stages[p.pipeline]?.[p.dealstage];
      const label = stage?.label ?? str(p.dealstage);
      // Stage not in the pipelines API (deleted stage): fall back to the label.
      const l = String(label ?? "").toLowerCase();
      const isWon = stage ? stage.isWon : /\bwon\b/.test(l);
      const isClosed = stage ? stage.isClosed : (isWon || /\blost\b/.test(l));

      const ownerId = str(p.hubspot_owner_id);
      const hsOwner = ownerId ? owners.owners.get(ownerId) : undefined;
      const ownerEmail = ownerId
        ? (emailForOwner.get(ownerId) ?? hsOwner?.email ?? storedEmailForOwner.get(ownerId) ?? null)
        : null;
      const ownerName = ownerId ? (hsOwner?.name ?? storedNameForOwner.get(ownerId) ?? null) : null;

      const amount = num(p[amountProp]) ?? num(p.amount);
      rows.push({
        hubspot_deal_id: id,
        deal_name: str(p.dealname),
        store_id: storeIdProp ? str(p[storeIdProp]) : null,
        owner_id: ownerId,
        owner_email: ownerEmail,
        owner_name: ownerName,
        pipeline: str(p.pipeline),
        stage: str(p.dealstage),
        stage_label: label,
        is_won: isWon,
        is_closed: isClosed,
        amount,
        close_date: ts(p[closeProp]) ?? ts(p.closedate),
        created_at_hs: ts(p.createdate) ?? ts(d.createdAt),
        deal_type: dealTypeProp ? str(p[dealTypeProp]) : null,
        // Trimmed: the same category with and without a trailing space
        // would otherwise show up as two.
        category: categoryProp ? str(p[categoryProp]) : null,
        updated_at_hs: ts(p.hs_lastmodifieddate) ?? ts(d.updatedAt),
        synced_at: now,
      });
      bookmark = str(p.hs_lastmodifieddate) ?? bookmark;
    }

    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error } = await supabase.from("deals").upsert(rows.slice(i, i + CHUNK), { onConflict: "hubspot_deal_id" });
      if (error) throw error;
    }

    // The bookmark only moves once the rows it covers are written.
    const { error: bmErr } = await supabase.from("sync_state").upsert({
      source: "hubspot", bookmark, scope, last_run_at: started, last_status: "ok", last_error: null,
    });
    if (bmErr) throw bmErr;

    const notes = [
      `owners from ${owners.source}`,
      ...(fullResync ? ["settings changed: started over"] : []),
      ...(more ? ["more deals left for the next run"] : []),
    ];
    await logRun("ok", rows.length, notes.join("; "));
    await supabase.from("integration_config").update({ last_synced_at: started, last_status: "ok" }).eq("name", "hubspot");
    return Response.json({
      ok: true, synced: rows.length, more, full_resync: fullResync,
      owners: { source: owners.source, count: owners.owners.size },
    });
  } catch (e) {
    const msg = errMsg(e);
    await supabase.from("sync_state").upsert({
      source: "hubspot", last_run_at: started, last_status: "error", last_error: msg,
    });
    if (configured) {
      await logRun("error", null, msg);
      await supabase.from("integration_config").update({ last_synced_at: started, last_status: `error: ${msg}` })
        .eq("name", "hubspot");
    }
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
});
