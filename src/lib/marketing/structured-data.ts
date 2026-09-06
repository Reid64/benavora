import { BASE_URL } from "@/lib/marketing/seo";

/**
 * schema.org JSON-LD for the homepage only. Kept as plain data (not JSX) so
 * scripts/audit/validate-jsonld.ts can import and validate the same objects
 * that get serialized into the page.
 */
export const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Benavora",
  url: BASE_URL,
  logo: `${BASE_URL}/benavora_logo.png`,
};

export const softwareApplicationJsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Benavora",
  url: BASE_URL,
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  description:
    "AI-powered grant discovery, application drafting, and AutoApply submission for nonprofits.",
};
