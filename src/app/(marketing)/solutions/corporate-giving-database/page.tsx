import type { Metadata } from "next";
import CorporateGivingDatabaseClient from "./CorporateGivingDatabaseClient";
import { marketingMetadata } from "@/lib/marketing/seo";

export const metadata: Metadata = marketingMetadata(
  "/solutions/corporate-giving-database",
  "Corporate Giving Database",
  "A shared, filterable database of companies with community-giving activity — searchable by industry, ownership type, and a propensity score — plus an on-demand scraper that pulls real giving-program opportunities from major corporate foundation pages."
);

export default function CorporateGivingDatabasePage() {
  return <CorporateGivingDatabaseClient />;
}
