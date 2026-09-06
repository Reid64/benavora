import type { Metadata } from "next";

export const BASE_URL = "https://benavora.com";

/**
 * Per-page metadata for the marketing site: canonical URL + page-specific
 * Open Graph / Twitter cards. Root layout (src/app/layout.tsx) supplies
 * metadataBase, the title template, robots, and icons; this only adds what
 * varies per route.
 */
export function marketingMetadata(
  routePath: string,
  title: string,
  description: string
): Metadata {
  const url = `${BASE_URL}${routePath}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      siteName: "Benavora",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}
