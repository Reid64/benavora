import type { Metadata } from "next";

import PricingPageClient from "./PricingPageClient";
import { marketingMetadata } from "@/lib/marketing/seo";

export const metadata: Metadata = marketingMetadata(
  "/pricing",
  "Pricing",
  "Simple, transparent pricing for Benavora's AI-powered nonprofit funding platform. Start free, upgrade when you're ready."
);

export default function PricingPage() {
  return <PricingPageClient />;
}
