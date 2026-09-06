import type { Metadata } from "next";
import CorporateDonationApplicationSoftwareClient from "./CorporateDonationApplicationSoftwareClient";
import { marketingMetadata } from "@/lib/marketing/seo";

export const metadata: Metadata = marketingMetadata(
  "/solutions/corporate-donation-application-software",
  "Corporate Donation Application Software",
  "AutoApply doesn't treat a corporate giving portal like a government grant portal: category-aware default ask amounts, a Q4-weighted seasonal timing model, and a field-extraction adapter tuned to corporate and foundation donation forms."
);

export default function CorporateDonationApplicationSoftwarePage() {
  return <CorporateDonationApplicationSoftwareClient />;
}
