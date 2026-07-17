"use client";

import { useState } from "react";

import { formatCurrency, formatDate, formatRelative, humanizeEnum } from "@/lib/utils/formatters";

export type OrgUserRow = {
  id: string;
  full_name: string | null;
  email: string;
  role: string;
  created_at: string;
  last_login_at: string | null;
};

export type OrgOpportunityRow = {
  id: string;
  name: string;
  category: string;
  deadline: string | null;
  status: string | null;
};

export type OrgApplicationRow = {
  id: string;
  opportunityName: string;
  stage: string;
  requestedAmount: number | null;
  submittedAt: string | null;
  createdAt: string;
};

type BillingInfo = {
  stripeCustomerId: string | null;
  stripeSubscriptionStatus: string | null;
  planName: string;
  monthlyPrice: number | null;
};

type Tab = "users" | "opportunities" | "applications" | "billing";

const TABS: { id: Tab; label: string }[] = [
  { id: "users", label: "Users" },
  { id: "opportunities", label: "Opportunities" },
  { id: "applications", label: "Applications" },
  { id: "billing", label: "Billing" },
];

const cardStyle = {
  backgroundColor: "#FFFFFF",
  borderRadius: "16px",
  overflow: "hidden",
  boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
} as const;

const tabBarStyle = {
  display: "flex",
  gap: "4px",
  padding: "8px 12px 0",
  backgroundColor: "#1A2B3C",
} as const;

function tabButtonStyle(active: boolean) {
  return {
    padding: "10px 18px",
    fontSize: "13px",
    fontWeight: 700,
    color: active ? "#1A2B3C" : "rgba(255,255,255,0.65)",
    backgroundColor: active ? "#FFFFFF" : "transparent",
    border: "none",
    borderRadius: "10px 10px 0 0",
    cursor: "pointer",
  } as const;
}

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

export function OrgDetailTabs({
  orgId,
  users,
  opportunities,
  applications,
  billing,
}: {
  orgId: string;
  users: OrgUserRow[];
  opportunities: OrgOpportunityRow[];
  applications: OrgApplicationRow[];
  billing: BillingInfo;
}) {
  const [activeTab, setActiveTab] = useState<Tab>("users");

  return (
    <>
      <div style={{ ...cardStyle, marginBottom: "24px" }}>
        <div style={tabBarStyle}>
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              style={tabButtonStyle(activeTab === tab.id)}
            >
              {tab.label}
              {tab.id === "users" && ` (${users.length})`}
              {tab.id === "opportunities" && ` (${opportunities.length})`}
              {tab.id === "applications" && ` (${applications.length})`}
            </button>
          ))}
        </div>

        {activeTab === "users" && <UsersTab users={users} />}
        {activeTab === "opportunities" && <OpportunitiesTab opportunities={opportunities} />}
        {activeTab === "applications" && <ApplicationsTab applications={applications} />}
        {activeTab === "billing" && <BillingTab billing={billing} />}
      </div>

      <DangerZone orgId={orgId} />
    </>
  );
}

function UsersTab({ users }: { users: OrgUserRow[] }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={thStyle}>Name</th>
            <th style={thStyle}>Email</th>
            <th style={thStyle}>Role</th>
            <th style={thStyle}>Created</th>
            <th style={thStyle}>Last Login</th>
          </tr>
        </thead>
        <tbody>
          {users.length === 0 ? (
            <tr>
              <td style={tdStyle} colSpan={5}>
                No users in this organization.
              </td>
            </tr>
          ) : (
            users.map((u) => (
              <tr key={u.id}>
                <td style={tdStyle}>{u.full_name ?? "-"}</td>
                <td style={tdStyle}>{u.email}</td>
                <td style={tdStyle}>{humanizeEnum(u.role)}</td>
                <td style={tdStyle}>{formatDate(u.created_at)}</td>
                <td style={tdStyle}>{u.last_login_at ? formatRelative(u.last_login_at) : "Never"}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function OpportunitiesTab({ opportunities }: { opportunities: OrgOpportunityRow[] }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={thStyle}>Title</th>
            <th style={thStyle}>Category</th>
            <th style={thStyle}>Deadline</th>
            <th style={thStyle}>Status</th>
          </tr>
        </thead>
        <tbody>
          {opportunities.length === 0 ? (
            <tr>
              <td style={tdStyle} colSpan={4}>
                No opportunities for this organization.
              </td>
            </tr>
          ) : (
            opportunities.map((o) => (
              <tr key={o.id}>
                <td style={tdStyle}>{o.name}</td>
                <td style={tdStyle}>{humanizeEnum(o.category)}</td>
                <td style={tdStyle}>{o.deadline ? formatDate(o.deadline) : "-"}</td>
                <td style={tdStyle}>{o.status ? humanizeEnum(o.status) : "-"}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function ApplicationsTab({ applications }: { applications: OrgApplicationRow[] }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={thStyle}>Opportunity</th>
            <th style={thStyle}>Stage</th>
            <th style={thStyle}>Requested</th>
            <th style={thStyle}>Submitted</th>
            <th style={thStyle}>Created</th>
          </tr>
        </thead>
        <tbody>
          {applications.length === 0 ? (
            <tr>
              <td style={tdStyle} colSpan={5}>
                No applications for this organization.
              </td>
            </tr>
          ) : (
            applications.map((a) => (
              <tr key={a.id}>
                <td style={tdStyle}>{a.opportunityName}</td>
                <td style={tdStyle}>{humanizeEnum(a.stage)}</td>
                <td style={tdStyle}>{formatCurrency(a.requestedAmount)}</td>
                <td style={tdStyle}>{a.submittedAt ? formatDate(a.submittedAt) : "-"}</td>
                <td style={tdStyle}>{formatDate(a.createdAt)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function BillingTab({ billing }: { billing: BillingInfo }) {
  return (
    <div style={{ padding: "24px" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "20px",
        }}
      >
        <BillingField label="Current Plan" value={billing.planName} />
        <BillingField
          label="Monthly Price"
          value={billing.monthlyPrice !== null ? formatCurrency(billing.monthlyPrice) : "-"}
        />
        <BillingField
          label="Stripe Subscription Status"
          value={billing.stripeSubscriptionStatus ? humanizeEnum(billing.stripeSubscriptionStatus) : "No Subscription"}
        />
        <BillingField label="Stripe Customer ID" value={billing.stripeCustomerId ?? "-"} mono />
      </div>
    </div>
  );
}

function BillingField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div
        style={{
          fontSize: "11px",
          fontWeight: 700,
          color: "#64748B",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: "15px",
          fontWeight: 600,
          color: "#0F172A",
          marginTop: "4px",
          fontFamily: mono ? "monospace" : undefined,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function DangerZone({ orgId }: { orgId: string }) {
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "done">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSuspend() {
    if (!window.confirm("Suspend this organization? Its users will lose access until reinstated.")) {
      return;
    }
    setStatus("loading");
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/admin/orgs/${orgId}/suspend`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(body.error ?? "Failed to suspend organization.");
      }
      setStatus("done");
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Failed to suspend organization.");
    }
  }

  return (
    <div
      style={{
        ...cardStyle,
        border: "1px solid #FCA5A5",
      }}
    >
      <div
        style={{
          fontSize: "13px",
          fontWeight: 700,
          color: "#FFFFFF",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          backgroundColor: "#B91C1C",
          padding: "14px 20px",
        }}
      >
        Danger Zone
      </div>
      <div style={{ padding: "20px", display: "flex", alignItems: "center", gap: "16px" }}>
        <button
          type="button"
          onClick={handleSuspend}
          disabled={status === "loading"}
          style={{
            padding: "10px 20px",
            fontSize: "13px",
            fontWeight: 700,
            color: "#FFFFFF",
            backgroundColor: status === "loading" ? "#F87171" : "#DC2626",
            border: "none",
            borderRadius: "10px",
            cursor: status === "loading" ? "not-allowed" : "pointer",
          }}
        >
          {status === "loading" ? "Suspending..." : "Suspend Organization"}
        </button>
        {status === "done" && (
          <span style={{ fontSize: "13px", color: "#B91C1C", fontWeight: 600 }}>
            Organization suspended.
          </span>
        )}
        {status === "error" && (
          <span style={{ fontSize: "13px", color: "#B91C1C", fontWeight: 600 }}>
            {errorMessage}
          </span>
        )}
      </div>
    </div>
  );
}
