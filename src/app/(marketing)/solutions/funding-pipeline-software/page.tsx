import type { Metadata } from "next";
import FundingPipelineSoftwareClient from "./FundingPipelineSoftwareClient";
import { marketingMetadata } from "@/lib/marketing/seo";

export const metadata: Metadata = marketingMetadata(
  "/solutions/funding-pipeline-software",
  "Nonprofit Funding Pipeline Software",
  "Nonprofit funding pipeline software built as a governed 12-stage state machine: every transition is checked against real conditions, every move is logged, backward moves require a note, and submitting requires an owner or admin."
);

export default function FundingPipelineSoftwarePage() {
  return <FundingPipelineSoftwareClient />;
}
