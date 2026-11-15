// Sales Ops Portal: create the SSH key for the Metabase tunnel.
//
// Same as Sales Hunter's ssh-keygen: the data team authorizes OUR key on
// their SSH host, so this makes a fresh ed25519 key pair on the server,
// stores the private half encrypted (set_integration_secret, the same path
// a pasted key takes) and hands back only the public half for an admin to
// send them. The private key never reaches a browser.
//
// Everything runs as the caller, so the database's own rules apply: only
// an admin may change integration settings or save a secret.

import { createClient } from "npm:@supabase/supabase-js@2";
import ssh2 from "npm:ssh2@1.16.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const auth = req.headers.get("Authorization") ?? "";
  if (!/^Bearer\s+\S+/.test(auth)) return json({ ok: false, error: "sign in first" }, 401);
  const asCaller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: isAdmin } = await asCaller.rpc("is_role", { p_roles: ["admin"] });
    if (isAdmin !== true) return json({ ok: false, error: "admins only" }, 403);

    const { data: row, error: readErr } = await asCaller.from("integration_config")
      .select("settings").eq("name", "metabase_ssh").maybeSingle();
    if (readErr) throw new Error(readErr.message);

    const pair = (ssh2 as unknown as { utils: { generateKeyPairSync: (t: string, o: Record<string, unknown>) => { private: string; public: string } } })
      .utils.generateKeyPairSync("ed25519", { comment: "zid-sales-ops" });
    const publicKey = pair.public.trim();

    const settings = {
      ...((row?.settings ?? {}) as Record<string, unknown>),
      public_key: publicKey,
      key_created_at: new Date().toISOString(),
    };
    const { error: setErr } = await asCaller.from("integration_config").update({ settings }).eq("name", "metabase_ssh");
    if (setErr) throw new Error(setErr.message);
    const { error: keyErr } = await asCaller.rpc("set_integration_secret", { p_name: "metabase_ssh", p_secret: pair.private });
    if (keyErr) throw new Error(keyErr.message);
    return json({ ok: true, public_key: publicKey });
  } catch (e) {
    console.error("ssh-keygen failed:", (e as Error)?.message ?? e);
    return json({ ok: false, error: "The key could not be created. Please try again." }, 500);
  }
});
