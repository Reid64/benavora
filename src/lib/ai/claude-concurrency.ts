import pLimit from "p-limit";

// Shared concurrency gate for every Anthropic API call made by the Next.js
// app (src/lib/agents/**, src/lib/intelligence/**, and src/lib/ai/claude.ts's
// callClaude* wrappers that those directories call through). One
// module-level limiter so the cap is platform-wide, not per file or per
// agent - Anthropic rejects calls above the account's concurrent-connection
// limit with a 429 rate_limit_error, observed live on narrative_drafting
// production runs where several agents fired Claude calls in the same
// window. src/lib/autoapply/** has its own separate instance
// (src/lib/autoapply/claude-concurrency.ts) because that tree compiles under
// worker/tsconfig.json's restricted include list, which does not cover
// src/lib/ai/**.
const limiter = pLimit(4);

/** Run `fn` once a slot under the shared limit is free. */
export function withClaudeLimit<T>(fn: () => Promise<T>): Promise<T> {
  return limiter(fn);
}
