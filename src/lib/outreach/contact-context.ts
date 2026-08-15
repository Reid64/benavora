// Shared context loader for the three contact-scoped outreach generators
// (LinkedIn, call, mail — row #77). Mirrors the pull pattern already used by
// src/app/api/intelligence/outreach/generate/route.ts (row #118), adapted to
// the CRM contacts/funders tables instead of corporate_prospects.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface ContactOutreachContext {
  contact: {
    id: string;
    name: string;
    title: string | null;
    email: string | null;
    phone: string | null;
    relationship: string | null;
    last_contacted_at: string | null;
  };
  funder: {
    id: string;
    name: string;
    category: string | null;
    description: string | null;
    notes: string | null;
  } | null;
  organization: {
    name: string;
    mission_statement: string | null;
    address_line1: string | null;
    address_line2: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    phone: string | null;
    email: string | null;
  };
  impact: string;
  programDescription: string;
}

/**
 * Loads a contact plus its funder, the caller's org profile, and recent
 * impact/program_description KB entries — everything the three Claude
 * prompts need to write genuinely personalized (not templated) content.
 * `client` should be an admin client so org-scoping is done explicitly via
 * `organizationId`, matching row #118's convention.
 */
export async function loadContactOutreachContext(
  client: SupabaseClient,
  contactId: string,
  organizationId: string,
): Promise<ContactOutreachContext | null> {
  const contactRes = await client
    .from("contacts")
    .select("id, name, title, email, phone, relationship, last_contacted_at, funder_id, organization_id")
    .eq("id", contactId)
    .maybeSingle();

  if (contactRes.error || !contactRes.data || contactRes.data.organization_id !== organizationId) {
    return null;
  }
  const contact = contactRes.data;

  const [funderRes, orgRes, kbRes] = await Promise.all([
    client
      .from("funders")
      .select("id, name, category, description, notes")
      .eq("id", contact.funder_id)
      .maybeSingle(),
    client
      .from("organizations")
      .select("name, mission_statement, address_line1, address_line2, city, state, zip, phone, email")
      .eq("id", organizationId)
      .single(),
    client
      .from("knowledge_base")
      .select("category, content")
      .eq("organization_id", organizationId)
      .in("category", ["impact", "program_description"])
      .order("updated_at", { ascending: false })
      .limit(4),
  ]);

  if (orgRes.error || !orgRes.data) return null;

  const kbRows = (kbRes.data ?? []) as { category: string; content: string }[];
  const impact = kbRows.find((r) => r.category === "impact")?.content ?? "";
  const programDescription = kbRows.find((r) => r.category === "program_description")?.content ?? "";

  return {
    contact: {
      id: contact.id,
      name: contact.name,
      title: contact.title,
      email: contact.email,
      phone: contact.phone,
      relationship: contact.relationship,
      last_contacted_at: contact.last_contacted_at,
    },
    funder: funderRes.data
      ? {
          id: funderRes.data.id,
          name: funderRes.data.name,
          category: funderRes.data.category,
          description: funderRes.data.description,
          notes: funderRes.data.notes,
        }
      : null,
    organization: orgRes.data,
    impact,
    programDescription,
  };
}

export function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}
