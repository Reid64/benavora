import type { Metadata } from "next";

import ForConsultantsClient from "./ForConsultantsClient";
import { marketingMetadata } from "@/lib/marketing/seo";

export const metadata: Metadata = marketingMetadata(
  "/for-consultants",
  "For Consultants & Agencies",
  "Scale your grant-writing practice with Benavora. Multi-client dashboard, per-client Knowledge Base isolation, white-label drafts, and AutoApply at scale."
);

export default function ForConsultantsPage() {
  return <ForConsultantsClient />;
}
