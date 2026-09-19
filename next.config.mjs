import createBundleAnalyzer from "@next/bundle-analyzer";

const withBundleAnalyzer = createBundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // PT-10 (malformed-payload audit): isolates this run's build output from any
  // concurrently-running shared `next dev`/`next build` process sharing this
  // checkout's default .next/ dir (WGR-001/WGR-013 contention pattern). Only
  // takes effect when PT_AUDIT_DIST_DIR is set; unset in normal operation.
  ...(process.env.PT_AUDIT_DIST_DIR ? { distDir: process.env.PT_AUDIT_DIST_DIR } : {}),
  // Native/ESM packages that must not be bundled by webpack — loaded at runtime
  // via Node.js import(). archiver v8 is pure ESM; playwright ships native
  // binaries; playwright-extra + puppeteer-extra-plugin-stealth pull transitive
  // deps (clone-deep) that use dynamic require() webpack can't statically
  // analyse. All must stay external for their respective server routes.
  // Next.js 14.x uses experimental.serverComponentsExternalPackages (the stable
  // serverExternalPackages key is Next.js 15+ only).
  experimental: {
    serverComponentsExternalPackages: [
      "archiver",
      "playwright",
      "pdf-parse",
      "playwright-extra",
      "puppeteer-extra-plugin-stealth",
    ],
    // Next.js defaults static-generation worker count to (logical CPUs - 1).
    // On this box that fans out to 20+ workers, which is fine when it's the
    // only build running but causes severe memory thrashing (and previously
    // a worker crash: exit code 3221225794 / STATUS_DLL_INIT_FAILED) when
    // multiple agent worktrees are building concurrently. cpus: 2 was not
    // tight enough under heavy multi-worktree contention (system free memory
    // observed as low as ~2GB of 16GB total with 6 worktrees building at
    // once) and the build hung past the 900s gate timeout instead of
    // finishing. Dropping to a single worker minimizes one build's peak
    // memory footprint so it can still complete under host contention.
    cpus: 1,
    // Further reduces webpack's own peak heap usage (separate from the
    // static-generation worker count above) by trading some compile speed
    // for lower memory. Needed on top of cpus: 1 — under 6-worktree
    // contention, free system memory was observed as low as ~2.7GB of 16GB,
    // and even single-worker builds were timing out from GC/swap thrashing
    // rather than a single build's own CPU cost.
    webpackMemoryOptimizations: true,
  },
  // Supabase Storage / external images are configured here as features are built.
  images: {
    remotePatterns: [],
  },
  // The build pipeline already runs `pnpm tsc --noEmit` as a separate gate before
  // `next build`. Letting `next build` redo full-project type-checking and ESLint
  // on top of that is pure duplicate work, and under multi-worktree contention
  // (see cpus: 1 note above) that duplicate pass is enough to push the build past
  // the gate's 300s ceiling. Skip both here; type/lint errors still fail the
  // earlier tsc gate.
  // 2026-09-19: BOTH RE-ENABLED. These were removed on 2026-08-21 (3f685e55)
  // and re-added on 2026-09-03 (7942f606) to keep `next build` under FORGE's
  // 300s compile-gate ceiling. That trade was worse than it looked:
  // gates/compile.ps1's own header says `tsc --noEmit` "does not run ESLint,
  // so it misses build-fatal ESLint errors that Vercel's/Railway's actual
  // `next build` enforces. That gap let 28 consecutive deploys fail in
  // production while this gate reported PASS." The gate closes that gap by
  // also running the real build - so setting ignoreDuringBuilds here reopened
  // the exact hole the gate exists to close, and the gate went on reporting
  // PASS.
  //
  // Verified before flipping, 2026-09-19:
  //   next lint            -> exit 0, "No ESLint warnings or errors"
  //   tsc --noEmit         -> clean (every AR-5..AR-12 compile gate passed,
  //                           and compile.ps1 hard-exits 1 on any tsc error)
  // The budget problem is fixed where it belongs: forge.ps1's compile-gate
  // timeout is raised from 300s to 900s, matching the build gate. A gate that
  // times out on correct code is a false failure - the same defect class as a
  // false pass - and the answer to a slow check is a longer budget, never a
  // disabled check.
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
  // mkt-001: /for-consultants predates the new marketing IA (src/lib/marketing/nav.ts,
  // ALL_MARKETING_ROUTES) and has no direct replacement page yet, so it points at the
  // closest existing hub, /solutions. /privacy, /terms, /security are NOT redirected -
  // they are still linked directly from the new footer (FOOTER_COLUMNS in nav.ts) and
  // stay live at their current paths.
  async redirects() {
    return [
      {
        source: "/for-consultants",
        destination: "/solutions",
        permanent: true,
      },
    ];
  },
};

export default withBundleAnalyzer(nextConfig);
