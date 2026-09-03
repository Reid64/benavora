import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchWithRetry } from "@/lib/agents/research/http-retry";

function jsonResponse(status: number, ok = status >= 200 && status < 300): Response {
  return { ok, status } as Response;
}

describe("fetchWithRetry", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns immediately on a successful first attempt (no retry)", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200));

    const result = await fetchWithRetry(fetchFn, { attempts: 3, baseDelayMs: 1 });

    expect(result.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("does not retry a non-retryable 4xx response", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(404, false));

    const result = await fetchWithRetry(fetchFn, { attempts: 3, baseDelayMs: 1 });

    expect(result.status).toBe(404);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("retries on 429 and succeeds on a later attempt", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, false))
      .mockResolvedValueOnce(jsonResponse(200));

    const result = await fetchWithRetry(fetchFn, { attempts: 3, baseDelayMs: 1 });

    expect(result.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("retries on 5xx up to the attempt cap, then returns the last failure", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(503, false));

    const result = await fetchWithRetry(fetchFn, { attempts: 3, baseDelayMs: 1 });

    expect(result.status).toBe(503);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("retries on a thrown network error, then throws the last error if all attempts fail", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("network down"));

    await expect(
      fetchWithRetry(fetchFn, { attempts: 3, baseDelayMs: 1 }),
    ).rejects.toThrow("network down");
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("recovers from a thrown error on a later attempt", async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(jsonResponse(200));

    const result = await fetchWithRetry(fetchFn, { attempts: 3, baseDelayMs: 1 });

    expect(result.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("backs off exponentially between attempts", async () => {
    vi.useFakeTimers();
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(500, false))
      .mockResolvedValueOnce(jsonResponse(500, false))
      .mockResolvedValueOnce(jsonResponse(200));

    const promise = fetchWithRetry(fetchFn, {
      attempts: 3,
      baseDelayMs: 100,
      maxDelayMs: 10_000,
    });

    // First attempt fires synchronously; only after the ~100ms backoff does
    // the second attempt fire, and only after the ~200ms backoff the third.
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(150);
    expect(fetchFn).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(300);
    expect(fetchFn).toHaveBeenCalledTimes(3);

    const result = await promise;
    expect(result.ok).toBe(true);
  });
});
