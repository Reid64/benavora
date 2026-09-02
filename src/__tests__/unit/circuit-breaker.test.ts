import { describe, it, expect, vi, afterEach } from "vitest";
import { CircuitBreaker, CircuitOpenError, CircuitState } from "@/lib/resilience/circuit-breaker";

function failing(message = "boom") {
  return () => Promise.reject(new Error(message));
}

function succeeding<T>(value: T) {
  return () => Promise.resolve(value);
}

describe("CircuitBreaker", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays CLOSED while failures are below the threshold", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3 });
    for (let i = 0; i < 2; i++) {
      await expect(breaker.execute(failing())).rejects.toThrow("boom");
    }
    expect(breaker.getState()).toBe(CircuitState.CLOSED);
  });

  it("trips OPEN after failureThreshold consecutive failures", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3 });
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(failing())).rejects.toThrow("boom");
    }
    expect(breaker.getState()).toBe(CircuitState.OPEN);
  });

  it("rejects immediately with CircuitOpenError while OPEN and no fallback is given", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1 });
    await expect(breaker.execute(failing())).rejects.toThrow();

    const fn = vi.fn(succeeding("should not run"));
    await expect(breaker.execute(fn)).rejects.toThrow(CircuitOpenError);
    expect(fn).not.toHaveBeenCalled();
  });

  it("calls the fallback for graceful degradation while OPEN", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1 });
    await expect(breaker.execute(failing())).rejects.toThrow();

    const result = await breaker.execute(succeeding("live"), () => "cached-dossier");
    expect(result).toBe("cached-dossier");
  });

  it("moves to HALF_OPEN and closes again after successThreshold probes succeed", async () => {
    vi.useFakeTimers();
    const breaker = new CircuitBreaker({ failureThreshold: 1, successThreshold: 2, timeout: 1000 });

    await expect(breaker.execute(failing())).rejects.toThrow();
    expect(breaker.getState()).toBe(CircuitState.OPEN);

    vi.advanceTimersByTime(1001);
    expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);

    await breaker.execute(succeeding("ok"));
    expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);

    await breaker.execute(succeeding("ok"));
    expect(breaker.getState()).toBe(CircuitState.CLOSED);
  });

  it("reopens immediately on a single failed probe while HALF_OPEN", async () => {
    vi.useFakeTimers();
    const breaker = new CircuitBreaker({ failureThreshold: 5, successThreshold: 2, timeout: 1000 });

    await expect(breaker.execute(failing())).rejects.toThrow();
    // Only 1 of 5 failures so far -- still CLOSED.
    expect(breaker.getState()).toBe(CircuitState.CLOSED);

    for (let i = 0; i < 4; i++) {
      await expect(breaker.execute(failing())).rejects.toThrow();
    }
    expect(breaker.getState()).toBe(CircuitState.OPEN);

    vi.advanceTimersByTime(1001);
    expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);

    await expect(breaker.execute(failing())).rejects.toThrow();
    expect(breaker.getState()).toBe(CircuitState.OPEN);
  });

  it("caps concurrent HALF_OPEN probes at successThreshold", async () => {
    vi.useFakeTimers();
    const breaker = new CircuitBreaker({ failureThreshold: 1, successThreshold: 1, timeout: 1000 });

    await expect(breaker.execute(failing())).rejects.toThrow();
    vi.advanceTimersByTime(1001);
    expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);

    let releaseProbe: (() => void) | undefined;
    const inFlightProbe = new Promise<string>((resolve) => {
      releaseProbe = () => resolve("first-probe");
    });

    const first = breaker.execute(() => inFlightProbe);
    const second = breaker.execute(succeeding("second-probe"), () => "fallback");

    await expect(second).resolves.toBe("fallback");

    releaseProbe?.();
    await expect(first).resolves.toBe("first-probe");
  });

  it("reset() forces the breaker back to CLOSED", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1 });
    await expect(breaker.execute(failing())).rejects.toThrow();
    expect(breaker.getState()).toBe(CircuitState.OPEN);

    breaker.reset();
    expect(breaker.getState()).toBe(CircuitState.CLOSED);
    expect(breaker.getStats()).toEqual({
      state: CircuitState.CLOSED,
      failureCount: 0,
      successCount: 0,
      lastFailureTime: null,
    });
  });
});
