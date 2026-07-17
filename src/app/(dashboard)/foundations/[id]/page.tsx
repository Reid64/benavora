import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { FoundationDetail } from "@/components/foundations/FoundationDetail";

export default function FoundationDetailPage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <div className="min-h-screen space-y-6 bg-[#EEF2F7] p-6">
      <Link
        href="/foundations"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-slate-700"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to foundations
      </Link>
      <FoundationDetail foundationId={params.id} />
    </div>
  );
}
