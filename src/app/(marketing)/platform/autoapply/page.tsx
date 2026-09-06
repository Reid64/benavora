import type { Metadata } from "next";
import AutoApplyClient from "./AutoApplyClient";
import { marketingMetadata } from "@/lib/marketing/seo";

export const metadata: Metadata = marketingMetadata(
  "/platform/autoapply",
  "AutoApply — Qualify Deeply, Apply Selectively, Never Lose Momentum",
  "A governed submission system for the applications your organization has already decided to pursue — gated by real eligibility checks, a risk engine, rate and duplicate-submission controls, and human approval, not indiscriminate volume."
);

export default function AutoApplyPage() {
  return <AutoApplyClient />;
}
