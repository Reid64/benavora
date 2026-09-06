import type { Metadata } from "next";
import GrantMatchingSoftwareClient from "./GrantMatchingSoftwareClient";
import { marketingMetadata } from "@/lib/marketing/seo";

export const metadata: Metadata = marketingMetadata(
  "/solutions/grant-matching-software",
  "Grant Matching Software",
  "Grant matching software that scores your organization's real fit against funders two ways: instant keyword overlap against a foundation directory, and Claude-scored semantic alignment with stated reasoning."
);

export default function GrantMatchingSoftwarePage() {
  return <GrantMatchingSoftwareClient />;
}
