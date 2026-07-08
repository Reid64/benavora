"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Search } from "lucide-react";

import { Button, EmptyState } from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  OpportunityTable,
  type OpportunityRow,
} from "@/components/opportunities/OpportunityTable";
import { createClient } from "@/lib/supabase/client";
import { canEdit, useProfile } from "@/lib/hooks/useProfile";

/**
 * Opportunity list (BLUEPRINT §4.4). Reads are RLS-scoped to the organization,
 * so no organization_id filter is needed client-side. Keyword tags (from the
 * opportunity_keywords many-to-many table) and funder names are joined in for
 * search and display.
 */
export default function OpportunitiesPage() {
  const { profile } = useProfile();
  const [opportunities, setOpportunities] = useState<OpportunityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const supabase = createClient();

    (async () => {
      setLoading(true);
      setError(null);

      const [oppsRes, fundersRes, keywordsRes, appsRes] = await Promise.all([
        supabase
          .from("opportunities")
          .select("*")
          .order("match_percentage", { ascending: false, nullsFirst: false }),
        supabase.from("funders").select("id, name"),
        supabase
          .from("opportunity_keywords")
          .select("opportunity_id, keyword"),
        supabase
          .from("applications")
          .select("opportunity_id, stage, created_at"),
      ]);

      if (!active) return;

      if (oppsRes.error) {
        setError("Could not load opportunities.");
        setLoading(false);
        return;
      }

      const funderNames = new Map<string, string>();
      for (const f of fundersRes.data ?? []) {
        funderNames.set(f.id, f.name);
      }

      const keywordsByOpp = new Map<string, string[]>();
      for (const row of keywordsRes.data ?? []) {
        const list = keywordsByOpp.get(row.opportunity_id) ?? [];
        list.push(row.keyword);
        keywordsByOpp.set(row.opportunity_id, list);
      }

      // Most-recent application stage per opportunity (TASK 9).
      const stageByOpp = new Map<string, { stage: string; created_at: string }>();
      for (const a of appsRes.data ?? []) {
        const prev = stageByOpp.get(a.opportunity_id);
        if (!prev || a.created_at > prev.created_at) {
          stageByOpp.set(a.opportunity_id, { stage: a.stage, created_at: a.created_at });
        }
      }

      const rows: OpportunityRow[] = (oppsRes.data ?? []).map((opp) => ({
        ...opp,
        keywords: keywordsByOpp.get(opp.id) ?? [],
        funderName: opp.funder_id
          ? (funderNames.get(opp.funder_id) ?? null)
          : null,
        applicationStage: stageByOpp.get(opp.id)?.stage ?? null,
      }));

      setOpportunities(rows);
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, []);

  const editable = canEdit(profile?.role);
  const showEmpty = !loading && !error && opportunities.length === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Opportunities"
        description="Grants, donation programs, and sponsorships you're tracking."
        align="center"
        actions={
          editable && (
            <Link href="/opportunities/new">
              <Button>
                <Plus className="h-4 w-4" aria-hidden />
                New opportunity
              </Button>
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
          icon={Search}
          title="No opportunities yet"
          description="Add your first funding opportunity to start tracking deadlines, eligibility, and applications."
          action={
            editable ? (
              <Link href="/opportunities/new">
                <Button>
                  <Plus className="h-4 w-4" aria-hidden />
                  New opportunity
                </Button>
              </Link>
            ) : undefined
          }
        />
      ) : (
        <OpportunityTable opportunities={opportunities} isLoading={loading} />
      )}
    </div>
  );
}
