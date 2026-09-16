import { timingSafeEqual } from "crypto";

import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { isPilEnabledForOrg } from "@/lib/feature-flags/pil";
import { createResearchRun } from "@/lib/pil/workflow";

// POST /api/discovery/pil-trigger
//
// Webhook receiver: Discovery (the existing donor-prospect import system) calls
// this after importing a prospect, so the Prospect Intelligence Layer can pick
// it up. Creates a pil_prospects row, then a matching pil_research_runs row.
//
// PIL_WIRING_AUDIT.md (2026-09-15): an earlier version of this route relied on
// a migration 170 DB trigger (pil_create_research_run_on_prospect_insert)
// supposedly auto-creating that pil_research_runs row. Live pg_trigger catalog
// check found no such trigger exists -- every prospect this route ever created
// had no research run at all, so nothing was ever queued for enrichment
// despite this route returning status "queued_for_enrichment". Fixed by
// creating the run explicitly here instead of trusting a nonexistent trigger.
// Kept fast/non-blocking on purpose: this does not await orchestrateResearchRun
// itself (Discovery may call this once per imported prospect, in bulk) --
// /api/cron/pil-research's poller picks the new "planning" row up within
// its 10-minute schedule.
//
// SECURITY: this is a system-to-system endpoint with no user session, so it is
// gated by a static shared secret (mirrors CRON_SECRET / cron/campaigns) rather
// than requireRole(). It uses the service-role admin client, which bypasses
// RLS, so organization_id from the request body is verified against a real
// `organizations` row before it's trusted -- RLS won't catch a forged value
// here the way it would for a user-session route.
//
// Discovery may retry a delivery (network blip, timeout, etc.), so this is
// idempotent: discovery_prospect_id is recorded as a pil_entity_aliases row
// (alias_type 'external_id', source 'discovery') and looked up first. A retry
// for the same discovery_prospect_id returns the existing prospect instead of
// creating a duplicate (and a duplicate research run).
//
// Schema note: pil_prospects has no email/website/categories columns (see
// migration 150). email is preserved as a pil_entity_aliases row (alias_type
// 'email'); website and categories have no home in the current schema and are
// dropped here rather than guessed into the wrong table -- flag to product/eng
// if Discovery needs those preserved.

export const runtime = "nodejs";

const VALID_ENTITY_TYPES = [
  "individual",
  "family_foundation",
  "private_foundation",
  "community_foundation",
  "corporate_foundation",
  "corporation",
  "executive",
  "business_owner",
  "board_member",
  "trustee",
  "wealth_holder",
  "community_leader",
  "institutional_funder",
  "other",
] as const;
type EntityType = (typeof VALID_ENTITY_TYPES)[number];

function isValidEntityType(v: unknown): v is EntityType {
  return typeof v === "string" && (VALID_ENTITY_TYPES as readonly string[]).includes(v);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/** Collapse whitespace and lowercase, for trigram-index dedup matching against display_name. */
function toCanonicalName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function isAuthorized(request: Request): boolean {
  const secret = process.env.DISCOVERY_WEBHOOK_SECRET;
  if (!secret) return false;

  const authHeader = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;

  const authBuf = Buffer.from(authHeader);
  const expectedBuf = Buffer.from(expected);
  return authBuf.length === expectedBuf.length && timingSafeEqual(authBuf, expectedBuf);
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return jsonError("Unauthorized.", 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON.", 400);
  }

  const { discovery_prospect_id, organization_id, prospect_data } = (body ?? {}) as Record<
    string,
    unknown
  >;

  if (typeof discovery_prospect_id !== "string" || !discovery_prospect_id) {
    return jsonError("discovery_prospect_id is required.", 400);
  }
  if (!isUuid(organization_id)) {
    return jsonError("organization_id must be a valid UUID.", 400);
  }
  if (typeof prospect_data !== "object" || prospect_data === null) {
    return jsonError("prospect_data is required.", 400);
  }

  const data = prospect_data as Record<string, unknown>;
  const name = data.name;
  if (typeof name !== "string" || !name.trim()) {
    return jsonError("prospect_data.name is required.", 400);
  }
  if (!isValidEntityType(data.entity_type)) {
    return jsonError(
      `prospect_data.entity_type must be one of: ${VALID_ENTITY_TYPES.join(", ")}`,
      400,
    );
  }
  const email = typeof data.email === "string" && data.email ? data.email : null;

  const admin = createAdminClient();

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .select("id")
    .eq("id", organization_id)
    .maybeSingle();
  if (orgError) {
    return jsonError("Could not verify organization.", 500);
  }
  if (!org) {
    return jsonError("organization_id does not match a known organization.", 400);
  }

  if (!(await isPilEnabledForOrg(organization_id))) {
    return jsonError("PIL is not enabled for this organization.", 403);
  }

  // Idempotency: a prior delivery for this discovery_prospect_id already has a prospect.
  const { data: existingAlias, error: aliasLookupError } = await admin
    .from("pil_entity_aliases")
    .select("prospect_id")
    .eq("organization_id", organization_id)
    .eq("alias_type", "external_id")
    .eq("alias_value", discovery_prospect_id)
    .eq("source", "discovery")
    .maybeSingle();
  if (aliasLookupError) {
    return jsonError("Could not check for an existing prospect.", 500);
  }
  if (existingAlias) {
    return NextResponse.json({
      prospect_id: existingAlias.prospect_id,
      status: "already_queued",
    });
  }

  const { data: prospect, error: prospectError } = await admin
    .from("pil_prospects")
    .insert({
      organization_id,
      entity_type: data.entity_type,
      display_name: name.trim(),
      canonical_name: toCanonicalName(name),
      source_of_record: "discovery",
    })
    .select("id")
    .single();

  if (prospectError || !prospect) {
    return jsonError(prospectError?.message ?? "Could not create prospect.", 400);
  }

  const aliasRows = [
    {
      organization_id,
      prospect_id: prospect.id,
      alias_type: "external_id",
      alias_value: discovery_prospect_id,
      source: "discovery",
    },
    ...(email
      ? [
          {
            organization_id,
            prospect_id: prospect.id,
            alias_type: "email",
            alias_value: email,
            source: "discovery",
          },
        ]
      : []),
  ];
  const { error: aliasInsertError } = await admin.from("pil_entity_aliases").insert(aliasRows);
  if (aliasInsertError) {
    // The prospect (and its auto-created research run, migration 170) already exist;
    // losing the alias only degrades future idempotency/dedup, not this request's result.
    console.error("pil-trigger: failed to record discovery alias", aliasInsertError);
  }

  const run = await createResearchRun({
    orgId: organization_id,
    prospectId: prospect.id,
    runType: "discovery_import",
    goal: `Deep research on prospect ${prospect.id} (imported from Discovery: ${name.trim()})`,
    triggeredBy: "discovery-webhook",
  });

  return NextResponse.json({
    prospect_id: prospect.id,
    research_run_id: run.id,
    status: "queued_for_enrichment",
  });
}
