import { NextResponse } from "next/server";
import dns from "node:dns/promises";
import { isIP } from "node:net";

import { requireRole } from "@/lib/auth/role-gate";

// SSRF guard: this endpoint fetches an admin-supplied URL server-side, which
// would otherwise let an org admin probe internal network services or the
// cloud metadata endpoint (169.254.169.254) and have the response echoed
// back. Block loopback/private/link-local/metadata ranges before fetching.
// Resolve-then-check has a DNS-rebinding gap (the name could re-resolve to a
// different address between this check and `fetch()`) - acceptable for this
// admin-only, low-volume "test connection" action, not a hardened egress proxy.
const BLOCKED_IPV4_RANGES: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
];

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function isBlockedIpv4(ip: string): boolean {
  const target = ipv4ToInt(ip);
  return BLOCKED_IPV4_RANGES.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (target & mask) === (ipv4ToInt(base) & mask);
  });
}

function isBlockedIpv6(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower === "::1") return true;
  if (lower.startsWith("fe80:")) return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("::ffff:")) return isBlockedIpv4(lower.slice(7));
  return false;
}

async function assertSafeTargetUrl(rawUrl: string): Promise<void> {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("blocked_target");
  }

  const hostname = url.hostname;
  const ipFamily = isIP(hostname);
  if (ipFamily) {
    if (ipFamily === 4 ? isBlockedIpv4(hostname) : isBlockedIpv6(hostname)) {
      throw new Error("blocked_target");
    }
    return;
  }

  const lowerHost = hostname.toLowerCase();
  if (lowerHost === "localhost" || lowerHost.endsWith(".localhost")) {
    throw new Error("blocked_target");
  }

  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  for (const { address, family } of records) {
    if (family === 4 && isBlockedIpv4(address)) throw new Error("blocked_target");
    if (family === 6 && isBlockedIpv6(address)) throw new Error("blocked_target");
  }
}

// Custom API test endpoint.
//
// POST { base_url, auth_type, auth_config } — makes one GET request to the
// supplied URL using the supplied credentials and returns the raw JSON (or
// plain text) response for the user to inspect before saving the connection.
// This runs server-side to bypass CORS restrictions on the target API.
//
// The connection need not be saved first; this endpoint works with form data
// entered but not yet persisted, satisfying the "Test Connection" requirement
// in the Add Connection modal (AGENTS.md Agent 19).
//
// auth_config.key / .token is accepted in plaintext here because this endpoint
// is invoked BEFORE saving, when the user still has the key in the form field.
// After save the key is masked and the user would re-enter it to re-test.

export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST(request: Request) {
  const gate = await requireRole("admin");
  if ("error" in gate) return gate.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body.", "invalid_body", 400);
  }

  const { base_url, auth_type, auth_config } = (body ?? {}) as Record<
    string,
    unknown
  >;

  if (typeof base_url !== "string" || !base_url.trim()) {
    return jsonError("base_url is required.", "missing_field", 400);
  }

  try {
    await assertSafeTargetUrl(base_url.trim());
  } catch {
    return jsonError(
      "This URL cannot be tested (invalid or blocked target).",
      "blocked_target",
      400,
    );
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  const cfg = ((auth_config ?? {}) as Record<string, string>);

  if (auth_type === "api_key") {
    const headerName = cfg.header_name ?? "X-Api-Key";
    const key = cfg.key ?? "";
    if (key) headers[headerName] = key;
  } else if (auth_type === "bearer" || auth_type === "oauth") {
    const token = cfg.token ?? cfg.key ?? "";
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  try {
    const response = await fetch(base_url.trim(), {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(15_000),
    });

    const text = await response.text();
    let preview: unknown;
    let isJson = false;
    try {
      preview = JSON.parse(text) as unknown;
      isJson = true;
    } catch {
      preview = text.slice(0, 1000);
    }

    return NextResponse.json({
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      isJson,
      preview,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Request failed.";
    return NextResponse.json({
      ok: false,
      status: 0,
      statusText: "Network Error",
      isJson: false,
      preview: message,
    });
  }
}
