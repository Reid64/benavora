"use client";

import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  FileText,
  History,
  MessageSquare,
  Move,
  Search,
  Trash2,
} from "lucide-react";

import {
  Badge,
  Button,
  Card,
  EmptyState,
  LoadingSpinner,
  Modal,
  Textarea,
} from "@/components/ui";
import { AssemblyPanel } from "@/components/documents/AssemblyPanel";
import { ComplianceReport } from "@/components/applications/ComplianceReport";
import { StageTransitionModal } from "@/components/applications/StageTransitionModal";
import {
  STAGE_COLOR,
  STAGE_LABEL,
  daysInStage,
  type EnrichedApplication,
} from "@/components/applications/pipeline";
import { createClient } from "@/lib/supabase/client";
import { canEdit, useProfile } from "@/lib/hooks/useProfile";
import {
  formatCurrency,
  formatDate,
  formatRelative,
  humanizeEnum,
} from "@/lib/utils/formatters";
import { isNonEmpty } from "@/lib/utils/validators";
import type { Tables } from "@/types/database";

type TabKey = "overview" | "timeline" | "notes" | "assembly";

const TABS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "timeline", label: "Timeline" },
  { key: "notes", label: "Notes" },
  { key: "assembly", label: "Assembly" },
];

type HistoryEntry = Tables<"pipeline_history"> & { actorName: string | null };

type ApplicationData = {
  application: EnrichedApplication;
  history: HistoryEntry[];
  notes: Tables<"notes">[];
};

export type ApplicationDetailProps = {
  applicationId: string;
};

/**
 * Tabbed application detail (BLUEPRINT §4.5): Overview, Timeline (the full
 * pipeline_history), and Notes. The "Move application" action opens the
 * StageTransitionModal, which enforces the transition rules and records each
 * change. All reads are RLS-scoped to the organization.
 */
export function ApplicationDetail({ applicationId }: ApplicationDetailProps) {
  const router = useRouter();
  const { profile } = useProfile();
  const [data, setData] = useState<ApplicationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("overview");
  const [moving, setMoving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    setLoading(true);
    setError(null);

    const { data: application, error: appError } = await supabase
      .from("applications")
      .select("*")
      .eq("id", applicationId)
      .single();

    if (appError || !application) {
      setError("This application could not be found.");
      setLoading(false);
      return;
    }

    const [opportunityRes, historyRes, notesRes, appDocsRes] =
      await Promise.all([
        supabase
          .from("opportunities")
          .select(
            "id, name, funder_id, deadline, eligibility_score, recurrence, required_documents",
          )
          .eq("id", application.opportunity_id)
          .single(),
        supabase
          .from("pipeline_history")
          .select("*")
          .eq("application_id", applicationId)
          .order("created_at", { ascending: false }),
        supabase
          .from("notes")
          .select("*")
          .eq("application_id", applicationId)
          .order("created_at", { ascending: false }),
        supabase
          .from("application_documents")
          .select("id")
          .eq("application_id", applicationId),
      ]);

    const opportunity = opportunityRes.data ?? null;

    let funderName: string | null = null;
    if (opportunity?.funder_id) {
      const { data: funder } = await supabase
        .from("funders")
        .select("name")
        .eq("id", opportunity.funder_id)
        .single();
      funderName = funder?.name ?? null;
    }

    const history = (historyRes.data ?? []) as Tables<"pipeline_history">[];

    // Resolve actor names for the timeline.
    const actorIds = Array.from(
      new Set(history.map((h) => h.changed_by).filter(Boolean) as string[]),
    );
    const actorNames = new Map<string, string>();
    if (actorIds.length > 0) {
      const { data: actors } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", actorIds);
      for (const actor of actors ?? []) {
        actorNames.set(actor.id, actor.full_name || actor.email);
      }
    }

    const enriched: EnrichedApplication = {
      ...application,
      opportunityName: opportunity?.name ?? null,
      funderName,
      deadline: opportunity?.deadline ?? null,
      eligibilityScore: opportunity?.eligibility_score ?? null,
      recurrence: opportunity?.recurrence ?? null,
      requiredDocumentCount: opportunity?.required_documents?.length ?? 0,
      attachedDocumentCount: appDocsRes.data?.length ?? 0,
      // The most recent history row marks when the current stage began.
      stageEnteredAt: history[0]?.created_at ?? application.created_at,
    };

    setData({
      application: enriched,
      history: history.map((h) => ({
        ...h,
        actorName: h.changed_by ? (actorNames.get(h.changed_by) ?? null) : null,
      })),
      notes: notesRes.data ?? [],
    });
    setLoading(false);
  }, [applicationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleDelete() {
    if (!data) return;
    setDeleting(true);
    const supabase = createClient();
    // pipeline_history and notes cascade on delete; the opportunity is preserved
    // (BEHAVIORAL_CONTRACTS §6).
    const { error: deleteError } = await supabase
      .from("applications")
      .delete()
      .eq("id", data.application.id);

    if (deleteError) {
      setError(deleteError.message);
      setDeleting(false);
      setConfirmDelete(false);
      return;
    }
    router.push("/applications");
    router.refresh();
  }

  if (loading) {
    return <LoadingSpinner center label="Loading application…" />;
  }

  if (error || !data) {
    return (
      <EmptyState
        icon={Search}
        title="Application unavailable"
        description={error ?? "This application could not be found."}
        action={
          <Button variant="secondary" onClick={() => router.push("/applications")}>
            Back to applications
          </Button>
        }
      />
    );
  }

  const { application, history, notes } = data;
  const editable = canEdit(profile?.role);
  const days = daysInStage(application.stageEnteredAt);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-navy-900">
              {application.opportunityName ?? "Application"}
            </h1>
            <Badge color={STAGE_COLOR[application.stage]}>
              {STAGE_LABEL[application.stage]}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-navy-500">
            {application.funderName ?? "No linked funder"}
            {application.deadline && ` · Due ${formatDate(application.deadline)}`}
            {` · ${days === 0 ? "in stage today" : `${days} day${days === 1 ? "" : "s"} in stage`}`}
          </p>
        </div>
        {editable && (
          <div className="flex shrink-0 items-center gap-2">
            <Button onClick={() => setMoving(true)}>
              <Move className="h-4 w-4" aria-hidden />
              Move application
            </Button>
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-4 w-4" aria-hidden />
              Delete
            </Button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-navy-200">
        <nav className="-mb-px flex gap-6 overflow-x-auto" aria-label="Tabs">
          {TABS.map((t) => {
            const count =
              t.key === "timeline"
                ? history.length
                : t.key === "notes"
                  ? notes.length
                  : null;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                aria-current={active ? "page" : undefined}
                className={
                  "whitespace-nowrap border-b-2 px-1 py-3 text-sm font-medium transition " +
                  (active
                    ? "border-teal-600 text-teal-600"
                    : "border-transparent text-navy-500 hover:border-navy-300 hover:text-navy-700")
                }
              >
                {t.label}
                {count != null && (
                  <span
                    className={
                      "ml-2 rounded-full px-2 py-0.5 text-xs " +
                      (active
                        ? "bg-teal-100 text-teal-700"
                        : "bg-navy-100 text-navy-600")
                    }
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {tab === "overview" && <OverviewTab application={application} />}
      {tab === "timeline" && <TimelineTab history={history} />}
      {tab === "notes" && (
        <NotesTab
          applicationId={application.id}
          notes={notes}
          canAdd={editable}
          organizationId={profile?.organization_id ?? null}
          authorId={profile?.id ?? null}
          onAdded={load}
        />
      )}
      {tab === "assembly" && (
        <AssemblyPanel applicationId={application.id} />
      )}

      {/* Move modal */}
      <StageTransitionModal
        isOpen={moving}
        onClose={() => setMoving(false)}
        application={application}
        role={profile?.role}
        changedBy={profile?.id ?? null}
        onComplete={load}
      />

      {/* Delete confirmation */}
      <Modal
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete application"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setConfirmDelete(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDelete} isLoading={deleting}>
              Delete application
            </Button>
          </>
        }
      >
        <p className="text-sm text-navy-600">
          Deleting this application removes its stage history and notes. The
          opportunity is preserved.
        </p>
      </Modal>
    </div>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="py-3">
      <dt className="text-xs font-semibold uppercase tracking-wide text-navy-500">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-navy-800">{children}</dd>
    </div>
  );
}

function dash(value: React.ReactNode) {
  return value ?? <span className="text-navy-400">—</span>;
}

function OverviewTab({ application }: { application: EnrichedApplication }) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {application.stage === "ready_for_review" && (
        <ComplianceReport applicationId={application.id} />
      )}

      <Card title="Application">
        <dl className="divide-y divide-navy-100">
          <DetailRow label="Opportunity">
            {application.opportunity_id ? (
              <Link
                href={`/opportunities/${application.opportunity_id}`}
                className="text-teal-600 hover:text-teal-700"
              >
                {application.opportunityName ?? "View opportunity"}
              </Link>
            ) : (
              dash(null)
            )}
          </DetailRow>
          <DetailRow label="Requested amount">
            {formatCurrency(application.requested_amount)}
          </DetailRow>
          <DetailRow label="Awarded amount">
            {formatCurrency(application.awarded_amount)}
          </DetailRow>
          <DetailRow label="Submitted">
            {application.submitted_at
              ? formatDate(application.submitted_at)
              : dash(null)}
          </DetailRow>
        </dl>
      </Card>

      <Card title="Draft">
        <dl className="divide-y divide-navy-100">
          <DetailRow label="Template type">
            {application.draft_template_type
              ? humanizeEnum(application.draft_template_type)
              : dash(null)}
          </DetailRow>
          <DetailRow label="Confidence score">
            {application.draft_confidence_score != null
              ? `${application.draft_confidence_score} / 100`
              : dash(null)}
          </DetailRow>
          <DetailRow label="Required documents">
            {`${application.attachedDocumentCount} / ${application.requiredDocumentCount} attached`}
          </DetailRow>
        </dl>
      </Card>

      <Card title="Draft content" className="lg:col-span-2">
        {application.draft_content && application.draft_content.trim() ? (
          <p className="whitespace-pre-wrap text-sm text-navy-700">
            {application.draft_content}
          </p>
        ) : (
          <EmptyState
            icon={FileText}
            title="No draft yet"
            description="Generate or write a draft from the Draft Generator to populate this application."
          />
        )}
      </Card>
    </div>
  );
}

function TimelineTab({ history }: { history: HistoryEntry[] }) {
  if (history.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="No stage history"
        description="Every stage change is recorded here as the application moves through the pipeline."
      />
    );
  }

  return (
    <Card noPadding>
      <ol className="divide-y divide-navy-100">
        {history.map((entry) => (
          <li key={entry.id} className="flex items-start gap-3 px-5 py-4">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-navy-100">
              <ArrowRight className="h-4 w-4 text-navy-500" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {entry.from_stage ? (
                  <>
                    <Badge color={STAGE_COLOR[entry.from_stage]}>
                      {STAGE_LABEL[entry.from_stage]}
                    </Badge>
                    <ArrowRight
                      className="h-3.5 w-3.5 text-navy-400"
                      aria-hidden
                    />
                  </>
                ) : (
                  <span className="text-xs text-navy-400">Created in</span>
                )}
                <Badge color={STAGE_COLOR[entry.to_stage]}>
                  {STAGE_LABEL[entry.to_stage]}
                </Badge>
              </div>
              {entry.notes && (
                <p className="mt-1.5 whitespace-pre-wrap text-sm text-navy-700">
                  {entry.notes}
                </p>
              )}
              <p className="mt-1 text-xs text-navy-400">
                {formatRelative(entry.created_at)}
                {entry.actorName && ` · by ${entry.actorName}`}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function NotesTab({
  applicationId,
  notes,
  canAdd,
  organizationId,
  authorId,
  onAdded,
}: {
  applicationId: string;
  notes: Tables<"notes">[];
  canAdd: boolean;
  organizationId: string | null;
  authorId: string | null;
  onAdded: () => Promise<void> | void;
}) {
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNoteError(null);
    if (!isNonEmpty(content)) return;
    if (!organizationId) {
      setNoteError("Your session could not be verified.");
      return;
    }

    setSubmitting(true);
    const supabase = createClient();
    const { error: insertError } = await supabase.from("notes").insert({
      organization_id: organizationId,
      application_id: applicationId,
      author_id: authorId,
      content: content.trim(),
    });

    if (insertError) {
      setNoteError(insertError.message);
      setSubmitting(false);
      return;
    }

    setContent("");
    setSubmitting(false);
    await onAdded();
  }

  return (
    <div className="space-y-5">
      {canAdd && (
        <Card>
          <form onSubmit={handleAdd} className="space-y-3" noValidate>
            {noteError && (
              <div
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              >
                {noteError}
              </div>
            )}
            <Textarea
              label="Add a note"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Log progress, blockers, or any context about this application."
              rows={3}
            />
            <div className="flex justify-end">
              <Button
                type="submit"
                isLoading={submitting}
                disabled={!isNonEmpty(content)}
              >
                Add note
              </Button>
            </div>
          </form>
        </Card>
      )}

      {notes.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title="No notes yet"
          description={
            canAdd
              ? "Add the first note above."
              : "Notes about this application will appear here."
          }
        />
      ) : (
        <ul className="space-y-3">
          {notes.map((note) => (
            <li key={note.id}>
              <Card>
                <p className="whitespace-pre-wrap text-sm text-navy-700">
                  {note.content}
                </p>
                <p className="mt-2 text-xs text-navy-400">
                  {formatRelative(note.created_at)}
                  {note.updated_at !== note.created_at && " · edited"}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
