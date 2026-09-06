import type { Metadata } from "next";
import GrantDeadlineTrackingClient from "./GrantDeadlineTrackingClient";
import { marketingMetadata } from "@/lib/marketing/seo";

export const metadata: Metadata = marketingMetadata(
  "/solutions/grant-deadline-tracking",
  "Grant Deadline Tracking",
  "Grant deadline tracking that extracts every deadline it finds, predicts the ones a funder hasn't posted yet from that funder's own history, and tiers reminders by urgency instead of one generic alert."
);

export default function GrantDeadlineTrackingPage() {
  return <GrantDeadlineTrackingClient />;
}
