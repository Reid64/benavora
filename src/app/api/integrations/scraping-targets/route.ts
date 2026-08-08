// Scraping Targets — list and create endpoints.
//
// GET  — list all scraping_targets for the caller's org.
// POST — create a new target. Admins and owners only.
//
// Tier enforcement: Starter=0, Pro=5, Enterprise=25, Consultant=unlimited.
// The POST endpoint checks the org's subscription tier against the current
// target count before allowing creation.

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import {
  AllowlistBlockedError,
  assertDomainAllowed,
} from "@/lib/security/custom-connector-allowlist";

export const runtime = "nodejs";

const TIER_LIMITS: Record<string, number> = {
  starter: 0,
  professional: 5,
  enterprise: 25,
  consultant: Infinity,
};

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { data, error } = await supabase
    .from("scraping_targets")
    .select(
      "id, url, description, scrape_schedule, is_active, last_scraped_at, last_success_at, failure_count, created_at",
    )
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true });

  if (error) {
    return jsonError("Failed to load scraping targets.", "db_error", 500);
  }

  return NextResponse.json({ targets: data ?? [] });
}

export async function POST(request: Request) {
  const gate = await requireRole("admin");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body.", "invalid_body", 400);
  }

  const { url, description, scrape_schedule } = (body ?? {}) as Record<
    string,
    unknown
  >;

  if (typeof url !== "string" || !url.trim()) {
    return jsonError("url is required.", "missing_field", 400);
  }

  try {
    await assertDomainAllowed(supabase, organizationId, url.trim());
  } catch (err) {
    if (err instanceof AllowlistBlockedError) {
      return jsonError(err.message, "domain_not_allowlisted", 403);
    }
    return jsonError("Could not verify the domain allowlist.", "allowlist_check_failed", 500);
  }

  const validSchedules = ["hourly", "daily", "weekly", "monthly"];
  const resolvedSchedule =
    typeof scrape_schedule === "string" &&
    validSchedules.includes(scrape_schedule)
      ? scrape_schedule
      : "weekly";

  // Check org tier limit before creating (BEHAVIORAL_CONTRACTS §21).
  const { data: org } = await supabase
    .from("organizations")
    .select("subscription_tier")
    .eq("id", organizationId)
    .single();

  const tier = (org?.subscription_tier as string | null) ?? "starter";
  const limit = TIER_LIMITS[tier] ?? 0;

  if (isFinite(limit)) {
    const { count } = await supabase
      .from("scraping_targets")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId);

    if ((count ?? 0) >= limit) {
      return jsonError(
        `Your ${tier} plan allows up to ${limit} scraping target${limit === 1 ? "" : "s"}. Upgrade to add more.`,
        "tier_limit_exceeded",
        403,
      );
    }
  }

  const { data, error } = await supabase
    .from("scraping_targets")
    .insert({
      organization_id: organizationId,
      url: url.trim(),
      description:
        typeof description === "string" && description.trim()
          ? description.trim()
          : null,
      scrape_schedule: resolvedSchedule,
      is_active: true,
      failure_count: 0,
    })
    .select(
      "id, url, description, scrape_schedule, is_active, failure_count, created_at",
    )
    .single();

  if (error) {
    return jsonError("Failed to create the scraping target.", "db_error", 500);
  }

  return NextResponse.json({ target: data }, { status: 201 });
}
