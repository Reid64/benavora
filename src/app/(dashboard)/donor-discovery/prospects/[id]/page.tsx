import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { ProspectDetail } from "@/components/donor-discovery/ProspectDetail";

/**
 * Donor Discovery prospect detail page (DONOR_DISCOVERY_ARCHITECTURE.md §4).
 * All data loading and RLS-scoped reads happen in the client ProspectDetail
 * component. The id comes from the route, not from any request body.
 */
export default function ProspectDetailPage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <div className="space-y-6">
      <Link
        href="/donor-discovery/prospects"
        className="inline-flex items-center gap-1.5 text-sm text-navy-500 transition hover:text-navy-700"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to prospects
      </Link>
      <ProspectDetail prospectId={params.id} />
    </div>
  );
}
