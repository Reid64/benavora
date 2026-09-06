import type { Metadata } from "next";
import NonprofitProspectResearchClient from "./NonprofitProspectResearchClient";
import { marketingMetadata } from "@/lib/marketing/seo";

export const metadata: Metadata = marketingMetadata(
  "/solutions/nonprofit-prospect-research",
  "Nonprofit Prospect Research Software",
  "Nonprofit prospect research that runs today: a three-step request wizard finds local businesses or IRS-registered foundations in a taxonomy and geography you set, then scores each one on seven weighted signals with a Claude-written rationale."
);

export default function NonprofitProspectResearchPage() {
  return <NonprofitProspectResearchClient />;
}
