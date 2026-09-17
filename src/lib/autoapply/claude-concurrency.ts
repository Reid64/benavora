import pLimit from "p-limit";

// Second, independent concurrency gate scoped to src/lib/autoapply/**.
// worker/tsconfig.json compiles this tree with a restricted `include` list
// that does not cover src/lib/ai/** (see that file's own comment), which is
// why every autoapply Claude caller instantiates its own Anthropic client
// instead of importing src/lib/ai/claude.ts's wrappers - there is no import
// path between the two trees under the worker build. The Railway worker
// process loads this module once, so its module-level limiter state still
// caps concurrency for every autoapply call the same way
// src/lib/ai/claude-concurrency.ts does for the Next.js app.
const limiter = pLimit(4);

/** Run `fn` once a slot under the shared limit is free. */
export function withClaudeLimit<T>(fn: () => Promise<T>): Promise<T> {
  return limiter(fn);
}
