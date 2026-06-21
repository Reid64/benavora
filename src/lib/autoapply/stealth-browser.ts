// StealthBrowser — a single hardened Playwright launcher for the AutoApply
// agents (form analysis + form filling). Wraps playwright-extra + the stealth
// plugin and layers on per-session fingerprint randomization and human-behavior
// helpers so automated runs look like real desktop browsers.
//
// NOTE: Playwright's equivalent of Puppeteer's page.evaluateOnNewDocument is
// context.addInitScript() — a script run in every page/frame before any page
// script executes. We use it to install the fingerprint overrides below.
//
// Requires a Chromium binary at runtime (npx playwright install chromium). Runs
// on local Node and the AutoApply worker, not Vercel serverless.
//
// Isolation guarantee: each launch() creates a brand-new browser + context.
// No cookies, localStorage, or cache are shared between calls. Callers MUST
// call context.close() (which also closes all pages) after each submission to
// fully release the context. Closing only the page leaves the context alive and
// leaks resources.

import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser, BrowserContext, Page } from "playwright";

// Apply stealth (spoofs navigator.webdriver, fake plugins, hides automation
// flags) once at module load.
chromium.use(StealthPlugin());

// --- randomization pools -----------------------------------------------------

// 20 real Chrome 120+ desktop user-agent strings (Windows + macOS).
const USER_AGENTS: readonly string[] = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
];

// Real GPU vendor/renderer pairs (as reported by ANGLE / Apple).
const WEBGL_GPUS: readonly { vendor: string; renderer: string }[] = [
  {
    vendor: "Google Inc. (NVIDIA)",
    renderer:
      "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)",
  },
  {
    vendor: "Google Inc. (NVIDIA)",
    renderer:
      "ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)",
  },
  {
    vendor: "Google Inc. (Intel)",
    renderer:
      "ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)",
  },
  {
    vendor: "Google Inc. (Intel)",
    renderer:
      "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)",
  },
  {
    vendor: "Google Inc. (AMD)",
    renderer:
      "ANGLE (AMD, AMD Radeon RX 580 Series Direct3D11 vs_5_0 ps_5_0, D3D11)",
  },
  {
    vendor: "Google Inc. (AMD)",
    renderer:
      "ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)",
  },
  { vendor: "Apple", renderer: "Apple M1" },
  { vendor: "Apple", renderer: "Apple M2" },
];

// Common real-world desktop resolutions (width x height).
// These are the top 5 by global market share — no arbitrary random ranges.
const VIEWPORTS: readonly { width: number; height: number }[] = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
  { width: 1280, height: 720 },
];

// US timezone descriptors with approximate geolocation centers and locale.
// Geolocation matches the proxy region when one is provided so the browser's
// reported position is consistent with the proxy IP's geography.
interface TimezoneConfig {
  id: string;
  locale: string;
  geolocation: { latitude: number; longitude: number };
  /** Keywords matched against proxyRegion (lowercase) to prefer this entry. */
  regionKeywords: readonly string[];
}

const TIMEZONES: readonly TimezoneConfig[] = [
  {
    id: "America/New_York",
    locale: "en-US",
    geolocation: { latitude: 40.7128, longitude: -74.006 },
    regionKeywords: ["east", "new_york", "ny", "nyc", "virginia", "va", "florida", "fl", "georgia", "ga"],
  },
  {
    id: "America/Chicago",
    locale: "en-US",
    geolocation: { latitude: 41.8781, longitude: -87.6298 },
    regionKeywords: ["central", "chicago", "il", "texas", "tx", "illinois", "midwest"],
  },
  {
    id: "America/Los_Angeles",
    locale: "en-US",
    geolocation: { latitude: 34.0522, longitude: -118.2437 },
    regionKeywords: ["west", "california", "ca", "pacific", "la", "seattle", "wa"],
  },
  {
    id: "America/Denver",
    locale: "en-US",
    geolocation: { latitude: 39.7392, longitude: -104.9903 },
    regionKeywords: ["mountain", "denver", "co", "colorado", "utah", "ut", "nevada", "nv"],
  },
  {
    id: "America/Phoenix",
    locale: "en-US",
    geolocation: { latitude: 33.4484, longitude: -112.074 },
    regionKeywords: ["arizona", "az", "phoenix"],
  },
];

// --- small helpers -----------------------------------------------------------

/** Inclusive random integer in [min, max]. */
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

/** navigator.platform that matches the chosen user-agent's OS. */
function platformForUA(ua: string): string {
  if (/Windows/.test(ua)) return "Win32";
  if (/Macintosh|Mac OS/.test(ua)) return "MacIntel";
  return "Linux x86_64";
}

/**
 * Select a timezone config, preferring one whose regionKeywords overlap with
 * the provided proxy region string. Falls back to random when no match.
 */
function pickTimezone(proxyRegion?: string): TimezoneConfig {
  if (proxyRegion) {
    const needle = proxyRegion.toLowerCase();
    const match = TIMEZONES.find((tz) =>
      tz.regionKeywords.some((kw) => needle.includes(kw)),
    );
    if (match) return match;
  }
  return pick(TIMEZONES);
}

/** Cubic Bézier point at t in [0,1]. */
function bezier(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  t: number,
): { x: number; y: number } {
  const u = 1 - t;
  const x =
    u * u * u * p0.x +
    3 * u * u * t * p1.x +
    3 * u * t * t * p2.x +
    t * t * t * p3.x;
  const y =
    u * u * u * p0.y +
    3 * u * u * t * p1.y +
    3 * u * t * t * p2.y +
    t * t * t * p3.y;
  return { x, y };
}

/**
 * Build the init script (runs in every page before page scripts) that randomizes
 * canvas, WebGL, AudioContext, and navigator fingerprints. Values are baked in
 * per session so they stay consistent across the page's lifetime. Authored as a
 * string so it isn't type-checked against the Node environment.
 */
function buildInitScript(cfg: {
  webglVendor: string;
  webglRenderer: string;
  hardwareConcurrency: number;
  deviceMemory: number;
  platform: string;
}): string {
  return `(() => {
  const def = (obj, prop, val) => { try { Object.defineProperty(obj, prop, { get: () => val, configurable: true }); } catch (e) {} };

  // navigator overrides
  def(navigator, 'hardwareConcurrency', ${cfg.hardwareConcurrency});
  def(navigator, 'deviceMemory', ${cfg.deviceMemory});
  def(navigator, 'platform', ${JSON.stringify(cfg.platform)});

  // Canvas fingerprint: subtle, deterministic-per-session noise on read-back.
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

// --- public types ------------------------------------------------------------

export interface StealthBrowserOptions {
  /** Launch headless. Default true. */
  headless?: boolean;
}

/**
 * The randomized profile chosen for a single launch() call. Returned in
 * StealthSession and accessible via getContextFingerprint() for audit logging.
 */
export interface ContextFingerprint {
  userAgent: string;
  viewport: { width: number; height: number };
  timezone: string;
  locale: string;
  /** Approximate geolocation matching the proxy region, or null when unavailable. */
  geolocation: { latitude: number; longitude: number } | null;
  webglVendor: string;
  webglRenderer: string;
  hardwareConcurrency: number;
  deviceMemory: number;
  platform: string;
}

export interface StealthSession {
  browser: Browser;
  page: Page;
  context: BrowserContext;
  /** The randomized profile used for this session. Useful for audit logs. */
  fingerprint: ContextFingerprint;
}

// --- StealthBrowser ----------------------------------------------------------

export class StealthBrowser {
  private readonly headless: boolean;
  private _lastFingerprint: ContextFingerprint | null = null;

  constructor(options: StealthBrowserOptions = {}) {
    this.headless = options.headless ?? true;
  }

  /**
   * Launch a fully isolated browser context and return { browser, page, context,
   * fingerprint }. Each call creates a brand-new browser instance with its own
   * randomized viewport, timezone, locale, geolocation, user-agent, and canvas/
   * WebGL fingerprints. No state leaks between calls.
   *
   * Callers MUST call context.close() (not page.close()) after each submission
   * to fully release the context, cookies, and storage. page.close() alone leaves
   * the context alive and leaks memory.
   *
   * @param options.proxy       - Optional proxy server URL ("http://user:pass@host:port").
   * @param options.proxyRegion - Optional hint about the proxy's geographic region
   *   (e.g. "east", "california", "texas"). Used to match the browser's timezone
   *   and geolocation to the proxy IP's geography. Case-insensitive.
   */
  async launch(options?: {
    proxy?: string;
    proxyRegion?: string;
  }): Promise<StealthSession> {
    const userAgent = pick(USER_AGENTS);
    const tz = pickTimezone(options?.proxyRegion);
    const gpu = pick(WEBGL_GPUS);
    const viewport = pick(VIEWPORTS);
    const hardwareConcurrency = randInt(4, 16);
    // deviceMemory is reported as a power of two; keep it realistic within 4-16.
    const deviceMemory = pick([4, 8, 16] as const);
    const platform = platformForUA(userAgent);

    const fingerprint: ContextFingerprint = {
      userAgent,
      viewport,
      timezone: tz.id,
      locale: tz.locale,
      geolocation: tz.geolocation,
      webglVendor: gpu.vendor,
      webglRenderer: gpu.renderer,
      hardwareConcurrency,
      deviceMemory,
      platform,
    };
    this._lastFingerprint = fingerprint;

    const launchArgs: Parameters<typeof chromium.launch>[0] = {
      headless: this.headless,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-dev-shm-usage",
      ],
    };
    if (options?.proxy) {
      launchArgs.proxy = { server: options.proxy };
    }
    const browser = await chromium.launch(launchArgs);

    const context = await browser.newContext({
      userAgent,
      viewport,
      locale: tz.locale,
      timezoneId: tz.id,
      geolocation: tz.geolocation,
      permissions: ["geolocation"],
      deviceScaleFactor: 1,
    });

    await context.addInitScript({
      content: buildInitScript({
        webglVendor: gpu.vendor,
        webglRenderer: gpu.renderer,
        hardwareConcurrency,
        deviceMemory,
        platform,
      }),
    });

    const page = await context.newPage();
    return { browser, page, context, fingerprint };
  }

  /**
   * Returns the ContextFingerprint from the most recent launch() call, or null
   * if launch() has not been called yet. Useful for audit logging after the fact
   * without needing to thread the fingerprint through call chains.
   */
  getContextFingerprint(): ContextFingerprint | null {
    return this._lastFingerprint;
  }

  // --- human behavior helpers (instance methods) -----------------------------

  /** Type into a field char-by-char with 80-200ms delays + occasional pauses. */
  async humanType(page: Page, selector: string, text: string): Promise<void> {
    const el = await page.waitForSelector(selector, {
      state: "visible",
      timeout: 15_000,
    });
    await el.click();
    for (const ch of text) {
      await page.keyboard.type(ch);
      await page.waitForTimeout(randInt(80, 200));
      // Occasional "thinking" pause.
      if (Math.random() < 0.07) {
        await page.waitForTimeout(500);
      }
    }
  }

  /** Move the mouse along a Bézier curve to the element, then click. */
  async humanClick(page: Page, selector: string): Promise<void> {
    const el = await page.waitForSelector(selector, {
      state: "visible",
      timeout: 15_000,
    });
    const box = await el.boundingBox();
    if (!box) {
      await el.click();
      return;
    }

    // Target = element center +/- a small random offset within the element.
    const offX = randInt(-Math.floor(box.width / 4), Math.floor(box.width / 4));
    const offY = randInt(-Math.floor(box.height / 4), Math.floor(box.height / 4));
    const target = {
      x: box.x + box.width / 2 + offX,
      y: box.y + box.height / 2 + offY,
    };

    const start = { x: randInt(0, 1280), y: randInt(0, 720) };
    const c1 = { x: start.x + randInt(-200, 200), y: start.y + randInt(-100, 100) };
    const c2 = { x: target.x + randInt(-200, 200), y: target.y + randInt(-100, 100) };

    const steps = randInt(20, 35);
    for (let i = 1; i <= steps; i++) {
      const p = bezier(start, c1, c2, target, i / steps);
      await page.mouse.move(p.x, p.y);
      await page.waitForTimeout(randInt(4, 14));
    }

    await page.mouse.move(target.x, target.y);
    await page.mouse.down();
    await page.waitForTimeout(randInt(40, 90));
    await page.mouse.up();
  }

  /** Scroll down 200-600px in small variable-speed steps. */
  async humanScroll(page: Page): Promise<void> {
    const distance = randInt(200, 600);
    const steps = randInt(8, 20);
    for (let i = 0; i < steps; i++) {
      await page.mouse.wheel(0, distance / steps);
      await page.waitForTimeout(randInt(20, 80));
    }
  }

  /** Idle wait of 1000-4000ms. */
  async humanDelay(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, randInt(1000, 4000)));
  }
}
