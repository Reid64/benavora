// ============================================================================
// PT-14-004 -- resolve the conflict between MASTER_BACKLOG.md's Tier-1
// findings (2026-07-30: multiple anon-readable tables + 5/6 unpoliced
// storage buckets) and later claims that these were all fixed (the
// 2026-08-03/08-06 anon-grant-remediation sessions in STATE_OF_THE_BUILD.md
// / ANON_GRANT_AUDIT.md), by re-checking EVERY item individually, live,
// with the real anon key -- not by re-reading either prior document's word.
//
// Scope, exactly as instructed:
//   1. Every table in PT-06's live-schema list (184 tables,
//      test-evidence/pt-06/live-schema.json) gets a real, unauthenticated
//      anon-key REST read attempt against production. Any table that
//      returns real rows to anon is flagged; cross-referenced against
//      PT-06's tenant_fk_gap list (integrity.json) and PT-05's cross-org
//      isolation results (cross-read.json) so a finding here can state
//      plainly whether it's ALSO a tenant column with no FK, and whether
//      PT-05 already tested authenticated cross-org access on the same
//      table.
//   2. Every live storage bucket (storage.buckets, fetched read-only) gets
//      its real storage.objects access policy confirmed (DB-level: RLS
//      enabled + anon/authenticated grants + per-bucket policy text) AND a
//      real anon LIST/GET attempt.
//   3. Every public-schema RPC function PostgREST exposes gets enumerated
//      (name, args, SECURITY DEFINER flag, whether anon has EXECUTE) --
//      NOT live-invoked one by one, since several real RPCs in this schema
//      are mutating (queue resume/skip, usage counters) and blindly calling
//      them with the anon key would risk corrupting real production state,
//      which is outside what "enumerate the surface" requires.
//
// Method, two layers per table/bucket, both real:
//   (a) DB-level ground truth -- pg_class.relrowsecurity, pg_policies,
//       information_schema.role_table_grants -- fetched over the SAME
//       read-only-enforced DATABASE_URL connection PT-06-001 and PT-05-002
//       already proved safe (SET default_transaction_read_only = on,
//       verified with a real rejected write). This is what actually
//       determines the verdict when live data happens to be absent (a
//       zero-row table can't be resolved by data alone).
//   (b) Live anon-key HTTP attempt -- a real GET against
//       {SUPABASE_URL}/rest/v1/{table} with ONLY the anon key (apikey +
//       Authorization: Bearer <anon key>, no user session, no JWT) --
//       Range: 0-0 + Prefer: count=exact to get a real row and a real total
//       count without downloading bulk data. A parallel service-role
//       request (ground truth for "does real data exist at all") is run
//       for comparison, using the identical Range/count technique so it
//       never bulk-downloads either. Neither request captures or persists
//       actual column VALUES for real production rows (no PII/customer
//       data is written into this evidence file) -- only row counts, the
//       returned row's `id` (a UUID, used only to prove the anon and
//       service-role rows are literally the same row), and the column-name
//       shape.
//
// Evidence: test-evidence/pt-14/rls-anon-audit.json
// Usage: node scripts/audit/pt14-004-anon-rls-storage-audit.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "test-evidence", "pt-14");
const OUT_FILE = path.join(OUT_DIR, "rls-anon-audit.json");
const PT06_LIVE_SCHEMA = path.join(ROOT, "test-evidence", "pt-06", "live-schema.json");
const PT06_INTEGRITY = path.join(ROOT, "test-evidence", "pt-06", "integrity.json");
const PT05_CROSS_READ = path.join(ROOT, "test-evidence", "pt-05", "cross-read.json");
const PRODUCTION_REF = "vbjplpquqxxfbpazyalt";

function loadEnv(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return env;
}

// Tables with no tenant column that are documented (RLS_POLICY_AUDIT.md §5,
// STORAGE_POLICY_AUDIT.md, MASTER_BACKLOG.md §1.4) as legitimately
// shared/platform reference content with no PII and no per-customer data --
// low severity if anon-open, unlike everything else in the schema. This is
// a judgment allowlist, kept narrow on purpose: anything not on it defaults
// to P0 if anon can read real rows from it, per the task's own instruction
// to treat "any table exposing real data to anon" as the finding, not just
// tables with an organization_id column.
const LOW_SENSITIVITY_SHARED_REFERENCE_TABLES = new Set([
  "donor_discovery_taxonomy",
  "donor_discovery_taxonomy_aliases",
  "intelligence_budget_patterns",
  "intelligence_budget_templates",
  "intelligence_evaluation_frameworks",
  "intelligence_scoring_rubrics",
  "intelligence_narrative_patterns",
  "intelligence_logic_models",
  "intelligence_need_data",
  "intelligence_grantmaker_profiles",
  "intelligence_post_award_reports",
  "knowledge_patterns",
  "platform_learning_patterns",
  "worker_status",
  "community_foundation_registry",
]);

function classifySeverity(tableName, hasTenantColumn, verdict) {
  if (verdict !== "ANON_OPEN_WITH_DATA") return null;
  if (hasTenantColumn) return "P0";
  if (LOW_SENSITIVITY_SHARED_REFERENCE_TABLES.has(tableName)) return "P2";
  return "P0";
}

function parseContentRange(headerValue) {
  // "0-0/133815" or "*/0" or null if header absent.
  if (!headerValue) return { rangeStart: null, rangeEnd: null, total: null };
  const m = headerValue.match(/^(\*|\d+)-?(\d+)?\/(\*|\d+)$/);
  if (!m) return { rangeStart: null, rangeEnd: null, total: null };
  const total = m[3] === "*" ? null : parseInt(m[3], 10);
  return { rangeStart: m[1] === "*" ? null : parseInt(m[1], 10), rangeEnd: m[2] ? parseInt(m[2], 10) : null, total };
}

async function restProbe(baseUrl, table, key, { withCount = true } = {}) {
  const url = `${baseUrl}/rest/v1/${encodeURIComponent(table)}?select=*`;
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Range: "0-0",
  };
  if (withCount) headers.Prefer = "count=exact";
  let res;
  try {
    res = await fetch(url, { method: "GET", headers, signal: AbortSignal.timeout(20000) });
  } catch (err) {
    return { transport_error: err.message || String(err) };
  }
  const status = res.status;
  const contentRange = res.headers.get("content-range");
  let body;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const isArray = Array.isArray(body);
  const { total } = parseContentRange(contentRange);
  return {
    http_status: status,
    ok: res.ok,
    row_count_returned: isArray ? body.length : 0,
    total_count: total,
    first_row_id: isArray && body.length > 0 && body[0] && typeof body[0] === "object" ? (body[0].id ?? null) : null,
    first_row_column_keys: isArray && body.length > 0 && body[0] && typeof body[0] === "object" ? Object.keys(body[0]).sort() : [],
    error_body: !isArray ? body : null,
    content_range_header: contentRange,
  };
}

async function probeTableBothKeys(baseUrl, table, anonKey, serviceKey) {
  let anon = await restProbe(baseUrl, table, anonKey, { withCount: true });
  if (anon.transport_error || (anon.http_status && anon.http_status >= 500)) {
    // Retry without Prefer: count=exact -- large tables can statement-timeout
    // computing an exact count under RLS; a bare Range:0-0 read is cheaper
    // and still tells us whether anon can read at least one row.
    const retry = await restProbe(baseUrl, table, anonKey, { withCount: false });
    anon = { ...retry, count_probe_failed_fell_back_to_uncounted: true, count_probe_error: anon.transport_error || anon.http_status };
  }
  let svc = await restProbe(baseUrl, table, serviceKey, { withCount: true });
  if (svc.transport_error || (svc.http_status && svc.http_status >= 500)) {
    const retry = await restProbe(baseUrl, table, serviceKey, { withCount: false });
    svc = { ...retry, count_probe_failed_fell_back_to_uncounted: true, count_probe_error: svc.transport_error || svc.http_status };
  }
  return { anon, svc };
}

// For a table where live data can't resolve the question (empty today, so
// anon and service-role both correctly return zero rows regardless of
// policy), fall back to the DB-level grant+RLS+policy state to give a real
// verdict instead of leaving the question open. This is the same
// resolution every "TABLE_EMPTY_INCONCLUSIVE" table gets, not just the
// ones MASTER_BACKLOG happened to name.
function dbLevelFallbackVerdict(dbRls, dbPolicies, dbGrants) {
  const anonGrants = dbGrants.filter((g) => g.grantee === "anon");
  const hasAnonSelectGrant = anonGrants.some((g) => g.privilege_type === "SELECT");
  if (!hasAnonSelectGrant) return "DB_LEVEL_SAFE: anon has no SELECT grant -- would be blocked even with real data";
  if (!dbRls.rls_enabled) return "DB_LEVEL_RISK: anon HAS SELECT grant and RLS IS NOT enabled -- would be fully open the moment real data exists";
  const anonSelectPolicy = dbPolicies.some((p) => {
    const roles = Array.isArray(p.roles) ? p.roles : String(p.roles).replace(/[{}]/g, "").split(",");
    return (p.cmd === "SELECT" || p.cmd === "ALL") && (roles.includes("public") || roles.includes("anon")) && p.permissive === "PERMISSIVE";
  });
  if (!anonSelectPolicy) return "DB_LEVEL_SAFE: anon HAS SELECT grant, RLS enabled, no SELECT policy applies to public/anon -- correctly blocked regardless of data";
  const anonPolicyPredicates = dbPolicies
    .filter((p) => {
      const roles = Array.isArray(p.roles) ? p.roles : String(p.roles).replace(/[{}]/g, "").split(",");
      return (p.cmd === "SELECT" || p.cmd === "ALL") && (roles.includes("public") || roles.includes("anon")) && p.permissive === "PERMISSIVE";
    })
    .map((p) => p.qual ?? "");
  const predicateLooksAnonSafe = anonPolicyPredicates.every((q) => /current_org_id\(\)|auth\.uid\(\)|auth\.role\(\)\s*=\s*'authenticated'/.test(q));
  return predicateLooksAnonSafe
    ? "DB_LEVEL_SAFE: anon HAS SELECT grant, RLS enabled, a policy applies to public/anon but its predicate references current_org_id()/auth.uid()/auth.role()='authenticated' -- evaluates false for an anon caller"
    : "DB_LEVEL_NEEDS_REVIEW: anon HAS SELECT grant, RLS enabled, a policy applies to public/anon and its predicate does not match a known anon-safe pattern -- would be OPEN the moment real data exists, review this policy manually";
}

function verdictFor(anon, svc) {
  if (anon.transport_error) return "PROBE_ERROR";
  if (anon.http_status === 401 || anon.http_status === 403) return "ANON_BLOCKED_NO_GRANT";
  if (anon.http_status !== 200) return "PROBE_ERROR";
  const anonHasRow = anon.row_count_returned > 0;
  if (anonHasRow) return "ANON_OPEN_WITH_DATA";
  // anon returned 200 with zero rows -- distinguish RLS-filtered-with-real-data
  // from genuinely-empty-table using the service-role ground truth.
  const svcTotal = svc.total_count;
  const svcHasRow = svc.row_count_returned > 0 || (svcTotal !== null && svcTotal > 0);
  if (svcHasRow) return "ANON_BLOCKED_BY_RLS";
  return "TABLE_EMPTY_INCONCLUSIVE";
}

async function pLimitMap(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function main() {
  const env = loadEnv(path.join(ROOT, ".env.local"));
  const DATABASE_URL = env.DATABASE_URL;
  const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
  const ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!DATABASE_URL || !SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
    console.error("HALT: missing DATABASE_URL / NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }
  if (!DATABASE_URL.includes(PRODUCTION_REF)) {
    console.error(`HALT: DATABASE_URL does not reference production ref "${PRODUCTION_REF}". Refusing to run against an unexpected target.`);
    process.exit(1);
  }

  if (!fs.existsSync(PT06_LIVE_SCHEMA)) {
    console.error(`HALT: ${PT06_LIVE_SCHEMA} not found. Run PT-06 first.`);
    process.exit(1);
  }
  const pt06Schema = JSON.parse(fs.readFileSync(PT06_LIVE_SCHEMA, "utf8"));
  const allTables = Object.keys(pt06Schema.tables).sort();
  console.log(`Loaded ${allTables.length} tables from PT-06's live-schema.json (table_count=${pt06Schema.table_count}).`);

  const tenantColumnByTable = {};
  for (const [table, def] of Object.entries(pt06Schema.tables)) {
    const cols = def.columns.map((c) => c.column_name);
    if (cols.includes("organization_id")) tenantColumnByTable[table] = "organization_id";
    else if (cols.includes("org_id")) tenantColumnByTable[table] = "org_id";
    else tenantColumnByTable[table] = null;
  }

  let integrity = null;
  let tenantFkGapByTable = {};
  if (fs.existsSync(PT06_INTEGRITY)) {
    integrity = JSON.parse(fs.readFileSync(PT06_INTEGRITY, "utf8"));
    for (const d of integrity.checks?.tenant_fk_gap?.details ?? []) {
      tenantFkGapByTable[d.table] = { has_fk: d.has_fk, fk_references: d.fk_references };
    }
  } else {
    console.warn(`WARNING: ${PT06_INTEGRITY} not found -- tenant_fk_gap cross-reference will be empty.`);
  }

  let pt05CrossReadByTable = {};
  let pt05Summary = null;
  if (fs.existsSync(PT05_CROSS_READ)) {
    const pt05 = JSON.parse(fs.readFileSync(PT05_CROSS_READ, "utf8"));
    pt05Summary = pt05.summary;
    for (const [table, v] of Object.entries(pt05.tables ?? {})) {
      pt05CrossReadByTable[table] = { method: v.method, verdict: v.verdict };
    }
  } else {
    console.warn(`WARNING: ${PT05_CROSS_READ} not found -- PT-05 cross-reference will be empty.`);
  }

  // ---- Phase 1: DB-level ground truth (read-only connection) ----
  console.log("Connecting read-only to production for RLS/grants/policy ground truth...");
  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
    statement_timeout: 25000,
  });
  await client.connect();
  const who = await client.query("select current_database() as db, inet_server_addr()::text as addr");
  console.log(`Connected: database=${who.rows[0].db} server_addr=${who.rows[0].addr}`);
  await client.query("SET default_transaction_read_only = on");
  const roCheck = await client.query("SHOW default_transaction_read_only");
  if (roCheck.rows[0].default_transaction_read_only !== "on") {
    console.error("HALT: could not confirm read-only mode is active.");
    await client.end();
    process.exit(1);
  }
  // Prove it's really enforced (matches PT-06-001's own methodology).
  try {
    await client.query("CREATE TABLE pt14_ro_probe_should_never_exist (id int)");
    console.error("HALT: read-only mode did NOT reject a CREATE TABLE. Refusing to proceed.");
    await client.end();
    process.exit(1);
  } catch (err) {
    if (!/read-only|25006/i.test(err.message)) {
      console.error(`HALT: unexpected error proving read-only mode: ${err.message}`);
      await client.end();
      process.exit(1);
    }
    console.log(`Read-only mode confirmed active (rejected CREATE TABLE: ${err.message}).`);
  }

  console.log("Querying pg_class.relrowsecurity for all public tables...");
  const relRows = await client.query(
    `select c.relname as table_name, c.relrowsecurity, c.relforcerowsecurity
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r','p')`,
  );
  const relByTable = {};
  for (const r of relRows.rows) relByTable[r.table_name] = { rls_enabled: r.relrowsecurity, rls_forced: r.relforcerowsecurity };

  console.log("Querying pg_policies for all public-schema tables...");
  const polRows = await client.query(
    `select tablename, policyname, permissive, roles, cmd, qual, with_check
     from pg_policies where schemaname = 'public' order by tablename, policyname`,
  );
  const policiesByTable = {};
  for (const r of polRows.rows) {
    (policiesByTable[r.tablename] ??= []).push({
      policyname: r.policyname,
      permissive: r.permissive,
      roles: r.roles,
      cmd: r.cmd,
      qual: r.qual,
      with_check: r.with_check,
    });
  }

  console.log("Querying information_schema.role_table_grants for anon/authenticated on all public tables...");
  const grantRows = await client.query(
    `select table_name, grantee, privilege_type from information_schema.role_table_grants
     where table_schema = 'public' and grantee in ('anon','authenticated')
     order by table_name, grantee, privilege_type`,
  );
  const grantsByTable = {};
  for (const r of grantRows.rows) {
    (grantsByTable[r.table_name] ??= []).push({ grantee: r.grantee, privilege_type: r.privilege_type });
  }

  console.log("Querying storage.buckets...");
  const bucketRows = await client.query(
    `select id, name, public, file_size_limit, allowed_mime_types, created_at, updated_at
     from storage.buckets order by name`,
  );

  console.log("Querying pg_policies for storage.objects...");
  const storagePolRows = await client.query(
    `select policyname, permissive, roles, cmd, qual, with_check
     from pg_policies where schemaname = 'storage' and tablename = 'objects' order by policyname`,
  );

  console.log("Querying storage.objects grants for anon/authenticated...");
  const storageGrantRows = await client.query(
    `select grantee, privilege_type from information_schema.role_table_grants
     where table_schema = 'storage' and table_name = 'objects' and grantee in ('anon','authenticated')
     order by grantee, privilege_type`,
  );
  const storageObjectsTableGrants = storageGrantRows.rows;

  console.log("Querying storage.objects RLS enabled flag...");
  const storageRelRow = await client.query(
    `select c.relrowsecurity, c.relforcerowsecurity from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'storage' and c.relname = 'objects'`,
  );

  console.log("Enumerating public-schema RPC functions (PostgREST /rpc/ surface)...");
  const rpcRows = await client.query(
    `select p.proname as name,
            pg_get_function_identity_arguments(p.oid) as args,
            p.prosecdef as security_definer,
            has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind in ('f','p')
       and pg_get_function_result(p.oid) is distinct from 'trigger'
     order by p.proname`,
  );

  await client.end();
  console.log("DB-level phase complete, connection closed.");

  // ---- Phase 2: live anon-key HTTP attempts (production REST API) ----
  console.log(`Running live anon-key + service-role REST probes against ${allTables.length} tables (concurrency 12)...`);
  const tableResults = {};
  let doneCount = 0;
  await pLimitMap(allTables, 12, async (table) => {
    const { anon, svc } = await probeTableBothKeys(SUPABASE_URL, table, ANON_KEY, SERVICE_KEY);
    const verdict = verdictFor(anon, svc);
    const hasTenantColumn = tenantColumnByTable[table] !== null;
    const severity = classifySeverity(table, hasTenantColumn, verdict);
    const dbRls = relByTable[table] ?? { rls_enabled: null, rls_forced: null, note: "table not found in pg_class scan" };
    const dbPolicies = policiesByTable[table] ?? [];
    const dbGrants = grantsByTable[table] ?? [];
    tableResults[table] = {
      tenant_column: tenantColumnByTable[table],
      has_tenant_column: hasTenantColumn,
      tenant_fk_gap: tenantFkGapByTable[table] ?? null,
      pt05_cross_org_isolation: pt05CrossReadByTable[table] ?? null,
      db_rls: dbRls,
      db_policies: dbPolicies,
      db_anon_authenticated_grants: dbGrants,
      anon_http_probe: anon,
      service_role_http_probe: svc,
      verdict,
      db_level_fallback_verdict: verdict === "TABLE_EMPTY_INCONCLUSIVE" ? dbLevelFallbackVerdict(dbRls, dbPolicies, dbGrants) : null,
      severity,
      is_p0_finding: severity === "P0",
    };
    doneCount++;
    if (doneCount % 25 === 0) console.log(`  ...${doneCount}/${allTables.length} tables probed`);
  });
  console.log(`Table probes complete: ${doneCount}/${allTables.length}.`);

  // ---- Phase 3: storage buckets, live probes ----
  console.log(`Running live storage probes against ${bucketRows.rows.length} buckets...`);
  const bucketResults = {};
  for (const b of bucketRows.rows) {
    const bucketId = b.id;
    const applicablePolicies = storagePolRows.rows.filter((p) => {
      const text = `${p.qual ?? ""} ${p.with_check ?? ""}`;
      return text.includes(`'${bucketId}'`);
    });
    const globalPolicies = storagePolRows.rows.filter((p) => {
      const text = `${p.qual ?? ""} ${p.with_check ?? ""}`;
      return !text.includes("bucket_id");
    });

    // Service-role LIST first -- ground truth for whether the bucket has any
    // real objects, and to get one real path for a download probe.
    let svcList = null;
    try {
      const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${encodeURIComponent(bucketId)}`, {
        method: "POST",
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 5, offset: 0, prefix: "" }),
        signal: AbortSignal.timeout(20000),
      });
      const body = await res.json().catch(() => null);
      svcList = { http_status: res.status, ok: res.ok, object_count: Array.isArray(body) ? body.length : null, first_object_name: Array.isArray(body) && body.length > 0 ? body[0].name : null, error_body: !Array.isArray(body) ? body : null };
    } catch (err) {
      svcList = { transport_error: err.message || String(err) };
    }

    // Anon LIST attempt.
    let anonList = null;
    try {
      const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${encodeURIComponent(bucketId)}`, {
        method: "POST",
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 5, offset: 0, prefix: "" }),
        signal: AbortSignal.timeout(20000),
      });
      const body = await res.json().catch(() => null);
      anonList = { http_status: res.status, ok: res.ok, object_count: Array.isArray(body) ? body.length : null, object_names: Array.isArray(body) ? body.map((o) => o.name) : null, error_body: !Array.isArray(body) ? body : null };
    } catch (err) {
      anonList = { transport_error: err.message || String(err) };
    }

    // Anon GET/download attempt of a real object path, if one exists
    // (service-role list found one). Uses the anon-authenticated download
    // endpoint (works for any bucket, public or not, if a SELECT policy
    // permits it), plus, for public buckets specifically, a fully
    // zero-header request against the /object/public/ endpoint -- the
    // strongest possible test of "unpoliced," since it needs no key at all.
    let anonDownload = null;
    let trulyAnonymousPublicDownload = null;
    const probePath = svcList?.first_object_name;
    if (probePath) {
      try {
        const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(bucketId)}/${probePath}`, {
          method: "GET",
          headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
          signal: AbortSignal.timeout(20000),
        });
        anonDownload = { http_status: res.status, ok: res.ok, content_length: res.headers.get("content-length"), probed_path: probePath };
      } catch (err) {
        anonDownload = { transport_error: err.message || String(err), probed_path: probePath };
      }
      if (b.public === true) {
        try {
          const res = await fetch(`${SUPABASE_URL}/storage/v1/object/public/${encodeURIComponent(bucketId)}/${probePath}`, {
            method: "GET",
            signal: AbortSignal.timeout(20000),
          });
          trulyAnonymousPublicDownload = { http_status: res.status, ok: res.ok, content_length: res.headers.get("content-length"), probed_path: probePath, note: "zero auth headers sent at all" };
        } catch (err) {
          trulyAnonymousPublicDownload = { transport_error: err.message || String(err), probed_path: probePath };
        }
      }
    }

    // Policy verdict, per bucket -- this is the DB-level "confirm the
    // access policy" requirement (task step 2), independent of whether the
    // bucket currently has any objects to leak.
    let policyVerdict;
    if (b.public === true) {
      policyVerdict = "PUBLIC_BUCKET_WORLD_READABLE_BY_DESIGN";
    } else if (applicablePolicies.length === 0 && globalPolicies.length === 0) {
      policyVerdict = "ZERO_POLICY_DEFAULT_DENY";
    } else {
      const anonRelevant = [...applicablePolicies, ...globalPolicies].some((p) => {
        const roles = Array.isArray(p.roles) ? p.roles : String(p.roles).replace(/[{}]/g, "").split(",");
        return roles.includes("public") || roles.includes("anon");
      });
      policyVerdict = anonRelevant ? "POLICY_APPLIES_TO_ANON_OR_PUBLIC" : "POLICY_EXISTS_AUTHENTICATED_OR_SCOPED_ONLY";
    }

    const objectsExist = (svcList?.object_count ?? 0) > 0;
    const anonCanList = anonList?.http_status === 200 && (anonList?.object_count ?? 0) > 0;
    const anonCanDownload = anonDownload?.http_status === 200 || trulyAnonymousPublicDownload?.http_status === 200;
    let liveExposureVerdict;
    if (b.public === true) liveExposureVerdict = "OPEN_PUBLIC_BY_DESIGN";
    else if (anonCanList || anonCanDownload) liveExposureVerdict = "ANON_OPEN";
    else if (!objectsExist) liveExposureVerdict = "NO_OBJECTS_TO_TEST";
    else liveExposureVerdict = "ANON_BLOCKED";

    bucketResults[bucketId] = {
      public_flag: b.public,
      file_size_limit: b.file_size_limit,
      created_at: b.created_at,
      db_storage_objects_rls_enabled: storageRelRow.rows[0]?.relrowsecurity ?? null,
      db_storage_objects_table_level_anon_grants: storageObjectsTableGrants.filter((g) => g.grantee === "anon"),
      db_policies_applicable_to_this_bucket: applicablePolicies,
      db_policies_with_no_bucket_restriction_global: globalPolicies,
      db_policy_verdict: policyVerdict,
      service_role_list: svcList,
      anon_list: anonList,
      anon_download_attempt: anonDownload,
      truly_anonymous_public_download_attempt: trulyAnonymousPublicDownload,
      objects_confirmed_to_exist: objectsExist,
      live_exposure_verdict: liveExposureVerdict,
      severity: liveExposureVerdict === "ANON_OPEN" ? "P0" : liveExposureVerdict === "OPEN_PUBLIC_BY_DESIGN" ? "P3" : null,
    };
    console.log(`  bucket ${bucketId}: public=${b.public} policyVerdict=${policyVerdict} liveExposure=${liveExposureVerdict}`);
  }

  // ---- RPCs (enumeration only, DB-level, no invocation) ----
  const rpcResults = rpcRows.rows.map((r) => ({
    name: r.name,
    args: r.args,
    security_definer: r.security_definer,
    anon_can_execute: r.anon_can_execute,
    authenticated_can_execute: r.authenticated_can_execute,
    risk_note:
      r.anon_can_execute && r.security_definer
        ? "anon EXECUTE granted AND SECURITY DEFINER -- runs with the function owner's privileges regardless of caller; review this function's own body for missing authorization checks before treating it as safe"
        : r.anon_can_execute
          ? "anon EXECUTE granted, SECURITY INVOKER -- runs as the anon role, subject to normal table grants/RLS"
          : "anon has no EXECUTE grant -- not callable via PostgREST /rpc/ by an unauthenticated client",
  }));

  // ---- Resolve each MASTER_BACKLOG Tier-1 disputed item explicitly ----
  const disputedItems = [
    { id: "1.1-1", table: "platform_admins", masterBacklogClaim: "anon OPEN, 1/1 rows -- highest-severity single finding", laterNoteClaim: "2026-08-06 RLS remediation session claims all 55 remaining Category C tables (this one included, per ANON_GRANT_AUDIT.md's table list) closed -- RLS enabled, zero permissive policy, real anon grants revoked" },
    { id: "1.1-2", table: "organizational_digital_twins", masterBacklogClaim: "anon reads 10/10 rows -- migration source shows correct org-scoped policy, live/source drift suspected", laterNoteClaim: "2026-08-03 corporate_prospects/related hardening pass + 2026-08-06 remediation claims this table's live/source drift was fixed" },
    { id: "1.1-3", table: "opportunity_probability_scores", masterBacklogClaim: "anon reads 995/995 rows", laterNoteClaim: "2026-08-03 session (STATE_OF_THE_BUILD.md) explicitly claims this table's RLS was fixed live that session, closing a real cross-tenant IDOR" },
    { id: "1.1-4", table: "donor_discovery_directory", masterBacklogClaim: "anon reads all 133,815/133,815 rows -- no RLS-enable statement found anywhere", laterNoteClaim: "2026-08-06 remediation session's 55-table list / ANON_GRANT_AUDIT.md §8" },
    { id: "1.1-5", table: "autoapply_submissions", masterBacklogClaim: "anon OPEN (1/1) -- migration 066 written to fix this, still doesn't work live per source-drift", laterNoteClaim: "2026-08-06 remediation claims this table (among others) closed" },
    { id: "1.1-6", table: "submission_queue", masterBacklogClaim: "anon OPEN (1/1) -- same migration 066 drift", laterNoteClaim: "2026-08-06 remediation claims this table closed" },
    { id: "1.1-7", table: "form_templates", masterBacklogClaim: "anon OPEN (12/12) -- same migration 066 drift", laterNoteClaim: "2026-08-03 session explicitly claims this table's RLS was fixed live (cross-tenant IDOR closure), plus 2026-08-06 remediation" },
    { id: "1.1-8", table: "request_profiles", masterBacklogClaim: "anon OPEN (1/1) -- no RLS-enable statement found anywhere, existed live since 2026-07-30", laterNoteClaim: "2026-08-06 remediation claims this table closed" },
    { id: "1.2-9", bucket: "session-recordings", masterBacklogClaim: "zero storage.objects policy -- confirmed user-facing break (delete-recording click fails)", laterNoteClaim: "not explicitly named in the 2026-08-06 remediation (that pass was table RLS, not storage) -- disputed by omission" },
    { id: "1.2-10", bucket: "org-b1ab7402-dfc2-4712-869f-70ea3566cc1d", masterBacklogClaim: "zero storage.objects policy -- confirmed user-facing break for that org's document/branding uploads", laterNoteClaim: "not explicitly named in the 2026-08-06 remediation -- disputed by omission" },
    { id: "1.2-11", bucket: "documents", masterBacklogClaim: "zero policy, degrades silently (route only checks if(!dlErr && blob))", laterNoteClaim: "not explicitly named in the 2026-08-06 remediation -- disputed by omission" },
    { id: "1.2-12a", bucket: "autoapply-screenshots", masterBacklogClaim: "zero policy, currently masked by service-role-only usage", laterNoteClaim: "not explicitly named in the 2026-08-06 remediation -- disputed by omission" },
    { id: "1.2-12b", bucket: "org-documents", masterBacklogClaim: "zero policy, currently masked by service-role-only usage", laterNoteClaim: "not explicitly named in the 2026-08-06 remediation -- disputed by omission" },
    { id: "1.2-13", bucket: "nofa-pdfs", masterBacklogClaim: "write policy is unscoped-authenticated (any org can overwrite any object) -- read is intentionally public", laterNoteClaim: "not disputed -- flagged only for a one-line intentionality confirmation, not claimed fixed anywhere" },
  ];

  const resolvedDisputes = disputedItems.map((item) => {
    if (item.table) {
      const r = tableResults[item.table];
      if (!r) {
        return { ...item, resolvedAs: "TABLE_NOT_IN_PT06_SCHEMA", note: "table not found in PT-06's live-schema.json -- cannot resolve" };
      }
      const resolvedAs =
        r.verdict === "ANON_OPEN_WITH_DATA" ? "STILL_OPEN_CONFIRMED_LIVE" :
        r.verdict === "ANON_BLOCKED_NO_GRANT" || r.verdict === "ANON_BLOCKED_BY_RLS" ? "CONFIRMED_FIXED_LIVE" :
        r.verdict === "TABLE_EMPTY_INCONCLUSIVE" ? "DATA_ABSENT_RESOLVED_VIA_DB_POLICY_INSPECTION" :
        "PROBE_ERROR_UNRESOLVED";
      // For the empty-table case, reuse the same DB-level grant/RLS fallback
      // every other empty table gets (computed once, above, per table) to
      // give a real verdict instead of leaving it inconclusive.
      const dbLevelVerdict = r.db_level_fallback_verdict;
      return {
        ...item,
        resolvedAs,
        dbLevelVerdict,
        liveVerdictThisAudit: r.verdict,
        anonHttpStatus: r.anon_http_probe.http_status ?? r.anon_http_probe.transport_error ?? null,
        anonRowsReturned: r.anon_http_probe.row_count_returned ?? null,
        serviceRoleTotalRowsForComparison: r.service_role_http_probe.total_count ?? r.service_role_http_probe.row_count_returned ?? null,
        evidenceRef: "test-evidence/pt-14/rls-anon-audit.json#tables." + item.table,
      };
    }
    if (item.bucket) {
      const r = bucketResults[item.bucket];
      if (!r) {
        return { ...item, resolvedAs: "BUCKET_NOT_FOUND_LIVE", note: "bucket does not exist in the live storage.buckets table today -- either renamed, deleted, or MASTER_BACKLOG's list is stale" };
      }
      const resolvedAs =
        r.live_exposure_verdict === "ANON_OPEN" ? "STILL_OPEN_CONFIRMED_LIVE" :
        r.live_exposure_verdict === "OPEN_PUBLIC_BY_DESIGN" ? "PUBLIC_BY_DESIGN_UNCHANGED" :
        r.live_exposure_verdict === "ANON_BLOCKED" ? "CONFIRMED_FIXED_LIVE" :
        "NO_DATA_RESOLVED_VIA_DB_POLICY_INSPECTION";
      return {
        ...item,
        resolvedAs,
        liveVerdictThisAudit: r.live_exposure_verdict,
        dbPolicyVerdict: r.db_policy_verdict,
        objectsConfirmedToExist: r.objects_confirmed_to_exist,
        evidenceRef: "test-evidence/pt-14/rls-anon-audit.json#buckets." + item.bucket,
      };
    }
    return item;
  });

  // ---- Beyond-literal-scope finding: anon base-table WRITE grants ----
  // The task's own steps are read-focused ("attempt a READ"), but the same
  // DB-level grant query used to resolve the read questions above also
  // captured INSERT/UPDATE/DELETE grants -- and 100+ tables turned out to
  // have never had their default PUBLIC INSERT/UPDATE/DELETE grant revoked
  // (same root cause STANDING_DIRECTIVES.md / project memory already
  // documents: "Public schema default ACLs auto-grant anon+authenticated
  // full CRUD"). This does NOT mean those tables are live-writable by anon
  // today -- for every one of them the same RLS policy that blocks anon
  // reads (organization_id = current_org_id()/auth.uid()-derived, which is
  // NULL for an anon caller and therefore never matches) also covers
  // INSERT/UPDATE/DELETE, so writes are blocked by the SAME mechanism as
  // reads, not a separate one. Flagged here as a real defense-in-depth gap
  // (the grant should have been revoked per the 2026-08-06 remediation's
  // own stated pattern, same as it was for `submission_queue`/
  // `donor_discovery_directory`/etc.) -- not as a live P0, since no write
  // path was found where the policy predicate itself is missing or
  // evaluates true for anon. No live INSERT/UPDATE/DELETE was attempted
  // against production tables to prove this further (that would be a real
  // write against production and is out of scope for a read-focused audit
  // -- PT-05 already established the safe methodology for testing writes,
  // against a local disposable stack, not production).
  const writeGrantFindings = [];
  for (const [table, r] of Object.entries(tableResults)) {
    const anonWriteGrants = r.db_anon_authenticated_grants.filter((g) => g.grantee === "anon" && ["INSERT", "UPDATE", "DELETE"].includes(g.privilege_type)).map((g) => g.privilege_type);
    if (anonWriteGrants.length === 0) continue;
    const anonRelevantWritePolicies = r.db_policies.filter((p) => {
      const roles = Array.isArray(p.roles) ? p.roles : String(p.roles).replace(/[{}]/g, "").split(",");
      const appliesToAnon = roles.includes("public") || roles.includes("anon");
      const isWriteCmd = ["INSERT", "UPDATE", "DELETE", "ALL"].includes(p.cmd);
      return appliesToAnon && isWriteCmd && p.permissive === "PERMISSIVE";
    });
    const policyNeutralizesAnon = anonRelevantWritePolicies.every((p) => {
      const predicate = `${p.qual ?? ""} ${p.with_check ?? ""}`;
      return /current_org_id\(\)|auth\.uid\(\)|auth\.role\(\)\s*=\s*'authenticated'/.test(predicate);
    });
    writeGrantFindings.push({
      table,
      anon_write_grants: anonWriteGrants,
      rls_enabled: r.db_rls.rls_enabled,
      anon_relevant_write_policy_count: anonRelevantWritePolicies.length,
      no_policy_at_all_default_deny: anonRelevantWritePolicies.length === 0,
      policy_appears_to_neutralize_anon: anonRelevantWritePolicies.length === 0 ? true : policyNeutralizesAnon,
      note:
        anonRelevantWritePolicies.length === 0
          ? "RLS enabled, zero write policy applies to public/anon -- default-deny blocks the write regardless of the stale grant."
          : policyNeutralizesAnon
            ? "Write policy predicate references current_org_id()/auth.uid()/auth.role()='authenticated', all of which evaluate to NULL/false for an unauthenticated anon caller -- blocked, but relies on the predicate staying correct rather than the grant being absent."
            : "COULD NOT CONFIRM the policy predicate neutralizes anon by pattern-match alone -- needs manual review of the qual/with_check text.",
    });
  }
  const writeGrantsNotConfirmedSafe = writeGrantFindings.filter((f) => !f.policy_appears_to_neutralize_anon);

  // ---- Newly-discovered bucket not in MASTER_BACKLOG's original list ----
  const masterBacklogKnownBuckets = new Set([
    "session-recordings",
    "org-b1ab7402-dfc2-4712-869f-70ea3566cc1d",
    "documents",
    "autoapply-screenshots",
    "org-documents",
    "nofa-pdfs",
  ]);
  const newBucketsSinceMasterBacklog = Object.keys(bucketResults).filter((b) => !masterBacklogKnownBuckets.has(b));

  // Every TABLE_EMPTY_INCONCLUSIVE table's db_level_fallback_verdict, so an
  // empty-today table with a real live risk (grant present, RLS off, or a
  // policy that doesn't obviously neutralize anon) doesn't hide behind
  // "inconclusive" -- it gets its own real, resolved verdict from the same
  // DB-level check used for the disputed items above.
  const emptyTablesNeedingReview = Object.entries(tableResults)
    .filter(([, r]) => r.db_level_fallback_verdict && /^DB_LEVEL_(RISK|NEEDS_REVIEW)/.test(r.db_level_fallback_verdict))
    .map(([table, r]) => ({ table, db_level_fallback_verdict: r.db_level_fallback_verdict }));

  // ---- Summary ----
  const tableVerdictCounts = {};
  let p0TableCount = 0;
  for (const r of Object.values(tableResults)) {
    tableVerdictCounts[r.verdict] = (tableVerdictCounts[r.verdict] ?? 0) + 1;
    if (r.is_p0_finding) p0TableCount++;
  }
  const bucketVerdictCounts = {};
  let p0BucketCount = 0;
  for (const r of Object.values(bucketResults)) {
    bucketVerdictCounts[r.live_exposure_verdict] = (bucketVerdictCounts[r.live_exposure_verdict] ?? 0) + 1;
    if (r.severity === "P0") p0BucketCount++;
  }
  const anonRpcCount = rpcResults.filter((r) => r.anon_can_execute).length;

  const payload = {
    generated_at: new Date().toISOString(),
    database: `production (${PRODUCTION_REF}), read-only session for DB-level checks; live REST API for anon-key/service-role HTTP probes`,
    method:
      "Per table (from PT-06's live-schema.json, all 184): (a) real, unauthenticated anon-key GET against {SUPABASE_URL}/rest/v1/{table} (Range:0-0 + Prefer:count=exact, retried without count on a 5xx/timeout), (b) an identical service-role GET as ground truth for whether real data exists, (c) pg_class.relrowsecurity/pg_policies/information_schema.role_table_grants over a read-only-enforced DATABASE_URL connection (verified read-only by a real rejected CREATE TABLE). Per storage bucket: same DB-level policy/grant inspection for storage.objects, plus a real anon POST /storage/v1/object/list/{bucket} and (for a real object path, if one exists) a real anon GET download attempt, plus a fully zero-header GET against /object/public/ for buckets with public=true. RPCs: enumerated via pg_proc + has_function_privilege('anon', ..., 'EXECUTE') -- NOT live-invoked, since several are real mutating functions (queue resume/skip, usage counters) and calling them with the anon key risks corrupting production state, which enumeration does not require.",
    sources: {
      pt06_live_schema: "test-evidence/pt-06/live-schema.json (184 tables, generated 2026-08-20)",
      pt06_integrity_tenant_fk_gap: "test-evidence/pt-06/integrity.json (checks.tenant_fk_gap, 13 tables missing FK despite a tenant column)",
      pt05_cross_read: "test-evidence/pt-05/cross-read.json (0/120 tenant-scoped tables leak cross-org to an AUTHENTICATED different-org user -- a different, complementary question from this file's UNAUTHENTICATED anon-key question)",
      master_backlog: "MASTER_BACKLOG.md §1.1-1.4 (2026-07-30, the DISPUTED Tier-1 findings this audit resolves)",
    },
    disputed_items_resolution: resolvedDisputes,
    tables: tableResults,
    buckets: bucketResults,
    rpcs: rpcResults,
    beyond_scope_findings: {
      description:
        "Findings surfaced by the same DB-level queries the task's read-focused steps required, beyond what was literally asked -- reported per this audit program's own standing practice of not hiding what's found.",
      anon_write_grant_analysis: writeGrantFindings,
      anon_write_grants_not_confirmed_neutralized: writeGrantsNotConfirmedSafe,
      new_buckets_not_in_master_backlogs_original_six: newBucketsSinceMasterBacklog,
      empty_tables_needing_review: emptyTablesNeedingReview,
    },
    summary: {
      tables_total: allTables.length,
      tables_by_verdict: tableVerdictCounts,
      tables_p0_findings: p0TableCount,
      buckets_total: Object.keys(bucketResults).length,
      buckets_by_verdict: bucketVerdictCounts,
      buckets_p0_findings: p0BucketCount,
      new_buckets_since_master_backlog: newBucketsSinceMasterBacklog,
      rpcs_total: rpcResults.length,
      rpcs_anon_executable: anonRpcCount,
      rpcs_anon_executable_and_security_definer: rpcResults.filter((r) => r.anon_can_execute && r.security_definer).length,
      disputed_items_total: disputedItems.length,
      disputed_items_still_open: resolvedDisputes.filter((d) => d.resolvedAs === "STILL_OPEN_CONFIRMED_LIVE").length,
      disputed_items_confirmed_fixed: resolvedDisputes.filter((d) => d.resolvedAs === "CONFIRMED_FIXED_LIVE").length,
      tables_with_anon_write_grants: writeGrantFindings.length,
      tables_with_anon_write_grants_not_confirmed_neutralized: writeGrantsNotConfirmedSafe.length,
      empty_tables_needing_review_count: emptyTablesNeedingReview.length,
    },
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2), "utf8");
  console.log(`\nWrote ${OUT_FILE}`);
  console.log(`Tables: ${allTables.length} total, ${p0TableCount} P0 anon-open-with-data findings.`);
  console.log(`Verdict breakdown: ${JSON.stringify(tableVerdictCounts, null, 2)}`);
  console.log(`Buckets: ${Object.keys(bucketResults).length} total, ${p0BucketCount} P0 findings.`);
  console.log(`Bucket verdicts: ${JSON.stringify(bucketVerdictCounts, null, 2)}`);
  console.log(`RPCs: ${rpcResults.length} total, ${anonRpcCount} anon-executable, ${payload.summary.rpcs_anon_executable_and_security_definer} anon-executable+SECURITY DEFINER.`);
  console.log(`Disputed items resolved: ${resolvedDisputes.length} (${payload.summary.disputed_items_still_open} still open, ${payload.summary.disputed_items_confirmed_fixed} confirmed fixed).`);
  console.log(`New buckets not in MASTER_BACKLOG's original 6: ${JSON.stringify(newBucketsSinceMasterBacklog)}`);
  console.log(`Tables with anon write grants: ${writeGrantFindings.length}, of which NOT confirmed neutralized by policy pattern-match: ${writeGrantsNotConfirmedSafe.length}`);
  console.log(`Empty tables needing manual policy review (DB_LEVEL_RISK/NEEDS_REVIEW): ${emptyTablesNeedingReview.length} ${JSON.stringify(emptyTablesNeedingReview)}`);
}

main().catch((err) => {
  console.error(`HALT: ${err.stack || err.message}`);
  process.exit(1);
});
