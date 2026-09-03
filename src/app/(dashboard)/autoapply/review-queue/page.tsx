"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  ExternalLink,
  Mail,
  RefreshCw,
  ShieldAlert,
  UserCheck,
  X,
} from "lucide-react";

import { Badge, Button, Card, EmptyState } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/hooks/useProfile";
import {
  riskScoreProps,
  type RiskFactor,
} from "@/components/autoapply/ManualQueue";

// AUTOAPPLY_ARCHITECTURE_V2.md §10C "Human Review Queue UI" — two tabs, one
// page: CAPTCHA/verification-paused submission_queue items (§10B) and
// ambiguous Gmail confirmation matches (§10A). Distinct from ManualQueue.tsx
// (automation_mode='manual' pre-submission routing, §8B) and from
// /autoapply/[sessionId] (single-session detail view) — a different queue
// with a different resolution action (resume-a-pause vs.
// manually-complete-a-submission), per §10C's own instruction not to fold
// this into ManualQueue.tsx.

const SKIP_REASONS = [
  { value: "not_worth_it", label: "Not worth pursuing" },
  { value: "portal_broken", label: "Portal broken / unavailable" },
  { value: "duplicate", label: "Duplicate submission" },
  { value: "other", label: "Other" },
] as const;

const PAUSE_REASON_LABELS: Record<string, string> = {
  captcha_recaptcha_v2: "reCAPTCHA v2 detected",
  captcha_hcaptcha: "hCaptcha detected",
  captcha_image: "Image CAPTCHA detected",
  captcha_recaptcha_v3_unsupported: "reCAPTCHA v3 (unsupported) detected",
  verification_challenge_detected: "Verification challenge detected",
};

function pauseReasonLabel(reason: string | null): string {
  if (!reason) return "Unknown reason";
  return PAUSE_REASON_LABELS[reason] ?? reason.replace(/_/g, " ");
}

function elapsedLabel(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "just now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ── Types (mirrors the GET /api/autoapply/review-queue response shape) ─────

interface PausedItem {
  id: string;
  funderName: string | null;
  givingPortalUrl: string | null;
  orgName: string | null;
  pauseReason: string | null;
  pausedAt: string | null;
  screenshotUrl: string | null;
  resumeCount: number;
  riskScore: number | null;
  riskFactors: RiskFactor[];
  createdAt: string;
}

interface AmbiguousCandidate {
  submissionId: string;
  funderName: string | null;
  submittedAt: string | null;
}

interface AmbiguousItem {
  id: string;
  sender: string | null;
  subject: string | null;
  receivedAt: string | null;
  candidates: AmbiguousCandidate[];
  hiddenCandidateCount: number;
}

interface OrgMember {
  id: string;
  email: string;
  full_name: string | null;
}

type Tab = "paused" | "ambiguous";

export default function ReviewQueuePage() {
  const { profile } = useProfile();
  const supabase = useMemo(() => createClient(), []);

  const [activeTab, setActiveTab] = useState<Tab>("paused");
  const [paused, setPaused] = useState<PausedItem[]>([]);
  const [ambiguous, setAmbiguous] = useState<AmbiguousItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // Skip modal (Tab 1)
  const [skipItem, setSkipItem] = useState<PausedItem | null>(null);
  const [skipReason, setSkipReason] = useState<string>("not_worth_it");

  // Reassign modal (Tab 1)
  const [reassignItem, setReassignItem] = useState<PausedItem | null>(null);
  const [orgMembers, setOrgMembers] = useState<OrgMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState("");

  // Resolve picker (Tab 2)
  const [resolveItem, setResolveItem] = useState<AmbiguousItem | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | "none">("none");

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/autoapply/review-queue");
      if (!res.ok) throw new Error("request failed");
      const json = (await res.json()) as { paused: PausedItem[]; ambiguous: AmbiguousItem[] };
      setPaused(json.paused);
      setAmbiguous(json.ambiguous);
    } catch {
      setError("Could not load the review queue.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  // ── Tab 1 actions ──────────────────────────────────────────────────────

  async function handlePatch(
    url: string,
    body: unknown,
    onConflict: () => void,
  ): Promise<boolean> {
    const res = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    if (res.status === 409) {
      onConflict();
      return false;
    }
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setActionError(err.error ?? "Action failed. Please try again.");
      return false;
    }
    return true;
  }

  async function handleResume(item: PausedItem) {
    setActionLoading(item.id + ":resume");
    setActionError(null);
    const ok = await handlePatch(
      `/api/autoapply/review-queue/${item.id}/resume`,
      {},
      () => setPaused((prev) => prev.filter((p) => p.id !== item.id)),
    );
    if (ok) setPaused((prev) => prev.filter((p) => p.id !== item.id));
    setActionLoading(null);
  }

  async function handleSkipConfirm() {
    if (!skipItem) return;
    setActionLoading(skipItem.id + ":skip");
    setActionError(null);
    const item = skipItem;
    const ok = await handlePatch(
      `/api/autoapply/review-queue/${item.id}/skip`,
      { reason: skipReason },
      () => setPaused((prev) => prev.filter((p) => p.id !== item.id)),
    );
    if (ok) setPaused((prev) => prev.filter((p) => p.id !== item.id));
    setSkipItem(null);
    setActionLoading(null);
  }

  async function openReassignModal(item: PausedItem) {
    setReassignItem(item);
    setSelectedMemberId("");
    setMembersLoading(true);
    if (profile?.organization_id) {
      const { data } = await supabase
        .from("profiles")
        .select("id, email, full_name")
        .eq("organization_id", profile.organization_id)
        .order("full_name");
      setOrgMembers((data ?? []) as OrgMember[]);
    }
    setMembersLoading(false);
  }

  async function handleReassignConfirm() {
    if (!reassignItem || !selectedMemberId) return;
    setActionLoading(reassignItem.id + ":reassign");
    setActionError(null);
    const item = reassignItem;
    const ok = await handlePatch(
      `/api/autoapply/review-queue/${item.id}/reassign`,
      { assigneeUserId: selectedMemberId },
      () => setPaused((prev) => prev.filter((p) => p.id !== item.id)),
    );
    // Reassign never resolves the pause — the row stays in the tab; a
    // successful reassign only needs to close the modal and clear its state.
    if (ok) {
      setReassignItem(null);
      setSelectedMemberId("");
    } else {
      setReassignItem(null);
    }
    setActionLoading(null);
  }

  // ── Tab 2 actions ──────────────────────────────────────────────────────

  function openResolveModal(item: AmbiguousItem) {
    setResolveItem(item);
    setSelectedCandidateId("none");
  }

  async function handleResolveConfirm() {
    if (!resolveItem) return;
    setActionLoading(resolveItem.id + ":resolve");
    setActionError(null);
    const item = resolveItem;
    const submissionId = selectedCandidateId === "none" ? null : selectedCandidateId;
    const ok = await handlePatch(
      `/api/autoapply/review-queue/ambiguous/${item.id}/resolve`,
      { submissionId },
      () => setAmbiguous((prev) => prev.filter((a) => a.id !== item.id)),
    );
    if (ok) setAmbiguous((prev) => prev.filter((a) => a.id !== item.id));
    setResolveItem(null);
    setActionLoading(null);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy-900">Applications Needing Attention</h1>
        <p className="mt-1 text-sm text-navy-500">
          Submissions paused for CAPTCHA/verification and ambiguous Gmail confirmation matches
          requiring a human decision.
        </p>
      </div>

      {actionError && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {actionError}
        </div>
      )}

      {/* Tab navigation */}
      <div className="flex items-center gap-1 rounded-lg border border-navy-100 bg-navy-50 p-1 w-fit">
        <button
          type="button"
          onClick={() => setActiveTab("paused")}
          className={`flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
            activeTab === "paused" ? "bg-surface text-navy-900 shadow-sm" : "text-navy-500 hover:text-navy-700"
          }`}
        >
          Paused for Verification
          {paused.length > 0 && (
            <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-amber-500 px-1.5 text-xs font-bold text-white">
              {paused.length}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("ambiguous")}
          className={`flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
            activeTab === "ambiguous" ? "bg-surface text-navy-900 shadow-sm" : "text-navy-500 hover:text-navy-700"
          }`}
        >
          Ambiguous Confirmations
          {ambiguous.length > 0 && (
            <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-amber-500 px-1.5 text-xs font-bold text-white">
              {ambiguous.length}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => void loadQueue()}
          className="ml-2 flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-navy-500 hover:text-navy-700"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : loading ? (
        <p className="text-sm text-navy-400">Loading review queue…</p>
      ) : activeTab === "paused" ? (
        <PausedTab
          items={paused}
          actionLoading={actionLoading}
          onResume={handleResume}
          onOpenSkip={(item) => {
            setSkipItem(item);
            setSkipReason("not_worth_it");
          }}
          onOpenReassign={(item) => void openReassignModal(item)}
          onOpenScreenshot={setLightboxUrl}
        />
      ) : (
        <AmbiguousTab items={ambiguous} actionLoading={actionLoading} onOpenResolve={openResolveModal} />
      )}

      {/* ── Lightbox ─────────────────────────────────────────────────────── */}
      {lightboxUrl !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            type="button"
            className="absolute right-4 top-4 text-white hover:text-navy-300"
            onClick={() => setLightboxUrl(null)}
            aria-label="Close"
          >
            <X className="h-6 w-6" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element -- signed Supabase Storage URL, dimensions unknown */}
          <img
            src={lightboxUrl}
            alt="Paused submission screenshot"
            className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* ── Skip modal ───────────────────────────────────────────────────── */}
      {skipItem !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-navy-900">Skip This Submission</h2>
                <p className="mt-0.5 text-sm text-navy-500">{skipItem.funderName ?? "This funder"}</p>
              </div>
              <button type="button" onClick={() => setSkipItem(null)} className="text-navy-400 hover:text-navy-700" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div>
              <label htmlFor="skip-reason" className="mb-1.5 block text-sm font-medium text-navy-700">
                Reason
              </label>
              <select
                id="skip-reason"
                value={skipReason}
                onChange={(e) => setSkipReason(e.target.value)}
                className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm text-navy-800 focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                {SKIP_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setSkipItem(null)} disabled={actionLoading !== null}>
                Cancel
              </Button>
              <Button
                onClick={() => void handleSkipConfirm()}
                isLoading={actionLoading === skipItem.id + ":skip"}
                disabled={actionLoading !== null}
              >
                Skip Submission
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reassign modal ───────────────────────────────────────────────── */}
      {reassignItem !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-navy-900">Reassign to Team Member</h2>
                <p className="mt-0.5 text-sm text-navy-500">{reassignItem.funderName ?? "This funder"}</p>
              </div>
              <button type="button" onClick={() => setReassignItem(null)} className="text-navy-400 hover:text-navy-700" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>
            {membersLoading ? (
              <p className="py-4 text-sm text-navy-400">Loading team members…</p>
            ) : orgMembers.length === 0 ? (
              <p className="py-4 text-sm text-navy-500">No other team members found.</p>
            ) : (
              <div>
                <label htmlFor="reassign-member" className="mb-1.5 block text-sm font-medium text-navy-700">
                  Assign to
                </label>
                <select
                  id="reassign-member"
                  value={selectedMemberId}
                  onChange={(e) => setSelectedMemberId(e.target.value)}
                  className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm text-navy-800 focus:outline-none focus:ring-2 focus:ring-teal-500"
                >
                  <option value="">Select a team member…</option>
                  {orgMembers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.full_name ? `${m.full_name} (${m.email})` : m.email}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="mt-5 flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setReassignItem(null)} disabled={actionLoading !== null}>
                Cancel
              </Button>
              <Button
                onClick={() => void handleReassignConfirm()}
                isLoading={actionLoading === reassignItem.id + ":reassign"}
                disabled={actionLoading !== null || !selectedMemberId || membersLoading}
              >
                <UserCheck className="mr-1.5 h-4 w-4" />
                Reassign
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Resolve modal (Tab 2) ────────────────────────────────────────── */}
      {resolveItem !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-xl border border-border bg-surface p-6 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-navy-900">Resolve Ambiguous Match</h2>
                <p className="mt-0.5 text-sm text-navy-500">{resolveItem.subject ?? "(no subject)"}</p>
              </div>
              <button type="button" onClick={() => setResolveItem(null)} className="text-navy-400 hover:text-navy-700" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mb-3 text-sm text-navy-500">
              Pick the submission this confirmation email actually belongs to.
            </p>
            <div className="space-y-2">
              {resolveItem.candidates.map((c) => (
                <label
                  key={c.submissionId}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border border-navy-200 px-4 py-3 hover:bg-navy-50"
                >
                  <input
                    type="radio"
                    name="candidate"
                    checked={selectedCandidateId === c.submissionId}
                    onChange={() => setSelectedCandidateId(c.submissionId)}
                    className="text-teal-600 focus:ring-teal-500"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-navy-900">{c.funderName ?? "Unknown funder"}</p>
                    <p className="text-xs text-navy-400">
                      Submitted {c.submittedAt ? new Date(c.submittedAt).toLocaleString() : "—"}
                    </p>
                  </div>
                </label>
              ))}
              <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-navy-200 px-4 py-3 hover:bg-navy-50">
                <input
                  type="radio"
                  name="candidate"
                  checked={selectedCandidateId === "none"}
                  onChange={() => setSelectedCandidateId("none")}
                  className="text-teal-600 focus:ring-teal-500"
                />
                <span className="text-sm font-medium text-navy-700">None of these</span>
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setResolveItem(null)} disabled={actionLoading !== null}>
                Cancel
              </Button>
              <Button
                onClick={() => void handleResolveConfirm()}
                isLoading={actionLoading === resolveItem.id + ":resolve"}
                disabled={actionLoading !== null}
              >
                <Check className="mr-1.5 h-4 w-4" />
                Confirm
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab 1: Paused for Verification ────────────────────────────────────────

function PausedTab({
  items,
  actionLoading,
  onResume,
  onOpenSkip,
  onOpenReassign,
  onOpenScreenshot,
}: {
  items: PausedItem[];
  actionLoading: string | null;
  onResume: (item: PausedItem) => void;
  onOpenSkip: (item: PausedItem) => void;
  onOpenReassign: (item: PausedItem) => void;
  onOpenScreenshot: (url: string) => void;
}) {
  if (items.length === 0) {
    return (
      <Card noPadding>
        <div className="p-5">
          <EmptyState
            icon={ShieldAlert}
            title="Nothing paused right now"
            description="Submissions that hit a CAPTCHA or verification challenge appear here for human resolution."
          />
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {items.map((item) => {
        const { color: riskColor, label: riskLabel } = riskScoreProps(item.riskScore);
        return (
          <Card key={item.id} noPadding>
            <div className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-navy-900">{item.funderName ?? "Unknown funder"}</h3>
                    <Badge color="orange" withDot>
                      {pauseReasonLabel(item.pauseReason)}
                    </Badge>
                    <span className="text-xs text-navy-400">paused {elapsedLabel(item.pausedAt)}</span>
                    {item.resumeCount > 0 && (
                      <span className="text-xs text-navy-400">· resumed {item.resumeCount}x before</span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-navy-500">{item.orgName ?? "—"}</p>
                  {item.givingPortalUrl && (
                    <a
                      href={item.givingPortalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-flex items-center gap-1 text-sm text-teal-500 hover:underline"
                    >
                      {item.givingPortalUrl}
                      <ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
                  )}
                  {item.riskFactors.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge color={riskColor} withDot>
                        {riskLabel}
                      </Badge>
                      {item.riskFactors.map((f, idx) => (
                        <span key={idx} className="rounded bg-navy-50 px-2 py-0.5 text-xs text-navy-600" title={f.description}>
                          {f.name} (+{f.points})
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {item.screenshotUrl && (
                  <button
                    type="button"
                    onClick={() => onOpenScreenshot(item.screenshotUrl as string)}
                    className="group relative shrink-0 overflow-hidden rounded-lg border border-navy-200 focus:outline-none focus:ring-2 focus:ring-teal-500"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- signed Supabase Storage URL, dimensions unknown */}
                    <img src={item.screenshotUrl} alt="Pause screenshot" className="h-20 w-32 object-cover" />
                    <span className="absolute inset-x-0 bottom-0 bg-navy-900/70 px-1.5 py-1 text-center text-[10px] text-white">
                      Click to enlarge
                    </span>
                  </button>
                )}
              </div>

              <div className="mt-4 flex flex-wrap gap-2 border-t border-navy-100 pt-4">
                <Button
                  size="sm"
                  onClick={() => onResume(item)}
                  isLoading={actionLoading === item.id + ":resume"}
                  disabled={actionLoading !== null}
                >
                  <Check className="mr-1 h-3.5 w-3.5" />
                  Mark Resolved & Retry
                </Button>
                <Button size="sm" variant="secondary" onClick={() => onOpenSkip(item)} disabled={actionLoading !== null}>
                  Skip
                </Button>
                <Button size="sm" variant="secondary" onClick={() => onOpenReassign(item)} disabled={actionLoading !== null}>
                  <UserCheck className="mr-1 h-3.5 w-3.5" />
                  Reassign
                </Button>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

// ── Tab 2: Ambiguous Confirmations ────────────────────────────────────────

function AmbiguousTab({
  items,
  actionLoading,
  onOpenResolve,
}: {
  items: AmbiguousItem[];
  actionLoading: string | null;
  onOpenResolve: (item: AmbiguousItem) => void;
}) {
  if (items.length === 0) {
    return (
      <Card noPadding>
        <div className="p-5">
          <EmptyState
            icon={Mail}
            title="No ambiguous confirmations"
            description="Confirmation emails that match more than one of your submissions appear here for manual matching."
          />
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {items.map((item) => (
        <Card key={item.id} noPadding>
          <div className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-semibold text-navy-900">{item.subject ?? "(no subject)"}</h3>
                  <span className="text-xs text-navy-400">{elapsedLabel(item.receivedAt)}</span>
                </div>
                <p className="mt-1 text-sm text-navy-500">From: {item.sender ?? "—"}</p>
                <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-600">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Matches {item.candidates.length} of your submissions
                  {item.hiddenCandidateCount > 0 &&
                    ` (+${item.hiddenCandidateCount} candidate${item.hiddenCandidateCount === 1 ? "" : "s"} from other organizations, not shown)`}
                </p>
              </div>
              <Button
                size="sm"
                onClick={() => onOpenResolve(item)}
                isLoading={actionLoading === item.id + ":resolve"}
                disabled={actionLoading !== null}
              >
                Resolve
              </Button>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
