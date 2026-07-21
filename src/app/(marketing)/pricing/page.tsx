import type { Metadata } from "next";

import PricingPageClient from "./PricingPageClient";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Simple, transparent pricing for Benavora's AI-powered nonprofit funding platform. Start free, upgrade when you're ready.",
};

export default function PricingPage() {
  return <PricingPageClient />;
}
