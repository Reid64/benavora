import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { FunderRelationshipBuilder } from "@/components/funders/FunderRelationshipBuilder";

/**
 * Relationship Builder page (registry #101). Shows the funder's existing
 * Gen-1 event-sourced relationship score (unchanged
 * /api/funders/[id]/relationship route) alongside AG-19
 * RelationshipBuilderAgent's real output (new /api/funders/[id]/
 * relationship-builder route). All data loading happens client-side in
 * FunderRelationshipBuilder; the id comes from the route, not a request body.
 */
export default function FunderRelationshipBuilderPage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <div className="space-y-6">
      <Link
        href={`/funders/${params.id}`}
        className="inline-flex items-center gap-1.5 text-sm text-navy-500 transition hover:text-navy-700"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to funder
      </Link>
      <FunderRelationshipBuilder funderId={params.id} />
    </div>
  );
}
