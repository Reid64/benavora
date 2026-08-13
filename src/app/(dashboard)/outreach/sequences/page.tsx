"use client";

import Link from "next/link";
import { ArrowLeft, ListChecks } from "lucide-react";

import { EmptyState } from "@/components/ui";

/**
 * Its backing table (`followup_sequences`) was authored in
 * supabase/migrations/083_followup_sequences.sql but was never applied to
 * production - see OUTREACH_CONSOLIDATION_AUDIT.md's "2026-08-13 findings"
 * section for the full investigation and options. Until that's resolved,
 * this shows an honest not-available state instead of firing a request that
 * always 500s.
 */
export default function OutreachSequencesPage() {
  return (
    <div className="space-y-6">
      <Link
        href="/outreach"
        className="inline-flex items-center gap-1.5 text-sm text-navy-500 transition hover:text-navy-700"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to outreach
      </Link>

      <div>
        <h1 className="text-2xl font-bold tracking-tight text-primary">
          Follow-Up Sequences
        </h1>
        <p className="mt-1 text-sm text-navy-500">
          Multi-step sequences applications enroll into on stage changes like submission, award, or denial.
        </p>
      </div>

      <EmptyState
        icon={ListChecks}
        title="Not available yet"
        description="Follow-up sequences are still being built out on the backend. Check back soon."
      />
    </div>
  );
}
