// POST /api/donor-discovery/prospects/[id]/route-to-email — corporate
// donation pipeline handoff (discover/page.tsx prospect cards). Reads the
// prospect's shared directory enrichment for a decision-maker contact email,
// then enrolls it in a "cold_donation_request" cold-outreach campaign —
// find-or-create an `email_templates` row of that type, find-or-create an
// `email_campaign_sequences` row (the app's real campaigns table,
// src/lib/email/sequence-engine.ts) with one immediate step, then enrolls
// the contact via `email_sequence_enrollments` with merge-field variables
// {org_name, prospect_name, prospect_industry}.
// organization_id is always derived from the authenticated session, never the
// request body (Behavioral Contracts §2).

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { naicsLabel } from "@/lib/donor-discovery/naics-labels";
import { humanizeEnum } from "@/lib/utils/formatters";

export const runtime = "nodejs";

type RouteContext = { params: { id: string } };

const TEMPLATE_TYPE = "cold_donation_request";
const SEQUENCE_NAME = "Donor Discovery — Cold Donation Requests";

const DEFAULT_SUBJECT = "Partnering with {org_name} — a quick ask for {prospect_industry} businesses like yours";
const DEFAULT_BODY = `Hi there,

I'm reaching out on behalf of {org_name}. We work alongside {prospect_industry} businesses in our community, and we're reaching out because we believe your company shares our commitment to giving back locally.

We'd love to share more about our mission and explore whether a donation, sponsorship, or in-kind contribution might be a fit for your giving priorities this year.

Would you be open to a short call or email exchange?

Thank you for considering it,
{org_name}`;

interface DecisionContact {
  name?: string;
  title?: string;
  email?: string;
  phone?: string;
}

function isUuid(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}

function isValidEmail(v: unknown): v is string {
  return typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

export async function POST(_request: Request, { params }: RouteContext) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId, userId } = gate;

  const { id } = params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Prospect not found." }, { status: 404 });
  }

  const { data: prospect, error } = await supabase
    .from("donor_discovery_prospects")
    .select("id, directory:donor_discovery_directory(legal_name, dba_name, naics_codes, civic_kind, enrichment)")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error || !prospect) {
    return NextResponse.json({ error: "Prospect not found." }, { status: 404 });
  }

  const directory = prospect.directory as unknown as {
    legal_name: string;
    dba_name: string | null;
    naics_codes: string[] | null;
    civic_kind: string | null;
    enrichment: unknown;
  } | null;

  if (!directory) {
    return NextResponse.json({ error: "Prospect has no directory record." }, { status: 500 });
  }

  const enrichment =
    directory.enrichment && typeof directory.enrichment === "object" && !Array.isArray(directory.enrichment)
      ? (directory.enrichment as Record<string, unknown>)
      : {};

  const decisionContacts = Array.isArray(enrichment.decision_contacts)
    ? (enrichment.decision_contacts as DecisionContact[])
    : [];
  const contact = decisionContacts.find((c) => isValidEmail(c?.email));

  if (!contact || !isValidEmail(contact.email)) {
    return NextResponse.json(
      { error: "No decision-maker contact email found for this prospect." },
      { status: 422 },
    );
  }
  const contactEmail = contact.email.trim();

  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", organizationId)
    .single();

  if (orgError || !org) {
    return NextResponse.json({ error: "Could not load your organization." }, { status: 500 });
  }

  const orgName = org.name;
  const prospectName = directory.dba_name?.trim() || directory.legal_name;
  const prospectIndustry = directory.naics_codes?.[0]
    ? naicsLabel(directory.naics_codes[0])
    : humanizeEnum(directory.civic_kind) !== "-"
      ? humanizeEnum(directory.civic_kind)
      : "local business";

  // Find-or-create the cold_donation_request template for this org.
  const { data: existingTemplate } = await supabase
    .from("email_templates")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("template_type", TEMPLATE_TYPE)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  let templateId = existingTemplate?.id ?? null;
  if (!templateId) {
    const { data: newTemplate, error: templateError } = await supabase
      .from("email_templates")
      .insert({
        organization_id: organizationId,
        name: "Cold Donation Request",
        template_type: TEMPLATE_TYPE,
        subject: DEFAULT_SUBJECT,
        body: DEFAULT_BODY,
        variables: ["org_name", "prospect_name", "prospect_industry"],
        is_active: true,
        created_by: userId,
      })
      .select("id")
      .single();

    if (templateError || !newTemplate) {
      return NextResponse.json({ error: "Failed to create the outreach template." }, { status: 500 });
    }
    templateId = newTemplate.id;
  }

  // Find-or-create the campaign sequence this template's step lives under.
  const { data: existingSequence } = await supabase
    .from("email_campaign_sequences")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("name", SEQUENCE_NAME)
    .maybeSingle();

  let sequenceId = existingSequence?.id ?? null;
  if (!sequenceId) {
    const { data: newSequence, error: sequenceError } = await supabase
      .from("email_campaign_sequences")
      .insert({
        organization_id: organizationId,
        name: SEQUENCE_NAME,
        description: "Cold outreach to Donor Discovery prospects requesting a corporate donation.",
        trigger_type: "manual",
        status: "active",
        created_by: userId,
      })
      .select("id")
      .single();

    if (sequenceError || !newSequence) {
      return NextResponse.json({ error: "Failed to create the outreach campaign." }, { status: 500 });
    }
    sequenceId = newSequence.id;

    const { error: stepError } = await supabase.from("email_sequence_steps").insert({
      sequence_id: sequenceId,
      step_number: 1,
      template_id: templateId,
      delay_days: 0,
      delay_hours: 0,
      condition_type: "always",
    });

    if (stepError) {
      return NextResponse.json({ error: "Failed to create the outreach campaign step." }, { status: 500 });
    }
  }

  const variables = {
    org_name: orgName,
    prospect_name: prospectName,
    prospect_industry: prospectIndustry,
  };

  const { data: enrollment, error: enrollError } = await supabase
    .from("email_sequence_enrollments")
    .insert({
      organization_id: organizationId,
      sequence_id: sequenceId,
      contact_id: null,
      funder_id: null,
      email_address: contactEmail,
      current_step: 0,
      status: "active",
      next_send_at: new Date().toISOString(),
      variables,
    })
    .select("id")
    .single();

  // 23505 = unique_violation — already enrolled in this sequence, not an error.
  if (enrollError && (enrollError as { code?: string }).code !== "23505") {
    return NextResponse.json({ error: "Failed to add this prospect to the campaign." }, { status: 500 });
  }

  return NextResponse.json({ campaignId: sequenceId, enrollmentId: enrollment?.id ?? null });
}
