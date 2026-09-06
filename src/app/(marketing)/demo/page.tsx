import type { Metadata } from "next";
import DemoClient from "./DemoClient";
import { marketingMetadata } from "@/lib/marketing/seo";

export const metadata: Metadata = marketingMetadata(
  "/demo",
  "See How Benavora Would Fund Your Mission",
  "Tell us a bit about your organization and book a tailored demo - we'll come prepared with a funding profile built around your mission."
);

export default function DemoPage() {
  return <DemoClient />;
}
