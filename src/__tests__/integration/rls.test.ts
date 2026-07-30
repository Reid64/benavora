import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

// Node 20 has no native WebSocket; mirrors the workaround in
// src/lib/supabase/admin.ts — without it, supabase-js's realtime client
// (constructed eagerly by createClient regardless of whether it's used)
// throws immediately.
function createClient(url: string, key: string, opts: Record<string, unknown> = {}): SupabaseClient {
  return createSupabaseClient(url, key, {
    ...opts,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    realtime: { transport: ws as any },
  }) as unknown as SupabaseClient;
}

/**
 * Systematic cross-org RLS isolation sweep.
 *
 * There is no separate test Supabase project (`.env.test` points at an
 * unrunning local stack; TESTING_v2.md's `SUPABASE_URL_TEST` doesn't exist).
 * This suite runs against the real project in `.env.local` using two
 * throwaway orgs/users created and torn down per run — the same pattern
 * already used elsewhere for real end-to-end verification in this repo.
 *
 * The table list is NOT hand-copied from SCHEMA_REGISTRY_v2.md (that doc
 * documents 71 tables and admits 89 live tables are undocumented, several
 * "not verified against pg_policies"). Instead every org-scoped table is
 * discovered live via the PostgREST OpenAPI endpoint at run time, and a
 * minimal valid row is synthesized from the live column/enum/FK metadata.
 * A table that can't be safely seeded (unmet FK/CHECK constraint) is
 * reported as SKIPPED, not silently passed.
 */

function loadLocalEnv(): Record<string, string> {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return {};
  return dotenv.parse(fs.readFileSync(envPath));
}

const localEnv = loadLocalEnv();
const SUPABASE_URL = localEnv.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = localEnv.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = localEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const CREDS_AVAILABLE = Boolean(SUPABASE_URL && SERVICE_ROLE_KEY && ANON_KEY);

// ---------------------------------------------------------------------------
// Generic schema-driven helpers
// ---------------------------------------------------------------------------

interface PropertyDef {
  type?: string;
  format?: string;
  enum?: string[];
  description?: string;
  default?: unknown;
}

interface TableDef {
  required?: string[];
  properties?: Record<string, PropertyDef>;
}

interface OrgTable {
  name: string;
  orgCol: string;
  def: TableDef;
}

interface HelperIds {
  funderId: string;
  opportunityId: string;
  applicationId: string;
  outcomeId: string;
  requestId: string;
  threadId: string;
  sequenceId: string;
  submissionId: string;
  calendarConnectionId: string;
  userId: string;
  directoryId: string;
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

function isPkColumn(def: PropertyDef): boolean {
  return typeof def.description === "string" && def.description.includes("<pk/>");
}

function fkTarget(def: PropertyDef): string | null {
  if (typeof def.description !== "string") return null;
  const match = /fk table='(\w+)'/.exec(def.description);
  return match ? (match[1] ?? null) : null;
}

function valueForProperty(
  colName: string,
  def: PropertyDef,
  resolveFk: (target: string) => string | undefined,
): unknown {
  if (Array.isArray(def.enum) && def.enum.length > 0) return def.enum[0];
  if (def.type === "array") return [];
  const format = def.format || "";
  if (format === "uuid") {
    const target = fkTarget(def);
    const resolved = target ? resolveFk(target) : undefined;
    return resolved ?? randomUUID();
  }
  if (format === "jsonb" || format === "json") return {};
  if (format.startsWith("timestamp") || format === "date" || format.startsWith("time")) {
    return new Date().toISOString();
  }
  if (format === "boolean" || def.type === "boolean") return false;
  if (
    ["integer", "bigint", "smallint", "numeric", "real", "double precision"].includes(format) ||
    def.type === "integer" ||
    def.type === "number"
  ) {
    return 0;
  }
  return `rls_test_${colName}_${randomSuffix()}`;
}

function buildSeedPayload(
  tableDef: TableDef,
  orgCol: string,
  orgId: string,
  resolveFk: (target: string) => string | undefined,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { [orgCol]: orgId };
  const required = tableDef.required || [];
  const props = tableDef.properties || {};
  for (const col of required) {
    if (col === orgCol) continue;
    const def = props[col];
    if (!def || "default" in def) continue;
    payload[col] = valueForProperty(col, def, resolveFk);
  }
  return payload;
}

function getPkColumns(tableDef: TableDef): string[] {
  const props = tableDef.properties || {};
  return Object.entries(props)
    .filter(([, def]) => isPkColumn(def))
    .map(([col]) => col);
}

function pkFilter(pkCols: string[], row: Record<string, unknown>): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  for (const col of pkCols) filter[col] = row[col];
  return filter;
}

function makeFkResolver(h: HelperIds): (target: string) => string | undefined {
  const map: Record<string, string> = {
    opportunities: h.opportunityId,
    funders: h.funderId,
    applications: h.applicationId,
    profiles: h.userId,
    outcomes: h.outcomeId,
    donor_discovery_directory: h.directoryId,
    donor_discovery_requests: h.requestId,
    synced_email_threads: h.threadId,
    email_campaign_sequences: h.sequenceId,
    autoapply_submissions: h.submissionId,
    calendar_connections: h.calendarConnectionId,
  };
  return (target: string) => map[target];
}

async function fetchOpenApiSpec(url: string, serviceKey: string): Promise<{ definitions: Record<string, TableDef> }> {
  const res = await fetch(`${url}/rest/v1/`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!res.ok) throw new Error(`PostgREST OpenAPI introspection failed: HTTP ${res.status}`);
  return res.json();
}

function deriveOrgScopedTables(defs: Record<string, TableDef>): OrgTable[] {
  const tables: OrgTable[] = [];
  for (const [name, def] of Object.entries(defs)) {
    const props = def.properties || {};
    const orgCol = props.organization_id ? "organization_id" : props.org_id ? "org_id" : null;
    if (!orgCol) continue;
    if (getPkColumns(def).length === 0) continue;
    tables.push({ name, orgCol, def });
  }
  return tables.sort((a, b) => a.name.localeCompare(b.name));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await fn(items[idx] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

async function createHelperChain(
  service: SupabaseClient,
  orgId: string,
  userId: string,
  directoryId: string,
  tag: string,
): Promise<HelperIds> {
  const { data: funder, error: funderErr } = await service
    .from("funders")
    .insert({ organization_id: orgId, name: `RLS Test Funder ${tag}`, category: "private_foundation" })
    .select()
    .single();
  if (funderErr || !funder) throw new Error(`helper funder failed: ${funderErr?.message}`);

  const { data: opportunity, error: oppErr } = await service
    .from("opportunities")
    .insert({
      organization_id: orgId,
      funder_id: funder.id,
      name: `RLS Test Opportunity ${tag}`,
      category: "private_foundation",
    })
    .select()
    .single();
  if (oppErr || !opportunity) throw new Error(`helper opportunity failed: ${oppErr?.message}`);

  const { data: application, error: appErr } = await service
    .from("applications")
    .insert({ organization_id: orgId, opportunity_id: opportunity.id })
    .select()
    .single();
  if (appErr || !application) throw new Error(`helper application failed: ${appErr?.message}`);

  const { data: outcome, error: outcomeErr } = await service
    .from("outcomes")
    .insert({ organization_id: orgId, application_id: application.id, result: "denied" })
    .select()
    .single();
  if (outcomeErr || !outcome) throw new Error(`helper outcome failed: ${outcomeErr?.message}`);

  const { data: request, error: requestErr } = await service
    .from("donor_discovery_requests")
    .insert({
      organization_id: orgId,
      name: `RLS Test Request ${tag}`,
      taxonomy_ids: [],
      geography: {},
      counts: {},
    })
    .select()
    .single();
  if (requestErr || !request) throw new Error(`helper donor_discovery_request failed: ${requestErr?.message}`);

  const { data: thread, error: threadErr } = await service
    .from("synced_email_threads")
    .insert({ organization_id: orgId, gmail_thread_id: `rls-test-thread-${tag}` })
    .select()
    .single();
  if (threadErr || !thread) throw new Error(`helper synced_email_thread failed: ${threadErr?.message}`);

  const { data: sequence, error: sequenceErr } = await service
    .from("email_campaign_sequences")
    .insert({ organization_id: orgId, name: `RLS Test Sequence ${tag}`, trigger_type: "manual" })
    .select()
    .single();
  if (sequenceErr || !sequence) throw new Error(`helper email_campaign_sequence failed: ${sequenceErr?.message}`);

  const { data: submission, error: submissionErr } = await service
    .from("autoapply_submissions")
    .insert({ organization_id: orgId })
    .select()
    .single();
  if (submissionErr || !submission) throw new Error(`helper autoapply_submission failed: ${submissionErr?.message}`);

  const { data: calendarConnection, error: calErr } = await service
    .from("calendar_connections")
    .insert({
      organization_id: orgId,
      user_id: userId,
      provider: "google",
      calendar_id: `rls-test-cal-${tag}`,
    })
    .select()
    .single();
  if (calErr || !calendarConnection) throw new Error(`helper calendar_connection failed: ${calErr?.message}`);

  return {
    funderId: funder.id,
    opportunityId: opportunity.id,
    applicationId: application.id,
    outcomeId: outcome.id,
    requestId: request.id,
    threadId: thread.id,
    sequenceId: sequence.id,
    submissionId: submission.id,
    calendarConnectionId: calendarConnection.id,
    userId,
    directoryId,
  };
}

interface TableCheckResult {
  table: string;
  skipped: boolean;
  failed: boolean;
  reason?: string;
}

async function testOneTable(
  table: OrgTable,
  env: { service: SupabaseClient; userB: SupabaseClient; orgAId: string; helpersA: HelperIds },
): Promise<TableCheckResult> {
  const pkCols = getPkColumns(table.def);
  const resolveFk = makeFkResolver(env.helpersA);
  const seedPayload = buildSeedPayload(table.def, table.orgCol, env.orgAId, resolveFk);

  const { data: seeded, error: seedError } = await env.service
    .from(table.name)
    .insert(seedPayload)
    .select()
    .single();

  if (seedError || !seeded) {
    return {
      table: table.name,
      skipped: true,
      failed: false,
      reason: `seed insert failed — ${seedError?.message ?? "no row returned"}`,
    };
  }

  const filter = pkFilter(pkCols, seeded as Record<string, unknown>);

  try {
    const { data: verifyRows, error: verifyError } = await env.service
      .from(table.name)
      .select("*")
      .match(filter);
    if (verifyError || !verifyRows || verifyRows.length !== 1) {
      return {
        table: table.name,
        skipped: true,
        failed: false,
        reason: `pk filter sanity check failed — ${verifyError?.message ?? `${verifyRows?.length ?? 0} rows matched`}`,
      };
    }

    // 1. Cross-org SELECT must return 0 rows.
    const { data: leaked } = await env.userB.from(table.name).select("*").match(filter);
    expect((leaked ?? []).length, "cross-org SELECT leaked row(s) belonging to another org").toBe(0);

    // 2. Cross-org INSERT impersonating org A's id must be rejected.
    const insertPayload = buildSeedPayload(table.def, table.orgCol, env.orgAId, resolveFk);
    const { data: insertedByB, error: insertError } = await env.userB
      .from(table.name)
      .insert(insertPayload)
      .select();
    if (!insertError && insertedByB && insertedByB.length > 0) {
      // Leak: clean up the row we should never have been able to create.
      for (const row of insertedByB as Record<string, unknown>[]) {
        await env.service.from(table.name).delete().match(pkFilter(pkCols, row));
      }
    }
    expect(
      Boolean(insertError) || !insertedByB || insertedByB.length === 0,
      "cross-org INSERT under another org's id was NOT rejected",
    ).toBe(true);

    // 3. Cross-org UPDATE must affect 0 rows.
    const { data: updated } = await env.userB
      .from(table.name)
      .update({ [table.orgCol]: env.orgAId })
      .match(filter)
      .select();
    expect((updated ?? []).length, "cross-org UPDATE affected row(s) belonging to another org").toBe(0);

    return { table: table.name, skipped: false, failed: false };
  } catch (err) {
    return {
      table: table.name,
      skipped: false,
      failed: true,
      reason: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await env.service.from(table.name).delete().match(filter);
  }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

(CREDS_AVAILABLE ? describe : describe.skip)(
  "Cross-org RLS isolation (systematic sweep across all org-scoped tables)",
  () => {
    let serviceClient: SupabaseClient;
    let userAClient: SupabaseClient;
    let userBClient: SupabaseClient;
    let orgAId: string;
    let orgBId: string;
    let userAId: string;
    let userBId: string;
    let helpersA: HelperIds;
    let helpersB: HelperIds;
    let sharedDirectoryId: string;
    let orgScopedTables: OrgTable[];

    const RUN_TAG = randomSuffix();

    beforeAll(async () => {
      serviceClient = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const spec = await fetchOpenApiSpec(SUPABASE_URL!, SERVICE_ROLE_KEY!);
      orgScopedTables = deriveOrgScopedTables(spec.definitions);
      // eslint-disable-next-line no-console
      console.log(`[rls.test] discovered ${orgScopedTables.length} org-scoped tables via live PostgREST introspection`);

      const { data: orgA, error: orgAErr } = await serviceClient
        .from("organizations")
        .insert({ name: `RLS_TEST_ORG_A_${RUN_TAG}`, onboarding_progress: {} })
        .select()
        .single();
      if (orgAErr || !orgA) throw new Error(`Failed to create test org A: ${orgAErr?.message}`);
      orgAId = orgA.id as string;

      const { data: orgB, error: orgBErr } = await serviceClient
        .from("organizations")
        .insert({ name: `RLS_TEST_ORG_B_${RUN_TAG}`, onboarding_progress: {} })
        .select()
        .single();
      if (orgBErr || !orgB) throw new Error(`Failed to create test org B: ${orgBErr?.message}`);
      orgBId = orgB.id as string;

      const passwordA = `RlsTest_${randomSuffix()}_Aa1!`;
      const passwordB = `RlsTest_${randomSuffix()}_Bb1!`;
      const emailA = `rls-test-orga-${RUN_TAG}@benavora-rls-test.local`;
      const emailB = `rls-test-orgb-${RUN_TAG}@benavora-rls-test.local`;

      const { data: authA, error: authAErr } = await serviceClient.auth.admin.createUser({
        email: emailA,
        password: passwordA,
        email_confirm: true,
      });
      if (authAErr || !authA?.user) throw new Error(`Failed to create test user A: ${authAErr?.message}`);
      userAId = authA.user.id;

      const { data: authB, error: authBErr } = await serviceClient.auth.admin.createUser({
        email: emailB,
        password: passwordB,
        email_confirm: true,
      });
      if (authBErr || !authB?.user) throw new Error(`Failed to create test user B: ${authBErr?.message}`);
      userBId = authB.user.id;

      const { error: profAErr } = await serviceClient
        .from("profiles")
        .upsert({ id: userAId, organization_id: orgAId, email: emailA, role: "owner" });
      if (profAErr) throw new Error(`Failed to create profile A: ${profAErr.message}`);

      const { error: profBErr } = await serviceClient
        .from("profiles")
        .upsert({ id: userBId, organization_id: orgBId, email: emailB, role: "owner" });
      if (profBErr) throw new Error(`Failed to create profile B: ${profBErr.message}`);

      userAClient = createClient(SUPABASE_URL!, ANON_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
      const { error: signInAErr } = await userAClient.auth.signInWithPassword({ email: emailA, password: passwordA });
      if (signInAErr) throw new Error(`Failed to sign in test user A: ${signInAErr.message}`);

      userBClient = createClient(SUPABASE_URL!, ANON_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
      const { error: signInBErr } = await userBClient.auth.signInWithPassword({ email: emailB, password: passwordB });
      if (signInBErr) throw new Error(`Failed to sign in test user B: ${signInBErr.message}`);

      const { data: dir, error: dirErr } = await serviceClient
        .from("donor_discovery_directory")
        .insert({ legal_name: `RLS Test Directory ${RUN_TAG}`, naics_codes: [] })
        .select()
        .single();
      if (dirErr || !dir) throw new Error(`Failed to create shared directory helper: ${dirErr?.message}`);
      sharedDirectoryId = dir.id as string;

      helpersA = await createHelperChain(serviceClient, orgAId, userAId, sharedDirectoryId, `${RUN_TAG}A`);
      helpersB = await createHelperChain(serviceClient, orgBId, userBId, sharedDirectoryId, `${RUN_TAG}B`);
    }, 120000);

    afterAll(async () => {
      if (!serviceClient) return;
      const cleanupErrors: string[] = [];
      const safeDelete = async (table: string, match: Record<string, unknown>) => {
        try {
          const { error } = await serviceClient.from(table).delete().match(match);
          if (error) cleanupErrors.push(`${table} ${JSON.stringify(match)}: ${error.message}`);
        } catch (err) {
          cleanupErrors.push(`${table} ${JSON.stringify(match)}: ${err instanceof Error ? err.message : String(err)}`);
        }
      };

      for (const helpers of [helpersA, helpersB].filter(Boolean)) {
        await safeDelete("calendar_connections", { id: helpers.calendarConnectionId });
        await safeDelete("autoapply_submissions", { id: helpers.submissionId });
        await safeDelete("email_campaign_sequences", { id: helpers.sequenceId });
        await safeDelete("synced_email_threads", { id: helpers.threadId });
        await safeDelete("donor_discovery_requests", { id: helpers.requestId });
        await safeDelete("outcomes", { id: helpers.outcomeId });
        await safeDelete("applications", { id: helpers.applicationId });
        await safeDelete("opportunities", { id: helpers.opportunityId });
        await safeDelete("funders", { id: helpers.funderId });
      }
      if (sharedDirectoryId) await safeDelete("donor_discovery_directory", { id: sharedDirectoryId });
      if (userAId) await safeDelete("profiles", { id: userAId });
      if (userBId) await safeDelete("profiles", { id: userBId });
      if (userAId) {
        try {
          await serviceClient.auth.admin.deleteUser(userAId);
        } catch (err) {
          cleanupErrors.push(`auth user A: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (userBId) {
        try {
          await serviceClient.auth.admin.deleteUser(userBId);
        } catch (err) {
          cleanupErrors.push(`auth user B: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // Something in this project (a trigger, or a live background worker
      // reacting to org creation — Railway's benavora-worker polls/subscribes
      // continuously per project memory) (re)populates platform_config rows
      // for a new org, sometimes after a delay. A single delete-then-delete
      // pass can lose the race, so retry a few times before giving up.
      const deleteOrgWithRetry = async (orgId: string) => {
        for (let attempt = 1; attempt <= 4; attempt++) {
          await safeDelete("platform_config", { organization_id: orgId });
          const { error } = await serviceClient.from("organizations").delete().match({ id: orgId });
          if (!error) return;
          if (attempt === 4) {
            cleanupErrors.push(`organizations {"id":"${orgId}"} (after ${attempt} attempts): ${error.message}`);
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
      };
      if (orgAId) await deleteOrgWithRetry(orgAId);
      if (orgBId) await deleteOrgWithRetry(orgBId);

      if (cleanupErrors.length > 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `[rls.test] cleanup encountered errors — manual cleanup of RLS_TEST_ORG_*_${RUN_TAG} may be required:\n` +
            cleanupErrors.join("\n"),
        );
      }
    }, 120000);

    it(
      "no org-scoped table leaks another org's data via SELECT, INSERT, or UPDATE",
      async () => {
        const results = await mapWithConcurrency(orgScopedTables, 6, (table) =>
          testOneTable(table, { service: serviceClient, userB: userBClient, orgAId, helpersA }),
        );

        const failed = results.filter((r) => r.failed);
        const skipped = results.filter((r) => r.skipped);
        const passed = results.length - failed.length - skipped.length;

        // eslint-disable-next-line no-console
        console.log(
          `[rls.test] ${results.length} tables checked — ${passed} passed, ${skipped.length} skipped, ${failed.length} failed`,
        );
        if (skipped.length > 0) {
          // eslint-disable-next-line no-console
          console.warn(
            `[rls.test] skipped (could not construct/verify a safe seed row — not a pass, not evidence of an RLS gap):\n` +
              skipped.map((r) => `  - ${r.table}: ${r.reason}`).join("\n"),
          );
        }

        expect(
          failed,
          failed.length > 0
            ? `RLS isolation gaps found:\n${failed.map((r) => `  - ${r.table}: ${r.reason}`).join("\n")}`
            : "no RLS gaps",
        ).toEqual([]);
      },
      600000,
    );
  },
);

if (!CREDS_AVAILABLE) {
  // eslint-disable-next-line no-console
  console.warn(
    "[rls.test] skipped entirely — .env.local is missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY",
  );
}
