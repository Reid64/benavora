"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, KanbanSquare } from "lucide-react";

import { Button, Card, EmptyState, LoadingSpinner } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { canEdit, useProfile } from "@/lib/hooks/useProfile";

/**
 * Create an application for a given opportunity (the "Apply" action used from
 * the Research Command Center and the Opportunities list). The opportunity id
 * comes from ?opportunityId=. If the opportunity already has an application we
 * jump straight to it; otherwise the writer confirms and we create one in the
 * "discovered" stage, record the pipeline history, and open the detail page.
 */
function NewApplicationInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { profile } = useProfile();
  const editable = canEdit(profile?.role);
  const opportunityId = searchParams.get("opportunityId");

  const [loading, setLoading] = useState(true);
  const [opportunityName, setOpportunityName] = useState<string | null>(null);
  const [existingApplicationId, setExistingApplicationId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!opportunityId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const [oppRes, appRes] = await Promise.all([
      supabase.from("opportunities").select("name").eq("id", opportunityId).maybeSingle(),
      supabase
        .from("applications")
        .select("id")
        .eq("opportunity_id", opportunityId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    setOpportunityName((oppRes.data?.name as string | null) ?? null);
    setExistingApplicationId((appRes.data?.id as string | null) ?? null);
    setLoading(false);
  }, [opportunityId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate() {
    if (!opportunityId || !profile?.organization_id) {
      setError("Your session could not be verified.");
      return;
    }
    setCreating(true);
    setError(null);
    const supabase = createClient();
    const { data: created, error: insertError } = await supabase
      .from("applications")
      .insert({
        organization_id: profile.organization_id,
        opportunity_id: opportunityId,
        stage: "discovered",
      })
      .select("id")
      .single();

    if (insertError || !created) {
      setError(insertError?.message ?? "Could not create the application.");
      setCreating(false);
      return;
    }

    await supabase.from("pipeline_history").insert({
      organization_id: profile.organization_id,
      application_id: created.id as string,
      from_stage: null,
      to_stage: "discovered",
      changed_by: profile.id,
      notes: "Created from an opportunity.",
    });

    router.push(`/applications/${created.id as string}`);
    router.refresh();
  }

  if (loading) {
    return <LoadingSpinner center label="Loading..." />;
  }

  if (!opportunityId) {
    return (
      <EmptyState
        icon={KanbanSquare}
        title="No opportunity selected"
        description="Open an opportunity and choose Apply to start an application."
        action={
          <Link href="/opportunities">
            <Button variant="secondary">Browse opportunities</Button>
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <Link
        href="/opportunities"
        className="inline-flex items-center gap-1.5 text-sm text-navy-500 transition hover:text-navy-700"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to opportunities
      </Link>

      <Card title="Start an application">
        <div className="space-y-4">
          <p className="text-sm text-navy-600">
            {opportunityName
              ? `Create an application for "${opportunityName}".`
              : "Create an application for this opportunity."}
          </p>

          {error && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {error}
            </div>
          )}

          {existingApplicationId ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-navy-500">
                An application already exists for this opportunity.
              </p>
              <Link href={`/applications/${existingApplicationId}`}>
                <Button>Open existing application</Button>
              </Link>
            </div>
          ) : editable ? (
            <Button onClick={handleCreate} isLoading={creating}>
              <KanbanSquare className="h-4 w-4" aria-hidden />
              Create application
            </Button>
          ) : (
            <p className="text-sm text-navy-500">
              Your role is read-only and cannot create applications.
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}

export default function NewApplicationPage() {
  return (
    <Suspense fallback={<LoadingSpinner center label="Loading..." />}>
      <NewApplicationInner />
    </Suspense>
  );
}
