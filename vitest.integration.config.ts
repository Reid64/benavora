import { defineConfig } from "vitest/config";
import path from "path";

// Runs only the tests excluded from the default `vitest run` (vitest.config.ts)
// because they depend on a live external system this repo doesn't control
// end-to-end from a single process — a separately-deployed Railway worker
// that must actually be polling in real time, or a real, shared production
// org whose state another live session may have changed. See WGR-157 and
// each moved test file's own header comment for why it lives here instead
// of the default suite. Run via `pnpm run test:integration`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/__tests__/integration-live/**/*.test.ts"],
    passWithNoTests: true,
    setupFiles: ["tests/setup.ts"],
    testTimeout: 200000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
