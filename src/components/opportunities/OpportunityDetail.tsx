"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  FileText,
  Gauge,
  MessageSquare,
  Pencil,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  XCircle,
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
import {
  EligibilityBar,
  HighPriorityBadge,
  MatchBadge,
  MISMATCH_REASON_THRESHOLD,
  MismatchReasons,
  OPPORTUNITY_STATUS_VARIANT,
  RecommendationBadge,
} from "@/components/opportunities/eligibility";
import { IntelligenceBriefingPanel } from "@/components/intelligence/IntelligenceBriefingPanel";
import { OpportunityForm } from "@/components/opportunities/OpportunityForm";
import { SourceTypeBadge } from "@/components/opportunities/SourceTypeBadge";
import { ValidationBadge } from "@/components/opportunities/ValidationBadge";
import {
  computeConsensus,
  VALIDATION_FIELDS,
  VALIDATION_PROVIDERS,
  type FieldCheck,
  type ValidationChecks,
  type ValidationField,
} from "@/lib/opportunities/validation";
import { createClient } from "@/lib/supabase/client";
import { canEdit, useProfile } from "@/lib/hooks/useProfile";
import {
  decodeHtmlEntities,
  formatCurrency,
  formatDate,
  formatRelative,
  humanizeEnum,
} from "@/lib/utils/formatters";
import { isNonEmpty } from "@/lib/utils/validators";
import type { Tables } from "@/types/database";

type TabKey =
  | "overview"
  | "eligibility"
  | "validation"
  | "applications"
  | "notes"
  | "intelligence";

const TABS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "eligibility", label: "Eligibility" },
  { key: "validation", label: "Validation" },
  { key: "applications", label: "Applications" },
  { key: "notes", label: "Notes" },
  { key: "intelligence", label: "Intelligence" },
];

type OpportunityData = {
  opportunity: Tables<"opportunities">;
  funder: Pick<Tables<"funders">, "id" | "name"> | null;
  keywords: string[];
  applications: Tables<"applications">[];
  notes: Tables<"notes">[];
  validations: Tables<"validations">[];
};

export type OpportunityDetailProps = {
  opportunityId: string;
};

/**
 * Tabbed opportunity detail (BLUEPRINT §4.4): Overview, Eligibility (score +
 * recommendation), Applications, and Notes. All reads are RLS-scoped to the
 * organization; writes derive organization_id from the session profile.
 */
export function OpportunityDetail({ opportunityId }: OpportunityDetailProps) {
  const router = useRouter();
  const { profile } = useProfile();
  const [data, setData] = useState<OpportunityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("overview");
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [parseLoading, setParseLoading] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    const supabase = createClient();
    if (!silent) {
      setLoading(true);
      setError(null);
    }

    const { data: opportunity, error: oppError } = await supabase
      .from("opportunities")
      .select("*")
      .eq("id", opportunityId)
      .single();

    if (oppError || !opportunity) {
      // A silent refresh (e.g. after Parse NOFA) must never blank the page or
      // flip into the error state - leave the existing view intact.
      if (!silent) {
        setError("This opportunity could not be found.");
        setLoading(false);
      }
      return;
    }

    const [keywordsRes, applicationsRes, notesRes, validationsRes] =
      await Promise.all([
        supabase
          .from("opportunity_keywords")
          .select("keyword")
          .eq("opportunity_id", opportunityId)
          .order("keyword", { ascending: true }),
        supabase
          .from("applications")
          .select("*")
          .eq("opportunity_id", opportunityId)
          .order("updated_at", { ascending: false }),
        supabase
          .from("notes")
          .select("*")
          .eq("opportunity_id", opportunityId)
          .order("created_at", { ascending: false }),
        supabase
          .from("validations")
          .select("*")
          .eq("opportunity_id", opportunityId)
          .order("created_at", { ascending: true }),
      ]);

    let funder: OpportunityData["funder"] = null;
    if (opportunity.funder_id) {
      const { data: f } = await supabase
        .from("funders")
        .select("id, name")
        .eq("id", opportunity.funder_id)
        .single();
      funder = f ?? null;
    }

    setData({
      opportunity,
      funder,
      keywords: (keywordsRes.data ?? []).map((k) => k.keyword),
      applications: applicationsRes.data ?? [],
      notes: notesRes.data ?? [],
      validations: validationsRes.data ?? [],
    });
    if (!silent) setLoading(false);
  }, [opportunityId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleDelete() {
    if (!data) return;
    setDeleting(true);
    const supabase = createClient();
    // Keywords, deadlines, and notes cascade on delete; applications keep a
    // required FK to the opportunity, so deletion is blocked while any exist
    // (guarded in the modal below).
    const { error: deleteError } = await supabase
      .from("opportunities")
      .delete()
      .eq("id", data.opportunity.id);

    if (deleteError) {
      setError(deleteError.message);
      setDeleting(false);
      setConfirmDelete(false);
      return;
    }
    router.push("/opportunities");
    router.refresh();
  }

  async function handleParseNofa() {
    setParseError(null);
    setParseLoading(true);
    try {
      const res = await fetch("/api/agents/nofa-parser", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opportunityId }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error ?? "NOFA parsing failed.");
      }
      // Silent refresh so the stored-PDF viewer appears without blanking the page.
      await load({ silent: true });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("NOFA parse failed:", err);
      setParseError(err instanceof Error ? err.message : "NOFA parsing failed.");
    } finally {
      setParseLoading(false);
    }
  }

  if (loading) {
    return <LoadingSpinner center label="Loading opportunity..." />;
  }

  if (error || !data) {
    return (
      <EmptyState
        icon={Search}
        title="Opportunity unavailable"
        description={error ?? "This opportunity could not be found."}
        action={
          <Button
            variant="secondary"
            onClick={() => router.push("/opportunities")}
          >
            Back to opportunities
          </Button>
        }
      />
    );
  }

  const { opportunity, funder, keywords, applications, notes, validations } =
    data;
  const editable = canEdit(profile?.role);
  const hasApplications = applications.length > 0;
  // Most-recent application for this opportunity (load() orders by updated_at).
  const applicationId = applications[0]?.id ?? null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-primary">
              {decodeHtmlEntities(opportunity.name)}
            </h1>
            <MatchBadge percentage={opportunity.match_percentage} />
            {opportunity.is_high_priority && <HighPriorityBadge />}
            <SourceTypeBadge sourceType={opportunity.source_type} />
            <Badge variant="neutral">{humanizeEnum(opportunity.category)}</Badge>
            {opportunity.status && (
              <Badge variant={OPPORTUNITY_STATUS_VARIANT[opportunity.status]}>
                {humanizeEnum(opportunity.status)}
              </Badge>
            )}
            <ValidationBadge rows={validations} hideUntilValidated />
          </div>
          <p className="mt-1 text-sm text-navy-500">
            {funder ? (
              <Link
                href={`/funders/${funder.id}`}
                className="text-teal-600 hover:text-teal-700"
              >
                {funder.name}
              </Link>
            ) : (
              "No linked funder"
            )}
            {opportunity.deadline && ` · Due ${formatDate(opportunity.deadline)}`}
          </p>
        </div>
        {editable && (
          <div className="flex shrink-0 flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              <ApplyAction opportunity={opportunity} applicationId={applicationId} />
              <Button
                variant="secondary"
                onClick={handleParseNofa}
                isLoading={parseLoading}
              >
                <Sparkles className="h-4 w-4" aria-hidden />
                Parse NOFA
              </Button>
              <Button variant="secondary" onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4" aria-hidden />
                Edit
              </Button>
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="h-4 w-4" aria-hidden />
                Delete
              </Button>
            </div>
            {parseError && (
              <div
                role="alert"
                className="max-w-sm rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              >
                {parseError}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-navy-200">
        <nav className="-mb-px flex gap-6 overflow-x-auto" aria-label="Tabs">
          {TABS.map((t) => {
            const count =
              t.key === "applications"
                ? applications.length
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
                  <Badge
                    variant={active ? "info" : "neutral"}
                    className="ml-2"
                  >
                    {count}
                  </Badge>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab panels */}
      {tab === "overview" && (
        <OverviewTab
          opportunity={opportunity}
          keywords={keywords}
          onParseNofa={handleParseNofa}
          parsing={parseLoading}
          parseError={parseError}
          applicationId={applicationId}
        />
      )}
      {tab === "eligibility" && <EligibilityTab opportunity={opportunity} />}
      {tab === "validation" && (
        <ValidationTab
          opportunityId={opportunity.id}
          validations={validations}
          canValidate={editable}
          onValidated={load}
        />
      )}
      {tab === "applications" && (
        <ApplicationsTab applications={applications} />
      )}
      {tab === "notes" && (
        <NotesTab
          opportunityId={opportunity.id}
          notes={notes}
          canAdd={editable}
          organizationId={profile?.organization_id ?? null}
          authorId={profile?.id ?? null}
          onAdded={load}
        />
      )}
      {tab === "intelligence" && (
        <IntelligenceBriefingPanel opportunityId={opportunity.id} />
      )}

      {/* Edit modal */}
      <Modal
        isOpen={editing}
        onClose={() => setEditing(false)}
        title="Edit opportunity"
        size="xl"
      >
        <OpportunityForm
          opportunity={opportunity}
          initialKeywords={keywords}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void load();
          }}
        />
      </Modal>

      {/* Delete confirmation */}
      <Modal
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete opportunity"
        description={hasApplications ? undefined : "This cannot be undone."}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setConfirmDelete(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleDelete}
              isLoading={deleting}
              disabled={hasApplications}
            >
              Delete opportunity
            </Button>
          </>
        }
      >
        {hasApplications ? (
          <p className="text-sm text-navy-600">
            This opportunity has {applications.length} linked application
            {applications.length === 1 ? "" : "s"} and cannot be deleted. Remove
            the application{applications.length === 1 ? "" : "s"} first.
          </p>
        ) : (
          <p className="text-sm text-navy-600">
            Deleting <span className="font-medium">{decodeHtmlEntities(opportunity.name)}</span> also
            removes its keywords, deadlines, and notes.
          </p>
        )}
      </Modal>
    </div>
  );
}

// Inline styles (not Tailwind classes) because cn() has no tailwind-merge and the
// Button variants target the dark theme; the brand primary reads cleanly on white.
const APPLY_CTA_STYLE = { backgroundColor: "var(--color-primary)", color: "#ffffff" } as const;

/**
 * Primary "Apply Now" CTA with lifecycle states. Precedence:
 *   1. status 'applied'         -> muted "Applied" badge (terminal state).
 *   2. an application exists     -> "View Application" -> /applications/{id}.
 *   3. status 'closed'/'expired' -> disabled, "Closed"/"Expired".
 *   4. otherwise                 -> "Apply Now" -> /draft-generator?opportunity={id}.
 * Note the draft generator's deep-link param is "opportunity", not "opportunityId".
 */
function ApplyAction({
  opportunity,
  applicationId,
  size = "md",
}: {
  opportunity: Tables<"opportunities">;
  applicationId: string | null;
  size?: "sm" | "md";
}) {
  const status = opportunity.status;

  if (status === "applied") {
    return <Badge color="gray">Applied</Badge>;
  }

  if (applicationId) {
    return (
      <Link href={`/applications/${applicationId}`}>
        <Button
          variant="ghost"
          size={size}
          className="hover:brightness-110"
          style={APPLY_CTA_STYLE}
        >
          <ArrowRight className="h-4 w-4" aria-hidden />
          View Application
        </Button>
      </Link>
    );
  }

  if (status === "closed" || status === "expired") {
    return (
      <Button
        variant="ghost"
        size={size}
        disabled
        style={{ backgroundColor: "#e5e7eb", color: "#6b7280" }}
      >
        {status === "closed" ? "Closed" : "Expired"}
      </Button>
    );
  }

  return (
    <Link href={`/draft-generator?opportunity=${opportunity.id}`}>
      <Button
        variant="ghost"
        size={size}
        className="hover:brightness-110"
        style={APPLY_CTA_STYLE}
      >
        <ArrowRight className="h-4 w-4" aria-hidden />
        Apply Now
      </Button>
    </Link>
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

function getFilenameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const segments = pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1];
    return last ? decodeURIComponent(last) : "NOFA Document";
  } catch {
    return "NOFA Document";
  }
}

// HTML announcements can't be shown inline (the grants.gov download is a
// redirect stub and the real page blocks framing), so they link out instead of
// using the iframe. Detect via the title, since grants.gov urls are extensionless.
function isHtmlDoc(title: string): boolean {
  const t = (title.split(/[?#]/)[0] ?? title).toLowerCase();
  return t.endsWith(".html") || t.endsWith(".htm");
}

function OverviewTab({
  opportunity,
  keywords,
  onParseNofa,
  parsing,
  parseError,
  applicationId,
}: {
  opportunity: Tables<"opportunities">;
  keywords: string[];
  onParseNofa: () => void;
  parsing: boolean;
  parseError: string | null;
  applicationId: string | null;
}) {
  const amountRange =
    opportunity.amount_min != null || opportunity.amount_max != null
      ? `${formatCurrency(opportunity.amount_min)} – ${formatCurrency(opportunity.amount_max)}`
      : null;

  const rawDocs = opportunity.opportunity_documents;
  const documents: Array<{ title?: string; url: string; storedUrl?: string }> =
    Array.isArray(rawDocs)
      ? (rawDocs as Array<unknown>).filter(
          (item): item is { url: string; title?: string; storedUrl?: string } =>
            typeof item === "object" &&
            item !== null &&
            typeof (item as Record<string, unknown>).url === "string",
        )
      : [];

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card title="Details">
        <dl className="divide-y divide-navy-100">
          <DetailRow label="Description">
            {opportunity.description ? (
              <p className="whitespace-pre-wrap">{opportunity.description}</p>
            ) : (
              <span className="text-navy-400">-</span>
            )}
          </DetailRow>
          <DetailRow label="Deadline">
            {opportunity.deadline ? (
              formatDate(opportunity.deadline)
            ) : (
              <span className="text-navy-400">-</span>
            )}
          </DetailRow>
          <DetailRow label="Recurrence">
            {opportunity.recurrence ? (
              humanizeEnum(opportunity.recurrence)
            ) : (
              <span className="text-navy-400">-</span>
            )}
          </DetailRow>
          <DetailRow label="Geographic restrictions">
            {opportunity.geographic_restrictions ? (
              opportunity.geographic_restrictions
            ) : (
              <span className="text-navy-400">-</span>
            )}
          </DetailRow>
          <DetailRow label="Eligibility requirements">
            {opportunity.eligibility_requirements ? (
              <div className="max-h-[300px] overflow-y-auto whitespace-pre-wrap">
                {opportunity.eligibility_requirements}
              </div>
            ) : (
              <span className="text-navy-400">-</span>
            )}
          </DetailRow>
          <DetailRow label="Required documents">
            {opportunity.required_documents &&
            opportunity.required_documents.length > 0 ? (
              <ul className="space-y-1.5">
                {opportunity.required_documents.map((doc, i) => (
                  <li key={`${doc}-${i}`} className="flex items-center gap-2">
                    <FileText
                      className="h-4 w-4 shrink-0 text-navy-400"
                      aria-hidden
                    />
                    {doc}
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-navy-400">-</span>
            )}
          </DetailRow>
        </dl>
      </Card>

      <Card
        title="Funding & application"
        actions={
          <ApplyAction
            opportunity={opportunity}
            applicationId={applicationId}
            size="sm"
          />
        }
      >
        <dl className="divide-y divide-navy-100">
          <DetailRow label="Amount available">
            {opportunity.amount_max != null || opportunity.amount_available != null ? (
              formatCurrency(opportunity.amount_max ?? opportunity.amount_available)
            ) : (
              <span className="text-navy-400">-</span>
            )}
          </DetailRow>
          <DetailRow label="Request range">
            {amountRange ? (
              amountRange
            ) : (
              <span className="text-navy-400">-</span>
            )}
          </DetailRow>
          <DetailRow label="Application method">
            {opportunity.application_method ? (
              humanizeEnum(opportunity.application_method)
            ) : (
              <span className="text-navy-400">-</span>
            )}
          </DetailRow>
          <DetailRow label="URL">
            {opportunity.url ? (
              <a
                href={opportunity.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 break-all text-teal-600 hover:text-teal-700"
              >
                {opportunity.url}
                <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
              </a>
            ) : (
              <span className="text-navy-400">-</span>
            )}
          </DetailRow>
        </dl>
      </Card>

      <Card title="Keywords" className="lg:col-span-2">
        {keywords.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {keywords.map((keyword) => (
              <Badge key={keyword} color="gray">
                {keyword}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-sm text-navy-400">No keywords tagged.</p>
        )}
      </Card>

      <Card
        title="NOFA Documents"
        className="lg:col-span-2"
        actions={
          <Button variant="secondary" size="sm" onClick={onParseNofa} isLoading={parsing}>
            <Sparkles className="h-4 w-4" aria-hidden />
            Parse NOFA
          </Button>
        }
      >
        {parsing && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-navy-200 bg-navy-50 px-3 py-2 text-sm text-navy-600">
            <LoadingSpinner />
            <span>
              Downloading and parsing NOFA document... (this may take 1-2
              minutes)
            </span>
          </div>
        )}

        {parseError && (
          <div
            role="alert"
            className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {parseError}
          </div>
        )}

        {documents.length > 0 ? (
          <div className="space-y-5">
            {documents.map((doc, i) => {
              const label = doc.title ?? getFilenameFromUrl(doc.url);
              const htmlDoc = isHtmlDoc(doc.title ?? doc.url);
              return (
                <div key={`${doc.url}-${i}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-2 text-sm font-medium text-navy-800">
                      <FileText
                        className="h-4 w-4 shrink-0 text-navy-400"
                        aria-hidden
                      />
                      <span className="break-all">{label}</span>
                    </span>
                    {!doc.storedUrl && (
                      <a
                        href={doc.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-sm text-teal-600 hover:text-teal-700"
                      >
                        {htmlDoc ? "View full announcement" : "Download from Grants.gov"}
                        <ExternalLink
                          className="h-3.5 w-3.5 shrink-0"
                          aria-hidden
                        />
                      </a>
                    )}
                  </div>

                  {doc.storedUrl ? (
                    // Only PDFs are mirrored to storage and shown inline; HTML
                    // can't be rendered from storage, so it falls through to the
                    // link above.
                    <iframe
                      src={doc.storedUrl}
                      title={label}
                      className="mt-2 w-full rounded-lg border border-navy-300 bg-navy-900 shadow-inner"
                      style={{ height: "600px" }}
                    />
                  ) : (
                    <p className="mt-1 text-xs text-navy-400">
                      {htmlDoc
                        ? "HTML announcement — opens on the funder's site in a new tab."
                        : "Not stored yet — click “Parse NOFA” to download it for in-app viewing."}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-navy-400">No NOFA documents linked</p>
        )}
      </Card>
    </div>
  );
}

function EligibilityTab({
  opportunity,
}: {
  opportunity: Tables<"opportunities">;
}) {
  const showMismatch =
    opportunity.match_percentage != null &&
    opportunity.match_percentage < MISMATCH_REASON_THRESHOLD;

  return (
    <div className="space-y-6">
      <Card title="Match">
        {opportunity.match_percentage != null ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <MatchBadge percentage={opportunity.match_percentage} />
              {opportunity.is_high_priority && <HighPriorityBadge />}
            </div>
            <p className="text-sm text-navy-500">
              {opportunity.is_high_priority
                ? "Flagged high priority - the agent scored this a strong match (80% or higher) against your organization profile."
                : "How well this opportunity matches your organization profile, scored by the Eligibility Scoring Agent."}
            </p>
            {showMismatch && (
              <MismatchReasons reasons={opportunity.match_mismatch_reasons} />
            )}
          </div>
        ) : (
          <EmptyState
            icon={Gauge}
            title="Not yet scored"
            description="The Eligibility Scoring Agent has not evaluated this opportunity's match yet."
          />
        )}
      </Card>

      <Card title="Eligibility score">
        {opportunity.eligibility_score != null ? (
          <div className="space-y-3">
            <EligibilityBar
              score={opportunity.eligibility_score}
              width="lg"
            />
            <p className="text-sm text-navy-500">
              Scored 0-100 by the Eligibility Scoring Agent based on mission,
              geographic, tax-status, and program alignment.
            </p>
          </div>
        ) : (
          <EmptyState
            icon={Gauge}
            title="Not yet scored"
            description="The Eligibility Scoring Agent has not evaluated this opportunity. Scores and recommendations are set by the agent, not entered manually."
          />
        )}
      </Card>

      <Card title="Recommendation">
        {opportunity.recommendation ? (
          <div className="space-y-3">
            <RecommendationBadge recommendation={opportunity.recommendation} />
            {opportunity.recommendation_reasoning && (
              <p className="whitespace-pre-wrap text-sm text-navy-700">
                {opportunity.recommendation_reasoning}
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-navy-400">
            No recommendation yet.
          </p>
        )}
      </Card>
    </div>
  );
}

/** Read the structured findings a provider stored in `validations.details`. */
function parseDetails(details: Tables<"validations">["details"]): {
  checks: ValidationChecks | null;
  summary: string;
} {
  const obj = (details ?? {}) as {
    checks?: Record<string, unknown>;
    summary?: unknown;
  };
  const summary = typeof obj.summary === "string" ? obj.summary : "";
  if (!obj.checks) return { checks: null, summary };

  const read = (raw: unknown): FieldCheck => {
    const c = (raw ?? {}) as { ok?: unknown; note?: unknown };
    return {
      ok: c.ok === true,
      note: typeof c.note === "string" ? c.note : "",
    };
  };
  return {
    checks: {
      existence: read(obj.checks.existence),
      eligibility: read(obj.checks.eligibility),
      deadline: read(obj.checks.deadline),
      amounts: read(obj.checks.amounts),
    },
    summary,
  };
}

const VERDICT_COLOR: Record<
  Tables<"validations">["verdict"],
  "green" | "red" | "yellow"
> = {
  verified: "green",
  discrepancy: "red",
  unverifiable: "yellow",
};

const FIELD_LABEL: Record<ValidationField, string> = {
  existence: "Opportunity exists",
  eligibility: "Eligibility accurate",
  deadline: "Deadline correct",
  amounts: "Amounts correct",
};

function providerLabel(provider: string): string {
  return (
    Object.values(VALIDATION_PROVIDERS).find((p) => p.id === provider)?.label ??
    provider
  );
}

/**
 * Validation tab - cross-provider consensus (migration 014). Shows the overall
 * verdict, lets a writer re-run validation against both AI providers, and breaks
 * out each provider's per-field findings. The consensus badge is derived from
 * the same {@link computeConsensus} the API uses.
 */
function ValidationTab({
  opportunityId,
  validations,
  canValidate,
  onValidated,
}: {
  opportunityId: string;
  validations: Tables<"validations">[];
  canValidate: boolean;
  onValidated: () => Promise<void> | void;
}) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const consensus = computeConsensus(validations);

  async function handleValidate() {
    setError(null);
    setRunning(true);
    try {
      const res = await fetch("/api/ai/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opportunityId }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error ?? "Validation failed.");
      }
      await onValidated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Validation failed.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card title="Cross-provider validation">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ValidationBadge consensus={consensus} />
              <span className="text-sm text-navy-500">
                {consensus.providerCount > 0
                  ? `${consensus.verifiedCount} of ${consensus.providerCount} provider${
                      consensus.providerCount === 1 ? "" : "s"
                    } verified`
                  : "Not yet validated"}
              </span>
            </div>
            {canValidate && (
              <Button onClick={handleValidate} isLoading={running}>
                <ShieldCheck className="h-4 w-4" aria-hidden />
                {validations.length > 0 ? "Re-run validation" : "Validate"}
              </Button>
            )}
          </div>

          <p className="text-sm text-navy-500">
            Each finding is sent to two independent AI providers (Anthropic Claude
            and Google Gemini) that separately judge whether the opportunity
            exists and whether its eligibility, deadline, and amounts are
            accurate. An opportunity is marked{" "}
            <span className="font-medium text-navy-700">Verified</span> only when
            both providers agree. Providers reason from their own knowledge and
            the finding&apos;s internal consistency - a verdict is a confidence
            signal, not a guarantee.
          </p>

          {error && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {error}
            </div>
          )}
        </div>
      </Card>

      {validations.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="Not yet validated"
          description={
            canValidate
              ? "Run validation to cross-check this opportunity against two independent AI providers."
              : "This opportunity has not been validated against the AI providers yet."
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {validations.map((v) => (
            <ProviderValidationCard key={v.id} validation={v} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProviderValidationCard({
  validation,
}: {
  validation: Tables<"validations">;
}) {
  const { checks, summary } = parseDetails(validation.details);

  return (
    <Card title={providerLabel(validation.provider)}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge color={VERDICT_COLOR[validation.verdict]}>
            {humanizeEnum(validation.verdict)}
          </Badge>
          <span className="text-xs text-navy-500">
            {validation.confidence}% confidence
          </span>
          {validation.model && (
            <span className="text-xs text-navy-400">{validation.model}</span>
          )}
        </div>

        {summary && (
          <p className="whitespace-pre-wrap text-sm text-navy-700">{summary}</p>
        )}

        {checks && (
          <ul className="space-y-1.5">
            {VALIDATION_FIELDS.map((field) => {
              const check = checks[field];
              return (
                <li
                  key={field}
                  className="flex items-start gap-2 text-sm text-navy-700"
                >
                  {check.ok ? (
                    <CheckCircle2
                      className="mt-0.5 h-4 w-4 shrink-0 text-green-600"
                      aria-hidden
                    />
                  ) : (
                    <XCircle
                      className="mt-0.5 h-4 w-4 shrink-0 text-red-500"
                      aria-hidden
                    />
                  )}
                  <span>
                    <span className="font-medium">{FIELD_LABEL[field]}.</span>
                    {check.note && (
                      <span className="text-navy-500"> {check.note}</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        <p className="text-xs text-navy-400">
          Checked {formatRelative(validation.created_at)}
        </p>
      </div>
    </Card>
  );
}

function ApplicationsTab({
  applications,
}: {
  applications: Tables<"applications">[];
}) {
  if (applications.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No applications"
        description="Applications created from this opportunity will appear here."
      />
    );
  }
  return (
    <div className="space-y-3">
      {applications.map((app) => (
        <Link key={app.id} href={`/applications/${app.id}`} className="block">
          <Card className="transition hover:border-teal-300 hover:shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-navy-900">
                  Requested {formatCurrency(app.requested_amount)}
                </p>
                <p className="mt-0.5 text-xs text-navy-500">
                  Updated {formatRelative(app.updated_at)}
                </p>
              </div>
              <Badge color="blue">{humanizeEnum(app.stage)}</Badge>
            </div>
          </Card>
        </Link>
      ))}
    </div>
  );
}

function NotesTab({
  opportunityId,
  notes,
  canAdd,
  organizationId,
  authorId,
  onAdded,
}: {
  opportunityId: string;
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
      opportunity_id: opportunityId,
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
              placeholder="Log research, a contact, or any context about this opportunity."
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
              : "Notes about this opportunity will appear here."
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
