// Shared retry/backoff helper for research-agent HTTP calls. Retries only
// transient failures — network errors, timeouts, 429, and 5xx — never 4xx
// client errors (bad request, auth), which will not succeed on retry.
//
// Used by the government research family's API clients (Grants.gov, SAM.gov,
// HUD) to add resilience against transient upstream failures without changing
// their existing non-fatal "skip on final failure" semantics — a caller that
// already treats a failed fetch as non-fatal keeps behaving the same way,
// it just tries harder first.

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RetryOptions {
  /** Total attempts including the first. Default 3. */
  attempts?: number;
  /** Base backoff delay in ms before the second attempt. Default 500. */
  baseDelayMs?: number;
  /** Backoff ceiling in ms. Default 8000. */
  maxDelayMs?: number;
}

/**
 * Calls `fetchFn` and retries with exponential backoff + jitter when it
 * throws (network error/timeout) or returns a 429/5xx response. Returns the
 * first ok-or-non-retryable Response as-is (callers keep their own
 * status-code handling unchanged), or throws/returns the last failure after
 * exhausting attempts.
 */
export async function fetchWithRetry(
  fetchFn: () => Promise<Response>,
  options: RetryOptions = {},
): Promise<Response> {
  const attempts = options.attempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 8000;

  let lastResponse: Response | null = null;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetchFn();
      if (response.ok || !isRetryableStatus(response.status)) {
        return response;
      }
      lastResponse = response;
    } catch (err) {
      lastError = err;
    }

    if (attempt < attempts - 1) {
      const backoff = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
      const jitter = Math.random() * backoff * 0.25;
      await delay(backoff + jitter);
    }
  }

  if (lastResponse) return lastResponse;
  throw lastError instanceof Error
    ? lastError
    : new Error("Request failed after retries.");
}
