import type { Metadata } from "next";
import ProspectIntelligenceClient from "./ProspectIntelligenceClient";
import { marketingMetadata } from "@/lib/marketing/seo";

export const metadata: Metadata = marketingMetadata(
  "/platform/prospect-intelligence",
  "Prospect Intelligence — Know Who to Ask, Before You Ask Them",
  "A 51-agent research pipeline that builds an evidence-backed dossier on a major donor, foundation, or corporate funder — mission fit, capacity, timing, and warm-introduction paths, every claim traceable to its source. Currently in controlled rollout, not yet available on every account."
);

export default function ProspectIntelligencePage() {
  return <ProspectIntelligenceClient />;
}
