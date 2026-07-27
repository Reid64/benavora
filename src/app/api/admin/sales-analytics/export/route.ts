import { requireRole } from "@/lib/auth/role-gate";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function escapeCSV(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCSV(rows: Record<string, unknown>[]): string {
  const first = rows[0];
  if (!first) return "";
  const headers = Object.keys(first);
  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((h) => escapeCSV(row[h])).join(",")),
  ];
  return lines.join("\n");
}

function getPeriodStart(period: string | null): string | null {
  if (!period) return null;
  const now = new Date();
  switch (period) {
    case "7d":
      now.setDate(now.getDate() - 7);
      return now.toISOString();
    case "30d":
      now.setDate(now.getDate() - 30);
      return now.toISOString();
    case "90d":
      now.setDate(now.getDate() - 90);
      return now.toISOString();
    default:
      return null;
  }
}

export async function GET(request: Request) {
  const gate = await requireRole("owner");
  if ("error" in gate) return gate.error;

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") ?? "sends";
  const campaignId = searchParams.get("campaign_id");
  const periodStart = getPeriodStart(searchParams.get("period"));

  const supabase = createAdminClient();

  let csvContent = "";
  let filename = `${type}-export.csv`;

  if (type === "sends") {
    let query = supabase
      .from("sales_sends")
      .select(
        "id, campaign_id, prospect_id, from_address, to_address, subject, status, sent_at, opened_at, replied_at, bounced_at, unsubscribed_at, bounce_type, error_message, created_at",
      )
      .order("sent_at", { ascending: false });

    if (campaignId) query = query.eq("campaign_id", campaignId);
    if (periodStart) query = query.gte("sent_at", periodStart);

    const { data, error } = await query;
    if (error) return new Response("Failed to export sends.", { status: 500 });
    csvContent = toCSV((data ?? []) as unknown as Record<string, unknown>[]);
    filename = "sends-export.csv";
  } else if (type === "prospects") {
    const { data, error } = await supabase
      .from("prospects")
      .select(
        "id, org_name, email, state, city, status, suppressed, suppressed_reason, suppressed_at, last_contacted_at, total_emails_sent, has_replied, has_converted, created_at",
      )
      .order("created_at", { ascending: false });

    if (error) return new Response("Failed to export prospects.", { status: 500 });
    csvContent = toCSV((data ?? []) as unknown as Record<string, unknown>[]);
    filename = "prospects-export.csv";
  } else if (type === "suppression") {
    const { data, error } = await supabase
      .from("suppression_list")
      .select("id, email, reason, source, added_at")
      .order("added_at", { ascending: false });

    if (error) return new Response("Failed to export suppression list.", { status: 500 });
    csvContent = toCSV((data ?? []) as unknown as Record<string, unknown>[]);
    filename = "suppression-export.csv";
  } else if (type === "campaigns") {
    const { data, error } = await supabase
      .from("sales_campaigns")
      .select(
        "id, name, description, status, daily_send_target, total_sent, total_opened, total_replied, total_unsubscribed, total_bounced, created_at, updated_at",
      )
      .order("created_at", { ascending: false });

    if (error) return new Response("Failed to export campaigns.", { status: 500 });
    csvContent = toCSV((data ?? []) as unknown as Record<string, unknown>[]);
    filename = "campaigns-export.csv";
  } else {
    return new Response("Invalid export type. Must be one of: sends, prospects, suppression, campaigns.", {
      status: 400,
    });
  }

  return new Response(csvContent, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
