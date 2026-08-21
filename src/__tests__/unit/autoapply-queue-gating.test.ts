/**
 * Mock-level unit replacement for the org_not_ready gating behavior
 * previously covered only by src/__tests__/integration-live/autoapply-queue-worker.test.ts
 * (moved there, WGR-157, because it required a real, separately-deployed
 * Railway worker polling the real submission_queue table within 90-180s —
 * a live external system, not something the default `vitest run` should
 * depend on).
 *
 * This exercises the SAME code path (QueueProcessor.processItem(),
 * worker/queue-processor.ts) directly, with every collaborator mocked, so
 * the org-readiness gate's pass/skip decision stays covered deterministically
 * without a live worker or live database. The "ready" case uses a sentinel
 * error thrown by the very next unmocked Supabase call (request_profiles)
 * to prove execution passed the org_not_ready check, since fully simulating
 * the rest of the real submission pipeline (browser automation, CAPTCHA,
 * form-fill) here would just re-mock the entire worker, not test anything.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// worker/index.ts runs validateEnv() (process.exit(1) on missing env vars)
// as a top-level side effect at import time, and worker/rate-limiter.ts
// (a QueueProcessor collaborator) imports `supabase` from it — so merely
// importing QueueProcessor for a unit test would kill the whole vitest
// process under the default .env.test env. Mocked out before that import
// chain resolves; QueueProcessor never uses worker/index.ts's supabase
// export directly (it takes its own client via the constructor).
vi.mock("../../../worker/index", () => ({ supabase: {} }));

const mockIsBlocked = vi.fn();
vi.mock("@/lib/autoapply/queue-controls", () => ({
  QueueControlPlane: vi.fn().mockImplementation(() => ({
    isBlocked: mockIsBlocked,
  })),
}));

const mockShouldUseOwnKeys = vi.fn();
const mockCheckAllowance = vi.fn();
vi.mock("@/lib/autoapply/usage-meter", () => ({
  UsageMeter: vi.fn().mockImplementation(() => ({
    shouldUseOwnKeys: mockShouldUseOwnKeys,
    checkAllowance: mockCheckAllowance,
  })),
}));

const mockCheckOrgReadiness = vi.fn();
const mockCheckConcurrentAutomation = vi.fn();
vi.mock("@/lib/autoapply/submission-validator", () => ({
  SubmissionValidator: vi.fn().mockImplementation(() => ({
    checkOrgReadiness: mockCheckOrgReadiness,
    checkConcurrentAutomation: mockCheckConcurrentAutomation,
  })),
}));

// Import AFTER the mocks above (hoisted by vitest, but keep the read order
// clear) — worker/queue-processor.ts constructs QueueControlPlane/UsageMeter/
// SubmissionValidator instances internally in its constructor.
import { QueueProcessor } from "../../../worker/queue-processor";

const ORG_ID = "org-gate-test";
const FUNDER_ID = "funder-gate-test";
const QUEUE_ITEM_ID = "queue-item-gate-test";
const REQUEST_PROFILE_SENTINEL_ID = "request-profile-sentinel";
const SENTINEL_MESSAGE = "SENTINEL_REACHED_PAST_READINESS_GATE";

function makeSupabaseMock() {
  return {
    from: vi.fn((table: string) => {
      if (table === "funders") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: FUNDER_ID,
              name: "Gate Test Funder",
              giving_portal_url: null,
              contact_email: "funder@example.org",
              category: "private_foundation",
              type: null,
              automation_level: "assisted",
            },
            error: null,
          }),
        };
      }
      if (table === "organizations") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { name: "Gate Test Org", mission_statement: null, subscription_tier: "starter", ein: null, contact_email: null },
            error: null,
          }),
        };
      }
      if (table === "request_profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockRejectedValue(new Error(SENTINEL_MESSAGE)),
        };
      }
      throw new Error(`unexpected table in gating test: ${table}`);
    }),
  };
}

describe("QueueProcessor org-readiness gate (mocked) — replaces the live-worker version of this check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsBlocked.mockResolvedValue({ blocked: false });
    mockShouldUseOwnKeys.mockResolvedValue({ useOwn: false });
    mockCheckAllowance.mockResolvedValue({
      allowed: true,
      monthlyCount: 0,
      monthlyLimit: 999,
      dailyCount: 0,
      dailyLimit: 999,
    });
    mockCheckConcurrentAutomation.mockResolvedValue({ conflict: false });
  });

  it("not-ready org: processItem() rejects with org_not_ready before reaching any submission logic", async () => {
    mockCheckOrgReadiness.mockResolvedValue({
      ready: false,
      score: 10,
      missing_required: ["At least one active request profile"],
      blockers: ["No active request profiles"],
    });

    const supabase = makeSupabaseMock();
    const processor = new QueueProcessor(supabase as never, "test-worker");

    await expect(
      (processor as unknown as { processItem: (item: unknown) => Promise<void> }).processItem({
        id: QUEUE_ITEM_ID,
        organization_id: ORG_ID,
        funder_id: FUNDER_ID,
        request_profile_id: null,
      }),
    ).rejects.toThrow(/org_not_ready/);

    // The request_profiles sentinel query must never be reached — proves
    // the gate rejected before any further submission-pipeline work.
    expect(supabase.from).not.toHaveBeenCalledWith("request_profiles");
  });

  it("ready org: processItem() proceeds past the org_not_ready gate (reaches real submission logic)", async () => {
    mockCheckOrgReadiness.mockResolvedValue({
      ready: true,
      score: 100,
      missing_required: [],
      blockers: [],
    });

    const supabase = makeSupabaseMock();
    const processor = new QueueProcessor(supabase as never, "test-worker");

    // The gate passed iff execution reaches the next real (unmocked-outcome)
    // Supabase call after it and surfaces THAT call's own error, rather than
    // the org_not_ready SkipError.
    await expect(
      (processor as unknown as { processItem: (item: unknown) => Promise<void> }).processItem({
        id: QUEUE_ITEM_ID,
        organization_id: ORG_ID,
        funder_id: FUNDER_ID,
        request_profile_id: REQUEST_PROFILE_SENTINEL_ID,
      }),
    ).rejects.toThrow(SENTINEL_MESSAGE);

    expect(mockCheckOrgReadiness).toHaveBeenCalledWith(ORG_ID, supabase);
  });
});
