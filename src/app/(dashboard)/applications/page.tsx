"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Building2,
  CalendarClock,
  Clock,
  Copy,
  RefreshCw,
  Sparkles,
} from "lucide-react";

import { Button, EmptyState, LoadingSpinner, Modal, Select } from "@/components/ui";
import {
  daysInStage,
  loadPipelineApplications,
  STAGE_LABEL,
  type EnrichedApplication,
  type PipelineStage,
} from "@/components/applications/pipeline";
import { createClient } from "@/lib/supabase/client";
import { canEdit, useProfile } from "@/lib/hooks/useProfile";
import { formatCurrency, formatDate } from "@/lib/utils/formatters";

type Family = "discovery" | "drafting" | "submitted" | "awarded" | "denied";
type FilterKey = "all" | Family;

/** Collapses the 12-value pipeline_stage enum into the 5 families the tab row shows. */
const STAGE_FAMILY: Record<PipelineStage, Family> = {
  discovered: "discovery",
  eligibility_review: "discovery",
  qualified: "discovery",
  drafting: "drafting",
  awaiting_documents: "drafting",
  ready_for_review: "drafting",
  submitted: "submitted",
  follow_up_due: "submitted",
  awarded: "awarded",
  reporting_required: "awarded",
  renewal_opportunity: "awarded",
  denied: "denied",
};

const FAMILY_COLOR: Record<Family, string> = {
  discovery: "#06B6D4",
  drafting: "#8B5CF6",
  submitted: "#0EA5E9",
  awarded: "#10B981",
  denied: "#EF4444",
};

const FAMILY_LABEL: Record<Family, string> = {
  discovery: "Discovery",
  drafting: "Drafting",
  submitted: "Submitted",
  awarded: "Awarded",
  denied: "Denied",
};

const FAMILY_ORDER: Family[] = ["discovery", "drafting", "submitted", "awarded", "denied"];

// Applications & Pipeline section treatment — PAGE_TREATMENT_PROTOCOL_V2.md.
// Frame: Deep Navy (cards/panels/active controls). Secondary accent: Teal
// (neutral data callouts, distinct secondary actions). Never used for the
// per-family pipeline-stage colors above, which are real semantic status
// colors and must not change.
const FRAME_NAVY = "#101B2D";
const ACCENT_TEAL = "#2E6B66";
const CARD_BG = "#F8F5EE";
const CARD_BORDER = "rgba(16,27,45,0.18)";
const ON_FRAME_TEXT = "#F8F5EE";

function probabilityColor(score: number): string {
  if (score >= 70) return "#10B981";
  if (score >= 40) return "#F59E0B";
  return "#EF4444";
}

export default function ApplicationsPage() {
  const router = useRouter();
  const { profile } = useProfile();
  const [applications, setApplications] = useState<EnrichedApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");

  // Clone-to-new-opportunity modal.
  const [cloneSource, setCloneSource] = useState<EnrichedApplication | null>(null);
  const [opportunityOptions, setOpportunityOptions] = useState<
    { id: string; name: string }[]
  >([]);
  const [targetOpportunityId, setTargetOpportunityId] = useState("");
  const [cloning, setCloning] = useState(false);
  const [cloneError, setCloneError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await loadPipelineApplications(createClient());
      setApplications(rows);
    } catch {
      setError("Could not load applications.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function openCloneModal(application: EnrichedApplication) {
    setCloneError(null);
    setTargetOpportunityId("");
    setCloneSource(application);
    if (opportunityOptions.length === 0) {
      const supabase = createClient();
      const { data } = await supabase
        .from("opportunities")
        .select("id, name")
        .order("name");
      setOpportunityOptions(
        ((data ?? []) as { id: string; name: string }[]).map((o) => ({
          id: o.id,
          name: o.name,
        })),
      );
    }
  }

  async function handleClone() {
    if (!cloneSource || !targetOpportunityId) return;
    setCloning(true);
    setCloneError(null);
    try {
      const res = await fetch(`/api/applications/${cloneSource.id}/clone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetOpportunityId }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        newApplicationId?: string;
        error?: string;
      };
      if (!res.ok) {
        setCloneError(payload.error ?? "Could not clone this application.");
        return;
      }
      setCloneSource(null);
      if (payload.newApplicationId) {
        router.push(`/applications/${payload.newApplicationId}`);
      }
    } catch {
      setCloneError("Could not reach the server. Please try again.");
    } finally {
      setCloning(false);
    }
  }

  const editable = canEdit(profile?.role);

  const counts: Record<FilterKey, number> = {
    all: applications.length,
    discovery: 0,
    drafting: 0,
    submitted: 0,
    awarded: 0,
    denied: 0,
  };
  for (const app of applications) {
    counts[STAGE_FAMILY[app.stage]] += 1;
  }

  const filtered =
    filter === "all"
      ? applications
      : applications.filter((app) => STAGE_FAMILY[app.stage] === filter);

  const showEmpty = !loading && !error && filtered.length === 0;

  return (
    <div style={{ minHeight: "100vh", padding: "24px" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "16px",
          marginBottom: "20px",
        }}
      >
        <div style={{ borderLeft: `4px solid ${FRAME_NAVY}`, paddingLeft: "16px" }}>
          <h1
            style={{
              margin: 0,
              fontSize: "28px",
              fontWeight: 800,
              letterSpacing: "-0.02em",
              color: FRAME_NAVY,
            }}
          >
            Applications
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: "14px", color: "#64748B" }}>
            Track every application through the funding pipeline.
          </p>
        </div>
        <Link
          href="/renewals"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            borderRadius: "10px",
            border: "none",
            backgroundColor: ACCENT_TEAL,
            padding: "10px 16px",
            fontSize: "14px",
            fontWeight: 600,
            color: ON_FRAME_TEXT,
            textDecoration: "none",
            boxShadow: "0 2px 8px rgba(16,27,45,0.25)",
          }}
        >
          <RefreshCw style={{ height: "16px", width: "16px" }} aria-hidden />
          Renewals
        </Link>
      </div>

      {/* Pipeline stage tabs */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "20px" }}>
        {(["all", ...FAMILY_ORDER] as FilterKey[]).map((key) => {
          const active = filter === key;
          const label = key === "all" ? "All" : FAMILY_LABEL[key];
          const dotColor = key === "all" ? ACCENT_TEAL : FAMILY_COLOR[key];
          return (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                borderRadius: "10px",
                border: active ? "none" : `1px solid ${CARD_BORDER}`,
                backgroundColor: active ? FRAME_NAVY : CARD_BG,
                color: active ? ON_FRAME_TEXT : FRAME_NAVY,
                padding: "10px 16px",
                fontSize: "14px",
                fontWeight: 700,
                cursor: "pointer",
                boxShadow: active
                  ? "0 2px 8px rgba(16,27,45,0.3)"
                  : "0 1px 3px rgba(16,27,45,0.08)",
              }}
            >
              <span
                aria-hidden
                style={{
                  height: "8px",
                  width: "8px",
                  borderRadius: "999px",
                  backgroundColor: dotColor,
                }}
              />
              {label}
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  minWidth: "22px",
                  height: "22px",
                  padding: "0 6px",
                  borderRadius: "999px",
                  fontSize: "12px",
                  fontWeight: 800,
                  backgroundColor: active ? "rgba(248,245,238,0.22)" : "rgba(16,27,45,0.08)",
                  color: active ? ON_FRAME_TEXT : FRAME_NAVY,
                }}
              >
                {counts[key]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Error */}
      {error && (
        <div
          role="alert"
          style={{
            marginBottom: "16px",
            borderRadius: "10px",
            border: "1px solid #FECACA",
            backgroundColor: "#FEE2E2",
            padding: "12px 16px",
            fontSize: "14px",
            color: "#B91C1C",
          }}
        >
          {error}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <LoadingSpinner center label="Loading pipeline…" />
      ) : showEmpty ? (
        <EmptyState
          icon={Sparkles}
          title="No applications"
          description={
            filter === "all"
              ? "Create an application from a qualified opportunity to start tracking it through the pipeline."
              : `No applications in ${FAMILY_LABEL[filter as Family]} right now.`
          }
          action={
            <Link href="/opportunities">
              <Button variant="secondary">Browse opportunities</Button>
            </Link>
          }
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {filtered.map((app) => (
            <ApplicationRow
              key={app.id}
              application={app}
              cloneable={editable}
              onClone={() => openCloneModal(app)}
            />
          ))}
        </div>
      )}

      {/* Clone application */}
      <Modal
        isOpen={cloneSource !== null}
        onClose={() => {
          if (!cloning) setCloneSource(null);
        }}
        title="Clone application"
        description={
          cloneSource
            ? `The latest draft from "${cloneSource.opportunityName ?? "this application"}" will be adapted for the new opportunity.`
            : undefined
        }
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setCloneSource(null)}
              disabled={cloning}
            >
              Cancel
            </Button>
            <Button
              onClick={handleClone}
              isLoading={cloning}
              disabled={!targetOpportunityId}
            >
              Clone
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Select
            label="Target opportunity"
            placeholder="Select an opportunity…"
            value={targetOpportunityId}
            onChange={(e) => setTargetOpportunityId(e.target.value)}
            options={opportunityOptions.map((o) => ({
              label: o.name,
              value: o.id,
            }))}
          />
          {cloneError && (
            <p role="alert" className="text-sm text-red-600">
              {cloneError}
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}

function ApplicationRow({
  application,
  cloneable,
  onClone,
}: {
  application: EnrichedApplication;
  cloneable: boolean;
  onClone: () => void;
}) {
  const router = useRouter();
  const family = STAGE_FAMILY[application.stage];
  const accentColor = FAMILY_COLOR[family];
  const days = daysInStage(application.stageEnteredAt);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => router.push(`/applications/${application.id}`)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          router.push(`/applications/${application.id}`);
        }
      }}
      style={{
        borderRadius: "14px",
        backgroundColor: FRAME_NAVY,
        padding: "4px",
        cursor: "pointer",
        boxShadow: "0 4px 20px rgba(16,27,45,0.22)",
      }}
    >
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "16px",
          borderRadius: "11px",
          backgroundColor: CARD_BG,
          boxShadow: "inset 0 1px 2px rgba(16,27,45,0.06)",
          padding: "16px 20px 16px 24px",
          overflow: "hidden",
        }}
      >
      <span
        aria-hidden
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: "6px",
          backgroundColor: accentColor,
        }}
      />

      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
          <p
            style={{
              margin: 0,
              maxWidth: "440px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontSize: "15px",
              fontWeight: 700,
              color: "#0F172A",
            }}
          >
            {application.opportunityName ?? "Untitled opportunity"}
          </p>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              borderRadius: "999px",
              padding: "2px 10px",
              fontSize: "11px",
              fontWeight: 700,
              backgroundColor: `${accentColor}1A`,
              color: accentColor,
            }}
          >
            {STAGE_LABEL[application.stage]}
          </span>
          {application.auto_generated && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                borderRadius: "999px",
                padding: "2px 10px",
                fontSize: "11px",
                fontWeight: 700,
                backgroundColor: "#8B5CF6",
                color: ON_FRAME_TEXT,
              }}
            >
              AI Draft
            </span>
          )}
          {application.pending_review && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                borderRadius: "999px",
                padding: "2px 10px",
                fontSize: "11px",
                fontWeight: 700,
                backgroundColor: "#F59E0B",
                color: ON_FRAME_TEXT,
              }}
            >
              Review Needed
            </span>
          )}
        </div>

        {application.funderName && (
          <p
            style={{
              margin: "6px 0 0",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "13px",
              color: ACCENT_TEAL,
              fontWeight: 600,
            }}
          >
            <Building2 style={{ height: "14px", width: "14px" }} aria-hidden />
            {application.funderName}
          </p>
        )}

        <div
          style={{
            marginTop: "8px",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "16px",
            fontSize: "13px",
            color: "#475569",
          }}
        >
          <span style={{ fontWeight: 700, color: "#0F172A" }}>
            {formatCurrency(application.requested_amount)}
          </span>
          {application.deadline && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
              <CalendarClock style={{ height: "14px", width: "14px" }} aria-hidden />
              {formatDate(application.deadline)}
            </span>
          )}
          <span style={{ display: "inline-flex", alignItems: "center", gap: "5px", color: "#94A3B8" }}>
            <Clock style={{ height: "14px", width: "14px" }} aria-hidden />
            {days === 0 ? "In stage today" : `${days} day${days === 1 ? "" : "s"} in stage`}
          </span>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "12px", flexShrink: 0 }}>
        {application.probabilityScore != null && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              borderRadius: "999px",
              padding: "4px 12px",
              fontSize: "12px",
              fontWeight: 800,
              backgroundColor: `${probabilityColor(application.probabilityScore)}1A`,
              color: probabilityColor(application.probabilityScore),
            }}
          >
            {application.probabilityScore}%
          </span>
        )}
        {cloneable && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClone();
            }}
            title="Clone this application"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              height: "34px",
              width: "34px",
              borderRadius: "10px",
              border: `1.5px solid ${ACCENT_TEAL}`,
              backgroundColor: "rgba(46,107,102,0.08)",
              color: ACCENT_TEAL,
              cursor: "pointer",
            }}
          >
            <Copy style={{ height: "16px", width: "16px" }} aria-hidden />
          </button>
        )}
      </div>
      </div>
    </div>
  );
}
