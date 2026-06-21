"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  ExternalLink,
  FileSearch,
  Play,
  Plus,
  RefreshCw,
  Settings,
} from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import type { BadgeColor } from "@/components/ui/Badge";
import { Button, Card, EmptyState, Modal } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/hooks/useProfile";
import type { Json } from "@/types/database";
import { WorkerStatus } from "@/components/autoapply/WorkerStatus";
import { QueueMetrics } from "@/components/autoapply/QueueMetrics";
import { QueuePreview } from "@/components/autoapply/QueuePreview";
import { QueuePanel } from "@/components/autoapply/QueuePanel";
import { SubmissionHistory } from "@/components/autoapply/SubmissionHistory";
import { ReviewQueue } from "@/components/autoapply/ReviewQueue";
// Lazy-loaded: SuccessAnalytics statically imports the full recharts library
// (~130 kB), which alone inflated this route's first-load JS. It renders below
// the fold, so defer it to a client-only chunk fetched after initial paint.
const SuccessAnalytics = dynamic(
  () =>
    import("@/components/autoapply/SuccessAnalytics").then(
      (m) => m.SuccessAnalytics,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-lg border border-navy-100 bg-white p-5 text-sm text-navy-400">
        Loading analytics…
      </div>
    ),
  },
);

interface QueueRow {
  id: string;
  funder_id: string | null;
  priority: number;
  status: string;
  automation_mode: string;
  scheduled_for: string | null;
  created_at: string;
  funders: { name: string; giving_portal_url: string | null } | null;
}

interface TemplateRow {
  id: string;
  funder_id: string | null;
  portal_url: string;
  field_mapping: Json | null;
  last_verified_at: string | null;
  last_used_at: string | null;
  funders: { name: string } | null;
}

interface FunderOption {
  id: string;
  name: string;
  giving_portal_url: string;
}

function queueStatusBadge(status: string): { color: BadgeColor; label: string } {
  switch (status) {
    case "pending":
    case "queued":
      return { color: "gray", label: "Queued" };
    case "processing":
    case "running":
      return { color: "yellow", label: "Processing" };
    case "completed":
      return { color: "teal", label: "Completed" };
    case "failed":
      return { color: "red", label: "Failed" };
    default:
      return { color: "gray", label: status };
  }
}

function countFields(fieldMapping: Json | null): number {
  if (fieldMapping === null || fieldMapping === undefined) return 0;
  if (Array.isArray(fieldMapping)) return fieldMapping.length;
  if (typeof fieldMapping === "object") return Object.keys(fieldMapping as Record<string, unknown>).length;
  return 0;
}

function truncateUrl(url: string, max = 45): string {
  if (url.length <= max) return url;
  return url.slice(0, max) + "…";
}

export default function AutoApplyPage() {
  const { profile } = useProfile();

  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [selectedQueueIds, setSelectedQueueIds] = useState<Set<string>>(new Set());

  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [reanalyzingId, setReanalyzingId] = useState<string | null>(null);

  const [addToQueueOpen, setAddToQueueOpen] = useState(false);
  const [funders, setFunders] = useState<FunderOption[]>([]);
  const [fundersLoading, setFundersLoading] = useState(false);
  const [selectedFunderIds, setSelectedFunderIds] = useState<Set<string>>(new Set());
  const [addingToQueue, setAddingToQueue] = useState(false);

  const [analyzing, setAnalyzing] = useState(false);
  const [runningSelected, setRunningSelected] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    setQueueLoading(true);
    const supabase = createClient();
    try {
      const { data, error } = await supabase
        .from("submission_queue")
        .select("*, funders(name, giving_portal_url)")
        .order("priority", { ascending: false })
        .order("created_at", { ascending: true });
      if (error) throw error;
      setQueue((data ?? []) as unknown as QueueRow[]);
      setQueueError(null);
    } catch {
      setQueueError("Could not load the submission queue.");
    } finally {
      setQueueLoading(false);
    }
  }, []);

  const loadTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    const supabase = createClient();
    try {
      const { data, error } = await supabase
        .from("form_templates")
        .select("*, funders(name)")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      setTemplates((data ?? []) as unknown as TemplateRow[]);
      setTemplatesError(null);
    } catch {
      setTemplatesError("Could not load form templates.");
    } finally {
      setTemplatesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadQueue();
    void loadTemplates();
  }, [loadQueue, loadTemplates]);

  async function openAddToQueue() {
    setAddToQueueOpen(true);
    setSelectedFunderIds(new Set());
    setFundersLoading(true);
    const supabase = createClient();
    try {
      const { data } = await supabase
        .from("funders")
        .select("id, name, giving_portal_url")
        .not("giving_portal_url", "is", null)
        .order("name");
      setFunders(
        (
          (data ?? []) as Array<{
            id: string;
            name: string;
            giving_portal_url: string | null;
          }>
        )
          .filter((f) => f.giving_portal_url !== null)
          .map((f) => ({
            id: f.id,
            name: f.name,
            giving_portal_url: f.giving_portal_url as string,
          })),
      );
    } finally {
      setFundersLoading(false);
    }
  }

  async function handleAddToQueue() {
    if (selectedFunderIds.size === 0 || !profile) return;
    setAddingToQueue(true);
    setActionError(null);
    const supabase = createClient();
    try {
      const rows = Array.from(selectedFunderIds).map((funder_id) => ({
        organization_id: profile.organization_id,
        funder_id,
        status: "pending",
        priority: 0,
        automation_mode: "supervised",
      }));
      const { error } = await supabase.from("submission_queue").insert(rows);
      if (error) throw error;
      setAddToQueueOpen(false);
      await loadQueue();
    } catch {
      setActionError("Could not add funders to queue. Please try again.");
    } finally {
      setAddingToQueue(false);
    }
  }

  async function handleAnalyzeForms() {
    const funderIds = Array.from(selectedQueueIds)
      .map((qid) => queue.find((q) => q.id === qid)?.funder_id)
      .filter((id): id is string => id !== null && id !== undefined);
    if (funderIds.length === 0) return;
    setAnalyzing(true);
    setActionError(null);
    try {
      const res = await fetch("/api/agents/form-analyzer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ funderIds }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setActionError(err.error ?? "Could not run form analyzer.");
        return;
      }
      await loadTemplates();
    } catch {
      setActionError("Could not reach the form analyzer. Please try again.");
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleRunSelected() {
    const templateFunderIds = new Set(templates.map((t) => t.funder_id));
    const funderIds = Array.from(selectedQueueIds)
      .map((qid) => queue.find((q) => q.id === qid)?.funder_id)
      .filter(
        (id): id is string =>
          id !== null && id !== undefined && templateFunderIds.has(id),
      );
    if (funderIds.length === 0) return;
    setRunningSelected(true);
    setActionError(null);
    try {
      const res = await fetch("/api/agents/form-filler", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ funderIds }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setActionError(err.error ?? "Could not run form filler.");
        return;
      }
      await loadQueue();
    } catch {
      setActionError("Could not reach the form filler. Please try again.");
    } finally {
      setRunningSelected(false);
    }
  }

  async function handleReanalyze(template: TemplateRow) {
    if (!template.funder_id) return;
    setReanalyzingId(template.id);
    setActionError(null);
    try {
      const res = await fetch("/api/agents/form-analyzer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ funderIds: [template.funder_id] }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setActionError(err.error ?? "Could not re-analyze template.");
        return;
      }
      await loadTemplates();
    } catch {
      setActionError("Could not reach the form analyzer.");
    } finally {
      setReanalyzingId(null);
    }
  }

  function toggleQueueItem(id: string) {
    setSelectedQueueIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllQueue() {
    if (selectedQueueIds.size === queue.length && queue.length > 0) {
      setSelectedQueueIds(new Set());
    } else {
      setSelectedQueueIds(new Set(queue.map((q) => q.id)));
    }
  }

  function toggleFunder(id: string) {
    setSelectedFunderIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const templateFunderIdSet = new Set(templates.map((t) => t.funder_id));
  const selectedHaveTemplates = Array.from(selectedQueueIds).some((qid) => {
    const item = queue.find((q) => q.id === qid);
    return item?.funder_id ? templateFunderIdSet.has(item.funder_id) : false;
  });

  const allQueueSelected = queue.length > 0 && selectedQueueIds.size === queue.length;
  const allFundersSelected = funders.length > 0 && selectedFunderIds.size === funders.length;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-navy-900">
            AutoApply
          </h1>
          <p className="mt-1 text-sm text-navy-500">
            Automated form submission engine. Queue funders, analyze portal forms, and submit applications automatically.
          </p>
        </div>
        <div className="flex items-start gap-3">
          <WorkerStatus />
          <Link href="/autoapply/settings">
            <Button variant="secondary">
              <Settings className="mr-1.5 h-4 w-4" />
              Settings
            </Button>
          </Link>
          <Button onClick={() => void openAddToQueue()}>
            <Plus className="mr-1.5 h-4 w-4" />
            Add to Queue
          </Button>
        </div>
      </div>

      {actionError && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {actionError}
        </div>
      )}

      {/* QUEUE METRICS — depth, processing rate, est. completion (live) */}
      <QueueMetrics />

      {/* QUEUE PREVIEW — tonight's autonomous run candidates */}
      <QueuePreview />

      {/* QUEUE PANEL — real-time stats, per-item remove, clear queue */}
      <QueuePanel />

      {/* QUEUE SECTION */}
      <Card
        title="Queue"
        description="Funders pending automated form submission"
        noPadding
        actions={
          selectedQueueIds.size > 0 ? (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void handleAnalyzeForms()}
                isLoading={analyzing}
                disabled={analyzing}
              >
                <FileSearch className="mr-1 h-3.5 w-3.5" />
                Analyze Forms ({selectedQueueIds.size})
              </Button>
              <Button
                size="sm"
                onClick={() => void handleRunSelected()}
                isLoading={runningSelected}
                disabled={runningSelected || !selectedHaveTemplates}
              >
                <Play className="mr-1 h-3.5 w-3.5" />
                Run Selected
              </Button>
            </div>
          ) : undefined
        }
      >
        <div className="overflow-x-auto">
          {queueError ? (
            <div className="p-5 text-sm text-red-400">{queueError}</div>
          ) : queueLoading ? (
            <div className="p-5 text-sm text-navy-400">Loading queue…</div>
          ) : queue.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={Play}
                title="Queue is empty"
                description='Click "Add to Queue" to select funders for automated submission.'
              />
            </div>
          ) : (
            <table className="min-w-full divide-y divide-navy-100 text-sm">
              <thead>
                <tr className="bg-navy-50">
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={allQueueSelected}
                      onChange={toggleAllQueue}
                      className="rounded border-navy-300 text-teal-600 focus:ring-teal-500"
                      aria-label="Select all queue items"
                    />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-navy-500">
                    Funder
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-navy-500">
                    Portal URL
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-navy-500">
                    Priority
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-navy-500">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-navy-500">
                    Scheduled
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100 bg-white">
                {queue.map((item) => {
                  const { color, label } = queueStatusBadge(item.status);
                  const portalUrl = item.funders?.giving_portal_url ?? null;
                  return (
                    <tr key={item.id} className="hover:bg-navy-50">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedQueueIds.has(item.id)}
                          onChange={() => toggleQueueItem(item.id)}
                          className="rounded border-navy-300 text-teal-600 focus:ring-teal-500"
                          aria-label={`Select ${item.funders?.name ?? "item"}`}
                        />
                      </td>
                      <td className="px-4 py-3 font-medium text-navy-900">
                        {item.funders?.name ?? (
                          <span className="text-navy-400">—</span>
                        )}
                      </td>
                      <td className="max-w-xs px-4 py-3">
                        {portalUrl ? (
                          <a
                            href={portalUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-teal-400 hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <span className="truncate">{truncateUrl(portalUrl)}</span>
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                        ) : (
                          <span className="text-navy-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-navy-600">{item.priority}</td>
                      <td className="px-4 py-3">
                        <Badge color={color}>{label}</Badge>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-navy-400">
                        {item.scheduled_for
                          ? new Date(item.scheduled_for).toLocaleString()
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {/* SUBMISSIONS SECTION */}
      <SubmissionHistory />

      {/* REVIEW QUEUE — failed submissions requiring human review */}
      <ReviewQueue />

      {/* TEMPLATES SECTION */}
      <Card
        title="Form Templates"
        description="Cached portal form structures for rapid submission"
        noPadding
      >
        <div className="overflow-x-auto">
          {templatesError ? (
            <div className="p-5 text-sm text-red-400">{templatesError}</div>
          ) : templatesLoading ? (
            <div className="p-5 text-sm text-navy-400">Loading templates…</div>
          ) : templates.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={FileSearch}
                title="No templates yet"
                description='Run "Analyze Forms" on queued funders to build form templates.'
              />
            </div>
          ) : (
            <table className="min-w-full divide-y divide-navy-100 text-sm">
              <thead>
                <tr className="bg-navy-50">
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-navy-500">
                    Funder
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-navy-500">
                    Portal URL
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-navy-500">
                    Fields
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-navy-500">
                    Last Verified
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-navy-500">
                    Last Used
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100 bg-white">
                {templates.map((tpl) => {
                  const isReanalyzing = reanalyzingId === tpl.id;
                  const fieldCount = countFields(tpl.field_mapping);
                  return (
                    <tr key={tpl.id} className="hover:bg-navy-50">
                      <td className="px-5 py-3 font-medium text-navy-900">
                        {tpl.funders?.name ?? (
                          <span className="text-navy-400">—</span>
                        )}
                      </td>
                      <td className="max-w-xs px-4 py-3">
                        <a
                          href={tpl.portal_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-teal-400 hover:underline"
                        >
                          <span className="truncate">{truncateUrl(tpl.portal_url)}</span>
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                      </td>
                      <td className="px-4 py-3 text-navy-600">{fieldCount}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-navy-400">
                        {tpl.last_verified_at
                          ? new Date(tpl.last_verified_at).toLocaleDateString()
                          : "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-navy-400">
                        {tpl.last_used_at
                          ? new Date(tpl.last_used_at).toLocaleDateString()
                          : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => void handleReanalyze(tpl)}
                          isLoading={isReanalyzing}
                          disabled={isReanalyzing || !tpl.funder_id}
                        >
                          <RefreshCw className="mr-1 h-3 w-3" />
                          Re-analyze
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {/* ANALYTICS SECTION */}
      <SuccessAnalytics />

      {/* ADD TO QUEUE MODAL */}
      <Modal
        isOpen={addToQueueOpen}
        onClose={() => setAddToQueueOpen(false)}
        title="Add Funders to Queue"
        description="Select funders with giving portal URLs to queue for automated submission."
        size="lg"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setAddToQueueOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void handleAddToQueue()}
              isLoading={addingToQueue}
              disabled={addingToQueue || selectedFunderIds.size === 0}
            >
              Add{selectedFunderIds.size > 0 ? ` ${selectedFunderIds.size}` : ""} to Queue
            </Button>
          </>
        }
      >
        {fundersLoading ? (
          <p className="py-4 text-sm text-navy-400">Loading funders…</p>
        ) : funders.length === 0 ? (
          <p className="py-4 text-sm text-navy-500">
            No funders with giving portal URLs found. Add a giving portal URL to a funder profile first.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-navy-400">
              <span>
                {selectedFunderIds.size} of {funders.length} selected
              </span>
              <button
                type="button"
                onClick={() => {
                  if (allFundersSelected) {
                    setSelectedFunderIds(new Set());
                  } else {
                    setSelectedFunderIds(new Set(funders.map((f) => f.id)));
                  }
                }}
                className="text-teal-400 hover:underline"
              >
                {allFundersSelected ? "Deselect all" : "Select all"}
              </button>
            </div>
            <div className="max-h-80 divide-y divide-navy-100 overflow-y-auto rounded-lg border border-navy-200">
              {funders.map((funder) => (
                <label
                  key={funder.id}
                  className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-navy-50"
                >
                  <input
                    type="checkbox"
                    checked={selectedFunderIds.has(funder.id)}
                    onChange={() => toggleFunder(funder.id)}
                    className="rounded border-navy-300 text-teal-600 focus:ring-teal-500"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-navy-900">
                      {funder.name}
                    </p>
                    <p className="truncate text-xs text-navy-400">
                      {funder.giving_portal_url}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
