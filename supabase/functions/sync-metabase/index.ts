// Sales Ops Portal — Metabase sync
//
// Two independent parts, each recorded as its own sync_runs row:
//
//   (a) invoices     — the saved card in settings.card_invoices (a copy of
//                      Sales Hunter's "Sales Hunter Deals Details", card
//                      22032, without its Sales Hunter filter), one row per
//                      invoice line, into `invoices`. Same column names as
//                      Sales Hunter's syncDealDetails reads.
//   (b) top stores   — Sales Hunter's syncTopStores, verbatim: a native
//                      query on the warehouse (database 2), top ten stores
//                      per category, into store_showcase.
//
// Fix over Sales Hunter: there, the card ran first and a failure in it
// (a Metabase 403 on the card, since 5 Nov) threw before the top stores
// ever ran, so the showcase froze. Here each part has its own try/catch,
// so one failing never stops the other; the combined result goes to
// integration_config.last_status ('ok', 'partial: ...' or 'error: ...').
//
// Connection: integration_config 'metabase' (base_url, card_invoices) and
// its key in integration_secrets (migration 003). Requests go direct, or
// through the SSH tunnel when 'metabase_ssh' is enabled
// (_shared/ssh-fetch.ts). Every Metabase request gets 90 seconds.
// Does nothing until a Metabase key has been saved. Only the scheduler
// can run it (x-sync-secret).

import { createClient } from "npm:@supabase/supabase-js@2";
import { AsyncLocalStorage } from "node:async_hooks";
import { openMetabaseTransport, type MetabaseTransport } from "../_shared/ssh-fetch.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// PostgREST caps any single response at max-rows (1000 by default),
// silently. Page with .range() behind a stable order until a page comes
// back short.
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

type MBSettings = {
  base_url?: string;
  card_invoices?: string | number;
};

async function loadConnection() {
  const { data: cfg, error: cfgErr } = await supabase
    .from("integration_config")
    .select("settings, secret_set")
    .eq("name", "metabase")
    .maybeSingle();
  if (cfgErr) throw new Error(`could not read metabase integration config: ${cfgErr.message}`);
  if (!cfg?.secret_set) return { configured: false as const };
  const { data: key, error } = await supabase.rpc("get_integration_secret", { p_name: "metabase" });
  if (error || !key) throw new Error(`could not read saved Metabase key: ${error?.message ?? "empty"}`);
  const settings = (cfg.settings ?? {}) as MBSettings;
  let base = String(settings.base_url || "");
  try { base = new URL(base).origin; } catch { /* left as typed; the request fails loudly */ }
  return { configured: true as const, key: key as string, base, settings };
}

// A Metabase request that never answers used to hang the run until the
// platform killed it, with no error recorded. 90 s each, then a message.
const METABASE_TIMEOUT_MS = 90_000;
// Per run, not a module global: two runs in one worker must never share
// (or close) each other's tunnel.
const connection = new AsyncLocalStorage<MetabaseTransport>();
async function mbFetch(url: string, init: RequestInit, what: string): Promise<Response> {
  const transport = connection.getStore();
  if (!transport) throw new Error(`${what}: no Metabase connection open`);
  const via = transport.viaSsh ? " through the SSH tunnel" : "";
  try {
    return await transport.fetch(url, { ...init, timeoutMs: METABASE_TIMEOUT_MS });
  } catch (e) {
    if ((e as Error)?.name === "TimeoutError") {
      throw new Error(`${what}: Metabase did not answer${via} within ${METABASE_TIMEOUT_MS / 1000} s`);
    }
    throw new Error(`${what}: could not reach Metabase${via} (${errMsg(e)})`);
  }
}

async function runCard(base: string, key: string, cardId: string): Promise<Record<string, unknown>[]> {
  const res = await mbFetch(`${base}/api/card/${cardId}/query/json`, {
    method: "POST",
    headers: { "x-api-key": key, "Content-Type": "application/json" },
  }, `Metabase card ${cardId}`);
  if (!res.ok) throw new Error(`Metabase card ${cardId}: HTTP ${res.status} — ${(await res.text()).slice(0, 500)}`);
  const body = await res.json();
  // A query error comes back as HTTP 200 with an error object, not rows.
  if (!Array.isArray(body)) {
    throw new Error(`Metabase card ${cardId}: ${String(body?.error ?? body?.message ?? "unexpected response").slice(0, 500)}`);
  }
  return body;
}

// database 2 is this Metabase instance's "Data Warehouse".
const WAREHOUSE_DB_ID = 2;

async function runNativeQuery(base: string, key: string, sql: string): Promise<unknown[][]> {
  const res = await mbFetch(`${base}/api/dataset`, {
    method: "POST",
    headers: { "x-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ database: WAREHOUSE_DB_ID, type: "native", native: { query: sql } }),
  }, "Metabase native query");
  if (!res.ok) throw new Error(`Metabase native query: HTTP ${res.status} — ${(await res.text()).slice(0, 500)}`);
  const body = await res.json();
  if (body?.error) throw new Error(`Metabase native query: ${String(body.error).slice(0, 500)}`);
  return body?.data?.rows ?? [];
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = str(v);
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// "2026-06-10T00:00:00+03:00" -> "2026-06-10". Sliced, not parsed, so the
// date stays the one Metabase reports (no timezone shift).
function dateOf(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const d = s.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

// ---------------------------------------------------------------
// Merged deals
// ---------------------------------------------------------------
// When sales merges duplicate deals in HubSpot, the surviving record has
// another id, but the warehouse keeps reporting purchases under the id
// that was merged away, so those invoices matched no deal and went
// unattributed. A GET by the old id follows the merge and reports the
// survivor. Only ids we cannot match locally are asked about; answers
// are cached in deal_merges (not merged: re-checked after 7 days) and
// each run asks about at most MERGE_LOOKUPS_PER_RUN new ids.
const MERGE_LOOKUPS_PER_RUN = 200;
const MERGE_RECHECK_MS = 7 * 24 * 3600 * 1000;

async function resolveMergedDeals(unknownIds: string[]): Promise<Map<string, string>> {
  const remap = new Map<string, string>();
  if (!unknownIds.length) return remap;
  const cached = await fetchAll<{ old_id: string; canonical_id: string; checked_at: string }>((from, to) =>
    supabase.from("deal_merges").select("old_id, canonical_id, checked_at").order("old_id").range(from, to)
  );
  const cache = new Map(cached.map((c) => [c.old_id, c]));
  const stale = Date.now() - MERGE_RECHECK_MS;
  const toAsk: string[] = [];
  for (const id of unknownIds) {
    const c = cache.get(id);
    if (c && c.canonical_id !== id) remap.set(id, c.canonical_id);
    else if (!c || new Date(c.checked_at).getTime() < stale) toAsk.push(id);
  }
  if (!toAsk.length) return remap;

  const { data: token } = await supabase.rpc("get_integration_secret", { p_name: "hubspot" });
  if (!token) return remap;
  const answers: { old_id: string; canonical_id: string; checked_at: string }[] = [];
  const batch = toAsk.slice(0, MERGE_LOOKUPS_PER_RUN);
  const now = new Date().toISOString();
  // A few at a time: HubSpot's per-second limit is shared with sync-hubspot.
  for (let i = 0; i < batch.length; i += 5) {
    await Promise.all(batch.slice(i, i + 5).map(async (id) => {
      try {
        const res = await fetch(`https://api.hubapi.com/crm/v3/objects/deals/${encodeURIComponent(id)}?properties=hs_object_id`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(15_000),
        });
        if (res.status === 429 || res.status >= 500) { await res.body?.cancel(); return; } // retry next run
        if (!res.ok) { await res.body?.cancel(); answers.push({ old_id: id, canonical_id: id, checked_at: now }); return; }
        const canonical = String((await res.json())?.id ?? "") || id;
        answers.push({ old_id: id, canonical_id: canonical, checked_at: now });
        if (canonical !== id) remap.set(id, canonical);
      } catch { /* leave unmapped; a later run retries */ }
    }));
  }
  if (answers.length) {
    const { error } = await supabase.from("deal_merges").upsert(answers);
    if (error) console.error("could not cache deal merges:", error.message);
  }
  return remap;
}

// ---------------------------------------------------------------
// (a) invoices
// ---------------------------------------------------------------
async function syncInvoices(base: string, key: string, cardId: string) {
  const rawRows = await runCard(base, key, cardId);

  const dealRows = await fetchAll<{ hubspot_deal_id: string; owner_email: string | null }>((from, to) =>
    supabase.from("deals").select("hubspot_deal_id, owner_email").order("hubspot_deal_id").range(from, to)
  );
  const ownerOf = new Map(dealRows.map((r) => [r.hubspot_deal_id, r.owner_email]));
  const unknownIds = [...new Set(rawRows
    .map((r) => String(r["id"] ?? "").trim())
    .filter((id) => id && !ownerOf.has(id)))];
  const remap = await resolveMergedDeals(unknownIds);

  const now = new Date().toISOString();
  const invoices: Record<string, unknown>[] = [];
  // The card's joins can repeat an invoice line (seen in Sales Hunter:
  // the same Purchase Item ID twice on one deal). Each line once.
  const seenItems = new Set<string>();
  for (const r of rawRows) {
    let dealId = String(r["id"] ?? "").trim();
    if (!dealId) continue;
    dealId = remap.get(dealId) ?? dealId;
    const itemId = str(r["Purchases - invoice → Purchase Item ID"]);
    if (!itemId) continue; // no key to store it under
    if (seenItems.has(itemId)) continue;
    seenItems.add(itemId);

    const purchaseDate = dateOf(r["Purchases - invoice → Purchase Date"]);
    // The deal's owner as HubSpot has it (our deals table) wins; the
    // card's own Lead Owner Email is the fallback (blank on some rows,
    // notably merged deals).
    const cardEmail = str(r["Hubspot Fact Deals - Deal → Lead Owner Email"]);
    const repEmail = ownerOf.get(dealId) ?? (cardEmail ? cardEmail.toLowerCase() : null);
    invoices.push({
      item_id: itemId,
      hubspot_deal_id: dealId,
      store_id: str(r["Purchases - invoice → Store ID"]),
      invoice_number: str(r["invoice"]),
      purchase_date: purchaseDate,
      period: purchaseDate ? purchaseDate.slice(0, 7) : null,
      purchasable_name: str(r["Purchases - invoice → Purchasable Name"]),
      // Kept exactly as Metabase writes them (trimmed).
      action: str(r["Purchases - invoice → Actiono"]),
      purchase_gender: str(r["Purchases - invoice → purchase_gender"]),
      net: num(r["VAT Excluded"]),
      gross: num(r["Purchases - invoice → Amount Paid"]),
      rep_email: repEmail,
      synced_at: now,
    });
  }

  const CHUNK = 500;
  for (let i = 0; i < invoices.length; i += CHUNK) {
    const { error } = await supabase.from("invoices").upsert(invoices.slice(i, i + CHUNK), { onConflict: "item_id" });
    if (error) throw error;
  }
  // Lines the card no longer returns (refunded, moved) are dropped. Only
  // after a run that returned lines: an empty or failed response must
  // never wipe the table.
  let swept = 0;
  if (invoices.length > 0) {
    const { error, count } = await supabase.from("invoices").delete({ count: "exact" }).lt("synced_at", now);
    if (error) throw error;
    swept = count ?? 0;
  }
  return { rows: invoices.length, card_rows: rawRows.length, merged_resolved: remap.size, swept };
}

// ---------------------------------------------------------------
// (b) top stores — Sales Hunter's syncTopStores, verbatim
// ---------------------------------------------------------------

// How many stores each category keeps in the showcase.
const TOP_PER_CATEGORY = 10;

// Top stores per category, ranked by all-time order count, read straight
// from the warehouse table (not a saved question, which someone else can
// narrow). Test and spam stores are excluded, as are stores that never
// sold anything and rows with no category to file them under.
async function syncTopStores(base: string, key: string) {
  const rows = await runNativeQuery(
    base, key,
    // Grouped on the TRIMMED category, and the trimmed value is what
    // gets stored: the warehouse holds both "Electronics" and
    // "Electronics " with a trailing space, which would otherwise rank
    // as two categories and show up twice on the page.
    // store_url: the store's active address, its own domain first, else
    // its zid.store one; deleted and .dev.zid.store test addresses skipped.
    "select store_id, store_name, category, orders_count, orders_total_sar, rank_in_category, store_url from (" +
      "select s.store_id, s.store_name, trim(s.store_category_name) as category, s.orders_count, s.orders_total_sar, " +
      "d.domain_url as store_url, " +
      "row_number() over (partition by trim(s.store_category_name) order by s.orders_count desc, s.store_id asc) as rank_in_category " +
      "from platinum.zid_insights__stores s " +
      "left join (select store_uuid, domain_url, row_number() over (partition by store_uuid " +
        "order by is_custom desc, updated_at_utc desc) as rn " +
        "from silver.core__dim__store_domains " +
        "where is_active = true and deleted_at_utc is null and domain_url not like '%.dev.zid.store') d " +
        "on d.store_uuid = s.store_uuid and d.rn = 1 " +
      "where s.is_paid_active = true and s.is_store_test = false and s.is_store_spam = false " +
      "and s.store_category_name is not null and trim(s.store_category_name) <> '' " +
      "and s.store_name is not null and s.orders_count > 0" +
    ") ranked where rank_in_category <= " + TOP_PER_CATEGORY + " " +
    "order by category asc, rank_in_category asc",
  );

  const now = new Date().toISOString();
  const showcaseRows: Record<string, unknown>[] = [];
  // store_id is the primary key, so a duplicate inside one upsert batch
  // fails the whole batch: keep the first (best-ranked) one.
  const seen = new Set<string>();
  for (const r of rows) {
    const storeId = r[0];
    const category = String(r[2] ?? "").trim();
    if (storeId == null || !category) continue;
    const id = String(storeId);
    if (seen.has(id)) continue;
    seen.add(id);
    showcaseRows.push({
      store_id: id,
      name: r[1] ?? id,
      category,
      orders_count: r[3] ?? null,
      orders_total_sar: r[4] ?? null,
      rank_in_category: Number(r[5]),
      store_url: r[6] ? String(r[6]).trim().toLowerCase() : null,
      synced_at: now,
    });
  }

  const CHUNK = 500;
  for (let i = 0; i < showcaseRows.length; i += CHUNK) {
    const { error } = await supabase.from("store_showcase").upsert(showcaseRows.slice(i, i + CHUNK));
    if (error) throw error;
  }
  // Stores that dropped out of this run's results are swept by synced_at
  // AFTER the upsert (never delete-then-insert, so the lite view never
  // shows an empty category mid-sync), and only when this run returned
  // rows: an empty or failed response must never wipe the table.
  if (showcaseRows.length > 0) {
    const { error: sweepError } = await supabase.from("store_showcase").delete().lt("synced_at", now);
    if (sweepError) throw sweepError;
  }
  return showcaseRows.length;
}

// ---------------------------------------------------------------

// The scheduler sends x-sync-secret, read from Vault when the cron job
// fires. Anyone else is turned away before anything runs.
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

type Part = { ok: boolean; rows: number | null; note: string | null; detail?: Record<string, unknown> };

async function logRun(source: string, part: Part) {
  const { error } = await supabase.from("sync_runs").insert({
    source, status: part.ok ? "ok" : "error", rows: part.rows, note: part.note?.slice(0, 2000) ?? null,
  });
  if (error) console.error("could not write sync_runs:", error.message);
}

// Runs one part and turns any failure into a result, so the other part
// still runs.
async function runPart(fn: () => Promise<Part>): Promise<Part> {
  try {
    return await fn();
  } catch (e) {
    return { ok: false, rows: null, note: errMsg(e) };
  }
}

Deno.serve(async (req) => {
  if (!(await fromScheduler(req))) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const started = new Date().toISOString();
  let configured = false;
  try {
    const conn = await loadConnection();
    if (!conn.configured) {
      await supabase.from("integration_config").update({ last_status: "skipped: Metabase is not connected" })
        .eq("name", "metabase");
      return Response.json({ ok: true, skipped: "Metabase is not connected" });
    }
    configured = true;
    const cardId = str(conn.settings.card_invoices);

    let invoices: Part;
    let topStores: Part;
    // Opening the transport (the SSH tunnel, when on) is shared by both
    // parts; if it fails, both parts fail with that reason.
    let tx: MetabaseTransport | null = null;
    try {
      tx = await openMetabaseTransport(supabase);
    } catch (e) {
      const fail: Part = { ok: false, rows: null, note: errMsg(e) };
      invoices = fail;
      topStores = fail;
    }
    if (tx) {
      const open = tx;
      [invoices, topStores] = await connection.run(open, async () => {
        try {
          const inv = await runPart(async () => {
            if (!cardId) return { ok: true, rows: 0, note: "skipped: no invoices card configured (settings.card_invoices)" };
            const r = await syncInvoices(conn.base, conn.key, cardId);
            return {
              ok: true, rows: r.rows,
              note: `card ${cardId}: ${r.card_rows} rows, ${r.rows} lines, ${r.merged_resolved} merged deals resolved, ${r.swept} stale lines removed`,
              detail: r,
            };
          });
          const top = await runPart(async () => {
            const n = await syncTopStores(conn.base, conn.key);
            return { ok: true, rows: n, note: n ? null : "query returned no stores; existing showcase kept" };
          });
          return [inv, top] as const;
        } finally {
          open.close();
        }
      });
    }

    await logRun("metabase_invoices", invoices!);
    await logRun("metabase_top_stores", topStores!);

    const failed: string[] = [];
    if (!invoices!.ok) failed.push(`invoices: ${invoices!.note}`);
    if (!topStores!.ok) failed.push(`top stores: ${topStores!.note}`);
    const status = failed.length === 0 ? "ok"
      : failed.length === 2 ? `error: ${failed.join(" | ")}`
      : `partial: ${failed[0]}`;
    await supabase.from("integration_config").update({ last_synced_at: started, last_status: status.slice(0, 2000) })
      .eq("name", "metabase");

    return Response.json({
      ok: failed.length === 0,
      partial: failed.length === 1,
      status,
      invoices: invoices!,
      top_stores: topStores!,
    }, { status: failed.length === 2 ? 500 : 200 });
  } catch (e) {
    const msg = errMsg(e);
    if (configured) {
      await supabase.from("integration_config").update({ last_synced_at: started, last_status: `error: ${msg}` })
        .eq("name", "metabase");
    }
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
});
