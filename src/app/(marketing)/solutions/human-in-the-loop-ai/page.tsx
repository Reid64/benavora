import type { Metadata } from "next";
import HumanInTheLoopAiClient from "./HumanInTheLoopAiClient";
import { marketingMetadata } from "@/lib/marketing/seo";

export const metadata: Metadata = marketingMetadata(
  "/solutions/human-in-the-loop-ai",
  "Human-in-the-Loop AI for Nonprofits",
  "Human-in-the-loop AI for nonprofits: the specific approval gates, autonomy toggles, and audit trail actually built into AutoApply and Draft Generator, not a claim about oversight in general."
);

export default function HumanInTheLoopAiPage() {
  return <HumanInTheLoopAiClient />;
}
