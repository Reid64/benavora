// UniversalFetcher — fetch layer for the Universal Scraper
// (UNIVERSAL_SCRAPER_PRD.md §3.2).
//
// Engine choice: Playwright + playwright-extra + puppeteer-extra-plugin-stealth
// — the SAME verified-working base as src/lib/scraper/stealth-engine.ts —
// NOT camoufox-js. camoufox-js was installed and smoke-tested in uscraper-002
// (scripts/test-camoufox-launch.ts) and found NON-FUNCTIONAL on this machine:
// it segfaults inside better-sqlite3's native binary on Node 20 (camoufox-js
// declares "engines": {"node": ">=22"}). Full bisection is recorded in
// STATE_OF_THE_BUILD.md's July 28 2026 "elite stealth stack" session entry.
//
// This class assembles the confirmed-working fallback stack from that same
// session:
//   - Playwright/Chromium + puppeteer-extra-plugin-stealth  — browser engine.
//   - rebrowser-patches — patches playwright-core's CDP fingerprint on disk
//     (`node_modules/.bin/rebrowser-patches patch --packageName
//     playwright-core`). It is a source patcher, not a runtime API — there is
//     nothing to import here; its effect is baked into playwright-core once
//     applied, so this file has no rebrowser-patches import.
//   - fingerprint-generator — internally-consistent UA/header/screen/WebGL
//     fingerprint generation (confirmed working standalone in uscraper-002).
//   - ghost-cursor's `path()` — pure-JS bezier path generation for
//     human-like mouse movement, driven through Playwright's own
//     `page.mouse.move()`. ghost-cursor's `GhostCursor` class is typed
//     against puppeteer's `Page`, not Playwright's `Page`; using its
//     path-math export directly gets the real algorithm without a
//     cross-library structural-type mismatch.
//   - Crawlee's `SessionPool` — replaces stealth-engine.ts's hand-rolled
//     cookieJar + retry-with-rotation loop. Each attempt pulls a `Session`
//     from the pool, seeds/persists its cookies, and is marked
//     good/bad/blocked from the real response, so a blocked session is never
//     handed to the next attempt.

import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { SessionPool, type Session } from "crawlee";
import { FingerprintGenerator, type Fingerprint } from "fingerprint-generator";
import { path as ghostCursorPath } from "ghost-cursor";
import type { Browser, BrowserContext, Page } from "playwright";

chromium.use(StealthPlugin());

// A 200 status is not proof of a real page — interstitials (CAPTCHA walls,
// WAF block pages) routinely return 200 with a short, marker-laden body.
// This is a lightweight check, not the full extraction/quality pass (that is
// the Extraction Layer, PRD §3.3, out of scope for the fetch layer).
const MIN_PLAUSIBLE_HTML_LENGTH = 300;
const BLOCK_PAGE_MARKERS = [
  "verify you are human",
  "access denied",
  "are you a robot",
  "unusual traffic",
  "checking your browser before accessing",
  "attention required",
  "request blocked",
];

function looksBlocked(html: string): boolean {
  if (html.trim().length < MIN_PLAUSIBLE_HTML_LENGTH) return true;
  const lower = html.toLowerCase();
  return BLOCK_PAGE_MARKERS.some((marker) => lower.includes(marker));
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Init script that applies a real fingerprint-generator sample's WebGL/hardware values. */
function buildFingerprintInitScript(fp: Fingerprint): string {
  return `(() => {
  const def = (obj, prop, val) => { try { Object.defineProperty(obj, prop, { get: () => val, configurable: true }); } catch (e) {} };

  def(navigator, 'hardwareConcurrency', ${JSON.stringify(fp.navigator.hardwareConcurrency)});
  ${fp.navigator.deviceMemory !== undefined ? `def(navigator, 'deviceMemory', ${JSON.stringify(fp.navigator.deviceMemory)});` : ""}
  def(navigator, 'platform', ${JSON.stringify(fp.navigator.platform)});

  const VENDOR = 37445, RENDERER = 37446;
  const patchGL = (proto) => {
    if (!proto) return;
    const orig = proto.getParameter;
    proto.getParameter = function (p) {
      if (p === VENDOR) return ${JSON.stringify(fp.videoCard.vendor)};
      if (p === RENDERER) return ${JSON.stringify(fp.videoCard.renderer)};
      return orig.call(this, p);
    };
  };
  patchGL(typeof WebGLRenderingContext !== 'undefined' ? WebGLRenderingContext.prototype : null);
  patchGL(typeof WebGL2RenderingContext !== 'undefined' ? WebGL2RenderingContext.prototype : null);
})();`;
}

/** Moves the mouse along a real ghost-cursor bezier path between two random on-screen points. */
async function simulateHumanCursor(page: Page): Promise<void> {
  const viewport = page.viewportSize();
  if (!viewport) return;
  const start = { x: randInt(0, viewport.width), y: randInt(0, viewport.height) };
  const end = { x: randInt(0, viewport.width), y: randInt(0, viewport.height) };
  const points = ghostCursorPath(start, end);
  for (const point of points) {
    await page.mouse.move(point.x, point.y);
  }
}

export interface UniversalFetchResult {
  url: string;
  html: string | null;
  status: number | null;
  success: boolean;
  attempts: number;
  /** Diagnostic — the real error/skip reason from the final attempt, or null on success. Never silently swallowed: also console.error'd as it happens. */
  fetchError: string | null;
  contentLength: number;
  fetchedAt: string;
}

export interface UniversalFetcherOptions {
  /** Launch headless. Default true. */
  headless?: boolean;
  /** Max fetch attempts per page, each on a fresh session, before giving up. Default 3. */
  maxRetries?: number;
  /** Max concurrent sessions tracked by the underlying Crawlee SessionPool. Default 20. */
  maxPoolSize?: number;
}

export class UniversalFetcher {
  private readonly headless: boolean;
  private readonly maxRetries: number;
  private readonly maxPoolSize: number;
  private readonly fingerprintGenerator = new FingerprintGenerator({
    browsers: ["chrome", "firefox"],
    devices: ["desktop"],
    operatingSystems: ["windows", "macos"],
  });

  private browser: Browser | null = null;
  private sessionPool: SessionPool | null = null;

  /** Diagnostic pattern per uscraper-002: the real error from the most recent fetchPage() call, never silently swallowed. */
  private lastFetchError: string | null = null;

  constructor(options: UniversalFetcherOptions = {}) {
    this.headless = options.headless ?? true;
    this.maxRetries = options.maxRetries ?? 3;
    this.maxPoolSize = options.maxPoolSize ?? 20;
  }

  /** Launches the shared browser and opens the Crawlee SessionPool. Call once before fetchPage(). */
  async init(): Promise<void> {
    this.browser = await chromium.launch({
      headless: this.headless,
      args: ["--disable-blink-features=AutomationControlled", "--no-sandbox", "--disable-dev-shm-usage"],
    });
    this.sessionPool = await SessionPool.open({
      maxPoolSize: this.maxPoolSize,
      blockedStatusCodes: [401, 403, 429],
      sessionOptions: {
        maxErrorScore: 3,
        maxUsageCount: 30,
      },
    });
  }

  private requireInitialized(): { browser: Browser; sessionPool: SessionPool } {
    if (!this.browser || !this.sessionPool) {
      throw new Error("UniversalFetcher not initialized — call init() first");
    }
    return { browser: this.browser, sessionPool: this.sessionPool };
  }

  private async openContextForSession(browser: Browser, session: Session, url: string): Promise<BrowserContext> {
    const { headers, fingerprint } = this.fingerprintGenerator.getFingerprint();

    const context = await browser.newContext({
      userAgent: fingerprint.navigator.userAgent,
      viewport: { width: fingerprint.screen.width, height: fingerprint.screen.height },
      locale: fingerprint.navigator.language,
      deviceScaleFactor: fingerprint.screen.devicePixelRatio || 1,
      extraHTTPHeaders: headers,
    });

    await context.addInitScript({ content: buildFingerprintInitScript(fingerprint) });

    const sessionCookies = session.getCookies(url);
    if (sessionCookies.length > 0) {
      await context.addCookies(sessionCookies as Parameters<BrowserContext["addCookies"]>[0]);
    }

    return context;
  }

  /**
   * Fetches `url` using a fresh fingerprinted context per attempt, backed by
   * a Crawlee Session for cookie persistence and blocked/retired tracking.
   * Never throws — real errors are logged via console.error and returned in
   * `fetchError` on the result (the last_fetch_error diagnostic pattern) so
   * a failed batch is never silent.
   */
  async fetchPage(url: string): Promise<UniversalFetchResult> {
    const { browser, sessionPool } = this.requireInitialized();
    this.lastFetchError = null;

    let lastStatus: number | null = null;
    let attempt = 0;

    for (attempt = 1; attempt <= this.maxRetries; attempt++) {
      const session = await sessionPool.getSession();
      let context: BrowserContext | null = null;

      try {
        context = await this.openContextForSession(browser, session, url);
        const page = await context.newPage();

        const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
        const status = response?.status() ?? null;
        lastStatus = status;

        if (status !== null && session.retireOnBlockedStatusCodes(status)) {
          const message = `blocked status ${status} on attempt ${attempt}/${this.maxRetries}`;
          this.lastFetchError = message;
          console.error(`[UniversalFetcher] ${message}: ${url}`);
          await context.close();
          continue;
        }

        await simulateHumanCursor(page);

        const html = await page.content();
        session.setCookies(await context.cookies(), url);
        await context.close();

        if (looksBlocked(html)) {
          session.markBad();
          const message = `implausible/block-page response on attempt ${attempt}/${this.maxRetries} (${html.length} chars)`;
          this.lastFetchError = message;
          console.error(`[UniversalFetcher] ${message}: ${url}`);
          continue;
        }

        session.markGood();
        return {
          url,
          html,
          status,
          success: true,
          attempts: attempt,
          fetchError: null,
          contentLength: html.length,
          fetchedAt: new Date().toISOString(),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.lastFetchError = message;
        session.markBad();
        console.error(`[UniversalFetcher] fetch failed on attempt ${attempt}/${this.maxRetries} for ${url}: ${message}`);
        if (context) await context.close().catch(() => {});
      }
    }

    return {
      url,
      html: null,
      status: lastStatus,
      success: false,
      attempts: attempt - 1,
      fetchError: this.lastFetchError,
      contentLength: 0,
      fetchedAt: new Date().toISOString(),
    };
  }

  /** The real error/skip reason from the most recent fetchPage() call, or null if it succeeded. */
  getLastFetchError(): string | null {
    return this.lastFetchError;
  }

  /** Closes the shared browser and tears down the session pool. */
  async close(): Promise<void> {
    await this.browser?.close().catch(() => {});
    await this.sessionPool?.teardown().catch(() => {});
    this.browser = null;
    this.sessionPool = null;
  }
}
