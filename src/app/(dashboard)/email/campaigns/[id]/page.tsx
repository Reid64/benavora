"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Mail,
  Pause,
  Play,
  Users,
} from "lucide-react";

import { Badge, Button, Card, EmptyState, LoadingSpinner } from "@/components/ui";
import type { BadgeColor } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { canEdit, useProfile } from "@/lib/hooks/useProfile";
import { formatRelative } from "@/lib/utils/formatters";
import type { Tables, TablesUpdate } from "@/types/database";

type SequenceStep = Tables<"email_sequence_steps">;
type Enrollment = Tables<"email_sequence_enrollments">;

interface SequenceDetail {
  sequence: Tables<"email_campaign_sequences">;
  steps: SequenceStep[];
  stats: {
    total_enrolled: number;
    active: number;
    completed: number;
    replied: number;
  };
}

interface FunnelStep {
  step_number: number;
  template_id: string | null;
  delay_days: number;
  delay_hours: number;
  reached: number;
  replied: number;
  conversion_rate: number;
  reply_rate: number;
}

const STATUS_COLOR: Record<string, BadgeColor> = {
  draft: "gray",
  active: "green",
  paused: "yellow",
  completed: "blue",
};

const ENROLL_STATUS_COLOR: Record<string, BadgeColor> = {
  active: "teal",
  completed: "blue",
  paused: "yellow",
  unsubscribed: "red",
};

/**
 * Campaign detail view: funnel visualization, enrollment table with per-contact
 * pause/resume, and aggregate stats. Data loaded from GET /api/email/sequences/[id]
 * and GET /api/email/sequences/[id]/analytics.
 */
export default function EmailCampaignDetailPage() {
  const params = useParams<{ id: string }>();
  const seqId = params.id;
  const { profile } = useProfile();
  const editable = canEdit(profile?.role);

  const [detail, setDetail] = useState<SequenceDetail | null>(null);
  const [funnel, setFunnel] = useState<FunnelStep[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [detailRes, analyticsRes] = await Promise.all([
        fetch(`/api/email/sequences/${seqId}`),
        fetch(`/api/email/sequences/${seqId}/analytics`),
      ]);

      if (!detailRes.ok) throw new Error("Could not load campaign.");
      const detailData = (await detailRes.json()) as SequenceDetail;
      setDetail(detailData);

      if (analyticsRes.ok) {
        const analyticsData = (await analyticsRes.json()) as {
          funnel: FunnelStep[];
        };
        setFunnel(analyticsData.funnel ?? []);
      }

      const supabase = createClient();
      const { data: enrollData } = await supabase
        .from("email_sequence_enrollments")
        .select("*")
        .eq("sequence_id", seqId)
        .order("enrolled_at", { ascending: false });
      setEnrollments(enrollData ?? []);
    } catch {
      setError("Could not load campaign details.");
    } finally {
      setLoading(false);
    }
  }, [seqId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function setSeqStatus(status: string) {
    setBusy(true);
    await fetch(`/api/email/sequences/${seqId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    await load();
    setBusy(false);
  }

  async function setEnrollmentStatus(enrollmentId: string, status: string) {
    const supabase = createClient();
    const update: TablesUpdate<"email_sequence_enrollments"> = { status };
    if (status === "paused") update.paused_at = new Date().toISOString();
    if (status === "active") update.paused_at = null;
    await supabase
      .from("email_sequence_enrollments")
      .update(update)
      .eq("id", enrollmentId);
    await load();
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <LoadingSpinner />
      </div>
    );
  }

  if (error !== null || !detail) {
    return (
      <div className="space-y-4">
        <BackLink />
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error ?? "Campaign not found."}
        </div>
      </div>
    );
  }

  const { sequence, steps, stats } = detail;
  const status = sequence.status ?? "draft";
  const replyRate =
    (stats.total_enrolled ?? 0) > 0
      ? Math.round(((stats.replied ?? 0) / stats.total_enrolled) * 100)
      : 0;

  return (
    <div className="space-y-6">
      <BackLink />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-navy-900">
              {sequence.name}
            </h1>
            <Badge color={STATUS_COLOR[status] ?? "gray"}>
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </Badge>
          </div>
          {sequence.description && (
            <p className="mt-1 text-sm text-navy-500">{sequence.description}</p>
          )}
          <p className="mt-1 text-sm text-navy-500">
            {steps.length} step{steps.length === 1 ? "" : "s"} · created{" "}
            {formatRelative(sequence.created_at)}
          </p>
        </div>
        {editable && (
          <div className="flex flex-wrap items-center gap-2">
            {(status === "draft" || status === "paused") && (
              <Button size="sm" isLoading={busy} onClick={() => void setSeqStatus("active")}>
                <Play className="h-4 w-4" aria-hidden />
                {status === "paused" ? "Resume" : "Activate"}
              </Button>
            )}
            {status === "active" && (
              <Button
                size="sm"
                variant="secondary"
                isLoading={busy}
                onClick={() => void setSeqStatus("paused")}
              >
                <Pause className="h-4 w-4" aria-hidden />
                Pause
              </Button>
            )}
            {(status === "active" || status === "paused") && (
              <Button
                size="sm"
                variant="ghost"
                isLoading={busy}
                onClick={() => void setSeqStatus("completed")}
              >
                <CheckCircle2 className="h-4 w-4" aria-hidden />
                Mark complete
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Enrolled" value={String(stats.total_enrolled ?? 0)} />
        <StatCard label="Active" value={String(stats.active ?? 0)} />
        <StatCard label="Completed" value={String(stats.completed ?? 0)} />
        <StatCard label="Reply rate" value={`${replyRate}%`} />
      </div>

      {/* Funnel visualization */}
      {funnel.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-navy-900">
            <Mail className="h-5 w-5 text-navy-400" aria-hidden />
            Step Funnel
          </h2>
          <div className="flex flex-wrap items-stretch gap-2">
            {funnel.map((f, idx) => (
              <div key={f.step_number} className="flex items-center gap-2">
                <div className="min-w-0 rounded-lg border border-navy-200 bg-white px-4 py-3 text-center shadow-sm">
                  <p className="text-xs font-medium uppercase tracking-wide text-navy-400">
                    Step {f.step_number}
                  </p>
                  {f.delay_days > 0 || f.delay_hours > 0 ? (
                    <p className="mt-0.5 text-xs text-navy-400">
                      +{f.delay_days}d{f.delay_hours > 0 ? ` ${f.delay_hours}h` : ""}
                    </p>
                  ) : (
                    <p className="mt-0.5 text-xs text-navy-400">Immediate</p>
                  )}
                  <p className="mt-2 text-xl font-semibold tabular-nums text-navy-900">
                    {f.reached}
                  </p>
                  <p className="text-xs text-navy-500">reached</p>
                  <p className="mt-1 text-sm font-medium text-teal-700">
                    {f.replied} replied
                  </p>
                  <p className="text-xs text-navy-400">
                    {Math.round(f.reply_rate * 100)}% rate
                  </p>
                </div>
                {idx < funnel.length - 1 && (
                  <ArrowRight
                    className="h-5 w-5 shrink-0 text-navy-300"
                    aria-hidden
                  />
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Step details */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-navy-900">Steps</h2>
        {steps.length === 0 ? (
          <Card>
            <p className="text-sm text-navy-500">No steps configured.</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {steps.map((step) => (
              <Card key={step.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-navy-700">
                      Step {step.step_number}
                    </p>
                    {step.subject_override && (
                      <p className="mt-1 text-sm text-navy-800">
                        {step.subject_override}
                      </p>
                    )}
                    {step.body_override && (
                      <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm text-navy-600">
                        {step.body_override}
                      </p>
                    )}
                    {step.template_id && !step.subject_override && (
                      <p className="mt-1 text-xs text-navy-500">
                        Template: {step.template_id}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="text-xs text-navy-400">
                      {step.step_number === 1
                        ? "Sends immediately"
                        : `+${step.delay_days}d${step.delay_hours > 0 ? ` ${step.delay_hours}h` : ""}`}
                    </span>
                    {step.condition_type && step.condition_type !== "always" && (
                      <p className="mt-0.5 text-xs text-navy-400">
                        Condition: {step.condition_type.replace(/_/g, " ")}
                      </p>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Enrollment table */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-navy-900">
          <Users className="h-5 w-5 text-navy-400" aria-hidden />
          Enrollments ({enrollments.length})
        </h2>
        {enrollments.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No enrollments yet"
            description="Contacts will appear here once enrolled in this campaign."
          />
        ) : (
          <Card className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-navy-100 bg-navy-50">
                    <th className="px-4 py-3 text-left font-medium text-navy-600">
                      Email
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-navy-600">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-navy-600">
                      Step
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-navy-600">
                      Last sent
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-navy-600">
                      Reply
                    </th>
                    {editable && (
                      <th className="px-4 py-3 text-left font-medium text-navy-600">
                        Actions
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-navy-100">
                  {enrollments.map((e) => (
                    <tr key={e.id} className="hover:bg-navy-50/50">
                      <td className="px-4 py-3 font-medium text-navy-800">
                        {e.email_address}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          color={ENROLL_STATUS_COLOR[e.status] ?? "gray"}
                          withDot
                        >
                          {e.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 tabular-nums text-navy-700">
                        {e.current_step}
                      </td>
                      <td className="px-4 py-3 text-navy-500">
                        {e.last_sent_at
                          ? formatRelative(e.last_sent_at)
                          : "—"}
                      </td>
                      <td className="px-4 py-3">
                        {e.reply_detected ? (
                          <Badge color="green">Replied</Badge>
                        ) : (
                          <span className="text-navy-400">—</span>
                        )}
                      </td>
                      {editable && (
                        <td className="px-4 py-3">
                          <div className="flex gap-1.5">
                            {e.status === "active" && (
                              <button
                                type="button"
                                onClick={() =>
                                  void setEnrollmentStatus(e.id, "paused")
                                }
                                className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-yellow-700 ring-1 ring-yellow-300 transition hover:bg-yellow-50"
                              >
                                <Pause className="h-3 w-3" aria-hidden />
                                Pause
                              </button>
                            )}
                            {e.status === "paused" && (
                              <button
                                type="button"
                                onClick={() =>
                                  void setEnrollmentStatus(e.id, "active")
                                }
                                className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-teal-700 ring-1 ring-teal-300 transition hover:bg-teal-50"
                              >
                                <Play className="h-3 w-3" aria-hidden />
                                Resume
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </section>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/email/campaigns"
      className="inline-flex items-center gap-1.5 text-sm text-navy-500 transition hover:text-navy-700"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden />
      Back to campaigns
    </Link>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wide text-navy-400">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-navy-900">
        {value}
      </p>
    </Card>
  );
}
