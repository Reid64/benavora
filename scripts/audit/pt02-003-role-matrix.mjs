// ============================================================================
// PT-02-003 -- role-tier enforcement matrix over admin/owner-gated routes
//
// For every admin- or owner-gated route (requireRole("admin") / requireRole("owner"))
// found by static extraction from test-evidence/pt-02/api-routes.json (cross-checked
// by hand against every one of the 49 route files -- see ROUTE_TIER_ENTRIES below and
// its header note), calls it with a REAL, authenticated session at every role tier
// at or below the required tier plus every tier above it (viewer/writer/admin/owner --
// full coverage, not a sample), and records whether the route refuses below-tier
// callers and permits at-or-above-tier callers.
//
// LOCAL/BRANCH ONLY. This script provisions its own throwaway organization and 4
// role-differentiated auth users (viewer/writer/admin/owner) against whatever
// Supabase instance LOCAL_SUPABASE_URL points at -- it must NEVER be pointed at
// production (vbjplpquqxxfbpazyalt). See the "Setup" section of this file's header
// and test-evidence/pt-02/BRANCH_STRATEGY.md for how the target instance was
// provisioned for this audit (a local `supabase start` stack, not a production
// Supabase branch -- no Supabase branch was created or billed for this pass).
//
// Real sessions, not simulated: each role's Cookie header is derived via the actual,
// unmodified @supabase/ssr `createServerClient` machinery (the identical code path
// src/lib/supabase/server.ts's createClient() reads from on the app side) fed a real
// access_token/refresh_token pair from a real signInWithPassword() call against the
// target Supabase Auth instance. The app under test is the real, unmodified Next.js
// app (a second `next dev` instance pointed at the target Supabase project via env
// vars passed directly to the child process -- .env.local, which points at
// production, is never read or modified).
//
// What "refused" vs "permitted" means here, precisely: requireRole() (src/lib/auth/
// role-gate.ts) returns a specific, distinguishable 403 { error, code: "forbidden" }
// when the caller's role is below the required tier, and returns nothing (falls
// through to the route's own logic) otherwise. A below-tier call that reaches
// business logic and then 500s for an unrelated reason (e.g. a downstream table this
// audit's minimal local schema doesn't have) still cleared the role gate -- that is a
// genuine "permitted" result for the purposes of this audit, not a false pass. Verdict
// is derived from the specific (status, code) pair, not from the overall HTTP status
// alone, so an unrelated downstream 500 can never be misread as a refusal.
//
// Writes test-evidence/pt-02/role-matrix.json: one row per (path, method, role_tested)
// combination: { path, method, required_tier, role_tested, status, expected, verdict }.
// ASCII only. Node 20 compatible.
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ws from "ws";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..", "..");
const OUT_PATH = path.join(REPO_ROOT, "test-evidence", "pt-02", "role-matrix.json");

const PROD_URL_FRAGMENT = "vbjplpquqxxfbpazyalt";
const LOCAL_URL = process.env.LOCAL_SUPABASE_URL;
const LOCAL_ANON_KEY = process.env.LOCAL_SUPABASE_ANON_KEY;
const LOCAL_SERVICE_KEY = process.env.LOCAL_SUPABASE_SERVICE_ROLE_KEY;
const BASE_URL = process.env.PT02_BASE_URL || "http://localhost:3099";

if (!LOCAL_URL || !LOCAL_ANON_KEY || !LOCAL_SERVICE_KEY) {
  console.error(
    "Missing LOCAL_SUPABASE_URL / LOCAL_SUPABASE_ANON_KEY / LOCAL_SUPABASE_SERVICE_ROLE_KEY.\n" +
      "This script provisions real test users and MUST be pointed at a local/branch\n" +
      "Supabase instance, never production. See BRANCH_STRATEGY.md for how to provision one.",
  );
  process.exit(1);
}
if (LOCAL_URL.includes(PROD_URL_FRAGMENT)) {
  console.error(
    `HARD STOP: LOCAL_SUPABASE_URL contains the production project ref (${PROD_URL_FRAGMENT}). ` +
      "This script creates real auth users and must never target production. Aborting.",
  );
  process.exit(1);
}
if (BASE_URL.includes(PROD_URL_FRAGMENT) || /benavora\.com/.test(BASE_URL)) {
  console.error(
    "HARD STOP: PT02_BASE_URL looks like a production Benavora host. Aborting.",
  );
  process.exit(1);
}

// Node 20 has no native WebSocket; supabase-js eagerly constructs a RealtimeClient
// even when Realtime is never used. Same workaround already established in
// src/lib/supabase/admin.ts.
const REALTIME_OPT = { realtime: { transport: ws } };

const ROLES = ["viewer", "writer", "admin", "owner"];
const ROLE_RANK = { viewer: 1, writer: 2, admin: 3, owner: 4 }; // mirrors src/lib/utils/constants.ts ROLE_HIERARCHY
const PASSWORD = "Pt02RoleMatrix!2026";

// ----------------------------------------------------------------------------
// Route -> required-tier map. Derived from test-evidence/pt-02/api-routes.json's
// requireRole classification, narrowed to the admin/owner tiers, then verified
// per-method (not just per-file) by reading every one of the 49 files directly --
// api-routes.json's `tiers` field is a per-FILE set (a file can call requireRole
// with different tiers on different exported methods), so per-method assignment
// here was built by locating each requireRole("tier") call site relative to its
// enclosing exported GET/POST/PATCH/PUT/DELETE function.
//
// Three entries needed manual correction beyond the automated per-method scan:
//   - /api/billing (GET, POST): both route both go through a local `resolveOwner()`
//     helper that calls requireRole("owner") -- not a literal requireRole() call
//     inside the exported function itself, so a naive scan misses it.
//   - /api/autoapply/controls (POST, DELETE): the required tier is chosen at
//     runtime -- `control_type === "platform" ? "admin" : "owner"` -- not a literal
//     string. Both branches are exercised as separate matrix rows below.
// ============================================================================
const ROUTE_TIER_ENTRIES = [
  { path: "/api/admin/audit-log", method: "GET", requiredTier: "admin" },
  { path: "/api/admin/autoapply-ops", method: "GET", requiredTier: "admin" },
  { path: "/api/admin/campaigns", method: "GET", requiredTier: "owner" },
  { path: "/api/admin/campaigns", method: "POST", requiredTier: "owner" },
  { path: "/api/admin/campaigns/[id]", method: "GET", requiredTier: "owner" },
  { path: "/api/admin/campaigns/[id]", method: "PATCH", requiredTier: "owner" },
  { path: "/api/admin/campaigns/[id]", method: "POST", requiredTier: "owner" },
  { path: "/api/admin/command-center", method: "GET", requiredTier: "owner" },
  { path: "/api/admin/domains", method: "GET", requiredTier: "owner" },
  { path: "/api/admin/domains", method: "POST", requiredTier: "owner" },
  { path: "/api/admin/domains/[id]", method: "GET", requiredTier: "owner" },
  { path: "/api/admin/domains/[id]", method: "PATCH", requiredTier: "owner" },
  { path: "/api/admin/domains/[id]", method: "DELETE", requiredTier: "owner" },
  { path: "/api/admin/improvements", method: "GET", requiredTier: "admin" },
  { path: "/api/admin/improvements/[id]", method: "PATCH", requiredTier: "admin" },
  { path: "/api/admin/jobs/[id]/retry", method: "POST", requiredTier: "admin" },
  { path: "/api/admin/monitor", method: "GET", requiredTier: "admin" },
  { path: "/api/admin/orgs", method: "GET", requiredTier: "owner" },
  { path: "/api/admin/orgs/[id]", method: "GET", requiredTier: "owner" },
  { path: "/api/admin/orgs/[id]", method: "POST", requiredTier: "owner" },
  { path: "/api/admin/orgs/[id]/impersonate", method: "POST", requiredTier: "owner" },
  { path: "/api/admin/orgs/[id]/impersonate", method: "DELETE", requiredTier: "owner" },
  { path: "/api/admin/orgs/[id]/suspend", method: "POST", requiredTier: "owner" },
  { path: "/api/admin/platform-metrics", method: "GET", requiredTier: "owner" },
  { path: "/api/admin/prospects", method: "GET", requiredTier: "owner" },
  { path: "/api/admin/prospects", method: "POST", requiredTier: "owner" },
  { path: "/api/admin/prospects/[id]", method: "GET", requiredTier: "owner" },
  { path: "/api/admin/prospects/[id]", method: "PATCH", requiredTier: "owner" },
  { path: "/api/admin/prospects/[id]", method: "DELETE", requiredTier: "owner" },
  { path: "/api/admin/prospects/stats", method: "GET", requiredTier: "owner" },
  { path: "/api/admin/sales-analytics", method: "GET", requiredTier: "owner" },
  { path: "/api/admin/sales-analytics/export", method: "GET", requiredTier: "owner" },
  { path: "/api/admin/suppression", method: "GET", requiredTier: "owner" },
  { path: "/api/admin/suppression", method: "POST", requiredTier: "owner" },
  { path: "/api/admin/suppression/import", method: "POST", requiredTier: "owner" },
  { path: "/api/admin/system", method: "GET", requiredTier: "admin" },
  { path: "/api/admin/system", method: "POST", requiredTier: "owner" },
  { path: "/api/admin/usage", method: "GET", requiredTier: "admin" },
  { path: "/api/agents/automation/[sessionId]/approve", method: "POST", requiredTier: "admin" },
  { path: "/api/autoapply/config", method: "POST", requiredTier: "admin" },
  { path: "/api/autoapply/controls", method: "GET", requiredTier: "owner" },
  { path: "/api/autoapply/mode", method: "POST", requiredTier: "admin" },
  { path: "/api/autoapply/usage/keys", method: "POST", requiredTier: "admin" },
  { path: "/api/autoapply/usage/keys", method: "PATCH", requiredTier: "admin" },
  { path: "/api/autoapply/webhooks", method: "POST", requiredTier: "admin" },
  { path: "/api/autoapply/webhooks", method: "DELETE", requiredTier: "admin" },
  { path: "/api/command-center/layout", method: "GET", requiredTier: "owner" },
  { path: "/api/command-center/layout", method: "PUT", requiredTier: "owner" },
  { path: "/api/consultant/clients", method: "GET", requiredTier: "admin" },
  { path: "/api/consultant/clients", method: "POST", requiredTier: "admin" },
  { path: "/api/consultant/clients", method: "DELETE", requiredTier: "admin" },
  { path: "/api/drafts/queue/config", method: "PATCH", requiredTier: "admin" },
  { path: "/api/integrations/custom-api", method: "POST", requiredTier: "admin" },
  { path: "/api/integrations/custom-api/[id]", method: "PATCH", requiredTier: "admin" },
  { path: "/api/integrations/custom-api/[id]", method: "DELETE", requiredTier: "admin" },
  { path: "/api/integrations/custom-api/allowlist", method: "POST", requiredTier: "admin" },
  { path: "/api/integrations/custom-api/allowlist/[id]", method: "DELETE", requiredTier: "admin" },
  { path: "/api/integrations/custom-api/test", method: "POST", requiredTier: "admin" },
  { path: "/api/integrations/google", method: "POST", requiredTier: "admin" },
  { path: "/api/integrations/keys", method: "POST", requiredTier: "admin" },
  { path: "/api/integrations/scraping-targets", method: "POST", requiredTier: "admin" },
  { path: "/api/integrations/scraping-targets/[id]", method: "PATCH", requiredTier: "admin" },
  { path: "/api/integrations/scraping-targets/[id]", method: "DELETE", requiredTier: "admin" },
  { path: "/api/intelligence/proposals", method: "POST", requiredTier: "owner" },
  { path: "/api/settings/agents/relationship-builder-v2", method: "GET", requiredTier: "admin" },
  { path: "/api/settings/agents/relationship-builder-v2", method: "PATCH", requiredTier: "admin" },
  { path: "/api/stripe/create-portal-session", method: "POST", requiredTier: "owner" },
  { path: "/api/users", method: "PUT", requiredTier: "admin" },
  { path: "/api/users", method: "DELETE", requiredTier: "owner" },
  { path: "/api/users/invite", method: "POST", requiredTier: "admin" },
  {
    path: "/api/billing",
    method: "GET",
    requiredTier: "owner",
    note: "requireRole inside resolveOwner() helper, not a literal call inside the exported function",
  },
  {
    path: "/api/billing",
    method: "POST",
    requiredTier: "owner",
    note: "requireRole inside resolveOwner() helper, not a literal call inside the exported function",
  },
  {
    path: "/api/autoapply/controls",
    method: "POST",
    requiredTier: "owner",
    note: 'required tier is dynamic (control_type==="platform"?"admin":"owner"); this row uses control_type="tenant" to exercise the owner branch',
    bodyOverride: { control_type: "tenant", target_id: "00000000-0000-0000-0000-000000000000", reason: "pt02-003 role matrix" },
  },
  {
    path: "/api/autoapply/controls",
    method: "DELETE",
    requiredTier: "owner",
    note: 'required tier is dynamic (control_type==="platform"?"admin":"owner"); this row uses control_type="tenant" to exercise the owner branch',
    bodyOverride: { control_type: "tenant", target_id: "00000000-0000-0000-0000-000000000000" },
  },
  {
    path: "/api/autoapply/controls",
    method: "POST",
    requiredTier: "admin",
    note: 'required tier is dynamic (control_type==="platform"?"admin":"owner"); this row uses control_type="platform" to exercise the admin branch',
    bodyOverride: { control_type: "platform", reason: "pt02-003 role matrix" },
  },
  {
    path: "/api/autoapply/controls",
    method: "DELETE",
    requiredTier: "admin",
    note: 'required tier is dynamic (control_type==="platform"?"admin":"owner"); this row uses control_type="platform" to exercise the admin branch',
    bodyOverride: { control_type: "platform" },
  },
];

const PLACEHOLDER_UUID = "00000000-0000-0000-0000-000000000000";
function fillDynamicSegments(routePath) {
  return routePath.replace(/\[[^\]]+\]/g, PLACEHOLDER_UUID);
}

// ----------------------------------------------------------------------------
// Setup: provision one throwaway org + 4 role-differentiated users, sign each
// in for real, and derive a real Cookie header per role via the unmodified
// @supabase/ssr createServerClient machinery.
// ----------------------------------------------------------------------------
async function setupSessions() {
  const admin = createServiceClient(LOCAL_URL, LOCAL_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    ...REALTIME_OPT,
  });

  console.log("PT-02-003: provisioning test org + role-differentiated users...");

  // Re-runnable: clean up any prior run's users/profiles/org first.
  const { data: existingUsers } = await admin.auth.admin.listUsers();
  for (const u of existingUsers?.users ?? []) {
    if (u.email && u.email.endsWith("@role-matrix.local")) {
      await admin.auth.admin.deleteUser(u.id);
    }
  }
  await admin.from("organizations").delete().eq("name", "PT-02-003 Role Matrix Test Org");

  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .insert({ name: "PT-02-003 Role Matrix Test Org" })
    .select("id")
    .single();
  if (orgErr) throw new Error("org insert failed: " + orgErr.message);

  const sessions = {};
  for (const role of ROLES) {
    const email = `pt02-003-${role}@role-matrix.local`;
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    if (createErr) throw new Error(`createUser(${role}) failed: ${createErr.message}`);
    const userId = created.user.id;

    const { error: profileErr } = await admin.from("profiles").insert({
      id: userId,
      organization_id: org.id,
      email,
      full_name: `PT-02-003 ${role}`,
      role,
    });
    if (profileErr) throw new Error(`profile insert(${role}) failed: ${profileErr.message}`);

    const anonClient = createServiceClient(LOCAL_URL, LOCAL_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
      ...REALTIME_OPT,
    });
    const { data: signIn, error: signInErr } = await anonClient.auth.signInWithPassword({
      email,
      password: PASSWORD,
    });
    if (signInErr) throw new Error(`signIn(${role}) failed: ${signInErr.message}`);

    const jar = new Map();
    const ssrClient = createServerClient(LOCAL_URL, LOCAL_ANON_KEY, {
      ...REALTIME_OPT,
      cookies: {
        getAll() {
          return Array.from(jar.entries()).map(([name, value]) => ({ name, value }));
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) jar.set(name, value);
        },
      },
    });
    const { error: setSessionErr } = await ssrClient.auth.setSession({
      access_token: signIn.session.access_token,
      refresh_token: signIn.session.refresh_token,
    });
    if (setSessionErr) throw new Error(`setSession(${role}) failed: ${setSessionErr.message}`);

    const cookieHeader = Array.from(jar.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
    if (!cookieHeader) throw new Error(`no cookies captured for ${role}`);

    sessions[role] = { userId, email, cookieHeader };
    console.log(`  ${role}: userId=${userId}`);
  }

  return { orgId: org.id, sessions };
}

// ----------------------------------------------------------------------------
// Sweep
// ----------------------------------------------------------------------------
function verdictFor(requiredTier, roleTested, status, code) {
  const shouldPermit = ROLE_RANK[roleTested] >= ROLE_RANK[requiredTier];
  const wasRefusedByRoleGate = status === 403 && code === "forbidden";
  const expected = shouldPermit ? "permit" : "refuse";
  const actual = wasRefusedByRoleGate ? "refuse" : "permit";

  if (expected === actual) return "PASS";
  if (expected === "refuse" && actual === "permit") {
    // Below-tier role was NOT refused by the role gate -- the finding this
    // audit exists to catch.
    return requiredTier === "admin" || requiredTier === "owner" ? "FINDING_P0" : "FINDING_P1";
  }
  // expected === "permit" && actual === "refuse": an at-or-above-tier role
  // was incorrectly blocked. Also a real bug, but the opposite failure mode
  // from what this task's register scope targets -- recorded distinctly so
  // it is never silently dropped, without being double-counted as the
  // under-enforcement finding this audit is scoped to find.
  return "FINDING_OVER_RESTRICTIVE";
}

async function testEntry(entry, role, cookieHeader) {
  const url = BASE_URL + fillDynamicSegments(entry.path);
  const fetchOpts = {
    method: entry.method,
    redirect: "manual",
    headers: { Accept: "application/json", Cookie: cookieHeader },
  };
  if (entry.method !== "GET") {
    fetchOpts.headers["Content-Type"] = "application/json";
    fetchOpts.body = JSON.stringify(entry.bodyOverride ?? {});
  }

  const row = {
    path: entry.path,
    method: entry.method,
    required_tier: entry.requiredTier,
    role_tested: role,
    status: null,
    code: null,
    expected: ROLE_RANK[role] >= ROLE_RANK[entry.requiredTier] ? "permit" : "refuse",
    verdict: null,
  };
  if (entry.note) row.note = entry.note;

  try {
    const resp = await fetch(url, fetchOpts);
    row.status = resp.status;
    let bodyJson = null;
    try {
      bodyJson = await resp.json();
    } catch {
      // non-JSON body is fine -- code stays null, verdictFor treats that as "permitted"
    }
    row.code = bodyJson && typeof bodyJson === "object" ? bodyJson.code ?? null : null;
    row.verdict = verdictFor(entry.requiredTier, role, row.status, row.code);
    if (row.verdict !== "PASS") {
      row.bodySnippet = bodyJson ? JSON.stringify(bodyJson).slice(0, 500) : null;
    }
  } catch (err) {
    row.status = null;
    row.verdict = "REVIEW";
    row.error = `fetch failed: ${String(err.message ?? err).split("\n")[0]}`;
  }

  return row;
}

async function main() {
  console.log(`PT-02-003: role-tier enforcement matrix`);
  console.log(`  Target Supabase (LOCAL/BRANCH ONLY): ${LOCAL_URL}`);
  console.log(`  App under test: ${BASE_URL}`);
  console.log(`  ${ROUTE_TIER_ENTRIES.length} route+method entries x ${ROLES.length} roles = ${ROUTE_TIER_ENTRIES.length * ROLES.length} calls\n`);

  const { orgId, sessions } = await setupSessions();

  console.log("\nPT-02-003: sweeping...");
  const results = [];
  let done = 0;
  const total = ROUTE_TIER_ENTRIES.length * ROLES.length;
  for (const entry of ROUTE_TIER_ENTRIES) {
    for (const role of ROLES) {
      const row = await testEntry(entry, role, sessions[role].cookieHeader);
      results.push(row);
      done++;
      if (done % 40 === 0 || done === total) console.log(`  ${done}/${total} tested...`);
    }
  }

  const verdictCounts = {};
  for (const r of results) verdictCounts[r.verdict] = (verdictCounts[r.verdict] || 0) + 1;
  const p0Findings = results.filter((r) => r.verdict === "FINDING_P0");
  const p1Findings = results.filter((r) => r.verdict === "FINDING_P1");
  const overRestrictive = results.filter((r) => r.verdict === "FINDING_OVER_RESTRICTIVE");
  const reviewRows = results.filter((r) => r.verdict === "REVIEW");

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(
    OUT_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        baseUrl: BASE_URL,
        targetSupabaseUrl: LOCAL_URL,
        note:
          "LOCAL/BRANCH ONLY. Roles tested against a throwaway org+users provisioned by " +
          "this same script on the target Supabase instance -- never production. " +
          "Real roles: viewer, writer, admin, owner (src/lib/utils/constants.ts " +
          "ROLE_HIERARCHY) -- the task's 'member' tier does not exist in this app; " +
          "'writer' is the equivalent middle tier.",
        testOrgId: orgId,
        rolesCovered: ROLES,
        roleHierarchy: ROLE_RANK,
        entryCount: ROUTE_TIER_ENTRIES.length,
        totalRows: results.length,
        verdictCounts,
        p0FindingCount: p0Findings.length,
        p1FindingCount: p1Findings.length,
        overRestrictiveCount: overRestrictive.length,
        reviewCount: reviewRows.length,
        results,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(`\nPT-02-003 DONE: ${results.length} rows written to ${path.relative(REPO_ROOT, OUT_PATH)}`);
  console.log(`  Verdict counts: ${JSON.stringify(verdictCounts)}`);
  if (p0Findings.length > 0) {
    console.log(`\n  *** ${p0Findings.length} P0 FINDING(S) -- below-tier role permitted on an admin/owner route ***`);
    for (const f of p0Findings) console.log(`    [${f.method}] ${f.path} required=${f.required_tier} role=${f.role_tested} -> HTTP ${f.status} code=${f.code}`);
  }
  if (p1Findings.length > 0) {
    console.log(`\n  ${p1Findings.length} P1 FINDING(S):`);
    for (const f of p1Findings) console.log(`    [${f.method}] ${f.path} required=${f.required_tier} role=${f.role_tested} -> HTTP ${f.status} code=${f.code}`);
  }
  if (overRestrictive.length > 0) {
    console.log(`\n  ${overRestrictive.length} over-restrictive row(s) (an at/above-tier role was incorrectly blocked):`);
    for (const f of overRestrictive) console.log(`    [${f.method}] ${f.path} required=${f.required_tier} role=${f.role_tested} -> HTTP ${f.status} code=${f.code}`);
  }
  if (reviewRows.length > 0) {
    console.log(`\n  ${reviewRows.length} row(s) need manual REVIEW (fetch error):`);
    for (const r of reviewRows) console.log(`    [${r.method}] ${r.path} role=${r.role_tested} ${r.error || ""}`);
  }
  if (p0Findings.length === 0 && p1Findings.length === 0) {
    console.log("\n  No under-enforcement findings.");
  }
}

main().catch((err) => {
  console.error("PT-02-003 FATAL:", err);
  process.exit(1);
});
