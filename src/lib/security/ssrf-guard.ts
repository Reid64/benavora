// Shared SSRF guard — the single source of truth for "is this URL/hostname
// safe to let the server connect to," used by every server-side call site
// that fetches or navigates to a user/org-controlled URL (WGR-108/109/110).
//
// Defense, in order:
//   1. Only http/https schemes are ever allowed (file://, gopher://, ftp://,
//      data:, etc. are all rejected outright).
//   2. The hostname is resolved via DNS *once* here, and every resolved
//      address is checked against the private/reserved/loopback/link-local
//      ranges (RFC1918, RFC5735, RFC4193, the 169.254.0.0/16 link-local block
//      that also covers the cloud metadata IP 169.254.169.254, IPv6
//      loopback/unique-local/link-local, etc.) — fail closed: if *any*
//      resolved address is blocked, the whole hostname is rejected rather
//      than trying to steer around it, since a later connection isn't
//      guaranteed to land on the address this check happened to prefer.
//   3. A literal IP host (`http://127.0.0.1/...`) is validated directly,
//      with no DNS step to bypass.
//   4. Callers that go on to make the actual network request should use the
//      validated address returned here to *pin* the connection (see
//      `safeFetch` in `./safe-fetch`) rather than re-resolving the hostname
//      a second time — re-resolving is vulnerable to DNS rebinding, since
//      the validation-time answer and the connect-time answer are not
//      guaranteed to be the same address. Callers that cannot pin a
//      connection (e.g. handing the URL to a headless browser's own
//      navigation, which does its own DNS resolution outside this process's
//      control) still get meaningful protection from this check — it closes
//      off the static private-range/metadata/non-http cases this finding is
//      about, even though a live DNS-rebinding attack against a real-time
//      browser navigation is a narrower residual risk than an un-pinned
//      fetch would carry.

import { promises as dns } from "node:dns";
import net from "node:net";

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfBlockedError";
  }
}

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

export function isBlockedIP(ip: string): boolean {
  if (net.isIPv4(ip)) return isBlockedIPv4(ip);
  if (net.isIPv6(ip)) return isBlockedIPv6(ip);
  return true; // couldn't classify => fail closed
}

export interface ValidatedAddress {
  address: string;
  family: 4 | 6;
}

/**
 * Resolve `hostname` and return the first validated, non-blocked address.
 * Throws {@link SsrfBlockedError} if the hostname is an IP literal that's
 * blocked, or if DNS resolution returns no allowed address.
 */
export async function resolveValidatedAddress(hostname: string): Promise<ValidatedAddress> {
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
 * Validates that `url` is safe for the server to connect to: http/https
 * only, hostname does not resolve to a private/reserved/loopback/link-local
 * address (including a raw blocked IP literal). Throws
 * {@link SsrfBlockedError} on any violation; resolves with the validated
 * address on success.
 *
 * Use this directly for call sites that hand the URL off to something other
 * than this module's own `safeFetch` (e.g. a headless-browser `page.goto`),
 * where the connection itself can't be pinned to the validated address.
 */
export async function assertUrlSafe(url: string): Promise<ValidatedAddress> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SsrfBlockedError(`Not a valid URL: ${url}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SsrfBlockedError(
      `Unsupported protocol: ${parsed.protocol} — only http/https are allowed.`,
    );
  }

  return resolveValidatedAddress(parsed.hostname);
}
