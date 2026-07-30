import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { ComplianceGuard } from "@/lib/autoapply/compliance-guard";
import { populateQueue } from "@/lib/autoapply/auto-queue-populator";

// Node 20 has no native WebSocket; mirrors the workaround in
// src/lib/supabase/admin.ts and the other suites in this directory — without
// it, supabase-js's realtime client (constructed eagerly by createClient
// regardless of whether it's used) throws immediately.
function createClient(url: string, key: string, opts: Record<string, unknown> = {}): SupabaseClient {
  return createSupabaseClient(url, key, {
    ...opts,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    realtime: { transport: ws as any },
  }) as unknown as SupabaseClient;
}

/**
 * Tests the real charitable-solicitation registration rule logic behind
 * /autoapply/compliance (e2e/autoapply-dashboard.spec.ts only checks that the
 * page renders "41 states" reference copy — it never exercises the actual
 * block/allow decision). The rule engine is ComplianceGuard
 * (src/lib/autoapply/compliance-guard.ts), which is also the thing
 * auto-queue-populator.ts calls to decide whether a funder gets a
 * 'compliance_hold' skip reason (AUTOAPPLY_ARCHITECTURE_V2.md §6B).
 *
 * Live DB only, same pattern as the other suites in this directory (no
 * separate test Supabase project — .env.test isn't running). Uses the
 * service-role client directly rather than minting a session, since
 * ComplianceGuard takes an injected client and has no auth/session
 * dependency of its own. All rows created here are deleted in afterAll via
 * try/catch (not .catch()) per project memory
 * (benavora-integration-test-catch-bug-leaks-prod-rows).
 */

function loadLocalEnv(): Record<string, string> {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return {};
  return dotenv.parse(fs.readFileSync(envPath));
}

const localEnv = loadLocalEnv();
const SUPABASE_URL = localEnv.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = localEnv.SUPABASE_SERVICE_ROLE_KEY;
const CREDS_AVAILABLE = Boolean(SUPABASE_URL && SERVICE_ROLE_KEY);

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

(CREDS_AVAILABLE ? describe : describe.skip)(
  "AutoApply state solicitation-registration compliance rules (live)",
  () => {
    let service: SupabaseClient;
    const guard = new ComplianceGuard();

    const orgIds: string[] = [];
    let orgAId: string;
    let orgBId: string;

    beforeAll(async () => {
      service = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const tag = randomSuffix();

      const { data: orgA, error: orgAErr } = await service
        .from("organizations")
        .insert({ name: `AUTOAPPLY_COMPLIANCE_TEST_A_${tag}`, onboarding_progress: {} })
        .select()
        .single();
      expect(orgAErr, orgAErr?.message).toBeNull();
      orgAId = orgA!.id as string;
      orgIds.push(orgAId);

      const { data: orgB, error: orgBErr } = await service
        .from("organizations")
        .insert({ name: `AUTOAPPLY_COMPLIANCE_TEST_B_${tag}`, onboarding_progress: {} })
        .select()
        .single();
      expect(orgBErr, orgBErr?.message).toBeNull();
      orgBId = orgB!.id as string;
      orgIds.push(orgBId);

      // Org A's registration book:
      //   TX — active, no expiration date on file (permanent/no-renewal-tracked)
      //   CA — active, expires well in the future (current)
      //   NY — active status, but expires_at is in the past (lapsed)
      //   FL — status is NOT 'active' (revoked/inactive), even though its
      //        expires_at is still in the future — proves the guard checks
      //        status, not just the date
      //   GA — intentionally no row at all (never registered)
      const { error: regAErr } = await service.from("solicitation_registrations").insert([
        {
          organization_id: orgAId,
          state: "TX",
          status: "active",
          registration_number: `TEST-TX-${tag}`,
          expires_at: null,
        },
        {
          organization_id: orgAId,
          state: "CA",
          status: "active",
          registration_number: `TEST-CA-${tag}`,
          expires_at: daysFromNow(180),
        },
        {
          organization_id: orgAId,
          state: "NY",
          status: "active",
          registration_number: `TEST-NY-${tag}`,
          expires_at: daysFromNow(-30),
        },
        {
          organization_id: orgAId,
          state: "FL",
          status: "inactive",
          registration_number: `TEST-FL-${tag}`,
          expires_at: daysFromNow(180),
        },
      ]);
      expect(regAErr, regAErr?.message).toBeNull();

      // Org B is registered in GA — used to prove org A does not inherit it.
      const { error: regBErr } = await service.from("solicitation_registrations").insert({
        organization_id: orgBId,
        state: "GA",
        status: "active",
        registration_number: `TEST-GA-${tag}`,
        expires_at: null,
      });
      expect(regBErr, regBErr?.message).toBeNull();
    }, 30000);

    afterAll(async () => {
      if (!service) return;
      for (const orgId of orgIds) {
        try {
          await service.from("solicitation_registrations").delete().eq("organization_id", orgId);
        } catch {
          // best-effort cleanup
        }
        try {
          await service.from("organizations").delete().match({ id: orgId });
        } catch {
          // best-effort cleanup
        }
      }
    }, 30000);

    describe("ComplianceGuard.canSolicitInState() — block/allow decision", () => {
      it("blocks a state with no registration row at all (not_registered_in_state)", async () => {
        const result = await guard.canSolicitInState(orgAId, "GA", service);
        expect(result).toEqual({ allowed: false, reason: "not_registered_in_state" });
      });

      it("allows a state with an active registration and no expiration date on file", async () => {
        const result = await guard.canSolicitInState(orgAId, "TX", service);
        expect(result).toEqual({ allowed: true });
      });

      it("allows a state with an active registration that has not yet expired", async () => {
        const result = await guard.canSolicitInState(orgAId, "CA", service);
        expect(result).toEqual({ allowed: true });
      });

      it("blocks a state whose active-status registration has already expired (registration_expired)", async () => {
        const result = await guard.canSolicitInState(orgAId, "NY", service);
        expect(result).toEqual({ allowed: false, reason: "registration_expired" });
      });

      it("blocks a state whose only registration row is not status='active', even if unexpired (not_registered_in_state)", async () => {
        const result = await guard.canSolicitInState(orgAId, "FL", service);
        expect(result).toEqual({ allowed: false, reason: "not_registered_in_state" });
      });

      it("does not leak another organization's registration for the same state", async () => {
        // Org B is actively registered in GA; org A must not inherit it.
        const resultA = await guard.canSolicitInState(orgAId, "GA", service);
        expect(resultA).toEqual({ allowed: false, reason: "not_registered_in_state" });

        const resultB = await guard.canSolicitInState(orgBId, "GA", service);
        expect(resultB).toEqual({ allowed: true });
      });
    });

    describe("ComplianceGuard.getRegisteredStates() — currently-valid registration set", () => {
      it("returns exactly the active, unexpired states for org A (TX, CA) — excludes expired NY, inactive FL, unregistered GA", async () => {
        const states = await guard.getRegisteredStates(orgAId, service);
        expect(new Set(states)).toEqual(new Set(["TX", "CA"]));
      });

      it("returns exactly org B's own registered states (GA) — scoped per organization", async () => {
        const states = await guard.getRegisteredStates(orgBId, service);
        expect(states).toEqual(["GA"]);
      });
    });

    describe("populateQueue() compliance-hold enforcement (auto-queue-populator.ts integration)", () => {
      // auto-queue-populator.ts is the actual caller of ComplianceGuard in the
      // live AutoApply pipeline: it calls getRegisteredStates() and skips any
      // funder whose `state` isn't in that set, tagging the skip reason
      // 'compliance_hold' (see AUTOAPPLY_ARCHITECTURE_V2.md §6B and the
      // compliance page's own "How this works" copy). That filter reads
      // `funders.city` and `funders.state` in its query
      // (src/lib/autoapply/auto-queue-populator.ts:195). A live column check
      // against production (service-role REST) confirms NEITHER column exists
      // on the live `funders` table (PostgREST 42703 "column funders.city
      // does not exist"), unlike `funders.type` and
      // `organizations.contact_email`, which migration 053 already backfilled
      // for an identical prior failure class. So today, in production, the
      // state-based compliance-hold filter can never run at all — populateQueue()
      // throws before ComplianceGuard is even reached, for every organization,
      // regardless of whether any registrations or funders exist. This test
      // documents that real, currently-live gap rather than asserting the
      // aspirational (currently unreachable) blocked/allowed queue behavior.
      it("cannot currently enforce state compliance holds — funders.city/state are missing columns in production", async () => {
        await expect(
          populateQueue({ organizationId: orgAId, supabase: service, dry_run: true }),
        ).rejects.toThrow(/column funders\.(city|state) does not exist/);
      });
    });
  },
);

if (!CREDS_AVAILABLE) {
  // eslint-disable-next-line no-console
  console.warn(
    "[autoapply-compliance.test] skipped entirely — .env.local is missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY",
  );
}
