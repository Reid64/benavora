"use client";

import { useCallback, useEffect, useState } from "react";
import { HelpCircle, Pencil, Plus, Trash2 } from "lucide-react";

import {
  Button,
  Card,
  EmptyState,
  LoadingSpinner,
  Modal,
} from "@/components/ui";
import { KnowledgeBaseNav } from "@/components/knowledge-base/KnowledgeBaseNav";
import { AnswerEditor } from "@/components/knowledge-base/AnswerEditor";
import { createClient } from "@/lib/supabase/client";
import { canEdit, useProfile } from "@/lib/hooks/useProfile";
import { STANDARD_ANSWER_CATEGORY } from "@/lib/utils/constants";
import { formatRelative } from "@/lib/utils/formatters";
import type { Tables } from "@/types/database";

/**
 * Standard answers CRUD (BLUEPRINT §4.7). FAQ-style entries — title is the
 * question pattern, content is the approved answer — stored in knowledge_base
 * under the reserved "custom" category. These keep the AI from inventing
 * responses to recurring grant questions.
 */
export default function AnswersPage() {
  const { profile } = useProfile();
  const editable = canEdit(profile?.role);

  const [answers, setAnswers] = useState<Tables<"knowledge_base">[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

    const { data, error: loadError } = await supabase
      .from("knowledge_base")
      .select("*")
      .eq("category", STANDARD_ANSWER_CATEGORY)
      .order("updated_at", { ascending: false });

    if (loadError) {
      setError("Could not load standard answers.");
      setLoading(false);
      return;
    }
    setAnswers(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setEditing(null);
    setEditorOpen(true);
  }

  function openEdit(answer: Tables<"knowledge_base">) {
    setEditing(answer);
    setEditorOpen(true);
  }

  async function handleDelete() {
    if (!pendingDelete) return;
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

  const showEmpty = !loading && !error && answers.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-navy-900">
            Standard Answers
          </h1>
          <p className="mt-1 text-sm text-navy-500">
            Approved answers to recurring grant questions, reused verbatim by the
            AI.
          </p>
        </div>
        {editable && (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" aria-hidden />
            New answer
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
        <LoadingSpinner center label="Loading standard answers…" />
      ) : showEmpty ? (
        <EmptyState
          icon={HelpCircle}
          title="No standard answers yet"
          description="Capture approved answers to questions you see across applications so the AI never invents a response."
          action={
            editable ? (
              <Button onClick={openCreate}>
                <Plus className="h-4 w-4" aria-hidden />
                New answer
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-4">
          {answers.map((answer) => (
            <Card key={answer.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h3 className="min-w-0 font-semibold text-navy-900">
                  {answer.title}
                </h3>
                {editable && (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => openEdit(answer)}
                      aria-label={`Edit answer to ${answer.title}`}
                    >
                      <Pencil className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setDeleteError(null);
                        setPendingDelete(answer);
                      }}
                      aria-label={`Delete answer to ${answer.title}`}
                    >
                      <Trash2 className="h-4 w-4 text-red-500" aria-hidden />
                    </Button>
                  </div>
                )}
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-navy-600">
                {answer.content}
              </p>
              <p className="mt-3 text-xs text-navy-400">
                v{answer.version ?? 1} · updated{" "}
                {formatRelative(answer.updated_at)}
              </p>
            </Card>
          ))}
        </div>
      )}

      {/* Create / edit */}
      <Modal
        isOpen={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editing ? "Edit standard answer" : "New standard answer"}
        size="lg"
      >
        <AnswerEditor
          answer={editing ?? undefined}
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
        title="Delete standard answer"
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
            <Button variant="danger" onClick={handleDelete} isLoading={deleting}>
              Delete answer
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-navy-600">
            Delete the answer to{" "}
            <span className="font-medium">{pendingDelete?.title}</span>?
          </p>
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
