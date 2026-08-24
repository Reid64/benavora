"use client";

// PIL human review queue — GET /api/pil/review-queue lists pil_human_review_
// queue rows (src/lib/pil/human-review.ts). The task described each item as
// carrying a "prospect name" and "critic report", but HumanReviewItem is
// generic over subject_type/subject_id (identity linkage, capacity
// determination, policy exceptions, etc. — not only prospects, per
// HumanReviewType in src/lib/pil/types.ts) and has no dedicated critic-report
// field; evidence_refs is the one real evidence payload on the row. Subject
// names resolve to a prospect's display_name only when subject_type is
// pil_prospects; everything else shows its subject_type + id honestly.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, X } from "lucide-react";

import { Button, Modal, Select } from "@/components/ui";
import { formatRelative, humanizeEnum } from "@/lib/utils/formatters";
import type { HumanReviewItem, HumanReviewStatus, Prospect } from "@/lib/pil/types";

const NAVY = "#101B2D";
const GOLD = "#B88A2E";
const PLUM = "#5B21B6";
const CANVAS = "#D8D3C8";
const CARD_BG = "#F8F5EE";
const TEXT_SECONDARY = "#64748B";
const BORDER = "#D9D3C5";

const PRIORITY_COLOR: Record<string, string> = {
  urgent: "#EF4444",
  high: "#F59E0B",
  normal: "#0EA5E9",
  low: "#94A3B8",
};

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "in_review", label: "In Review" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "changes_requested", label: "Changes Requested" },
  { value: "expired", label: "Expired" },
  { value: "", label: "All statuses" },
];

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold"
      style={{ backgroundColor: `${color}1A`, color, borderColor: `${color}40` }}
    >
      {label}
    </span>
  );
}

function ReviewModal({
  item,
  subjectLabel,
  onClose,
}: {
  item: HumanReviewItem;
  subjectLabel: string;
  onClose: (decided: boolean) => void;
}) {
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(approved: boolean) {
    setSubmitting(approved ? "approve" : "reject");
    setError(null);
    try {
      const res = await fetch(`/api/pil/review-queue/${item.id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved, notes }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        setError(payload.error ?? "Could not submit this decision.");
        setSubmitting(null);
        return;
      }
      onClose(true);
    } catch {
      setError("Could not reach the server.");
      setSubmitting(null);
    }
  }

  const decidable = item.status === "pending" || item.status === "in_review";

  return (
    <Modal
      isOpen
      onClose={() => onClose(false)}
      title={subjectLabel}
      description={humanizeEnum(item.review_type)}
      size="lg"
      footer={
        decidable ? (
          <>
            <Button
              variant="danger"
              onClick={() => void decide(false)}
              isLoading={submitting === "reject"}
              disabled={submitting !== null}
            >
              <X className="h-4 w-4" aria-hidden />
              Reject
            </Button>
            <Button
              onClick={() => void decide(true)}
              isLoading={submitting === "approve"}
              disabled={submitting !== null}
              style={{ backgroundColor: "#10B981" }}
            >
              <Check className="h-4 w-4" aria-hidden />
              Approve
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Pill label={humanizeEnum(item.priority)} color={PRIORITY_COLOR[item.priority] ?? "#64748B"} />
          <Pill label={humanizeEnum(item.status)} color={PLUM} />
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: TEXT_SECONDARY }}>
            Summary
          </p>
          <p className="mt-1 text-sm" style={{ color: NAVY }}>
            {item.summary}
          </p>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: TEXT_SECONDARY }}>
            Evidence
          </p>
          {item.evidence_refs.length === 0 ? (
            <p className="mt-1 text-sm" style={{ color: TEXT_SECONDARY }}>
              No evidence attached to this review item.
            </p>
          ) : (
            <ul className="mt-1 space-y-1.5">
              {item.evidence_refs.map((ref, i) => (
                <li key={i} className="rounded-lg border p-2 font-mono text-xs" style={{ borderColor: BORDER, color: TEXT_SECONDARY }}>
                  {typeof ref === "string" ? ref : JSON.stringify(ref)}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="text-xs" style={{ color: TEXT_SECONDARY }}>
          Requested by {item.requested_by_agent_id ?? "a human"} · {formatRelative(item.created_at)}
        </div>

        {decidable && (
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="review-notes">
              Decision notes (optional)
            </label>
            <textarea
              id="review-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="block w-full rounded-lg border border-slate-200 bg-surface px-3 py-2.5 text-sm text-slate-700 outline-none transition-colors focus:border-[#5B21B6] focus:ring-2 focus:ring-[#5B21B6]/10"
            />
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </Modal>
  );
}

export default function PilReviewQueuePage() {
  const [items, setItems] = useState<HumanReviewItem[]>([]);
  const [prospectNames, setProspectNames] = useState<Map<string, string>>(new Map());
  const [status, setStatus] = useState<HumanReviewStatus | "">("pending");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<HumanReviewItem | null>(null);

  async function load() {
    setLoading(true);
    try {
      const qs = status ? `?status=${status}` : "";
      const [itemsRes, prospectsRes] = await Promise.all([
        fetch(`/api/pil/review-queue${qs}`, { cache: "no-store" }),
        fetch("/api/pil/prospects", { cache: "no-store" }),
      ]);
      if (itemsRes.ok) {
        const payload = (await itemsRes.json()) as { items: HumanReviewItem[] };
        setItems(payload.items ?? []);
        setError(null);
      } else {
        setError("Could not load the review queue.");
      }
      if (prospectsRes.ok) {
        const payload = (await prospectsRes.json()) as { prospects: Prospect[] };
        setProspectNames(new Map(payload.prospects.map((p) => [p.id, p.display_name])));
      }
    } catch {
      setError("Could not reach the server.");
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const sorted = useMemo(
    () => [...items].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [items],
  );

  function subjectLabel(item: HumanReviewItem): string {
    if (item.subject_type === "pil_prospects") {
      return prospectNames.get(item.subject_id) ?? `Prospect ${item.subject_id}`;
    }
    return `${humanizeEnum(item.subject_type)} ${item.subject_id.slice(0, 8)}`;
  }

  return (
    <div className="min-h-screen p-6" style={{ backgroundColor: CANVAS }}>
      <Link href="/intelligence/pil" className="inline-flex items-center gap-1.5 text-sm" style={{ color: PLUM }}>
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to PIL Hub
      </Link>

      <div className="mb-6 mt-4 flex flex-wrap items-center justify-between gap-3">
        <div style={{ borderLeft: `4px solid ${PLUM}`, paddingLeft: "1rem" }}>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: NAVY }}>
            Human Review Queue
          </h1>
          <p className="mt-1 text-sm" style={{ color: TEXT_SECONDARY }}>
            pil_human_review_queue items awaiting a human decision.
          </p>
        </div>
        <div className="w-48">
          <Select
            aria-label="Filter by status"
            options={STATUS_OPTIONS}
            value={status}
            onChange={(e) => setStatus(e.target.value as HumanReviewStatus | "")}
          />
        </div>
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {!loading && sorted.length === 0 ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm" style={{ borderColor: BORDER, color: TEXT_SECONDARY }}>
          Nothing in this queue right now.
        </p>
      ) : (
        <div className="space-y-2">
          {sorted.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelected(item)}
              className="grid w-full grid-cols-1 gap-2 rounded-xl px-5 py-4 text-left transition hover:shadow-md sm:grid-cols-5 sm:items-center sm:gap-4"
              style={{ backgroundColor: CARD_BG }}
            >
              <div className="sm:col-span-2">
                <p className="text-sm font-semibold" style={{ color: NAVY }}>
                  {subjectLabel(item)}
                </p>
                <p className="mt-0.5 truncate text-xs" style={{ color: TEXT_SECONDARY }}>
                  {item.summary}
                </p>
              </div>
              <div>
                <Pill label={humanizeEnum(item.review_type)} color={GOLD} />
              </div>
              <div>
                <Pill label={humanizeEnum(item.priority)} color={PRIORITY_COLOR[item.priority] ?? "#64748B"} />
              </div>
              <div className="text-xs" style={{ color: TEXT_SECONDARY }}>
                {formatRelative(item.created_at)}
                <br />
                {item.assigned_to_user_id ? "Assigned" : "Unassigned"}
              </div>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <ReviewModal
          item={selected}
          subjectLabel={subjectLabel(selected)}
          onClose={(decided) => {
            setSelected(null);
            if (decided) void load();
          }}
        />
      )}
    </div>
  );
}
