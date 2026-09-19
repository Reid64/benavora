import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

// Node 20 has no native WebSocket; mirrors the workaround in
// src/lib/supabase/admin.ts and src/__tests__/integration/rls.test.ts —
// without it, supabase-js's realtime client (constructed eagerly by
// createClient regardless of whether it's used) throws immediately.
function createClient(url: string, key: string, opts: Record<string, unknown> = {}): SupabaseClient {
  return createSupabaseClient(url, key, {
    ...opts,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    realtime: { transport: ws as any },
  }) as unknown as SupabaseClient;
}

/**
 * Agency tenancy cross-tenant isolation (migration 176:
 * 176_agency_tenancy.sql — agencies + agency_client_organizations +
 * list_agency_client_organizations()/agency_client_aggregate_counts()).
 *
 * This is the single most important acceptance criterion for the Agency
 * tier command-center work: one agency's authenticated user must never be
 * able to see, list, or aggregate another agency's linked client
 * organizations or their data, via any of:
 *   1. a direct SELECT against agency_client_organizations (RLS policy),
 *   2. list_agency_client_organizations() called with a forged/foreign
 *      p_agency_org_id (SECURITY DEFINER guard),
 *   3. agency_client_aggregate_counts() called the same way.
 *
 * Runs against the real project in .env.local (same pattern as
 * src/__tests__/integration/rls.test.ts and storage-rls.test.ts — there is
 * no separate test Supabase project for this repo). Two throwaway agencies,
 * each with its own throwaway client org, are created and torn down per run.
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

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

(CREDS_AVAILABLE ? describe : describe.skip)(
  "Agency tenancy cross-tenant isolation (migration 176)",
  () => {
    let serviceClient: SupabaseClient;
    let agencyAUserClient: SupabaseClient;
    let agencyBUserClient: SupabaseClient;

    let agencyAOrgId: string;
    let agencyBOrgId: string;
    let clientA1OrgId: string;
    let clientB1OrgId: string;
    let agencyAUserId: string;
    let agencyBUserId: string;
    let linkAId: string;
    let linkBId: string;
    let appA1Id: string;
    let oppA1Id: string;
    let funderA1Id: string;

    const RUN_TAG = randomSuffix();

    beforeAll(async () => {
      serviceClient = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      // --- Agency A + its client org -----------------------------------
      const { data: agencyAOrg, error: agencyAOrgErr } = await serviceClient
        .from("organizations")
        .insert({ name: `AGENCY_TEST_A_${RUN_TAG}`, onboarding_progress: {} })
        .select()
        .single();
      if (agencyAOrgErr || !agencyAOrg) throw new Error(`Failed to create agency A org: ${agencyAOrgErr?.message}`);
      agencyAOrgId = agencyAOrg.id as string;

      const { data: clientA1Org, error: clientA1OrgErr } = await serviceClient
        .from("organizations")
        .insert({ name: `AGENCY_TEST_CLIENT_A1_${RUN_TAG}`, onboarding_progress: {} })
        .select()
        .single();
      if (clientA1OrgErr || !clientA1Org) throw new Error(`Failed to create client A1 org: ${clientA1OrgErr?.message}`);
      clientA1OrgId = clientA1Org.id as string;

      const { error: agencyARowErr } = await serviceClient
        .from("agencies")
        .insert({ organization_id: agencyAOrgId, plan: "agency", workspace_limit: 5 });
      if (agencyARowErr) throw new Error(`Failed to create agencies row A: ${agencyARowErr.message}`);

      const { data: linkA, error: linkAErr } = await serviceClient
        .from("agency_client_organizations")
        .insert({ agency_organization_id: agencyAOrgId, client_organization_id: clientA1OrgId })
        .select()
        .single();
      if (linkAErr || !linkA) throw new Error(`Failed to link agency A to client A1: ${linkAErr?.message}`);
      linkAId = linkA.id as string;

      // --- Agency B + its client org (the "other tenant") --------------
      const { data: agencyBOrg, error: agencyBOrgErr } = await serviceClient
        .from("organizations")
        .insert({ name: `AGENCY_TEST_B_${RUN_TAG}`, onboarding_progress: {} })
        .select()
        .single();
      if (agencyBOrgErr || !agencyBOrg) throw new Error(`Failed to create agency B org: ${agencyBOrgErr?.message}`);
      agencyBOrgId = agencyBOrg.id as string;

      const { data: clientB1Org, error: clientB1OrgErr } = await serviceClient
        .from("organizations")
        .insert({ name: `AGENCY_TEST_CLIENT_B1_${RUN_TAG}`, onboarding_progress: {} })
        .select()
        .single();
      if (clientB1OrgErr || !clientB1Org) throw new Error(`Failed to create client B1 org: ${clientB1OrgErr?.message}`);
      clientB1OrgId = clientB1Org.id as string;

      const { error: agencyBRowErr } = await serviceClient
        .from("agencies")
        .insert({ organization_id: agencyBOrgId, plan: "agency", workspace_limit: 5 });
      if (agencyBRowErr) throw new Error(`Failed to create agencies row B: ${agencyBRowErr.message}`);

      const { data: linkB, error: linkBErr } = await serviceClient
        .from("agency_client_organizations")
        .insert({ agency_organization_id: agencyBOrgId, client_organization_id: clientB1OrgId })
        .select()
        .single();
      if (linkBErr || !linkB) throw new Error(`Failed to link agency B to client B1: ${linkBErr?.message}`);
      linkBId = linkB.id as string;

      // --- Real application/opportunity data under client A1, to prove
      // aggregate counts are genuinely scoped and non-fabricated ---------
      const { data: funder, error: funderErr } = await serviceClient
        .from("funders")
        .insert({ organization_id: clientA1OrgId, name: `Agency Test Funder ${RUN_TAG}`, category: "private_foundation" })
        .select()
        .single();
      if (funderErr || !funder) throw new Error(`Failed to create funder: ${funderErr?.message}`);
      funderA1Id = funder.id as string;

      const { data: opportunity, error: oppErr } = await serviceClient
        .from("opportunities")
        .insert({
          organization_id: clientA1OrgId,
          funder_id: funderA1Id,
          name: `Agency Test Opportunity ${RUN_TAG}`,
          category: "private_foundation",
          deadline: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
          // AR-17.6: migration 203's provenance trigger rejects an enriched
          // field (deadline here) with no stored source in the same write.
          url: "https://example.org/agency-rls-test-fixture",
        })
        .select()
        .single();
      if (oppErr || !opportunity) throw new Error(`Failed to create opportunity: ${oppErr?.message}`);
      oppA1Id = opportunity.id as string;

      const { data: application, error: appErr } = await serviceClient
        .from("applications")
        .insert({ organization_id: clientA1OrgId, opportunity_id: oppA1Id, stage: "drafting" })
        .select()
        .single();
      if (appErr || !application) throw new Error(`Failed to create application: ${appErr?.message}`);
      appA1Id = application.id as string;

      // --- Agency owner users, one per agency org -----------------------
      const passwordA = `AgencyTest_${randomSuffix()}_Aa1!`;
      const passwordB = `AgencyTest_${randomSuffix()}_Bb1!`;
      const emailA = `agency-test-a-${RUN_TAG}@benavora-rls-test.local`;
      const emailB = `agency-test-b-${RUN_TAG}@benavora-rls-test.local`;

      const { data: authA, error: authAErr } = await serviceClient.auth.admin.createUser({
        email: emailA,
        password: passwordA,
        email_confirm: true,
      });
      if (authAErr || !authA?.user) throw new Error(`Failed to create agency A user: ${authAErr?.message}`);
      agencyAUserId = authA.user.id;

      const { data: authB, error: authBErr } = await serviceClient.auth.admin.createUser({
        email: emailB,
        password: passwordB,
        email_confirm: true,
      });
      if (authBErr || !authB?.user) throw new Error(`Failed to create agency B user: ${authBErr?.message}`);
      agencyBUserId = authB.user.id;

      const { error: profAErr } = await serviceClient
        .from("profiles")
        .upsert({ id: agencyAUserId, organization_id: agencyAOrgId, email: emailA, role: "owner" });
      if (profAErr) throw new Error(`Failed to create agency A profile: ${profAErr.message}`);

      const { error: profBErr } = await serviceClient
        .from("profiles")
        .upsert({ id: agencyBUserId, organization_id: agencyBOrgId, email: emailB, role: "owner" });
      if (profBErr) throw new Error(`Failed to create agency B profile: ${profBErr.message}`);

      agencyAUserClient = createClient(SUPABASE_URL!, ANON_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
      const { error: signInAErr } = await agencyAUserClient.auth.signInWithPassword({ email: emailA, password: passwordA });
      if (signInAErr) throw new Error(`Failed to sign in agency A user: ${signInAErr.message}`);

      agencyBUserClient = createClient(SUPABASE_URL!, ANON_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
      const { error: signInBErr } = await agencyBUserClient.auth.signInWithPassword({ email: emailB, password: passwordB });
      if (signInBErr) throw new Error(`Failed to sign in agency B user: ${signInBErr.message}`);
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

      if (appA1Id) await safeDelete("applications", { id: appA1Id });
      if (oppA1Id) await safeDelete("opportunities", { id: oppA1Id });
      if (funderA1Id) await safeDelete("funders", { id: funderA1Id });
      if (linkAId) await safeDelete("agency_client_organizations", { id: linkAId });
      if (linkBId) await safeDelete("agency_client_organizations", { id: linkBId });
      if (agencyAOrgId) await safeDelete("agencies", { organization_id: agencyAOrgId });
      if (agencyBOrgId) await safeDelete("agencies", { organization_id: agencyBOrgId });
      if (agencyAUserId) await safeDelete("profiles", { id: agencyAUserId });
      if (agencyBUserId) await safeDelete("profiles", { id: agencyBUserId });

      if (agencyAUserId) {
        try {
          await serviceClient.auth.admin.deleteUser(agencyAUserId);
        } catch (err) {
          cleanupErrors.push(`auth user A: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (agencyBUserId) {
        try {
          await serviceClient.auth.admin.deleteUser(agencyBUserId);
        } catch (err) {
          cleanupErrors.push(`auth user B: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

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
      if (clientA1OrgId) await deleteOrgWithRetry(clientA1OrgId);
      if (clientB1OrgId) await deleteOrgWithRetry(clientB1OrgId);
      if (agencyAOrgId) await deleteOrgWithRetry(agencyAOrgId);
      if (agencyBOrgId) await deleteOrgWithRetry(agencyBOrgId);

      if (cleanupErrors.length > 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `[agency-rls.test] cleanup encountered errors — manual cleanup of AGENCY_TEST_*_${RUN_TAG} may be required:\n` +
            cleanupErrors.join("\n"),
        );
      }
    }, 120000);

    it("an agency owner can see their own linked client org via direct SELECT", async () => {
      const { data, error } = await agencyAUserClient
        .from("agency_client_organizations")
        .select("id, agency_organization_id, client_organization_id")
        .eq("id", linkAId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data?.[0]?.client_organization_id).toBe(clientA1OrgId);
    });

    it("agency A's direct SELECT of agency B's link row returns zero rows", async () => {
      const { data } = await agencyAUserClient
        .from("agency_client_organizations")
        .select("id")
        .eq("id", linkBId);
      expect((data ?? []).length).toBe(0);
    });

    it("agency B's direct SELECT of agency A's link row returns zero rows", async () => {
      const { data } = await agencyBUserClient
        .from("agency_client_organizations")
        .select("id")
        .eq("id", linkAId);
      expect((data ?? []).length).toBe(0);
    });

    it("list_agency_client_organizations returns the caller's own clients only", async () => {
      const { data, error } = await agencyAUserClient.rpc("list_agency_client_organizations", {
        p_agency_org_id: agencyAOrgId,
      });
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data?.[0]?.client_organization_id).toBe(clientA1OrgId);
      expect(data?.[0]?.client_name).toBe(`AGENCY_TEST_CLIENT_A1_${RUN_TAG}`);
    });

    it("list_agency_client_organizations REJECTS a forged foreign agency org id (cross-tenant negative test)", async () => {
      const { data, error } = await agencyAUserClient.rpc("list_agency_client_organizations", {
        p_agency_org_id: agencyBOrgId,
      });
      // Must not leak agency B's clients to agency A under any response shape.
      expect((data ?? []).length).toBe(0);
      expect(error).not.toBeNull();
    });

    it("agency_client_aggregate_counts returns real, scoped counts for the caller's own clients", async () => {
      const { data, error } = await agencyAUserClient.rpc("agency_client_aggregate_counts", {
        p_agency_org_id: agencyAOrgId,
      });
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      const row = data?.[0];
      expect(row?.client_organization_id).toBe(clientA1OrgId);
      expect(row?.application_count).toBe(1);
      expect(row?.upcoming_deadline_count).toBe(1);
      expect(row?.stage_counts).toEqual({ drafting: 1 });
    });

    it("agency_client_aggregate_counts REJECTS a forged foreign agency org id (cross-tenant negative test)", async () => {
      const { data, error } = await agencyBUserClient.rpc("agency_client_aggregate_counts", {
        p_agency_org_id: agencyAOrgId,
      });
      expect((data ?? []).length).toBe(0);
      expect(error).not.toBeNull();
    });

    it("a non-agency organization id is rejected even when it matches the caller's own current_org_id()", async () => {
      // Sanity: an ordinary (non-agency) org calling either function with its
      // own id must also be rejected, since it has no `agencies` row.
      const passwordC = `AgencyTest_${randomSuffix()}_Cc1!`;
      const emailC = `agency-test-c-${RUN_TAG}@benavora-rls-test.local`;

      const { data: plainOrg, error: plainOrgErr } = await serviceClient
        .from("organizations")
        .insert({ name: `AGENCY_TEST_PLAIN_${RUN_TAG}`, onboarding_progress: {} })
        .select()
        .single();
      expect(plainOrgErr).toBeNull();
      const plainOrgId = plainOrg!.id as string;

      const { data: authC, error: authCErr } = await serviceClient.auth.admin.createUser({
        email: emailC,
        password: passwordC,
        email_confirm: true,
      });
      expect(authCErr).toBeNull();
      const userCId = authC!.user!.id;

      await serviceClient.from("profiles").upsert({ id: userCId, organization_id: plainOrgId, email: emailC, role: "owner" });

      const plainClient = createClient(SUPABASE_URL!, ANON_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
      await plainClient.auth.signInWithPassword({ email: emailC, password: passwordC });

      const { data, error } = await plainClient.rpc("list_agency_client_organizations", {
        p_agency_org_id: plainOrgId,
      });
      expect((data ?? []).length).toBe(0);
      expect(error).not.toBeNull();

      await serviceClient.from("profiles").delete().match({ id: userCId });
      await serviceClient.auth.admin.deleteUser(userCId);
      await serviceClient.from("organizations").delete().match({ id: plainOrgId });
    }, 30000);

    it("workspace_limit is enforced at the database layer, not just in application code", async () => {
      const { data: limitedOrg, error: limitedOrgErr } = await serviceClient
        .from("organizations")
        .insert({ name: `AGENCY_TEST_LIMITED_${RUN_TAG}`, onboarding_progress: {} })
        .select()
        .single();
      expect(limitedOrgErr).toBeNull();
      const limitedOrgId = limitedOrg!.id as string;

      await serviceClient.from("agencies").insert({ organization_id: limitedOrgId, plan: "agency", workspace_limit: 1 });

      const { data: clientX, error: clientXErr } = await serviceClient
        .from("organizations")
        .insert({ name: `AGENCY_TEST_LIMITED_CLIENT_X_${RUN_TAG}`, onboarding_progress: {} })
        .select()
        .single();
      expect(clientXErr).toBeNull();
      const clientXId = clientX!.id as string;

      const { data: clientY, error: clientYErr } = await serviceClient
        .from("organizations")
        .insert({ name: `AGENCY_TEST_LIMITED_CLIENT_Y_${RUN_TAG}`, onboarding_progress: {} })
        .select()
        .single();
      expect(clientYErr).toBeNull();
      const clientYId = clientY!.id as string;

      const { error: firstLinkErr } = await serviceClient
        .from("agency_client_organizations")
        .insert({ agency_organization_id: limitedOrgId, client_organization_id: clientXId });
      expect(firstLinkErr).toBeNull();

      const { error: secondLinkErr } = await serviceClient
        .from("agency_client_organizations")
        .insert({ agency_organization_id: limitedOrgId, client_organization_id: clientYId });
      expect(secondLinkErr, "a second link beyond workspace_limit=1 should have been rejected by the trigger").not.toBeNull();

      await serviceClient.from("agency_client_organizations").delete().match({ agency_organization_id: limitedOrgId });
      await serviceClient.from("agencies").delete().match({ organization_id: limitedOrgId });
      await serviceClient.from("organizations").delete().match({ id: clientYId });
      await serviceClient.from("organizations").delete().match({ id: clientXId });
      await serviceClient.from("organizations").delete().match({ id: limitedOrgId });
    }, 30000);
  },
);

if (!CREDS_AVAILABLE) {
  // eslint-disable-next-line no-console
  console.warn(
    "[agency-rls.test] skipped entirely — .env.local is missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY",
  );
}
