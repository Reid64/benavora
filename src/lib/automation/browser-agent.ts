// BrowserAgent - base class for Phase 3 browser automation agents.
// (AGENTS.md Agent 16, BEHAVIORAL_CONTRACTS §18)
//
// Wraps BrowserEngine with retry logic for flaky selectors, an auto-incrementing
// step counter for screenshot naming, and structured logging to agent_runs.
// All selector-based operations retry up to SELECTOR_RETRY_COUNT times with a
// fixed delay before propagating the error to the caller.
//
// Extend this class for specific automation tasks (form filling, portal login,
// document upload). Do not call start()/stop() concurrently - one session per
// instance.
//
// Cookie persistence: pass sessionState (from a prior exportSessionState()) to
// resume an authenticated portal session without re-logging in.

import type { SupabaseClient } from "@supabase/supabase-js";

import { BrowserEngine } from "@/lib/automation/browser-engine";
import { ChallengeDetector } from "@/lib/automation/challenge-detector";
import { AutomationSessionManager } from "@/lib/automation/session-manager";
import type { ChallengeResult, ScreenshotCapture } from "@/types/automation";

/**
 * Thrown by navigate() and submitForm() when a challenge (CAPTCHA, MFA, etc.)
 * is detected. The automation MUST stop; the result describes what was found
 * and what the operator must do (BEHAVIORAL_CONTRACTS §18).
 */
export class ChallengeDetectedError extends Error {
  readonly result: ChallengeResult;

  constructor(result: ChallengeResult) {
    super(`Automation paused: ${result.type} challenge detected.`);
    this.name = "ChallengeDetectedError";
    this.result = result;
  }
}

/** Retries per selector operation (task spec: 3). */
const SELECTOR_RETRY_COUNT = 3;
/** Delay between selector retries in ms (task spec: 2 s). */
const SELECTOR_RETRY_DELAY_MS = 2_000;
/** Default per-action timeout in ms (task spec: 30 s). */
export const DEFAULT_ACTION_TIMEOUT_MS = 30_000;

export interface BrowserAgentOptions {
  /** Supabase service-role client for storage + DB writes. */
  client: SupabaseClient;
  /** Tenant scope - determines the storage bucket and RLS scoping. */
  organizationId: string;
  /** Automation session this agent is executing - namespaces screenshot paths. */
  sessionId: string;
  /** Run headless. Defaults to true; set false for visual debugging. */
  headless?: boolean;
  /** Per-action timeout in ms. Defaults to {@link DEFAULT_ACTION_TIMEOUT_MS}. */
  actionTimeoutMs?: number;
  /** Restore a prior cookie/session snapshot (portal login persistence). */
  sessionState?: unknown;
}

export class BrowserAgent {
  protected readonly engine: BrowserEngine;
  protected readonly client: SupabaseClient;
  protected readonly organizationId: string;
  protected readonly sessionId: string;
  protected readonly actionTimeoutMs: number;

  private readonly challengeDetector = new ChallengeDetector();

  /** Auto-incremented on every screenshot() call for step_N naming. */
  private stepCounter = 0;
  /** agent_runs row id written on start(), updated on stop(). */
  private agentRunId: string | null = null;
  private startedAt: number | null = null;

  constructor(options: BrowserAgentOptions) {
    this.client = options.client;
    this.organizationId = options.organizationId;
    this.sessionId = options.sessionId;
    this.actionTimeoutMs = options.actionTimeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS;
    this.engine = new BrowserEngine({
      client: options.client,
      organizationId: options.organizationId,
      sessionId: options.sessionId,
      headless: options.headless ?? true,
      navigationTimeoutMs: this.actionTimeoutMs,
      sessionState: options.sessionState,
    });
  }

  // --- lifecycle -------------------------------------------------------------

  /** Launch Chromium and write the agent_runs row. */
  async start(): Promise<void> {
    this.startedAt = Date.now();
    await this.engine.launch();
    await this.openAgentRun();
  }

  /** Close the browser and update agent_runs to completed. */
  async stop(): Promise<void> {
    await this.engine.close();
    await this.closeAgentRun();
  }

  /** Close the browser and mark agent_runs as failed. */
  async fail(errorMessage: string): Promise<void> {
    await this.engine.close();
    await this.closeAgentRun(errorMessage);
  }

  // --- navigation ------------------------------------------------------------

  /**
   * Navigate to `url`, waiting for DOM-ready, then scan for challenges.
   * Throws {@link ChallengeDetectedError} if a CAPTCHA, MFA, login, or
   * account-creation prompt is detected after navigation - the automation MUST
   * stop and wait for a human operator (BEHAVIORAL_CONTRACTS §18).
   */
  async navigate(url: string): Promise<void> {
    await this.engine.navigate(url);
    await this.runChallengeCheck();
  }

  /**
   * Click a form submit button, wait for the resulting page load, then scan for
   * challenges. Use this instead of click() for form submissions so that
   * post-submission challenges (e.g. 2FA prompts) are caught automatically.
   * Throws {@link ChallengeDetectedError} when a challenge is found.
   */
  async submitForm(selector: string): Promise<void> {
    await this.withRetry("submitForm", () =>
      this.engine.page.click(selector, { timeout: this.actionTimeoutMs }),
    );
    await this.engine.page
      .waitForLoadState("domcontentloaded", { timeout: 10_000 })
      .catch(() => undefined);
    await this.runChallengeCheck();
  }

  // --- selector actions (all wrapped with retry logic) ----------------------

  /** Click the first element matching `selector`. */
  async click(selector: string): Promise<void> {
    await this.withRetry("click", () =>
      this.engine.page.click(selector, { timeout: this.actionTimeoutMs }),
    );
  }

  /** Clear and type `value` into the element matching `selector`. */
  async fill(selector: string, value: string): Promise<void> {
    await this.withRetry("fill", () =>
      this.engine.page.fill(selector, value, { timeout: this.actionTimeoutMs }),
    );
  }

  /**
   * Select `value` (option value or label) in the <select> matching `selector`.
   */
  async selectOption(selector: string, value: string): Promise<void> {
    await this.withRetry("selectOption", () =>
      this.engine.page.selectOption(selector, value, {
        timeout: this.actionTimeoutMs,
      }),
    );
  }

  /**
   * Upload a file into the file-input matching `selector`. `filePath` is a
   * Supabase Storage path inside the org bucket - the file is downloaded and
   * attached via Playwright's setInputFiles.
   */
  async uploadFile(selector: string, filePath: string): Promise<void> {
    const buffer = await this.engine.downloadFile(filePath);
    const fileName = filePath.split("/").pop() ?? "upload";
    await this.withRetry("uploadFile", () =>
      this.engine.page.setInputFiles(selector, {
        name: fileName,
        mimeType: "application/octet-stream",
        buffer,
      }),
    );
  }

  /**
   * Capture a full-page screenshot and store it in Supabase Storage.
   * The storage path is `automation/{sessionId}/step_{N}_{label}.png`.
   * Returns the capture metadata (storagePath, pageUrl, label).
   */
  async screenshot(label: string): Promise<ScreenshotCapture> {
    const step = ++this.stepCounter;
    return this.engine.screenshot(`step_${step}_${label}`);
  }

  /**
   * Wait for the element matching `selector` to appear in the DOM, bounded by
   * the action timeout.
   */
  async waitForSelector(selector: string): Promise<void> {
    await this.engine.page.waitForSelector(selector, {
      timeout: this.actionTimeoutMs,
    });
  }

  /**
   * Return the visible text content of the first element matching `selector`.
   * Returns an empty string when the element has no text.
   */
  async getText(selector: string): Promise<string> {
    return this.withRetry("getText", async () => {
      const text = await this.engine.page.textContent(selector, {
        timeout: this.actionTimeoutMs,
      });
      return text ?? "";
    });
  }

  // --- session helpers -------------------------------------------------------

  /**
   * Export the current cookie/session snapshot for portal-login persistence.
   * Store the result and pass it back as `sessionState` on the next run to skip
   * re-authentication.
   */
  async exportSessionState(): Promise<unknown> {
    return this.engine.exportSessionState();
  }

  // --- retry logic ----------------------------------------------------------

  /**
   * Run `fn` up to SELECTOR_RETRY_COUNT times, sleeping SELECTOR_RETRY_DELAY_MS
   * between attempts. Re-throws the last error if all attempts fail.
   */
  protected async withRetry<T>(
    _label: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= SELECTOR_RETRY_COUNT; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        if (attempt < SELECTOR_RETRY_COUNT) {
          await sleep(SELECTOR_RETRY_DELAY_MS);
        }
      }
    }
    throw lastError;
  }

  // --- challenge detection --------------------------------------------------

  /**
   * Run the challenge detector against the current page. If a challenge is
   * found: capture a screenshot, write a `detect_challenge` step to the DB,
   * and pause the session at `awaiting_approval` so a human must intervene.
   * Then throw {@link ChallengeDetectedError} to halt the automation.
   * Best-effort - DB failures are swallowed so the throw still propagates.
   */
  private async runChallengeCheck(): Promise<void> {
    let result: ChallengeResult;
    try {
      result = await this.challengeDetector.detect(this.engine.page);
    } catch {
      return;
    }
    if (!result.detected) return;

    await this.handleChallenge(result);
    throw new ChallengeDetectedError(result);
  }

  private async handleChallenge(result: ChallengeResult): Promise<void> {
    const capture = await this.engine
      .captureErrorScreenshot(`challenge-${result.type}`)
      .catch(() => null);

    const filledResult: ChallengeResult = {
      ...result,
      screenshot: capture?.storagePath ?? "",
    };

    const manager = new AutomationSessionManager({
      client: this.client,
      organizationId: this.organizationId,
    });

    const step = await manager
      .recordStep(this.sessionId, {
        stepNumber: this.stepCounter + 1000,
        action: "detect_challenge",
        description: `Challenge detected: ${filledResult.type}`,
        status: "completed",
        outputData: {
          challenge_type: filledResult.type,
          screenshot: filledResult.screenshot,
          instructions: filledResult.instructions,
          is_challenge: true,
        },
      })
      .catch(() => null);

    if (capture) {
      await manager
        .recordScreenshot(this.sessionId, capture, {
          stepId: step?.id ?? null,
          description: `Challenge: ${filledResult.type}`,
        })
        .catch(() => undefined);
    }

    await manager
      .markAwaitingApproval(
        this.sessionId,
        `Paused for ${filledResult.type} challenge. Solve manually and resume.`,
      )
      .catch(() => undefined);
  }

  // --- agent_runs logging ---------------------------------------------------

  private async openAgentRun(): Promise<void> {
    try {
      const { data } = await this.client
        .from("agent_runs")
        .insert({
          organization_id: this.organizationId,
          agent_type: "browser_automation",
          status: "running",
          input_params: { session_id: this.sessionId } as Record<
            string,
            unknown
          >,
          started_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (data) this.agentRunId = (data as { id: string }).id;
    } catch {
      // Logging failure must never abort the automation run.
    }
  }

  private async closeAgentRun(errorMessage?: string): Promise<void> {
    if (!this.agentRunId) return;
    try {
      const durationMs =
        this.startedAt !== null ? Date.now() - this.startedAt : null;
      await this.client
        .from("agent_runs")
        .update({
          status: errorMessage ? "failed" : "completed",
          error_message: errorMessage ?? null,
          duration_ms: durationMs,
          completed_at: new Date().toISOString(),
        })
        .eq("id", this.agentRunId);
    } catch {
      // Non-fatal.
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
