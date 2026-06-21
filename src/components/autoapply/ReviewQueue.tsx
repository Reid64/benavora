"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, ExternalLink, X } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import type { BadgeColor } from "@/components/ui/Badge";
import { Button, Card } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import type { Json } from "@/types/database";

interface ReviewItem {
  id: string;
  submission_id: string | null;
  organization_id: string;
  funder_id: string;
  reason: string;
  failure_count: number;
  status: string;
  resolved_at: string | null;
  resolution_notes: string | null;
  created_at: string;
  funders: { name: string } | null;
}

interface Screenshot {
  id: string;
  stage: string;
  storage_path: string;
  captured_at: string;
}

interface SubmissionDetail {
  id: string;
  status: string;
  error_message: string | null;
  request_description: string | null;
  request_type: string | null;
  form_template_id: string | null;
}

interface FormTemplate {
  id: string;
  portal_url: string;
  field_mapping: Json | null;
  last_verified_at: string | null;
}

interface ExpandedData {
  screenshots: Screenshot[];
  submission: SubmissionDetail | null;
  template: FormTemplate | null;
}

const DISMISS_REASONS = [
  { value: "not_worth_retrying", label: "Not worth retrying" },
  { value: "wrong_portal", label: "Wrong portal" },
  { value: "duplicate", label: "Duplicate submission" },
  { value: "other", label: "Other" },
] as const;

function statusBadgeProps(status: string): { color: BadgeColor; label: string } {
  switch (status) {
    case "pending":   return { color: "yellow", label: "Pending" };
    case "in_review": return { color: "blue",   label: "In Review" };
    case "resolved":  return { color: "green",  label: "Resolved" };
    case "dismissed": return { color: "gray",   label: "Dismissed" };
    default:          return { color: "gray",   label: status };
  }
}

export function ReviewQueue() {
  const supabase = useMemo(() => createClient(), []);

  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedData, setExpandedData] = useState<Record<string, ExpandedData>>({});
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [dismissReason, setDismissReason] = useState<string>("not_worth_retrying");
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolveNotes, setResolveNotes] = useState("");

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("autoapply_review_queue")
      .select("*, funders(name)")
      .order("created_at", { ascending: false });
    if (err) {
      setError(err.message);
    } else {
      setItems((data ?? []) as unknown as ReviewItem[]);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void loadItems();
    const channel = supabase
      .channel("review_queue_live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "autoapply_review_queue" },
        () => void loadItems(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadItems, supabase]);

  const handleExpand = useCallback(
    async (item: ReviewItem) => {
      if (expandedId === item.id) {
        setExpandedId(null);
        return;
      }
      setExpandedId(item.id);
      if (expandedData[item.id] !== undefined) return;

      const screenshots: Screenshot[] = item.submission_id
        ? (((
            await supabase
              .from("autoapply_screenshots")
              .select("id, stage, storage_path, captured_at")
              .eq("submission_id", item.submission_id)
              .order("captured_at")
          ).data) ?? []) as Screenshot[]
        : [];

      const submission: SubmissionDetail | null = item.submission_id
        ? ((
            await supabase
              .from("autoapply_submissions")
              .select(
                "id, status, error_message, request_description, request_type, form_template_id",
              )
              .eq("id", item.submission_id)
              .maybeSingle()
          ).data as SubmissionDetail | null)
        : null;

      const template: FormTemplate | null = submission?.form_template_id
        ? ((
            await supabase
              .from("form_templates")
              .select("id, portal_url, field_mapping, last_verified_at")
              .eq("id", submission.form_template_id)
              .maybeSingle()
          ).data as FormTemplate | null)
        : null;

      setExpandedData((prev) => ({
        ...prev,
        [item.id]: { screenshots, submission, template },
      }));
    },
    [expandedId, expandedData, supabase],
  );

  const handleRetry = useCallback(
    async (item: ReviewItem) => {
      setActionLoading(item.id + ":retry");
      const { error: err } = await supabase.from("submission_queue").insert({
        organization_id: item.organization_id,
        funder_id: item.funder_id,
        status: "pending",
        priority: 0,
        automation_mode: "supervised",
      });
      if (err) alert(`Retry failed: ${err.message}`);
      setActionLoading(null);
    },
    [supabase],
  );

  const handleEditTemplate = useCallback(async (item: ReviewItem) => {
    setActionLoading(item.id + ":edit");
    await fetch("/api/agents/form-analyzer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ funderIds: [item.funder_id] }),
    });
    setActionLoading(null);
  }, []);

  const handleDismissOpen = useCallback((item: ReviewItem) => {
    setDismissingId(item.id);
    setDismissReason("not_worth_retrying");
    setResolvingId(null);
  }, []);

  const handleDismissConfirm = useCallback(
    async (item: ReviewItem) => {
      setActionLoading(item.id + ":dismiss");
      const { error: err } = await supabase
        .from("autoapply_review_queue")
        .update({ status: "dismissed", resolution_notes: dismissReason })
        .eq("id", item.id);
      if (err) {
        alert(`Dismiss failed: ${err.message}`);
      } else {
        setDismissingId(null);
      }
      setActionLoading(null);
    },
    [dismissReason, supabase],
  );

  const handleResolveOpen = useCallback((item: ReviewItem) => {
    setResolvingId(item.id);
    setResolveNotes("");
    setDismissingId(null);
  }, []);

  const handleResolveConfirm = useCallback(
    async (item: ReviewItem) => {
      setActionLoading(item.id + ":resolve");
      const { error: err } = await supabase
        .from("autoapply_review_queue")
        .update({
          status: "resolved",
          resolved_at: new Date().toISOString(),
          resolution_notes: resolveNotes,
        })
        .eq("id", item.id);
      if (err) {
        alert(`Resolve failed: ${err.message}`);
      } else {
        setResolvingId(null);
        setResolveNotes("");
      }
      setActionLoading(null);
    },
    [resolveNotes, supabase],
  );

  return (
    <>
      <Card
        title="Review Queue"
        description="Failed submissions requiring human review"
        noPadding
      >
        <div className="overflow-x-auto">
          {error ? (
            <div className="p-5 text-sm text-red-400">{error}</div>
          ) : loading ? (
            <div className="p-5 text-sm text-navy-400">Loading…</div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <AlertTriangle className="h-8 w-8 text-navy-300" />
              <p className="text-sm text-navy-500">No items in review queue.</p>
            </div>
          ) : (
            <table className="min-w-full divide-y divide-navy-100 text-sm">
              <thead>
                <tr className="bg-navy-50">
                  <th className="w-8 px-4 py-3" />
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-navy-500">
                    Funder
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-navy-500">
                    Failure Reason
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-navy-500">
                    Failures
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-navy-500">
                    Status
                  </th>
                  <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-navy-500">
                    Created
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100 bg-white">
                {items.map((item) => {
                  const { color, label } = statusBadgeProps(item.status);
                  const isExpanded = expandedId === item.id;
                  const data = expandedData[item.id];

                  return (
                    <Fragment key={item.id}>
                      <tr
                        className="cursor-pointer hover:bg-navy-50"
                        onClick={() => void handleExpand(item)}
                      >
                        <td className="px-4 py-3 text-navy-400">
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </td>
                        <td className="px-5 py-3 font-medium text-navy-900">
                          {item.funders?.name ?? (
                            <span className="text-navy-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-navy-600">
                          <code className="rounded bg-navy-50 px-1.5 py-0.5 text-xs">
                            {item.reason}
                          </code>
                        </td>
                        <td className="px-4 py-3 text-navy-600">{item.failure_count}</td>
                        <td className="px-4 py-3">
                          <Badge color={color}>{label}</Badge>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-navy-400">
                          {new Date(item.created_at).toLocaleString()}
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr>
                          <td colSpan={6} className="bg-navy-50 px-6 py-5">
                            {data === undefined ? (
                              <p className="text-sm text-navy-400">Loading…</p>
                            ) : (
                              <div className="space-y-5">
                                {data.screenshots.length > 0 && (
                                  <div>
                                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-navy-500">
                                      Screenshots
                                    </p>
                                    <div className="flex flex-wrap gap-3">
                                      {data.screenshots.map((ss) => {
                                        const url = ss.storage_path.startsWith("http")
                                          ? ss.storage_path
                                          : supabase.storage
                                              .from("autoapply")
                                              .getPublicUrl(ss.storage_path).data.publicUrl;
                                        return (
                                          <button
                                            key={ss.id}
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setLightboxUrl(url);
                                            }}
                                            className="group relative overflow-hidden rounded-lg border border-navy-200 focus:outline-none focus:ring-2 focus:ring-teal-500"
                                          >
                                            <img
                                              src={url}
                                              alt=""
                                              className="h-24 w-36 object-cover"
                                            />
                                            <span className="absolute inset-x-0 bottom-0 bg-navy-900/70 px-1.5 py-1 text-center text-[10px] text-white">
                                              {ss.stage}
                                            </span>
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}

                                {data.submission !== null && (
                                  <div>
                                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-navy-500">
                                      Failure Details
                                    </p>
                                    <div className="rounded-lg border border-navy-200 bg-white p-4 text-sm">
                                      {data.submission?.error_message && (
                                        <p className="mb-2 text-red-400">
                                          {data.submission.error_message}
                                        </p>
                                      )}
                                      {data.submission?.request_description && (
                                        <p className="text-navy-600">
                                          {data.submission.request_description}
                                        </p>
                                      )}
                                      {data.submission?.request_type && (
                                        <p className="mt-1 text-xs text-navy-400">
                                          Type: {data.submission.request_type}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                )}

                                {data.template !== null && (
                                  <div>
                                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-navy-500">
                                      Form Template
                                    </p>
                                    <div className="rounded-lg border border-navy-200 bg-white p-4 text-sm">
                                      <a
                                        href={data.template?.portal_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-1 text-teal-400 hover:underline"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        {data.template?.portal_url}
                                        <ExternalLink className="h-3 w-3 shrink-0" />
                                      </a>
                                      {data.template?.last_verified_at && (
                                        <p className="mt-1 text-xs text-navy-400">
                                          Last verified:{" "}
                                          {new Date(
                                            data.template.last_verified_at,
                                          ).toLocaleDateString()}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                )}

                                <div className="flex flex-wrap gap-2">
                                  <Button
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void handleRetry(item);
                                    }}
                                    isLoading={actionLoading === item.id + ":retry"}
                                    disabled={actionLoading !== null}
                                  >
                                    Retry
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void handleEditTemplate(item);
                                    }}
                                    isLoading={actionLoading === item.id + ":edit"}
                                    disabled={actionLoading !== null}
                                  >
                                    Edit Template
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDismissOpen(item);
                                    }}
                                    disabled={actionLoading !== null}
                                  >
                                    Dismiss
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleResolveOpen(item);
                                    }}
                                    disabled={actionLoading !== null}
                                  >
                                    Resolve with Notes
                                  </Button>
                                </div>

                                {dismissingId === item.id && (
                                  <div
                                    className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-400/30 bg-amber-400/10 p-4"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <span className="text-sm font-medium text-amber-200">
                                      Dismiss reason:
                                    </span>
                                    <select
                                      className="rounded border border-navy-200 bg-white px-3 py-1.5 text-sm text-navy-800 focus:outline-none focus:ring-2 focus:ring-teal-500"
                                      value={dismissReason}
                                      onChange={(e) => setDismissReason(e.target.value)}
                                    >
                                      {DISMISS_REASONS.map((r) => (
                                        <option key={r.value} value={r.value}>
                                          {r.label}
                                        </option>
                                      ))}
                                    </select>
                                    <Button
                                      size="sm"
                                      onClick={() => void handleDismissConfirm(item)}
                                      isLoading={actionLoading === item.id + ":dismiss"}
                                    >
                                      Confirm
                                    </Button>
                                    <button
                                      type="button"
                                      onClick={() => setDismissingId(null)}
                                      className="text-navy-400 hover:text-navy-600"
                                    >
                                      <X className="h-4 w-4" />
                                    </button>
                                  </div>
                                )}

                                {resolvingId === item.id && (
                                  <div
                                    className="flex flex-wrap items-start gap-3 rounded-lg border border-teal-400/30 bg-teal-400/10 p-4"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <span className="mt-1.5 text-sm font-medium text-teal-200">
                                      Resolution notes:
                                    </span>
                                    <textarea
                                      className="min-w-0 flex-1 rounded border border-navy-200 bg-white px-3 py-2 text-sm text-navy-800 placeholder:text-navy-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
                                      rows={3}
                                      placeholder="Describe how this was resolved…"
                                      value={resolveNotes}
                                      onChange={(e) => setResolveNotes(e.target.value)}
                                    />
                                    <div className="flex flex-col gap-2">
                                      <Button
                                        size="sm"
                                        onClick={() => void handleResolveConfirm(item)}
                                        isLoading={actionLoading === item.id + ":resolve"}
                                        disabled={!resolveNotes.trim()}
                                      >
                                        Confirm
                                      </Button>
                                      <button
                                        type="button"
                                        onClick={() => setResolvingId(null)}
                                        className="text-navy-400 hover:text-navy-600"
                                      >
                                        <X className="h-4 w-4" />
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {lightboxUrl !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            type="button"
            className="absolute right-4 top-4 text-white hover:text-navy-300"
            onClick={() => setLightboxUrl(null)}
          >
            <X className="h-6 w-6" />
          </button>
          <img
            src={lightboxUrl}
            alt=""
            className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
