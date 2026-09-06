import type { Metadata } from "next";
import NonprofitFundingSoftwareClient from "./NonprofitFundingSoftwareClient";
import { marketingMetadata } from "@/lib/marketing/seo";

export const metadata: Metadata = marketingMetadata(
  "/solutions/nonprofit-funding-software",
  "Nonprofit Funding Software",
  "Nonprofit funding software that covers the full cycle a grants database or a CRM alone doesn't: research, eligibility scoring, drafting, and application submission, each with a human approval gate."
);

export default function NonprofitFundingSoftwarePage() {
  return <NonprofitFundingSoftwareClient />;
}
