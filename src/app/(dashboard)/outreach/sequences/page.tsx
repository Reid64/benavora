import { redirect } from "next/navigation";

/**
 * This feature area is no longer separately maintained — Email's sequence
 * engine (/email/campaigns, backed by email_campaign_sequences) is canonical.
 * Its own backing table (`followup_sequences`) was never applied to
 * production — see OUTREACH_CONSOLIDATION_AUDIT.md's "2026-08-13 findings"
 * sections for the full investigation and the still-open decision on whether
 * to ever build it.
 */
export default function OutreachSequencesPage() {
  redirect("/email/campaigns");
}
