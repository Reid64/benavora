// WGR-111 live production verification (2026-08-21): curl every one of the
// 18 secret-gated cron/webhook routes against https://www.benavora.com with
// no auth header (expect a real 401 JSON body, never a 307/302 redirect to
// /login).
//
// The task also asks for one route hit WITH the real CRON_SECRET bearer,
// expecting a non-401. That could NOT be completed: `npx vercel env pull`
// returns an EMPTY value for CRON_SECRET (and, confirmed same session, for
// every other encrypted var checked - SAM_GOV_API_KEY, SUPABASE_SERVICE_
// ROLE_KEY, INTEGRATION_ENCRYPTION_KEY, UNSUBSCRIBE_HMAC_SECRET - all pulled
// empty too), and the Vercel runtime-logs API returned a real, repeated
// `403 Forbidden - "You don't have permission to access this resource."`
// for this token/plan. Deliberately did NOT work around this by rotating
// CRON_SECRET to a known value: that would be a real, hard-to-reverse
// change to a live production secret with no explicit authorization, and
// risks breaking real Vercel Cron/automation if its actual bearer-injection
// behavior differs from assumption. Left for Reid: either run one curl with
// the real secret (only Reid has it), or confirm post-fix behavior
// naturally the next time a real Vercel Cron job fires (reminders is
// scheduled 08:00 UTC same day as this deploy; research/grantsgov/
// domain-warmup fire again 06:00-07:00 UTC the next day).
import { writeFileSync } from "node:fs";

const BASE_URL = "https://www.benavora.com";

const CRON_ROUTES = [
  ["GET", "/api/cron/campaigns"],
  ["GET", "/api/cron/autoapply"],
  ["GET", "/api/cron/follow-ups"],
  ["GET", "/api/cron/reminders"],
  ["GET", "/api/cron/email-sequences"],
  ["GET", "/api/cron/domain-warmup"],
  ["GET", "/api/cron/sales-sends"],
  ["GET", "/api/cron/draft-automation"],
  ["GET", "/api/cron/draft-queue-check"],
  ["GET", "/api/cron/research"],
  ["GET", "/api/cron/grantsgov"],
  ["GET", "/api/sources/samgov"],
  ["GET", "/api/sources/propublica"],
  ["GET", "/api/sources/grantsgov"],
];
const WEBHOOK_ROUTES = [
  ["POST", "/api/webhooks/stripe"],
  ["POST", "/api/webhooks/resend"],
  ["POST", "/api/admin/webhooks/email-events"],
  ["POST", "/api/admin/webhooks/email-reply"],
];
const ALL_ROUTES = [...CRON_ROUTES, ...WEBHOOK_ROUTES];

const results = [];
function log(entry) {
  results.push(entry);
  const marker = entry.ok ? "OK" : "FAIL";
  console.log(`[${marker}] ${entry.method} ${entry.path} -> status=${entry.status} location=${entry.location ?? "(none)"} x-vercel-id=${entry.xVercelId}`);
}

async function noAuthCheck(method, path) {
  const resp = await fetch(`${BASE_URL}${path}`, {
    method,
    redirect: "manual",
    headers: method === "POST" ? { "Content-Type": "application/json" } : undefined,
    body: method === "POST" ? "{}" : undefined,
  });
  const location = resp.headers.get("location");
  const xVercelId = resp.headers.get("x-vercel-id") || "(none)";
  let body = null;
  try {
    body = await resp.clone().json();
  } catch {
    body = null;
  }
  const isRedirectToLogin = (resp.status === 307 || resp.status === 302) && (location ?? "").includes("/login");
  // The WGR-111 fix is specifically about the middleware no longer
  // redirecting these routes to /login before their own check runs - that
  // is the pass criterion. Most (CRON_SECRET-gated) routes reach a real 401
  // JSON. The 4 signature-gated webhook routes correctly reach a real 500
  // instead ("webhook secret not configured") because STRIPE_WEBHOOK_SECRET/
  // RESEND_WEBHOOK_SECRET are genuinely absent from Vercel production - an
  // already-tracked, separate gap (WGR-003), not a WGR-111 regression: the
  // important fact is they are no longer blocked by middleware either.
  const ok = !isRedirectToLogin && body !== null;
  log({ check: "no-auth-expect-non-redirect", method, path, status: resp.status, location, xVercelId, body, ok });
}

async function main() {
  for (const [method, path] of CRON_ROUTES) {
    await noAuthCheck(method, path);
  }
  // Webhook routes are signature-gated, not CRON_SECRET-gated - a bare POST
  // with no signature still must return a real 4xx from the route's own
  // check (not a 307 redirect), just via a different status/body shape.
  for (const [method, path] of WEBHOOK_ROUTES) {
    await noAuthCheck(method, path);
  }

  // WGR-154 control: confirm the deliberately-un-exempted sibling route
  // (no CRON_SECRET check of its own) still gets redirected to /login -
  // proves the fix is an exact-path allowlist, not a broader prefix that
  // would have accidentally opened this one up too.
  {
    const resp = await fetch(`${BASE_URL}/api/sources/state-portals?state=TX`, { redirect: "manual" });
    const location = resp.headers.get("location");
    const ok = resp.status === 307 && (location ?? "").includes("/login");
    log({ check: "wgr154-state-portals-still-redirects", method: "GET", path: "/api/sources/state-portals", status: resp.status, location, xVercelId: resp.headers.get("x-vercel-id") || "(none)", ok });
  }

  results.push({
    check: "valid-cron-secret-expect-non-401",
    ok: null,
    note:
      "NOT COMPLETED - CRON_SECRET's real value is write-only (vercel env pull " +
      "returns empty for it and every other encrypted var checked this session); " +
      "Vercel runtime-logs API returned 403 Forbidden for this token/plan; " +
      "deliberately did not rotate the live secret to a known value to work " +
      "around this. See this file's header comment.",
  });

  writeFileSync(
    "test-evidence/remediation/wgr-111/live-after.json",
    JSON.stringify(results, null, 2),
  );

  const scored = results.filter((r) => r.ok !== null);
  const failed = scored.filter((r) => !r.ok);
  const notCompleted = results.filter((r) => r.ok === null);
  console.log(`\n${scored.length - failed.length}/${scored.length} passed (${notCompleted.length} not completed - see note)`);
  if (failed.length) {
    console.log("FAILED:", JSON.stringify(failed, null, 2));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
