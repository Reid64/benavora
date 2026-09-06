import type { Metadata } from "next";
import FundingOperationsSoftwareClient from "./FundingOperationsSoftwareClient";
import { marketingMetadata } from "@/lib/marketing/seo";

export const metadata: Metadata = marketingMetadata(
  "/solutions/funding-operations-software",
  "Funding Operations Software",
  "Funding operations software for the finance and compliance side of grantseeking: role-based access, audit-logged submissions, admin pause switches, and per-organization data isolation, not just a discovery and drafting tool."
);

export default function FundingOperationsSoftwarePage() {
  return <FundingOperationsSoftwareClient />;
}
