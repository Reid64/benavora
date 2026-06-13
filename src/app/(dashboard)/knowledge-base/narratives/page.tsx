"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, BookText, Pencil, Plus, Trash2 } from "lucide-react";

import {
  Badge,
  Button,
  Card,
  EmptyState,
  LoadingSpinner,
  Modal,
  Select,
} from "@/components/ui";
import { KnowledgeBaseNav } from "@/components/knowledge-base/KnowledgeBaseNav";
import { NarrativeEditor } from "@/components/knowledge-base/NarrativeEditor";
import { ProvenBadge } from "@/components/knowledge-base/ProvenBadge";
import { createClient } from "@/lib/supabase/client";
import { canEdit, useProfile } from "@/lib/hooks/useProfile";
import { useUrlState } from "@/lib/hooks/useUrlState";
import { NARRATIVE_CATEGORIES } from "@/lib/utils/constants";
import { formatRelative, humanizeEnum } from "@/lib/utils/formatters";
import type { Tables } from "@/types/database";

const CATEGORY_FILTER_OPTIONS = [
  { value: "", label: "All categories" },
  ...NARRATIVE_CATEGORIES.map((value) => ({
    value,
    label: humanizeEnum(value),
  })),
];

/**
 * Reusable narratives CRUD (BLUEPRINT §4.7). Lists every knowledge_base entry
 * except standard answers (the reserved "custom" category). Proven status and
 * effectiveness scores are read-only, surfaced from the learning system.
 */
export default function NarrativesPage() {
  const { profile } = useProfile();
  const { searchParams, setParams } = useUrlState();
  const editable = canEdit(profile?.role);
  const isOwner = profile?.role === "owner";

  const [narratives, setNarratives] = useState<Tables<"knowledge_base">[]>([]);
  const [scores, setScores] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The category filter lives in the URL so it survives sidebar navigation.
  const categoryParam = searchParams.get("category");
  const categoryFilter =
    categoryParam &&
    (NARRATIVE_CATEGORIES as readonly string[]).includes(categoryParam)
      ? categoryParam
      : "";

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Tables<"knowledge_base"> | null>(null);

  const [pendingDelete, setPendingDelete] =
    useState<Tables<"knowledge_base"> | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();

    const [kbRes, provenRes] = await Promise.all([
      supabase
        .from("knowledge_base")
        .select("*")
        .neq("category", "custom")
        .order("updated_at", { ascending: false }),
      // Best effectiveness score per source KB entry (Contracts §10).
      supabase
        .from("proven_narratives")
        .select("knowledge_base_id, effectiveness_score"),
    ]);

    if (kbRes.error) {
      setError("Could not load narratives.");
      setLoading(false);
      return;
    }

    const scoreMap = new Map<string, number>();
    for (const row of provenRes.data ?? []) {
      if (!row.knowledge_base_id || row.effectiveness_score == null) continue;
      const current = scoreMap.get(row.knowledge_base_id);
      if (current == null || row.effectiveness_score > current) {
        scoreMap.set(row.knowledge_base_id, row.effectiveness_score);
      }
    }

    setScores(scoreMap);
    setNarratives(kbRes.data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(
    () =>
      categoryFilter
        ? narratives.filter((n) => n.category === categoryFilter)
        : narratives,
    [narratives, categoryFilter],
  );

  function openCreate() {
    setEditing(null);
    setEditorOpen(true);
  }

  function openEdit(narrative: Tables<"knowledge_base">) {
    setEditing(narrative);
    setEditorOpen(true);
  }

  async function handleDelete() {
    if (!pendingDelete) return;
    // Deleting a proven narrative requires the owner role (Contracts §8).
    if (pendingDelete.is_proven && !isOwner) {
      setDeleteError("Only an owner can delete a proven narrative.");
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    const supabase = createClient();
    const { error: deleteErr } = await supabase
      .from("knowledge_base")
      .delete()
      .eq("id", pendingDelete.id);

    setDeleting(false);
    if (deleteErr) {
      setDeleteError(deleteErr.message);
      return;
    }
    setPendingDelete(null);
    await load();
  }

  const showEmpty = !loading && !error && narratives.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-navy-900">
            Narratives
          </h1>
          <p className="mt-1 text-sm text-navy-500">
            Reusable narrative blocks the AI weaves into drafts.
          </p>
        </div>
        {editable && (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" aria-hidden />
            New narrative
          </Button>
        )}
      </div>

      <KnowledgeBaseNav />

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {loading ? (
        <LoadingSpinner center label="Loading narratives..." />
      ) : showEmpty ? (
        <EmptyState
          icon={BookText}
          title="No narratives yet"
          description="Create reusable narrative blocks - mission, need, impact, capacity - to power AI drafting."
          action={
            editable ? (
              <Button onClick={openCreate}>
                <Plus className="h-4 w-4" aria-hidden />
                New narrative
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="max-w-xs">
            <Select
              options={CATEGORY_FILTER_OPTIONS}
              value={categoryFilter}
              onChange={(e) =>
                setParams({ category: e.target.value || null })
              }
              aria-label="Filter by category"
            />
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon={BookText}
              title="No narratives in this category"
              description="Try a different category filter."
            />
          ) : (
            <div className="space-y-4">
              {filtered.map((narrative) => (
                <Card
                  key={narrative.id}
                  className="relative transition hover:border-teal-300 hover:shadow-card-hover"
                >
                  {/* Whole-card click target opens the detail view. Action
                      buttons below sit above it via z-index. */}
                  <Link
                    href={`/knowledge-base/narratives/${narrative.id}`}
                    aria-label={`View ${narrative.title}`}
                    className="absolute inset-0 z-0 rounded-xl"
                  />
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-navy-900">
                          {narrative.title}
                        </h3>
                        <Badge color="indigo">
                          {humanizeEnum(narrative.category)}
                        </Badge>
                        <ProvenBadge
                          isProven={narrative.is_proven}
                          provenCount={narrative.proven_count}
                          effectivenessScore={scores.get(narrative.id)}
                        />
                      </div>
                      <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-navy-600">
                        {narrative.content}
                      </p>
                    </div>
                    {editable && (
                      <div className="relative z-10 flex shrink-0 items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openEdit(narrative)}
                          aria-label={`Edit ${narrative.title}`}
                        >
                          <Pencil className="h-4 w-4" aria-hidden />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setDeleteError(null);
                            setPendingDelete(narrative);
                          }}
                          aria-label={`Delete ${narrative.title}`}
                        >
                          <Trash2 className="h-4 w-4 text-red-500" aria-hidden />
                        </Button>
                      </div>
                    )}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
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
                    <span className="ml-auto text-xs text-navy-400">
                      v{narrative.version ?? 1} · updated{" "}
                      {formatRelative(narrative.updated_at)}
                    </span>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {/* Create / edit */}
      <Modal
        isOpen={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editing ? "Edit narrative" : "New narrative"}
        size="xl"
      >
        <NarrativeEditor
          narrative={editing ?? undefined}
          organizationId={profile?.organization_id ?? null}
          authorId={profile?.id ?? null}
          onCancel={() => setEditorOpen(false)}
          onSaved={() => {
            setEditorOpen(false);
            void load();
          }}
        />
      </Modal>

      {/* Delete confirmation */}
      <Modal
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Delete narrative"
        description="This cannot be undone."
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setPendingDelete(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleDelete}
              isLoading={deleting}
              disabled={Boolean(pendingDelete?.is_proven) && !isOwner}
            >
              Delete narrative
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-navy-600">
            Delete{" "}
            <span className="font-medium">{pendingDelete?.title}</span>?
          </p>
          {pendingDelete?.is_proven && (
            <div className="flex items-start gap-2 rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                This is a <strong>proven</strong> narrative
                {pendingDelete.proven_count
                  ? ` used in ${pendingDelete.proven_count} awarded application${
                      pendingDelete.proven_count === 1 ? "" : "s"
                    }`
                  : ""}
                .{" "}
                {isOwner
                  ? "Deleting it removes a pattern the learning system relies on."
                  : "Only an owner can delete a proven narrative."}
              </span>
            </div>
          )}
          {deleteError && (
            <p className="text-sm text-red-600" role="alert">
              {deleteError}
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}
