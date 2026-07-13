"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Eye, ListOrdered, Trash2, X } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import type { BadgeColor } from "@/components/ui/Badge";
import { Button, Card, EmptyState, Modal } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/hooks/useProfile";
import { SubmissionPreview } from "./SubmissionPreview";

interface QueueItem {
  id: string;
  funder_id: string | null;
  status: string;
  priority: number;
  scheduled_for: string | null;
  completed_at: string | null;
  created_at: string;
  funders: { name: string } | null;
}

interface Toast {
  id: string;
  type: "completed" | "failed";
  funderName: string;
}

function statusBadge(status: string): { color: BadgeColor; label: string; pulse: boolean } {
  switch (status) {
    case "pending":
      return { color: "gray", label: "Pending", pulse: false };
    case "processing":
      return { color: "blue", label: "Processing", pulse: true };
    case "completed":
      return { color: "green", label: "Completed", pulse: false };
    case "failed":
      return { color: "red", label: "Failed", pulse: false };
    case "skipped":
      return { color: "yellow", label: "Skipped", pulse: false };
    default:
      return { color: "gray", label: status, pulse: false };
  }
}

function isToday(isoString: string | null): boolean {
  if (!isoString) return false;
  const d = new Date(isoString);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export function QueuePanel() {
  const { profile } = useProfile();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [previewItemId, setPreviewItemId] = useState<string | null>(null);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Refs for stable access inside realtime callback
  const itemsRef = useRef<QueueItem[]>([]);
  const prevStatusRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  function pushToast(type: "completed" | "failed", funderName: string) {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, type, funderName }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }

  function dismissToast(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  const loadItems = useCallback(async () => {
    const supabase = createClient();
    const { data, error: err } = await supabase
      .from("submission_queue")
      .select("id, funder_id, status, priority, scheduled_for, completed_at, created_at, funders(name)")
      .order("priority", { ascending: false })
      .order("created_at", { ascending: true });
    if (err) {
      setError("Could not load the queue.");
    } else {
      const rows = (data ?? []) as unknown as QueueItem[];
      setItems(rows);
      // Seed prevStatusRef on initial load (no toast for initial states)
      for (const row of rows) {
        if (!prevStatusRef.current.has(row.id)) {
          prevStatusRef.current.set(row.id, row.status);
        }
      }
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadItems();

    const supabase = createClient();

    const channel = supabase
      .channel("queue-panel-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "submission_queue" },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const oldId = (payload.old as { id?: string }).id;
            if (oldId) {
              prevStatusRef.current.delete(oldId);
              setItems((prev) => prev.filter((i) => i.id !== oldId));
            }
            return;
          }

          const updated = payload.new as QueueItem;
          const newStatus = updated.status;
          const prevStatus = prevStatusRef.current.get(updated.id);

          // Fire toast when an item transitions to completed or failed
          if (
            prevStatus !== undefined &&
            prevStatus !== newStatus &&
            (newStatus === "completed" || newStatus === "failed")
          ) {
            const existing = itemsRef.current.find((i) => i.id === updated.id);
            const funderName = existing?.funders?.name ?? "Unknown funder";
            pushToast(newStatus, funderName);
          }

          prevStatusRef.current.set(updated.id, newStatus);

          setItems((prev) => {
            const idx = prev.findIndex((i) => i.id === updated.id);
            if (idx === -1) {
              // INSERT: new item without joined funder data
              return [...prev, { ...updated, funders: null }];
            }
            // UPDATE: preserve the joined funder name from memory
            const next = [...prev];
            next[idx] = { ...updated, funders: prev[idx]?.funders ?? null };
            return next;
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadItems]);

  async function handleRemove(id: string) {
    setRemovingId(id);
    const supabase = createClient();
    const { error: err } = await supabase
      .from("submission_queue")
      .delete()
      .eq("id", id)
      .eq("status", "pending");
    if (!err) {
      prevStatusRef.current.delete(id);
      setItems((prev) => prev.filter((i) => i.id !== id));
    }
    setRemovingId(null);
  }

  async function handleClearQueue() {
    if (!profile) return;
    setClearing(true);
    const supabase = createClient();
    const { error: err } = await supabase
      .from("submission_queue")
      .delete()
      .eq("organization_id", profile.organization_id)
      .eq("status", "pending");
    if (!err) {
      const removed = items.filter((i) => i.status === "pending");
      for (const item of removed) {
        prevStatusRef.current.delete(item.id);
      }
      setItems((prev) => prev.filter((i) => i.status !== "pending"));
    }
    setClearing(false);
    setClearConfirmOpen(false);
  }

  const totalPending = items.filter((i) => i.status === "pending").length;
  const totalProcessing = items.filter((i) => i.status === "processing").length;
  const completedToday = items.filter((i) => i.status === "completed" && isToday(i.completed_at)).length;
  const failedToday = items.filter((i) => i.status === "failed" && isToday(i.completed_at)).length;

  return (
    <>
      {/* Toast container */}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              role="status"
              className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg ${
                toast.type === "completed"
                  ? "border-green-700 bg-green-900/90 text-green-200"
                  : "border-red-700 bg-red-900/90 text-red-200"
              }`}
            >
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  toast.type === "completed" ? "bg-green-400" : "bg-red-400"
                }`}
              />
              <span className="flex-1">
                <span className="font-medium">{toast.funderName}</span>
                {" "}
                {toast.type === "completed" ? "submission completed." : "submission failed."}
              </span>
              <button
                type="button"
                onClick={() => dismissToast(toast.id)}
                aria-label="Dismiss notification"
                className="ml-1 opacity-60 hover:opacity-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <Card
        title="Queue Panel"
        description="Live submission queue with real-time status updates"
        noPadding
        actions={
          totalPending > 0 ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setClearConfirmOpen(true)}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Clear Queue
            </Button>
          ) : undefined
        }
      >
        {/* Stats bar */}
        <div className="grid grid-cols-2 divide-x divide-y divide-navy-100 border-b border-navy-100 sm:grid-cols-4 sm:divide-y-0">
          <div className="px-5 py-4">
            <p className="text-xs font-medium uppercase tracking-wide text-navy-400">Pending</p>
            <p className="mt-1 text-2xl font-semibold text-navy-900">{totalPending}</p>
          </div>
          <div className="px-5 py-4">
            <p className="text-xs font-medium uppercase tracking-wide text-navy-400">Processing</p>
            <p className="mt-1 text-2xl font-semibold text-blue-400">{totalProcessing}</p>
          </div>
          <div className="px-5 py-4">
            <p className="text-xs font-medium uppercase tracking-wide text-navy-400">Completed Today</p>
            <p className="mt-1 text-2xl font-semibold text-green-400">{completedToday}</p>
          </div>
          <div className="px-5 py-4">
            <p className="text-xs font-medium uppercase tracking-wide text-navy-400">Failed Today</p>
            <p className="mt-1 text-2xl font-semibold text-red-400">{failedToday}</p>
          </div>
        </div>

        <div className="overflow-x-auto">
          {error ? (
            <div className="p-5 text-sm text-red-400">{error}</div>
          ) : loading ? (
            <div className="p-5 text-sm text-navy-400">Loading queue…</div>
          ) : items.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={ListOrdered}
                title="Queue is empty"
                description="Add funders to the queue to begin automated submission."
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
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-navy-500">
                    Priority
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-navy-500">
                    Scheduled
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-navy-500">
                    Added
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100 bg-white">
                {items.map((item) => {
                  const { color, label, pulse } = statusBadge(item.status);
                  const isPending = item.status === "pending";
                  const isRemoving = removingId === item.id;
                  return (
                    <tr key={item.id} className="hover:bg-navy-50">
                      <td className="px-5 py-3 font-medium text-navy-900">
                        {item.funders?.name ?? (
                          <span className="text-navy-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          color={color}
                          withDot
                          className={pulse ? "animate-pulse" : undefined}
                        >
                          {label}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-navy-600">{item.priority}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-navy-400">
                        {item.scheduled_for
                          ? new Date(item.scheduled_for).toLocaleString()
                          : "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-navy-400">
                        {new Date(item.created_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setPreviewItemId(item.id)}
                          >
                            <Eye className="mr-1 h-3 w-3" />
                            Preview
                          </Button>
                          {isPending && (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => void handleRemove(item.id)}
                              isLoading={isRemoving}
                              disabled={isRemoving}
                            >
                              <Trash2 className="mr-1 h-3 w-3" />
                              Remove
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {/* Clear Queue Confirmation Modal */}
      <Modal
        isOpen={clearConfirmOpen}
        onClose={() => setClearConfirmOpen(false)}
        title="Clear Queue"
        description={`Remove all ${totalPending} pending item${totalPending !== 1 ? "s" : ""} from the queue? Items currently processing will not be affected.`}
        size="sm"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setClearConfirmOpen(false)}
              disabled={clearing}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void handleClearQueue()}
              isLoading={clearing}
              disabled={clearing}
            >
              Clear {totalPending} Pending
            </Button>
          </>
        }
      />

      {/* Submission Preview Modal */}
      {previewItemId && (
        <SubmissionPreview
          queueItemId={previewItemId}
          onConfirm={() => setPreviewItemId(null)}
          onCancel={() => setPreviewItemId(null)}
        />
      )}
    </>
  );
}
