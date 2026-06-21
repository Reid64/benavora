import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const mockFrom = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mockFrom }),
}));

import { WarmupEngine } from "@/lib/admin/warmup-engine";

const engine = new WarmupEngine();

type DomainFixture = {
  id: string;
  warmup_day: number;
  warmup_status: string;
  current_daily_limit: number;
  target_daily_limit: number;
  bounce_rate: number;
  warmup_started_at: string | null;
};

async function runAdvance(domain: DomainFixture): Promise<Record<string, unknown>> {
  let capturedUpdate: Record<string, unknown> = {};

  mockFrom
    .mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: domain, error: null }),
    })
    .mockReturnValueOnce({
      update: vi.fn().mockImplementation((data: Record<string, unknown>) => {
        capturedUpdate = data;
        return { eq: vi.fn().mockResolvedValue({ data: null, error: null }) };
      }),
    });

  await engine.advanceWarmup(domain.id);
  return capturedUpdate;
}

const BASE: Omit<DomainFixture, "warmup_day" | "current_daily_limit"> = {
  id: "d1",
  warmup_status: "warming",
  target_daily_limit: 50,
  bounce_rate: 0,
  warmup_started_at: null,
};

describe("WarmupEngine.advanceWarmup", () => {
  beforeEach(() => mockFrom.mockReset());

  it("warmup schedule matches spec (5→10→20→35→50)", async () => {
    let u = await runAdvance({ ...BASE, warmup_day: 3, current_daily_limit: 5 });
    expect(u.current_daily_limit).toBe(10); // day 4

    u = await runAdvance({ ...BASE, warmup_day: 7, current_daily_limit: 10 });
    expect(u.current_daily_limit).toBe(20); // day 8

    u = await runAdvance({ ...BASE, warmup_day: 14, current_daily_limit: 20 });
    expect(u.current_daily_limit).toBe(35); // day 15

    u = await runAdvance({ ...BASE, warmup_day: 21, current_daily_limit: 35 });
    expect(u.current_daily_limit).toBe(50); // day 22
    expect(u.warmup_status).toBe("complete");
  });

  it("high bounce rate (>3%) freezes warmup at current limit", async () => {
    const u = await runAdvance({
      ...BASE,
      warmup_day: 10,
      current_daily_limit: 20,
      bounce_rate: 0.04,
    });
    expect(u.warmup_status).toBe("frozen");
    expect(u.current_daily_limit).toBe(20);
  });

  it("very high bounce rate (>5%) regresses one tier", async () => {
    const u = await runAdvance({
      ...BASE,
      warmup_day: 10,
      current_daily_limit: 20,
      bounce_rate: 0.06,
    });
    expect(u.warmup_status).toBe("frozen");
    expect(u.current_daily_limit).toBe(10);
  });

  it("does not advance a paused domain", async () => {
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi
        .fn()
        .mockResolvedValue({ data: { ...BASE, warmup_day: 5, current_daily_limit: 10, warmup_status: "paused" }, error: null }),
    });

    await engine.advanceWarmup("d1");
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });
});

describe("WarmupEngine.getDailyBudget", () => {
  beforeEach(() => mockFrom.mockReset());

  it("counts today's sends correctly and returns remaining budget", async () => {
    mockFrom
      .mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { current_daily_limit: 25 }, error: null }),
      })
      .mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(resolve({ count: 10 })),
      });

    const result = await engine.getDailyBudget("d1");
    expect(result.limit).toBe(25);
    expect(result.sent_today).toBe(10);
    expect(result.remaining).toBe(15);
  });

  it("clamps remaining to zero when sends exceed limit", async () => {
    mockFrom
      .mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { current_daily_limit: 5 }, error: null }),
      })
      .mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(resolve({ count: 8 })),
      });

    const result = await engine.getDailyBudget("d1");
    expect(result.remaining).toBe(0);
    expect(result.sent_today).toBe(8);
  });
});
