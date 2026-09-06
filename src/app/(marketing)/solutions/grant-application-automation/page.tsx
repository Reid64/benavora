import type { Metadata } from "next";
import GrantApplicationAutomationClient from "./GrantApplicationAutomationClient";
import { marketingMetadata } from "@/lib/marketing/seo";

export const metadata: Metadata = marketingMetadata(
  "/solutions/grant-application-automation",
  "Grant Application Automation",
  "Grant application automation that fills a funder's own portal fields from an approved draft, gated by readiness checks, rate limits, and a ten-factor risk score, and pauses for a human at any CAPTCHA or verification wall."
);

export default function GrantApplicationAutomationPage() {
  return <GrantApplicationAutomationClient />;
}
