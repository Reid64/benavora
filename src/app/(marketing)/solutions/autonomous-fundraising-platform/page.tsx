import type { Metadata } from "next";
import AutonomousFundraisingPlatformClient from "./AutonomousFundraisingPlatformClient";
import { marketingMetadata } from "@/lib/marketing/seo";

export const metadata: Metadata = marketingMetadata(
  "/solutions/autonomous-fundraising-platform",
  "Autonomous Fundraising Platform",
  "An autonomous fundraising platform where each stage — grant research, scoring, drafting, application submission, and donor and corporate-giving outreach — has its own explicit autonomy toggle, off by default, not one blanket switch."
);

export default function AutonomousFundraisingPlatformPage() {
  return <AutonomousFundraisingPlatformClient />;
}
