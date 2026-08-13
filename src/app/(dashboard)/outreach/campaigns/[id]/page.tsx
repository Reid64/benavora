import { redirect } from "next/navigation";

/**
 * Consolidated onto Email's sequence engine — see
 * OUTREACH_CONSOLIDATION_AUDIT.md's "consolidation execution" sections. No
 * id mapping exists between the deprecated email_campaigns schema and
 * email_campaign_sequences, so this redirects to the list rather than a
 * specific sequence.
 */
export default function OutreachCampaignDetailPage() {
  redirect("/email/campaigns");
}
