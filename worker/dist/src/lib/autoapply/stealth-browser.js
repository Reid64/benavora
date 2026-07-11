"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StealthBrowser = void 0;
const playwright_extra_1 = require("playwright-extra");
const puppeteer_extra_plugin_stealth_1 = __importDefault(require("puppeteer-extra-plugin-stealth"));
// Apply stealth (spoofs navigator.webdriver, fake plugins, hides automation
// flags) once at module load.
playwright_extra_1.chromium.use((0, puppeteer_extra_plugin_stealth_1.default)());
// --- randomization pools -----------------------------------------------------
// 20 real Chrome 120+ desktop user-agent strings (Windows + macOS).
const USER_AGENTS = [
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
const WEBGL_GPUS = [
    {
        vendor: "Google Inc. (NVIDIA)",
        renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    },
    {
        vendor: "Google Inc. (NVIDIA)",
        renderer: "ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)",
    },
    {
        vendor: "Google Inc. (Intel)",
        renderer: "ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    },
    {
        vendor: "Google Inc. (Intel)",
        renderer: "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)",
    },
    {
        vendor: "Google Inc. (AMD)",
        renderer: "ANGLE (AMD, AMD Radeon RX 580 Series Direct3D11 vs_5_0 ps_5_0, D3D11)",
    },
    {
        vendor: "Google Inc. (AMD)",
        renderer: "ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)",
    },
    { vendor: "Apple", renderer: "Apple M1" },
    { vendor: "Apple", renderer: "Apple M2" },
];
// Common real-world desktop resolutions (width x height).
// These are the top 5 by global market share — no arbitrary random ranges.
const VIEWPORTS = [
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
    { width: 1536, height: 864 },
    { width: 1280, height: 720 },
];
const TIMEZONES = [
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
function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}
/** navigator.platform that matches the chosen user-agent's OS. */
function platformForUA(ua) {
    if (/Windows/.test(ua))
        return "Win32";
    if (/Macintosh|Mac OS/.test(ua))
        return "MacIntel";
    return "Linux x86_64";
}
/**
 * Select a timezone config, preferring one whose regionKeywords overlap with
 * the provided proxy region string. Falls back to random when no match.
 */
function pickTimezone(proxyRegion) {
    if (proxyRegion) {
        const needle = proxyRegion.toLowerCase();
        const match = TIMEZONES.find((tz) => tz.regionKeywords.some((kw) => needle.includes(kw)));
        if (match)
            return match;
    }
    return pick(TIMEZONES);
}
/** Cubic Bézier point at t in [0,1]. */
function bezier(p0, p1, p2, p3, t) {
    const u = 1 - t;
    const x = u * u * u * p0.x +
        3 * u * u * t * p1.x +
        3 * u * t * t * p2.x +
        t * t * t * p3.x;
    const y = u * u * u * p0.y +
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
function buildInitScript(cfg) {
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
// --- StealthBrowser ----------------------------------------------------------
class StealthBrowser {
    headless;
    _lastFingerprint = null;
    _page = null;
    _cdpSession = null;
    constructor(options = {}) {
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
    async launch(options) {
        const userAgent = pick(USER_AGENTS);
        const tz = pickTimezone(options?.proxyRegion);
        const gpu = pick(WEBGL_GPUS);
        const viewport = pick(VIEWPORTS);
        const hardwareConcurrency = randInt(4, 16);
        // deviceMemory is reported as a power of two; keep it realistic within 4-16.
        const deviceMemory = pick([4, 8, 16]);
        const platform = platformForUA(userAgent);
        const fingerprint = {
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
        const launchArgs = {
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
        const browser = await playwright_extra_1.chromium.launch(launchArgs);
        const context = await browser.newContext({
            userAgent,
            viewport,
            locale: tz.locale,
            timezoneId: tz.id,
            geolocation: tz.geolocation,
            permissions: ["geolocation"],
            deviceScaleFactor: 1,
            recordVideo: { dir: '/tmp/recordings', size: { width: 960, height: 540 } },
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
        this._page = page;
        return { browser, page, context, fingerprint };
    }
    /**
     * Returns the ContextFingerprint from the most recent launch() call, or null
     * if launch() has not been called yet. Useful for audit logging after the fact
     * without needing to thread the fingerprint through call chains.
     */
    getContextFingerprint() {
        return this._lastFingerprint;
    }
    /**
     * Returns the path to the recorded video file after the browser context has
     * been closed (via context.close() or browser.close()). The .webm file is not
     * written to disk until the context is fully closed, so this must only be
     * called after close completes. Returns null if no recording was captured.
     */
    async getRecordingPath() {
        if (this._page === null)
            return null;
        const video = this._page.video();
        if (video === null)
            return null;
        return video.path().catch(() => null);
    }
    // --- CDP screencast --------------------------------------------------------
    async startScreencast(callback) {
        if (this._page === null)
            throw new Error('Browser not launched');
        const cdp = await this._page.context().newCDPSession(this._page);
        this._cdpSession = cdp;
        await cdp.send('Page.startScreencast', {
            format: 'jpeg',
            quality: 40,
            maxWidth: 960,
            maxHeight: 540,
            everyNthFrame: 3,
        });
        cdp.on('Page.screencastFrame', (params) => {
            callback(Buffer.from(params.data, 'base64'));
            cdp.send('Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => { });
        });
    }
    async stopScreencast() {
        if (this._cdpSession === null)
            return;
        await this._cdpSession.send('Page.stopScreencast');
        this._cdpSession = null;
    }
    // --- human behavior helpers (instance methods) -----------------------------
    /** Type into a field char-by-char with 80-200ms delays + occasional pauses. */
    async humanType(page, selector, text) {
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
    async humanClick(page, selector) {
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
    async humanScroll(page) {
        const distance = randInt(200, 600);
        const steps = randInt(8, 20);
        for (let i = 0; i < steps; i++) {
            await page.mouse.wheel(0, distance / steps);
            await page.waitForTimeout(randInt(20, 80));
        }
    }
    /** Idle wait of 1000-4000ms. */
    async humanDelay() {
        await new Promise((resolve) => setTimeout(resolve, randInt(1000, 4000)));
    }
}
exports.StealthBrowser = StealthBrowser;
