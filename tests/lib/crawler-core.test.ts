/**
 * Unit tests for src/lib/donor-discovery/crawler-core.ts — DomainRateLimiter only.
 *
 * DomainRateLimiter is a single-token bucket per domain (at most one
 * acquire()-return per `intervalMs` for a given domain). These tests use
 * fake timers so the spacing behavior can be asserted without real waits.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { DomainRateLimiter } from "@/lib/donor-discovery/crawler-core";

describe("DomainRateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves the first acquire for a domain immediately", async () => {
    const limiter = new DomainRateLimiter(5_000);
    let resolved = false;

    limiter.acquire("example.com").then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(resolved).toBe(true);
  });

  it("enforces per-domain spacing: a second acquire for the same domain waits the full interval", async () => {
    const limiter = new DomainRateLimiter(1_000);

    await limiter.acquire("example.com");

    let resolved = false;
    limiter.acquire("example.com").then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(999);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(resolved).toBe(true);
  });

  it("a third acquire for the same domain waits for its own full interval from the second", async () => {
    const limiter = new DomainRateLimiter(1_000);

    await limiter.acquire("example.com");
    await vi.advanceTimersByTimeAsync(1_000);
    await limiter.acquire("example.com");

    let resolved = false;
    limiter.acquire("example.com").then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(500);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(500);
    expect(resolved).toBe(true);
  });

  it("independent domains do not block each other", async () => {
    const limiter = new DomainRateLimiter(5_000);

    await limiter.acquire("a.com");

    let bResolved = false;
    limiter.acquire("b.com").then(() => {
      bResolved = true;
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(bResolved).toBe(true);
  });

  it("a busy domain does not delay a concurrent acquire on a different domain", async () => {
    const limiter = new DomainRateLimiter(1_000);

    await limiter.acquire("busy.com");

    let busyResolved = false;
    let quietResolved = false;
    limiter.acquire("busy.com").then(() => {
      busyResolved = true;
    });
    limiter.acquire("quiet.com").then(() => {
      quietResolved = true;
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(quietResolved).toBe(true);
    expect(busyResolved).toBe(false);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(busyResolved).toBe(true);
  });

  it("respects a per-call intervalMs override instead of the constructor default", async () => {
    const limiter = new DomainRateLimiter(5_000);

    await limiter.acquire("example.com", 200);

    let resolved = false;
    limiter.acquire("example.com", 200).then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(199);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(resolved).toBe(true);
  });
});
