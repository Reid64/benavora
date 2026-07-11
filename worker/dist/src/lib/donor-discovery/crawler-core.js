"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DomainRateLimiter = void 0;
exports.isAdapterDisabled = isAdapterDisabled;
exports.fetchCompliant = fetchCompliant;
const robots_parser_1 = __importDefault(require("robots-parser"));
const admin_1 = require("../../lib/supabase/admin");
/**
 * Donor Discovery crawler core (DONOR_DISCOVERY_ARCHITECTURE.md §5).
 *
 * Compliance — rate limiting, robots.txt, ToS registry, kill switches — is
 * Phase 1 infrastructure, not an afterthought. Every adapter must fetch
 * pages through `fetchCompliant`, never through a bare `fetch`.
 *
 * IMPORTANT — module-level state: the rate limiter's token buckets and the
 * robots.txt memory cache live as module-level `Map`s so they're shared
 * across every adapter and every tenant's requests within one process, per
 * the architecture doc. That's only meaningful on a long-lived process.
 * Vercel API routes are stateless and spin up fresh per invocation, so a
 * rate limiter there would never accumulate history and would provide no
 * real protection against hammering a domain. Donor Discovery crawling MUST
 * run from the persistent worker process, never from a Vercel route.
 */
const DEFAULT_USER_AGENT = "BenavoraBot/1.0 (+https://benavora.vercel.app/security)";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RATE_LIMIT_MS = 5_000; // 1 request / 5s / domain
const ROBOTS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const TOS_CACHE_TTL_MS = 60 * 60 * 1000;
function extractDomain(url) {
    try {
        return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    }
    catch {
        return url.toLowerCase().replace(/^www\./, "");
    }
}
/**
 * Single-token bucket per domain: at most one request per `intervalMs` for
 * that domain, refilled on a timer rather than tracked per-caller. Shared
 * module-level instances (see `domainRateLimiter` below) make the limit
 * apply across every adapter and tenant hitting the same domain.
 */
class DomainRateLimiter {
    defaultIntervalMs;
    nextAllowedAt = new Map();
    constructor(defaultIntervalMs = DEFAULT_RATE_LIMIT_MS) {
        this.defaultIntervalMs = defaultIntervalMs;
    }
    /** Resolves once it's this domain's turn. Reserves the next slot before returning so concurrent callers serialize. */
    async acquire(domain, intervalMs) {
        const interval = intervalMs ?? this.defaultIntervalMs;
        for (;;) {
            const now = Date.now();
            const readyAt = this.nextAllowedAt.get(domain) ?? 0;
            if (now >= readyAt) {
                this.nextAllowedAt.set(domain, now + interval);
                return;
            }
            await sleep(readyAt - now);
        }
    }
}
exports.DomainRateLimiter = DomainRateLimiter;
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
// Shared across all adapters and all tenants' requests, per
// DONOR_DISCOVERY_ARCHITECTURE.md §5.
const domainRateLimiter = new DomainRateLimiter();
const robotsMemoryCache = new Map();
const tosMemoryCache = new Map();
function adapterDisabledEnvKey(adapterName) {
    const normalized = adapterName.toUpperCase().replace(/[^A-Z0-9]/g, "_");
    return `DD_ADAPTER_${normalized}_DISABLED`;
}
/** Kill switch adapters must check before running (architecture §5). */
function isAdapterDisabled(adapterName) {
    return process.env[adapterDisabledEnvKey(adapterName)] === "true";
}
async function isScrapeAllowed(domain) {
    const cached = tosMemoryCache.get(domain);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.allowed;
    }
    const supabase = (0, admin_1.createAdminClient)();
    const { data, error } = await supabase
        .from("donor_discovery_tos_registry")
        .select("scrape_allowed")
        .eq("domain", domain)
        .maybeSingle();
    // No row (or a lookup error) means the domain has no registered
    // exception — the registry only needs to carry the disallowed cases.
    const allowed = !error && data ? data.scrape_allowed !== false : true;
    tosMemoryCache.set(domain, { allowed, expiresAt: Date.now() + TOS_CACHE_TTL_MS });
    return allowed;
}
async function fetchRobotsTxt(domain, userAgent, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(`https://${domain}/robots.txt`, {
            headers: { "User-Agent": userAgent },
            signal: controller.signal,
        });
        // A missing/erroring robots.txt means "no restrictions" per the robots
        // exclusion convention — fall through with empty content either way.
        if (!response.ok)
            return "";
        return await response.text();
    }
    catch {
        return "";
    }
    finally {
        clearTimeout(timer);
    }
}
async function getRobotsFromDb(domain) {
    const supabase = (0, admin_1.createAdminClient)();
    const { data, error } = await supabase
        .from("dd_robots_cache")
        .select("robots_txt, fetched_at")
        .eq("domain", domain)
        .maybeSingle();
    if (error || !data)
        return null;
    return { robotsTxt: data.robots_txt ?? "", fetchedAt: data.fetched_at };
}
async function saveRobotsToDb(domain, robotsTxt) {
    const supabase = (0, admin_1.createAdminClient)();
    await supabase.from("dd_robots_cache").upsert({ domain, robots_txt: robotsTxt, fetched_at: new Date().toISOString() }, { onConflict: "domain" });
}
async function getRobots(domain, userAgent, timeoutMs) {
    const memoryHit = robotsMemoryCache.get(domain);
    if (memoryHit && memoryHit.expiresAt > Date.now()) {
        return memoryHit.robots;
    }
    const dbHit = await getRobotsFromDb(domain);
    if (dbHit) {
        const expiresAt = Date.parse(dbHit.fetchedAt) + ROBOTS_CACHE_TTL_MS;
        if (expiresAt > Date.now()) {
            const robots = (0, robots_parser_1.default)(`https://${domain}/robots.txt`, dbHit.robotsTxt);
            robotsMemoryCache.set(domain, { robots, expiresAt });
            return robots;
        }
    }
    const robotsTxt = await fetchRobotsTxt(domain, userAgent, timeoutMs);
    const robots = (0, robots_parser_1.default)(`https://${domain}/robots.txt`, robotsTxt);
    robotsMemoryCache.set(domain, { robots, expiresAt: Date.now() + ROBOTS_CACHE_TTL_MS });
    void saveRobotsToDb(domain, robotsTxt);
    return robots;
}
/**
 * Fetches `url` through the full compliance chain: kill switch → ToS
 * registry → robots.txt → rate limiter → HTTP fetch. Never throws — HTTP
 * and network errors are reported in the returned result.
 */
async function fetchCompliant(url, opts = {}) {
    const domain = extractDomain(url);
    const userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (opts.adapterName && isAdapterDisabled(opts.adapterName)) {
        return { ok: false, status: 0, html: null, blockedReason: "kill-switch" };
    }
    if (!(await isScrapeAllowed(domain))) {
        return { ok: false, status: 0, html: null, blockedReason: "tos-disallowed" };
    }
    const robots = await getRobots(domain, userAgent, timeoutMs);
    if (robots.isAllowed(url, userAgent) === false) {
        return { ok: false, status: 0, html: null, blockedReason: "robots-disallowed" };
    }
    await domainRateLimiter.acquire(domain, opts.rateLimitMs);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            headers: { "User-Agent": userAgent },
            signal: controller.signal,
        });
        const html = await response.text();
        return { ok: response.ok, status: response.status, html };
    }
    catch {
        return { ok: false, status: 0, html: null, blockedReason: "fetch-error" };
    }
    finally {
        clearTimeout(timer);
    }
}
