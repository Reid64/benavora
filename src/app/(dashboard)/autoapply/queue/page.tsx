"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Banknote,
  Check,
  Clock,
  Copy,
  ExternalLink,
  FileSearch,
  Gauge,
  Pencil,
  Play,
  ShieldAlert,
  Sparkles,
  Users,
  X,
} from "lucide-react";

import { Badge, Button, Card, EmptyState, Modal } from "@/components/ui";
import type { BadgeColor } from "@/components/ui/Badge";
import { createClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/hooks/useProfile";
import type {
  ApplicationProfileRelationshipStrategy,
  ApplicationProfileRiskFactor,
  PriorityPercentile,
  SubmissionMethod,
  SubmissionQueueStatus,
} from "@/lib/pil/types";

// Reads BEN-APP-03's decision record (pil_submission_queue, migration 169)
// joined with BEN-APP-01's application profile and BEN-APP-02's priority
// score for the same prospect+run, plus the prospect's latest dossier -- the
// full "why" behind each queued item before it's actually submitted.
// pil_submission_queue is append-only (no UPDATE/DELETE policy, see that
// migration's header) so every action below mutates the legacy
// `submission_queue` row (migration 045) BEN-APP-03 also writes for
// portal-eligible items, or triggers the real FormFillerAgent -- never this
// table. There is no `dossier_context` JSON blob, `priority_percentile`, or
// `ops_estimated_effort_hours` column anywhere in the schema (only in
// planning YAMLs that were never implemented); this page is built against the
// real, live columns instead -- see the type below for what actually exists.

interface QueueItem {
  id: string;
  prospect_id: string;
  funder_id: string | null;
  legacy_submission_queue_id: string | null;
  can_submit: boolean;
  should_submit: boolean;
  blockers: string[];
  status: SubmissionQueueStatus;
  submission_method: SubmissionMethod;
  suggested_ask_amount: number | null;
  personalized_pitch: string | null;
  submission_strategy: string;
  computed_at: string;
  prospect: { display_name: string } | null;
  funder: { name: string; giving_portal_url: string | null } | null;
  application_profile: {
    success_probability: number;
    field_mappings: Record<string, string>;
    pitch_parameters: { emphasis: string[]; avoid: string[]; tone: string };
    risk_factors: ApplicationProfileRiskFactor[];
    relationship_strategy: ApplicationProfileRelationshipStrategy;
  } | null;
  priority: {
    priority_score: number;
    priority_percentile: PriorityPercentile;
    reasoning: string;
    next_step: string;
    score_breakdown: { effort_efficiency: number } | null;
  } | null;
  dossier: { narrative_text: string; generated_at: string } | null;
  legacy: { status: string; scheduled_for: string | null } | null;
}

type Section = "pitch" | "fields" | "risk" | "relationship" | null;

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function statusBadge(status: SubmissionQueueStatus): { label: string; color: BadgeColor } {
  switch (status) {
    case "submit_now":
      return { label: "Submit Now", color: "green" };
    case "submit_next_30_days":
      return { label: "Next 30 Days", color: "blue" };
    case "submit_q2":
      return { label: "Next Quarter", color: "sky" };
    case "needs_more_research":
      return { label: "Needs Research", color: "yellow" };
    case "blocked":
      return { label: "Blocked", color: "red" };
    default:
      return { label: status, color: "gray" };
  }
}

function percentileBadge(percentile: PriorityPercentile): { label: string; color: BadgeColor } {
  switch (percentile) {
    case "top_10":
      return { label: "Top 10%", color: "purple" };
    case "top_25":
      return { label: "Top 25%", color: "teal" };
    case "top_50":
      return { label: "Top 50%", color: "gray" };
    case "bottom_50":
      return { label: "Bottom 50%", color: "gray" };
    default:
      return { label: percentile, color: "gray" };
  }
}

// Buckets mirror BEN-APP-02's own EFFORT_SIMPLE/MEDIUM/COMPLEX/EXTREMELY_COMPLEX
// constants (90/60/30/10) -- there is no "hours" unit anywhere in this
// pipeline, only this normalized 0-100 efficiency score.
function effortLabel(score: number | null): { label: string; color: BadgeColor } {
  if (score === null) return { label: "Unknown", color: "gray" };
  if (score >= 90) return { label: "Simple", color: "green" };
  if (score >= 60) return { label: "Medium", color: "blue" };
  if (score >= 30) return { label: "Complex", color: "yellow" };
  return { label: "Extremely Complex", color: "red" };
}

function submissionMethodLabel(method: SubmissionMethod): string {
  switch (method) {
    case "portal_autoapply":
      return "AutoApply portal";
    case "email_draft":
      return "Email draft";
    case "direct_outreach_task":
      return "Direct outreach";
    case "manual_research_required":
      return "Manual research required";
    case "not_applicable":
      return "Not applicable";
    default:
      return method;
  }
}

export default function AutoApplyDossierQueuePage() {
  useProfile();
  const supabase = useMemo(() => createClient(), []);

  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, Section>>({});

  const [dossierItem, setDossierItem] = useState<QueueItem | null>(null);
  const [pitchItem, setPitchItem] = useState<QueueItem | null>(null);
  const [pitchDraft, setPitchDraft] = useState("");
  const [pitchCopied, setPitchCopied] = useState(false);
  const [scheduleItem, setScheduleItem] = useState<QueueItem | null>(null);
  const [scheduleDate, setScheduleDate] = useState("");
  const [skipItem, setSkipItem] = useState<QueueItem | null>(null);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from("pil_submission_queue")
        .select(
          `
          id, prospect_id, funder_id, legacy_submission_queue_id, can_submit, should_submit,
          blockers, status, submission_method, suggested_ask_amount,
          personalized_pitch, submission_strategy, computed_at,
          prospect:pil_prospects(display_name),
          funder:funders(name, giving_portal_url),
          application_profile:pil_application_profiles(
            success_probability, field_mappings, pitch_parameters,
            risk_factors, relationship_strategy
          ),
          priority:pil_priority_scores(
            priority_score, priority_percentile, reasoning, next_step, score_breakdown
          ),
          dossier:pil_prospect_dossiers(narrative_text, generated_at),
          legacy:submission_queue!legacy_submission_queue_id(status, scheduled_for)
        `,
        )
        .order("computed_at", { ascending: false });
      if (err) throw err;

      // pil_submission_queue is append-only -- every BEN-APP-03 run adds a
      // fresh row per prospect rather than updating the last one. Keep only
      // the most recent row per prospect (rows already ordered by
      // computed_at desc above).
      const seen = new Set<string>();
      const latest: QueueItem[] = [];
      for (const row of (data ?? []) as unknown as QueueItem[]) {
        if (seen.has(row.prospect_id)) continue;
        seen.add(row.prospect_id);
        latest.push(row);
      }
      setItems(latest);
    } catch {
      setError("Could not load the AutoApply queue.");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  function toggleSection(itemId: string, section: Section) {
    setExpanded((prev) => ({
      ...prev,
      [itemId]: prev[itemId] === section ? null : section,
    }));
  }

  async function handleSubmitNow(item: QueueItem) {
    if (!item.funder_id) return;
    setActionLoading(item.id + ":submit");
    setActionError(null);
    try {
      const res = await fetch("/api/agents/form-filler", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          funderId: item.funder_id,
          requestAmount: item.suggested_ask_amount ?? undefined,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setActionError(err.error ?? "Could not submit this application.");
        return;
      }
      await loadQueue();
    } catch {
      setActionError("Could not reach the form filler. Please try again.");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleScheduleConfirm() {
    if (!scheduleItem?.legacy_submission_queue_id || !scheduleDate) return;
    setActionLoading(scheduleItem.id + ":schedule");
    setActionError(null);
    try {
      const { error: err } = await supabase
        .from("submission_queue")
        .update({ scheduled_for: new Date(scheduleDate).toISOString() })
        .eq("id", scheduleItem.legacy_submission_queue_id)
        .eq("status", "pending");
      if (err) throw err;
      setScheduleItem(null);
      setScheduleDate("");
      await loadQueue();
    } catch {
      setActionError("Could not schedule this submission.");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleSkipConfirm() {
    if (!skipItem?.legacy_submission_queue_id) return;
    setActionLoading(skipItem.id + ":skip");
    setActionError(null);
    try {
      const { error: err } = await supabase
        .from("submission_queue")
        .delete()
        .eq("id", skipItem.legacy_submission_queue_id)
        .eq("status", "pending");
      if (err) throw err;
      setSkipItem(null);
      await loadQueue();
    } catch {
      setActionError("Could not skip this submission.");
    } finally {
      setActionLoading(null);
    }
  }

  function openPitchEditor(item: QueueItem) {
    setPitchItem(item);
    setPitchDraft(item.personalized_pitch ?? "");
    setPitchCopied(false);
  }

  async function copyPitch() {
    try {
      await navigator.clipboard.writeText(pitchDraft);
      setPitchCopied(true);
    } catch {
      setActionError("Could not copy to clipboard.");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy-900">AutoApply Queue</h1>
        <p className="mt-1 text-sm text-navy-500">
          Prospect intelligence context for each queued application, straight from BEN-APP-01
          (application profile), BEN-APP-02 (priority score), and BEN-APP-03 (submission
          decision) — reviewed here before anything goes out.
        </p>
      </div>

      {actionError && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {actionError}
        </div>
      )}

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : loading ? (
        <p className="text-sm text-navy-400">Loading queue…</p>
      ) : items.length === 0 ? (
        <Card noPadding>
          <div className="p-5">
            <EmptyState
              icon={Sparkles}
              title="Nothing queued yet"
              description="Once BEN-APP-03 reviews a priority-ranked batch, queued applications with full dossier context will appear here."
            />
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {items.map((item) => {
            const { label: statusLabel, color: statusColor } = statusBadge(item.status);
            const profile = item.application_profile;
            const priority = item.priority;
            const effort = effortLabel(priority?.score_breakdown?.effort_efficiency ?? null);
            const section = expanded[item.id] ?? null;
            const legacyPending = item.legacy?.status === "pending";
            const canSubmitNow = item.submission_method === "portal_autoapply" && legacyPending;
            const canSchedule = item.legacy_submission_queue_id !== null && legacyPending;
            const canSkip = item.legacy_submission_queue_id !== null && legacyPending;
            const isSubmitting = actionLoading === item.id + ":submit";

            return (
              <Card key={item.id} noPadding>
                <div className="p-5">
                  {/* Header */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold text-navy-900">
                          {item.prospect?.display_name ?? "Unknown prospect"}
                        </h3>
                        <Badge color={statusColor} withDot>
                          {statusLabel}
                        </Badge>
                        {priority && (
                          <Badge color={percentileBadge(priority.priority_percentile).color}>
                            {percentileBadge(priority.priority_percentile).label}
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-navy-600">{item.funder?.name ?? "—"}</p>
                      <button
                        type="button"
                        onClick={() => setDossierItem(item)}
                        disabled={!item.dossier}
                        className="mt-1 inline-flex items-center gap-1 text-sm text-teal-500 hover:underline disabled:cursor-not-allowed disabled:text-navy-300 disabled:no-underline"
                      >
                        <ExternalLink className="h-3 w-3 shrink-0" />
                        {item.dossier ? "View dossier" : "No dossier yet"}
                      </button>
                    </div>

                    <div>
                      <div className="text-xs font-medium uppercase tracking-wide text-navy-400">
                        Success Probability
                      </div>
                      <div className="mt-0.5 text-lg font-bold text-navy-900">
                        {profile ? `${Math.round(profile.success_probability * 100)}%` : "—"}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs font-medium uppercase tracking-wide text-navy-400">Priority</div>
                      <div className="mt-0.5 text-lg font-bold text-navy-900">
                        {priority ? priority.priority_score.toFixed(1) : "—"}
                      </div>
                    </div>
                  </div>

                  {/* Ask amount + effort */}
                  <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-navy-100 pt-4">
                    <div className="flex items-center gap-1.5 text-sm text-navy-700">
                      <Banknote className="h-4 w-4 text-navy-400" aria-hidden />
                      <span className="font-medium">
                        {item.suggested_ask_amount !== null
                          ? currencyFormatter.format(item.suggested_ask_amount)
                          : "No ask amount computed"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-sm text-navy-700">
                      <Gauge className="h-4 w-4 text-navy-400" aria-hidden />
                      <span>Effort:</span>
                      <Badge color={effort.color}>{effort.label}</Badge>
                    </div>
                    <div className="flex items-center gap-1.5 text-sm text-navy-500">
                      <Clock className="h-4 w-4 text-navy-400" aria-hidden />
                      {submissionMethodLabel(item.submission_method)}
                    </div>
                  </div>

                  {item.submission_strategy && (
                    <p className="mt-3 text-sm italic text-navy-500">{item.submission_strategy}</p>
                  )}

                  {item.blockers.length > 0 && (
                    <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                      <span>Blocked on: {item.blockers.join(", ")}</span>
                    </div>
                  )}

                  {/* Disclosures */}
                  <div className="mt-4 divide-y divide-navy-100 border-t border-navy-100">
                    <details className="py-3" open={section === "pitch"}>
                      <summary
                        className="cursor-pointer font-semibold text-navy-800"
                        onClick={(e) => {
                          e.preventDefault();
                          toggleSection(item.id, "pitch");
                        }}
                      >
                        Personalized Pitch
                      </summary>
                      {section === "pitch" && (
                        <div className="mt-2 space-y-2">
                          <p className="text-sm text-navy-600">
                            {item.personalized_pitch ?? "No personalized pitch generated yet."}
                          </p>
                          {profile && (
                            <div className="flex flex-wrap gap-1.5">
                              <Badge color="teal">{profile.pitch_parameters.tone}</Badge>
                              {profile.pitch_parameters.emphasis.map((e) => (
                                <Badge key={e} color="gray">
                                  {e}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </details>

                    <details className="py-3" open={section === "fields"}>
                      <summary
                        className="cursor-pointer font-semibold text-navy-800"
                        onClick={(e) => {
                          e.preventDefault();
                          toggleSection(item.id, "fields");
                        }}
                      >
                        Field Mappings Preview
                      </summary>
                      {section === "fields" && (
                        <div className="mt-2 space-y-1.5">
                          {!profile || Object.keys(profile.field_mappings).length === 0 ? (
                            <p className="text-sm text-navy-400">No field mappings available.</p>
                          ) : (
                            Object.entries(profile.field_mappings).map(([field, value]) => (
                              <div key={field} className="flex items-start justify-between gap-3 text-sm">
                                <span className="font-medium text-navy-700">{field}</span>
                                <span
                                  className={
                                    value === "insufficient_data"
                                      ? "text-amber-600"
                                      : "text-navy-500"
                                  }
                                >
                                  {value === "insufficient_data" ? "Needs more data" : value}
                                </span>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </details>

                    <details className="py-3" open={section === "risk"}>
                      <summary
                        className="cursor-pointer font-semibold text-navy-800"
                        onClick={(e) => {
                          e.preventDefault();
                          toggleSection(item.id, "risk");
                        }}
                      >
                        Risk Factors
                      </summary>
                      {section === "risk" && (
                        <div className="mt-2 space-y-2">
                          {!profile || profile.risk_factors.length === 0 ? (
                            <p className="text-sm text-navy-400">No risk factors identified.</p>
                          ) : (
                            profile.risk_factors.map((rf) => (
                              <div key={rf.factor} className="text-sm">
                                <span className="font-medium text-navy-800">{rf.factor}</span>
                                <span className="text-navy-500">: {rf.mitigation}</span>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </details>

                    <details className="py-3" open={section === "relationship"}>
                      <summary
                        className="cursor-pointer font-semibold text-navy-800"
                        onClick={(e) => {
                          e.preventDefault();
                          toggleSection(item.id, "relationship");
                        }}
                      >
                        Relationship Strategy
                      </summary>
                      {section === "relationship" && (
                        <div className="mt-2 space-y-1.5 text-sm text-navy-600">
                          {!profile ? (
                            <p className="text-navy-400">No relationship strategy available.</p>
                          ) : (
                            <>
                              <div className="flex items-center gap-1.5">
                                <Users className="h-3.5 w-3.5 text-navy-400" aria-hidden />
                                <span className="font-medium text-navy-800">First contact:</span>{" "}
                                {profile.relationship_strategy.first_contact}
                              </div>
                              <div>
                                <span className="font-medium text-navy-800">Timing:</span>{" "}
                                {profile.relationship_strategy.timing}
                              </div>
                              {profile.relationship_strategy.escalation_path.length > 0 && (
                                <div>
                                  <span className="font-medium text-navy-800">Escalation path:</span>{" "}
                                  {profile.relationship_strategy.escalation_path.join(" → ")}
                                </div>
                              )}
                            </>
                          )}
                          {priority?.next_step && (
                            <div className="mt-2 border-t border-navy-100 pt-2">
                              <span className="font-medium text-navy-800">Next step:</span>{" "}
                              {priority.next_step}
                            </div>
                          )}
                        </div>
                      )}
                    </details>
                  </div>

                  {/* Actions */}
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-navy-100 pt-4">
                    <Button
                      size="sm"
                      onClick={() => void handleSubmitNow(item)}
                      isLoading={isSubmitting}
                      disabled={!canSubmitNow || actionLoading !== null}
                      title={
                        canSubmitNow
                          ? undefined
                          : "Only available for portal-eligible items still pending in the automation queue."
                      }
                    >
                      <Play className="mr-1 h-3.5 w-3.5" />
                      Submit Now
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setScheduleItem(item);
                        setScheduleDate("");
                      }}
                      disabled={!canSchedule || actionLoading !== null}
                      title={canSchedule ? undefined : "Not in the automation queue yet."}
                    >
                      <Clock className="mr-1 h-3.5 w-3.5" />
                      Schedule for Later
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => openPitchEditor(item)}>
                      <Pencil className="mr-1 h-3.5 w-3.5" />
                      Edit Pitch
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => toggleSection(item.id, "risk")}
                      disabled={!profile || profile.risk_factors.length === 0}
                    >
                      <ShieldAlert className="mr-1 h-3.5 w-3.5" />
                      Review Risk Factors
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setSkipItem(item)}
                      disabled={!canSkip || actionLoading !== null}
                      title={canSkip ? undefined : "Not in the automation queue — nothing to skip."}
                    >
                      <X className="mr-1 h-3.5 w-3.5" />
                      Skip
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Dossier modal */}
      <Modal
        isOpen={dossierItem !== null}
        onClose={() => setDossierItem(null)}
        title={dossierItem?.prospect?.display_name ?? "Dossier"}
        description={
          dossierItem?.dossier
            ? `Generated ${new Date(dossierItem.dossier.generated_at).toLocaleString()}`
            : undefined
        }
        size="lg"
        footer={
          <Button variant="secondary" onClick={() => setDossierItem(null)}>
            Close
          </Button>
        }
      >
        <p className="whitespace-pre-wrap text-sm text-navy-700">
          {dossierItem?.dossier?.narrative_text ?? "No dossier available for this prospect yet."}
        </p>
      </Modal>

      {/* Edit Pitch modal */}
      <Modal
        isOpen={pitchItem !== null}
        onClose={() => setPitchItem(null)}
        title="Edit Pitch"
        description={
          pitchItem
            ? `${pitchItem.funder?.name ?? "This funder"} — this pitch isn't wired to a persistence column yet, so edits here are for review and copying into your draft, not auto-saved.`
            : undefined
        }
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => void copyPitch()}>
              <Copy className="mr-1.5 h-3.5 w-3.5" />
              {pitchCopied ? "Copied" : "Copy to Clipboard"}
            </Button>
            <Button onClick={() => setPitchItem(null)}>
              <Check className="mr-1.5 h-3.5 w-3.5" />
              Done
            </Button>
          </>
        }
      >
        <textarea
          value={pitchDraft}
          onChange={(e) => {
            setPitchDraft(e.target.value);
            setPitchCopied(false);
          }}
          rows={10}
          className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm text-navy-800 focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
      </Modal>

      {/* Schedule modal */}
      <Modal
        isOpen={scheduleItem !== null}
        onClose={() => setScheduleItem(null)}
        title="Schedule for Later"
        description={scheduleItem?.funder?.name ?? undefined}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setScheduleItem(null)} disabled={actionLoading !== null}>
              Cancel
            </Button>
            <Button
              onClick={() => void handleScheduleConfirm()}
              isLoading={actionLoading === scheduleItem?.id + ":schedule"}
              disabled={!scheduleDate || actionLoading !== null}
            >
              Schedule
            </Button>
          </>
        }
      >
        <label htmlFor="schedule-date" className="mb-1.5 block text-sm font-medium text-navy-700">
          Submit on
        </label>
        <input
          id="schedule-date"
          type="datetime-local"
          value={scheduleDate}
          onChange={(e) => setScheduleDate(e.target.value)}
          className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm text-navy-800 focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
      </Modal>

      {/* Skip confirmation modal */}
      <Modal
        isOpen={skipItem !== null}
        onClose={() => setSkipItem(null)}
        title="Skip This Submission"
        description={skipItem?.funder?.name ?? undefined}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setSkipItem(null)} disabled={actionLoading !== null}>
              Cancel
            </Button>
            <Button
              onClick={() => void handleSkipConfirm()}
              isLoading={actionLoading === skipItem?.id + ":skip"}
              disabled={actionLoading !== null}
            >
              <FileSearch className="mr-1.5 h-3.5 w-3.5" />
              Skip Submission
            </Button>
          </>
        }
      >
        <p className="text-sm text-navy-600">
          Removes this item from the automation queue. It stays in BEN-APP-03&apos;s decision history and can be
          re-queued by a future run.
        </p>
      </Modal>
    </div>
  );
}
