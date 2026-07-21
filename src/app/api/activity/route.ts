import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { humanizeEnum } from "@/lib/utils/formatters";

// Organization activity feed — org-scoped (unlike /api/admin/audit-log,
// visible to every role, not just owner/admin). Combines the four event
// sources named in the build task (agent runs, drafts created, opportunities
// found, alerts triggered) into one timeline, newest first.

export const runtime = "nodejs";

const PER_SOURCE_LIMIT = 20;
const TOTAL_LIMIT = 50;

type ActivityType = "agent_run" | "draft" | "opportunity" | "alert";

type ActivityItem = {
  id: string;
  type: ActivityType;
  title: string;
  description: string | null;
  createdAt: string;
  href: string | null;
};

type AgentRunRow = {
  id: string;
  agent_type: string;
  status: string | null;
  output_summary: string | null;
  created_at: string;
};

type ApplicationRow = {
  id: string;
  opportunity_id: string | null;
  draft_source: string | null;
  created_at: string;
};

type OpportunityRow = {
  id: string;
  name: string;
  category: string;
  discovered_at: string | null;
};

type AlertRow = {
  id: string;
  title: string;
  message: string | null;
  alert_type: string | null;
  created_at: string;
};

export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const [agentRunsRes, draftsRes, opportunitiesRes, alertsRes] = await Promise.all([
    supabase
      .from("agent_runs")
      .select("id, agent_type, status, output_summary, created_at")
      .eq("organization_id", organizationId)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(PER_SOURCE_LIMIT),
    supabase
      .from("applications")
      .select("id, opportunity_id, draft_source, created_at")
      .eq("organization_id", organizationId)
      .eq("auto_generated", true)
      .order("created_at", { ascending: false })
      .limit(PER_SOURCE_LIMIT),
    supabase
      .from("opportunities")
      .select("id, name, category, discovered_at")
      .eq("organization_id", organizationId)
      .order("discovered_at", { ascending: false })
      .limit(PER_SOURCE_LIMIT),
    supabase
      .from("alerts")
      .select("id, title, message, alert_type, created_at")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(PER_SOURCE_LIMIT),
  ]);

  const agentRuns = (agentRunsRes.data ?? []) as AgentRunRow[];
  const drafts = (draftsRes.data ?? []) as ApplicationRow[];
  const opportunities = (opportunitiesRes.data ?? []) as OpportunityRow[];
  const alerts = (alertsRes.data ?? []) as AlertRow[];

  const items: ActivityItem[] = [
    ...agentRuns.map((r): ActivityItem => ({
      id: `agent_run:${r.id}`,
      type: "agent_run",
      title: `${humanizeEnum(r.agent_type)} ran`,
      description: r.output_summary,
      createdAt: r.created_at,
      href: null,
    })),
    ...drafts.map((r): ActivityItem => ({
      id: `draft:${r.id}`,
      type: "draft",
      title: "Draft generated",
      description:
        r.draft_source === "ai_generated" ? "AI-generated draft awaiting review" : null,
      createdAt: r.created_at,
      href: `/applications/${r.id}`,
    })),
    ...opportunities
      .filter((r) => r.discovered_at)
      .map((r): ActivityItem => ({
        id: `opportunity:${r.id}`,
        type: "opportunity",
        title: `Opportunity found: ${r.name}`,
        description: humanizeEnum(r.category),
        createdAt: r.discovered_at as string,
        href: `/opportunities/${r.id}`,
      })),
    ...alerts.map((r): ActivityItem => ({
      id: `alert:${r.id}`,
      type: "alert",
      title: r.title,
      description: r.message,
      createdAt: r.created_at,
      href: "/alerts",
    })),
  ];

  items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return NextResponse.json({ items: items.slice(0, TOTAL_LIMIT) });
}
