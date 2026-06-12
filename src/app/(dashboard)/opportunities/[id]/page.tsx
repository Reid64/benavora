import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { OpportunityDetail } from "@/components/opportunities/OpportunityDetail";

/**
 * Opportunity detail page (BLUEPRINT §4.4). Renders the tabbed detail view; all
 * data loading and RLS-scoped reads happen in the client OpportunityDetail
 * component. The id comes from the route, not from any request body.
 */
export default function OpportunityDetailPage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <div className="space-y-6">
      <Link
        href="/opportunities"
        className="inline-flex items-center gap-1.5 text-sm text-navy-500 transition hover:text-navy-700"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to opportunities
      </Link>
      <OpportunityDetail opportunityId={params.id} />
    </div>
  );
}
