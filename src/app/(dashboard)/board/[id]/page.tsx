"use client";

import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Calendar,
  Loader2,
  Mail,
  Phone,
  User,
} from "lucide-react";

import { formatCurrency, formatDate } from "@/lib/utils/formatters";
import type { Tables } from "@/types/database";

// Board Member detail page (FEATURE_REGISTRY_v2.md row #138, "Board Member
// Portal"), backed by GET /api/board/[id]. Inline style={{}} with hardcoded
// hex only, per this project's UI rule.
//
// Honest Phase 1 scope, stated here so it isn't mistaken for a self-service
// board-member login portal: board_members has no auth-identity column and
// there is no board_member role in the live user_role enum, so this page is
// reached by an already-authenticated org user (viewer role or above), not
// by the board member logging in as themselves. Packets shown below are
// this organization's board_meeting_packets — org-scoped, not filtered to
// meetings this specific member attended, because no attendee/invite table
// links a board_members row to a specific board_meetings row anywhere in
// the schema. See the API route's header comment for the full account.

interface MeetingInfo {
  id: string;
  meeting_date: string;
  meeting_type: string;
  agenda: string | null;
  status: string;
}

interface PipelineOpportunity {
  name: string;
  category: string | null;
  amountMin: number | null;
  amountMax: number | null;
  deadline: string | null;
}

interface PacketContent {
  agenda?: string | null;
  pipelineSummary?: {
    count: number;
    note?: string;
    opportunities: PipelineOpportunity[];
  };
  outcomesSinceLastMeeting?: {
    sinceDate: string;
    isFirstMeeting: boolean;
    count: number;
    awarded: number;
    denied: number;
    partial: number;
    totalAwardedAmount: number;
    note: string;
  };
  financialSnapshot?: {
    annualBudget: number | null;
    totalStaff: number | null;
    totalVolunteers: number | null;
    note?: string;
  };
  // FEATURE_REGISTRY_v2.md row #139, "Plain Language Financials" — the
  // deeper narrative financialSnapshot above deliberately doesn't attempt,
  // sourced from real grant_budgets/grant_expenses/
  // grant_reconciliation_reports (board-packet-agent.ts).
  plainLanguageFinancials?: {
    totalBudgeted: number;
    totalSpent: number;
    variance: number;
    budgetsCount: number;
    expensesCount: number;
    categoryBreakdown: { category: string; amount: number }[];
    reconciliation: { status: string; count: number }[];
    hasAnyData: boolean;
    narrative: string | null;
    groundedFacts: string[];
    note?: string;
  };
  recommendedDiscussionItems?: { item: string; groundedIn: string }[];
  generatedFor?: string;
  narrativeUnavailable?: string;
}

interface PacketOut {
  id: string;
  meetingId: string | null;
  meeting: MeetingInfo | null;
  packetContent: PacketContent;
  generatedAt: string;
  viewedBy: string[];
}

interface BoardDetailResponse {
  member: Tables<"board_members">;
  packets: PacketOut[];
}

const cardStyle: CSSProperties = {
  backgroundColor: "#FFFFFF",
  borderRadius: "14px",
  border: "1px solid #E2E8F0",
  boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
  padding: "24px",
};

const sectionLabelStyle: CSSProperties = {
  fontSize: "11px",
  fontWeight: 700,
  color: "#0077B6",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  margin: "0 0 10px 0",
};

export default function BoardMemberDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const [data, setData] = useState<BoardDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/board/${params.id}`, { cache: "no-store" });
      const body = (await res.json()) as BoardDetailResponse & { error?: string };
      if (!res.ok) {
        setError(body.error ?? "Failed to load board member.");
        return;
      }
      setData(body);
    } catch {
      setError("Network error loading board member.");
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div style={{ backgroundColor: "#E4E9F0", minHeight: "100vh", padding: "32px" }}>
      <div style={{ maxWidth: "860px", margin: "0 auto" }}>
        <Link
          href="/knowledge-base/profile"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            fontSize: "13px",
            color: "#64748B",
            textDecoration: "none",
            marginBottom: "20px",
          }}
        >
          <ArrowLeft size={16} aria-hidden />
          Back to board members
        </Link>

        {loading && (
          <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#64748B", fontSize: "14px" }}>
            <Loader2 size={16} className="animate-spin" aria-hidden />
            Loading board member…
          </div>
        )}

        {!loading && error && (
          <div
            style={{
              ...cardStyle,
              borderColor: "#FCA5A5",
              color: "#B91C1C",
              fontSize: "14px",
            }}
          >
            {error}
          </div>
        )}

        {!loading && !error && data && (
          <>
            <MemberHeader member={data.member} />
            <PacketList packets={data.packets} />
          </>
        )}
      </div>
    </div>
  );
}

function MemberHeader({ member }: { member: Tables<"board_members"> }) {
  return (
    <div
      style={{
        ...cardStyle,
        marginBottom: "20px",
        display: "flex",
        alignItems: "flex-start",
        gap: "16px",
      }}
    >
      <div
        style={{
          width: "56px",
          height: "56px",
          borderRadius: "50%",
          background: "linear-gradient(135deg,#0077B6,#00B4D8)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <User size={26} color="#FFFFFF" aria-hidden />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" }}>
          <h1 style={{ fontSize: "22px", fontWeight: 800, color: "#0F172A", margin: 0 }}>
            {member.name}
          </h1>
          {member.is_active === false && (
            <span
              style={{
                fontSize: "11px",
                fontWeight: 700,
                color: "#64748B",
                backgroundColor: "#F1F5F9",
                border: "1px solid #E2E8F0",
                borderRadius: "999px",
                padding: "2px 10px",
              }}
            >
              Inactive
            </span>
          )}
        </div>
        {member.title && (
          <p style={{ fontSize: "14px", color: "#0077B6", fontWeight: 600, margin: "4px 0 0" }}>
            {member.title}
          </p>
        )}
        {member.bio && (
          <p style={{ fontSize: "13px", color: "#64748B", margin: "10px 0 0", lineHeight: 1.6 }}>
            {member.bio}
          </p>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", marginTop: "14px" }}>
          {member.email && (
            <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#64748B" }}>
              <Mail size={14} aria-hidden />
              {member.email}
            </span>
          )}
          {member.phone && (
            <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#64748B" }}>
              <Phone size={14} aria-hidden />
              {member.phone}
            </span>
          )}
          {member.start_date && (
            <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#64748B" }}>
              <Calendar size={14} aria-hidden />
              Board member since {formatDate(member.start_date)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function PacketList({ packets }: { packets: PacketOut[] }) {
  if (packets.length === 0) {
    return (
      <div style={cardStyle}>
        <p style={sectionLabelStyle}>Board meeting packets</p>
        <p style={{ fontSize: "13px", color: "#64748B", margin: 0 }}>
          No board meeting packets have been generated for this organization yet.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <p style={{ ...sectionLabelStyle, marginLeft: "4px" }}>
        Board meeting packets ({packets.length})
      </p>
      {packets.map((packet) => (
        <PacketCard key={packet.id} packet={packet} />
      ))}
    </div>
  );
}

function PacketCard({ packet }: { packet: PacketOut }) {
  const content = packet.packetContent;
  const pipeline = content.pipelineSummary;
  const outcomes = content.outcomesSinceLastMeeting;
  const financial = content.financialSnapshot;
  const items = content.recommendedDiscussionItems ?? [];

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: "8px", marginBottom: "16px" }}>
        <div>
          <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#0F172A", margin: 0 }}>
            {packet.meeting
              ? `${humanizeMeetingType(packet.meeting.meeting_type)} — ${formatDate(packet.meeting.meeting_date)}`
              : `Generated ${formatDate(packet.generatedAt)}`}
          </h2>
          {packet.meeting?.status && (
            <p style={{ fontSize: "12px", color: "#64748B", margin: "2px 0 0" }}>
              Status: {humanizeMeetingType(packet.meeting.status)}
            </p>
          )}
        </div>
        <span style={{ fontSize: "11px", color: "#94A3B8" }}>
          Generated {formatDate(packet.generatedAt)}
        </span>
      </div>

      {content.narrativeUnavailable && (
        <p
          style={{
            fontSize: "12px",
            color: "#B45309",
            backgroundColor: "#FFFBEB",
            border: "1px solid #FDE68A",
            borderRadius: "8px",
            padding: "8px 12px",
            marginBottom: "14px",
          }}
        >
          {content.narrativeUnavailable}
        </p>
      )}

      {content.agenda && (
        <div style={{ marginBottom: "16px" }}>
          <p style={sectionLabelStyle}>Agenda</p>
          <p style={{ fontSize: "13px", color: "#334155", margin: 0 }}>{content.agenda}</p>
        </div>
      )}

      {pipeline && (
        <div style={{ marginBottom: "16px" }}>
          <p style={sectionLabelStyle}>Pipeline ({pipeline.count} open opportunity{pipeline.count === 1 ? "" : "ies"})</p>
          {pipeline.note && (
            <p style={{ fontSize: "13px", color: "#64748B", margin: "0 0 8px" }}>{pipeline.note}</p>
          )}
          {pipeline.opportunities.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: "18px", display: "flex", flexDirection: "column", gap: "4px" }}>
              {pipeline.opportunities.map((o, i) => (
                <li key={i} style={{ fontSize: "13px", color: "#334155" }}>
                  {o.name}
                  {o.category ? ` — ${o.category}` : ""}
                  {o.amountMin != null || o.amountMax != null
                    ? ` (${o.amountMin != null ? formatCurrency(o.amountMin) : "?"}–${o.amountMax != null ? formatCurrency(o.amountMax) : "?"})`
                    : ""}
                  {o.deadline ? `, due ${formatDate(o.deadline)}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {outcomes && (
        <div style={{ marginBottom: "16px" }}>
          <p style={sectionLabelStyle}>Outcomes {outcomes.isFirstMeeting ? "(trailing 90 days)" : `since ${formatDate(outcomes.sinceDate)}`}</p>
          <p style={{ fontSize: "13px", color: "#334155", margin: 0 }}>
            {outcomes.count} outcome{outcomes.count === 1 ? "" : "s"} recorded — {outcomes.awarded} awarded,{" "}
            {outcomes.denied} denied, {outcomes.partial} partial. Total awarded/partial:{" "}
            {formatCurrency(outcomes.totalAwardedAmount)}.
          </p>
          <p style={{ fontSize: "12px", color: "#94A3B8", margin: "4px 0 0" }}>{outcomes.note}</p>
        </div>
      )}

      {financial && (
        <div style={{ marginBottom: "16px" }}>
          <p style={sectionLabelStyle}>Financial snapshot</p>
          {financial.note ? (
            <p style={{ fontSize: "13px", color: "#64748B", margin: 0 }}>{financial.note}</p>
          ) : (
            <p style={{ fontSize: "13px", color: "#334155", margin: 0 }}>
              Annual budget: {financial.annualBudget != null ? formatCurrency(financial.annualBudget) : "unknown"} ·{" "}
              Staff: {financial.totalStaff ?? "unknown"} · Volunteers: {financial.totalVolunteers ?? "unknown"}
            </p>
          )}
        </div>
      )}

      {content.plainLanguageFinancials && (
        <PlainLanguageFinancialsSection data={content.plainLanguageFinancials} />
      )}

      {items.length > 0 && (
        <div>
          <p style={sectionLabelStyle}>Recommended discussion items</p>
          <ul style={{ margin: 0, paddingLeft: "18px", display: "flex", flexDirection: "column", gap: "6px" }}>
            {items.map((item, i) => (
              <li key={i} style={{ fontSize: "13px", color: "#334155" }}>
                {item.item}
                <span style={{ fontSize: "11px", color: "#94A3B8" }}> ({item.groundedIn})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// FEATURE_REGISTRY_v2.md row #139, "Plain Language Financials" — real
// aggregates from grant_budgets/grant_expenses/grant_reconciliation_reports,
// narrated by Claude with every sentence traced to a groundedFacts entry
// (board-packet-agent.ts). Renders as its own labeled sub-section of the
// packet card, distinct from the lightweight "Financial snapshot" above it.
function PlainLanguageFinancialsSection({
  data,
}: {
  data: NonNullable<PacketContent["plainLanguageFinancials"]>;
}) {
  return (
    <div style={{ marginBottom: "16px" }}>
      <p style={sectionLabelStyle}>Financial summary (plain language)</p>

      {!data.hasAnyData && (
        <p style={{ fontSize: "13px", color: "#64748B", margin: 0 }}>
          {data.note ?? "No financial data on file yet."}
        </p>
      )}

      {data.hasAnyData && data.narrative && (
        <p style={{ fontSize: "13px", color: "#334155", margin: "0 0 10px", lineHeight: 1.6 }}>
          {data.narrative}
        </p>
      )}

      {data.hasAnyData && !data.narrative && data.note && (
        <p
          style={{
            fontSize: "12px",
            color: "#B45309",
            backgroundColor: "#FFFBEB",
            border: "1px solid #FDE68A",
            borderRadius: "8px",
            padding: "8px 12px",
            marginBottom: "10px",
          }}
        >
          {data.note}
        </p>
      )}

      {data.hasAnyData && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "16px" }}>
          <FinancialFigure label="Budgeted" value={formatCurrency(data.totalBudgeted)} />
          <FinancialFigure label="Spent" value={formatCurrency(data.totalSpent)} />
          <FinancialFigure
            label="Remaining"
            value={formatCurrency(data.variance)}
            valueColor={data.variance < 0 ? "#B91C1C" : "#0F172A"}
          />
        </div>
      )}

      {data.categoryBreakdown.length > 0 && (
        <ul style={{ margin: "10px 0 0", paddingLeft: "18px", display: "flex", flexDirection: "column", gap: "3px" }}>
          {data.categoryBreakdown.map((c, i) => (
            <li key={i} style={{ fontSize: "12px", color: "#64748B" }}>
              {c.category}: {formatCurrency(c.amount)}
            </li>
          ))}
        </ul>
      )}

      {data.reconciliation.length > 0 && (
        <p style={{ fontSize: "12px", color: "#94A3B8", margin: "8px 0 0" }}>
          {data.reconciliation
            .map((r) => `${r.count} grant${r.count === 1 ? "" : "s"} ${humanizeMeetingType(r.status).toLowerCase()}`)
            .join(" · ")}
        </p>
      )}
    </div>
  );
}

function FinancialFigure({
  label,
  value,
  valueColor = "#0F172A",
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div>
      <div style={{ fontSize: "11px", color: "#94A3B8" }}>{label}</div>
      <div style={{ fontSize: "14px", fontWeight: 700, color: valueColor }}>{value}</div>
    </div>
  );
}

function humanizeMeetingType(value: string): string {
  return value
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
