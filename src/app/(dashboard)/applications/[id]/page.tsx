import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { ApplicationDetail } from "@/components/applications/ApplicationDetail";

/**
 * Application detail page (BLUEPRINT §4.5). Renders the tabbed detail view with
 * the pipeline timeline; all data loading and RLS-scoped reads happen in the
 * client ApplicationDetail component. The id comes from the route, not from any
 * request body.
 */
export default function ApplicationDetailPage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <div className="space-y-6">
      <Link
        href="/applications"
        className="inline-flex items-center gap-1.5 text-sm text-navy-500 transition hover:text-navy-700"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to applications
      </Link>
      <ApplicationDetail applicationId={params.id} />
    </div>
  );
}
