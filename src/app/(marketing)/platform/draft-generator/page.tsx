import type { Metadata } from "next";
import DraftGeneratorClient from "./DraftGeneratorClient";
import { marketingMetadata } from "@/lib/marketing/seo";

export const metadata: Metadata = marketingMetadata(
  "/platform/draft-generator",
  "Draft Generator — Prepare and Draft Grant Narratives From Your Own Knowledge Base",
  "A 4-step wizard that drafts grant narratives, letters, and budget justifications from your organization's own knowledge base and narratives proven by real award outcomes — every draft edited and saved by a human before it goes anywhere."
);

export default function DraftGeneratorPage() {
  return <DraftGeneratorClient />;
}
