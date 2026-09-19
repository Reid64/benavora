#!/usr/bin/env node
// AR-17.4 drafting-family deep-dive.
//
// READ-ONLY. GET-only against PostgREST, same discipline as AR-17.1/17.2/17.3.
// No Claude call, no agent execution, no write. Pulls every stored output of
// every agent that generates prose or a document for a customer: the core
// LOI/narrative/budget-narrative/full-proposal path (draft_versions), the
// twin-powered autonomous draft path (applications.draft_content), the
// AutoApply personalized pitch (autoapply_submissions.personalized_pitch,
// pitch_cache), post-submission follow-up copy (notes), the legacy
// budget-builder note path (notes), and the B2B sales-outreach mail-merge
// (sales_sends) -- plus every organization/knowledge_base/twin/opportunity/
// funder_intelligence row needed to judge org-specificity, funder-specificity
// and fabrication against each org's own stored data.
//
// Usage: node test-evidence/drafting-family-deep-dive.mjs > test-evidence/drafting-family-raw.json

import { readFileSync } from "node:fs";

function loadEnv() {
  const env = readFileSync(".env.local", "utf8");
  const pick = (k) =>
    (new RegExp(`^${k}=(.+)$`, "m").exec(env)?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
  const url = pick("NEXT_PUBLIC_SUPABASE_URL") || pick("SUPABASE_URL");
  const key = pick("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Supabase credentials missing from .env.local");
  return { url, key };
}
const ENV = loadEnv();

async function pgGet(query, headers = {}) {
  const r = await fetch(`${ENV.url}/rest/v1/${query}`, {
    headers: { apikey: ENV.key, Authorization: `Bearer ${ENV.key}`, ...headers },
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`SELECT failed: ${query.split("?")[0]}: HTTP ${r.status} ${body.slice(0, 300)}`);
  }
  return r;
}
async function pgCount(query) {
  const r = await pgGet(query, { Prefer: "count=exact", Range: "0-0" });
  const n = Number((r.headers.get("content-range") ?? "").split("/")[1]);
  return Number.isFinite(n) ? n : 0;
}
async function pgSelect(query) {
  return (await pgGet(query)).json();
}
const uniq = (arr) => [...new Set(arr.filter((v) => v !== null && v !== undefined))];

// --- similarity: Jaccard over 5-word shingles, for cross-org / cross-draft comparison ---
function shingles(text, n = 5) {
  const words = String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const set = new Set();
  for (let i = 0; i + n <= words.length; i++) set.add(words.slice(i, i + n).join(" "));
  return set;
}
function jaccard(a, b) {
  const sa = shingles(a);
  const sb = shingles(b);
  if (sa.size === 0 || sb.size === 0) return { similarity: null, note: "text too short for 5-word shingles" };
  let inter = 0;
  for (const s of sa) if (sb.has(s)) inter++;
  const union = sa.size + sb.size - inter;
  return { similarity: inter / union, sharedShingles: inter, aShingles: sa.size, bShingles: sb.size };
}

async function main() {
  const out = { generatedAt: "2026-09-19", sections: {} };

  // ---------------------------------------------------------------------
  // 1. draft_versions -- narrative_drafting (generator.ts) + budget_builder
  //    (budget-agent.ts), both write here. template_type covers grant_narrative,
  //    donation_request_letter, budget_narrative, impact_statement,
  //    letter_of_inquiry, full_proposal.
  // ---------------------------------------------------------------------
  const draftVersions = await pgSelect(
    `draft_versions?select=*&order=created_at.desc&limit=500`,
  );
  out.sections.draft_versions = {
    total: draftVersions.length,
    byTemplateType: draftVersions.reduce((acc, r) => {
      acc[r.template_type] = (acc[r.template_type] ?? 0) + 1;
      return acc;
    }, {}),
    bySource: draftVersions.reduce((acc, r) => {
      acc[r.source] = (acc[r.source] ?? 0) + 1;
      return acc;
    }, {}),
    distinctOrgIds: uniq(draftVersions.map((r) => r.organization_id)),
    distinctOpportunityIds: uniq(draftVersions.map((r) => r.opportunity_id)),
    rows: draftVersions,
  };

  // Cross-draft similarity within each template_type (pairwise, across ALL
  // rows regardless of org, then flagged same-org vs different-org).
  const byTemplate = {};
  for (const r of draftVersions) {
    (byTemplate[r.template_type] ??= []).push(r);
  }
  const similarity = {};
  for (const [tpl, rows] of Object.entries(byTemplate)) {
    const pairs = [];
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i];
        const b = rows[j];
        const sim = jaccard(a.content, b.content);
        pairs.push({
          aId: a.id,
          bId: b.id,
          aOrg: a.organization_id,
          bOrg: b.organization_id,
          sameOrg: a.organization_id === b.organization_id,
          aOpportunity: a.opportunity_id,
          bOpportunity: b.opportunity_id,
          ...sim,
        });
      }
    }
    similarity[tpl] = pairs;
  }
  out.sections.draft_versions_similarity = similarity;

  // ---------------------------------------------------------------------
  // 2. applications -- ag-05-draft (twin-powered autonomous path) +
  //    manual/regular draft_content, application_cloning
  // ---------------------------------------------------------------------
  const applications = await pgSelect(
    `applications?select=id,organization_id,opportunity_id,draft_content,draft_source,twin_powered,twin_completeness,compliance_check_result,metadata,stage,created_at&order=created_at.desc&limit=200`,
  );
  const twinPowered = applications.filter((a) => a.twin_powered === true);
  const withDraft = applications.filter((a) => a.draft_content && a.draft_content.length > 0);
  out.sections.applications = {
    total: applications.length,
    withDraftContent: withDraft.length,
    twinPoweredCount: twinPowered.length,
    distinctOrgIds: uniq(applications.map((a) => a.organization_id)),
    draftSourceBreakdown: applications.reduce((acc, r) => {
      acc[r.draft_source ?? "null"] = (acc[r.draft_source ?? "null"] ?? 0) + 1;
      return acc;
    }, {}),
    twinPoweredRows: twinPowered,
    rowsWithDraftContent: withDraft,
  };

  // ---------------------------------------------------------------------
  // 3. autoapply_submissions -- pitch-personalizer + form-filler output
  // ---------------------------------------------------------------------
  const autoapplySubs = await pgSelect(
    `autoapply_submissions?select=*&order=created_at.desc&limit=200`,
  );
  out.sections.autoapply_submissions = {
    total: autoapplySubs.length,
    distinctOrgIds: uniq(autoapplySubs.map((r) => r.organization_id)),
    statusBreakdown: autoapplySubs.reduce((acc, r) => {
      acc[r.status ?? "null"] = (acc[r.status ?? "null"] ?? 0) + 1;
      return acc;
    }, {}),
    rows: autoapplySubs,
  };

  // ---------------------------------------------------------------------
  // 4. pitch_cache -- personalized pitch cache (org+funder+request_type)
  // ---------------------------------------------------------------------
  let pitchCache = [];
  try {
    pitchCache = await pgSelect(`pitch_cache?select=*&order=created_at.desc&limit=200`);
  } catch (e) {
    pitchCache = { error: e.message };
  }
  out.sections.pitch_cache = Array.isArray(pitchCache)
    ? {
        total: pitchCache.length,
        distinctOrgIds: uniq(pitchCache.map((r) => r.organization_id)),
        distinctFunderIds: uniq(pitchCache.map((r) => r.funder_id)),
        rows: pitchCache,
      }
    : pitchCache;

  // ---------------------------------------------------------------------
  // 5. notes -- follow_up_generator (FOLLOW_UP_NOTE_PREFIX) + budget_builder_worker
  //    ("**Budget**") + final_assembly ("**Package Assembly**")
  // ---------------------------------------------------------------------
  const followUpNotes = await pgSelect(
    `notes?select=*&content=like.*Follow-Up*&order=created_at.desc&limit=100`,
  );
  const budgetNotes = await pgSelect(
    `notes?select=*&content=like.**Budget***&order=created_at.desc&limit=100`,
  );
  out.sections.notes = {
    followUp: { total: followUpNotes.length, distinctOrgIds: uniq(followUpNotes.map((r) => r.organization_id)), rows: followUpNotes },
    budgetBuilderWorker: { total: budgetNotes.length, distinctOrgIds: uniq(budgetNotes.map((r) => r.organization_id)), rows: budgetNotes },
  };

  // ---------------------------------------------------------------------
  // 6. sales_sends -- B2B sales-outreach mail-merge (template substitution,
  //    NOT an LLM path) + its templates
  // ---------------------------------------------------------------------
  let salesSends = [];
  let salesSteps = [];
  try {
    salesSends = await pgSelect(`sales_sends?select=*&order=scheduled_for.desc&limit=50`);
    salesSteps = await pgSelect(`sales_campaign_steps?select=*&limit=50`);
  } catch (e) {
    salesSends = { error: e.message };
  }
  out.sections.sales_outreach = Array.isArray(salesSends)
    ? {
        totalSends: salesSends.length,
        distinctProspectIds: uniq(salesSends.map((r) => r.prospect_id)),
        steps: salesSteps,
        sampleSends: salesSends.slice(0, 10),
      }
    : salesSends;

  // ---------------------------------------------------------------------
  // 7. Org context for every org that appears above -- organizations,
  //    knowledge_base, organizational_digital_twins
  // ---------------------------------------------------------------------
  const allOrgIds = uniq([
    ...out.sections.draft_versions.distinctOrgIds,
    ...out.sections.applications.distinctOrgIds,
    ...out.sections.autoapply_submissions.distinctOrgIds,
    ...(Array.isArray(pitchCache) ? out.sections.pitch_cache.distinctOrgIds : []),
    ...out.sections.notes.followUp.distinctOrgIds,
    ...out.sections.notes.budgetBuilderWorker.distinctOrgIds,
  ]);

  const orgs = allOrgIds.length
    ? await pgSelect(
        `organizations?select=id,name,ein,tax_status,mission_statement,vision_statement,founding_date,service_area,target_population,annual_budget,total_staff,total_volunteers,email,contact_email,phone,address_line1,onboarding_completed,extended_profile&id=in.(${allOrgIds.join(",")})`,
      )
    : [];
  const kb = allOrgIds.length
    ? await pgSelect(`knowledge_base?select=*&organization_id=in.(${allOrgIds.join(",")})`)
    : [];
  const twins = allOrgIds.length
    ? await pgSelect(
        `organizational_digital_twins?select=*&organization_id=in.(${allOrgIds.join(",")})`,
      ).catch(() => [])
    : [];
  out.sections.orgContext = { orgs, knowledgeBase: kb, digitalTwins: twins };

  // ---------------------------------------------------------------------
  // 8. Opportunity/funder context for every opportunity_id referenced
  // ---------------------------------------------------------------------
  const allOppIds = uniq([
    ...out.sections.draft_versions.distinctOpportunityIds,
    ...applications.map((a) => a.opportunity_id),
  ]);
  const opportunities = allOppIds.length
    ? await pgSelect(
        `opportunities?select=id,name,source,source_type,category,description,eligibility_requirements,amount_min,amount_max,amount_available,deadline,application_method,url&id=in.(${allOppIds.join(",")})`,
      )
    : [];
  out.sections.opportunityContext = { opportunities };

  const funderIds = uniq([
    ...autoapplySubs.map((r) => r.funder_id),
    ...(Array.isArray(pitchCache) ? pitchCache.map((r) => r.funder_id) : []),
  ]);
  let funders = [];
  let funderIntel = [];
  try {
    funders = funderIds.length
      ? await pgSelect(`funders?select=*&id=in.(${funderIds.join(",")})`)
      : [];
  } catch (e) {
    funders = { error: e.message };
  }
  try {
    funderIntel = funderIds.length
      ? await pgSelect(`funder_intelligence?select=*&organization_id=in.(${allOrgIds.join(",") || "00000000-0000-0000-0000-000000000000"})`)
      : [];
  } catch (e) {
    funderIntel = { error: e.message };
  }
  out.sections.funderContext = { funders, funderIntelligence: funderIntel };

  // ---------------------------------------------------------------------
  // 9. AR-12 FormFillerAgent.buildFillData() production verification --
  //    real orgs (onboarding_completed=true, excluding obvious test-fixture
  //    naming) and whether ein/email/phone/address are actually populated
  //    on the columns buildFillData() now reads as its organizations-table
  //    fallback (organizations.ein/contact_email/phone/address_line1).
  // ---------------------------------------------------------------------
  const onboardedOrgs = await pgSelect(
    `organizations?select=id,name,email,contact_email,ein,phone,address_line1,mission_statement,onboarding_completed,created_at&onboarding_completed=eq.true&order=created_at.desc`,
  );
  out.sections.ar12FormFillerVerification = {
    totalOnboarded: onboardedOrgs.length,
    rows: onboardedOrgs,
  };

  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error("FATAL:", err.stack || err.message);
  process.exit(1);
});
