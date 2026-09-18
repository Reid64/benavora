// StealthEngine — next-generation stealth scraper core (STANDING_DIRECTIVES.md
// Directive 1, enrichment source #5 "Foundation website scraper").
//
// Playwright-based, built on the same playwright-extra + puppeteer-extra
// stealth-plugin combination as src/lib/autoapply/stealth-browser.ts (which
// already handles navigator.webdriver spoofing, fake plugins, and other
// automation-flag evasions via the stealth plugin). This engine is a separate,
// self-contained core for general-purpose web scraping (contact/enrichment
// crawling) rather than AutoApply form submission — it owns its own browser
// lifecycle instead of a single launch() call per session.
//
// NOTE: the browser engine is always Chromium (playwright-extra's stealth
// plugin targets Chromium's CDP surface). The user-agent pool includes both
// Chrome and Firefox strings per spec — Firefox UAs are used for header/UA
// variety only, not to launch an actual Firefox binary.
//
// Requires a Chromium binary at runtime (npx playwright install chromium).
// Intended for local/worker processes, not Vercel serverless (no timeout
// budget for multi-page crawls with human-behavior delays).

import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import * as cheerio from "cheerio";
import UserAgent from "user-agents";
import type { UserAgentData } from "user-agents";
import type { Browser, BrowserContext, Cookie, Page, Route } from "playwright";

import { CaptchaSolver, type CaptchaDetection } from "@/lib/autoapply/captcha-solver";
import { launchChromium } from "@/lib/browser/launch-chromium";

chromium.use(StealthPlugin());

// --- user-agent pool ---------------------------------------------------------

interface UAProfile {
  userAgent: string;
  platform: string;
  screenWidth: number;
  screenHeight: number;
}

const DESKTOP_PLATFORMS = new Set(["Win32", "MacIntel", "Linux x86_64"]);

/** Fallback used only if the user-agents package's bundled dataset is empty. */
const FALLBACK_PROFILE: UAProfile = {
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  platform: "Win32",
  screenWidth: 1920,
  screenHeight: 1080,
};

/** Builds a pool of `size` real, deduplicated desktop Chrome/Firefox user agents. */
function buildUserAgentPool(size: number): UAProfile[] {
  const pool: UAProfile[] = [];
  const seen = new Set<string>();
  const candidates = UserAgent.top(2000) as unknown as UserAgentData[];

  for (const c of candidates) {
    if (!DESKTOP_PLATFORMS.has(c.platform)) continue;
    if (!/Chrome\/\d|Firefox\/\d/.test(c.userAgent)) continue;
    if (/Edg\/|OPR\//.test(c.userAgent)) continue; // exclude Edge/Opera masquerading as Chrome
    if (seen.has(c.userAgent)) continue;
    seen.add(c.userAgent);
    pool.push({
      userAgent: c.userAgent,
      platform: c.platform,
      screenWidth: c.screenWidth,
      screenHeight: c.screenHeight,
    });
    if (pool.length >= size) break;
  }

  return pool.length > 0 ? pool : [FALLBACK_PROFILE];
}

const USER_AGENT_POOL: readonly UAProfile[] = buildUserAgentPool(50);

// --- other randomization pools ------------------------------------------------

const WEBGL_GPUS: readonly { vendor: string; renderer: string }[] = [
  { vendor: "Google Inc. (NVIDIA)", renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
  { vendor: "Google Inc. (NVIDIA)", renderer: "ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)" },
  { vendor: "Google Inc. (Intel)", renderer: "ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
  { vendor: "Google Inc. (Intel)", renderer: "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)" },
  { vendor: "Google Inc. (AMD)", renderer: "ANGLE (AMD, AMD Radeon RX 580 Series Direct3D11 vs_5_0 ps_5_0, D3D11)" },
  { vendor: "Google Inc. (AMD)", renderer: "ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)" },
  { vendor: "Apple", renderer: "Apple M1" },
  { vendor: "Apple", renderer: "Apple M2" },
];

// Common real-world desktop resolutions, used for both viewport and the
// spoofed `screen` dimensions (most bots run a maximized window, so the two
// are the same size in practice).
const RESOLUTIONS: readonly { width: number; height: number }[] = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
  { width: 1280, height: 720 },
  { width: 1600, height: 900 },
];

// IANA zone ids spanning a range of UTC offsets.
const TIMEZONES: readonly { id: string; locale: string }[] = [
  { id: "America/New_York", locale: "en-US" },
  { id: "America/Chicago", locale: "en-US" },
  { id: "America/Denver", locale: "en-US" },
  { id: "America/Los_Angeles", locale: "en-US" },
  { id: "America/Phoenix", locale: "en-US" },
  { id: "America/Anchorage", locale: "en-US" },
  { id: "Europe/London", locale: "en-GB" },
  { id: "Europe/Berlin", locale: "de-DE" },
];

// --- header consistency --------------------------------------------------------
//
// A rotated User-Agent string is a lie the rest of the request has to back up:
// real Chrome sends Client Hints (Sec-Ch-Ua*) and an Accept-Encoding that lists
// zstd on recent versions; real Firefox sends neither Client Hints nor zstd.
// Mismatched headers (Chrome UA + no Sec-Ch-Ua, or vice versa) are a stronger
// bot signal than the UA string itself, so every header below is derived from
// the same uaProfile picked for the session rather than left at Chromium's
// real (and now UA-inconsistent) defaults.

type BrowserFamily = "chrome" | "firefox";

function detectBrowserFamily(userAgent: string): BrowserFamily {
  return /Firefox\/\d/.test(userAgent) ? "firefox" : "chrome";
}

function chromeMajorVersion(userAgent: string): string {
  return /Chrome\/(\d+)/.exec(userAgent)?.[1] ?? "124";
}

const PLATFORM_SEC_CH_UA: Record<string, string> = {
  Win32: '"Windows"',
  MacIntel: '"macOS"',
  "Linux x86_64": '"Linux"',
};

// Real browsers send a locale-specific Accept-Language, not a bare locale tag.
const ACCEPT_LANGUAGE_BY_LOCALE: Record<string, string> = {
  "en-US": "en-US,en;q=0.9",
  "en-GB": "en-GB,en;q=0.9",
  "de-DE": "de-DE,de;q=0.9,en;q=0.8",
};

/** Builds the header set a real browser matching `uaProfile` would send, for `context.newContext({ extraHTTPHeaders })`. */
function buildConsistentHeaders(uaProfile: UAProfile, locale: string): Record<string, string> {
  const family = detectBrowserFamily(uaProfile.userAgent);
  const acceptLanguage = ACCEPT_LANGUAGE_BY_LOCALE[locale] ?? "en-US,en;q=0.9";

  if (family === "firefox") {
    // Real Firefox never sends Client Hints — omitting Sec-Ch-Ua* entirely is
    // the consistent choice, not sending Chromium's real (Chrome-branded) ones.
    return {
      "Accept-Language": acceptLanguage,
      "Accept-Encoding": "gzip, deflate, br",
    };
  }

  const major = chromeMajorVersion(uaProfile.userAgent);
  const platform = PLATFORM_SEC_CH_UA[uaProfile.platform] ?? '"Windows"';

  return {
    "Accept-Language": acceptLanguage,
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Sec-Ch-Ua": `"Not.A/Brand";v="8", "Chromium";v="${major}", "Google Chrome";v="${major}"`,
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": platform,
  };
}

// --- small helpers -------------------------------------------------------------

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Optional ScraperAPI proxy URL, resolved from SCRAPER_API_KEY when no explicit proxy is given. */
function resolveProxy(explicit?: string): string | undefined {
  if (explicit) return explicit;
  const key = process.env["SCRAPER_API_KEY"];
  if (!key) return undefined;
  return `http://scraperapi:${key}@proxy-server.scraperapi.com:8001`;
}

/**
 * Init script (runs before any page script) that randomizes canvas, WebGL,
 * AudioContext, navigator, and screen fingerprints for the session. Authored
 * as a string so it isn't type-checked against the Node environment.
 */
function buildInitScript(cfg: {
  webglVendor: string;
  webglRenderer: string;
  hardwareConcurrency: number;
  deviceMemory: number;
  platform: string;
  screenWidth: number;
  screenHeight: number;
}): string {
  return `(() => {
  const def = (obj, prop, val) => { try { Object.defineProperty(obj, prop, { get: () => val, configurable: true }); } catch (e) {} };

  def(navigator, 'hardwareConcurrency', ${cfg.hardwareConcurrency});
  def(navigator, 'deviceMemory', ${cfg.deviceMemory});
  def(navigator, 'platform', ${JSON.stringify(cfg.platform)});

  def(screen, 'width', ${cfg.screenWidth});
  def(screen, 'height', ${cfg.screenHeight});
  def(screen, 'availWidth', ${cfg.screenWidth});
  def(screen, 'availHeight', ${cfg.screenHeight});

  // Canvas fingerprint: subtle, per-session noise on read-back.
  const noiseSeed = Math.floor(Math.random() * 8) + 1;
  const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function (...args) {
    try {
      const ctx = this.getContext('2d');
      if (ctx && this.width > 0 && this.height > 0) {
        const img = ctx.getImageData(0, 0, this.width, this.height);
        for (let i = 0; i < img.data.length; i += 4) {
          img.data[i] = img.data[i] ^ ((i / 4 + noiseSeed) & 1);
        }
        ctx.putImageData(img, 0, 0);
      }
    } catch (e) {}
    return origToDataURL.apply(this, args);
  };

  // WebGL vendor/renderer spoofing.
  const VENDOR = 37445, RENDERER = 37446;
  const patchGL = (proto) => {
    if (!proto) return;
    const orig = proto.getParameter;
    proto.getParameter = function (p) {
      if (p === VENDOR) return ${JSON.stringify(cfg.webglVendor)};
      if (p === RENDERER) return ${JSON.stringify(cfg.webglRenderer)};
      return orig.call(this, p);
    };
  };
  patchGL(typeof WebGLRenderingContext !== 'undefined' ? WebGLRenderingContext.prototype : null);
  patchGL(typeof WebGL2RenderingContext !== 'undefined' ? WebGL2RenderingContext.prototype : null);

  // AudioContext fingerprint noise on channel read-back.
  try {
    const origGetChannelData = AudioBuffer.prototype.getChannelData;
    AudioBuffer.prototype.getChannelData = function (channel) {
      const data = origGetChannelData.call(this, channel);
      for (let i = 0; i < data.length; i += 200) {
        data[i] = data[i] + (Math.random() - 0.5) * 1e-7;
      }
      return data;
    };
  } catch (e) {}
})();`;
}

const BLOCKED_RESOURCE_TYPES = new Set(["image", "font", "media", "stylesheet"]);

async function blockHeavyResources(route: Route): Promise<void> {
  if (BLOCKED_RESOURCE_TYPES.has(route.request().resourceType())) {
    await route.abort();
  } else {
    await route.continue();
  }
}

// --- contact extraction helpers -------------------------------------------------

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_REGEX = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
const JUNK_EMAIL_PREFIXES = ["noreply@", "no-reply@", "donotreply@", "webmaster@", "admin@", "support@"];
const CONTACT_PATH_PATTERNS = ["contact", "about-us", "about", "connect", "get-in-touch", "reach-us"];

// --- response verification ------------------------------------------------------
//
// A 200 OK is not proof of a real page: interstitials (CAPTCHA challenges,
// WAF block pages, "enable JavaScript" notices) routinely return 200 with a
// tiny, marker-laden body. Treating that as success would poison downstream
// extraction with empty/garbage results instead of retrying like a genuine
// block. detectCaptcha() already covers structured CAPTCHA challenges; this
// catches the plain-text block pages that slip past it.
const MIN_PLAUSIBLE_HTML_LENGTH = 500;
const BLOCK_PAGE_MARKERS = [
  "verify you are human",
  "access denied",
  "are you a robot",
  "unusual traffic",
  "checking your browser before accessing",
  "enable javascript and cookies to continue",
  "attention required",
  "request blocked",
  "pardon our interruption",
];

function isPlausibleResponse(html: string): boolean {
  if (html.trim().length < MIN_PLAUSIBLE_HTML_LENGTH) return false;
  const lower = html.toLowerCase();
  return !BLOCK_PAGE_MARKERS.some((marker) => lower.includes(marker));
}

// --- public types -----------------------------------------------------------

export interface StealthEngineOptions {
  /** Launch headless. Default true. */
  headless?: boolean;
  /** Explicit proxy server URL. Falls back to SCRAPER_API_KEY (ScraperAPI) if unset. */
  proxy?: string;
  /** Max fetch attempts per page before giving up. Default 3. */
  maxRetries?: number;
}

// --- StealthEngine ------------------------------------------------------------

export class StealthEngine {
  private readonly headless: boolean;
  private readonly proxy: string | undefined;
  private readonly maxRetries: number;
  private readonly captchaSolver = new CaptchaSolver();

  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private viewport: { width: number; height: number } | null = null;

  /**
   * Cookie jar carried across identity rotations within one StealthEngine
   * run — teardownBrowser()/launchContext() replace the browser/context on
   * every rotateAndWait() (retry after a 403/429/CAPTCHA), which would
   * otherwise silently drop any session/clearance cookies (e.g. a solved
   * CAPTCHA's clearance cookie) the prior context had already earned.
   */
  private cookieJar: Cookie[] = [];

  /**
   * Set when a fetchPage() call ultimately fails because a CAPTCHA challenge
   * could not be resolved (all retries exhausted) — lets callers (e.g. a
   * Strategy 2 circuit breaker) tell "blocked by CAPTCHA" apart from other
   * failure modes without StealthEngine attempting to solve/bypass anything
   * itself beyond its existing optional 2Captcha integration.
   */
  private captchaBlockedLastFetch = false;

  constructor(options: StealthEngineOptions = {}) {
    this.headless = options.headless ?? true;
    this.proxy = resolveProxy(options.proxy);
    this.maxRetries = options.maxRetries ?? 3;
  }

  /** Launches the browser with full stealth config. Call once before fetchPage(). */
  async init(): Promise<void> {
    await this.launchContext();
  }

  private async launchContext(): Promise<void> {
    await this.teardownBrowser();

    const uaProfile = pick(USER_AGENT_POOL);
    const gpu = pick(WEBGL_GPUS);
    const resolution = pick(RESOLUTIONS);
    const tz = pick(TIMEZONES);
    const hardwareConcurrency = randInt(4, 16);
    const deviceMemory = pick([4, 8, 16] as const);

    const launchArgs: Parameters<typeof chromium.launch>[0] = {
      headless: this.headless,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-dev-shm-usage",
      ],
    };
    if (this.proxy) {
      launchArgs.proxy = { server: this.proxy };
    }

    const browser = await launchChromium(chromium, launchArgs);
    const context = await browser.newContext({
      userAgent: uaProfile.userAgent,
      viewport: resolution,
      locale: tz.locale,
      timezoneId: tz.id,
      deviceScaleFactor: 1,
      extraHTTPHeaders: buildConsistentHeaders(uaProfile, tz.locale),
    });

    if (this.cookieJar.length > 0) {
      await context.addCookies(this.cookieJar);
    }

    await context.addInitScript({
      content: buildInitScript({
        webglVendor: gpu.vendor,
        webglRenderer: gpu.renderer,
        hardwareConcurrency,
        deviceMemory,
        platform: uaProfile.platform,
        screenWidth: resolution.width,
        screenHeight: resolution.height,
      }),
    });

    await context.route("**/*", (route) => void blockHeavyResources(route));

    const page = await context.newPage();

    this.browser = browser;
    this.context = context;
    this.page = page;
    this.viewport = resolution;
  }

  private async teardownBrowser(): Promise<void> {
    if (this.context) {
      this.cookieJar = await this.context.cookies().catch(() => this.cookieJar);
      await this.context.close().catch(() => {});
    }
    if (this.browser) {
      await this.browser.close().catch(() => {});
    }
    this.browser = null;
    this.context = null;
    this.page = null;
    this.viewport = null;
  }

  /** Rotates UA/fingerprint/proxy session by relaunching, then waits 5-15s. */
  private async rotateAndWait(): Promise<void> {
    await sleep(randInt(5_000, 15_000));
    await this.launchContext();
  }

  private async handleCaptcha(detection: CaptchaDetection): Promise<boolean> {
    if (!process.env["TWOCAPTCHA_API_KEY"]) {
      console.warn(`[StealthEngine] CAPTCHA detected (${detection.type}) — no TWOCAPTCHA_API_KEY configured, skipping page`);
      return false;
    }
    const token = await this.captchaSolver.solveCaptcha(detection, this.page);
    if (!token) {
      console.warn(`[StealthEngine] CAPTCHA solve failed (${detection.type})`);
      return false;
    }
    await this.captchaSolver.injectSolution(this.page, detection, token);
    return true;
  }

  private async humanMouseMove(): Promise<void> {
    if (!this.page || !this.viewport) return;
    const moves = randInt(3, 7);
    for (let i = 0; i < moves; i++) {
      const x = randInt(0, this.viewport.width);
      const y = randInt(0, this.viewport.height);
      await this.page.mouse.move(x, y, { steps: randInt(5, 15) });
      await sleep(randInt(100, 400));
    }
  }

  private async humanScroll(): Promise<void> {
    if (!this.page) return;
    const scrolls = randInt(2, 5);
    for (let i = 0; i < scrolls; i++) {
      await this.page.mouse.wheel(0, randInt(150, 600));
      await sleep(randInt(150, 500));
    }
  }

  private async simulateHumanBehavior(): Promise<void> {
    await this.humanMouseMove();
    await sleep(randInt(800, 3_000));
    await this.humanScroll();
    await sleep(randInt(800, 3_000));
  }

  /**
   * Fetches `url` with full stealth: human-like mouse/scroll/delay, CAPTCHA
   * detection + optional solve, and retry-with-rotation on 403/429/CAPTCHA.
   * Returns the rendered page HTML, or null if all retries are exhausted.
   */
  async fetchPage(url: string): Promise<string | null> {
    if (!this.page) {
      throw new Error("StealthEngine not initialized — call init() first");
    }
    this.captchaBlockedLastFetch = false;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const page = this.page;
        if (!page) throw new Error("StealthEngine page unavailable");

        const response = await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });
        const status = response?.status() ?? 0;

        if (status === 403 || status === 429) {
          console.warn(`[StealthEngine] blocked (HTTP ${status}) on attempt ${attempt}/${this.maxRetries}: ${url}`);
          if (attempt < this.maxRetries) {
            await this.rotateAndWait();
            continue;
          }
          return null;
        }

        const captcha = await this.captchaSolver.detectCaptcha(page);
        if (captcha) {
          const solved = await this.handleCaptcha(captcha);
          if (!solved) {
            if (attempt < this.maxRetries) {
              await this.rotateAndWait();
              continue;
            }
            console.warn(`[StealthEngine] CAPTCHA unresolved after ${this.maxRetries} attempts, skipping: ${url}`);
            this.captchaBlockedLastFetch = true;
            return null;
          }
        }

        await this.simulateHumanBehavior();
        const html = await this.page.content();

        if (!isPlausibleResponse(html)) {
          console.warn(
            `[StealthEngine] soft failure (implausible/block-page response) on attempt ${attempt}/${this.maxRetries}: ${url}`,
          );
          if (attempt < this.maxRetries) {
            await this.rotateAndWait();
            continue;
          }
          return null;
        }

        return html;
      } catch (err) {
        console.warn(
          `[StealthEngine] fetch failed on attempt ${attempt}/${this.maxRetries} for ${url}: ${(err as Error).message}`,
        );
        if (attempt < this.maxRetries) {
          await this.rotateAndWait();
          continue;
        }
        return null;
      }
    }

    return null;
  }

  /** Whether the most recent fetchPage() call ultimately failed because a CAPTCHA challenge went unresolved (all retries exhausted). */
  wasCaptchaBlocked(): boolean {
    return this.captchaBlockedLastFetch;
  }

  /**
   * Fetches `url` via the current browser context's request API — sharing
   * the same cookies, proxy, and extraHTTPHeaders as fetchPage() — instead of
   * navigating a page. Use for responses a browser won't render inline (e.g.
   * a CSV served as `Content-Disposition: attachment`, which turns
   * page.goto() into a file download and breaks navigation). Returns the raw
   * response body text, or null on a non-2xx status or request failure.
   */
  async fetchRaw(url: string): Promise<string | null> {
    if (!this.context) {
      throw new Error("StealthEngine not initialized — call init() first");
    }
    try {
      const response = await this.context.request.get(url, { timeout: 30_000 });
      if (!response.ok()) {
        console.warn(`[StealthEngine] fetchRaw non-OK status (${response.status()}): ${url}`);
        return null;
      }
      return await response.text();
    } catch (err) {
      console.warn(`[StealthEngine] fetchRaw failed for ${url}: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Like fetchRaw(), but for binary content (e.g. a ZIP archive) —
   * fetchRaw()'s response.text() decodes the body as UTF-8, which corrupts
   * binary bytes. Returns the raw response body as a Buffer, or null on a
   * non-2xx status or request failure. Uses a longer timeout than fetchRaw()
   * since the archives this is used for run tens of megabytes.
   */
  async fetchRawBuffer(url: string): Promise<Buffer | null> {
    if (!this.context) {
      throw new Error("StealthEngine not initialized — call init() first");
    }
    try {
      const response = await this.context.request.get(url, { timeout: 60_000 });
      if (!response.ok()) {
        console.warn(`[StealthEngine] fetchRawBuffer non-OK status (${response.status()}): ${url}`);
        return null;
      }
      return await response.body();
    } catch (err) {
      console.warn(`[StealthEngine] fetchRawBuffer failed for ${url}: ${(err as Error).message}`);
      return null;
    }
  }

  /** Extracts and dedupes email addresses from HTML, filtering junk mailbox prefixes. */
  async extractEmails(html: string): Promise<string[]> {
    const $ = cheerio.load(html);
    const text = $("body").text() || html;
    const found = text.match(EMAIL_REGEX) ?? [];
    const unique = [...new Set(found.map((e) => e.toLowerCase()))];
    return unique.filter((e) => !JUNK_EMAIL_PREFIXES.some((prefix) => e.startsWith(prefix)));
  }

  /** Extracts the first US-format phone number found in HTML, or null. */
  async extractPhone(html: string): Promise<string | null> {
    const $ = cheerio.load(html);
    const text = $("body").text() || html;
    const found = text.match(PHONE_REGEX);
    return found && found.length > 0 ? (found[0] as string).trim() : null;
  }

  /**
   * Reads the live, rendered DOM (not the static HTML string) for `a[href]`
   * elements a real visitor could actually see — computed `display`/
   * `visibility` plus a non-zero bounding box — so a hidden honeypot link
   * planted only to bait naive scrapers never becomes a click/extraction
   * candidate. Returns null (meaning "couldn't determine, don't filter")
   * rather than an empty set on any evaluation failure, so a transient DOM
   * read error can't silently zero out every real candidate.
   */
  private async getVisibleAnchorHrefs(): Promise<Set<string> | null> {
    if (!this.page) return null;
    try {
      const hrefs = await this.page.$$eval("a[href]", (elements) =>
        elements
          .filter((el) => {
            const style = window.getComputedStyle(el);
            if (style.display === "none" || style.visibility === "hidden") return false;
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          })
          .map((el) => (el as HTMLAnchorElement).href),
      );
      return new Set(hrefs);
    } catch {
      return null;
    }
  }

  /** Fetches `baseUrl` and returns the first same-origin /contact or /about link found, or null. */
  async findContactPage(baseUrl: string): Promise<string | null> {
    const html = await this.fetchPage(baseUrl);
    if (!html) return null;

    let origin: string;
    try {
      origin = new URL(baseUrl).origin;
    } catch {
      return null;
    }

    // fetchPage() left `this.page` navigated to baseUrl — read its visible
    // links before the static-HTML pass below considers any candidates.
    const visibleHrefs = await this.getVisibleAnchorHrefs();

    const $ = cheerio.load(html);
    const candidates: string[] = [];
    $("a[href]").each((_i, el) => {
      const href = $(el).attr("href") ?? "";
      const lower = href.toLowerCase();
      if (CONTACT_PATH_PATTERNS.some((p) => lower.includes(p))) {
        try {
          const abs = new URL(href, origin).href;
          if (abs.startsWith(origin) && (visibleHrefs === null || visibleHrefs.has(abs))) {
            candidates.push(abs);
          }
        } catch {
          // ignore malformed hrefs
        }
      }
    });

    if (candidates.length === 0) return null;
    const contactFirst = candidates.find((c) => c.toLowerCase().includes("contact"));
    return contactFirst ?? (candidates[0] as string);
  }

  /** Closes the browser and releases all resources. */
  async close(): Promise<void> {
    await this.teardownBrowser();
  }
}
