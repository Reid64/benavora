import createBundleAnalyzer from "@next/bundle-analyzer";

const withBundleAnalyzer = createBundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
  },
  // Supabase Storage / external images are configured here as features are built.
  images: {
    remotePatterns: [],
  },
  // `pnpm run typecheck` (tsc --noEmit) and `pnpm run lint` (next lint) already
  // run as their own gates. Re-running a full type-check + lint pass inside
  // `next build` duplicates that work across the whole repo and was the
  // difference between a build that fits under the CI timeout and one that
  // doesn't. Type/lint correctness is still enforced — just by those
  // dedicated gates instead of a second time here.
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default withBundleAnalyzer(nextConfig);
