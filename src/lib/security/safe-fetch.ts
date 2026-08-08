// SSRF-safe outbound fetch for user-supplied URLs (Custom API Connectors /
// Scraping Targets, FEATURE_REGISTRY_v2.md rows #59/#60).
//
// A user-configured "fetch this URL for me" feature is a textbook SSRF
// surface: without protection, an org admin (or an attacker who compromises
// an admin session) could point a connector at http://169.254.169.254/ (cloud
// metadata), http://localhost:PORT/ (internal services), or an internal
// 10.x/192.168.x host and read back the response through the opportunity
// records this feature creates.
//
// Defense in depth, in order:
//   1. Only http/https schemes.
//   2. Resolve the hostname via DNS *once*, validate every resolved address,
//      and pin the connection to that exact validated IP (via Node's
//      `lookup` request option) rather than letting a second, later DNS
//      resolution decide where the socket actually connects. Validating the
//      hostname string and then letting fetch() re-resolve it is vulnerable
//      to DNS rebinding: the validation-time answer and the connect-time
//      answer are not guaranteed to be the same address.
//   3. Redirects are followed manually (never automatically), and every hop
//      re-runs steps 1-2 against the new Location — an attacker-controlled
//      allowlisted endpoint could otherwise 302 the fetch to an internal
//      address after validation already passed once.
//   4. Hard wall-clock timeout; response body capped and streamed rather
//      than buffered unbounded.
//
// Domain allowlisting (a *separate*, org-admin-configured control — see
// `assertDomainAllowed` in `custom-connector-allowlist.ts`) is enforced by
// the caller before this module is ever reached. This module's job is purely
// "never let a fetch land on a private/internal address," independent of
// whether the target domain was supposed to be reachable at all.

import { promises as dns } from "node:dns";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import net from "node:net";

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfBlockedError";
  }
}

export interface SafeFetchResult {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  truncated: boolean;
  finalUrl: string;
}

export interface SafeFetchOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  /** Hard wall-clock timeout for the whole request (including redirects). Default 15s. */
  timeoutMs?: number;
  /** Max response bytes read into memory. Default 2MB. */
  maxBytes?: number;
  /** Max redirect hops followed, each re-validated. Default 3. */
  maxRedirects?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 2_000_000;
const DEFAULT_MAX_REDIRECTS = 3;

/** True if `ip` (already-parsed dotted-quad IPv4) falls in a blocked range. */
function isBlockedIPv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true; // malformed => fail closed
  const [a, b] = parts as [number, number, number, number];

  if (a === 0) return true; // 0.0.0.0/8 ("this network")
  if (a === 10) return true; // RFC1918
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, INCLUDES cloud metadata 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT / shared address space (RFC6598)
  if (a === 192 && b === 0 && parts[2] === 0) return true; // IETF protocol assignments
  if (a === 192 && b === 0 && parts[2] === 2) return true; // TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && parts[2] === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && parts[2] === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast (224-239) + reserved (240-255) + broadcast

  return false;
}

/** True if `ip` (parsed IPv6) falls in a blocked range, including IPv4-mapped addresses. */
function isBlockedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();

  if (lower === "::1") return true; // loopback
  if (lower === "::") return true; // unspecified

  // IPv4-mapped (::ffff:a.b.c.d) or IPv4-compatible — unwrap and re-check as
  // IPv4, since this is a well-known way to smuggle a blocked v4 address
  // through a v6-shaped string.
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped?.[1]) return isBlockedIPv4(mapped[1]);

  // Link-local fe80::/10
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true;
  // Unique local fc00::/7 (fc00:: - fdff::)
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true;
  // Multicast ff00::/8
  if (lower.startsWith("ff")) return true;

  return false;
}

function isBlockedIP(ip: string): boolean {
  if (net.isIPv4(ip)) return isBlockedIPv4(ip);
  if (net.isIPv6(ip)) return isBlockedIPv6(ip);
  return true; // couldn't classify => fail closed
}

/**
 * Resolve `hostname` and return the first validated, non-blocked address.
 * Throws {@link SsrfBlockedError} if the hostname is an IP literal that's
 * blocked, or if DNS resolution returns no allowed address (fail closed —
 * if *any* resolved address is private, the whole hostname is rejected
 * rather than picking around it, since which address a later connection
 * actually uses isn't fully in our control).
 */
async function resolveValidatedAddress(
  hostname: string,
): Promise<{ address: string; family: 4 | 6 }> {
  // IP literal — validate directly, no DNS involved.
  if (net.isIP(hostname)) {
    if (isBlockedIP(hostname)) {
      throw new SsrfBlockedError(
        `Target address ${hostname} resolves to a private/internal range and is blocked.`,
      );
    }
    return { address: hostname, family: net.isIPv6(hostname) ? 6 : 4 };
  }

  let records: { address: string; family: number }[];
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new SsrfBlockedError(`Could not resolve hostname: ${hostname}`);
  }

  if (records.length === 0) {
    throw new SsrfBlockedError(`Could not resolve hostname: ${hostname}`);
  }

  // Fail closed: if any resolved address is blocked, reject the hostname
  // entirely rather than trying to steer around it.
  const blocked = records.find((r) => isBlockedIP(r.address));
  if (blocked) {
    throw new SsrfBlockedError(
      `Target hostname resolves to a private/internal address (${blocked.address}) and is blocked.`,
    );
  }

  const first = records[0]!;
  return { address: first.address, family: first.family === 6 ? 6 : 4 };
}

/**
 * SSRF-safe fetch. Resolves + validates the hostname, pins the TCP
 * connection to the validated IP, and manually follows redirects
 * (re-validating each hop) rather than trusting an HTTP client's built-in
 * redirect/DNS behavior.
 */
export async function safeFetch(
  url: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const {
    method = "GET",
    headers = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
    maxRedirects = DEFAULT_MAX_REDIRECTS,
  } = options;

  const deadline = Date.now() + timeoutMs;
  let currentUrl = url;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const parsed = new URL(currentUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new SsrfBlockedError(
        `Unsupported protocol: ${parsed.protocol} — only http/https are allowed.`,
      );
    }

    const { address: pinnedIp, family } = await resolveValidatedAddress(
      parsed.hostname,
    );

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new SsrfBlockedError("Request timed out.");
    }

    const result = await performPinnedRequest({
      parsed,
      pinnedIp,
      family,
      method,
      headers,
      timeoutMs: remainingMs,
      maxBytes,
    });

    if (
      result.status >= 300 &&
      result.status < 400 &&
      result.locationHeader &&
      hop < maxRedirects
    ) {
      // Resolve relative redirects against the current URL, then re-loop —
      // the next iteration re-validates the new target from scratch.
      currentUrl = new URL(result.locationHeader, currentUrl).toString();
      continue;
    }

    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      statusText: result.statusText,
      headers: result.headers,
      body: result.body,
      truncated: result.truncated,
      finalUrl: currentUrl,
    };
  }

  throw new SsrfBlockedError("Too many redirects.");
}

interface PinnedRequestResult {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  truncated: boolean;
  locationHeader: string | null;
}

function performPinnedRequest(args: {
  parsed: URL;
  pinnedIp: string;
  family: 4 | 6;
  method: string;
  headers: Record<string, string>;
  timeoutMs: number;
  maxBytes: number;
}): Promise<PinnedRequestResult> {
  const { parsed, pinnedIp, family, method, headers, timeoutMs, maxBytes } =
    args;
  const isHttps = parsed.protocol === "https:";
  const requestFn = isHttps ? httpsRequest : httpRequest;

  return new Promise((resolve, reject) => {
    const req = requestFn(
      {
        // The `lookup` override below pins the actual TCP connection to the
        // pre-validated IP. `host`/`servername` stay as the real hostname so
        // the Host header and TLS SNI/certificate validation are correct.
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method,
        headers,
        servername: isHttps ? parsed.hostname : undefined,
        timeout: timeoutMs,
        // Node >=18.13's `net.connect` defaults `autoSelectFamily` (Happy
        // Eyeballs) to true, which calls `lookup` with `{ all: true }` and
        // expects the callback to return an ARRAY of {address, family}
        // records, not a single (address, family) pair — the shape this
        // module used to assume unconditionally, which made every real
        // (non-blocked) fetch fail with "Invalid IP address: undefined"
        // regardless of target, confirmed live 2026-08-08. Disabling
        // autoSelectFamily reverts Node to the legacy single-address
        // 3-arg lookup callback this code was written for; the pinned IP
        // is already fully validated by resolveValidatedAddress before
        // this point, so there is no dual-stack address to race between.
        // `autoSelectFamily` isn't in this project's pinned @types/node
        // (20.16.x) RequestOptions typing even though Node itself accepts
        // it (it's threaded through to net.connect) — types-only cast,
        // same pattern already used in src/lib/supabase/admin.ts for a
        // comparable Node/library version mismatch.
        autoSelectFamily: false,
        lookup: (
          _hostname: string,
          _opts: unknown,
          callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void,
        ) => {
          callback(null, pinnedIp, family);
        },
      } as import("node:http").RequestOptions,
      (res: IncomingMessage) => {
        let received = 0;
        let truncated = false;
        let settled = false;
        const chunks: Buffer[] = [];

        // Calling res.destroy() to enforce maxBytes means "end" never fires
        // for a truncated response (destroying a stream mid-read aborts it
        // rather than completing it) — the promise must resolve at the
        // truncation point itself, not wait on an "end" that will never
        // come. Resolving only from "end" left every truncated fetch hung
        // forever (confirmed live 2026-08-08: a >maxBytes response caused
        // the whole request to never settle). `settled` guards against a
        // late "end"/"close"/"error" firing after we've already resolved.
        const finish = (result: PinnedRequestResult) => {
          if (settled) return;
          settled = true;
          resolve(result);
        };

        const buildResult = (isTruncated: boolean): PinnedRequestResult => {
          const headerRecord: Record<string, string> = {};
          for (const [key, value] of Object.entries(res.headers)) {
            if (typeof value === "string") headerRecord[key] = value;
            else if (Array.isArray(value)) headerRecord[key] = value.join(", ");
          }
          return {
            status: res.statusCode ?? 0,
            statusText: res.statusMessage ?? "",
            headers: headerRecord,
            body: Buffer.concat(chunks).toString("utf8"),
            truncated: isTruncated,
            locationHeader:
              typeof res.headers.location === "string"
                ? res.headers.location
                : null,
          };
        };

        res.on("data", (chunk: Buffer) => {
          if (truncated) return;
          received += chunk.length;
          if (received > maxBytes) {
            truncated = true;
            chunks.push(chunk.subarray(0, maxBytes - (received - chunk.length)));
            finish(buildResult(true));
            res.destroy();
            return;
          }
          chunks.push(chunk);
        });

        res.on("end", () => finish(buildResult(truncated)));
        // A destroyed/aborted response emits "close" (and sometimes
        // "aborted") instead of "end" — without this, a truncated response
        // would already be handled by finish() above, but any other
        // early-close case (e.g. the server itself hangs up mid-body)
        // would otherwise hang the whole request indefinitely too.
        res.on("close", () => finish(buildResult(truncated)));
        res.on("error", (err) => {
          if (settled) return;
          settled = true;
          reject(err);
        });
      },
    );

    req.on("timeout", () => {
      req.destroy(new SsrfBlockedError("Request timed out."));
    });
    req.on("error", (err) => reject(err));
    req.end();
  });
}
