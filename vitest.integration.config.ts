import { defineConfig } from "vitest/config";
import path from "path";

// Runs the tests excluded from the default `vitest run` (vitest.config.ts)
// because they depend on a live external system this repo doesn't control
// end-to-end from a single process — a separately-deployed Railway worker
// that must actually be polling in real time, a real, shared production org
// whose state another live session may have changed, or (src/__tests__/integration)
// real Playwright browser launches plus live Anthropic/Supabase calls. See
// WGR-157 and each moved test file's own header comment for why it lives
// here instead of the default suite. Run via `pnpm run test:integration`.
export default defineConfig({
  test: {
    environment: "node",
    include: [
      "src/__tests__/integration-live/**/*.test.ts",
      "src/__tests__/integration/**/*.test.ts",
    ],
    passWithNoTests: true,
    setupFiles: ["tests/setup.ts"],
    testTimeout: 200000,
    // src/__tests__/integration/*.test.ts hit the same live Supabase
    // project, Anthropic API, and Playwright sessions with real network
    // round-trips. Vitest's default thread pool runs test files
    // concurrently, so under real-world network jitter these files contend
    // for the same resources and a different file's hook/test times out
    // each run (observed 2026-08-22: ag19, autoapply-risk-scoring, and
    // platform-config-org-scope each timed out in separate full-suite runs,
    // each passing cleanly standalone). Serializing file execution removes
    // the contention rather than chasing individual timeout bumps file by
    // file. Moved here from vitest.config.ts 2026-09-17 along with the
    // files themselves.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
