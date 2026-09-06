import type { Metadata } from "next";
import TourClient from "./TourClient";
import { marketingMetadata } from "@/lib/marketing/seo";

export const metadata: Metadata = marketingMetadata(
  "/tour",
  "Product Tour",
  "A self-guided, minute-long walkthrough of Benavora's Research, Draft Generator, and AutoApply screens -- real screenshots, no form or calendar required."
);

export default function TourPage() {
  return <TourClient />;
}
