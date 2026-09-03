import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/auth/role-gate";
import { formatDate, formatRelative, humanizeEnum } from "@/lib/utils/formatters";

// Platform admin dashboard. Owner-only (BLUEPRINT §3.2 role hierarchy - owner is
// the top rank). Unlike the org-scoped pages under (dashboard)/admin/*, this page
// aggregates across every tenant, so every query below uses the service-role
// client (src/lib/supabase/admin.ts) with no organization_id filter - by design,
// not an oversight. Mirrors the existing cross-tenant precedent in
// /api/admin/monitor (also service-role, no org filter, gated on org role).
export const dynamic = "force-dynamic";

type OrgRow = {
  id: string;
  name: string;
  subscription_tier: string | null;
  created_at: string;
};

type SubscriptionRow = {
  organization_id: string;
  status: string;
};

type ProfileRow = {
  id: string;
  organization_id: string;
  full_name: string | null;
  email: string;
  last_login_at: string | null;
  created_at: string;
};

type OpportunityRow = {
  organization_id: string;
};

type OrgTableRow = {
  id: string;
  name: string;
  plan: string;
  createdAt: string;
  userCount: number;
  opportunityCount: number;
  lastActivity: string | null;
};

const statCardStyle = {
  backgroundColor: "#FFFFFF",
  borderRadius: "16px",
  overflow: "hidden",
  boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
};

function statTopBand(color: string) {
  return {
    height: "6px",
    backgroundColor: color,
  };
}

const sectionHeaderStyle = {
  fontSize: "13px",
  fontWeight: 700,
  color: "#FFFFFF",
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
  backgroundColor: "#2C4E3B",
  padding: "14px 20px",
  margin: 0,
};

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

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div style={statCardStyle}>
      <div style={statTopBand(color)} />
      <div style={{ padding: "20px" }}>
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
            fontSize: "28px",
            fontWeight: 900,
            color: "#0F172A",
            marginTop: "4px",
          }}
        >
          {value.toLocaleString()}
        </div>
      </div>
    </div>
  );
}

export default async function PlatformAdminPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { allowed } = await checkPermission(user.id, "owner", supabase);
  if (!allowed) {
    redirect("/dashboard?notice=owner_required");
  }

  const admin = createAdminClient();

  const [
    orgCountRes,
    userCountRes,
    activeSubsCountRes,
    opportunityCountRes,
    orgsRes,
    subscriptionsRes,
    profilesRes,
    opportunitiesRes,
    recentSignupsRes,
  ] = await Promise.all([
    admin.from("organizations").select("id", { count: "exact", head: true }),
    admin.from("profiles").select("id", { count: "exact", head: true }),
    admin
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("status", "active"),
    admin.from("opportunities").select("id", { count: "exact", head: true }),
    admin
      .from("organizations")
      .select("id, name, subscription_tier, created_at")
      .order("created_at", { ascending: false }),
    admin.from("subscriptions").select("organization_id, status"),
    admin
      .from("profiles")
      .select("id, organization_id, full_name, email, last_login_at, created_at"),
    admin.from("opportunities").select("organization_id"),
    admin
      .from("profiles")
      .select("id, organization_id, full_name, email, last_login_at, created_at")
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const totalOrganizations = orgCountRes.count ?? 0;
  const totalUsers = userCountRes.count ?? 0;
  const activeSubscriptions = activeSubsCountRes.count ?? 0;
  const totalOpportunities = opportunityCountRes.count ?? 0;

  const orgs = (orgsRes.data ?? []) as OrgRow[];
  const subscriptions = (subscriptionsRes.data ?? []) as SubscriptionRow[];
  const profiles = (profilesRes.data ?? []) as ProfileRow[];
  const opportunities = (opportunitiesRes.data ?? []) as OpportunityRow[];
  const recentSignups = (recentSignupsRes.data ?? []) as ProfileRow[];

  const planByOrg = new Map<string, string>();
  for (const sub of subscriptions) {
    // Multiple rows per org shouldn't happen, but prefer "active" if present.
    if (!planByOrg.has(sub.organization_id) || sub.status === "active") {
      planByOrg.set(sub.organization_id, sub.status);
    }
  }

  const userCountByOrg = new Map<string, number>();
  const lastActivityByOrg = new Map<string, string>();
  for (const p of profiles) {
    userCountByOrg.set(
      p.organization_id,
      (userCountByOrg.get(p.organization_id) ?? 0) + 1,
    );
    if (p.last_login_at) {
      const current = lastActivityByOrg.get(p.organization_id);
      if (!current || p.last_login_at > current) {
        lastActivityByOrg.set(p.organization_id, p.last_login_at);
      }
    }
  }

  const opportunityCountByOrg = new Map<string, number>();
  for (const o of opportunities) {
    opportunityCountByOrg.set(
      o.organization_id,
      (opportunityCountByOrg.get(o.organization_id) ?? 0) + 1,
    );
  }

  const orgRows: OrgTableRow[] = orgs.map((org) => ({
    id: org.id,
    name: org.name,
    plan: org.subscription_tier ?? "free",
    createdAt: org.created_at,
    userCount: userCountByOrg.get(org.id) ?? 0,
    opportunityCount: opportunityCountByOrg.get(org.id) ?? 0,
    lastActivity: lastActivityByOrg.get(org.id) ?? null,
  }));

  const orgNameById = new Map(orgs.map((o) => [o.id, o.name]));

  return (
    <div style={{ backgroundColor: "#C8D4DC", minHeight: "100vh", padding: "32px" }}>
      {/* Header */}
      <div
        style={{
          backgroundColor: "#2C4E3B",
          borderRadius: "20px",
          padding: "28px 40px",
          marginBottom: "24px",
          boxShadow: "0 8px 32px rgba(0,0,0,0.20)",
        }}
      >
        <h1
          style={{
            fontSize: "22px",
            fontWeight: 800,
            color: "#FFFFFF",
            letterSpacing: "-0.02em",
            margin: 0,
          }}
        >
          Platform Admin
        </h1>
        <p style={{ fontSize: "13px", color: "rgba(255,255,255,0.65)", margin: "4px 0 0 0" }}>
          Cross-tenant view. Every number here spans all organizations on Benavora.
        </p>
      </div>

      {/* Stat cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: "16px",
          marginBottom: "24px",
        }}
      >
        <StatCard label="Total Organizations" value={totalOrganizations} color="#3D6B50" />
        <StatCard label="Total Users" value={totalUsers} color="#6B48CC" />
        <StatCard label="Active Subscriptions" value={activeSubscriptions} color="#10B981" />
        <StatCard label="Total Opportunities" value={totalOpportunities} color="#F59E0B" />
      </div>

      {/* Organizations table */}
      <div
        style={{
          backgroundColor: "#FFFFFF",
          borderRadius: "16px",
          overflow: "hidden",
          boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
          marginBottom: "24px",
        }}
      >
        <div style={sectionHeaderStyle}>Organizations</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Plan</th>
                <th style={thStyle}>Created</th>
                <th style={thStyle}>Users</th>
                <th style={thStyle}>Opportunities</th>
                <th style={thStyle}>Last Activity</th>
              </tr>
            </thead>
            <tbody>
              {orgRows.length === 0 ? (
                <tr>
                  <td style={tdStyle} colSpan={6}>
                    No organizations yet.
                  </td>
                </tr>
              ) : (
                orgRows.map((org) => (
                  <tr key={org.id}>
                    <td style={tdStyle}>
                      <Link
                        href={`/admin/orgs/${org.id}`}
                        style={{ color: "#3D6B50", fontWeight: 600, textDecoration: "none" }}
                      >
                        {org.name}
                      </Link>
                    </td>
                    <td style={tdStyle}>{humanizeEnum(org.plan)}</td>
                    <td style={tdStyle}>{formatDate(org.createdAt)}</td>
                    <td style={tdStyle}>{org.userCount}</td>
                    <td style={tdStyle}>{org.opportunityCount}</td>
                    <td style={tdStyle}>
                      {org.lastActivity ? formatRelative(org.lastActivity) : "Never"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent signups */}
      <div
        style={{
          backgroundColor: "#FFFFFF",
          borderRadius: "16px",
          overflow: "hidden",
          boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
        }}
      >
        <div style={sectionHeaderStyle}>Recent Signups</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Email</th>
                <th style={thStyle}>Organization</th>
                <th style={thStyle}>Signed Up</th>
              </tr>
            </thead>
            <tbody>
              {recentSignups.length === 0 ? (
                <tr>
                  <td style={tdStyle} colSpan={4}>
                    No signups yet.
                  </td>
                </tr>
              ) : (
                recentSignups.map((p) => (
                  <tr key={p.id}>
                    <td style={tdStyle}>{p.full_name ?? "-"}</td>
                    <td style={tdStyle}>{p.email}</td>
                    <td style={tdStyle}>{orgNameById.get(p.organization_id) ?? "-"}</td>
                    <td style={tdStyle}>{formatDate(p.created_at)}</td>
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
