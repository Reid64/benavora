// BrowserEngine - Playwright lifecycle manager for Phase 3 browser automation
// (AGENTS.md Agent 16, BEHAVIORAL_CONTRACTS §18).
//
// One BrowserEngine drives one automation session: it launches Chromium, owns a
// single browsing context + page, navigates with a bounded timeout, captures
// screenshots and stores them in Supabase Storage, persists cookies/session for
// portal logins, recovers from page crashes by capturing an error screenshot,
// and always shuts the browser down cleanly on completion or error.
//
// Storage layout (BEHAVIORAL_CONTRACTS §18, Document Contracts §7): one bucket
// per organization, `org-{organization_id}`; automation screenshots live under
// `automation/{session_id}/{label}.png` inside it.
//
// This class does NOT submit forms and has no knowledge of form structure - it
// is the transport layer. Detection lives in form-detector.ts, filling in
// form-filler.ts, and DB bookkeeping in session-manager.ts.

import type {
  Browser,
  BrowserContext,
  Page,
  LaunchOptions,
} from "playwright";
import { chromium } from "playwright";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ScreenshotCapture } from "@/types/automation";

/** Default per-navigation timeout (task spec: 30 seconds). */
export const NAVIGATION_TIMEOUT_MS = 30_000;

/** Storage bucket for an organization's files (Document Contracts §7). */
export function orgBucket(organizationId: string): string {
  return `org-${organizationId}`;
}

/**
 * Opaque cookie/session snapshot for portal logins. This is Playwright's
 * `storageState` shape; kept as `unknown` so callers persist it verbatim
 * (e.g. to automation_sessions.notes or an integration record) without coupling
 * to Playwright's type.
 */
export type SessionState = unknown;

export interface BrowserEngineOptions {
  /** Supabase client used to upload/download files. Service role for agents. */
  client: SupabaseClient;
  /** Tenant scope - determines the storage bucket and path prefix. */
  organizationId: string;
  /** Session this engine serves - namespaces screenshot paths. */
  sessionId: string;
  /** Run headless. Defaults to true; set false for debugging/visible runs. */
  headless?: boolean;
  /** Per-navigation timeout in ms. Defaults to {@link NAVIGATION_TIMEOUT_MS}. */
  navigationTimeoutMs?: number;
  /** Restore a prior cookie/session snapshot (portal login persistence). */
  sessionState?: SessionState;
}

/** Raised for engine-level failures (not launched, navigation failed, etc.). */
export class BrowserEngineError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "BrowserEngineError";
    this.code = code;
  }
}

export class BrowserEngine {
  private readonly client: SupabaseClient;
  private readonly organizationId: string;
  private readonly sessionId: string;
  private readonly headless: boolean;
  private readonly navigationTimeoutMs: number;
  private readonly initialSessionState: SessionState | undefined;

  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private activePage: Page | null = null;

  constructor(options: BrowserEngineOptions) {
    this.client = options.client;
    this.organizationId = options.organizationId;
    this.sessionId = options.sessionId;
    this.headless = options.headless ?? true;
    this.navigationTimeoutMs =
      options.navigationTimeoutMs ?? NAVIGATION_TIMEOUT_MS;
    this.initialSessionState = options.sessionState ?? undefined;
  }

  // --- lifecycle -------------------------------------------------------------

  /**
   * Launch Chromium and open a fresh context + page. Restores a prior
   * cookie/session snapshot when one was supplied. Idempotent: a second call
   * while already launched is a no-op.
   */
  async launch(): Promise<void> {
    if (this.browser) return;

    const launchOptions: LaunchOptions = { headless: this.headless };
    try {
      this.browser = await chromium.launch(launchOptions);
      this.context = await this.browser.newContext(
        this.initialSessionState !== undefined
          ? { storageState: this.initialSessionState as never }
          : undefined,
      );
      this.context.setDefaultNavigationTimeout(this.navigationTimeoutMs);
      this.activePage = await this.context.newPage();
    } catch (err) {
      // Never leak a half-open browser on a failed launch.
      await this.close();
      throw new BrowserEngineError(
        `Failed to launch browser: ${errorMessage(err)}`,
        "launch_failed",
      );
    }
  }

  /** The live page. Throws if {@link launch} has not run. */
  get page(): Page {
    if (!this.activePage) {
      throw new BrowserEngineError(
        "Browser not launched. Call launch() first.",
        "not_launched",
      );
    }
    return this.activePage;
  }

  /** URL of the current page, or null before any navigation. */
  currentUrl(): string | null {
    const url = this.activePage?.url() ?? "";
    return url === "" || url === "about:blank" ? null : url;
  }

  /**
   * Navigate to `url`, waiting for the DOM to be ready, bounded by the
   * navigation timeout. On failure, attempts to capture an error screenshot for
   * debugging, then throws so the caller can fail the step.
   */
  async navigate(url: string): Promise<void> {
    const page = this.page;
    try {
      await page.goto(url, {
        timeout: this.navigationTimeoutMs,
        waitUntil: "domcontentloaded",
      });
    } catch (err) {
      await this.captureErrorScreenshot("navigate-error").catch(() => {
        /* best-effort - never mask the navigation failure */
      });
      throw new BrowserEngineError(
        `Navigation to ${url} failed: ${errorMessage(err)}`,
        "navigation_failed",
      );
    }
  }

  // --- screenshots -----------------------------------------------------------

  /**
   * Capture a full-page PNG and upload it to Supabase Storage at
   * `automation/{sessionId}/{label}.png` inside the org bucket. Returns the
   * stored path and the page URL so the caller can persist a screenshot record.
   * Recovers from a crashed page by retrying with a viewport-only shot.
   */
  async screenshot(
    label: string,
    options: { fullPage?: boolean } = {},
  ): Promise<ScreenshotCapture> {
    const page = this.page;
    const safeLabel = sanitizeLabel(label);
    const storagePath = `automation/${this.sessionId}/${safeLabel}.png`;

    let buffer: Buffer;
    try {
      buffer = await page.screenshot({ fullPage: options.fullPage ?? true });
    } catch {
      // Full-page capture can fail on a crashed/oversized page; fall back to the
      // current viewport so we still get something useful for review.
      buffer = await page.screenshot({ fullPage: false });
    }

    await this.uploadPng(storagePath, buffer);

    return {
      storagePath,
      pageUrl: this.currentUrl(),
      label: safeLabel,
    };
  }

  /**
   * Capture an error screenshot for the failing step. Best-effort: if the page
   * itself is unusable, returns null rather than throwing over the original
   * error.
   */
  async captureErrorScreenshot(
    label = "error",
  ): Promise<ScreenshotCapture | null> {
    try {
      return await this.screenshot(`${label}`, { fullPage: false });
    } catch {
      return null;
    }
  }

  // --- session persistence ---------------------------------------------------

  /**
   * Export the current cookie/session snapshot (portal logins) so it can be
   * stored and replayed in a later session via {@link BrowserEngineOptions}.
   */
  async exportSessionState(): Promise<SessionState> {
    if (!this.context) {
      throw new BrowserEngineError(
        "Browser not launched. Call launch() first.",
        "not_launched",
      );
    }
    return this.context.storageState();
  }

  // --- storage helpers -------------------------------------------------------

  /** Upload a PNG buffer to the org bucket, overwriting any prior capture. */
  private async uploadPng(storagePath: string, buffer: Buffer): Promise<void> {
    const { error } = await this.client.storage
      .from(orgBucket(this.organizationId))
      .upload(storagePath, buffer, {
        contentType: "image/png",
        upsert: true,
      });
    if (error) {
      throw new BrowserEngineError(
        `Failed to store screenshot at ${storagePath}: ${error.message}`,
        "screenshot_upload_failed",
      );
    }
  }

  /**
   * Download a file from the org bucket as a Buffer. Used by the form filler to
   * fetch an application document before uploading it into a file input.
   */
  async downloadFile(storagePath: string): Promise<Buffer> {
    const { data, error } = await this.client.storage
      .from(orgBucket(this.organizationId))
      .download(storagePath);
    if (error || !data) {
      throw new BrowserEngineError(
        `Failed to download ${storagePath}: ${
          error?.message ?? "no data returned"
        }`,
        "download_failed",
      );
    }
    const arrayBuffer = await data.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  // --- shutdown --------------------------------------------------------------

  /**
   * Close the page, context, and browser. Safe to call multiple times and from
   * a `finally` even if launch partially failed. Swallows close errors - a
   * shutdown problem must never mask the real outcome of the run.
   */
  async close(): Promise<void> {
    try {
      await this.context?.close();
    } catch {
      /* ignore */
    }
    try {
      await this.browser?.close();
    } catch {
      /* ignore */
    } finally {
      this.activePage = null;
      this.context = null;
      this.browser = null;
    }
  }
}

// --- helpers -----------------------------------------------------------------

/** Make a label safe for use as a storage filename segment. */
function sanitizeLabel(label: string): string {
  const cleaned = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned === "" ? "screenshot" : cleaned;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
