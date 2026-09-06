import type { Metadata } from "next";
import DiscoveryClient from "./DiscoveryClient";
import { marketingMetadata } from "@/lib/marketing/seo";

export const metadata: Metadata = marketingMetadata(
  "/platform/discovery",
  "Opportunity Discovery — Find Every Grant Before the Deadline Passes",
  "Eight research lanes sweep government, foundation, and corporate sources in parallel, cross-check each other, and hand staff a deduplicated feed instead of a dozen browser tabs."
);

export default function DiscoveryPage() {
  return <DiscoveryClient />;
}
