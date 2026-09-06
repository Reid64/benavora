import type { Metadata } from "next";
import DonorProspectingIntelligenceClient from "./DonorProspectingIntelligenceClient";
import { marketingMetadata } from "@/lib/marketing/seo";

export const metadata: Metadata = marketingMetadata(
  "/solutions/donor-prospecting-intelligence",
  "Donor Prospecting Intelligence",
  "A 51-agent research pipeline that builds one evidence-backed dossier per major donor prospect — wealth capacity and giving propensity kept as two separate scores, a mapped relationship network, and a cultivation plan. Real, working code, currently in a controlled rollout."
);

export default function DonorProspectingIntelligencePage() {
  return <DonorProspectingIntelligenceClient />;
}
