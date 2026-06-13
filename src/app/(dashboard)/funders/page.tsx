"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Building2, Plus } from "lucide-react";

import { Button, EmptyState } from "@/components/ui";
import { FunderTable, type FunderRow } from "@/components/funders/FunderTable";
import { createClient } from "@/lib/supabase/client";
import { canEdit, useProfile } from "@/lib/hooks/useProfile";

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

  useEffect(() => {
    let active = true;
    const supabase = createClient();

    (async () => {
      setLoading(true);
      setError(null);

      const [fundersRes, contactsRes, openOppsRes] = await Promise.all([
        supabase
          .from("funders")
          .select("*")
          .order("name", { ascending: true }),
        supabase.from("contacts").select("funder_id"),
        supabase
          .from("opportunities")
          .select("funder_id")
          .eq("status", "open"),
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

      const rows: FunderRow[] = (fundersRes.data ?? []).map((funder) => ({
        ...funder,
        contactCount: contactCounts.get(funder.id) ?? 0,
        openOpportunityCount: openOppCounts.get(funder.id) ?? 0,
      }));

      setFunders(rows);
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, []);

  const editable = canEdit(profile?.role);
  const showEmpty = !loading && !error && funders.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-navy-900">
            Funders
          </h1>
          <p className="mt-1 text-sm text-navy-500">
            Corporations, foundations, and agencies you track for funding.
          </p>
        </div>
        {editable && (
          <Link href="/funders/new">
            <Button>
              <Plus className="h-4 w-4" aria-hidden />
              New funder
            </Button>
          </Link>
        )}
      </div>

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
              <Link href="/funders/new">
                <Button>
                  <Plus className="h-4 w-4" aria-hidden />
                  New funder
                </Button>
              </Link>
            ) : undefined
          }
        />
      ) : (
        <FunderTable funders={funders} isLoading={loading} />
      )}
    </div>
  );
}
