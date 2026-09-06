import type { Metadata } from "next";
import ScanClient from "./ScanClient";
import { marketingMetadata } from "@/lib/marketing/seo";

export const metadata: Metadata = marketingMetadata(
  "/scan",
  "Free Funding Scan",
  "Tell us about your organization and get started on a free funding potential scan from Benavora."
);

export default function ScanPage() {
  return <ScanClient />;
}
