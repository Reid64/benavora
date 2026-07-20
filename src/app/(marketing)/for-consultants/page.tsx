import type { Metadata } from "next";

import ForConsultantsClient from "./ForConsultantsClient";

export const metadata: Metadata = {
  title: "For Consultants & Agencies",
  description:
    "Scale your grant-writing practice with Benavora. Multi-client dashboard, per-client Knowledge Base isolation, white-label drafts, and AutoApply at scale.",
};

export default function ForConsultantsPage() {
  return <ForConsultantsClient />;
}
