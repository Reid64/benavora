/**
 * AR-16.1 — proves worker/queue-processor.ts's processItem() WRAPPER itself,
 * the thing AR-9.3 (autoapply-end-to-end.test.ts) named as its one deliberate
 * gap: "processItem() itself is never called end to end... it also gates on
 * roughly ten unrelated business rules this suite does not exercise."
 *
 * This suite does NOT re-prove the submission chain (mutex -> StealthBrowser
 * -> FormAnalyzerAgent -> FormFillerAgent -> status mapping -> submission row
 * -> session finalization) — AR-9.3 already does that against a real fixture
 * portal with real Playwright and real Claude. This suite proves the
 * ORCHESTRATION around that chain: the ~10 business gates processItem() runs
 * before/around it, each mocked in isolation so a single gate's decision can
 * be asserted without the other nine being live. Despite living in
 * `integration/` (matching the task's required path), this suite is
 * deliberately mock-based, not credential-gated, and always runs.
 *
 * THE SSRF GUARD (src/lib/security/ssrf-guard.ts) — kept unchanged:
 * processItem() calls assertUrlSafe(portalUrl) before ever reaching a browser
 * or a health-check fetch, and that guard unconditionally rejects every
 * private/loopback address (127.0.0.1 included) — the exact reason AR-9.3
 * could never drive processItem() itself against its local fixture portal.
 * Weakening the guard was explicitly out of bounds for this task. Instead,
 * worker/queue-processor.ts's constructor gained one new, optional,
 * dependency-injection seam: a 4th constructor parameter
 * (`urlSafetyCheck: (url: string) => Promise<ValidatedAddress> = assertUrlSafe`).
 * Production code (the `start()` factory at the bottom of queue-processor.ts)
 * never passes a 4th argument, so every real deployment still calls the real,
 * unmodified assertUrlSafe with no behavior change whatsoever. Only a test
 * that deliberately constructs `new QueueProcessor(supabase, id, undefined,
 * override)` gets different behavior. Group A below proves three things
 * about that seam, in order: (1) the production default still enforces the
 * real guard for real, (2) the injected override lets this SAME processItem()
 * proceed past the SSRF stage for a carved-out fixture host, and (3) that
 * override is not a blanket bypass — it still defers to the real,
 * unmodified assertUrlSafe for every other host.
 *
 * Group B exercises the five gates the task named by name — queue control
 * plane, org readiness, portal health check, the risk engine, and
 * login-gating — one assertion each, each asserting on the actual
 * distinguishable message processItem() throws (never a generic "skipped").
 * Three of the five (portal health, risk engine, login-gating) also assert a
 * concrete recorded side effect processItem() itself writes inline (a
 * funders.portal_status update, a submission_queue pending_manual update, an
 * autoapply_submissions row carrying the same reason) — proof the reason is
 * recorded, not just thrown. The other two (control plane, org readiness) are
 * SkipErrors with no gate-specific inline write of their own; production
 * persists those via worker/queue-processor.ts's own loop() catch block
 * (`status: 'skipped', error_message: ...`), an existing, unchanged code path
 * this suite does not re-drive since loop() itself is out of this task's
 * scope (it requires a live dequeue()/heartbeat loop, not a single item).
 *
 * Mocking approach mirrors the existing precedent,
 * src/__tests__/unit/autoapply-queue-gating.test.ts (mock every collaborator,
 * call the real, private processItem() via reflection, assert on the thrown
 * reason) — extended here to cover the full gate list the task named, plus
 * the SSRF injection seam that test predates.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// worker/index.ts runs validateEnv() (process.exit(1) on missing env vars,
// e.g. WORKER_ID — never set under vitest) as a top-level side effect at
// import time. worker/rate-limiter.ts (a QueueProcessor collaborator)
// imports `supabase` from it, so merely importing QueueProcessor would kill
// the whole vitest process without this stub — same guard as every other
// mock-based suite that imports queue-processor.ts directly.
vi.mock("../../../worker/index", () => ({ supabase: {} }));

// Every mocked collaborator's vi.fn() lives in one vi.hoisted() block. vi.mock
// factories are hoisted above the rest of the module, and with ~20 mock
// functions spread across 11 vi.mock() calls, letting Vitest's per-statement
// "const mockX = vi.fn()" auto-hoisting pair each declaration with its own
// vi.mock() call is fragile (observed live: a bare `const mockQuickHealthCheck
// = vi.fn()` above its vi.mock() call threw "Cannot access before
// initialization" once enough other mock blocks preceded it in the file).
// vi.hoisted() sidesteps the ordering question entirely by guaranteeing every
// name below exists before any vi.mock() factory runs.
const {
  mockIsBlocked,
  mockShouldUseOwnKeys,
  mockCheckAllowance,
  mockRecordUsage,
  mockCheckOrgReadiness,
  mockCheckConcurrentAutomation,
  mockValidateFormData,
  mockQuickHealthCheck,
  mockAssessSubmissionRisk,
  mockDetectLoginForm,
  mockDetectRegistrationForm,
  mockRegister,
  mockLogin,
  mockGetCredentials,
  mockUpdateLastLogin,
  mockStoreCredentials,
  mockCheckVelocityLimits,
  mockCheckCrossClientDedup,
  mockCheckDomainThrottle,
  mockRecordSubmissionControls,
  mockStealthLaunch,
  mockGetRecordingPath,
  mockStartScreencast,
  mockStopScreencast,
  mockCanSubmitToDomain,
  mockGetBackoffDelay,
  mockWaitBetweenSubmissions,
  mockCaptureAndUpload,
  mockUploadAndRecord,
  mockLinkToSubmission,
  mockWebhookNotify,
  mockAnnotateErrorScreenshot,
} = vi.hoisted(() => ({
  mockIsBlocked: vi.fn(),
  mockShouldUseOwnKeys: vi.fn(),
  mockCheckAllowance: vi.fn(),
  mockRecordUsage: vi.fn(),
  mockCheckOrgReadiness: vi.fn(),
  mockCheckConcurrentAutomation: vi.fn(),
  mockValidateFormData: vi.fn(),
  mockQuickHealthCheck: vi.fn(),
  mockAssessSubmissionRisk: vi.fn(),
  mockDetectLoginForm: vi.fn(),
  mockDetectRegistrationForm: vi.fn(),
  mockRegister: vi.fn(),
  mockLogin: vi.fn(),
  mockGetCredentials: vi.fn(),
  mockUpdateLastLogin: vi.fn(),
  mockStoreCredentials: vi.fn(),
  mockCheckVelocityLimits: vi.fn(),
  mockCheckCrossClientDedup: vi.fn(),
  mockCheckDomainThrottle: vi.fn(),
  mockRecordSubmissionControls: vi.fn(),
  mockStealthLaunch: vi.fn(),
  mockGetRecordingPath: vi.fn(),
  mockStartScreencast: vi.fn(),
  mockStopScreencast: vi.fn(),
  mockCanSubmitToDomain: vi.fn(),
  mockGetBackoffDelay: vi.fn(),
  mockWaitBetweenSubmissions: vi.fn(),
  mockCaptureAndUpload: vi.fn(),
  mockUploadAndRecord: vi.fn(),
  mockLinkToSubmission: vi.fn(),
  mockWebhookNotify: vi.fn(),
  mockAnnotateErrorScreenshot: vi.fn(),
}));

// --- Gate 1: queue control plane --------------------------------------------
vi.mock("@/lib/autoapply/queue-controls", () => ({
  QueueControlPlane: vi.fn().mockImplementation(() => ({ isBlocked: mockIsBlocked })),
}));

// --- Usage / billing gates (not individually asserted, but must not crash) --
vi.mock("@/lib/autoapply/usage-meter", () => ({
  UsageMeter: vi.fn().mockImplementation(() => ({
    shouldUseOwnKeys: mockShouldUseOwnKeys,
    checkAllowance: mockCheckAllowance,
    recordUsage: mockRecordUsage,
  })),
}));

// --- Gate 2: org readiness (+ mutex, format validation) ---------------------
vi.mock("@/lib/autoapply/submission-validator", () => ({
  SubmissionValidator: vi.fn().mockImplementation(() => ({
    checkOrgReadiness: mockCheckOrgReadiness,
    checkConcurrentAutomation: mockCheckConcurrentAutomation,
    validateFormData: mockValidateFormData,
  })),
  // AR-1.2: queue-processor.ts imports this alongside SubmissionValidator to
  // tag the checkOrgReadiness withAgentRun() call.
  AGENT_TYPE: "autoapply_submission_validator",
}));

// --- Gate 3: portal health check --------------------------------------------
vi.mock("../../../worker/portal-health", () => ({
  quickHealthCheck: mockQuickHealthCheck,
}));

// --- Gate 4: risk engine -----------------------------------------------------
vi.mock("@/lib/autoapply/risk-engine", () => ({
  assessSubmissionRisk: mockAssessSubmissionRisk,
  AGENT_TYPE: "autoapply_risk_engine",
}));

// --- Gate 5: login-gating (+ credentials) -----------------------------------
vi.mock("@/lib/autoapply/registration-agent", () => ({
  RegistrationAgent: vi.fn().mockImplementation(() => ({
    detectLoginForm: mockDetectLoginForm,
    detectRegistrationForm: mockDetectRegistrationForm,
    register: mockRegister,
    login: mockLogin,
  })),
  AGENT_TYPE: "autoapply_registration",
}));

vi.mock("@/lib/autoapply/credential-manager", () => ({
  CredentialManager: vi.fn().mockImplementation(() => ({
    getCredentials: mockGetCredentials,
    updateLastLogin: mockUpdateLastLogin,
    storeCredentials: mockStoreCredentials,
  })),
}));

// --- Velocity / cross-client / domain throttles (must not crash) -----------
vi.mock("@/lib/autoapply/submission-controls", () => ({
  SubmissionControls: vi.fn().mockImplementation(() => ({
    checkVelocityLimits: mockCheckVelocityLimits,
    checkCrossClientDedup: mockCheckCrossClientDedup,
    checkDomainThrottle: mockCheckDomainThrottle,
    recordSubmission: mockRecordSubmissionControls,
  })),
}));

// --- Browser session (only reached by the login-gating gate test) ----------
vi.mock("@/lib/autoapply/stealth-browser", () => ({
  StealthBrowser: vi.fn().mockImplementation(() => ({
    launch: mockStealthLaunch,
    getRecordingPath: mockGetRecordingPath,
    startScreencast: mockStartScreencast,
    stopScreencast: mockStopScreencast,
  })),
}));

vi.mock("../../../worker/rate-limiter", () => ({
  RateLimiter: vi.fn().mockImplementation(() => ({
    canSubmitToDomain: mockCanSubmitToDomain,
    getBackoffDelay: mockGetBackoffDelay,
    waitBetweenSubmissions: mockWaitBetweenSubmissions,
  })),
}));

vi.mock("@/lib/autoapply/screenshot-manager", () => ({
  ScreenshotManager: vi.fn().mockImplementation(() => ({
    captureAndUpload: mockCaptureAndUpload,
    uploadAndRecord: mockUploadAndRecord,
    linkToSubmission: mockLinkToSubmission,
  })),
}));

vi.mock("@/lib/autoapply/webhook-notifier", () => ({
  WebhookNotifier: vi.fn().mockImplementation(() => ({ notify: mockWebhookNotify })),
}));

vi.mock("@/lib/autoapply/error-annotator", () => ({
  annotateErrorScreenshot: mockAnnotateErrorScreenshot,
}));

// Import AFTER every mock above (hoisted by vitest, order kept explicit for
// readability) — the real, unmodified SSRF guard is deliberately NOT mocked.
import { QueueProcessor } from "../../../worker/queue-processor";
import { assertUrlSafe } from "@/lib/security/ssrf-guard";

const ORG_ID = "org-orch-test";
const FUNDER_ID = "funder-orch-test";
const QUEUE_ITEM_ID = "queue-item-orch-test";
const FIXTURE_PORTAL_URL = "http://127.0.0.1:4321/apply";
const FIXTURE_HOST = "127.0.0.1";

/**
 * The "test policy" named in the task: production keeps calling the real
 * assertUrlSafe (the constructor default). This override exists ONLY in this
 * test file, carves out exactly one loopback host so the fixture portal URL
 * above can reach processItem()'s post-SSRF gates, and defers to the real,
 * unmodified guard for every other host — see test A3 below, which proves
 * that delegation actually happens rather than this being a silent
 * blanket bypass.
 */
function testUrlSafetyPolicy(url: string) {
  const parsed = new URL(url);
  if (parsed.hostname === FIXTURE_HOST) {
    return Promise.resolve({ address: FIXTURE_HOST, family: 4 as const });
  }
  return assertUrlSafe(url);
}

function callProcessItem(processor: QueueProcessor, item: unknown): Promise<void> {
  return (processor as unknown as { processItem: (item: unknown) => Promise<void> }).processItem(item);
}

// --- Chainable Supabase query-builder mock ----------------------------------
// A Proxy rather than an enumerated method list: real PostgREST builders
// expose dozens of chain methods (select/eq/gte/not/order/...) and every
// collaborator this suite doesn't fully mock (getOptimalAskAmount,
// RelationshipManager, ABTestEngine — all safety-netted by their own
// call-site .catch(), see the suite header) is free to use any of them.
// TERMINAL_METHODS resolve; everything else (any property access) returns a
// tracked vi.fn() that re-returns the same proxy, so arbitrary chains never
// throw "is not a function." The object is also directly thenable, for call
// sites that `await` the builder without a terminal method at all.
const TERMINAL_METHODS = new Set(["single", "maybeSingle"]);
function makeResult(data: unknown, error: unknown = null) {
  const calls = new Map<string, ReturnType<typeof vi.fn>>();
  const target = {
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data, error }).then(resolve, reject),
  };
  const proxy: any = new Proxy(target, {
    get(t, prop: string, receiver) {
      if (prop === "then") return Reflect.get(t, prop, receiver);
      if (!calls.has(prop)) {
        calls.set(
          prop,
          TERMINAL_METHODS.has(prop) ? vi.fn(async () => ({ data, error })) : vi.fn(() => proxy),
        );
      }
      return calls.get(prop);
    },
  });
  return proxy as Record<string, ReturnType<typeof vi.fn>> & PromiseLike<{ data: unknown; error: unknown }>;
}

function makeSupabase(tables: Record<string, () => ReturnType<typeof makeResult>>) {
  return {
    from: vi.fn((table: string) => (tables[table] ? tables[table]() : makeResult(null, null))),
    storage: { from: vi.fn(() => ({ upload: vi.fn().mockResolvedValue({ error: null }) })) },
  };
}

function funderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: FUNDER_ID,
    name: "Orchestration Test Funder",
    giving_portal_url: null as string | null,
    contact_email: "grants@orch-test.example.org",
    category: "private_foundation",
    type: null,
    automation_level: "assisted",
    ...overrides,
  };
}

function orgRow(overrides: Record<string, unknown> = {}) {
  return {
    name: "Orchestration Test Org",
    mission_statement: null as string | null,
    subscription_tier: "starter",
    ein: null,
    contact_email: null,
    ...overrides,
  };
}

function freshTemplateRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "tmpl-orch-1",
    funder_id: FUNDER_ID,
    last_verified_at: new Date().toISOString(),
    field_count: 4,
    form_structure: null as unknown,
    ...overrides,
  };
}

/** Default table map for the web_form-channel gates (portal health, risk, login-gating). */
function baseWebFormTables(overrides: Record<string, () => ReturnType<typeof makeResult>> = {}) {
  const funders = makeResult(funderRow({ giving_portal_url: FIXTURE_PORTAL_URL, contact_email: null }));
  const organizations = makeResult(orgRow());
  const formTemplates = makeResult(freshTemplateRow());
  const submissionQueue = makeResult({ error: null });
  const autoapplySubmissions = makeResult({ id: "sub-orch-1" });
  return {
    funders: () => funders,
    organizations: () => organizations,
    form_templates: () => formTemplates,
    submission_queue: () => submissionQueue,
    autoapply_submissions: () => autoapplySubmissions,
    ...overrides,
  };
}

function baseItem(overrides: Record<string, unknown> = {}) {
  return {
    id: QUEUE_ITEM_ID,
    organization_id: ORG_ID,
    funder_id: FUNDER_ID,
    request_profile_id: null,
    ...overrides,
  };
}

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
  mockRecordUsage.mockResolvedValue(undefined);
  mockCheckOrgReadiness.mockResolvedValue({ ready: true, score: 100, missing_required: [], blockers: [] });
  mockCheckConcurrentAutomation.mockResolvedValue({ conflict: false });
  mockValidateFormData.mockResolvedValue({ valid: true, errors: [] });
  mockQuickHealthCheck.mockResolvedValue("active");
  mockAssessSubmissionRisk.mockResolvedValue({
    score: 10,
    classification: "low",
    recommendation: "auto",
    factors: [],
    shouldNotify: false,
  });
  mockDetectLoginForm.mockResolvedValue({ hasLoginForm: false });
  mockDetectRegistrationForm.mockResolvedValue({ hasRegistrationForm: false });
  mockRegister.mockResolvedValue({ success: true, confirmationRequired: false, username: "u", password: "p" });
  mockLogin.mockResolvedValue(true);
  mockGetCredentials.mockResolvedValue(null);
  mockUpdateLastLogin.mockResolvedValue(undefined);
  mockStoreCredentials.mockResolvedValue(undefined);
  mockCheckVelocityLimits.mockResolvedValue({ blocked: false });
  mockCheckCrossClientDedup.mockResolvedValue({ blocked: false });
  mockCheckDomainThrottle.mockResolvedValue({ blocked: false });
  mockRecordSubmissionControls.mockResolvedValue(undefined);
  mockCanSubmitToDomain.mockResolvedValue(true);
  mockGetBackoffDelay.mockReturnValue(0);
  mockWaitBetweenSubmissions.mockResolvedValue(undefined);
  mockCaptureAndUpload.mockResolvedValue("https://storage.example/screenshot.png");
  mockUploadAndRecord.mockResolvedValue("https://storage.example/error.png");
  mockLinkToSubmission.mockResolvedValue(undefined);
  mockWebhookNotify.mockResolvedValue(undefined);
  mockAnnotateErrorScreenshot.mockResolvedValue({});

  const mockPage = {
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(""),
    screenshot: vi.fn().mockResolvedValue(Buffer.from("fake-screenshot")),
  };
  const mockBrowser = { close: vi.fn().mockResolvedValue(undefined) };
  mockStealthLaunch.mockResolvedValue({
    browser: mockBrowser,
    page: mockPage,
    context: { close: vi.fn().mockResolvedValue(undefined) },
  });
  mockGetRecordingPath.mockResolvedValue(null);
  mockStartScreencast.mockResolvedValue(undefined);
  mockStopScreencast.mockResolvedValue(undefined);
});

describe("processItem() orchestration (AR-16.1) — the SSRF injection seam", () => {
  it("A1: with NO injected override, processItem() rejects a loopback portal URL via the real, unmodified SSRF guard", async () => {
    const supabase = makeSupabase({
      funders: () => makeResult(funderRow({ giving_portal_url: FIXTURE_PORTAL_URL, contact_email: null })),
    });
    const processor = new QueueProcessor(supabase as never, "test-worker-a1");

    await expect(callProcessItem(processor, baseItem())).rejects.toThrow(/portal_url_blocked_ssrf/);

    // Proves it's the real guard doing real work, not a stub: organizations
    // is only fetched AFTER the SSRF check passes, and must never be reached.
    expect(supabase.from).not.toHaveBeenCalledWith("organizations");
  });

  it("A2: WITH the injected override, the SAME processItem() proceeds past the SSRF stage for the carved-out fixture host", async () => {
    const SENTINEL = "SENTINEL_REACHED_PAST_SSRF_AR16_1";
    mockCheckOrgReadiness.mockRejectedValue(new Error(SENTINEL));

    const supabase = makeSupabase(baseWebFormTables());
    const processor = new QueueProcessor(supabase as never, "test-worker-a2", undefined, testUrlSafetyPolicy);

    // If the SSRF gate had rejected, this would throw "portal_url_blocked_ssrf"
    // instead — reaching the org-readiness sentinel proves the injected
    // policy let the same processItem() execution continue past it.
    await expect(callProcessItem(processor, baseItem())).rejects.toThrow(SENTINEL);
  });

  it("A3: the injected override is not a blanket bypass — a different private-range URL is still blocked by the real guard it delegates to", async () => {
    const supabase = makeSupabase({
      funders: () => makeResult(funderRow({ giving_portal_url: "http://10.1.2.3/apply", contact_email: null })),
    });
    const processor = new QueueProcessor(supabase as never, "test-worker-a3", undefined, testUrlSafetyPolicy);

    await expect(callProcessItem(processor, baseItem())).rejects.toThrow(/portal_url_blocked_ssrf/);
  });
});

describe("processItem() orchestration (AR-16.1) — every business gate, one assertion each", () => {
  it("B1 (queue control plane): a paused tenant produces a distinguishable control_plane_blocked reason before the funder is ever fetched", async () => {
    mockIsBlocked.mockResolvedValueOnce({
      blocked: true,
      controlType: "tenant",
      reason: "Org submissions paused pending finance review.",
    });
    const supabase = makeSupabase({});
    const processor = new QueueProcessor(supabase as never, "test-worker-b1");

    await expect(callProcessItem(processor, baseItem())).rejects.toThrow(
      /control_plane_blocked:tenant: Org submissions paused pending finance review\./,
    );
    expect(supabase.from).not.toHaveBeenCalledWith("funders");
  });

  it("B2 (org readiness): a not-ready org produces a distinguishable org_not_ready reason naming the actual blocker", async () => {
    mockCheckOrgReadiness.mockResolvedValue({
      ready: false,
      score: 20,
      missing_required: ["EIN"],
      blockers: ["Organization is missing its EIN."],
    });
    const supabase = makeSupabase({
      funders: () => makeResult(funderRow()),
      organizations: () => makeResult(orgRow()),
    });
    const processor = new QueueProcessor(supabase as never, "test-worker-b2");

    await expect(callProcessItem(processor, baseItem())).rejects.toThrow(
      /org_not_ready: Organization is missing its EIN\./,
    );
  });

  it("B3 (portal health check): a dead portal produces a distinguishable portal_dead reason and records portal_status='dead' on the funder", async () => {
    mockQuickHealthCheck.mockResolvedValue("dead");
    const fundersTable = makeResult(funderRow({ giving_portal_url: FIXTURE_PORTAL_URL, contact_email: null }));
    const supabase = makeSupabase(baseWebFormTables({ funders: () => fundersTable }));
    const processor = new QueueProcessor(supabase as never, "test-worker-b3", undefined, testUrlSafetyPolicy);

    await expect(callProcessItem(processor, baseItem())).rejects.toThrow(/portal_dead/);

    expect(fundersTable["update"]).toHaveBeenCalledWith(
      expect.objectContaining({ portal_status: "dead" }),
    );
  });

  it("B4 (risk engine): a 'manual' recommendation produces a distinguishable risk_manual_route reason and records pending_manual routing on the queue item", async () => {
    mockAssessSubmissionRisk.mockResolvedValue({
      score: 82,
      classification: "high",
      recommendation: "manual",
      factors: [{ name: "new_funder", points: 40, description: "First submission to this funder" }],
      shouldNotify: false,
    });
    const submissionQueueTable = makeResult({ error: null });
    const supabase = makeSupabase(baseWebFormTables({ submission_queue: () => submissionQueueTable }));
    const processor = new QueueProcessor(supabase as never, "test-worker-b4", undefined, testUrlSafetyPolicy);

    await expect(callProcessItem(processor, baseItem())).rejects.toThrow(
      /risk_manual_route: score=82 \(high\)/,
    );

    expect(submissionQueueTable["update"]).toHaveBeenCalledWith(
      expect.objectContaining({
        automation_mode: "manual",
        status: "pending_manual",
        risk_score: 82,
      }),
    );
  });

  it("B5 (login-gating): a login-gated portal with no usable credentials and no registration form produces a distinguishable account_required reason, recorded on the submission row", async () => {
    mockDetectLoginForm.mockResolvedValue({ hasLoginForm: true });
    mockGetCredentials.mockResolvedValue(null);
    mockDetectRegistrationForm.mockResolvedValue({ hasRegistrationForm: false });

    const autoapplySubmissionsTable = makeResult({ id: "sub-orch-b5" });
    const supabase = makeSupabase(
      baseWebFormTables({ autoapply_submissions: () => autoapplySubmissionsTable }),
    );
    const processor = new QueueProcessor(supabase as never, "test-worker-b5", undefined, testUrlSafetyPolicy);

    await expect(callProcessItem(processor, baseItem())).rejects.toThrow(
      /account_required: portal requires login but no registration form found/,
    );

    // Recorded, not just thrown: the submission audit row carries the same
    // reason (mirrors the NO FALSE SUCCESS invariant AR-9.3's suite proves
    // for the chain — every non-submitted row must record why).
    expect(autoapplySubmissionsTable["insert"]).toHaveBeenCalledWith(
      expect.objectContaining({
        error_message: expect.stringContaining("account_required"),
      }),
    );
  });
});
