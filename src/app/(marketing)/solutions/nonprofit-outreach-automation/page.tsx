import type { Metadata } from "next";
import NonprofitOutreachAutomationClient from "./NonprofitOutreachAutomationClient";
import { marketingMetadata } from "@/lib/marketing/seo";

export const metadata: Metadata = marketingMetadata(
  "/solutions/nonprofit-outreach-automation",
  "Nonprofit Outreach Automation",
  "Nonprofit outreach automation for donor and corporate-giving cultivation: drafted, personalized outreach across email, LinkedIn, phone, and mail, with suppression checks and a human sending every message a channel's terms don't allow to send itself."
);

export default function NonprofitOutreachAutomationPage() {
  return <NonprofitOutreachAutomationClient />;
}
