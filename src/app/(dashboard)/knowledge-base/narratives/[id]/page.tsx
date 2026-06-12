import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { NarrativeDetail } from "@/components/knowledge-base/NarrativeDetail";

/**
 * Narrative detail page (BLUEPRINT §4.7). Renders the detail view; all data
 * loading and RLS-scoped reads happen in the client NarrativeDetail component.
 * The id comes from the route, not from any request body.
 */
export default function NarrativeDetailPage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <div className="space-y-6">
      <Link
        href="/knowledge-base/narratives"
        className="inline-flex items-center gap-1.5 text-sm text-navy-500 transition hover:text-navy-700"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to narratives
      </Link>
      <NarrativeDetail narrativeId={params.id} />
    </div>
  );
}
