// Maps organization + Knowledge Base data to a standardized SubmissionProfile
// consumed by the portal adapter system (src/lib/autoapply/portal-adapters.ts).
//
// Real-schema note: `organizations` (root supabase/migrations, migration 001)
// has no executive_director_name/email columns — this file sources those from
// knowledge_base (category/title text matching, same loose-matching
// convention already used by form-filler-agent.ts's buildFillData()) and,
// failing that, the org's owner profile (profiles.role = 'owner').
//
// Fabrication guard: Claude generation is used only for narrative fields
// (mission_statement, brief_description, program_name, program_description,
// budget_narrative, impact_statement) that have no verifiable external source.
// Factual fields (ein, website, phone, address, city, state, zip,
// executive_director_email) are never invented — if organizations/KB/profiles
// don't have a value, the field is returned as an empty string rather than a
// Claude guess. Inventing an EIN or contact email would be worse than leaving
// it blank for a human to fill in before submission. requested_amount is
// likewise never guessed — it's contextual per opportunity/application, so
// callers pass it in via `options.requestedAmount` and it defaults to 0.

import type { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

export interface OrgProfile {
  id: string;
  name: string;
  dba: string | null;
  ein: string | null;
  mission_statement: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  founder_name: string | null;
}

export interface SubmissionProfile {
  legal_name: string;
  ein: string;
  mission_statement: string; // <= 500 words
  brief_description: string; // <= 150 words
  program_name: string;
  program_description: string; // <= 300 words
  requested_amount: number;
  budget_narrative: string; // <= 200 words
  impact_statement: string; // <= 200 words
  website: string;
  executive_director_name: string;
  executive_director_email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zip: string;
}

interface KBRow {
  title: string | null;
  category: string | null;
  content: string | null;
}

interface ClassifiedKb {
  mission: string;
  program_description: string;
  program_name: string;
  budget_narrative: string;
  impact_statement: string;
  brief_description: string;
  contact_name: string;
  contact_email: string;
}

const EMPTY_KB: ClassifiedKb = {
  mission: '',
  program_description: '',
  program_name: '',
  budget_narrative: '',
  impact_statement: '',
  brief_description: '',
  contact_name: '',
  contact_email: '',
};

function classifyKbEntries(entries: KBRow[]): ClassifiedKb {
  const kb: ClassifiedKb = { ...EMPTY_KB };

  for (const entry of entries) {
    const cat = (entry.category ?? '').toLowerCase();
    const title = (entry.title ?? '').toLowerCase();
    const text = (entry.content ?? '').trim();
    if (!text) continue;

    if (cat.includes('mission') && !kb.mission) kb.mission = text;

    if (cat.includes('program')) {
      if (!kb.program_description) kb.program_description = text;
      if (!kb.program_name && entry.title) kb.program_name = entry.title.trim();
    }

    if (cat.includes('impact') && !kb.impact_statement) kb.impact_statement = text;

    if ((cat.includes('budget') || cat.includes('budget_justification')) && !kb.budget_narrative) {
      kb.budget_narrative = text;
    }

    if (
      !kb.brief_description &&
      (cat.includes('need_statement') || title.includes('brief') || title.includes('summary'))
    ) {
      kb.brief_description = text;
    }

    if (title.includes('director') || title.includes('contact')) {
      if (title.includes('email') && !kb.contact_email) {
        kb.contact_email = text;
      } else if (!kb.contact_name) {
        kb.contact_name = text;
      }
    }
  }

  return kb;
}

function buildContext(org: Partial<OrgProfile>, kb: ClassifiedKb): string {
  const lines = [
    `Legal name: ${org.dba || org.name || 'unknown'}`,
    org.mission_statement || kb.mission ? `Mission: ${org.mission_statement || kb.mission}` : null,
    org.city && org.state ? `Location: ${org.city}, ${org.state}` : null,
    kb.program_description ? `Program notes: ${kb.program_description.slice(0, 500)}` : null,
  ].filter((line): line is string => Boolean(line));
  return lines.join('\n');
}

async function generateNarrativeField(
  claude: Anthropic,
  fieldLabel: string,
  context: string,
  maxWords: number,
): Promise<string> {
  const message = await claude.messages
    .create({
      model: 'claude-sonnet-4-6',
      max_tokens: Math.min(1200, maxWords * 6),
      messages: [
        {
          role: 'user',
          content:
            `You are helping a 501(c)(3) nonprofit organization complete a corporate ` +
            `donation portal application. Write its ${fieldLabel} based only on the ` +
            `known facts below — do not invent specific statistics, dollar amounts, ` +
            `dates, or named individuals that aren't given.\n\n` +
            `Known facts:\n${context || 'No further details available.'}\n\n` +
            `Reply with ONLY the ${fieldLabel} text — no preamble, no markdown, no ` +
            `quotation marks. Maximum ${maxWords} words.`,
        },
      ],
    })
    .catch(() => null);

  if (!message) return '';
  const block = message.content[0];
  return block?.type === 'text' ? block.text.trim() : '';
}

/**
 * Builds a standardized SubmissionProfile for a given organization from its
 * `organizations` row and `knowledge_base`, filling any missing
 * narrative field via a targeted Claude call. See file header for the
 * fabrication guard on factual fields and requested_amount.
 */
export async function mapOrgToSubmissionProfile(
  supabase: SupabaseClient,
  organizationId: string,
  options?: { requestedAmount?: number },
): Promise<SubmissionProfile> {
  const { data: orgRow } = await supabase
    .from('organizations')
    .select(
      'id, name, dba, ein, mission_statement, website, phone, email, address_line1, address_line2, city, state, zip, founder_name',
    )
    .eq('id', organizationId)
    .maybeSingle();
  const org = (orgRow ?? {}) as Partial<OrgProfile>;

  const { data: kbRows } = await supabase
    .from('knowledge_base')
    .select('title, category, content')
    .eq('organization_id', organizationId);
  const kb = classifyKbEntries((kbRows ?? []) as KBRow[]);

  const { data: ownerRow } = await supabase
    .from('profiles')
    .select('full_name, email')
    .eq('organization_id', organizationId)
    .eq('role', 'owner')
    .limit(1)
    .maybeSingle();
  const owner = (ownerRow ?? {}) as Partial<{ full_name: string; email: string }>;

  const legal_name = (org.dba || org.name || '').trim();
  const ein = (org.ein ?? '').trim();
  const website = (org.website ?? '').trim();
  const phone = (org.phone ?? '').trim();
  const address = (org.address_line1 ?? '').trim();
  const city = (org.city ?? '').trim();
  const state = (org.state ?? '').trim();
  const zip = (org.zip ?? '').trim();
  const executive_director_name = (kb.contact_name || org.founder_name || owner.full_name || '').trim();
  const executive_director_email = (kb.contact_email || org.email || owner.email || '').trim();
  const requested_amount = options?.requestedAmount ?? 0;

  const claude = new Anthropic();
  const baseContext = buildContext(org, kb);

  const mission_statement =
    (org.mission_statement || kb.mission || '').trim() ||
    (await generateNarrativeField(claude, 'mission statement', baseContext, 500));

  const brief_description =
    kb.brief_description ||
    (await generateNarrativeField(
      claude,
      'brief 2-3 sentence organization description',
      `${baseContext}\nMission: ${mission_statement}`,
      150,
    ));

  const program_description =
    kb.program_description ||
    (await generateNarrativeField(
      claude,
      'program description',
      `${baseContext}\nMission: ${mission_statement}`,
      300,
    ));

  const program_name =
    kb.program_name ||
    (await generateNarrativeField(
      claude,
      'short program name (a few words, no punctuation)',
      `${baseContext}\nProgram description: ${program_description}`,
      8,
    ));

  const budget_narrative =
    kb.budget_narrative ||
    (await generateNarrativeField(
      claude,
      'budget narrative',
      `${baseContext}\nProgram: ${program_description}\nRequested amount: ${requested_amount || 'not yet specified'}`,
      200,
    ));

  const impact_statement =
    kb.impact_statement ||
    (await generateNarrativeField(
      claude,
      'impact statement describing expected outcomes',
      `${baseContext}\nProgram: ${program_description}`,
      200,
    ));

  return {
    legal_name,
    ein,
    mission_statement,
    brief_description,
    program_name,
    program_description,
    requested_amount,
    budget_narrative,
    impact_statement,
    website,
    executive_director_name,
    executive_director_email,
    phone,
    address,
    city,
    state,
    zip,
  };
}
