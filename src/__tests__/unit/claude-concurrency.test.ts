// AR-2.1 (defect C): narrative_drafting saw seven production 429
// rate_limit_error failures ("Number of concurrent connections has exceeded
// your rate limit") because nothing capped how many Anthropic calls this
// codebase fires at once. src/lib/ai/claude-concurrency.ts introduces a
// single shared module-level limiter (concurrency 4) that every Anthropic
// call in src/lib/agents/**, src/lib/intelligence/**, and src/lib/ai/claude.ts
// now routes through. This test proves the limiter actually caps concurrency
// (not just that it exists) and that every queued call still resolves rather
// than being dropped.
import { describe, it, expect } from "vitest";
import { withClaudeLimit } from "@/lib/ai/claude-concurrency";

describe("withClaudeLimit", () => {
  it("caps in-flight calls at 4 and resolves every call", async () => {
    const TOTAL_CALLS = 12;
    const CONCURRENCY_CAP = 4;

    let inFlight = 0;
    let maxObservedInFlight = 0;
    const results: number[] = [];

    const work = (i: number) =>
      withClaudeLimit(async () => {
        inFlight++;
        maxObservedInFlight = Math.max(maxObservedInFlight, inFlight);
        // Yield so other queued calls have a chance to start concurrently
        // if the limiter were not actually enforcing a cap.
        await new Promise((resolve) => setTimeout(resolve, 10));
        inFlight--;
        return i;
      });

    const calls = Array.from({ length: TOTAL_CALLS }, (_, i) => work(i));
    const settled = await Promise.all(calls);
    results.push(...settled);

    expect(maxObservedInFlight).toBeLessThanOrEqual(CONCURRENCY_CAP);
    expect(maxObservedInFlight).toBeGreaterThan(1); // proves it's not accidentally serial
    expect(results.sort((a, b) => a - b)).toEqual(
      Array.from({ length: TOTAL_CALLS }, (_, i) => i),
    );
  });

  it("still resolves when an individual call rejects, without wedging the queue", async () => {
    const okBefore = await withClaudeLimit(async () => "before");

    await expect(
      withClaudeLimit(async () => {
        throw new Error("simulated Anthropic failure");
      }),
    ).rejects.toThrow("simulated Anthropic failure");

    const okAfter = await withClaudeLimit(async () => "after");

    expect(okBefore).toBe("before");
    expect(okAfter).toBe("after");
  });
});
