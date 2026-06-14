// SERVER-ONLY. 2Captcha integration for solving CAPTCHAs during browser
// automation sessions. Called by the automation worker (Agent 29) when a
// CAPTCHA is detected on a grant portal.
//
// Supported types (Contracts §24):
//   - reCAPTCHA v2 (site key + page URL -> token)
//   - hCaptcha (site key + page URL -> token)
//   - Image CAPTCHA (base64 image -> text)
//
// reCAPTCHA v3 is NOT supported (requires browser scoring).
// 3 solve attempts per CAPTCHA; pause-for-human on all failures (Contracts §24).
// Cost tracking logged to agent_runs (Contracts §24).

import { createAdminClient } from "@/lib/supabase/admin";

// Cost per solve in USD (Contracts §24)
const COST_PER_SOLVE: Record<CaptchaType, number> = {
  recaptcha_v2: 0.00299,
  hcaptcha: 0.00299,
  image: 0.00059,
};

const TWOCAPTCHA_BASE = "https://2captcha.com";
const MAX_ATTEMPTS = 3;
const POLL_INTERVAL_MS = 5_000;

export type CaptchaType = "recaptcha_v2" | "hcaptcha" | "image";

export interface RecaptchaV2Input {
  type: "recaptcha_v2";
  siteKey: string;
  pageUrl: string;
}

export interface HCaptchaInput {
  type: "hcaptcha";
  siteKey: string;
  pageUrl: string;
}

export interface ImageCaptchaInput {
  type: "image";
  /** Base64-encoded image (no data URI prefix). */
  imageBase64: string;
}

export type CaptchaInput = RecaptchaV2Input | HCaptchaInput | ImageCaptchaInput;

export interface SolveResult {
  token: string;
  /** Attempt number that succeeded (1-3). */
  attempt: number;
  /** Estimated cost in USD. */
  costUsd: number;
}

export class CaptchaSolverError extends Error {
  constructor(
    message: string,
    public readonly captchaType: CaptchaType,
    public readonly attemptsMade: number,
  ) {
    super(message);
    this.name = "CaptchaSolverError";
  }
}

interface TwoCaptchaSubmitResponse {
  status: number;
  request: string;
}

interface TwoCaptchaResultResponse {
  status: number;
  request: string;
}

/**
 * Submits a CAPTCHA to 2Captcha and returns the task ID.
 */
async function submitTask(
  apiKey: string,
  input: CaptchaInput,
): Promise<string> {
  let endpoint: string;
  let body: Record<string, string>;

  if (input.type === "recaptcha_v2") {
    endpoint = `${TWOCAPTCHA_BASE}/in.php`;
    body = {
      key: apiKey,
      method: "userrecaptcha",
      googlekey: input.siteKey,
      pageurl: input.pageUrl,
      json: "1",
    };
  } else if (input.type === "hcaptcha") {
    endpoint = `${TWOCAPTCHA_BASE}/in.php`;
    body = {
      key: apiKey,
      method: "hcaptcha",
      sitekey: input.siteKey,
      pageurl: input.pageUrl,
      json: "1",
    };
  } else {
    endpoint = `${TWOCAPTCHA_BASE}/in.php`;
    body = {
      key: apiKey,
      method: "base64",
      body: input.imageBase64,
      json: "1",
    };
  }

  const params = new URLSearchParams(body);
  const res = await fetch(`${endpoint}?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`2Captcha submit HTTP ${res.status}`);
  }
  const json = (await res.json()) as TwoCaptchaSubmitResponse;
  if (json.status !== 1) {
    throw new Error(`2Captcha submit error: ${json.request}`);
  }
  return json.request;
}

/**
 * Polls 2Captcha until a result is ready or the timeout expires.
 * Throws if CAPTCHA_NOT_READY within timeoutMs.
 */
async function pollResult(
  apiKey: string,
  taskId: string,
  timeoutMs: number,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    const params = new URLSearchParams({
      key: apiKey,
      action: "get",
      id: taskId,
      json: "1",
    });
    const res = await fetch(`${TWOCAPTCHA_BASE}/res.php?${params.toString()}`);
    if (!res.ok) {
      throw new Error(`2Captcha poll HTTP ${res.status}`);
    }
    const json = (await res.json()) as TwoCaptchaResultResponse;

    if (json.status === 1) {
      return json.request;
    }
    if (json.request !== "CAPCHA_NOT_READY") {
      throw new Error(`2Captcha poll error: ${json.request}`);
    }
  }

  throw new Error("2Captcha poll timeout");
}

export interface SolveOptions {
  /** Milliseconds to wait per attempt before giving up. Default: 60_000. */
  timeoutMs?: number;
  /**
   * If supplied, each attempt is logged to agent_runs.
   * Caller must supply a trusted organization_id (never from request body).
   */
  organizationId?: string;
}

/**
 * Solves a CAPTCHA using the 2Captcha service.
 *
 * Retries up to MAX_ATTEMPTS (3) times. Throws CaptchaSolverError if all
 * attempts fail so the caller can pause the session for human review.
 *
 * Reads TWOCAPTCHA_API_KEY from environment. If the key is absent the call
 * throws immediately — callers should check for the key before invoking this.
 */
export async function solveCaptcha(
  input: CaptchaInput,
  opts: SolveOptions = {},
): Promise<SolveResult> {
  const apiKey = process.env.TWOCAPTCHA_API_KEY;
  if (!apiKey) {
    throw new CaptchaSolverError(
      "TWOCAPTCHA_API_KEY not configured",
      input.type,
      0,
    );
  }

  const timeoutMs = opts.timeoutMs ?? 60_000;
  const supabase = opts.organizationId ? createAdminClient() : null;
  const costUsd = COST_PER_SOLVE[input.type];

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const startedAt = new Date().toISOString();

    try {
      const taskId = await submitTask(apiKey, input);
      const token = await pollResult(apiKey, taskId, timeoutMs);

      if (supabase && opts.organizationId) {
        const { error: dbError } = await supabase.from("agent_runs").insert({
          organization_id: opts.organizationId,
          agent_type: "automation_worker",
          status: "completed",
          started_at: startedAt,
          completed_at: new Date().toISOString(),
          input_params: {
            captcha_type: input.type,
            attempt,
            task_id: taskId,
          },
          output_summary: `CAPTCHA solved (${input.type}) on attempt ${attempt}. Cost: $${costUsd.toFixed(5)}`,
          items_found: 1,
          items_processed: 1,
          triggered_by: "captcha_solver",
        });
        if (dbError) {
          // Log failure is non-fatal; return the solved token.
        }
      }

      return { token, attempt, costUsd };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (supabase && opts.organizationId) {
        await supabase.from("agent_runs").insert({
          organization_id: opts.organizationId,
          agent_type: "automation_worker",
          status: attempt >= MAX_ATTEMPTS ? "failed" : "running",
          started_at: startedAt,
          completed_at: new Date().toISOString(),
          input_params: {
            captcha_type: input.type,
            attempt,
          },
          output_summary: `CAPTCHA solve attempt ${attempt} failed: ${lastError.message}`,
          error_message: lastError.message,
          triggered_by: "captcha_solver",
        });
      }
    }
  }

  throw new CaptchaSolverError(
    `All ${MAX_ATTEMPTS} CAPTCHA solve attempts failed. Last error: ${lastError?.message ?? "unknown"}`,
    input.type,
    MAX_ATTEMPTS,
  );
}

/**
 * Returns true if a 2Captcha API key is configured in the environment.
 * The automation worker uses this to decide whether to attempt auto-solve
 * or pause immediately for human intervention.
 */
export function isCaptchaSolverConfigured(): boolean {
  return Boolean(process.env.TWOCAPTCHA_API_KEY);
}
