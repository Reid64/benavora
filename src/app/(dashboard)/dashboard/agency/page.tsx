import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/PageHeader";

// Agency command center (migration 176: agencies + agency_client_organizations).
// Never cache — reflects live session-scoped data (CLAUDE.md convention,
// matches src/app/(dashboard)/dashboard/page.tsx).
export const dynamic = "force-dynamic";

const FRAME = "#2C4E3B";
const CARD = "#FFFFFF";
const PANEL_IVORY = "#F8F5EE";
const TEXT_SECONDARY = "#64748B";
const TEXT_MUTED = "#94A3B8";

type AggregateRow = {
  client_organization_id: string;
  client_name: string;
  application_count: number;
  upcoming_deadline_count: number;
  stage_counts: Record<string, number> | null;
};

export default async function AgencyCommandCenterPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .single();

  const organizationId = profile?.organization_id as string | undefined;
  if (!organizationId) {
    return (
      <NoticePanel message="We couldn't resolve your organization. Please sign in again." />
    );
  }

  const { data: agency } = await supabase
    .from("agencies")
    .select("organization_id, plan, workspace_limit")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (!agency) {
    return (
      <NoticePanel message="This account is not an Agency-tier account. Contact sales@benavora.com to upgrade." />
    );
  }

  const { data: rows, error } = await supabase.rpc("agency_client_aggregate_counts", {
    p_agency_org_id: organizationId,
  });

  if (error) {
    return <NoticePanel message="Could not load command center data. Please try again shortly." />;
  }

  const clients = (rows ?? []) as AggregateRow[];

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "24px 20px", fontFamily: "'Plus Jakarta Sans',sans-serif" }}>
      <PageHeader
        title="Agency Command Center"
        description={`${agency.plan === "agency_scale" ? "Agency Scale" : "Agency"} plan — up to ${agency.workspace_limit} client workspaces, ${clients.length} currently linked.`}
        accent={FRAME}
      />

      {/* Deliberately simple: application/deadline/pipeline-stage counts only,
          the data genuinely safe to aggregate across client orgs today via
          agency_client_aggregate_counts() — no revenue totals, no staff
          activity, no document previews (those would require either
          weakening RLS or inventing numbers). */}

      {clients.length === 0 ? (
        <div
          style={{
            marginTop: "20px",
            borderRadius: "12px",
            border: "1px solid #E2E8F0",
            backgroundColor: PANEL_IVORY,
            padding: "20px",
            color: TEXT_SECONDARY,
            fontSize: "14px",
          }}
        >
          No client organizations are linked to this agency yet.
        </div>
      ) : (
        <div style={{ marginTop: "20px", display: "flex", flexDirection: "column", gap: "12px" }}>
          {clients.map((client) => (
            <div
              key={client.client_organization_id}
              style={{
                borderRadius: "12px",
                border: "1px solid #E2E8F0",
                backgroundColor: CARD,
                padding: "16px 20px",
                boxShadow: "0 2px 10px rgba(0,0,0,0.05)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "8px" }}>
                <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: FRAME }}>
                  {client.client_name}
                </h3>
                <div style={{ display: "flex", gap: "16px", fontSize: "13px", color: TEXT_SECONDARY }}>
                  <span>
                    <strong style={{ color: FRAME }}>{client.application_count}</strong> applications
                  </span>
                  <span>
                    <strong style={{ color: FRAME }}>{client.upcoming_deadline_count}</strong> deadlines in 30 days
                  </span>
                </div>
              </div>

              {client.stage_counts && Object.keys(client.stage_counts).length > 0 && (
                <div style={{ marginTop: "10px", display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  {Object.entries(client.stage_counts).map(([stage, count]) => (
                    <span
                      key={stage}
                      style={{
                        fontSize: "12px",
                        color: TEXT_MUTED,
                        backgroundColor: PANEL_IVORY,
                        borderRadius: "999px",
                        padding: "3px 10px",
                      }}
                    >
                      {stage.replace(/_/g, " ")}: {count}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NoticePanel({ message }: { message: string }) {
  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "24px 20px", fontFamily: "'Plus Jakarta Sans',sans-serif" }}>
      <div
        style={{
          borderRadius: "12px",
          border: "1px solid rgba(239,68,68,0.4)",
          backgroundColor: "rgba(239,68,68,0.1)",
          padding: "16px 20px",
          fontSize: "14px",
          color: "#2C4E3B",
        }}
      >
        {message}
      </div>
    </div>
  );
}
