// ProxyManager — residential proxy pool for AutoApply submissions.
// Prevents WAF/Cloudflare blocks by routing each submission through a
// different IP. 'static' provider reads PROXY_LIST env var; API-based
// providers (brightdata, smartproxy, iproyal) are stubbed for future work.

interface ProxyEntry {
  url: string;
  region?: string;
  failureCount: number;
  // null = active; finite number = timed cooldown epoch ms; Infinity = permanently removed
  cooldownUntil: number | null;
}

export interface ProxyManagerConfig {
  provider: string;
  apiKey: string;
  poolSize?: number;
}

const COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes per failed proxy
const MAX_FAILURES = 3;             // permanent removal after this many failures
const RECENT_USAGE_WINDOW = 5;     // avoid reusing a proxy within last N submissions

export class ProxyManager {
  private readonly config: ProxyManagerConfig;
  private pool: ProxyEntry[] = [];
  private recentlyUsed: string[] = [];
  private roundRobinIndex = 0;

  constructor(config: ProxyManagerConfig) {
    this.config = config;
  }

  async loadProxies(): Promise<void> {
    if (this.config.provider === 'static') {
      const list = process.env['PROXY_LIST'] ?? '';
      if (!list.trim()) {
        console.warn('[ProxyManager] PROXY_LIST env var is empty — no proxies loaded, running direct');
        this.pool = [];
        return;
      }
      this.pool = list
        .split(',')
        .map((u) => u.trim())
        .filter((u) => u.length > 0)
        .map((url) => ({ url, failureCount: 0, cooldownUntil: null }));
      console.log(`[ProxyManager] Loaded ${this.pool.length} static proxies`);
    } else {
      console.warn(
        `[ProxyManager] Provider '${this.config.provider}' API integration is not yet implemented. ` +
        `Only 'static' is supported. Running without proxies.`,
      );
      this.pool = [];
    }
  }

  getProxy(region?: string): string | null {
    const active = this.activeProxies();
    if (active.length === 0) return null;

    if (region) {
      const regional = active.filter((p) => p.region === region);
      if (regional.length > 0) {
        const entry = regional[this.roundRobinIndex % regional.length]!;
        this.roundRobinIndex = (this.roundRobinIndex + 1) % active.length;
        return entry.url;
      }
    }

    const entry = active[this.roundRobinIndex % active.length]!;
    this.roundRobinIndex = (this.roundRobinIndex + 1) % active.length;
    return entry.url;
  }

  markFailed(proxyUrl: string): void {
    const entry = this.pool.find((p) => p.url === proxyUrl);
    if (!entry) return;

    entry.failureCount += 1;

    if (entry.failureCount >= MAX_FAILURES) {
      entry.cooldownUntil = Infinity;
      console.warn(`[ProxyManager] Proxy permanently removed after ${MAX_FAILURES} failures: ${proxyUrl}`);
    } else {
      entry.cooldownUntil = Date.now() + COOLDOWN_MS;
      console.warn(
        `[ProxyManager] Proxy on 30-min cooldown ` +
        `(failure ${entry.failureCount}/${MAX_FAILURES - 1}): ${proxyUrl}`,
      );
    }
  }

  rotateForSubmission(): string | null {
    const active = this.activeProxies();
    if (active.length === 0) return null;

    // Prefer a proxy not recently used
    const preferred = active.filter((p) => !this.recentlyUsed.includes(p.url));
    const candidates = preferred.length > 0 ? preferred : active;

    const entry = candidates[this.roundRobinIndex % candidates.length]!;
    this.roundRobinIndex = (this.roundRobinIndex + 1) % Math.max(candidates.length, 1);

    this.recentlyUsed.push(entry.url);
    if (this.recentlyUsed.length > RECENT_USAGE_WINDOW) {
      this.recentlyUsed.shift();
    }

    return entry.url;
  }

  getStats(): { total: number; active: number; failed: number } {
    const now = Date.now();
    const activeCount = this.pool.filter(
      (p) => p.cooldownUntil === null ||
             (p.cooldownUntil !== Infinity && p.cooldownUntil <= now),
    ).length;
    return { total: this.pool.length, active: activeCount, failed: this.pool.length - activeCount };
  }

  private activeProxies(): ProxyEntry[] {
    const now = Date.now();
    return this.pool.filter(
      (p) => p.cooldownUntil === null ||
             (p.cooldownUntil !== Infinity && p.cooldownUntil <= now),
    );
  }
}
