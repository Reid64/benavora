import type { Metadata } from "next";
import GrantDiscoverySoftwareClient from "./GrantDiscoverySoftwareClient";
import { marketingMetadata } from "@/lib/marketing/seo";

export const metadata: Metadata = marketingMetadata(
  "/solutions/grant-discovery-software",
  "Grant Discovery Software",
  "Grant discovery software that runs eight research lanes against federal, state, foundation, and corporate sources in parallel, then removes the duplicates a manual multi-site search leaves behind."
);

export default function GrantDiscoverySoftwarePage() {
  return <GrantDiscoverySoftwareClient />;
}
