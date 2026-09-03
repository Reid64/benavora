import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/role-gate";
import { LiveClock } from "@/components/command-center/LiveClock";
import { CommandCenterLive } from "@/components/command-center/CommandCenterLive";
import { getCommandCenterSnapshot } from "@/lib/command-center/snapshot";

// Platform Command Center (PLATFORM_VISION_ARCHITECTURE.md Pillar 16). Owner-only
// (BLUEPRINT §3.2 role hierarchy — owner is the top rank; this codebase has no
// separate super_admin role). Unlike the org-scoped /dashboard, every query below
// uses the service-role client with no organization_id filter — by design, not an
// oversight — mirroring the existing cross-tenant precedent in /admin/page.tsx and
// /api/admin/monitor.
export const dynamic = "force-dynamic";

const quickActions = [
  { label: "Platform Admin", href: "/admin" },
  { label: "Organizations", href: "/admin/orgs" },
  { label: "System Health", href: "/admin/system" },
  { label: "System Monitor", href: "/admin/monitor" },
  { label: "Audit Log", href: "/admin/audit-log" },
  { label: "Sales Outreach", href: "/admin/sales-outreach" },
  { label: "AutoApply Ops", href: "/admin/autoapply-ops" },
  { label: "Agent Improvements", href: "/admin/improvements" },
];

export default async function CommandCenterPage() {
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

  const snapshot = await getCommandCenterSnapshot();

  return (
    <div style={{ minHeight: "100vh", padding: "32px" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: "24px",
        }}
      >
        <h1
          style={{
            fontSize: "28px",
            fontWeight: 800,
            color: "#2C4E3B",
            letterSpacing: "-0.02em",
            margin: 0,
          }}
        >
          Platform Command Center
        </h1>
        <LiveClock />
      </div>

      <CommandCenterLive initialSnapshot={snapshot} />

      {/* Admin Quick Actions */}
      <div
        style={{
          backgroundColor: "#C49A4F",
          borderRadius: "16px",
          padding: "24px",
          marginTop: "20px",
          boxShadow: "0 4px 16px rgba(184,138,46,0.3)",
        }}
      >
        <h3 style={{ fontSize: "14px", fontWeight: 700, color: "#2C4E3B", marginBottom: "16px" }}>
          Admin Quick Actions
        </h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px" }}>
          {quickActions.map((action) => (
            <Link
              key={action.href}
              href={action.href}
              style={{
                display: "block",
                padding: "12px 16px",
                backgroundColor: "rgba(44,78,59,0.15)",
                border: "1px solid rgba(44,78,59,0.25)",
                borderRadius: "8px",
                color: "#2C4E3B",
                fontSize: "13px",
                fontWeight: 600,
                textAlign: "center",
                textDecoration: "none",
              }}
            >
              {action.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
