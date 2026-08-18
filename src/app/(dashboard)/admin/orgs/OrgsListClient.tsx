"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { formatDate, humanizeEnum } from "@/lib/utils/formatters";

// Admin/Platform section treatment — PAGE_TREATMENT_PROTOCOL_V2.md. Frame:
// Deep Navy. Secondary accent: Rich Gold (used only as a fill with dark text
// or as a border/outline — its contrast as small text on ivory is too low).
// Impersonate is safety-sensitive and stays a distinct warning amber, never
// blended into the section's navy/gold treatment.
const FRAME_NAVY = "#101B2D";
const ACCENT_GOLD = "#B88A2E";
const CARD_BG = "#F8F5EE";
const IMPERSONATE_WARNING = "#C2410C";

export type OrgListRow = {
  id: string;
  name: string;
  plan: string;
  status: string;
  onboardingCompleted: boolean;
  createdAt: string;
  agentRunsLast7d: number;
};

const frameStyle = {
  backgroundColor: FRAME_NAVY,
  borderRadius: "16px",
  boxShadow: "0 4px 20px rgba(16,27,45,0.22)",
  padding: "3px",
} as const;

const cardStyle = {
  backgroundColor: CARD_BG,
  borderRadius: "13px",
  overflow: "hidden",
} as const;

const thStyle = {
  padding: "10px 16px",
  textAlign: "left" as const,
  fontSize: "11px",
  fontWeight: 700,
  color: "#64748B",
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
  borderBottom: "1px solid #E2E8F0",
};

const tdStyle = {
  padding: "12px 16px",
  fontSize: "13px",
  color: "#334155",
  borderBottom: "1px solid #F1F5F9",
};

const filterSelectStyle = {
  padding: "8px 12px",
  fontSize: "13px",
  fontWeight: 600,
  color: "#0F172A",
  backgroundColor: CARD_BG,
  border: "1px solid #CBD5E1",
  borderRadius: "8px",
};

function statusColor(status: string): string {
  switch (status) {
    case "active":
      return "#10B981";
    case "trialing":
      return "#0EA5E9";
    case "suspended":
      return "#DC2626";
    case "canceled":
    case "no_subscription":
      return "#94A3B8";
    default:
      return "#F59E0B";
  }
}

function StatusBadge({ status }: { status: string }) {
  const color = statusColor(status);
  const label = status === "no_subscription" ? "No Subscription" : humanizeEnum(status);
  return (
    <span
      style={{
        fontSize: "11px",
        fontWeight: 700,
        color,
        border: `1px solid ${color}`,
        borderRadius: "999px",
        padding: "2px 10px",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

export function OrgsListClient({ organizations }: { organizations: OrgListRow[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [planFilter, setPlanFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [onboardingFilter, setOnboardingFilter] = useState("all");
  const [impersonatingId, setImpersonatingId] = useState<string | null>(null);
  const [impersonateError, setImpersonateError] = useState<string | null>(null);

  const plans = useMemo(
    () => Array.from(new Set(organizations.map((o) => o.plan))).sort(),
    [organizations],
  );
  const statuses = useMemo(
    () => Array.from(new Set(organizations.map((o) => o.status))).sort(),
    [organizations],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return organizations.filter((org) => {
      if (q && !org.name.toLowerCase().includes(q)) return false;
      if (planFilter !== "all" && org.plan !== planFilter) return false;
      if (statusFilter !== "all" && org.status !== statusFilter) return false;
      if (onboardingFilter === "complete" && !org.onboardingCompleted) return false;
      if (onboardingFilter === "incomplete" && org.onboardingCompleted) return false;
      return true;
    });
  }, [organizations, search, planFilter, statusFilter, onboardingFilter]);

  async function handleImpersonate(orgId: string) {
    setImpersonatingId(orgId);
    setImpersonateError(null);
    try {
      const res = await fetch(`/api/admin/orgs/${orgId}/impersonate`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        viewUrl?: string;
      };
      if (!res.ok) {
        throw new Error(body.error ?? "Could not start impersonation.");
      }
      router.push(body.viewUrl ?? `/admin/orgs/${orgId}`);
    } catch (err) {
      setImpersonateError(
        err instanceof Error ? err.message : "Could not start impersonation.",
      );
      setImpersonatingId(null);
    }
  }

  return (
    <div style={frameStyle}>
    <div style={cardStyle}>
      <div
        style={{
          padding: "16px 20px",
          display: "flex",
          flexWrap: "wrap",
          gap: "12px",
          alignItems: "center",
          borderBottom: "1px solid #E2E8F0",
        }}
      >
        <input
          type="text"
          placeholder="Search by org name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            flex: "1 1 220px",
            padding: "9px 14px",
            fontSize: "13px",
            border: "1px solid #CBD5E1",
            borderRadius: "8px",
            color: "#0F172A",
            backgroundColor: CARD_BG,
          }}
        />
        <select
          value={planFilter}
          onChange={(e) => setPlanFilter(e.target.value)}
          style={filterSelectStyle}
        >
          <option value="all">All Plans</option>
          {plans.map((plan) => (
            <option key={plan} value={plan}>
              {humanizeEnum(plan)}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={filterSelectStyle}
        >
          <option value="all">All Statuses</option>
          {statuses.map((status) => (
            <option key={status} value={status}>
              {status === "no_subscription" ? "No Subscription" : humanizeEnum(status)}
            </option>
          ))}
        </select>
        <select
          value={onboardingFilter}
          onChange={(e) => setOnboardingFilter(e.target.value)}
          style={filterSelectStyle}
        >
          <option value="all">Onboarding: Any</option>
          <option value="complete">Onboarding: Complete</option>
          <option value="incomplete">Onboarding: Incomplete</option>
        </select>
        <span style={{ fontSize: "12px", color: "#64748B", fontWeight: 600 }}>
          {filtered.length} of {organizations.length}
        </span>
      </div>

      {impersonateError && (
        <div
          style={{
            padding: "10px 20px",
            fontSize: "13px",
            color: "#B91C1C",
            backgroundColor: "#FEE2E2",
            borderBottom: "1px solid #FECACA",
          }}
        >
          {impersonateError}
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle}>Org Name</th>
              <th style={thStyle}>Plan</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Onboarding</th>
              <th style={thStyle}>Created</th>
              <th style={thStyle}>Agent Runs (7d)</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td style={tdStyle} colSpan={7}>
                  No organizations match these filters.
                </td>
              </tr>
            ) : (
              filtered.map((org) => (
                <tr key={org.id}>
                  <td style={tdStyle}>
                    <Link
                      href={`/admin/orgs/${org.id}`}
                      style={{ color: FRAME_NAVY, fontWeight: 600, textDecoration: "none" }}
                    >
                      {org.name}
                    </Link>
                  </td>
                  <td style={tdStyle}>{humanizeEnum(org.plan)}</td>
                  <td style={tdStyle}>
                    <StatusBadge status={org.status} />
                  </td>
                  <td style={tdStyle}>
                    {org.onboardingCompleted ? (
                      <span style={{ color: "#10B981", fontWeight: 700 }}>Complete</span>
                    ) : (
                      <span style={{ color: "#F59E0B", fontWeight: 700 }}>Incomplete</span>
                    )}
                  </td>
                  <td style={tdStyle}>{formatDate(org.createdAt)}</td>
                  <td style={tdStyle}>{org.agentRunsLast7d}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>
                    <button
                      type="button"
                      onClick={() => void handleImpersonate(org.id)}
                      disabled={impersonatingId === org.id}
                      style={{
                        padding: "6px 14px",
                        fontSize: "12px",
                        fontWeight: 700,
                        color: "#FFFFFF",
                        backgroundColor:
                          impersonatingId === org.id ? "#FDBA74" : IMPERSONATE_WARNING,
                        border: `1.5px solid ${IMPERSONATE_WARNING}`,
                        borderRadius: "8px",
                        cursor: impersonatingId === org.id ? "not-allowed" : "pointer",
                      }}
                    >
                      {impersonatingId === org.id ? "Opening..." : "Impersonate"}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
    </div>
  );
}
