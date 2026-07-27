import { redirect } from "next/navigation";

import { checkPermission } from "@/lib/auth/role-gate";
import { createClient } from "@/lib/supabase/server";

import AutoApplyOpsLoader from "./AutoApplyOpsLoader";

// Server-side owner gate (AUDIT_NAV_CONSOLIDATION.md finding #3) — the client
// component below still runs its own owner/admin check for UX, but that check
// only hides content after the JS bundle has already loaded. This redirect is
// the real barrier, matching the pattern used by /admin and /admin/orgs.
//
// AutoApplyOpsLoader (not the chart-heavy client itself) is rendered here
// because next/dynamic's ssr:false requires a Client Component boundary —
// this file must stay a Server Component to run the redirect.
export default async function Page() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { allowed } = await checkPermission(user.id, "owner", supabase);
  if (!allowed) {
    redirect("/dashboard?notice=owner_required");
  }

  return <AutoApplyOpsLoader />;
}
