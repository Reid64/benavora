"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Award,
  BookText,
  ExternalLink,
  History,
  Pencil,
  ShieldOff,
  Sparkles,
} from "lucide-react";

import {
  Badge,
  Button,
  Card,
  EmptyState,
  LoadingSpinner,
  Modal,
  Select,
} from "@/components/ui";
import { MarkdownContent } from "@/components/knowledge-base/MarkdownContent";
import { NarrativeEditor } from "@/components/knowledge-base/NarrativeEditor";
import { ProvenBadge } from "@/components/knowledge-base/ProvenBadge";
import { createClient } from "@/lib/supabase/client";
import { canEdit, useProfile } from "@/lib/hooks/useProfile";
import { NARRATIVE_CATEGORIES } from "@/lib/utils/constants";
import { formatDate, formatRelative, humanizeEnum } from "@/lib/utils/formatters";
import type { Enums, Tables } from "@/types/database";

type NarrativeCategory = Enums<"knowledge_base_category">;

const CATEGORY_OPTIONS = NARRATIVE_CATEGORIES.map((value) => ({
  value,
  label: humanizeEnum(value),
}));

/** One draft version that cited this narrative, with its opportunity label. */
type UsageEntry = {
  versionId: string;
  versionNumber: number;
  templateType: string;
  source: string;
  createdAt: string;
  opportunityId: string;
  opportunityName: string | null;
  applicationId: string | null;
};

export type NarrativeDetailProps = {
  narrativeId: string;
};

/**
 * Knowledge Base narrative detail view (BLUEPRINT §4.7). Renders the full
 * narrative as rich text, lets editors change its category inline or open the
 * full editor, toggle proven status, and see the usage history of drafts that
 * cited it. All reads are RLS-scoped to the organization; writes derive
 * organization_id from the session profile.
 */
export function NarrativeDetail({ narrativeId }: NarrativeDetailProps) {
  const router = useRouter();
  const { profile } = useProfile();
  const editable = canEdit(profile?.role);
  // Proven status is normally maintained by the Recursive Learning Agent
  // (Behavioral Contracts §8); a manual override here is reserved for
  // owners/admins, mirroring the proven-narrative deletion gate (§8).
  const canToggleProven =
    profile?.role === "owner" || profile?.role === "admin";

  const [narrative, setNarrative] =
    useState<Tables<"knowledge_base"> | null>(null);
  const [effectivenessScore, setEffectivenessScore] = useState<number | null>(
    null,
  );
  const [usage, setUsage] = useState<UsageEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [updatingCategory, setUpdatingCategory] = useState(false);
  const [togglingProven, setTogglingProven] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();

    const { data: entry, error: entryError } = await supabase
      .from("knowledge_base")
      .select("*")
      .eq("id", narrativeId)
      .single();

    if (entryError || !entry) {
      setError("This narrative could not be found.");
      setLoading(false);
      return;
    }
    setNarrative(entry);

    // Best effectiveness score the learning system recorded for this entry.
    const { data: provenRows } = await supabase
      .from("proven_narratives")
      .select("effectiveness_score")
      .eq("knowledge_base_id", narrativeId);
    const best = (provenRows ?? []).reduce<number | null>((max, row) => {
      const score = row.effectiveness_score;
      if (score == null) return max;
      return max == null || score > max ? score : max;
    }, null);
    setEffectivenessScore(best);

    // Usage history: every saved draft version whose knowledge_sources cite
    // this entry (jsonb containment). draft_versions is org-isolated by RLS.
    const { data: versions } = await supabase
      .from("draft_versions")
      .select(
        "id, version_number, template_type, source, created_at, opportunity_id, application_id",
      )
      .contains("knowledge_sources", [
        { id: narrativeId, kind: "knowledge_base" },
      ])
      .order("created_at", { ascending: false });

    const rows = versions ?? [];
    const oppIds = [...new Set(rows.map((r) => r.opportunity_id))];
    const nameById = new Map<string, string>();
    if (oppIds.length) {
      const { data: opps } = await supabase
        .from("opportunities")
        .select("id, name")
        .in("id", oppIds);
      for (const opp of opps ?? []) {
        nameById.set(opp.id as string, opp.name as string);
      }
    }

    setUsage(
      rows.map((r) => ({
        versionId: r.id as string,
        versionNumber: r.version_number as number,
        templateType: r.template_type as string,
        source: r.source as string,
        createdAt: r.created_at as string,
        opportunityId: r.opportunity_id as string,
        opportunityName: nameById.get(r.opportunity_id as string) ?? null,
        applicationId: (r.application_id as string | null) ?? null,
      })),
    );
    setLoading(false);
  }, [narrativeId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCategoryChange(next: NarrativeCategory) {
    if (!narrative || next === narrative.category) return;
    setUpdatingCategory(true);
    setError(null);
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("knowledge_base")
      .update({ category: next, updated_at: new Date().toISOString() })
      .eq("id", narrative.id);
    setUpdatingCategory(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    await load();
  }

  async function handleToggleProven() {
    if (!narrative || !canToggleProven) return;
    setTogglingProven(true);
    setError(null);
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("knowledge_base")
      .update({
        is_proven: !narrative.is_proven,
        updated_at: new Date().toISOString(),
      })
      .eq("id", narrative.id);
    setTogglingProven(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    // Re-load so the badge and the overview's proven count reflect the change
    // (the overview re-queries knowledge_base on each visit).
    await load();
  }

  const usageByOpportunity = useMemo(() => {
    const groups = new Map<string, UsageEntry[]>();
    for (const entry of usage) {
      const list = groups.get(entry.opportunityId) ?? [];
      list.push(entry);
      groups.set(entry.opportunityId, list);
    }
    return [...groups.values()];
  }, [usage]);

  if (loading) {
    return <LoadingSpinner center label="Loading narrative..." />;
  }

  if (error && !narrative) {
    return (
      <EmptyState
        icon={BookText}
        title="Narrative unavailable"
        description={error}
        action={
          <Button
            variant="secondary"
            onClick={() => router.push("/knowledge-base/narratives")}
          >
            Back to narratives
          </Button>
        }
      />
    );
  }

  if (!narrative) return null;

  return (
    <div className="space-y-6">
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-navy-900">
              {narrative.title}
            </h1>
            <Badge color="indigo">{humanizeEnum(narrative.category)}</Badge>
            <ProvenBadge
              isProven={narrative.is_proven}
              provenCount={narrative.proven_count}
              effectivenessScore={effectivenessScore}
            />
          </div>
          <p className="mt-1 text-sm text-navy-500">
            Version {narrative.version ?? 1} · created{" "}
            {formatDate(narrative.created_at)} · updated{" "}
            {formatRelative(narrative.updated_at)}
          </p>
        </div>
        {editable && (
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="secondary" onClick={() => setEditorOpen(true)}>
              <Pencil className="h-4 w-4" aria-hidden />
              Edit
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Content */}
        <div className="space-y-6 lg:col-span-2">
          <Card title="Narrative content">
            <MarkdownContent content={narrative.content} />
          </Card>

          <Card title="Usage history" description="Drafts that cited this narrative.">
            {usage.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <History className="h-6 w-6 text-navy-300" aria-hidden />
                <p className="text-sm text-navy-500">
                  No drafts have cited this narrative yet. It will appear here
                  once the Draft Generator weaves it into an application.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {usageByOpportunity.map((group) => {
                  const first = group[0];
                  return (
                    <div key={first?.opportunityId}>
                      <div className="flex items-center justify-between gap-3">
                        <h4 className="truncate text-sm font-semibold text-navy-900">
                          {first?.opportunityName ?? "Untitled opportunity"}
                        </h4>
                        <span className="shrink-0 text-xs text-navy-400">
                          {group.length} draft{group.length === 1 ? "" : "s"}
                        </span>
                      </div>
                      <ul className="mt-2 space-y-1.5">
                        {group.map((entry) => {
                          const href = entry.applicationId
                            ? `/draft-generator/${entry.applicationId}`
                            : `/draft-generator?opportunity=${entry.opportunityId}`;
                          return (
                            <li
                              key={entry.versionId}
                              className="flex items-center justify-between gap-3 rounded-lg border border-navy-200 px-3 py-2 transition hover:border-teal-300"
                            >
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-sm font-medium text-navy-800">
                                    Version {entry.versionNumber}
                                  </span>
                                  <Badge color="gray">
                                    {humanizeEnum(entry.templateType)}
                                  </Badge>
                                  {entry.source !== "generated" && (
                                    <Badge color="blue">
                                      {humanizeEnum(entry.source)}
                                    </Badge>
                                  )}
                                </div>
                                <p className="mt-0.5 text-xs text-navy-400">
                                  {formatRelative(entry.createdAt)}
                                </p>
                              </div>
                              <Link
                                href={href}
                                className="inline-flex shrink-0 items-center gap-1 text-sm text-teal-600 hover:text-teal-700"
                              >
                                Open draft
                                <ExternalLink
                                  className="h-3.5 w-3.5"
                                  aria-hidden
                                />
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        {/* Sidebar: category, proven status, metadata */}
        <div className="space-y-6">
          <Card title="Category">
            <Select
              label="Assigned category"
              options={CATEGORY_OPTIONS}
              value={narrative.category}
              disabled={!editable || updatingCategory}
              onChange={(e) =>
                void handleCategoryChange(e.target.value as NarrativeCategory)
              }
              helperText={
                editable
                  ? "Drives which templates draw on this narrative."
                  : "You have read-only access."
              }
            />
          </Card>

          <Card title="Proven status">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-navy-800">
                  {narrative.is_proven ? "Proven" : "Not yet proven"}
                </p>
                <p className="mt-0.5 text-xs text-navy-500">
                  {narrative.is_proven
                    ? `Cited in ${narrative.proven_count ?? 0} awarded application${
                        (narrative.proven_count ?? 0) === 1 ? "" : "s"
                      }.`
                    : "Normally set automatically when an awarded application cites it."}
                </p>
              </div>
            </div>
            {canToggleProven ? (
              <Button
                variant={narrative.is_proven ? "secondary" : "primary"}
                size="sm"
                className="mt-3"
                onClick={handleToggleProven}
                isLoading={togglingProven}
              >
                {narrative.is_proven ? (
                  <>
                    <ShieldOff className="h-4 w-4" aria-hidden />
                    Mark as unproven
                  </>
                ) : (
                  <>
                    <Award className="h-4 w-4" aria-hidden />
                    Mark as proven
                  </>
                )}
              </Button>
            ) : (
              <p className="mt-3 text-xs text-navy-400">
                Only an owner or admin can override proven status.
              </p>
            )}
          </Card>

          {(narrative.keywords?.length ||
            narrative.funder_categories?.length) && (
            <Card title="Tags">
              <div className="flex flex-wrap items-center gap-2">
                {(narrative.funder_categories ?? []).map((category) => (
                  <Badge key={category} color="gray">
                    {humanizeEnum(category)}
                  </Badge>
                ))}
                {(narrative.keywords ?? []).map((keyword) => (
                  <Badge key={keyword} color="blue">
                    {keyword}
                  </Badge>
                ))}
              </div>
            </Card>
          )}

          <Card title="Details">
            <dl className="divide-y divide-navy-100">
              <div className="flex items-center justify-between py-2.5">
                <dt className="text-xs font-semibold uppercase tracking-wide text-navy-500">
                  Created
                </dt>
                <dd className="text-sm text-navy-800">
                  {formatDate(narrative.created_at)}
                </dd>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <dt className="text-xs font-semibold uppercase tracking-wide text-navy-500">
                  Last modified
                </dt>
                <dd className="text-sm text-navy-800">
                  {formatDate(narrative.updated_at)}
                </dd>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <dt className="text-xs font-semibold uppercase tracking-wide text-navy-500">
                  Version
                </dt>
                <dd className="text-sm text-navy-800">
                  {narrative.version ?? 1}
                </dd>
              </div>
            </dl>
          </Card>
        </div>
      </div>

      {/* Edit modal - reuses the shared editor (saves to Supabase, bumps version). */}
      <Modal
        isOpen={editorOpen}
        onClose={() => setEditorOpen(false)}
        title="Edit narrative"
        size="xl"
      >
        <NarrativeEditor
          narrative={narrative}
          organizationId={profile?.organization_id ?? null}
          authorId={profile?.id ?? null}
          onCancel={() => setEditorOpen(false)}
          onSaved={(updated) => {
            setEditorOpen(false);
            setNarrative(updated);
            void load();
          }}
        />
      </Modal>

      {!editable && (
        <p className="flex items-center gap-1.5 text-xs text-navy-400">
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          Your role is read-only. You can view this narrative but not edit it.
        </p>
      )}
    </div>
  );
}

