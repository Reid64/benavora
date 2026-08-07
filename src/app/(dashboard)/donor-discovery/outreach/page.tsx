"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Building2, CheckCircle2, Loader2, Mail, RotateCcw, Sparkles, Users, Zap } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Button, Card, EmptyState, Input, Select, Textarea } from "@/components/ui";
import { canEdit, useProfile } from "@/lib/hooks/useProfile";

interface OutreachProspect {
  id: string;
  legalName: string;
  dbaName: string | null;
  displayName: string;
  industry: string | null;
  city: string | null;
  state: string | null;
  email: string | null;
  intentScore: number | null;
}

type TemplateId =
  | "community_investment_intro"
  | "matching_gift_program"
  | "sponsorship_proposal"
  | "grant_followup"
  | "custom";

interface TemplateOption {
  id: TemplateId;
  label: string;
  description: string;
  defaultSubject: string;
  defaultBody: string;
}

const TEMPLATES: TemplateOption[] = [
  {
    id: "community_investment_intro",
    label: "Community Investment Introduction",
    description: "Introduce our organization to their CSR team.",
    defaultSubject: "A community partnership opportunity with {org_name}",
    defaultBody:
      "Hi there,\n\nI'm reaching out on behalf of {org_name}. We'd love to introduce our work to {company_name}'s community investment team and explore whether our mission aligns with your giving priorities this year.\n\nWould you be open to a short introductory call?\n\nThank you,\n{org_name}",
  },
  {
    id: "matching_gift_program",
    label: "Matching Gift Program",
    description: "Encourage employee matching for {company_name}'s workforce.",
    defaultSubject: "Is {org_name} eligible for {company_name}'s employee matching program?",
    defaultBody:
      "Hi there,\n\nSeveral of our supporters work at {company_name}, and we wanted to check whether {org_name} is registered with your employee matching gift program.\n\nWe'd be glad to provide our EIN and any documentation your team needs to add us.\n\nThank you,\n{org_name}",
  },
  {
    id: "sponsorship_proposal",
    label: "Sponsorship Proposal",
    description: "Propose sponsorship of an event or program.",
    defaultSubject: "Sponsorship opportunity with {org_name}",
    defaultBody:
      "Hi there,\n\n{org_name} is planning an upcoming program and we think it could be a great fit for {company_name}'s community visibility goals.\n\nI'd love to share a short sponsorship proposal — would you have 15 minutes this month?\n\nThank you,\n{org_name}",
  },
  {
    id: "grant_followup",
    label: "Grant Application Follow-up",
    description: "A courteous follow-up after submitting through their portal.",
    defaultSubject: "Following up on our recent application to {company_name}",
    defaultBody:
      "Hi there,\n\nWe recently submitted an application through {company_name}'s giving portal on behalf of {org_name} and wanted to follow up to confirm it was received and see if any additional information would be helpful.\n\nThank you for your consideration,\n{org_name}",
  },
  {
    id: "custom",
    label: "Custom",
    description: "Start from a blank canvas.",
    defaultSubject: "",
    defaultBody: "",
  },
];

const DEFAULT_TEMPLATE = TEMPLATES.find((t) => t.id === "community_investment_intro")!;

const HIGH_INTENT_THRESHOLD = 75;
const SEARCH_DEBOUNCE_MS = 350;

function intentBadgeStyle(score: number | null): { backgroundColor: string; color: string } {
  if (score == null) return { backgroundColor: "#F1F5F9", color: "#64748B" };
  if (score >= HIGH_INTENT_THRESHOLD) return { backgroundColor: "#DCFCE7", color: "#15803D" };
  if (score >= 40) return { backgroundColor: "#FEF3C7", color: "#92400E" };
  return { backgroundColor: "#FEE2E2", color: "#B91C1C" };
}

function renderPreview(text: string, companyName: string, orgName: string): string {
  return text
    .replace(/\{company_name\}/g, companyName || "[Company Name]")
    .replace(/\{org_name\}/g, orgName || "[Your Organization]");
}

type BatchStatus = "pending" | "generating" | "success" | "failed" | "queued";

interface BatchDraft {
  prospectId: string;
  displayName: string;
  email: string | null;
  status: BatchStatus;
  error?: string;
  subject: string;
  body: string;
}

// Small concurrency cap on batch generation — each call is a real Claude
// completion (POST /api/intelligence/outreach/generate), so this is
// sequential-with-a-cap rather than firing all selected prospects at once.
const BATCH_CONCURRENCY = 3;

function batchStatusStyle(status: BatchStatus): { pill: { backgroundColor: string; color: string }; label: string } {
  switch (status) {
    case "pending":
      return { pill: { backgroundColor: "#F1F5F9", color: "#64748B" }, label: "Pending" };
    case "generating":
      return { pill: { backgroundColor: "#0077B61A", color: "#0077B6" }, label: "Generating…" };
    case "success":
      return { pill: { backgroundColor: "#DCFCE7", color: "#15803D" }, label: "Ready to review" };
    case "queued":
      return { pill: { backgroundColor: "#DCFCE7", color: "#15803D" }, label: "Queued" };
    case "failed":
      return { pill: { backgroundColor: "#FEE2E2", color: "#B91C1C" }, label: "Failed" };
  }
}

export default function CorporateOutreachPage() {
  const { profile } = useProfile();
  const editable = canEdit(profile?.role);

  const [prospects, setProspects] = useState<OutreachProspect[]>([]);
  const [loadingProspects, setLoadingProspects] = useState(true);
  const [prospectsError, setProspectsError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [templateType, setTemplateType] = useState<TemplateId>("community_investment_intro");
  const [subject, setSubject] = useState(DEFAULT_TEMPLATE.defaultSubject);
  const [body, setBody] = useState(DEFAULT_TEMPLATE.defaultBody);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const [queuing, setQueuing] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [queueSuccess, setQueueSuccess] = useState<string | null>(null);

  const [batchMode, setBatchMode] = useState(false);
  const [batchDrafts, setBatchDrafts] = useState<BatchDraft[]>([]);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchQueuing, setBatchQueuing] = useState(false);
  const [batchQueueError, setBatchQueueError] = useState<string | null>(null);
  const [batchQueueSuccess, setBatchQueueSuccess] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const loadProspects = useCallback(async (q: string) => {
    setLoadingProspects(true);
    setProspectsError(null);
    try {
      const qs = new URLSearchParams({ limit: "150" });
      if (q) qs.set("q", q);
      const res = await fetch(`/api/intelligence/outreach/prospects?${qs.toString()}`, { cache: "no-store" });
      if (!res.ok) {
        setProspectsError("Could not load corporate prospects.");
        setProspects([]);
      } else {
        const payload = (await res.json()) as { prospects: OutreachProspect[] };
        setProspects(payload.prospects ?? []);
      }
    } catch {
      setProspectsError("Could not reach the server.");
    }
    setLoadingProspects(false);
  }, []);

  useEffect(() => {
    void loadProspects(searchQuery);
  }, [searchQuery, loadProspects]);

  function toggleProspect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllHighIntent() {
    const highIntentIds = prospects
      .filter((p) => p.intentScore != null && p.intentScore > HIGH_INTENT_THRESHOLD)
      .map((p) => p.id);
    setSelectedIds((prev) => new Set([...prev, ...highIntentIds]));
  }

  const selectedProspects = useMemo(
    () => prospects.filter((p) => selectedIds.has(p.id)),
    [prospects, selectedIds],
  );
  const primaryProspect = selectedProspects[0] ?? null;

  function handleTemplateChange(id: TemplateId) {
    setTemplateType(id);
    setGenerateError(null);
    const preset = TEMPLATES.find((t) => t.id === id);
    if (preset) {
      setSubject(preset.defaultSubject);
      setBody(preset.defaultBody);
    }
  }

  async function handleGenerate() {
    if (!primaryProspect) {
      setGenerateError("Select at least one prospect to personalize this email.");
      return;
    }
    setGenerating(true);
    setGenerateError(null);
    setQueueSuccess(null);
    try {
      const res = await fetch("/api/intelligence/outreach/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prospectId: primaryProspect.id, templateType }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        subject?: string;
        body?: string;
        error?: string;
      };
      if (!res.ok || !payload.subject || !payload.body) {
        setGenerateError(payload.error ?? "AI generation failed.");
      } else {
        setSubject(payload.subject);
        setBody(payload.body);
      }
    } catch {
      setGenerateError("Could not reach the server.");
    }
    setGenerating(false);
  }

  const generateOneDraft = useCallback(
    async (prospectId: string): Promise<{ subject: string; body: string } | { error: string }> => {
      try {
        const res = await fetch("/api/intelligence/outreach/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prospectId, templateType }),
        });
        const payload = (await res.json().catch(() => ({}))) as {
          subject?: string;
          body?: string;
          error?: string;
        };
        if (!res.ok || !payload.subject || !payload.body) {
          return { error: payload.error ?? "AI generation failed." };
        }
        return { subject: payload.subject, body: payload.body };
      } catch {
        return { error: "Could not reach the server." };
      }
    },
    [templateType],
  );

  async function runBatchGeneration(ids: string[]) {
    let cursor = 0;
    async function worker() {
      while (cursor < ids.length) {
        const id = ids[cursor++];
        if (!id) continue;
        setBatchDrafts((prev) => prev.map((d) => (d.prospectId === id ? { ...d, status: "generating" } : d)));
        const result = await generateOneDraft(id);
        setBatchDrafts((prev) =>
          prev.map((d) => {
            if (d.prospectId !== id) return d;
            if ("error" in result) return { ...d, status: "failed", error: result.error };
            return { ...d, status: "success", subject: result.subject, body: result.body, error: undefined };
          }),
        );
      }
    }
    const workerCount = Math.min(BATCH_CONCURRENCY, ids.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
  }

  function handleStartBatch() {
    if (selectedProspects.length === 0) {
      setBatchQueueError("Select at least one prospect first.");
      return;
    }
    setBatchQueueError(null);
    setBatchQueueSuccess(null);
    setBatchMode(true);
    const initial: BatchDraft[] = selectedProspects.map((p) => ({
      prospectId: p.id,
      displayName: p.displayName,
      email: p.email,
      status: "pending",
      subject: "",
      body: "",
    }));
    setBatchDrafts(initial);
    setBatchRunning(true);
    void runBatchGeneration(initial.map((d) => d.prospectId)).finally(() => setBatchRunning(false));
  }

  function exitBatchMode() {
    setBatchMode(false);
    setBatchDrafts([]);
    setBatchQueueError(null);
    setBatchQueueSuccess(null);
  }

  async function handleRetryDraft(prospectId: string) {
    setBatchDrafts((prev) =>
      prev.map((d) => (d.prospectId === prospectId ? { ...d, status: "generating", error: undefined } : d)),
    );
    const result = await generateOneDraft(prospectId);
    setBatchDrafts((prev) =>
      prev.map((d) => {
        if (d.prospectId !== prospectId) return d;
        if ("error" in result) return { ...d, status: "failed", error: result.error };
        return { ...d, status: "success", subject: result.subject, body: result.body, error: undefined };
      }),
    );
  }

  function updateDraftField(prospectId: string, field: "subject" | "body", value: string) {
    setBatchDrafts((prev) => prev.map((d) => (d.prospectId === prospectId ? { ...d, [field]: value } : d)));
  }

  async function handleBatchQueue() {
    setBatchQueueError(null);
    setBatchQueueSuccess(null);
    const ready = batchDrafts.filter((d) => d.subject.trim() && d.body.trim() && d.status !== "queued");
    if (ready.length === 0) {
      setBatchQueueError("No drafts are ready to queue — generate or write content for at least one prospect.");
      return;
    }
    setBatchQueuing(true);
    try {
      const res = await fetch("/api/intelligence/outreach/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateType,
          drafts: ready.map((d) => ({
            id: d.prospectId,
            displayName: d.displayName,
            email: d.email,
            subject: d.subject,
            body: d.body,
          })),
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        queued?: number;
        queuedDrafts?: { prospectId: string }[];
        failedDrafts?: { prospectId: string; error: string }[];
        skipped?: string[];
        error?: string;
      };
      if (!res.ok) {
        setBatchQueueError(payload.error ?? "Failed to queue this batch.");
      } else {
        const queuedIds = new Set((payload.queuedDrafts ?? []).map((q) => q.prospectId));
        const failedMap = new Map((payload.failedDrafts ?? []).map((f) => [f.prospectId, f.error]));
        setBatchDrafts((prev) =>
          prev.map((d) => {
            if (queuedIds.has(d.prospectId)) return { ...d, status: "queued", error: undefined };
            if (failedMap.has(d.prospectId)) return { ...d, status: "failed", error: failedMap.get(d.prospectId) };
            return d;
          }),
        );
        const skippedNote =
          payload.skipped && payload.skipped.length > 0
            ? ` ${payload.skipped.length} skipped (missing email, subject, or body).`
            : "";
        setBatchQueueSuccess(
          `Queued ${payload.queued ?? 0} personalized email${payload.queued === 1 ? "" : "s"} for sending.${skippedNote}`,
        );
      }
    } catch {
      setBatchQueueError("Could not reach the server.");
    }
    setBatchQueuing(false);
  }

  async function handleQueue() {
    setQueueError(null);
    setQueueSuccess(null);
    if (!subject.trim() || !body.trim()) {
      setQueueError("Subject and body are both required.");
      return;
    }
    if (selectedProspects.length === 0) {
      setQueueError("Select at least one prospect to send to.");
      return;
    }
    setQueuing(true);
    try {
      const res = await fetch("/api/intelligence/outreach/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject,
          body,
          templateType,
          prospects: selectedProspects.map((p) => ({ id: p.id, displayName: p.displayName, email: p.email })),
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        queued?: number;
        skipped?: string[];
        estimatedBatchSize?: number;
        error?: string;
      };
      if (!res.ok) {
        setQueueError(payload.error ?? "Failed to queue this campaign.");
      } else {
        const skippedNote =
          payload.skipped && payload.skipped.length > 0
            ? ` ${payload.skipped.length} prospect${payload.skipped.length === 1 ? "" : "s"} skipped (no email on file).`
            : "";
        setQueueSuccess(
          `Queued ${payload.queued ?? 0} email${payload.queued === 1 ? "" : "s"} for sending, processed in batches of up to ${payload.estimatedBatchSize ?? 50}.${skippedNote}`,
        );
        setSelectedIds(new Set());
      }
    } catch {
      setQueueError("Could not reach the server.");
    }
    setQueuing(false);
  }

  const previewCompanyName = primaryProspect?.displayName ?? "";
  const orgNamePlaceholder = "your organization";

  return (
    <div
      className="-m-4 min-h-full space-y-6 p-4 sm:-m-6 sm:p-6 lg:-m-8 lg:p-8"
      style={{ backgroundColor: "#D6E4F0" }}
    >
      <Link
        href="/donor-discovery"
        className="inline-flex items-center gap-1.5 text-sm text-navy-500 transition hover:text-navy-700"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to Donor Discovery
      </Link>

      <PageHeader
        title="Corporate Outreach"
        description="AI-crafted personalized outreach to corporate prospects"
      />

      {!editable && (
        <div
          role="status"
          className="rounded-lg border px-4 py-3 text-sm"
          style={{ backgroundColor: "#FEF3C7", borderColor: "#FDE68A", color: "#92400E" }}
        >
          Your role is read-only for outreach. You can browse prospects and templates, but generating and queuing
          require a writer role or higher.
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Prospect Selector */}
        <div className="lg:col-span-5">
          <Card
            title="Prospect Selector"
            description={`${selectedIds.size} selected`}
            className="h-full"
          >
            <div className="space-y-3">
              <Input
                aria-label="Search corporate prospects"
                placeholder="Search company name or industry..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />

              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={selectAllHighIntent}
                disabled={!prospects.some((p) => p.intentScore != null && p.intentScore > HIGH_INTENT_THRESHOLD)}
              >
                <Zap className="h-3.5 w-3.5" aria-hidden />
                Select All High-Intent (&gt;{HIGH_INTENT_THRESHOLD})
              </Button>

              {prospectsError && (
                <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {prospectsError}
                </div>
              )}

              <div className="max-h-[520px] space-y-1.5 overflow-y-auto pr-1">
                {loadingProspects ? (
                  <div className="flex items-center justify-center py-8 text-sm text-slate-500">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                    Loading prospects…
                  </div>
                ) : prospects.length === 0 ? (
                  <EmptyState
                    icon={Building2}
                    title="No prospects found"
                    description="Try a different search, or run Donor Discovery to build your corporate prospect pool."
                  />
                ) : (
                  prospects.map((p) => {
                    const checked = selectedIds.has(p.id);
                    const badge = intentBadgeStyle(p.intentScore);
                    return (
                      <div
                        key={p.id}
                        className="flex items-start gap-3 rounded-lg border px-3 py-2.5 transition hover:bg-slate-50"
                        style={{ borderColor: checked ? "#0077B6" : "#E2E8F0", backgroundColor: checked ? "#EFF8FF" : "#FFFFFF" }}
                      >
                        <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleProspect(p.id)}
                            className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300"
                            style={{ accentColor: "#0077B6" }}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <p className="truncate text-sm font-semibold text-navy-900">{p.displayName}</p>
                              <span
                                style={badge}
                                className="shrink-0 rounded-full px-2 py-0.5 text-xs font-bold"
                                title={p.intentScore != null ? "Predicted intent score" : "No intent signal on file"}
                              >
                                {p.intentScore != null ? p.intentScore : "—"}
                              </span>
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                              {p.industry && (
                                <span
                                  style={{ backgroundColor: "#0077B61A", color: "#0077B6" }}
                                  className="rounded-full px-2 py-0.5 font-medium"
                                >
                                  {p.industry}
                                </span>
                              )}
                              {(p.city || p.state) && <span>{[p.city, p.state].filter(Boolean).join(", ")}</span>}
                              {!p.email && (
                                <span style={{ color: "#B91C1C" }} className="font-medium">
                                  No email on file
                                </span>
                              )}
                            </div>
                          </div>
                        </label>
                        <Link
                          href={`/donor-discovery/outreach/prospects/${p.id}`}
                          className="mt-0.5 shrink-0 text-xs font-medium hover:underline"
                          style={{ color: "#0077B6" }}
                          title="View Corporate Giving DNA profile"
                        >
                          Profile
                        </Link>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </Card>
        </div>

        {/* Email Composer */}
        <div className="lg:col-span-7">
          <Card title="Email Composer" description="Craft and personalize outreach to your selected prospects.">
            <div className="space-y-4">
              <Select
                aria-label="Template"
                options={TEMPLATES.map((t) => ({ value: t.id, label: t.label }))}
                value={templateType}
                onChange={(e) => handleTemplateChange(e.target.value as TemplateId)}
              />
              <p className="-mt-2 text-xs text-slate-500">
                {TEMPLATES.find((t) => t.id === templateType)?.description}
              </p>

              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" onClick={handleGenerate} disabled={generating || !editable || batchMode}>
                  {generating ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Sparkles className="h-4 w-4" aria-hidden />
                  )}
                  {generating ? "Generating…" : "Generate with AI"}
                </Button>
                <span className="text-xs text-slate-500">
                  {batchMode
                    ? "Batch mode active — one shared draft is disabled while personalizing per prospect."
                    : primaryProspect
                      ? `Personalized using: ${primaryProspect.displayName}`
                      : "Select a prospect to personalize with AI"}
                </span>
              </div>

              {!batchMode && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleStartBatch}
                  disabled={!editable || selectedProspects.length === 0}
                >
                  <Users className="h-4 w-4" aria-hidden />
                  Generate personalized email for each selected prospect ({selectedProspects.length})
                </Button>
              )}

              {generateError && !batchMode && (
                <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {generateError}
                </div>
              )}

              {!batchMode && (
                <>
                  <Input
                    label="Subject"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Email subject"
                  />

                  <Textarea
                    label="Body"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="Email body"
                    style={{ minHeight: "300px" }}
                    rows={12}
                  />

                  <div>
                    <p className="mb-1.5 text-sm font-medium text-slate-700">Preview</p>
                    <div
                      className="rounded-lg border p-4"
                      style={{ borderColor: "#E2E8F0", backgroundColor: "#F8FAFC" }}
                    >
                      <p className="text-sm font-semibold text-navy-900">
                        {renderPreview(subject, previewCompanyName, orgNamePlaceholder) || (
                          <span className="text-slate-400">No subject yet</span>
                        )}
                      </p>
                      <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">
                        {renderPreview(body, previewCompanyName, orgNamePlaceholder) || (
                          <span className="text-slate-400">No body yet</span>
                        )}
                      </p>
                    </div>
                    {!primaryProspect && (
                      <p className="mt-1.5 text-xs text-slate-500">
                        Select a prospect above to preview with its real company name.
                      </p>
                    )}
                  </div>

                  {queueError && (
                    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      {queueError}
                    </div>
                  )}
                  {queueSuccess && (
                    <div
                      role="status"
                      className="flex items-start gap-2 rounded-lg border px-3 py-2 text-sm"
                      style={{ backgroundColor: "#DCFCE7", borderColor: "#BBF7D0", color: "#15803D" }}
                    >
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                      {queueSuccess}
                    </div>
                  )}

                  <div className="flex items-center justify-between border-t pt-4" style={{ borderColor: "#E2E8F0" }}>
                    <p className="text-xs text-slate-500">
                      {selectedProspects.length} prospect{selectedProspects.length === 1 ? "" : "s"} will receive this
                      email.
                    </p>
                    <Button type="button" onClick={handleQueue} disabled={queuing || !editable}>
                      {queuing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Mail className="h-4 w-4" aria-hidden />}
                      {queuing ? "Queuing…" : "Queue for Sending"}
                    </Button>
                  </div>
                </>
              )}

              {batchMode && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-slate-700">
                      Personalizing {batchDrafts.length} prospect{batchDrafts.length === 1 ? "" : "s"}
                      {batchRunning ? " — generating…" : ""}
                    </p>
                    <Button type="button" variant="secondary" size="sm" onClick={exitBatchMode}>
                      Exit batch mode
                    </Button>
                  </div>

                  {batchQueueError && (
                    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      {batchQueueError}
                    </div>
                  )}
                  {batchQueueSuccess && (
                    <div
                      role="status"
                      className="flex items-start gap-2 rounded-lg border px-3 py-2 text-sm"
                      style={{ backgroundColor: "#DCFCE7", borderColor: "#BBF7D0", color: "#15803D" }}
                    >
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                      {batchQueueSuccess}
                    </div>
                  )}

                  <div className="max-h-[560px] space-y-3 overflow-y-auto pr-1">
                    {batchDrafts.map((d) => {
                      const badge = batchStatusStyle(d.status);
                      const showEditor = d.status === "success" || d.status === "queued" || (d.status === "failed" && (d.subject || d.body));
                      return (
                        <div
                          key={d.prospectId}
                          className="rounded-lg border p-3"
                          style={{ borderColor: "#E2E8F0", backgroundColor: "#FFFFFF" }}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-sm font-semibold text-navy-900">{d.displayName}</p>
                            <span style={badge.pill} className="shrink-0 rounded-full px-2 py-0.5 text-xs font-bold">
                              {badge.label}
                            </span>
                          </div>

                          {d.status === "pending" && (
                            <p className="mt-2 text-xs text-slate-500">Waiting to generate…</p>
                          )}

                          {d.status === "generating" && (
                            <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                              Generating personalized email…
                            </div>
                          )}

                          {d.status === "failed" && (
                            <div className="mt-2 space-y-1.5">
                              <p className="text-xs font-medium" style={{ color: "#B91C1C" }}>
                                {d.error ?? "Generation failed."}
                              </p>
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={() => handleRetryDraft(d.prospectId)}
                                disabled={!editable}
                              >
                                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                                Retry
                              </Button>
                            </div>
                          )}

                          {showEditor && (
                            <div className="mt-2 space-y-2">
                              <Input
                                aria-label={`Subject for ${d.displayName}`}
                                value={d.subject}
                                onChange={(e) => updateDraftField(d.prospectId, "subject", e.target.value)}
                                disabled={d.status === "queued" || !editable}
                                placeholder="Email subject"
                              />
                              <Textarea
                                aria-label={`Body for ${d.displayName}`}
                                value={d.body}
                                onChange={(e) => updateDraftField(d.prospectId, "body", e.target.value)}
                                disabled={d.status === "queued" || !editable}
                                rows={6}
                                style={{ minHeight: "140px" }}
                                placeholder="Email body"
                              />
                              {!d.email && (
                                <p className="text-xs font-medium" style={{ color: "#B91C1C" }}>
                                  No email on file — this prospect will be skipped when queuing.
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex items-center justify-between border-t pt-4" style={{ borderColor: "#E2E8F0" }}>
                    <p className="text-xs text-slate-500">
                      {batchDrafts.filter((d) => d.status === "queued").length} of {batchDrafts.length} queued.
                    </p>
                    <Button type="button" onClick={handleBatchQueue} disabled={batchQueuing || batchRunning || !editable}>
                      {batchQueuing ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      ) : (
                        <Mail className="h-4 w-4" aria-hidden />
                      )}
                      {batchQueuing ? "Queuing…" : "Queue All Personalized Emails"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
