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

export type OrgAgentRunRow = {
  id: string;
  agent_type: string;
  status: string;
  items_found: number | null;
  items_processed: number | null;
  error_message: string | null;
  duration_ms: number | null;
  trigger_source: string | null;
  created_at: string;
  completed_at: string | null;
};

export type OrgStrategicRecRow = {
  id: string;
  recommendation_category: string;
  title: string;
  recommendation: string;
  urgency: string;
  confidence_score: number | null;
  status: string;
  generated_at: string;
};

export type OrgAutonomousConfig = {
  auto_research_enabled: boolean;
  auto_score_enabled: boolean;
  auto_draft_enabled: boolean;
  auto_draft_threshold: number;
  auto_reputation_enabled: boolean;
  auto_relationship_enabled: boolean;
  auto_deadline_prediction_enabled: boolean;
  auto_followup_enabled: boolean;
  auto_autoapply_enabled: boolean;
  max_nightly_autoapply_submissions: number;
  notify_on_auto_draft: boolean;
  notify_on_high_score: boolean;
  notify_digest_time: string;
  max_auto_drafts_per_night: number;
};

type KbCompleteness = {
  percent: number;
  categoriesPresent: number;
  categoriesTotal: number;
};

type BillingInfo = {
  stripeCustomerId: string | null;
  stripeSubscriptionStatus: string | null;
  planName: string;
  monthlyPrice: number | null;
};

type Tab = "users" | "opportunities" | "applications" | "billing" | "agent-activity" | "intelligence";

const TABS: { id: Tab; label: string }[] = [
  { id: "users", label: "Users" },
  { id: "opportunities", label: "Opportunities" },
  { id: "applications", label: "Applications" },
  { id: "billing", label: "Billing" },
  { id: "agent-activity", label: "Agent Activity" },
  { id: "intelligence", label: "Intelligence" },
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
  agentRuns,
  strategicRecommendations,
  autonomousConfig,
  kbCompleteness,
  onboardingCompleted,
}: {
  orgId: string;
  users: OrgUserRow[];
  opportunities: OrgOpportunityRow[];
  applications: OrgApplicationRow[];
  billing: BillingInfo;
  agentRuns: OrgAgentRunRow[];
  strategicRecommendations: OrgStrategicRecRow[];
  autonomousConfig: OrgAutonomousConfig | null;
  kbCompleteness: KbCompleteness;
  onboardingCompleted: boolean;
}) {
  const [activeTab, setActiveTab] = useState<Tab>("users");

  return (
    <>
      <AdminActionsPanel orgId={orgId} onboardingCompleted={onboardingCompleted} />

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
              {tab.id === "agent-activity" && ` (${agentRuns.length})`}
              {tab.id === "intelligence" && ` (${strategicRecommendations.length})`}
            </button>
          ))}
        </div>

        {activeTab === "users" && <UsersTab users={users} />}
        {activeTab === "opportunities" && <OpportunitiesTab opportunities={opportunities} />}
        {activeTab === "applications" && <ApplicationsTab applications={applications} />}
        {activeTab === "billing" && <BillingTab billing={billing} />}
        {activeTab === "agent-activity" && <AgentActivityTab agentRuns={agentRuns} />}
        {activeTab === "intelligence" && (
          <IntelligenceTab
            kbCompleteness={kbCompleteness}
            autonomousConfig={autonomousConfig}
            strategicRecommendations={strategicRecommendations}
          />
        )}
      </div>

      <DangerZone orgId={orgId} />
    </>
  );
}

function agentRunStatusColor(status: string): string {
  switch (status) {
    case "completed":
      return "#10B981";
    case "failed":
      return "#EF4444";
    case "running":
      return "#F59E0B";
    default:
      return "#64748B";
  }
}

function AgentActivityTab({ agentRuns }: { agentRuns: OrgAgentRunRow[] }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={thStyle}>Agent</th>
            <th style={thStyle}>Status</th>
            <th style={thStyle}>Items Found</th>
            <th style={thStyle}>Items Processed</th>
            <th style={thStyle}>Duration</th>
            <th style={thStyle}>Trigger</th>
            <th style={thStyle}>Started</th>
          </tr>
        </thead>
        <tbody>
          {agentRuns.length === 0 ? (
            <tr>
              <td style={tdStyle} colSpan={7}>
                No agent runs recorded for this organization.
              </td>
            </tr>
          ) : (
            agentRuns.map((run) => (
              <tr key={run.id}>
                <td style={tdStyle}>{humanizeEnum(run.agent_type)}</td>
                <td style={tdStyle}>
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: 700,
                      color: agentRunStatusColor(run.status),
                      border: `1px solid ${agentRunStatusColor(run.status)}`,
                      borderRadius: "999px",
                      padding: "2px 8px",
                      textTransform: "capitalize",
                    }}
                  >
                    {run.status}
                  </span>
                </td>
                <td style={tdStyle}>{run.items_found ?? "-"}</td>
                <td style={tdStyle}>{run.items_processed ?? "-"}</td>
                <td style={tdStyle}>
                  {run.duration_ms != null ? `${(run.duration_ms / 1000).toFixed(1)}s` : "-"}
                </td>
                <td style={tdStyle}>{run.trigger_source ? humanizeEnum(run.trigger_source) : "-"}</td>
                <td style={tdStyle}>
                  {formatDate(run.created_at)} · {formatRelative(run.created_at)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function toggleRowStyle() {
  return {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 0",
    borderBottom: "1px solid #F1F5F9",
    fontSize: "13px",
  } as const;
}

function BooleanPill({ value }: { value: boolean }) {
  return (
    <span
      style={{
        fontSize: "11px",
        fontWeight: 700,
        color: value ? "#10B981" : "#94A3B8",
        border: `1px solid ${value ? "#10B981" : "#CBD5E1"}`,
        borderRadius: "999px",
        padding: "2px 10px",
      }}
    >
      {value ? "Enabled" : "Disabled"}
    </span>
  );
}

function IntelligenceTab({
  kbCompleteness,
  autonomousConfig,
  strategicRecommendations,
}: {
  kbCompleteness: KbCompleteness;
  autonomousConfig: OrgAutonomousConfig | null;
  strategicRecommendations: OrgStrategicRecRow[];
}) {
  return (
    <div style={{ padding: "24px" }}>
      <div style={{ marginBottom: "28px" }}>
        <div
          style={{
            fontSize: "11px",
            fontWeight: 700,
            color: "#64748B",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            marginBottom: "8px",
          }}
        >
          Knowledge Base Completeness
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div
            style={{
              flex: 1,
              height: "10px",
              borderRadius: "999px",
              backgroundColor: "#E2E8F0",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${kbCompleteness.percent}%`,
                height: "100%",
                backgroundColor: "#0077B6",
                borderRadius: "999px",
              }}
            />
          </div>
          <span style={{ fontSize: "13px", fontWeight: 700, color: "#0F172A" }}>
            {kbCompleteness.categoriesPresent} / {kbCompleteness.categoriesTotal} categories (
            {kbCompleteness.percent}%)
          </span>
        </div>
      </div>

      <div style={{ marginBottom: "28px" }}>
        <div
          style={{
            fontSize: "11px",
            fontWeight: 700,
            color: "#64748B",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            marginBottom: "8px",
          }}
        >
          Autonomous Configuration
        </div>
        {!autonomousConfig ? (
          <div style={{ fontSize: "13px", color: "#94A3B8" }}>
            No autonomous configuration row exists yet for this organization (all-off defaults
            apply).
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "0 32px" }}>
            <div style={toggleRowStyle()}>
              <span>Auto Research</span>
              <BooleanPill value={autonomousConfig.auto_research_enabled} />
            </div>
            <div style={toggleRowStyle()}>
              <span>Auto Score</span>
              <BooleanPill value={autonomousConfig.auto_score_enabled} />
            </div>
            <div style={toggleRowStyle()}>
              <span>Auto Draft (threshold {autonomousConfig.auto_draft_threshold})</span>
              <BooleanPill value={autonomousConfig.auto_draft_enabled} />
            </div>
            <div style={toggleRowStyle()}>
              <span>Auto Reputation</span>
              <BooleanPill value={autonomousConfig.auto_reputation_enabled} />
            </div>
            <div style={toggleRowStyle()}>
              <span>Auto Relationship</span>
              <BooleanPill value={autonomousConfig.auto_relationship_enabled} />
            </div>
            <div style={toggleRowStyle()}>
              <span>Auto Deadline Prediction</span>
              <BooleanPill value={autonomousConfig.auto_deadline_prediction_enabled} />
            </div>
            <div style={toggleRowStyle()}>
              <span>Auto Follow-Up</span>
              <BooleanPill value={autonomousConfig.auto_followup_enabled} />
            </div>
            <div style={toggleRowStyle()}>
              <span>Auto AutoApply (max {autonomousConfig.max_nightly_autoapply_submissions}/night)</span>
              <BooleanPill value={autonomousConfig.auto_autoapply_enabled} />
            </div>
          </div>
        )}
      </div>

      <div>
        <div
          style={{
            fontSize: "11px",
            fontWeight: 700,
            color: "#64748B",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            marginBottom: "8px",
          }}
        >
          Strategic Recommendations ({strategicRecommendations.length})
        </div>
        {strategicRecommendations.length === 0 ? (
          <div style={{ fontSize: "13px", color: "#94A3B8" }}>
            No strategic recommendations generated for this organization yet.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={thStyle}>Title</th>
                  <th style={thStyle}>Category</th>
                  <th style={thStyle}>Urgency</th>
                  <th style={thStyle}>Confidence</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Generated</th>
                </tr>
              </thead>
              <tbody>
                {strategicRecommendations.map((rec) => (
                  <tr key={rec.id}>
                    <td style={tdStyle}>{rec.title}</td>
                    <td style={tdStyle}>{humanizeEnum(rec.recommendation_category)}</td>
                    <td style={tdStyle}>{humanizeEnum(rec.urgency)}</td>
                    <td style={tdStyle}>{rec.confidence_score ?? "-"}</td>
                    <td style={tdStyle}>{humanizeEnum(rec.status)}</td>
                    <td style={tdStyle}>{formatDate(rec.generated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function AdminActionsPanel({
  orgId,
  onboardingCompleted,
}: {
  orgId: string;
  onboardingCompleted: boolean;
}) {
  const [pending, setPending] = useState<"run_pipeline" | "reset_onboarding" | "upgrade_plan" | null>(
    null,
  );
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  async function runAction(action: "run_pipeline" | "reset_onboarding" | "upgrade_plan") {
    if (action === "reset_onboarding" && !window.confirm("Reset onboarding for this organization?")) {
      return;
    }
    setPending(action);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/orgs/${orgId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; url?: string };
      if (!res.ok) {
        throw new Error(body.error ?? "Action failed.");
      }
      if (action === "upgrade_plan" && body.url) {
        window.open(body.url, "_blank", "noopener,noreferrer");
        setMessage({ type: "success", text: "Billing portal opened in a new tab." });
      } else if (action === "run_pipeline") {
        setMessage({ type: "success", text: "Pipeline queued (ag-17 Discovery)." });
      } else {
        setMessage({ type: "success", text: "Onboarding reset." });
      }
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Action failed.",
      });
    } finally {
      setPending(null);
    }
  }

  return (
    <div style={{ ...cardStyle, marginBottom: "24px" }}>
      <div
        style={{
          fontSize: "13px",
          fontWeight: 700,
          color: "#FFFFFF",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          backgroundColor: "#1A2B3C",
          padding: "14px 20px",
        }}
      >
        Admin Actions
      </div>
      <div style={{ padding: "20px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px" }}>
        <button
          type="button"
          onClick={() => void runAction("run_pipeline")}
          disabled={pending !== null}
          style={actionButtonStyle(pending === "run_pipeline", "#0077B6")}
        >
          {pending === "run_pipeline" ? "Queuing..." : "Run Pipeline for Org"}
        </button>
        <button
          type="button"
          onClick={() => void runAction("reset_onboarding")}
          disabled={pending !== null}
          style={actionButtonStyle(pending === "reset_onboarding", "#F59E0B")}
        >
          {pending === "reset_onboarding" ? "Resetting..." : "Reset Onboarding"}
        </button>
        <button
          type="button"
          onClick={() => void runAction("upgrade_plan")}
          disabled={pending !== null}
          style={actionButtonStyle(pending === "upgrade_plan", "#6B48CC")}
        >
          {pending === "upgrade_plan" ? "Opening..." : "Upgrade Plan"}
        </button>
        <span style={{ fontSize: "12px", color: "#64748B" }}>
          Onboarding currently: <strong>{onboardingCompleted ? "Complete" : "Incomplete"}</strong>
        </span>
        {message && (
          <span
            style={{
              fontSize: "13px",
              fontWeight: 600,
              color: message.type === "success" ? "#10B981" : "#B91C1C",
            }}
          >
            {message.text}
          </span>
        )}
      </div>
    </div>
  );
}

function actionButtonStyle(loading: boolean, color: string) {
  return {
    padding: "10px 18px",
    fontSize: "13px",
    fontWeight: 700,
    color: "#FFFFFF",
    backgroundColor: loading ? `${color}99` : color,
    border: "none",
    borderRadius: "10px",
    cursor: loading ? "not-allowed" : "pointer",
  } as const;
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
