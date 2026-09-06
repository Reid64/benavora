import type { Metadata } from "next";
import HomeClient from "./HomeClient";
import { BASE_URL } from "@/lib/marketing/seo";
import { organizationJsonLd, softwareApplicationJsonLd } from "@/lib/marketing/structured-data";

const TITLE = "Benavora — AI Grant Automation for Nonprofits";
const DESCRIPTION =
  "Benavora automates grant discovery, application drafting, and donor outreach for nonprofits. 30 autonomous AI agents work 24/7 to maximize your funding.";

export const metadata: Metadata = {
  // Bypasses the root layout's "%s | Benavora" template — this title already
  // carries the brand name, so the template would double it up.
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: BASE_URL },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: BASE_URL,
    siteName: "Benavora",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function HomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareApplicationJsonLd) }}
      />
      <HomeClient />
    </>
  );
}
