// Coarse in-memory rate limiter for manually-triggered agent routes
// (autonomous/trigger, autonomous/followup-trigger, drafts/queue/trigger).
//
// Per-process only: each serverless instance holds its own Map, so this is not
// a distributed limit and resets on cold start/redeploy. That's an accepted
// tradeoff for these low-volume, human-initiated endpoints - it stops a runaway
// client loop or key leak from hammering the queue, not a precise global cap.

const hits = new Map<string, number[]>();

const WINDOW_MS = 60 * 60 * 1000;
const DEFAULT_LIMIT = 10;

/**
 * Records a call for `key` and reports whether it is still within `limit`
 * calls per rolling hour. Returns false (and does NOT record the call) once
 * the caller is already at the limit, so a blocked caller doesn't keep
 * pushing their window back out by retrying.
 */
export function checkRateLimit(key: string, limit: number = DEFAULT_LIMIT): boolean {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;
  const recent = (hits.get(key) ?? []).filter((t) => t > windowStart);

  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }

  recent.push(now);
  hits.set(key, recent);
  return true;
}
