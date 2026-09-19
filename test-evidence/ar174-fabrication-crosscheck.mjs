#!/usr/bin/env node
// AR-17.4 fabrication cross-check. READ-ONLY, re-derives the three headline
// findings of AGENT_OUTPUT_QUALITY_DRAFTING.md directly from
// drafting-family-raw.json (itself produced by drafting-family-deep-dive.mjs)
// so each claim can be re-run rather than taken on faith.
//
// Usage: node test-evidence/ar174-fabrication-crosscheck.mjs

import { readFileSync } from "node:fs";

const raw = JSON.parse(readFileSync("test-evidence/drafting-family-raw.json", "utf8"));
const s = raw.sections;

console.log("=== 1. Beta Org 1 (e8494d81) fabrication check ===");
const betaOrg = s.orgContext.orgs.find((o) => o.id === "e8494d81-3961-4542-87bf-57896e2664da");
const betaKb = s.orgContext.knowledgeBase.filter((k) => k.organization_id === "e8494d81-3961-4542-87bf-57896e2664da");
const betaDraft = s.draft_versions.rows.find((r) => r.organization_id === "e8494d81-3961-4542-87bf-57896e2664da");
console.log(`org mission_statement: ${JSON.stringify(betaOrg?.mission_statement)}`);
console.log(`knowledge_base rows for this org: ${betaKb.length}`);
console.log(`draft confidence_score: ${betaDraft?.confidence_score}  knowledge_sources: ${JSON.stringify(betaDraft?.knowledge_sources)}`);
const invented = ["94% housing retention", "twelve years", "340 affordable housing units", "28 FTE"];
for (const phrase of invented) {
  console.log(`  content mentions "${phrase.split(" ").slice(-2).join(" ")}": ${betaDraft?.content.toLowerCase().includes(phrase.toLowerCase().split(" ").slice(-2).join(" "))}`);
}

console.log("\n=== 2. FAITH Foundation (b1ab7402) fabricated phone number across the twin-powered/autonomous path ===");
const realPhone = s.orgContext.orgs.find((o) => o.id === "b1ab7402-dfc2-4712-869f-70ea3566cc1d")?.phone;
console.log(`Real phone on file (organizations.phone): ${realPhone}`);
const autonomousRows = s.draft_versions.rows.filter(
  (r) => r.organization_id === "b1ab7402-dfc2-4712-869f-70ea3566cc1d" && r.source === "autonomous",
);
const manualRows = s.draft_versions.rows.filter(
  (r) => r.organization_id === "b1ab7402-dfc2-4712-869f-70ea3566cc1d" && r.source !== "autonomous",
);
const phoneRe = /(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/g;
console.log(`autonomous-path rows: ${autonomousRows.length}`);
for (const r of autonomousRows) {
  const found = [...new Set(r.content.match(phoneRe) ?? [])];
  console.log(`  ${r.id.slice(0, 8)} (${r.created_at.slice(0, 10)}): phones in text = ${JSON.stringify(found)}`);
}
console.log(`manual/humanized-path rows: ${manualRows.length}`);
const manualPhoneHits = manualRows.filter((r) => phoneRe.test(r.content));
console.log(`  of those, rows containing ANY phone-shaped string: ${manualPhoneHits.length}`);

console.log("\n=== 3. twin_powered flag: source vs production data ===");
console.log("source (draft-generation-agent.ts:1879) unconditionally sets twin_powered:true on every insert.");
const twinEligible = s.applications.rowsWithDraftContent.filter((a) => a.draft_source === "autonomous");
console.log(`applications rows with draft_source='autonomous' in production: ${twinEligible.length}`);
console.log(`of those, twin_powered === true: ${twinEligible.filter((a) => a.twin_powered === true).length}`);
console.log(`of those, twin_powered === false: ${twinEligible.filter((a) => a.twin_powered === false).length}`);

console.log("\n=== 4. AutoApply submission wrong-identity check (deeb2219) ===");
const sub = s.autoapply_submissions.rows.find((r) => r.id === "deeb2219-54c5-441b-ab39-48a22f86d81d");
console.log(`org: ${sub?.organization_id}  status: ${sub?.status}  created: ${sub?.created_at}`);
console.log(`request_description: ${sub?.request_description}`);
const org = s.orgContext.orgs.find((o) => o.id === sub?.organization_id);
console.log(`real org name/service_area on file: ${org?.name} / ${JSON.stringify(org)?.includes("Texas") ? "Texas (per KB/twin)" : "see org record"}`);
const funder = s.funderContext.funders.find((f) => f.id === sub?.funder_id);
console.log(`funder targeted: ${funder?.name}, geographic_focus: ${funder?.geographic_focus}`);
