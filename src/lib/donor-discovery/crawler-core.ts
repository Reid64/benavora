import robotsParser from "robots-parser";

import { createAdminClient } from "@/lib/supabase/admin";

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

const DEFAULT_USER_AGENT =
  "BenavoraBot/1.0 (+https://benavora.vercel.app/security)";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RATE_LIMIT_MS = 5_000; // 1 request / 5s / domain
const ROBOTS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const TOS_CACHE_TTL_MS = 60 * 60 * 1000;

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return url.toLowerCase().replace(/^www\./, "");
  }
}

/**
 * Single-token bucket per domain: at most one request per `intervalMs` for
 * that domain, refilled on a timer rather than tracked per-caller. Shared
 * module-level instances (see `domainRateLimiter` below) make the limit
 * apply across every adapter and tenant hitting the same domain.
 */
export class DomainRateLimiter {
  private readonly defaultIntervalMs: number;
  private readonly nextAllowedAt = new Map<string, number>();

  constructor(defaultIntervalMs: number = DEFAULT_RATE_LIMIT_MS) {
    this.defaultIntervalMs = defaultIntervalMs;
  }

  /** Resolves once it's this domain's turn. Reserves the next slot before returning so concurrent callers serialize. */
  async acquire(domain: string, intervalMs?: number): Promise<void> {
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Shared across all adapters and all tenants' requests, per
// DONOR_DISCOVERY_ARCHITECTURE.md §5.
const domainRateLimiter = new DomainRateLimiter();

type Robot = ReturnType<typeof robotsParser>;

const robotsMemoryCache = new Map<
  string,
  { robots: Robot; expiresAt: number }
>();
const tosMemoryCache = new Map<string, { allowed: boolean; expiresAt: number }>();

function adapterDisabledEnvKey(adapterName: string): string {
  const normalized = adapterName.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  return `DD_ADAPTER_${normalized}_DISABLED`;
}

/** Kill switch adapters must check before running (architecture §5). */
export function isAdapterDisabled(adapterName: string): boolean {
  return process.env[adapterDisabledEnvKey(adapterName)] === "true";
}

async function isScrapeAllowed(domain: string): Promise<boolean> {
  const cached = tosMemoryCache.get(domain);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.allowed;
  }

  const supabase = createAdminClient();
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

async function fetchRobotsTxt(
  domain: string,
  userAgent: string,
  timeoutMs: number,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`https://${domain}/robots.txt`, {
      headers: { "User-Agent": userAgent },
      signal: controller.signal,
    });
    // A missing/erroring robots.txt means "no restrictions" per the robots
    // exclusion convention — fall through with empty content either way.
    if (!response.ok) return "";
    return await response.text();
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

async function getRobotsFromDb(
  domain: string,
): Promise<{ robotsTxt: string; fetchedAt: string } | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("dd_robots_cache")
    .select("robots_txt, fetched_at")
    .eq("domain", domain)
    .maybeSingle();
  if (error || !data) return null;
  return { robotsTxt: data.robots_txt ?? "", fetchedAt: data.fetched_at };
}

async function saveRobotsToDb(domain: string, robotsTxt: string): Promise<void> {
  const supabase = createAdminClient();
  await supabase.from("dd_robots_cache").upsert(
    { domain, robots_txt: robotsTxt, fetched_at: new Date().toISOString() },
    { onConflict: "domain" },
  );
}

async function getRobots(
  domain: string,
  userAgent: string,
  timeoutMs: number,
): Promise<Robot> {
  const memoryHit = robotsMemoryCache.get(domain);
  if (memoryHit && memoryHit.expiresAt > Date.now()) {
    return memoryHit.robots;
  }

  const dbHit = await getRobotsFromDb(domain);
  if (dbHit) {
    const expiresAt = Date.parse(dbHit.fetchedAt) + ROBOTS_CACHE_TTL_MS;
    if (expiresAt > Date.now()) {
      const robots = robotsParser(`https://${domain}/robots.txt`, dbHit.robotsTxt);
      robotsMemoryCache.set(domain, { robots, expiresAt });
      return robots;
    }
  }

  const robotsTxt = await fetchRobotsTxt(domain, userAgent, timeoutMs);
  const robots = robotsParser(`https://${domain}/robots.txt`, robotsTxt);
  robotsMemoryCache.set(domain, { robots, expiresAt: Date.now() + ROBOTS_CACHE_TTL_MS });
  void saveRobotsToDb(domain, robotsTxt);
  return robots;
}

export interface FetchCompliantOptions {
  /** Kill switch + logging identity, e.g. "apollo". Checked against DD_ADAPTER_<NAME>_DISABLED. */
  adapterName?: string;
  userAgent?: string;
  timeoutMs?: number;
  /** Per-adapter override of the default 1 req / 5s / domain rate limit. */
  rateLimitMs?: number;
}

export interface FetchCompliantResult {
  ok: boolean;
  status: number;
  html: string | null;
  blockedReason?: "kill-switch" | "tos-disallowed" | "robots-disallowed" | "fetch-error";
}

/**
 * Fetches `url` through the full compliance chain: kill switch → ToS
 * registry → robots.txt → rate limiter → HTTP fetch. Never throws — HTTP
 * and network errors are reported in the returned result.
 */
export async function fetchCompliant(
  url: string,
  opts: FetchCompliantOptions = {},
): Promise<FetchCompliantResult> {
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
  } catch {
    return { ok: false, status: 0, html: null, blockedReason: "fetch-error" };
  } finally {
    clearTimeout(timer);
  }
}
