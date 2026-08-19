// ============================================================================
// PT-02-004 -- CRUD round-trip proof for core, CRUD-bearing resources, through
// the real API layer (not direct DB writes).
//
// LOCAL/BRANCH ONLY. Provisions its own throwaway organization and 2
// role-differentiated auth users (writer/viewer) against whatever Supabase
// instance LOCAL_SUPABASE_URL points at -- it must NEVER be pointed at
// production (vbjplpquqxxfbpazyalt). Follows the exact session-provisioning
// pattern already proven in pt02-003-role-matrix.mjs (real signInWithPassword
// + real @supabase/ssr createServerClient cookie derivation against the real,
// unmodified app under test).
//
// Resource selection (this task's own instruction: "judgment, cover what a
// real user creates/edits"). The task's 8 named example resources
// (applications, opportunities, drafts, pipeline items, contacts,
// donor-discovery prospects, grant_budgets, deadlines) were checked one by one
// against the real route files before writing this script -- NOT all 8 have a
// full CREATE/READ/UPDATE/DELETE surface at the API layer. Where a verb has no
// route at all, that step is recorded with outcome "no_route" (a real,
// register-worthy finding on its own -- not silently skipped), never faked
// against a route that doesn't exist. Three additional resources
// (request_profiles, email_templates, email_sequences) were added for breadth
// and because they DO have a genuine, self-contained, full 4-verb API
// surface -- useful positive controls (email_sequences in particular does a
// real hard DELETE with a real subsequent 404, unlike every soft-delete
// resource in this codebase).
//
// Final 11 resources, one row per resource in crud-cycles.json's resources[]:
//   1. draft_queue              -- "pipeline items" (POST/GET/PATCH/DELETE /api/drafts/queue[/[id]])
//   2. request_profiles         -- "AutoApply request profiles", additional, full CRUD
//   3. email_templates          -- additional, full CRUD (body-id pattern, not a dynamic route)
//   4. email_sequences          -- additional, full CRUD, real hard DELETE
//   5. grant_budgets            -- CREATE+READ only; no PATCH/DELETE route exists
//   6. applications              -- READ (via /api/drafts/[id]) + UPDATE (via /api/applications/[id]);
//                                   no CREATE/DELETE route
//   7. drafts                   -- READ+UPDATE via /api/drafts/[id]; no CREATE/DELETE route
//                                   (shares the same underlying `applications` row as #6, tested
//                                   through its own distinct endpoint/semantics)
//   8. donor_discovery_prospects -- READ+UPDATE via /api/donor-discovery/prospects/[id]; no
//                                   CREATE/DELETE route (prospects are populated by discovery
//                                   agents/import, never created directly through this API)
//   9. opportunities            -- zero CRUD route surface at all (2 unrelated nested GETs exist
//                                   -- narrative-gap-analysis, probability -- neither reads/returns
//                                   the opportunity record itself)
//  10. contacts                 -- zero CRUD route surface for the contact record itself (only
//                                   nested /api/contacts/[id]/outreach/* and a distinct
//                                   contact_tasks sub-resource exist, not the contact record)
//  11. deadlines                -- zero CRUD route surface (/api/deadlines/check is a GET/POST
//                                   action-trigger endpoint, not deadline-record CRUD)
//
// Step 2 of this task ("A viewer-role WRITE attempt on each mutation route:
// assert rejected") is implemented per mutation step that actually has a
// route: every create/update/delete step that is "tested" also fires the
// identical request with a real viewer-role session and records
// step.viewerWriteAttempt = { status, code, refused }.
//
// Writes test-evidence/pt-02/crud-cycles.json.
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
const OUT_PATH = path.join(REPO_ROOT, "test-evidence", "pt-02", "crud-cycles.json");

const PROD_URL_FRAGMENT = "vbjplpquqxxfbpazyalt";
const LOCAL_URL = process.env.LOCAL_SUPABASE_URL;
const LOCAL_ANON_KEY = process.env.LOCAL_SUPABASE_ANON_KEY;
const LOCAL_SERVICE_KEY = process.env.LOCAL_SUPABASE_SERVICE_ROLE_KEY;
const BASE_URL = process.env.PT02_BASE_URL || "http://localhost:3099";

if (!LOCAL_URL || !LOCAL_ANON_KEY || !LOCAL_SERVICE_KEY) {
  console.error(
    "Missing LOCAL_SUPABASE_URL / LOCAL_SUPABASE_ANON_KEY / LOCAL_SUPABASE_SERVICE_ROLE_KEY.\n" +
      "This script provisions real test users and mutates real rows -- it MUST be pointed at a\n" +
      "local/branch Supabase instance, never production. See test-evidence/pt-02/BRANCH_STRATEGY.md.",
  );
  process.exit(1);
}
if (LOCAL_URL.includes(PROD_URL_FRAGMENT)) {
  console.error(
    `HARD STOP: LOCAL_SUPABASE_URL contains the production project ref (${PROD_URL_FRAGMENT}). ` +
      "This script creates and mutates real rows and must never target production. Aborting.",
  );
  process.exit(1);
}
if (BASE_URL.includes(PROD_URL_FRAGMENT) || /benavora\.com/.test(BASE_URL)) {
  console.error("HARD STOP: PT02_BASE_URL looks like a production Benavora host. Aborting.");
  process.exit(1);
}

// Node 20 has no native WebSocket; supabase-js eagerly constructs a
// RealtimeClient. Same workaround already established in src/lib/supabase/admin.ts
// and reused by pt02-003-role-matrix.mjs.
const REALTIME_OPT = { realtime: { transport: ws } };

const PASSWORD = "Pt02CrudCycles!2026";
const TEST_ORG_NAME = "PT-02-004 CRUD Cycles Test Org";
const TEST_EMAIL_SUFFIX = "@crud-cycles.local";

function isUuid(v) {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

// ----------------------------------------------------------------------------
// Setup: provision one throwaway org + writer/viewer users, sign each in for
// real, derive a real Cookie header per role. Also seed the minimal
// prerequisite fixture rows (an opportunity, an application, a donor-discovery
// directory/request/prospect chain) needed by resources that require a real
// FK to already exist -- these are fixtures, not the CRUD-under-test itself.
// ----------------------------------------------------------------------------
async function setupSessionsAndFixtures() {
  const admin = createServiceClient(LOCAL_URL, LOCAL_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    ...REALTIME_OPT,
  });

  console.log("PT-02-004: provisioning test org + writer/viewer users...");

  // Re-runnable: clean up any prior run's users/org first.
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
  for (const role of ["writer", "viewer"]) {
    const email = `pt02-004-${role}${TEST_EMAIL_SUFFIX}`;
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
      full_name: `PT-02-004 ${role}`,
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

  console.log("PT-02-004: seeding prerequisite fixtures (via service role, not the resource under test)...");

  // Opportunity fixture -- required FK for draft_queue and for the applications fixture below.
  const { data: opp, error: oppErr } = await admin
    .from("opportunities")
    .insert({
      organization_id: orgId,
      name: "PT-02-004 fixture opportunity",
      category: "housing_grant",
      status: "open",
    })
    .select("id")
    .single();
  if (oppErr) throw new Error("fixture opportunity insert failed: " + oppErr.message);

  // Application fixture (pending_review=true) -- required for the "drafts" and "applications"
  // resource entries, since neither has a CREATE route; this is a prerequisite fixture, not
  // the CRUD-under-test.
  const { data: app, error: appErr } = await admin
    .from("applications")
    .insert({
      organization_id: orgId,
      opportunity_id: opp.id,
      stage: "discovered",
      pending_review: true,
      draft_content: "PT-02-004 fixture draft content, seeded before test.",
      draft_confidence_score: 55,
    })
    .select("id")
    .single();
  if (appErr) throw new Error("fixture application insert failed: " + appErr.message);

  // Donor Discovery directory + request + prospect chain -- required for the
  // "donor_discovery_prospects" resource entry, since prospects have no CREATE route (populated
  // by discovery agents/import only).
  const { data: dir, error: dirErr } = await admin
    .from("donor_discovery_directory")
    .insert({
      legal_name: "PT-02-004 Fixture Donor Co",
      naics_codes: [],
    })
    .select("id")
    .single();
  if (dirErr) throw new Error("fixture donor_discovery_directory insert failed: " + dirErr.message);

  const { data: req, error: reqErr } = await admin
    .from("donor_discovery_requests")
    .insert({
      organization_id: orgId,
      name: "PT-02-004 fixture request",
      taxonomy_ids: [],
      geography: {},
      status: "complete",
    })
    .select("id")
    .single();
  if (reqErr) throw new Error("fixture donor_discovery_requests insert failed: " + reqErr.message);

  const { data: prospect, error: prospectErr } = await admin
    .from("donor_discovery_prospects")
    .insert({
      organization_id: orgId,
      directory_id: dir.id,
      request_id: req.id,
      pipeline_stage: "new",
      notes: "PT-02-004 fixture prospect, seeded before test.",
    })
    .select("id")
    .single();
  if (prospectErr) throw new Error("fixture donor_discovery_prospects insert failed: " + prospectErr.message);

  console.log(`  opportunity=${opp.id} application=${app.id} directory=${dir.id} request=${req.id} prospect=${prospect.id}`);

  return {
    admin,
    orgId,
    sessions,
    fixtures: {
      opportunityId: opp.id,
      applicationId: app.id,
      directoryId: dir.id,
      requestId: req.id,
      prospectId: prospect.id,
    },
  };
}

// ----------------------------------------------------------------------------
// HTTP helper
// ----------------------------------------------------------------------------
async function call(method, urlPath, cookieHeader, body) {
  const url = BASE_URL + urlPath;
  const opts = {
    method,
    redirect: "manual",
    headers: { Accept: "application/json", Cookie: cookieHeader },
  };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const resp = await fetch(url, opts);
  let json = null;
  try {
    json = await resp.json();
  } catch {
    // non-JSON body is fine
  }
  return { status: resp.status, body: json, route: `${method} ${urlPath}` };
}

function refused(result) {
  return result.status === 403 && result.body && result.body.code === "forbidden";
}

function viewerAttempt(result) {
  return { status: result.status, code: result.body?.code ?? null, refused: refused(result) };
}

function noRouteStep(routeLabel, notes) {
  return { route: routeLabel, outcome: "no_route", status: null, notes };
}

function skippedStep(routeLabel, notes) {
  return { route: routeLabel, outcome: "skipped_prereq_failed", status: null, notes };
}

// ----------------------------------------------------------------------------
// Per-resource CRUD cycles
// ----------------------------------------------------------------------------

async function testDraftQueue(sessions, fixtures) {
  const w = sessions.writer.cookieHeader;
  const v = sessions.viewer.cookieHeader;
  const steps = {};

  // CREATE
  const createRes = await call("POST", "/api/drafts/queue", w, {
    opportunity_id: fixtures.opportunityId,
    template_type: "full_proposal",
    priority: 3,
  });
  const createOk = createRes.status >= 200 && createRes.status < 300;
  const id = createOk ? createRes.body?.item?.id : null;
  const viewerCreate = await call("POST", "/api/drafts/queue", v, {
    opportunity_id: fixtures.opportunityId,
    template_type: "budget_narrative",
    priority: 3,
  });
  steps.create = {
    route: createRes.route,
    outcome: "tested",
    status: createRes.status,
    hasId: isUuid(id),
    id,
    shapeOk: createOk && createRes.body?.item?.status === "pending" && createRes.body?.item?.opportunity_id === fixtures.opportunityId,
    notes: createOk ? "created pending draft_queue item" : `create failed: ${JSON.stringify(createRes.body)}`,
    viewerWriteAttempt: viewerAttempt(viewerCreate),
  };

  if (!id) {
    steps.read = skippedStep("GET /api/drafts/queue/{id}", "create step did not return a usable id");
    steps.update = skippedStep("PATCH /api/drafts/queue/{id}", "create step did not return a usable id");
    steps.delete = skippedStep("DELETE /api/drafts/queue/{id}", "create step did not return a usable id");
    steps.readAfterDelete = skippedStep("GET /api/drafts/queue/{id}", "create step did not return a usable id");
    return steps;
  }

  // READ
  const readRes = await call("GET", `/api/drafts/queue/${id}`, w);
  steps.read = {
    route: `GET /api/drafts/queue/{id}`,
    outcome: "tested",
    status: readRes.status,
    matchesCreated: readRes.status === 200 && readRes.body?.item?.id === id && readRes.body?.item?.opportunity_id === fixtures.opportunityId,
    notes: `id=${id}`,
  };

  // UPDATE (prioritize action -> priority field)
  const updateRes = await call("PATCH", `/api/drafts/queue/${id}`, w, { action: "prioritize", priority: 1 });
  const viewerUpdate = await call("PATCH", `/api/drafts/queue/${id}`, v, { action: "prioritize", priority: 5 });
  const reReadAfterUpdate = await call("GET", `/api/drafts/queue/${id}`, w);
  steps.update = {
    route: `PATCH /api/drafts/queue/{id}`,
    outcome: "tested",
    status: updateRes.status,
    fieldChanged: "priority",
    sentValue: 1,
    responseValue: updateRes.body?.item?.priority ?? null,
    persistedValue: reReadAfterUpdate.body?.item?.priority ?? null,
    persisted: updateRes.status === 200 && reReadAfterUpdate.body?.item?.priority === 1,
    notes: updateRes.status === 200 ? "priority action=prioritize" : `update failed: ${JSON.stringify(updateRes.body)}`,
    viewerWriteAttempt: viewerAttempt(viewerUpdate),
  };

  // DELETE (soft: status -> rejected)
  const deleteRes = await call("DELETE", `/api/drafts/queue/${id}`, w);
  const viewerDelete = await call("DELETE", `/api/drafts/queue/${id}`, v);
  steps.delete = {
    route: `DELETE /api/drafts/queue/{id}`,
    outcome: "tested",
    status: deleteRes.status,
    notes: "route implements a SOFT delete: status set to 'rejected' (rejected_reason='removed_from_queue'), row is not removed",
    viewerWriteAttempt: viewerAttempt(viewerDelete),
  };

  // READ after DELETE
  const readAfter = await call("GET", `/api/drafts/queue/${id}`, w);
  const actual404 = readAfter.status === 404;
  steps.readAfterDelete = {
    route: `GET /api/drafts/queue/{id}`,
    outcome: "tested",
    status: readAfter.status,
    expected404: true,
    actual404,
    persistedStatusField: readAfter.body?.item?.status ?? null,
    verdict: actual404 ? "PASS" : "FINDING",
    notes: actual404
      ? "confirmed 404 after delete"
      : `GET still returns ${readAfter.status} after DELETE; item.status='${readAfter.body?.item?.status ?? "?"}' -- soft delete means "assert 2xx + subsequent GET 404s" does not hold for this resource`,
  };

  return steps;
}

async function testRequestProfiles(sessions) {
  const w = sessions.writer.cookieHeader;
  const v = sessions.viewer.cookieHeader;
  const steps = {};

  const createRes = await call("POST", "/api/autoapply/profiles", w, {
    name: "PT-02-004 fixture profile",
    request_type: "monetary",
    needs_description: "PT-02-004 CRUD cycle test fixture profile.",
    priority: 50,
  });
  const createOk = createRes.status >= 200 && createRes.status < 300;
  const id = createOk ? createRes.body?.profile?.id : null;
  const viewerCreate = await call("POST", "/api/autoapply/profiles", v, {
    name: "viewer should not create this",
    request_type: "monetary",
    needs_description: "viewer write attempt",
  });
  steps.create = {
    route: createRes.route,
    outcome: "tested",
    status: createRes.status,
    hasId: isUuid(id),
    id,
    shapeOk: createOk && createRes.body?.profile?.name === "PT-02-004 fixture profile" && createRes.body?.profile?.active === true,
    notes: createOk ? "created request_profiles row" : `create failed: ${JSON.stringify(createRes.body)}`,
    viewerWriteAttempt: viewerAttempt(viewerCreate),
  };

  if (!id) {
    steps.read = skippedStep("GET /api/autoapply/profiles/{id}", "create step did not return a usable id");
    steps.update = skippedStep("PUT /api/autoapply/profiles/{id}", "create step did not return a usable id");
    steps.delete = skippedStep("DELETE /api/autoapply/profiles/{id}", "create step did not return a usable id");
    steps.readAfterDelete = skippedStep("GET /api/autoapply/profiles/{id}", "create step did not return a usable id");
    return steps;
  }

  const readRes = await call("GET", `/api/autoapply/profiles/${id}`, w);
  steps.read = {
    route: "GET /api/autoapply/profiles/{id}",
    outcome: "tested",
    status: readRes.status,
    matchesCreated: readRes.status === 200 && readRes.body?.profile?.id === id,
    notes: `id=${id}`,
  };

  const updateRes = await call("PUT", `/api/autoapply/profiles/${id}`, w, { priority: 7 });
  const viewerUpdate = await call("PUT", `/api/autoapply/profiles/${id}`, v, { priority: 99 });
  const reRead = await call("GET", `/api/autoapply/profiles/${id}`, w);
  steps.update = {
    route: "PUT /api/autoapply/profiles/{id}",
    outcome: "tested",
    status: updateRes.status,
    fieldChanged: "priority",
    sentValue: 7,
    responseValue: updateRes.body?.profile?.priority ?? null,
    persistedValue: reRead.body?.profile?.priority ?? null,
    persisted: updateRes.status === 200 && reRead.body?.profile?.priority === 7,
    notes: updateRes.status === 200 ? "priority updated via PUT" : `update failed: ${JSON.stringify(updateRes.body)}`,
    viewerWriteAttempt: viewerAttempt(viewerUpdate),
  };

  const deleteRes = await call("DELETE", `/api/autoapply/profiles/${id}`, w);
  const viewerDelete = await call("DELETE", `/api/autoapply/profiles/${id}`, v);
  steps.delete = {
    route: "DELETE /api/autoapply/profiles/{id}",
    outcome: "tested",
    status: deleteRes.status,
    notes: "route implements a SOFT delete: active set to false, row is not removed",
    viewerWriteAttempt: viewerAttempt(viewerDelete),
  };

  const readAfter = await call("GET", `/api/autoapply/profiles/${id}`, w);
  const actual404 = readAfter.status === 404;
  steps.readAfterDelete = {
    route: "GET /api/autoapply/profiles/{id}",
    outcome: "tested",
    status: readAfter.status,
    expected404: true,
    actual404,
    persistedActiveField: readAfter.body?.profile?.active ?? null,
    verdict: actual404 ? "PASS" : "FINDING",
    notes: actual404
      ? "confirmed 404 after delete"
      : `GET still returns ${readAfter.status} after DELETE; profile.active=${readAfter.body?.profile?.active} -- soft delete, GET does not filter on active`,
  };

  return steps;
}

async function testEmailTemplates(sessions) {
  const w = sessions.writer.cookieHeader;
  const v = sessions.viewer.cookieHeader;
  const steps = {};

  const createRes = await call("POST", "/api/email/templates", w, {
    name: "PT-02-004 fixture template",
    template_type: "general",
    subject: "PT-02-004 subject",
    body: "PT-02-004 body content",
  });
  const createOk = createRes.status >= 200 && createRes.status < 300;
  const id = createOk ? createRes.body?.template?.id : null;
  const viewerCreate = await call("POST", "/api/email/templates", v, {
    name: "viewer should not create this",
    subject: "x",
    body: "x",
  });
  steps.create = {
    route: createRes.route,
    outcome: "tested",
    status: createRes.status,
    hasId: isUuid(id),
    id,
    shapeOk: createOk && createRes.body?.template?.name === "PT-02-004 fixture template",
    notes: createOk
      ? "created email_templates row"
      : `create failed: ${JSON.stringify(createRes.body)} -- real schema mismatch: the live email_templates table (migration 054) has columns subject_template/body_template, but this route inserts/selects subject/body, which do not exist as columns on this table`,
    viewerWriteAttempt: viewerAttempt(viewerCreate),
  };

  if (!id) {
    steps.read = skippedStep("GET /api/email/templates (list, find by id)", "create step did not return a usable id -- see create.notes for the real schema-mismatch cause");
    steps.update = skippedStep("PATCH /api/email/templates", "create step did not return a usable id");
    steps.delete = skippedStep("DELETE /api/email/templates", "create step did not return a usable id");
    steps.readAfterDelete = skippedStep("GET /api/email/templates (list, find by id)", "create step did not return a usable id");
    return steps;
  }

  // No dedicated GET-by-id route -- read via the list endpoint and find the created row.
  const listRes = await call("GET", "/api/email/templates", w);
  const foundInList = Array.isArray(listRes.body?.templates)
    ? listRes.body.templates.find((t) => t.id === id)
    : null;
  steps.read = {
    route: "GET /api/email/templates (list; no GET-by-id route exists)",
    outcome: "tested",
    status: listRes.status,
    matchesCreated: listRes.status === 200 && !!foundInList && foundInList.name === "PT-02-004 fixture template",
    notes: `id=${id}; found_in_list=${!!foundInList}`,
  };

  const updateRes = await call("PATCH", "/api/email/templates", w, { id, name: "PT-02-004 fixture template (updated)" });
  const viewerUpdate = await call("PATCH", "/api/email/templates", v, { id, name: "viewer should not update this" });
  const listAfterUpdate = await call("GET", "/api/email/templates", w);
  const foundAfterUpdate = Array.isArray(listAfterUpdate.body?.templates)
    ? listAfterUpdate.body.templates.find((t) => t.id === id)
    : null;
  steps.update = {
    route: "PATCH /api/email/templates",
    outcome: "tested",
    status: updateRes.status,
    fieldChanged: "name",
    sentValue: "PT-02-004 fixture template (updated)",
    responseValue: updateRes.body?.template?.name ?? null,
    persistedValue: foundAfterUpdate?.name ?? null,
    persisted: updateRes.status === 200 && foundAfterUpdate?.name === "PT-02-004 fixture template (updated)",
    notes: updateRes.status === 200 ? "name updated via PATCH (body-id pattern)" : `update failed: ${JSON.stringify(updateRes.body)}`,
    viewerWriteAttempt: viewerAttempt(viewerUpdate),
  };

  const deleteReq = { method: "DELETE", url: "/api/email/templates" };
  const deleteRes = await call("DELETE", "/api/email/templates", w, { id });
  const viewerDelete = await call("DELETE", "/api/email/templates", v, { id });
  steps.delete = {
    route: "DELETE /api/email/templates",
    outcome: "tested",
    status: deleteRes.status,
    notes: "route implements a SOFT delete: is_active set to false, row is not removed",
    viewerWriteAttempt: viewerAttempt(viewerDelete),
  };

  const listAfterDelete = await call("GET", "/api/email/templates", w);
  const foundAfterDelete = Array.isArray(listAfterDelete.body?.templates)
    ? listAfterDelete.body.templates.find((t) => t.id === id)
    : null;
  // GET filters .eq("is_active", true), so a soft-deleted row is correctly absent from
  // this list -- the closest this resource has to a "not found" signal, since there is
  // no GET-by-id route to literally 404.
  const actualAbsent = !foundAfterDelete;
  steps.readAfterDelete = {
    route: "GET /api/email/templates (list; no GET-by-id route exists)",
    outcome: "tested",
    status: listAfterDelete.status,
    expected404: true,
    actual404: false,
    absentFromActiveList: actualAbsent,
    verdict: actualAbsent ? "PASS" : "FINDING",
    notes: actualAbsent
      ? "no GET-by-id route exists to literally 404; the list GET correctly filters is_active=true so the soft-deleted row is absent from it -- closest available match to the expected 404 semantics"
      : `soft-deleted row is still present in the active list (is_active filter not applied or not persisted)`,
  };

  return steps;
}

async function testEmailSequences(sessions) {
  const w = sessions.writer.cookieHeader;
  const v = sessions.viewer.cookieHeader;
  const steps = {};

  const createRes = await call("POST", "/api/email/sequences", w, {
    name: "PT-02-004 fixture sequence",
    description: "CRUD cycle test fixture",
    steps: [{ delay_days: 0 }, { delay_days: 3 }],
  });
  const createOk = createRes.status >= 200 && createRes.status < 300;
  const id = createOk ? createRes.body?.id : null;
  const viewerCreate = await call("POST", "/api/email/sequences", v, {
    name: "viewer should not create this",
    steps: [{ delay_days: 0 }],
  });
  steps.create = {
    route: createRes.route,
    outcome: "tested",
    status: createRes.status,
    hasId: isUuid(id),
    id,
    shapeOk: createOk && isUuid(id),
    notes: createOk ? "created email_campaign_sequences row (+ 2 steps)" : `create failed: ${JSON.stringify(createRes.body)}`,
    viewerWriteAttempt: viewerAttempt(viewerCreate),
  };

  if (!id) {
    steps.read = skippedStep("GET /api/email/sequences/{id}", "create step did not return a usable id");
    steps.update = skippedStep("PATCH /api/email/sequences/{id}", "create step did not return a usable id");
    steps.delete = skippedStep("DELETE /api/email/sequences/{id}", "create step did not return a usable id");
    steps.readAfterDelete = skippedStep("GET /api/email/sequences/{id}", "create step did not return a usable id");
    return steps;
  }

  const readRes = await call("GET", `/api/email/sequences/${id}`, w);
  steps.read = {
    route: "GET /api/email/sequences/{id}",
    outcome: "tested",
    status: readRes.status,
    matchesCreated:
      readRes.status === 200 &&
      readRes.body?.sequence?.id === id &&
      readRes.body?.sequence?.name === "PT-02-004 fixture sequence" &&
      Array.isArray(readRes.body?.steps) &&
      readRes.body.steps.length === 2,
    notes: `id=${id}, steps_returned=${readRes.body?.steps?.length ?? "n/a"}`,
  };

  const updateRes = await call("PATCH", `/api/email/sequences/${id}`, w, { name: "PT-02-004 fixture sequence (updated)" });
  const viewerUpdate = await call("PATCH", `/api/email/sequences/${id}`, v, { name: "viewer should not update this" });
  const reRead = await call("GET", `/api/email/sequences/${id}`, w);
  steps.update = {
    route: "PATCH /api/email/sequences/{id}",
    outcome: "tested",
    status: updateRes.status,
    fieldChanged: "name",
    sentValue: "PT-02-004 fixture sequence (updated)",
    responseValue: updateRes.body?.sequence?.name ?? null,
    persistedValue: reRead.body?.sequence?.name ?? null,
    persisted: updateRes.status === 200 && reRead.body?.sequence?.name === "PT-02-004 fixture sequence (updated)",
    notes: updateRes.status === 200 ? "name updated via PATCH" : `update failed: ${JSON.stringify(updateRes.body)}`,
    viewerWriteAttempt: viewerAttempt(viewerUpdate),
  };

  const deleteRes = await call("DELETE", `/api/email/sequences/${id}`, w);
  const viewerDelete = await call("DELETE", `/api/email/sequences/${id}`, v);
  steps.delete = {
    route: "DELETE /api/email/sequences/{id}",
    outcome: "tested",
    status: deleteRes.status,
    notes: "route implements a REAL hard delete (.delete(), not a soft-delete flag)",
    viewerWriteAttempt: viewerAttempt(viewerDelete),
  };

  const readAfter = await call("GET", `/api/email/sequences/${id}`, w);
  const actual404 = readAfter.status === 404;
  steps.readAfterDelete = {
    route: "GET /api/email/sequences/{id}",
    outcome: "tested",
    status: readAfter.status,
    expected404: true,
    actual404,
    verdict: actual404 ? "PASS" : "FINDING",
    notes: actual404
      ? "confirmed real 404 after hard delete -- positive control demonstrating the DELETE-then-GET-404 assertion genuinely works when a route implements a real delete"
      : `expected 404 after a real hard delete, got ${readAfter.status}`,
  };

  return steps;
}

async function testGrantBudgets(sessions, fixtures) {
  const w = sessions.writer.cookieHeader;
  const v = sessions.viewer.cookieHeader;
  const steps = {};

  const createRes = await call("POST", "/api/financials/budgets", w, {
    application_id: fixtures.applicationId,
    total_budget: 10000,
    personnel: 6000,
    supplies: 2000,
    equipment: 1000,
    other: 1000,
  });
  const createOk = createRes.status >= 200 && createRes.status < 300;
  const id = createOk ? createRes.body?.budget?.id : null;
  const viewerCreate = await call("POST", "/api/financials/budgets", v, {
    application_id: fixtures.applicationId,
    total_budget: 1,
  });
  steps.create = {
    route: createRes.route,
    outcome: "tested",
    status: createRes.status,
    hasId: isUuid(id),
    id,
    shapeOk: createOk && createRes.body?.budget?.total_budget === 10000,
    notes: createOk ? "created grant_budgets row" : `create failed: ${JSON.stringify(createRes.body)}`,
    viewerWriteAttempt: viewerAttempt(viewerCreate),
  };

  if (!id) {
    steps.read = skippedStep("GET /api/financials/budgets?application_id=... (list, find by id)", "create step did not return a usable id");
  } else {
    const listRes = await call("GET", `/api/financials/budgets?application_id=${fixtures.applicationId}`, w);
    const foundInList = Array.isArray(listRes.body?.budgets) ? listRes.body.budgets.find((b) => b.id === id) : null;
    steps.read = {
      route: "GET /api/financials/budgets?application_id=... (list; no GET-by-id route exists)",
      outcome: "tested",
      status: listRes.status,
      matchesCreated: listRes.status === 200 && !!foundInList && foundInList.total_budget === 10000,
      notes: `id=${id}; found_in_list=${!!foundInList}`,
    };
  }

  steps.update = noRouteStep(
    "PATCH /api/financials/budgets/{id}",
    "no route exists: /api/financials/budgets/route.ts only exports GET (list) and POST (create); there is no /api/financials/budgets/[id]/route.ts and no update handler anywhere for this resource",
  );
  steps.delete = noRouteStep(
    "DELETE /api/financials/budgets/{id}",
    "no route exists: same file as above, no delete handler for this resource anywhere in the API",
  );
  steps.readAfterDelete = noRouteStep(
    "GET /api/financials/budgets/{id}",
    "not applicable -- no DELETE route exists for this resource, so there is nothing to confirm a 404 after",
  );

  return steps;
}

async function testApplications(sessions, fixtures) {
  const w = sessions.writer.cookieHeader;
  const v = sessions.viewer.cookieHeader;
  const steps = {};
  const id = fixtures.applicationId;

  steps.create = noRouteStep(
    "POST /api/applications",
    "no route exists: no /api/applications/route.ts anywhere in the API; the fixture application row used for read/update below was seeded directly (service role), not created through the API",
  );

  // Read via the one real GET-by-id endpoint that reads the applications table
  // (/api/drafts/[id]) -- there is no /api/applications/[id] GET.
  const readRes = await call("GET", `/api/drafts/${id}`, w);
  steps.read = {
    route: "GET /api/drafts/{id} (the only GET-by-id route that reads the applications table; there is no /api/applications/[id] GET)",
    outcome: "tested",
    status: readRes.status,
    matchesCreated: readRes.status === 200 && readRes.body?.application?.id === id,
    notes: `id=${id}, pending_review=${readRes.body?.application?.pending_review}`,
  };

  // Update via the real /api/applications/[id] PATCH -- narrow, pending_review-only endpoint
  // per its own header comment ("this isn't a general application-mutation endpoint").
  const updateRes = await call("PATCH", `/api/applications/${id}`, w, { pending_review: false });
  const viewerUpdate = await call("PATCH", `/api/applications/${id}`, v, { pending_review: true });
  const reRead = await call("GET", `/api/drafts/${id}`, w);
  steps.update = {
    route: "PATCH /api/applications/{id}",
    outcome: "tested",
    status: updateRes.status,
    fieldChanged: "pending_review",
    sentValue: false,
    responseValue: updateRes.body?.pending_review ?? null,
    persistedValue: reRead.body?.application?.pending_review ?? null,
    persisted: updateRes.status === 200 && reRead.body?.application?.pending_review === false,
    notes:
      updateRes.status === 200
        ? "pending_review flipped false via PATCH /api/applications/{id}; persistence verified via a fresh GET /api/drafts/{id} (the API's only readable view of this field), not a direct DB read"
        : `update failed: ${JSON.stringify(updateRes.body)}`,
    viewerWriteAttempt: viewerAttempt(viewerUpdate),
  };

  steps.delete = noRouteStep(
    "DELETE /api/applications/{id}",
    "no route exists: /api/applications/[id]/route.ts exports PATCH only",
  );
  steps.readAfterDelete = noRouteStep(
    "GET /api/applications/{id}",
    "not applicable -- no DELETE route exists for this resource",
  );

  return steps;
}

async function testDrafts(sessions, fixtures) {
  const w = sessions.writer.cookieHeader;
  const v = sessions.viewer.cookieHeader;
  const steps = {};
  const id = fixtures.applicationId;

  steps.create = noRouteStep(
    "POST /api/drafts",
    "no route exists: drafts are produced by draft-generation-agent.ts, never created directly through this API; the fixture application row used below was seeded directly (service role)",
  );

  const readRes = await call("GET", `/api/drafts/${id}`, w);
  steps.read = {
    route: "GET /api/drafts/{id}",
    outcome: "tested",
    status: readRes.status,
    matchesCreated:
      readRes.status === 200 &&
      readRes.body?.application?.id === id &&
      readRes.body?.application?.draft_content === "PT-02-004 fixture draft content, seeded before test.",
    notes: `id=${id}, pending_review=${readRes.body?.application?.pending_review}`,
  };

  // Update draft_content -- only allowed while pending_review=true (this must run BEFORE the
  // applications resource test above flips pending_review to false on the same fixture row).
  const updateRes = await call("PATCH", `/api/drafts/${id}`, w, { draft_content: "PT-02-004 fixture draft content (updated)." });
  const viewerUpdate = await call("PATCH", `/api/drafts/${id}`, v, { draft_content: "viewer should not update this" });
  const reRead = await call("GET", `/api/drafts/${id}`, w);
  steps.update = {
    route: "PATCH /api/drafts/{id}",
    outcome: "tested",
    status: updateRes.status,
    fieldChanged: "draft_content",
    sentValue: "PT-02-004 fixture draft content (updated).",
    responseValue: updateRes.body?.application?.draft_content ?? null,
    persistedValue: reRead.body?.application?.draft_content ?? null,
    persisted: updateRes.status === 200 && reRead.body?.application?.draft_content === "PT-02-004 fixture draft content (updated).",
    notes:
      updateRes.status === 200
        ? "draft_content updated via PATCH (route requires pending_review=true, which the fixture was seeded with)"
        : `update failed: ${JSON.stringify(updateRes.body)}`,
    viewerWriteAttempt: viewerAttempt(viewerUpdate),
  };

  steps.delete = noRouteStep(
    "DELETE /api/drafts/{id}",
    "no route exists: /api/drafts/[id]/route.ts exports GET and PATCH only",
  );
  steps.readAfterDelete = noRouteStep(
    "GET /api/drafts/{id}",
    "not applicable -- no DELETE route exists for this resource",
  );

  return steps;
}

async function testDonorDiscoveryProspects(sessions, fixtures) {
  const w = sessions.writer.cookieHeader;
  const v = sessions.viewer.cookieHeader;
  const steps = {};
  const id = fixtures.prospectId;

  steps.create = noRouteStep(
    "POST /api/donor-discovery/prospects",
    "no route exists: GET /api/donor-discovery/prospects is a directory-search/import endpoint, not a plain prospect-record creator; there is no POST here and no other route that creates a donor_discovery_prospects row directly -- prospects are populated by discovery agents/import. The fixture prospect used below was seeded directly (service role, plus its required directory/request FK rows).",
  );

  const readRes = await call("GET", `/api/donor-discovery/prospects/${id}`, w);
  steps.read = {
    route: "GET /api/donor-discovery/prospects/{id}",
    outcome: "tested",
    status: readRes.status,
    matchesCreated: readRes.status === 200 && readRes.body?.prospect?.id === id && readRes.body?.prospect?.pipeline_stage === "new",
    notes: `id=${id}`,
  };

  const updateRes = await call("PATCH", `/api/donor-discovery/prospects/${id}`, w, { pipeline_stage: "reviewing" });
  const viewerUpdate = await call("PATCH", `/api/donor-discovery/prospects/${id}`, v, { pipeline_stage: "contacted" });
  const reRead = await call("GET", `/api/donor-discovery/prospects/${id}`, w);
  steps.update = {
    route: "PATCH /api/donor-discovery/prospects/{id}",
    outcome: "tested",
    status: updateRes.status,
    fieldChanged: "pipeline_stage",
    sentValue: "reviewing",
    responseValue: updateRes.body?.prospect?.pipeline_stage ?? null,
    persistedValue: reRead.body?.prospect?.pipeline_stage ?? null,
    persisted: updateRes.status === 200 && reRead.body?.prospect?.pipeline_stage === "reviewing",
    notes: updateRes.status === 200 ? "pipeline_stage updated via PATCH" : `update failed: ${JSON.stringify(updateRes.body)}`,
    viewerWriteAttempt: viewerAttempt(viewerUpdate),
  };

  steps.delete = noRouteStep(
    "DELETE /api/donor-discovery/prospects/{id}",
    "no route exists: /api/donor-discovery/prospects/[id]/route.ts exports GET and PATCH only",
  );
  steps.readAfterDelete = noRouteStep(
    "GET /api/donor-discovery/prospects/{id}",
    "not applicable -- no DELETE route exists for this resource",
  );

  return steps;
}

function zeroRouteResource(labelPrefix, why) {
  return {
    create: noRouteStep(`POST ${labelPrefix}`, why),
    read: noRouteStep(`GET ${labelPrefix}/{id}`, why),
    update: noRouteStep(`PATCH/PUT ${labelPrefix}/{id}`, why),
    delete: noRouteStep(`DELETE ${labelPrefix}/{id}`, why),
    readAfterDelete: noRouteStep(`GET ${labelPrefix}/{id}`, "not applicable -- no CREATE or DELETE route exists for this resource"),
  };
}

// ----------------------------------------------------------------------------
// Aggregate verdict + main
// ----------------------------------------------------------------------------
function resourceVerdict(steps) {
  // create/read/update/delete: a >=400 status, a false shape/match/persist assertion, or a
  // viewer write attempt that was NOT refused are all real findings.
  for (const key of ["create", "read", "update", "delete"]) {
    const s = steps[key];
    if (!s || s.outcome !== "tested") continue;
    if (typeof s.status === "number" && s.status >= 400) return "FINDING";
    if (s.shapeOk === false) return "FINDING";
    if (s.matchesCreated === false) return "FINDING";
    if (s.persisted === false) return "FINDING";
    if (s.viewerWriteAttempt && s.viewerWriteAttempt.refused === false) return "FINDING";
  }
  // readAfterDelete: the expected, PASS-condition status is 404 (>=400), so this step is judged
  // solely by its own explicit verdict field, not the generic ">=400 is bad" rule above.
  const rad = steps.readAfterDelete;
  if (rad && rad.outcome === "tested" && rad.verdict === "FINDING") return "FINDING";
  return "PASS";
}

async function main() {
  console.log("PT-02-004: CRUD round-trip proof for core resources, through the real API layer");
  console.log(`  Target Supabase (LOCAL/BRANCH ONLY): ${LOCAL_URL}`);
  console.log(`  App under test: ${BASE_URL}\n`);

  const { orgId, sessions, fixtures } = await setupSessionsAndFixtures();

  console.log("\nPT-02-004: running CRUD cycles...");

  const resources = [];

  resources.push({
    resource: "draft_queue",
    label: "AutoApply Draft/Pipeline Queue (draft_queue table)",
    taskExample: "drafts / pipeline items",
    steps: await testDraftQueue(sessions, fixtures),
  });
  console.log("  draft_queue done");

  resources.push({
    resource: "request_profiles",
    label: "AutoApply Request Profiles (request_profiles table)",
    taskExample: "additional -- full-CRUD breadth resource, not in the task's named example list",
    steps: await testRequestProfiles(sessions),
  });
  console.log("  request_profiles done");

  resources.push({
    resource: "email_templates",
    label: "Email Templates (email_templates table)",
    taskExample: "additional -- full-CRUD breadth resource, not in the task's named example list",
    steps: await testEmailTemplates(sessions),
  });
  console.log("  email_templates done");

  resources.push({
    resource: "email_sequences",
    label: "Email Campaign Sequences (email_campaign_sequences table)",
    taskExample: "additional -- full-CRUD breadth resource, not in the task's named example list; also the one real hard-DELETE positive control in this set",
    steps: await testEmailSequences(sessions),
  });
  console.log("  email_sequences done");

  resources.push({
    resource: "grant_budgets",
    label: "Grant Budgets (grant_budgets table)",
    taskExample: "grant_budgets",
    steps: await testGrantBudgets(sessions, fixtures),
  });
  console.log("  grant_budgets done");

  // NOTE: drafts must run BEFORE applications -- /api/drafts/{id} PATCH requires
  // pending_review=true (the fixture's seeded state), and the applications resource test below
  // deliberately flips pending_review to false as its own real, meaningful UPDATE assertion.
  // Running them in the other order would make drafts.update fail on a state the applications
  // test itself just changed, not a real app defect.
  resources.push({
    resource: "drafts",
    label: "Application Drafts (applications table, draft-content fields, via /api/drafts/[id])",
    taskExample: "drafts",
    steps: await testDrafts(sessions, fixtures),
  });
  console.log("  drafts done");

  resources.push({
    resource: "applications",
    label: "Applications (applications table, application-record fields)",
    taskExample: "applications",
    steps: await testApplications(sessions, fixtures),
  });
  console.log("  applications done");

  resources.push({
    resource: "donor_discovery_prospects",
    label: "Donor Discovery Prospects (donor_discovery_prospects table)",
    taskExample: "donor-discovery prospects",
    steps: await testDonorDiscoveryProspects(sessions, fixtures),
  });
  console.log("  donor_discovery_prospects done");

  resources.push({
    resource: "opportunities",
    label: "Opportunities (opportunities table)",
    taskExample: "opportunities",
    steps: zeroRouteResource(
      "/api/opportunities",
      "no CRUD route surface exists for the opportunities resource itself: the only two nested GET routes under /api/opportunities/[id]/ are narrative-gap-analysis and probability, neither of which reads or returns the opportunity record; there is no plain GET/POST/PATCH/DELETE anywhere for opportunities",
    ),
  });
  console.log("  opportunities done (zero-route finding)");

  resources.push({
    resource: "contacts",
    label: "Contacts (contacts table)",
    taskExample: "contacts",
    steps: zeroRouteResource(
      "/api/contacts",
      "no CRUD route surface exists for the contact record itself: only nested /api/contacts/[id]/outreach/{call,linkedin,mail} (POST, draft-generation actions) and a distinct contact_tasks sub-resource (/api/contacts/[id]/tasks GET, /api/contacts/tasks/[taskId] PATCH) exist; none of these read, create, or delete a contacts row",
    ),
  });
  console.log("  contacts done (zero-route finding)");

  resources.push({
    resource: "deadlines",
    label: "Deadlines (deadlines table)",
    taskExample: "deadlines",
    steps: zeroRouteResource(
      "/api/deadlines",
      "no CRUD route surface exists for deadline records: /api/deadlines/check (GET, POST) is an autonomous scan/action-trigger endpoint (recomputes reminder state across all deadlines), not a per-record create/read/update/delete endpoint",
    ),
  });
  console.log("  deadlines done (zero-route finding)");

  for (const r of resources) {
    r.verdict = resourceVerdict(r.steps);
  }

  const findingCount = resources.filter((r) => r.verdict === "FINDING").length;
  const noRouteStepCount = resources.reduce(
    (sum, r) => sum + Object.values(r.steps).filter((s) => s && s.outcome === "no_route").length,
    0,
  );

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(
    OUT_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        baseUrl: BASE_URL,
        targetSupabaseUrl: LOCAL_URL,
        note:
          "LOCAL/BRANCH ONLY. Real mutations against a throwaway org+users+fixtures provisioned by " +
          "this same script on a local Supabase instance -- never production. Every create/read/" +
          "update/delete call went through the real, unmodified Next.js API layer (fetch against " +
          "the app under test), never a direct DB write for the resource under test itself -- " +
          "direct service-role inserts were used only for prerequisite FK fixtures (an opportunity, " +
          "a pending_review application, a donor-discovery directory/request pair) that have no " +
          "CREATE route of their own, per each resource's own notes. Roles: writer (performs every " +
          "CRUD call), viewer (one WRITE attempt per existing mutation route, expected refused).",
        testOrgId: orgId,
        fixtures,
        resourceCount: resources.length,
        findingResourceCount: findingCount,
        noRouteStepCount,
        resources,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(`\nPT-02-004 DONE: ${resources.length} resource(s) written to ${path.relative(REPO_ROOT, OUT_PATH)}`);
  console.log(`  ${findingCount} resource(s) with at least one FINDING verdict; ${noRouteStepCount} no_route step(s) recorded.`);
  for (const r of resources) {
    console.log(`  ${r.resource}: ${r.verdict}`);
  }
}

main().catch((err) => {
  console.error("PT-02-004 FATAL:", err);
  process.exit(1);
});
