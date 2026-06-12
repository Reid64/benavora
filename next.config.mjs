/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Supabase Storage / external images are configured here as features are built.
  images: {
    remotePatterns: [],
  },
  experimental: {
    // Playwright (Phase 3 browser automation) is a native package that must not
    // be bundled/traced into the serverless route output — keep it external so
    // the automation API routes build cleanly.
    serverComponentsExternalPackages: ["playwright"],
  },
};

export default nextConfig;
