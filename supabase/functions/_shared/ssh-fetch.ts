// Reach Metabase through an SSH tunnel (a "jump host" / bastion).
//
// Some Metabase servers only answer inside a private network. The data
// team then gives us an SSH login on a machine that can see Metabase;
// we open an SSH connection to it and ask it to forward each request to
// Metabase (like `ssh -L`). Every request runs over its own forwarded
// SSH channel.
//
// https addresses are fetched by curl on the gateway itself. Supabase's
// runtime cannot start TLS on an SSH channel or open a local listener to
// relay one, and the one pure-JS TLS client that fits speaks only TLS 1.3,
// while Zid's Metabase (an AWS load balancer) speaks TLS 1.2. curl there
// checks the certificate with the gateway's own trust store. Everything
// curl needs, the Metabase API key included, goes in on its standard input
// over the encrypted SSH connection, never on its command line, so it does
// not show in the gateway's process list.
//
// Plain http addresses run straight over a forwarded channel, speaking just
// enough HTTP/1.1 for the Metabase API (Connection: close, Content-Length
// or chunked replies).
import { Client } from "npm:ssh2@1.16.0";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import type { Duplex } from "node:stream";

export type SshSettings = {
  host: string;
  port?: number | string;
  username: string;
  privateKey: string;
  passphrase?: string;
  // SHA256:… as `ssh-keygen -lf` prints it. Empty = accept the first key
  // seen; the caller then saves it so later runs refuse any other.
  hostFingerprint?: string;
};

export type SshTunnel = {
  fetch: (url: string, init: RequestInit & { timeoutMs?: number }) => Promise<Response>;
  close: () => void;
  hostFingerprint: string;
};

const CONNECT_TIMEOUT_MS = 20_000;

export function openSshTunnel(s: SshSettings): Promise<SshTunnel> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let ready = false, seen = "", wrongHost = false;
    const want = String(s.hostFingerprint || "").trim();
    conn.on("ready", () => {
      ready = true;
      resolve({ fetch: (url, init) => sshFetch(conn, url, init), close: () => conn.end(), hostFingerprint: seen });
    });
    conn.on("error", (e: Error) => {
      if (ready) return;
      reject(new Error(`SSH tunnel to ${s.host}: ${wrongHost
        ? `the server's host key changed (expected ${want}, got ${seen}). If the data team replaced the server, clear the saved fingerprint on the Integrations page.`
        : sshReason(e)}`));
    });
    try {
      conn.connect({
        host: s.host,
        port: Number(s.port) || 22,
        username: s.username,
        privateKey: normaliseKey(s.privateKey),
        passphrase: s.passphrase || undefined,
        readyTimeout: CONNECT_TIMEOUT_MS,
        keepaliveInterval: 15_000,
        hostVerifier: (key: Buffer) => {
          seen = "SHA256:" + createHash("sha256").update(key).digest("base64").replace(/=+$/, "");
          wrongHost = !!want && want !== seen;
          return !wrongHost;
        },
      });
    } catch (e) {
      reject(new Error(`SSH tunnel to ${s.host}: ${sshReason(e as Error)}`));
    }
  });
}

// Keys pasted into a web form often lose their line breaks or pick up
// Windows ones; put the PEM / OpenSSH armour back the way ssh2 wants it.
function normaliseKey(k: string): string {
  let key = String(k || "").replace(/\r\n?/g, "\n").trim();
  const m = key.match(/^(-----BEGIN [A-Z ]+-----)\s*([\s\S]*?)\s*(-----END [A-Z ]+-----)$/);
  if (m && !m[2].includes("\n")) {
    const body = m[2].replace(/\s+/g, "");
    key = `${m[1]}\n${body.match(/.{1,70}/g)!.join("\n")}\n${m[3]}`;
  }
  return key + "\n";
}

function sshReason(e: Error): string {
  const msg = String(e?.message || e);
  if (/All configured authentication methods failed/i.test(msg)) return "the server refused the key (check the username and that the public key is in authorized_keys)";
  if (/Cannot parse privateKey|Unsupported key format|encrypted/i.test(msg)) return `the private key could not be read (${msg})`;
  if (/Timed out while waiting for handshake/i.test(msg)) return `no answer within ${CONNECT_TIMEOUT_MS / 1000} s (host, port or firewall)`;
  if (/ECONNREFUSED/i.test(msg)) return "connection refused (wrong port, or SSH is not running there)";
  if (/ENOTFOUND|getaddrinfo/i.test(msg)) return "host name not found";
  return msg;
}

function forward(conn: Client, host: string, port: number): Promise<Duplex> {
  return new Promise((resolve, reject) => {
    conn.forwardOut("127.0.0.1", 0, host, port, (err: Error | undefined, stream: Duplex) => {
      if (err) reject(new Error(`the SSH host could not open ${host}:${port} (${err.message})`));
      else resolve(stream);
    });
  });
}

function requestBytes(u: URL, init: RequestInit): Buffer {
  const headers = new Headers(init.headers);
  const body = init.body == null ? Buffer.alloc(0) : Buffer.from(String(init.body));
  headers.set("Host", u.host);
  headers.set("Connection", "close");
  headers.set("Accept-Encoding", "identity");
  if (body.length || (init.method && init.method !== "GET")) headers.set("Content-Length", String(body.length));
  let head = `${init.method || "GET"} ${u.pathname}${u.search} HTTP/1.1\r\n`;
  headers.forEach((v, k) => { head += `${k}: ${v}\r\n`; });
  head += "\r\n";
  return Buffer.concat([Buffer.from(head, "latin1"), body]);
}

function timeoutError(ms: number): Error {
  const e = new Error(`no answer within ${ms / 1000} s`);
  e.name = "TimeoutError";
  return e;
}

async function sshFetch(conn: Client, url: string, init: RequestInit & { timeoutMs?: number }): Promise<Response> {
  const u = new URL(url);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error(`unsupported address ${u.protocol}`);
  const https = u.protocol === "https:";
  const port = Number(u.port) || (https ? 443 : 80);
  const timeoutMs = init.timeoutMs ?? 90_000;
  if (https) return parseResponse(await httpsViaGatewayCurl(conn, u, init, timeoutMs), true);
  const raw = await httpOverChannel(await forward(conn, u.hostname, port), requestBytes(u, init), timeoutMs);
  return parseResponse(raw);
}

function httpOverChannel(sock: Duplex, req: Buffer, timeoutMs: number): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const parts: Buffer[] = [];
    const timer = setTimeout(() => { sock.destroy(); reject(timeoutError(timeoutMs)); }, timeoutMs);
    sock.on("data", (d: Buffer) => parts.push(Buffer.from(d)));
    sock.once("error", (e: Error) => { clearTimeout(timer); reject(e); });
    sock.once("close", () => { clearTimeout(timer); resolve(Buffer.concat(parts)); });
    sock.once("end", () => { clearTimeout(timer); resolve(Buffer.concat(parts)); });
    sock.write(req);
  });
}

// curl's config-file string quoting: backslash escapes for \\, ", \n, \r, \t.
function curlQuote(v: string): string {
  return '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t") + '"';
}

// One https request, made by curl on the gateway. Its whole config (URL,
// method, headers, body) is written to curl's standard input (-K -).
function httpsViaGatewayCurl(conn: Client, u: URL, init: RequestInit, timeoutMs: number): Promise<Buffer> {
  const lines = [
    `url = ${curlQuote(u.toString())}`,
    `request = ${curlQuote(init.method || "GET")}`,
    "http1.1", "include", "silent", "show-error",
    `max-time = ${Math.max(1, Math.floor(timeoutMs / 1000) - 2)}`,
    `header = ${curlQuote("Expect:")}`,
  ];
  new Headers(init.headers).forEach((v, k) => lines.push(`header = ${curlQuote(`${k}: ${v}`)}`));
  if (init.body != null) lines.push(`data-raw = ${curlQuote(String(init.body))}`);
  const config = lines.join("\n") + "\n";

  return new Promise<Buffer>((resolve, reject) => {
    conn.exec("curl -K -", (err: Error | undefined, stream: Duplex & { stderr: Duplex }) => {
      if (err) { reject(new Error(`the gateway would not run curl (${err.message})`)); return; }
      const out: Buffer[] = [], errOut: Buffer[] = [];
      let code: number | null = null;
      const timer = setTimeout(() => { stream.destroy(); reject(timeoutError(timeoutMs)); }, timeoutMs);
      stream.on("data", (d: Buffer) => out.push(Buffer.from(d)));
      stream.stderr.on("data", (d: Buffer) => errOut.push(Buffer.from(d)));
      stream.on("exit", (c: number | null) => { code = c; });
      stream.on("close", () => {
        clearTimeout(timer);
        if (code === 0) { resolve(Buffer.concat(out)); return; }
        const why = Buffer.concat(errOut).toString("utf8").trim().slice(0, 300) || `exit code ${code}`;
        // curl's own timeout (exit 28) reads the same as ours.
        if (code === 28) { reject(timeoutError(timeoutMs)); return; }
        reject(new Error(`curl on the gateway failed: ${why}`));
      });
      stream.end(config);
    });
  });
}

// decoded: the body is already de-chunked (curl does that itself).
function parseResponse(raw: Buffer, decoded = false): Response {
  const split = raw.indexOf("\r\n\r\n");
  if (split < 0) throw new Error("the reply through the SSH tunnel was cut off");
  const lines = raw.subarray(0, split).toString("latin1").split("\r\n");
  const status = Number(lines[0].split(" ")[1]);
  if (!status) throw new Error(`unexpected reply through the SSH tunnel: ${lines[0].slice(0, 80)}`);
  const headers = new Headers();
  for (const l of lines.slice(1)) {
    const i = l.indexOf(":");
    if (i > 0) headers.append(l.slice(0, i).trim(), l.slice(i + 1).trim());
  }
  let body = raw.subarray(split + 4);
  if (!decoded && /chunked/i.test(headers.get("transfer-encoding") || "")) body = dechunk(body);
  else if (!decoded && headers.has("content-length")) body = body.subarray(0, Number(headers.get("content-length")));
  headers.delete("transfer-encoding");
  const noBody = status === 204 || status === 304;
  return new Response(noBody ? null : body, { status, headers });
}

function dechunk(b: Buffer): Buffer {
  const out: Buffer[] = [];
  let i = 0;
  while (i < b.length) {
    const eol = b.indexOf("\r\n", i);
    if (eol < 0) break;
    const size = parseInt(b.subarray(i, eol).toString("latin1").split(";")[0], 16);
    if (!size) break;
    out.push(b.subarray(eol + 2, eol + 2 + size));
    i = eol + 2 + size + 2;
  }
  return Buffer.concat(out);
}

/* ---- Metabase transport: plain fetch, or through the tunnel ---- */

type Db = {
  from: (t: string) => any;
  rpc: (fn: string, args: Record<string, unknown>) => any;
};

export type MetabaseTransport = {
  // Same URL the direct connection would use (built from base_url).
  fetch: (url: string, init: RequestInit & { timeoutMs?: number }) => Promise<Response>;
  close: () => void;
  viaSsh: boolean;
};

type SshConfig = {
  enabled?: boolean;
  host?: string;
  port?: string | number;
  username?: string;
  target_url?: string;
  host_fingerprint?: string;
};

// Reads the "metabase_ssh" integration row. Off (or never saved): plain
// fetch to base_url, exactly as before. On: one SSH connection for the
// caller's whole run; each request's origin is swapped for target_url,
// Metabase's address as the SSH host sees it.
export async function openMetabaseTransport(db: Db): Promise<MetabaseTransport> {
  const { data: row, error } = await db.from("integration_config")
    .select("settings, secret_set").eq("name", "metabase_ssh").maybeSingle();
  if (error) throw new Error(`could not read the SSH tunnel settings: ${error.message}`);
  const c = (row?.settings ?? {}) as SshConfig;
  if (!c.enabled) {
    return {
      viaSsh: false,
      close: () => {},
      fetch: (url, init) => {
        const { timeoutMs, ...rest } = init;
        return fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs ?? 90_000) });
      },
    };
  }
  if (!c.host || !c.username || !row?.secret_set) throw new Error("the SSH tunnel is switched on but its host, username or private key is missing");
  const { data: key, error: kErr } = await db.rpc("get_integration_secret", { p_name: "metabase_ssh" });
  if (kErr || !key) throw new Error(`could not read the saved SSH key: ${kErr?.message ?? "empty"}`);
  // Empty = Metabase's usual address (base_url): the gateway reaches the
  // same https URL people use, the connection just goes through it.
  let target: URL | null = null;
  if (c.target_url) {
    try { target = new URL(c.target_url); } catch { throw new Error(`the Metabase server address "${c.target_url}" is not a valid URL`); }
  }

  const tun = await openSshTunnel({
    host: c.host, port: c.port, username: c.username, privateKey: key as string, hostFingerprint: c.host_fingerprint,
  });
  // First connection: remember the server's key, so a different machine
  // answering on that address later is refused instead of trusted.
  if (!c.host_fingerprint && tun.hostFingerprint) {
    await db.from("integration_config")
      .update({ settings: { ...c, host_fingerprint: tun.hostFingerprint } })
      .eq("name", "metabase_ssh");
  }
  return {
    viaSsh: true,
    close: () => tun.close(),
    fetch: (url, init) => {
      if (!target) return tun.fetch(url, init);
      const u = new URL(url);
      const basePath = target.pathname.replace(/\/$/, "");
      return tun.fetch(`${target.origin}${basePath}${u.pathname}${u.search}`, init);
    },
  };
}
