import { redirect } from "next/navigation";

/**
 * Consolidated onto Email's sequence engine (/email/campaigns, backed by
 * email_campaign_sequences) — see OUTREACH_CONSOLIDATION_AUDIT.md's
 * "consolidation execution" sections. This page's own backing tables
 * (email_campaigns/campaign_steps/campaign_sends) are no longer written to
 * from any UI; their one real row set was migrated to the new schema and
 * left in place for history.
 */
export default function OutreachCampaignsPage() {
  redirect("/email/campaigns");
}
