import type { Metadata } from "next";
import AiGrantWritingSoftwareClient from "./AiGrantWritingSoftwareClient";
import { marketingMetadata } from "@/lib/marketing/seo";

export const metadata: Metadata = marketingMetadata(
  "/solutions/ai-grant-writing-software",
  "AI Grant Writing Software",
  "AI grant writing software that drafts from your organization's own knowledge base and past-award narratives, cited to source, with an explicit instruction not to invent statistics beyond what was retrieved."
);

export default function AiGrantWritingSoftwarePage() {
  return <AiGrantWritingSoftwareClient />;
}
