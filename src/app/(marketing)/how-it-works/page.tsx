import type { Metadata } from "next";

import HowItWorksClient from "./HowItWorksClient";
import { marketingMetadata } from "@/lib/marketing/seo";

export const metadata: Metadata = marketingMetadata(
  "/how-it-works",
  "How Benavora Actually Works",
  "A stage-by-stage walkthrough of Benavora's real pipeline — discovery, scoring, drafting with human approval, learning, and outreach."
);

export default function HowItWorksPage() {
  return <HowItWorksClient />;
}
