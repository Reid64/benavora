"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Building2, CheckCircle, Plus } from "lucide-react";

import { EmptyState } from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";
import { FunderCardGrid } from "@/components/funders/FunderCardGrid";
import type { FunderRow } from "@/components/funders/FunderTable";
import { createClient } from "@/lib/supabase/client";
import { canEdit, useProfile } from "@/lib/hooks/useProfile";

// Research & Discovery section treatment — PAGE_TREATMENT_PROTOCOL_V2.md /
// DESIGN_SYSTEM_V2_ASSIGNMENT.md. Frame: Bronze. Secondary accent: Slate
// Blue. 2026-08-18: confirmed via live getComputedStyle audit this page
// never received the v2 rollout - same real gap as AutoApply's.
const SECTION_ACCENT = "#A4712C";
const CTA_TEAL_BG = "#A4712C";
const CTA_TEAL_TEXT = "#F8F5EE";

/**
 * Funder list (BLUEPRINT §4.2). Reads are RLS-scoped to the organization, so
 * no organization_id filter is needed client-side - the policy enforces it.
 * Contact and open-opportunity counts are aggregated per funder.
 */
export default function FundersPage() {
  const { profile } = useProfile();
  const [funders, setFunders] = useState<FunderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [queuedFunderIds, setQueuedFunderIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const supabase = createClient();

    (async () => {
      setLoading(true);
      setError(null);

      const [fundersRes, contactsRes, openOppsRes, scoresRes, queueRes] = await Promise.all([
        supabase
          .from("funders")
          .select("*")
          .order("name", { ascending: true })
          .limit(1000),
        supabase.from("contacts").select("funder_id"),
        supabase
          .from("opportunities")
          .select("funder_id")
          .eq("status", "open"),
        supabase
          .from("funder_relationship_scores")
          .select("funder_id, relationship_score, is_stale"),
        supabase
          .from("submission_queue")
          .select("funder_id")
          .in("status", ["pending", "processing"]),
      ]);

      if (!active) return;

      if (fundersRes.error) {
        setError("Could not load funders.");
        setLoading(false);
        return;
      }

      const contactCounts = new Map<string, number>();
      for (const row of contactsRes.data ?? []) {
        if (!row.funder_id) continue;
        contactCounts.set(
          row.funder_id,
          (contactCounts.get(row.funder_id) ?? 0) + 1,
        );
      }

      const openOppCounts = new Map<string, number>();
      for (const row of openOppsRes.data ?? []) {
        if (!row.funder_id) continue;
        openOppCounts.set(
          row.funder_id,
          (openOppCounts.get(row.funder_id) ?? 0) + 1,
        );
      }

      const staleMap = new Map<string, boolean>();
      const scoreMap = new Map<string, number>();
      for (const row of scoresRes.data ?? []) {
        if (!row.funder_id) continue;
        staleMap.set(row.funder_id, (row.is_stale as boolean) ?? false);
        scoreMap.set(row.funder_id, (row.relationship_score as number) ?? 0);
      }

      const queued = new Set(
        (queueRes.data ?? [])
          .map((r) => r.funder_id)
          .filter((id): id is string => id !== null),
      );
      setQueuedFunderIds(queued);

      const rows: FunderRow[] = (fundersRes.data ?? []).map((funder) => ({
        ...funder,
        contactCount: contactCounts.get(funder.id) ?? 0,
        openOpportunityCount: openOppCounts.get(funder.id) ?? 0,
        relationshipScore: scoreMap.get(funder.id) ?? null,
        isStale: staleMap.get(funder.id) ?? false,
      }));

      setFunders(rows);
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, []);

  async function handleQueueSelected(ids: string[]) {
    const res = await fetch("/api/autoapply/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ funder_ids: ids }),
    });

    const data = (await res.json()) as { queued?: number; skipped?: number };
    const queued = data.queued ?? 0;

    // Mark these funders as queued locally so checkboxes disable immediately.
    setQueuedFunderIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });

    setToast(`Queued ${queued} funder${queued !== 1 ? "s" : ""} for AutoApply`);
    setTimeout(() => setToast(null), 4000);
  }

  const editable = canEdit(profile?.role);
  const showEmpty = !loading && !error && funders.length === 0;

  return (
    <div className="min-h-screen space-y-6 p-6 page-bg">
      <PageHeader
        title="Funders"
        accent={SECTION_ACCENT}
        description="Corporations, foundations, and agencies you track for funding."
        actions={
          editable && (
            <Link
              href="/funders/new"
              style={{ backgroundColor: CTA_TEAL_BG, color: CTA_TEAL_TEXT }}
              className="flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold shadow-sm transition-colors hover:brightness-95"
            >
              <Plus className="h-4 w-4" aria-hidden />
              New funder
            </Link>
          )
        }
      />

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {showEmpty ? (
        <EmptyState
          icon={Building2}
          title="No funders yet"
          description="Add your first funder to start tracking funding sources, contacts, and opportunities."
          action={
            editable ? (
              <Link
                href="/funders/new"
                style={{ backgroundColor: CTA_TEAL_BG, color: CTA_TEAL_TEXT }}
                className="flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold shadow-sm transition-colors hover:brightness-95"
              >
                <Plus className="h-4 w-4" aria-hidden />
                New funder
              </Link>
            ) : undefined
          }
        />
      ) : (
        <FunderCardGrid
          funders={funders}
          isLoading={loading}
          queuedFunderIds={queuedFunderIds}
          onQueueSelected={handleQueueSelected}
        />
      )}

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed right-6 top-6 z-50 flex items-center gap-2 rounded-xl bg-success-text px-5 py-3 text-sm font-medium text-white shadow-xl"
        >
          <CheckCircle className="h-4 w-4 flex-shrink-0" aria-hidden />
          {toast}
        </div>
      )}
    </div>
  );
}
