// ============================================================================
// PT-10-001 -- malformed-payload fuzz across a representative set of API
// input surfaces (drawn from PT-02's api-routes.json).
//
// Behavior only, per this task's own scope note -- injection-shaped strings
// here are testing whether the app crashes or silently corrupts state on
// them, NOT whether they are actually exploitable (that depth is PT-14's
// job; PT-14's own evidence -- test-evidence/pt-14/ -- already covers SQLi/
// XSS/CSRF/SSRF exploitability directly against this same app).
//
// LOCAL/BRANCH ONLY, same hard rule as every PT-02/PT-05 write-test script
// (test-evidence/pt-02/BRANCH_STRATEGY.md): this script sends real requests
// carrying deliberately-broken bodies against a throwaway org+user on a
// LOCAL Supabase stack (`.pt05-local-stack`, already running via
// `npx supabase status --workdir .pt05-local-stack` at the time this was
// written) and a SECOND, ISOLATED `next dev` instance (its own port, its own
// build output directory via next.config.mjs's PT_AUDIT_DIST_DIR hook -- see
// that file's header comment) -- never production (vbjplpquqxxfbpazyalt),
// never the shared dev server other work in this checkout may be using on
// port 3000 (which points at production per .env.local and would violate
// BRANCH_STRATEGY.md's hard rule if targeted). This script does NOT start
// that isolated dev server itself -- it must already be listening at
// PT10_BASE_URL (default http://localhost:3299) when this script runs. See
// this file's own companion runbook note in test-evidence/pt-10/ for the
// exact launch command used.
//
// Route selection (18 routes, "judgment, cover what a real user creates/
// edits" per this task's own PT-02-style precedent): every mutation route
// candidate was first filtered to exclude webhook_signature/cron_secret/
// oauth_code_exchange auth mechanisms (a malformed BODY test is meaningless
// against a route that 401s on auth before ever reading the body) -- except
// POST /api/notifications, deliberately kept as the one CRON_SECRET-gated
// case, exercised with a real bearer token instead of a cookie, specifically
// to get body-validation coverage on a non-requireRole auth mechanism too.
// Every route's actual request.json()/typeof-check logic was read directly
// from its route.ts source before any case for it was written (not
// guessed) -- see each case's own `note` field for what specific validation
// line it targets. 2 routes are admin-gated (integrations/custom-api,
// settings/agents/relationship-builder-v2); the rest are writer-gated.
//
// Case categories, per this task's 4 named types, applied per-route based
// on what that route's own code actually validates (a route with no
// numeric field gets no "wrong type on a number" case, etc.) plus a
// standing `invalid_json` case (a syntactically-broken JSON body -- tests
// the request.json().catch() path) on every route:
//   missing_required   -- omit every field a route requires
//   wrong_type         -- swap a required/checked field's JS type
//   oversized          -- a very large (250,000-char) string in a text
//                         field the route does NOT length-cap, deliberately
//                         chosen where that field flows into a typed DB
//                         column (date/timestamp/uuid) so an unformatted
//                         oversized value is a real crash-shaped input, not
//                         just a slow one
//   injection_shaped    -- a SQLi/XSS/path-traversal-shaped string in a
//                         text field, same targeting logic as oversized
//   invalid_json        -- literally-broken JSON text as the raw body
//   non_object_body     -- a top-level JSON array/string instead of object
//
// Verdict logic (recorded per case, never silently dropped):
//   - HTTP 500 on ANY case -> FINDING. A malformed-input case producing a
//     500 is a real bug regardless of whether the 500 is an unhandled crash
//     or the route's own code deliberately mapping a caught exception to a
//     500 status (e.g. integrations/custom-api's allowlist_check_failed) --
//     either way the client got a "your data broke us" response for what
//     should be a "your data is invalid" 400.
//   - HTTP in [300,399] -> FINDING (an unexpected redirect where a JSON
//     error was expected -- most likely a middleware/auth mismatch, not a
//     validation response).
//   - HTTP in [400,499] -> PASS if the body is parseable JSON carrying a
//     non-empty message-shaped field (a "useful error"); PASS_WEAK_ERROR
//     (not a hard FINDING, but flagged) if the status is a clean 4xx with
//     an empty/unparseable body.
//   - HTTP in [200,299] -> depends on the case's own `expectedOutcome`:
//     cases marked "4xx" target a field the route's source code visibly
//     type/required-checks, so a 2xx here means that check did not fire as
//     read -> FINDING. Cases marked "either" (oversized/injection strings
//     aimed at fields the route deliberately has NO app-level format check
//     for, e.g. a free-text `notes` column) are NOT a finding on 2xx by
//     themselves -- recorded as ACCEPTED_NO_VALIDATION (informational,
//     matches the code read) UNLESS the follow-up read (see below) shows
//     the stored value doesn't match what was sent, which IS a FINDING
//     (silent corruption/truncation -- a real "partial write").
//   - fetch() itself throwing/timing out -> FINDING ("no response").
//
// Follow-up partial-write check: any case whose route has a known target
// table (FOLLOWUP_TABLE_BY_ROUTE below) and whose response is 2xx with a
// recognizable id gets a real service-role SELECT on that row afterward,
// comparing the stored value of the field(s) this case sent against what
// was actually POSTed -- catches silent coercion/truncation that a bare
// status-code check would miss.
//
// Writes test-evidence/pt-10/malformed-payloads.json.
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
const OUT_PATH = path.join(REPO_ROOT, "test-evidence", "pt-10", "malformed-payloads.json");

const PROD_URL_FRAGMENT = "vbjplpquqxxfbpazyalt";
const LOCAL_URL = process.env.LOCAL_SUPABASE_URL;
const LOCAL_ANON_KEY = process.env.LOCAL_SUPABASE_ANON_KEY;
const LOCAL_SERVICE_KEY = process.env.LOCAL_SUPABASE_SERVICE_ROLE_KEY;
const BASE_URL = process.env.PT10_BASE_URL || "http://localhost:3299";
const CRON_SECRET = process.env.CRON_SECRET || "";

if (!LOCAL_URL || !LOCAL_ANON_KEY || !LOCAL_SERVICE_KEY) {
  console.error(
    "Missing LOCAL_SUPABASE_URL / LOCAL_SUPABASE_ANON_KEY / LOCAL_SUPABASE_SERVICE_ROLE_KEY.\n" +
      "This script sends real requests against a real local/branch Supabase instance -- it MUST\n" +
      "be pointed at local/branch, never production. See test-evidence/pt-02/BRANCH_STRATEGY.md.",
  );
  process.exit(1);
}
if (LOCAL_URL.includes(PROD_URL_FRAGMENT)) {
  console.error(
    `HARD STOP: LOCAL_SUPABASE_URL contains the production project ref (${PROD_URL_FRAGMENT}). Aborting.`,
  );
  process.exit(1);
}
if (BASE_URL.includes(PROD_URL_FRAGMENT) || /benavora\.com/.test(BASE_URL)) {
  console.error("HARD STOP: PT10_BASE_URL looks like a production Benavora host. Aborting.");
  process.exit(1);
}

// Node 20 has no native WebSocket; supabase-js eagerly constructs a
// RealtimeClient. Same workaround already established in src/lib/supabase/admin.ts.
const REALTIME_OPT = { realtime: { transport: ws } };

const PASSWORD = "Pt10MalformedFuzz!2026";
const TEST_ORG_NAME = "PT-10-001 Malformed Payload Test Org";
const TEST_EMAIL_SUFFIX = "@pt10-malformed.local";

const OVERSIZED = "A".repeat(250000);
const SQLI = "'; DROP TABLE organizations; --";
const XSS = "<script>alert(document.cookie)</script>";
const TRAVERSAL = "../../../../../../etc/passwd";
const FAKE_UUID = "00000000-0000-4000-8000-000000000000";

function snippet(value, max = 400) {
  if (value === undefined) return null;
  const s = typeof value === "string" ? value : JSON.stringify(value);
  if (s.length <= max) return s;
  return `${s.slice(0, max)}...<truncated, total length ${s.length}>`;
}

// ----------------------------------------------------------------------------
// Setup: one throwaway org + writer + admin user, real signed-in sessions via
// the actual @supabase/ssr cookie-derivation code path, plus minimal fixture
// rows (one opportunity, one funder) needed by a couple of the deeper cases.
// ----------------------------------------------------------------------------
async function setup() {
  const admin = createServiceClient(LOCAL_URL, LOCAL_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    ...REALTIME_OPT,
  });

  console.log("PT-10-001: provisioning test org + writer/admin users...");

  const { data: existingUsers } = await admin.auth.admin.listUsers();
  for (const u of existingUsers?.users ?? []) {
    if (u.email && u.email.endsWith(TEST_EMAIL_SUFFIX)) {
      await admin.auth.admin.deleteUser(u.id);
    }
  }
  await admin.from("organizations").delete().eq("name", TEST_ORG_NAME);

  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .insert({ name: TEST_ORG_NAME, onboarding_completed: true })
    .select("id")
    .single();
  if (orgErr) throw new Error("org insert failed: " + orgErr.message);
  const orgId = org.id;

  const sessions = {};
  for (const role of ["writer", "admin"]) {
    const email = `pt10-001-${role}${TEST_EMAIL_SUFFIX}`;
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    if (createErr) throw new Error(`createUser(${role}) failed: ${createErr.message}`);
    const userId = created.user.id;

    const { error: profileErr } = await admin.from("profiles").insert({
      id: userId,
      organization_id: orgId,
      email,
      full_name: `PT-10-001 ${role}`,
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

  console.log("PT-10-001: seeding minimal fixtures (opportunity, funder)...");

  const { data: opp, error: oppErr } = await admin
    .from("opportunities")
    .insert({
      organization_id: orgId,
      name: "PT-10-001 fixture opportunity",
      category: "housing_grant",
      status: "open",
    })
    .select("id")
    .single();
  if (oppErr) throw new Error("fixture opportunity insert failed: " + oppErr.message);

  const { data: funder, error: funderErr } = await admin
    .from("funders")
    .insert({
      organization_id: orgId,
      name: "PT-10-001 Fixture Funder",
      category: "housing_grant",
    })
    .select("id")
    .single();
  if (funderErr) throw new Error("fixture funder insert failed: " + funderErr.message);

  console.log(`  opportunity=${opp.id} funder=${funder.id}`);

  return {
    admin,
    orgId,
    sessions,
    fixtures: { opportunityId: opp.id, funderId: funder.id },
  };
}

// ----------------------------------------------------------------------------
// HTTP helper. Supports a real JSON body, a raw (possibly syntactically
// broken) text body, and an explicit override of the JSON.stringify()'d
// body when the "body" itself must be a non-object (array/string/number).
// ----------------------------------------------------------------------------
async function call({ method, urlPath, cookieHeader, bearerToken, bodyKind, body }) {
  const url = BASE_URL + urlPath;
  const headers = { Accept: "application/json" };
  if (cookieHeader) headers.Cookie = cookieHeader;
  if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;

  const opts = { method, redirect: "manual", headers };
  if (bodyKind === "raw") {
    headers["Content-Type"] = "application/json";
    opts.body = body; // deliberately-broken raw text, sent as-is
  } else if (bodyKind === "json") {
    headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  // bodyKind === "none" -> no body at all

  let res;
  try {
    res = await fetch(url, opts);
  } catch (err) {
    return { networkError: err.message };
  }

  const contentType = res.headers.get("content-type") || "";
  let parsedBody = null;
  let rawText = "";
  try {
    rawText = await res.text();
    if (contentType.includes("application/json") && rawText.trim() !== "") {
      parsedBody = JSON.parse(rawText);
    }
  } catch {
    // leave parsedBody null, rawText already captured
  }

  return {
    status: res.status,
    location: res.headers.get("location"),
    contentType,
    parsedBody,
    rawTextSnippet: snippet(rawText, 500),
  };
}

function hasUsefulErrorMessage(parsedBody) {
  if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) return false;
  for (const key of ["error", "message"]) {
    const v = parsedBody[key];
    if (typeof v === "string" && v.trim().length > 0) return true;
  }
  return false;
}

// route path (as sent, with any {id} placeholder already substituted) ->
// [tableName, columnsToSelectForFollowUp]. Only routes worth a real
// service-role follow-up read (i.e. an insert/upsert route) are listed.
const FOLLOWUP_TABLE_BY_ROUTE = {
  "POST /api/drafts/queue": "draft_queue",
  "PATCH /api/applications/[id]": "applications",
  "PATCH /api/contacts/tasks/[taskId]": "contact_tasks",
  "POST /api/email/templates": "email_templates",
  "POST /api/financials/budgets": "grant_budgets",
  "POST /api/integrations/custom-api": "custom_api_connections",
  "POST /api/outreach/templates": "outreach_templates",
  "POST /api/marketplace/listings": "marketplace_listings",
  "POST /api/autoapply/queue": "submission_queue",
  "POST /api/donor-discovery/requests": "donor_discovery_requests",
  "POST /api/compliance": "compliance_requirements",
  "POST /api/funders/[id]/relationship": "funder_relationship_events",
  "POST /api/agents/registry/configure": "agent_configurations",
  "POST /api/notifications": "automation_notifications",
};

function extractId(parsedBody) {
  if (!parsedBody || typeof parsedBody !== "object") return null;
  if (typeof parsedBody.id === "string") return parsedBody.id;
  // Several of these routes nest the row under a named key.
  for (const key of Object.keys(parsedBody)) {
    const v = parsedBody[key];
    if (v && typeof v === "object" && typeof v.id === "string") return v.id;
  }
  return null;
}

async function followUpRead(admin, routeKey, id, sentFieldsToCheck) {
  const table = FOLLOWUP_TABLE_BY_ROUTE[routeKey];
  if (!table || !id) return null;
  const { data, error } = await admin.from(table).select("*").eq("id", id).maybeSingle();
  if (error) return { readOk: false, error: error.message };
  if (!data) return { readOk: false, error: "row not found by id" };
  const observed = {};
  for (const field of Object.keys(sentFieldsToCheck || {})) {
    observed[field] = snippet(data[field]);
  }
  return { readOk: true, table, storedFields: observed };
}

// ----------------------------------------------------------------------------
// Case list. One entry per (route, malformed variant). Every case names the
// exact validation line it targets in its `note`, per the read of the real
// route.ts source files done before writing this list.
// ----------------------------------------------------------------------------
function buildCases(fixtures) {
  const cases = [];
  let n = 0;
  const add = (c) => {
    n += 1;
    cases.push({ id: `PT10-${String(n).padStart(3, "0")}`, ...c });
  };

  // --- 1. POST /api/drafts/queue (writer) ---------------------------------
  const R1 = { method: "POST", path: "/api/drafts/queue", authRole: "writer" };
  add({
    ...R1,
    resource: "draft_queue",
    category: "invalid_json",
    description: "raw broken JSON text as the body",
    bodyKind: "raw",
    body: "{not valid json,,,",
    expectedOutcome: "4xx",
    note: "targets the try/catch around request.json() (route.ts line ~93-95): 'Invalid JSON body.'",
  });
  add({
    ...R1,
    resource: "draft_queue",
    category: "missing_required",
    description: "empty body -- omits required opportunity_id",
    bodyKind: "json",
    body: {},
    expectedOutcome: "4xx",
    note: "targets isUuid(opportunityId) check (route.ts ~line 101): 'opportunity_id must be a valid UUID.'",
  });
  add({
    ...R1,
    resource: "draft_queue",
    category: "wrong_type",
    description: "opportunity_id sent as a number instead of a UUID string",
    bodyKind: "json",
    body: { opportunity_id: 12345 },
    expectedOutcome: "4xx",
    note: "isUuid() requires a string -- a number must fail the same 400 as a missing value.",
  });
  add({
    ...R1,
    resource: "draft_queue",
    category: "oversized",
    description: "valid, real fixture opportunity_id + a 250,000-char template_type",
    bodyKind: "json",
    body: { opportunity_id: fixtures.opportunityId, template_type: OVERSIZED },
    expectedOutcome: "either",
    followUpFields: { template_type: OVERSIZED },
    note:
      "template_type has NO length/format check (route.ts: falls back to 'full_proposal' only if " +
      "not a non-empty string, otherwise trimmed and inserted as-is) -- this deliberately reaches " +
      "the real draft_queue insert with the real fixture opportunity, so a 2xx here is expected per " +
      "the code read; the follow-up read confirms the stored value isn't silently truncated/corrupted.",
  });
  add({
    ...R1,
    resource: "draft_queue",
    category: "injection_shaped",
    description: "valid fixture opportunity_id + SQLi-shaped template_type",
    bodyKind: "json",
    body: { opportunity_id: fixtures.opportunityId, template_type: SQLI },
    expectedOutcome: "either",
    followUpFields: { template_type: SQLI },
    note: "same target field as the oversized case above, injection-shaped string instead.",
  });

  // --- 2. PATCH /api/applications/[id] (writer) ---------------------------
  const R2 = { method: "PATCH", path: `/api/applications/${FAKE_UUID}`, authRole: "writer", routeKey: "PATCH /api/applications/[id]" };
  add({
    ...R2,
    resource: "applications",
    category: "invalid_json",
    description: "raw broken JSON text as the body",
    bodyKind: "raw",
    body: "{{{",
    expectedOutcome: "4xx",
    note: "targets the request.json() try/catch (route.ts line ~24-28).",
  });
  add({
    ...R2,
    resource: "applications",
    category: "missing_required",
    description: "empty body -- omits required pending_review",
    bodyKind: "json",
    body: {},
    expectedOutcome: "4xx",
    note: "targets typeof pendingReview !== 'boolean' check (route.ts line ~33-39).",
  });
  add({
    ...R2,
    resource: "applications",
    category: "wrong_type",
    description: "pending_review sent as the string 'true' instead of a boolean",
    bodyKind: "json",
    body: { pending_review: "true" },
    expectedOutcome: "4xx",
    note: "same typeof check -- a string must not pass a boolean-only gate.",
  });
  add({
    ...R2,
    resource: "applications",
    category: "wrong_type",
    description: "pending_review sent as the number 1 instead of a boolean",
    bodyKind: "json",
    body: { pending_review: 1 },
    expectedOutcome: "4xx",
    note: "same typeof check, numeric truthy value.",
  });

  // --- 3. PATCH /api/contacts/tasks/[taskId] (writer) ---------------------
  const R3 = {
    method: "PATCH",
    path: `/api/contacts/tasks/${FAKE_UUID}`,
    authRole: "writer",
    routeKey: "PATCH /api/contacts/tasks/[taskId]",
  };
  add({
    ...R3,
    resource: "contact_tasks",
    category: "invalid_json",
    description: "raw broken JSON text as the body",
    bodyKind: "raw",
    body: "not json at all",
    expectedOutcome: "4xx",
    note: "targets the request.json() try/catch (route.ts line ~22-27).",
  });
  add({
    ...R3,
    resource: "contact_tasks",
    category: "missing_required",
    description: "empty body -- omits required status",
    bodyKind: "json",
    body: {},
    expectedOutcome: "4xx",
    note: "targets VALID_STATUS.includes(status) check (route.ts line ~30-32).",
  });
  add({
    ...R3,
    resource: "contact_tasks",
    category: "wrong_type",
    description: "status sent as an enum-invalid string ('deleted', not in pending/completed/cancelled)",
    bodyKind: "json",
    body: { status: "deleted" },
    expectedOutcome: "4xx",
    note: "status is a real string but not one of the 3 allowed enum values -- same 400 path.",
  });

  // --- 4. POST /api/email/templates (writer) ------------------------------
  const R4 = { method: "POST", path: "/api/email/templates", authRole: "writer", routeKey: "POST /api/email/templates" };
  add({
    ...R4,
    resource: "email_templates",
    category: "invalid_json",
    description: "raw broken JSON text as the body",
    bodyKind: "raw",
    body: "[1,2,",
    expectedOutcome: "4xx",
    note: "targets the request.json() try/catch (route.ts line ~46-48).",
  });
  add({
    ...R4,
    resource: "email_templates",
    category: "missing_required",
    description: "empty body -- omits name/subject/body",
    bodyKind: "json",
    body: {},
    expectedOutcome: "4xx",
    note: "targets the three sequential typeof-string-non-empty checks (route.ts line ~58-65).",
  });
  add({
    ...R4,
    resource: "email_templates",
    category: "wrong_type",
    description: "name sent as an array instead of a string",
    bodyKind: "json",
    body: { name: ["not", "a", "string"], subject: "s", body: "b" },
    expectedOutcome: "4xx",
    note: "typeof name !== 'string' check (route.ts line ~58).",
  });
  add({
    ...R4,
    resource: "email_templates",
    category: "oversized",
    description: "valid name/subject + a 250,000-char body",
    bodyKind: "json",
    body: { name: "PT10 oversized email template", subject: "s", body: OVERSIZED },
    expectedOutcome: "either",
    followUpFields: { body: OVERSIZED },
    note: "email_templates.body has no length check in the route -- inserted as-is if the string passes the non-empty check.",
  });
  add({
    ...R4,
    resource: "email_templates",
    category: "injection_shaped",
    description: "valid name/subject + XSS-shaped body",
    bodyKind: "json",
    body: { name: "PT10 injection email template", subject: "s", body: XSS },
    expectedOutcome: "either",
    followUpFields: { body: XSS },
    note: "same field as above, XSS-shaped string.",
  });

  // --- 5. POST /api/financials/budgets (writer) ---------------------------
  const R5 = { method: "POST", path: "/api/financials/budgets", authRole: "writer", routeKey: "POST /api/financials/budgets" };
  add({
    ...R5,
    resource: "grant_budgets",
    category: "invalid_json",
    description: "raw broken JSON text as the body",
    bodyKind: "raw",
    body: "{",
    expectedOutcome: "4xx",
    note: "targets the request.json() try/catch (route.ts line ~55-57).",
  });
  add({
    ...R5,
    resource: "grant_budgets",
    category: "wrong_type",
    description: "application_id sent as a number instead of a string/null",
    bodyKind: "json",
    body: { application_id: 42 },
    expectedOutcome: "4xx",
    note: "the only real type-guard in this route: application_id must be undefined/null/string (route.ts line ~80-82).",
  });
  add({
    ...R5,
    resource: "grant_budgets",
    category: "wrong_type",
    description: "total_budget sent as a non-numeric string ('a lot of money')",
    bodyKind: "json",
    body: { total_budget: "a lot of money" },
    expectedOutcome: "either",
    followUpFields: { total_budget: 0 },
    note:
      "toNumberOrZero() silently coerces any non-finite value to 0 (route.ts helper, line ~14-18) -- " +
      "no rejection by design; 2xx with total_budget stored as 0 is the expected, non-corrupting outcome.",
  });
  add({
    ...R5,
    resource: "grant_budgets",
    category: "injection_shaped",
    description: "period_start sent as an oversized/garbage non-date string",
    bodyKind: "json",
    body: { period_start: OVERSIZED.slice(0, 5000) },
    expectedOutcome: "either",
    note:
      "period_start is only checked for typeof string + non-empty (route.ts line ~94), never date-format " +
      "validated, then inserted raw into what is very likely a DATE column -- a strong candidate for an " +
      "unhandled Postgres type error surfacing as the route's generic 500 'db_error' (line ~101).",
  });

  // --- 6. POST /api/integrations/custom-api (admin) -----------------------
  const R6 = { method: "POST", path: "/api/integrations/custom-api", authRole: "admin", routeKey: "POST /api/integrations/custom-api" };
  add({
    ...R6,
    resource: "custom_api_connections",
    category: "invalid_json",
    description: "raw broken JSON text as the body",
    bodyKind: "raw",
    body: "}}}",
    expectedOutcome: "4xx",
    note: "targets the request.json() try/catch (route.ts line ~66-68).",
  });
  add({
    ...R6,
    resource: "custom_api_connections",
    category: "missing_required",
    description: "empty body -- omits required name/base_url",
    bodyKind: "json",
    body: {},
    expectedOutcome: "4xx",
    note: "targets the sequential name/base_url typeof-non-empty checks (route.ts line ~80-85).",
  });
  add({
    ...R6,
    resource: "custom_api_connections",
    category: "wrong_type",
    description: "field_mapping sent as an array instead of an object",
    bodyKind: "json",
    body: { name: "PT10 test connection", base_url: "https://example.com", field_mapping: ["not", "an", "object"] },
    expectedOutcome: "4xx",
    note:
      "field_mapping's Array.isArray guard (route.ts line ~110-111) makes an array fall through to the " +
      "empty-object default, which then fails the 'must include a mapping to name' check (line ~113-119) -- " +
      "expected 400, but via a different code path than the field being outright rejected as wrong-typed.",
  });
  add({
    ...R6,
    resource: "custom_api_connections",
    category: "injection_shaped",
    description: "base_url sent as a SQLi/garbage string that is not a real URL",
    bodyKind: "json",
    body: { name: "PT10 malformed URL connection", base_url: SQLI, field_mapping: { opp_name: "name" } },
    expectedOutcome: "either",
    note:
      "assertDomainAllowed(base_url) (route.ts line ~87) is wrapped in try/catch, but any non-AllowlistBlockedError " +
      "is mapped to a 500 'allowlist_check_failed' (line ~90-92) -- a malformed base_url that fails URL parsing " +
      "inside that helper is a real client-input-error being reported as a server error, tested here directly.",
  });

  // --- 7. POST /api/intelligence/logic-model (writer) ---------------------
  const R7 = { method: "POST", path: "/api/intelligence/logic-model", authRole: "writer" };
  add({
    ...R7,
    resource: "logic_model",
    category: "invalid_json",
    description: "raw broken JSON text as the body",
    bodyKind: "raw",
    body: "not { json",
    expectedOutcome: "4xx",
    note: "targets the request.json() try/catch (route.ts line ~24-26).",
  });
  add({
    ...R7,
    resource: "logic_model",
    category: "missing_required",
    description: "empty body -- omits category/program_description/organization_id",
    bodyKind: "json",
    body: {},
    expectedOutcome: "4xx",
    note: "targets the three sequential typeof-string-non-empty checks (route.ts line ~45-52).",
  });
  add({
    ...R7,
    resource: "logic_model",
    category: "wrong_type",
    description: "category sent as an object instead of a string",
    bodyKind: "json",
    body: { category: { nested: true }, program_description: "d", organization_id: "x" },
    expectedOutcome: "4xx",
    note: "typeof category !== 'string' check (route.ts line ~45).",
  });
  add({
    ...R7,
    resource: "logic_model",
    category: "oversized",
    description: "valid category, organization_id set to the real session org, 250,000-char program_description",
    bodyKind: "json",
    // organization_id here has to equal the caller's own org (route rejects a mismatch) -- fixtures
    // does not carry it, so this is filled in at call time from setup()'s orgId (see runCases()).
    body: { category: "PT10 test category", program_description: OVERSIZED, __needsOwnOrgId: true },
    expectedOutcome: "either",
    note: "program_description has no length cap before being handed to the Claude prompt builder -- tests that a very large value doesn't crash the route itself (not the AI call's own behavior).",
  });

  // --- 8. POST /api/outreach/templates (writer) ---------------------------
  const R8 = { method: "POST", path: "/api/outreach/templates", authRole: "writer", routeKey: "POST /api/outreach/templates" };
  add({
    ...R8,
    resource: "outreach_templates",
    category: "invalid_json",
    description: "raw broken JSON text as the body",
    bodyKind: "raw",
    body: "{\"a\":",
    expectedOutcome: "4xx",
    note: "targets the request.json() try/catch (route.ts line ~79-81).",
  });
  add({
    ...R8,
    resource: "outreach_templates",
    category: "missing_required",
    description: "empty body -- omits name/channel/body",
    bodyKind: "json",
    body: {},
    expectedOutcome: "4xx",
    note: "targets isValidChannel(channel) + the name/body non-empty checks (route.ts line ~91-101).",
  });
  add({
    ...R8,
    resource: "outreach_templates",
    category: "wrong_type",
    description: "channel sent as a value not in the 4-item enum ('carrier_pigeon')",
    bodyKind: "json",
    body: { name: "PT10 test template", channel: "carrier_pigeon", body: "b" },
    expectedOutcome: "4xx",
    note: "isValidChannel() checks membership in [email,linkedin,phone_script,physical_mail] (route.ts line ~11-15).",
  });
  add({
    ...R8,
    resource: "outreach_templates",
    category: "injection_shaped",
    description: "valid name/channel + XSS-shaped body",
    bodyKind: "json",
    body: { name: "PT10 injection template", channel: "email", body: XSS },
    expectedOutcome: "either",
    followUpFields: { body: XSS },
    note: "outreach_templates.body has no format check beyond non-empty -- inserted as-is.",
  });

  // --- 9. PATCH /api/settings/agents/relationship-builder-v2 (admin) ------
  const R9 = {
    method: "PATCH",
    path: "/api/settings/agents/relationship-builder-v2",
    authRole: "admin",
    routeKey: "PATCH /api/settings/agents/relationship-builder-v2",
  };
  add({
    ...R9,
    resource: "platform_config",
    category: "invalid_json",
    description: "raw broken JSON text as the body",
    bodyKind: "raw",
    body: "{enabled: true", // unquoted key -- syntactically invalid JSON
    expectedOutcome: "4xx",
    note: "targets the request.json() try/catch (route.ts line ~55-57).",
  });
  add({
    ...R9,
    resource: "platform_config",
    category: "missing_required",
    description: "empty body -- omits required enabled",
    bodyKind: "json",
    body: {},
    expectedOutcome: "4xx",
    note: "targets typeof body.enabled !== 'boolean' check (route.ts line ~60-66).",
  });
  add({
    ...R9,
    resource: "platform_config",
    category: "non_object_body",
    description: "top-level body is a JSON array instead of an object",
    bodyKind: "json",
    body: [1, 2, 3],
    expectedOutcome: "4xx",
    note: "the same check explicitly rejects Array.isArray(body) (route.ts line ~63).",
  });
  add({
    ...R9,
    resource: "platform_config",
    category: "wrong_type",
    description: "enabled sent as the string 'yes' instead of a boolean",
    bodyKind: "json",
    body: { enabled: "yes" },
    expectedOutcome: "4xx",
    note: "same typeof check, string instead of boolean.",
  });

  // --- 10. POST /api/marketplace/listings (writer) ------------------------
  const R10 = { method: "POST", path: "/api/marketplace/listings", authRole: "writer", routeKey: "POST /api/marketplace/listings" };
  add({
    ...R10,
    resource: "marketplace_listings",
    category: "invalid_json",
    description: "raw broken JSON text as the body",
    bodyKind: "raw",
    body: "null,",
    expectedOutcome: "4xx",
    note: "targets the request.json() try/catch (route.ts line ~68-70).",
  });
  add({
    ...R10,
    resource: "marketplace_listings",
    category: "missing_required",
    description: "empty body -- omits required title/category",
    bodyKind: "json",
    body: {},
    expectedOutcome: "4xx",
    note: "targets the title/category non-empty checks (route.ts line ~88-91).",
  });
  add({
    ...R10,
    resource: "marketplace_listings",
    category: "wrong_type",
    description: "estimatedValue sent as a non-numeric string",
    bodyKind: "json",
    body: { title: "PT10 listing", category: "materials", estimatedValue: "a lot" },
    expectedOutcome: "either",
    followUpFields: { estimated_value: null },
    note:
      "estimatedValue falls back to null unless it's a finite number (route.ts line ~95-97) -- 2xx with " +
      "estimated_value stored as null is the expected, non-corrupting outcome, not a rejection.",
  });
  add({
    ...R10,
    resource: "marketplace_listings",
    category: "injection_shaped",
    description: "valid title/category + a garbage/injection-shaped expiresAt string",
    bodyKind: "json",
    body: { title: "PT10 bad-date listing", category: "materials", expiresAt: SQLI },
    expectedOutcome: "either",
    note:
      "expiresAt is only typeof-checked, never date-format validated (route.ts line ~110), then inserted raw " +
      "as expires_at -- likely a timestamptz column, so a non-date string is a real crash-shaped input.",
  });

  // --- 11. POST /api/autoapply/queue (writer) ------------------------------
  const R11 = { method: "POST", path: "/api/autoapply/queue", authRole: "writer", routeKey: "POST /api/autoapply/queue" };
  add({
    ...R11,
    resource: "submission_queue",
    category: "invalid_json",
    description: "raw broken JSON text as the body",
    bodyKind: "raw",
    body: "[",
    expectedOutcome: "4xx",
    note: "targets the request.json() try/catch (route.ts line ~147-149).",
  });
  add({
    ...R11,
    resource: "submission_queue",
    category: "missing_required",
    description: "empty body -- omits required funder_ids",
    bodyKind: "json",
    body: {},
    expectedOutcome: "4xx",
    note: "targets Array.isArray(funder_ids) && length>0 check (route.ts line ~161-165).",
  });
  add({
    ...R11,
    resource: "submission_queue",
    category: "wrong_type",
    description: "funder_ids sent as a non-array string instead of an array",
    bodyKind: "json",
    body: { funder_ids: "not-an-array" },
    expectedOutcome: "4xx",
    note: "same Array.isArray check.",
  });
  add({
    ...R11,
    resource: "submission_queue",
    category: "wrong_type",
    description: "funder_ids sent as an array of NUMBERS instead of UUID strings",
    bodyKind: "json",
    body: { funder_ids: [111, 222, 333] },
    expectedOutcome: "either",
    note:
      "the route casts `ids = funder_ids as string[]` with NO per-element type check (route.ts line ~166) -- " +
      "these numbers flow into a .in('funder_id', ids) query and, if any survive dedup, an insert with " +
      "funder_id set to a number where the column is almost certainly uuid -- a strong crash-shaped case.",
  });
  add({
    ...R11,
    resource: "submission_queue",
    category: "oversized",
    description: "funder_ids sent as an array of 5,000 fake-but-UUID-shaped strings",
    bodyKind: "json",
    body: { funder_ids: Array.from({ length: 5000 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`) },
    expectedOutcome: "either",
    note:
      "not literal garbage -- oversized in the 'unreasonably large collection' sense. The route's own " +
      "per-tier BATCH_CAPS check (route.ts line ~168-176) should reject this with a clean 422 before any " +
      "DB write is attempted; tests that a large-but-well-formed array doesn't instead hang or 500.",
  });

  // --- 12. POST /api/donor-discovery/requests (writer) --------------------
  const R12 = { method: "POST", path: "/api/donor-discovery/requests", authRole: "writer", routeKey: "POST /api/donor-discovery/requests" };
  add({
    ...R12,
    resource: "donor_discovery_requests",
    category: "invalid_json",
    description: "raw broken JSON text as the body",
    bodyKind: "raw",
    body: "{\"name\"",
    expectedOutcome: "4xx",
    note: "targets the request.json() try/catch (route.ts line ~63-65).",
  });
  add({
    ...R12,
    resource: "donor_discovery_requests",
    category: "missing_required",
    description: "empty body -- omits required name/taxonomy_ids/geography",
    bodyKind: "json",
    body: {},
    expectedOutcome: "4xx",
    note: "targets the sequential name/taxonomy_ids/geography checks (route.ts line ~70-89).",
  });
  add({
    ...R12,
    resource: "donor_discovery_requests",
    category: "wrong_type",
    description: "taxonomy_ids sent as a single string instead of an array",
    bodyKind: "json",
    body: { name: "PT10 request", taxonomy_ids: "not-an-array", geography: { national: true } },
    expectedOutcome: "4xx",
    note: "Array.isArray(taxonomy_ids) check (route.ts line ~74-77).",
  });
  add({
    ...R12,
    resource: "donor_discovery_requests",
    category: "wrong_type",
    description: "geography sent as an empty/malformed object matching none of the 3 valid shapes",
    bodyKind: "json",
    body: { name: "PT10 request", taxonomy_ids: ["t1"], geography: { bogus_key: 12345 } },
    expectedOutcome: "4xx",
    note: "isValidGeography() (route.ts line ~46-54) requires one of {center,radius_mi}/{states}/{national:true}.",
  });
  add({
    ...R12,
    resource: "donor_discovery_requests",
    category: "injection_shaped",
    description: "valid taxonomy_ids/geography + SQLi-shaped name",
    bodyKind: "json",
    body: { name: SQLI, taxonomy_ids: ["t1"], geography: { national: true } },
    expectedOutcome: "either",
    followUpFields: { name: SQLI },
    note: "name has no format restriction beyond non-empty -- inserted as-is via a parameterized query.",
  });

  // --- 13. POST /api/compliance (writer) -----------------------------------
  const R13 = { method: "POST", path: "/api/compliance", authRole: "writer", routeKey: "POST /api/compliance" };
  add({
    ...R13,
    resource: "compliance_requirements",
    category: "invalid_json",
    description: "raw broken JSON text as the body",
    bodyKind: "raw",
    body: "{,}",
    expectedOutcome: "4xx",
    note: "targets the request.json() try/catch (route.ts line ~168-170).",
  });
  add({
    ...R13,
    resource: "compliance_requirements",
    category: "missing_required",
    description: "empty body -- omits requirement_type/title/due_date",
    bodyKind: "json",
    body: {},
    expectedOutcome: "4xx",
    note: "targets the three sequential typeof-non-empty checks (route.ts line ~187-194).",
  });
  add({
    ...R13,
    resource: "compliance_requirements",
    category: "wrong_type",
    description: "application_id sent as a boolean instead of a string",
    bodyKind: "json",
    body: { requirement_type: "audit", title: "PT10 requirement", due_date: "2027-01-01", application_id: true },
    expectedOutcome: "4xx",
    note: "application_id must be undefined/null/string (route.ts line ~196-198).",
  });
  add({
    ...R13,
    resource: "compliance_requirements",
    category: "injection_shaped",
    description: "valid requirement_type/title + a garbage/oversized non-date due_date",
    bodyKind: "json",
    body: { requirement_type: "audit", title: "PT10 bad-date requirement", due_date: OVERSIZED.slice(0, 5000) },
    expectedOutcome: "either",
    note:
      "due_date is only checked for typeof string + non-empty (route.ts line ~193), never date-format " +
      "validated, then inserted raw into what is very likely a DATE column -- same class of case as " +
      "financials/budgets' period_start above, on a different route/table.",
  });

  // --- 14. POST /api/funders/[id]/relationship (writer) --------------------
  const R14 = {
    method: "POST",
    path: `/api/funders/${fixtures.funderId}/relationship`,
    authRole: "writer",
    routeKey: "POST /api/funders/[id]/relationship",
  };
  add({
    ...R14,
    resource: "funder_relationship_events",
    category: "invalid_json",
    description: "raw broken JSON text as the body",
    bodyKind: "raw",
    body: "{bad",
    expectedOutcome: "4xx",
    note: "request.json().catch(() => null) (route.ts line ~57) -- body becomes null, falls through to the event_type check below, not a hard parse-error 400, but still must not throw.",
  });
  add({
    ...R14,
    resource: "funder_relationship_events",
    category: "missing_required",
    description: "empty body -- omits required event_type",
    bodyKind: "json",
    body: {},
    expectedOutcome: "4xx",
    note: "EVENT_TYPES.includes(eventType) check (route.ts line ~62-68).",
  });
  add({
    ...R14,
    resource: "funder_relationship_events",
    category: "wrong_type",
    description: "event_type sent as a value not in the real enum",
    bodyKind: "json",
    body: { event_type: "not_a_real_event_type" },
    expectedOutcome: "4xx",
    note: "same EVENT_TYPES.includes() check, real string but not a member.",
  });
  add({
    ...R14,
    resource: "funder_relationship_events",
    category: "oversized",
    description: "real fixture funder id, valid event_type, a 250,000-char notes field",
    bodyKind: "json",
    body: { event_type: "call", notes: OVERSIZED },
    expectedOutcome: "either",
    followUpFields: { notes: OVERSIZED },
    note:
      "notes is only typeof-checked, no length cap (route.ts line ~59) -- reaches a real insert against the " +
      "real fixture funder, so the follow-up read verifies the full oversized value round-trips intact.",
  });

  // --- 15. POST /api/agents/registry/configure (writer) --------------------
  const R15 = {
    method: "POST",
    path: "/api/agents/registry/configure",
    authRole: "writer",
    routeKey: "POST /api/agents/registry/configure",
  };
  add({
    ...R15,
    resource: "agent_configurations",
    category: "invalid_json",
    description: "raw broken JSON text as the body",
    bodyKind: "raw",
    body: "}",
    expectedOutcome: "4xx",
    note: "targets the request.json() try/catch (route.ts line ~23-25).",
  });
  add({
    ...R15,
    resource: "agent_configurations",
    category: "missing_required",
    description: "empty body -- omits required agent_id/enabled",
    bodyKind: "json",
    body: {},
    expectedOutcome: "4xx",
    note: "targets the agent_id/enabled typeof checks (route.ts line ~34-38).",
  });
  add({
    ...R15,
    resource: "agent_configurations",
    category: "wrong_type",
    description: "config sent as an array instead of an object",
    bodyKind: "json",
    body: { agent_id: "pt10-fake-agent", enabled: true, config: ["not", "an", "object"] },
    expectedOutcome: "4xx",
    note: "typeof config !== 'object' || Array.isArray(config) check (route.ts line ~40-42) -- fires before the agent_id existence lookup.",
  });

  // --- 16. PATCH /api/knowledge-base (writer) -------------------------------
  const R16 = { method: "PATCH", path: "/api/knowledge-base", authRole: "writer" };
  add({
    ...R16,
    resource: "organizations",
    category: "invalid_json",
    description: "raw broken JSON text as the body",
    bodyKind: "raw",
    body: "{{",
    expectedOutcome: "4xx",
    note: "request.json().catch(() => null) then isPatchBody(null) fails (route.ts line ~232-238).",
  });
  add({
    ...R16,
    resource: "organizations",
    category: "missing_required",
    description: "empty body -- omits required section",
    bodyKind: "json",
    body: {},
    expectedOutcome: "4xx",
    note: "isPatchBody() requires section to be a real SECTION_KEYS member (route.ts line ~139-143).",
  });
  add({
    ...R16,
    resource: "organizations",
    category: "wrong_type",
    description: "section sent as a number instead of a string",
    bodyKind: "json",
    body: { section: 42 },
    expectedOutcome: "4xx",
    note: "same isPatchBody() check -- typeof section !== 'string' fails outright.",
  });
  add({
    ...R16,
    resource: "organizations",
    category: "wrong_type",
    description: "valid section + orgFields.annual_budget sent as a non-numeric string",
    bodyKind: "json",
    body: { section: "financial_profile", orgFields: { annual_budget: "not a number" } },
    expectedOutcome: "either",
    note:
      "body.orgFields is spread directly into the organizations.update() payload with NO per-field type " +
      "check (route.ts line ~243-247) -- annual_budget is a real `number | null` column per src/types/database.ts, " +
      "so a non-numeric string here is a strong candidate for an unhandled Postgres type-mismatch 500.",
  });

  // --- 17. POST /api/reports/board (writer) ---------------------------------
  const R17 = { method: "POST", path: "/api/reports/board", authRole: "writer" };
  add({
    ...R17,
    resource: "reports_board",
    category: "invalid_json",
    description: "raw broken JSON text as the body",
    bodyKind: "raw",
    body: "{\"start_date\":",
    expectedOutcome: "4xx",
    note:
      "request.json().catch(() => ({})) (route.ts line ~240) means a broken body silently becomes {} rather " +
      "than a parse-error 400 -- tests that this still produces a clean, non-500 response via the date-range " +
      "defaulting path, not that it rejects the broken JSON specifically.",
  });
  add({
    ...R17,
    resource: "reports_board",
    category: "wrong_type",
    description: "start_date/end_date sent as numbers instead of YYYY-MM-DD strings",
    bodyKind: "json",
    body: { start_date: 20270101, end_date: 20270201 },
    expectedOutcome: "either",
    note:
      "both fields fall back to computed defaults unless they are strings matching /^\\d{4}-\\d{2}-\\d{2}$/ " +
      "(route.ts line ~250-257) -- no rejection by design, this confirms the fallback actually engages rather " +
      "than passing the raw numbers further into the report query.",
  });
  add({
    ...R17,
    resource: "reports_board",
    category: "injection_shaped",
    description: "start_date/end_date reversed (start after end) -- the one real validated case",
    bodyKind: "json",
    body: { start_date: "2027-12-31", end_date: "2027-01-01" },
    expectedOutcome: "4xx",
    note: "startDate > endDate explicit check (route.ts line ~259-262) -- the one genuine validation this route performs on these fields.",
  });

  // --- 18. POST /api/notifications (CRON_SECRET, not a session) ------------
  const R18 = { method: "POST", path: "/api/notifications", authRole: "cron", routeKey: "POST /api/notifications" };
  add({
    ...R18,
    resource: "automation_notifications",
    category: "invalid_json",
    description: "raw broken JSON text as the body, correct bearer token",
    bodyKind: "raw",
    body: "{bad json}",
    expectedOutcome: "4xx",
    note: "targets the request.json() try/catch (route.ts line ~133-137), reached only after the CRON_SECRET bearer check passes.",
  });
  add({
    ...R18,
    resource: "automation_notifications",
    category: "missing_required",
    description: "empty body -- omits organization_id/event_type/title",
    bodyKind: "json",
    body: {},
    expectedOutcome: "4xx",
    note: "targets the falsy check on organization_id/event_type/title (route.ts line ~148-153).",
  });
  add({
    ...R18,
    resource: "automation_notifications",
    category: "wrong_type",
    description: "organization_id sent as an object instead of a string (a truthy value, so the falsy-only check does not catch it)",
    bodyKind: "json",
    body: { organization_id: { not: "a string" }, event_type: "pt10_test", title: "PT10 malformed org id" },
    expectedOutcome: "either",
    note:
      "the required-field check is `if (!organization_id || !event_type || !title)` (route.ts line ~148) -- " +
      "a truthy non-string object PASSES that check, then is inserted directly as organization_id (route.ts " +
      "line ~159), which is almost certainly a uuid column -- a strong crash-shaped case that a naive falsy " +
      "check alone would miss.",
  });

  return cases;
}

// ----------------------------------------------------------------------------
// Runner
// ----------------------------------------------------------------------------
async function runCases(ctx) {
  const { admin, orgId, sessions, fixtures } = ctx;
  const cases = buildCases(fixtures);
  const results = [];

  for (const c of cases) {
    const isCron = c.authRole === "cron";
    const cookieHeader = isCron ? undefined : sessions[c.authRole]?.cookieHeader;
    if (!isCron && !cookieHeader) {
      throw new Error(`no session for authRole "${c.authRole}" (case ${c.id})`);
    }

    let bodyToSend = c.body;
    if (bodyToSend && typeof bodyToSend === "object" && bodyToSend.__needsOwnOrgId) {
      bodyToSend = { ...bodyToSend, organization_id: orgId };
      delete bodyToSend.__needsOwnOrgId;
    }

    const requestRecord = {
      method: c.method,
      path: c.path,
      bodyKind: c.bodyKind,
      bodySnippet: snippet(bodyToSend),
    };

    const res = await call({
      method: c.method,
      urlPath: c.path,
      cookieHeader,
      bearerToken: isCron ? CRON_SECRET : undefined,
      bodyKind: c.bodyKind,
      body: bodyToSend,
    });

    let verdict;
    let verdictReason;
    let followUp = null;

    if (res.networkError) {
      verdict = "FINDING";
      verdictReason = `request failed / no response: ${res.networkError}`;
    } else if (res.status === 500) {
      verdict = "FINDING";
      verdictReason = "malformed input produced a 500";
    } else if (res.status >= 300 && res.status < 400) {
      verdict = "FINDING";
      verdictReason = `unexpected redirect (${res.status} -> ${res.location}) instead of a JSON validation response`;
    } else if (res.status >= 400 && res.status < 500) {
      verdict = hasUsefulErrorMessage(res.parsedBody) ? "PASS" : "PASS_WEAK_ERROR";
      verdictReason = hasUsefulErrorMessage(res.parsedBody)
        ? "clean 4xx with a useful error message"
        : "clean 4xx status, but response body has no recognizable error/message field";
    } else if (res.status >= 200 && res.status < 300) {
      if (c.expectedOutcome === "4xx") {
        verdict = "FINDING";
        verdictReason = "expected a 4xx (this field has a visible type/required check in the route source) but got a 2xx";
      } else {
        verdict = "ACCEPTED_NO_VALIDATION";
        verdictReason = "route accepted the malformed value (matches the code read -- no app-level check on this field)";
        if (c.followUpFields) {
          const id = extractId(res.parsedBody);
          followUp = await followUpRead(admin, c.routeKey, id, c.followUpFields);
          if (followUp && followUp.readOk) {
            for (const [field, sentValue] of Object.entries(c.followUpFields)) {
              const stored = followUp.storedFields[field];
              const sentSnippet = snippet(sentValue);
              if (stored !== sentSnippet) {
                verdict = "FINDING";
                verdictReason = `follow-up read shows stored ${field} does not match what was sent -- possible silent truncation/corruption (partial write)`;
              }
            }
          } else if (followUp && !followUp.readOk) {
            verdict = "FINDING";
            verdictReason = `route returned 2xx but the follow-up read could not confirm the row was written: ${followUp.error}`;
          }
        }
      }
    } else {
      verdict = "FINDING";
      verdictReason = `unrecognized status ${res.status}`;
    }

    results.push({
      id: c.id,
      resource: c.resource,
      route: { method: c.method, path: c.path, authRole: c.authRole },
      category: c.category,
      description: c.description,
      note: c.note,
      expectedOutcome: c.expectedOutcome,
      request: requestRecord,
      response: res.networkError
        ? { networkError: res.networkError }
        : {
            status: res.status,
            contentType: res.contentType,
            bodySnippet: res.rawTextSnippet,
          },
      followUp,
      verdict,
      verdictReason,
    });

    console.log(`  ${c.id} [${c.category}] ${c.method} ${c.path} -> ${res.status ?? "NETWORK_ERROR"} :: ${verdict}`);
  }

  return results;
}

async function cleanup(ctx) {
  const { admin, orgId } = ctx;
  console.log("PT-10-001: cleaning up test org + users...");
  const { data: users } = await admin.auth.admin.listUsers();
  for (const u of users?.users ?? []) {
    if (u.email && u.email.endsWith(TEST_EMAIL_SUFFIX)) {
      await admin.auth.admin.deleteUser(u.id);
    }
  }
  await admin.from("organizations").delete().eq("id", orgId);
}

async function main() {
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });

  const ctx = await setup();
  let results;
  try {
    results = await runCases(ctx);
  } finally {
    await cleanup(ctx);
  }

  const verdictCounts = {};
  for (const r of results) {
    verdictCounts[r.verdict] = (verdictCounts[r.verdict] || 0) + 1;
  }
  const routeSet = new Set(results.map((r) => `${r.route.method} ${r.route.path.replace(/[0-9a-f-]{36}/, "[id]")}`));
  const findings = results.filter((r) => r.verdict === "FINDING");

  const doc = {
    generatedAt: new Date().toISOString(),
    note:
      "PT-10-001. LOCAL/BRANCH ONLY. Malformed-payload fuzz against a representative set of 18 real API " +
      "input surfaces (drawn from PT-02's api-routes.json), through the real, unmodified Next.js API layer " +
      "against a disposable throwaway org+users on a local Supabase stack -- never production. Every case's " +
      "own `note` cites the exact validation line in the route's real source read before writing the case. " +
      "Behavior only (crash / partial-write), not exploitability depth -- see test-evidence/pt-14/ for that.",
    baseUrl: BASE_URL,
    targetSupabaseUrl: LOCAL_URL,
    testOrgId: ctx.orgId,
    fixtures: ctx.fixtures,
    caseCount: results.length,
    routeCount: routeSet.size,
    verdictCounts,
    findingCount: findings.length,
    cases: results,
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(doc, null, 2) + "\n", "utf8");
  console.log(
    `\nPT-10-001: wrote ${results.length} case(s) across ${routeSet.size} route(s) to ${OUT_PATH}\n` +
      `verdictCounts: ${JSON.stringify(verdictCounts)}\n` +
      (findings.length > 0
        ? `*** ${findings.length} FINDING(s) -- see malformed-payloads.json for detail ***`
        : "No FINDING verdicts."),
  );
}

main().catch((err) => {
  console.error("PT-10-001 FAILED:", err);
  process.exit(1);
});
