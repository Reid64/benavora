import { redirect } from "next/navigation";

// Billing management lives at /billing (BLUEPRINT Phase 5). The Settings nav
// links there directly (see settings/layout.tsx); this route exists so a
// direct visit to /settings/billing still lands somewhere useful instead of
// 404ing, rather than duplicating that page's UI and data-fetching here.
export default function SettingsBillingRedirect() {
  redirect("/billing");
}
