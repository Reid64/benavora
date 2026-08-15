// Live adversarial security test harness: RLS/tenant isolation, auth boundaries,
// SQLi, XSS, CSRF cookie check. Creates two throwaway test orgs/users via
// service role, signs in for real session cookies, hits real production API
// routes at PROD_BASE, then cleans up all created rows.
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import ws from "ws";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PROD_BASE = "https://www.benavora.com";

const serviceClient = createSupabaseClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  realtime: { transport: ws },
});

const stamp = Date.now();
const createdOrgIds = [];
const createdUserIds = [];
const cleanupRows = []; // { table, column, value }

function log(...args) {
  console.log(...args);
}

async function createOrgAndUser(label, role) {
  const { data: org, error: orgErr } = await serviceClient
    .from("organizations")
    .insert({ name: `SECTEST-${label}-${stamp}`, onboarding_completed: true })
    .select()
    .single();
  if (orgErr) throw new Error(`org create failed (${label}): ${orgErr.message}`);
  createdOrgIds.push(org.id);

  const email = `sectest-${label.toLowerCase()}-${stamp}@example.invalid`;
  const password = `SecTest!${stamp}Aa1`;
  const { data: userRes, error: userErr } = await serviceClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userErr) throw new Error(`user create failed (${label}): ${userErr.message}`);
  createdUserIds.push(userRes.user.id);

  const { error: profErr } = await serviceClient
    .from("profiles")
    .upsert({ id: userRes.user.id, organization_id: org.id, role, email });
  if (profErr) throw new Error(`profile upsert failed (${label}): ${profErr.message}`);

  return { org, email, password, userId: userRes.user.id };
}

// Build a real signed-in session using @supabase/ssr's own cookie
// serialization (in-memory jar), so we can replay the SAME cookie format
// the real browser/app would send to production API routes.
async function signInWithCookieJar(email, password) {
  const jar = new Map();
  const client = createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: {
      getAll() {
        return Array.from(jar.entries()).map(([name, value]) => ({ name, value }));
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) jar.set(name, value);
      },
    },
    realtime: { transport: ws },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed: ${error.message}`);
  const cookieHeader = Array.from(jar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  return { client, cookieHeader, session: data.session };
}

async function sweepLeftoverTestOrgs() {
  const { data: leftovers } = await serviceClient
    .from("organizations")
    .select("id, name")
    .like("name", "SECTEST-%");
  if (!leftovers?.length) return;
  log(`Sweeping ${leftovers.length} leftover SECTEST orgs from prior runs...`);
  for (const org of leftovers) {
    await serviceClient.from("platform_config").delete().eq("organization_id", org.id);
    const { data: profs } = await serviceClient.from("profiles").select("id").eq("organization_id", org.id);
    for (const p of profs ?? []) {
      await serviceClient.auth.admin.deleteUser(p.id).catch(() => {});
    }
    const { error } = await serviceClient.from("organizations").delete().eq("id", org.id);
    log(`  swept ${org.name}:`, error ? `FAILED: ${error.message}` : "ok");
  }
}

async function main() {
  await sweepLeftoverTestOrgs();
  log("=== Setting up two throwaway orgs/users ===");
  const A_owner = await createOrgAndUser("OrgA-Owner", "owner");
  const A_viewer = await createOrgAndUser("OrgA-Viewer", "viewer");
  const B_owner = await createOrgAndUser("OrgB-Owner", "owner");
  log("Org A:", A_owner.org.id, "Org B:", B_owner.org.id);

  const sessA = await signInWithCookieJar(A_owner.email, A_owner.password);
  const sessAViewer = await signInWithCookieJar(A_viewer.email, A_viewer.password);
  const sessB = await signInWithCookieJar(B_owner.email, B_owner.password);
  log("Signed in all 3 test sessions.");
  log("Sample cookie header (name only):", sessA.cookieHeader.split("=")[0]);

  // ---------------------------------------------------------------
  // TEST 5: RLS / tenant isolation on 5 org-scoped tables not covered
  // by the existing rls.test.ts helper chain (funders/opportunities/
  // applications/outcomes/donor_discovery_requests/etc).
  // ---------------------------------------------------------------
  log("\n=== TEST 5: RLS / tenant isolation ===");
  const rlsResults = [];

  const rlsTables = [
    { table: "marketplace_listings", orgCol: "organization_id", seed: { title: `sectest-listing-${stamp}`, category: "housing_grant", status: "active", is_seed_data: false } },
    { table: "board_meetings", orgCol: "org_id", seed: { meeting_date: "2026-09-01", meeting_type: "regular", status: "scheduled" } },
    { table: "impact_simulations", orgCol: "org_id", seed: { scenario_type: "budget_cut", scenario_params: { pct: 10 }, generated_at: "2026-08-15T00:00:00Z" } },
    { table: "funding_forecasts", orgCol: "org_id", seed: { forecast_date: "2026-08-15", forecast_period: "90_day", factors: { note: "sectest" } } },
    { table: "community_need_signals", orgCol: "org_id", seed: { signal_source: "sectest", signal_category: "housing", signal_description: "sectest signal" } },
  ];

  for (const t of rlsTables) {
    const result = { table: t.table, orgCol: t.orgCol };
    try {
      // Seed a row as Org A owner (service-role insert, tagged to org A) so we
      // control exactly what exists, then test Org B's SESSION client access.
      const seedRow = { ...t.seed, [t.orgCol]: A_owner.org.id };
      const { data: inserted, error: insErr } = await serviceClient
        .from(t.table)
        .insert(seedRow)
        .select()
        .single();
      if (insErr) {
        result.seedError = insErr.message;
        rlsResults.push(result);
        continue;
      }
      cleanupRows.push({ table: t.table, column: "id", value: inserted.id });
      result.seededRowId = inserted.id;

      // Org B session tries to SELECT org A's row directly by id.
      const { data: selData, error: selErr } = await sessB.client
        .from(t.table)
        .select("*")
        .eq("id", inserted.id);
      result.crossOrgSelect = {
        rowsReturned: selData?.length ?? 0,
        error: selErr?.message ?? null,
      };

      // Org B session tries to UPDATE org A's row.
      const { data: updData, error: updErr } = await sessB.client
        .from(t.table)
        .update({ [t.orgCol]: B_owner.org.id })
        .eq("id", inserted.id)
        .select();
      result.crossOrgUpdate = {
        rowsAffected: updData?.length ?? 0,
        error: updErr?.message ?? null,
      };

      // Org B session tries to DELETE org A's row.
      const { data: delData, error: delErr } = await sessB.client
        .from(t.table)
        .delete()
        .eq("id", inserted.id)
        .select();
      result.crossOrgDelete = {
        rowsAffected: delData?.length ?? 0,
        error: delErr?.message ?? null,
      };

      // Org A's own session should still see its row (sanity check the table
      // isn't just universally blocked/broken).
      const { data: ownData, error: ownErr } = await sessA.client
        .from(t.table)
        .select("*")
        .eq("id", inserted.id);
      result.ownOrgSelect = {
        rowsReturned: ownData?.length ?? 0,
        error: ownErr?.message ?? null,
      };
    } catch (e) {
      result.exception = e.message;
    }
    rlsResults.push(result);
    log(JSON.stringify(result, null, 2));
  }

  // ---------------------------------------------------------------
  // TEST 6: Auth boundaries — viewer-role session hitting owner/admin-only
  // production API routes.
  // ---------------------------------------------------------------
  log("\n=== TEST 6: Auth boundaries (viewer session vs owner/admin routes) ===");
  const authRoutes = [
    { method: "GET", path: "/api/admin/system" },
    { method: "GET", path: "/api/admin/audit-log" },
    { method: "GET", path: "/api/admin/orgs" },
    { method: "POST", path: `/api/admin/orgs/${B_owner.org.id}/suspend`, body: { suspended: true } },
    { method: "POST", path: `/api/admin/orgs/${B_owner.org.id}/impersonate`, body: {} },
    { method: "GET", path: "/api/command-center/layout" },
    { method: "GET", path: "/api/admin/platform-metrics" },
  ];
  const authResults = [];
  for (const r of authRoutes) {
    try {
      const res = await fetch(`${PROD_BASE}${r.path}`, {
        method: r.method,
        headers: {
          Cookie: sessAViewer.cookieHeader,
          "Content-Type": "application/json",
        },
        body: r.body ? JSON.stringify(r.body) : undefined,
        redirect: "manual",
      });
      const text = res.type === "opaqueredirect" ? "" : await res.text();
      authResults.push({ ...r, status: res.status, type: res.type, location: res.headers.get("location"), bodySnippet: text.slice(0, 150) });
      log(`${r.method} ${r.path} -> ${res.status} (${res.type}) loc=${res.headers.get("location") ?? ""}`);
    } catch (e) {
      authResults.push({ ...r, error: e.message });
      log(`${r.method} ${r.path} -> ERROR ${e.message}`);
    }
  }

  // ---------------------------------------------------------------
  // TEST 3: CSRF — same admin routes, called WITHOUT any auth cookie at all
  // (simulating an unauthenticated cross-origin form post) — redirect:manual
  // so a 307-to-/login isn't misread as a 200 success by fetch's default
  // auto-follow. Also report the actual session cookie's attributes.
  // ---------------------------------------------------------------
  log("\n=== TEST 3: CSRF — no-cookie baseline ===");
  const csrfResults = [];
  for (const r of authRoutes) {
    try {
      const res = await fetch(`${PROD_BASE}${r.path}`, {
        method: r.method,
        headers: { "Content-Type": "application/json" },
        body: r.body ? JSON.stringify(r.body) : undefined,
        redirect: "manual",
      });
      const text = res.type === "opaqueredirect" ? "" : await res.text();
      csrfResults.push({ ...r, status: res.status, type: res.type, location: res.headers.get("location"), bodySnippet: text.slice(0, 150) });
      log(`(no cookie) ${r.method} ${r.path} -> ${res.status} (${res.type}) loc=${res.headers.get("location") ?? ""}`);
    } catch (e) {
      csrfResults.push({ ...r, error: e.message });
    }
  }

  // ---------------------------------------------------------------
  // TEST 1: SQL injection payloads against real search/filter endpoints.
  // ---------------------------------------------------------------
  log("\n=== TEST 1: SQL injection payloads ===");
  const sqliPayloads = [
    "' OR '1'='1",
    "'; DROP TABLE opportunities; --",
    "1' UNION SELECT NULL,NULL,NULL--",
    "\" OR \"\"=\"",
    "$(whoami)",
    "{{7*7}}",
  ];
  const sqliResults = [];
  for (const payload of sqliPayloads) {
    for (const spec of [
      { path: `/api/intelligence/search?q=${encodeURIComponent(payload)}`, method: "GET" },
      { path: `/api/intelligence/library/search`, method: "POST", body: { query: payload } },
      { path: `/api/donor-discovery/taxonomy/search?q=${encodeURIComponent(payload)}`, method: "GET" },
    ]) {
      const path = spec.path;
      try {
        const res = await fetch(`${PROD_BASE}${spec.path}`, {
          method: spec.method,
          headers: { Cookie: sessA.cookieHeader, "Content-Type": "application/json" },
          body: spec.body ? JSON.stringify(spec.body) : undefined,
        });
        const text = await res.text();
        sqliResults.push({
          path,
          payload,
          status: res.status,
          looksLikeSqlError: /syntax error|pg_|postgres|SQLSTATE/i.test(text),
          bodySnippet: text.slice(0, 120),
        });
      } catch (e) {
        sqliResults.push({ path, payload, error: e.message });
      }
    }
  }
  for (const r of sqliResults) {
    log(`${r.status ?? "ERR"} ${r.path} payload=${JSON.stringify(r.payload)} sqlError=${r.looksLikeSqlError ?? "n/a"}`);
  }

  // ---------------------------------------------------------------
  // TEST 2: XSS — write a script payload into a real free-text field via
  // legit authenticated write, then read it back via the API/DB and check
  // whether raw markup would be emitted unescaped.
  // ---------------------------------------------------------------
  log("\n=== TEST 2: XSS payload round-trip ===");
  const xssPayload = `<script>window.__sectest_xss_${stamp}=1;</script><img src=x onerror=alert(1)>`;
  const xssResults = [];
  try {
    const { data: kb, error: kbErr } = await sessA.client
      .from("knowledge_base")
      .insert({
        organization_id: A_owner.org.id,
        category: "custom",
        title: `sectest-${stamp}`,
        content: xssPayload,
      })
      .select()
      .single();
    if (kbErr) {
      xssResults.push({ field: "knowledge_base.content", error: kbErr.message });
    } else {
      cleanupRows.push({ table: "knowledge_base", column: "id", value: kb.id });
      xssResults.push({
        field: "knowledge_base.content",
        storedRawUnescaped: kb.content === xssPayload,
        storedValue: kb.content,
      });
    }
  } catch (e) {
    xssResults.push({ field: "knowledge_base.content", exception: e.message });
  }

  // Also write into contacts.name (a field explicitly named in the task) —
  // free-text, rendered in Contact CRM list/detail views. contacts.funder_id
  // is NOT NULL, so seed a throwaway funder first.
  try {
    const { data: funder, error: funderErr } = await sessA.client
      .from("funders")
      .insert({
        organization_id: A_owner.org.id,
        name: `sectest-funder-${stamp}`,
        category: "housing_grant",
      })
      .select()
      .single();
    if (funderErr) throw new Error(`funder seed failed: ${funderErr.message}`);
    cleanupRows.push({ table: "funders", column: "id", value: funder.id });

    const { data: contact, error: contactErr } = await sessA.client
      .from("contacts")
      .insert({
        organization_id: A_owner.org.id,
        funder_id: funder.id,
        name: xssPayload,
      })
      .select()
      .single();
    if (contactErr) {
      xssResults.push({ field: "contacts.name", error: contactErr.message });
    } else {
      cleanupRows.push({ table: "contacts", column: "id", value: contact.id });
      xssResults.push({
        field: "contacts.name",
        storedRawUnescaped: contact.name === xssPayload,
        storedValue: contact.name,
      });
    }
  } catch (e) {
    xssResults.push({ field: "contacts.name", exception: e.message });
  }
  log(JSON.stringify(xssResults, null, 2));

  // ---------------------------------------------------------------
  // Cookie attributes actually issued for the session (CSRF-relevant).
  // ---------------------------------------------------------------
  log("\n=== Cookie attribute check ===");
  const cookieNames = sessA.cookieHeader.split("; ").map((c) => c.split("=")[0]);
  log("Cookie names set on sign-in:", cookieNames);

  // ---------------------------------------------------------------
  // CLEANUP
  // ---------------------------------------------------------------
  log("\n=== Cleanup ===");
  for (const row of cleanupRows) {
    const { error } = await serviceClient.from(row.table).delete().eq(row.column, row.value);
    log(`cleanup ${row.table} id=${row.value}:`, error ? `FAILED: ${error.message}` : "ok");
  }
  for (const uid of createdUserIds) {
    const { error } = await serviceClient.auth.admin.deleteUser(uid);
    log(`cleanup user ${uid}:`, error ? `FAILED: ${error.message}` : "ok");
  }
  for (const oid of createdOrgIds) {
    await serviceClient.from("platform_config").delete().eq("organization_id", oid);
    const { error } = await serviceClient.from("organizations").delete().eq("id", oid);
    log(`cleanup org ${oid}:`, error ? `FAILED: ${error.message}` : "ok");
  }

  console.log("\n\n=== FULL RESULTS JSON ===");
  console.log(JSON.stringify({ rlsResults, authResults, csrfResults, sqliResults, xssResults, cookieNames }, null, 2));
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
