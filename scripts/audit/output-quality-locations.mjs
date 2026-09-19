// AR-17.1 output-location registry.
//
// Every entry below was derived by reading the agent's actual write call in
// source (file:line cited per entry via "citation"), not by guessing a
// table name. Entries this build could not locate with confidence are
// marked locatable:false with a reason.
//
// Schema per entry:
//   agentType    - the agent_type / PIL agent_id string used in production
//   modulePath   - the source file that performs the write
//   family       - "core" | "autonomous" | "pil" | "autoapply" (CLI grouping)
//   locatable    - false when no confident write destination was found
//   table        - the domain table holding the real output (never agent_runs)
//   primaryColumn- dot-path to the field carrying the answer (first segment
//                  is the real DB column; remaining segments walk a jsonb
//                  value already returned as a parsed object by PostgREST)
//   valueType    - "numeric" | "text" | "jsonb" (gates the BOILERPLATE
//                  measure, which only applies to free-form narrative text;
//                  variance/nullity run regardless of this label)
//   dateColumn   - flat timestamp column used for ordering / staleness
//   orgIdColumn  - present for documentation only, not queried (service
//                  role reads span all orgs; this tool is read-only and
//                  reports platform-wide samples, not one org's data)
//   agentFilter  - optional extra PostgREST filter query-string fragment
//                  distinguishing this agent's rows in a shared table
//   evidenceColumns - dot-paths checked for GROUNDING (rationale/sources/
//                  citations alongside the score or claim)
//   citation     - file:line evidence for the write call
//   reason       - set when locatable:false
export const OUTPUT_LOCATIONS = [
  {
    "agentType": "ea01_giving_detector",
    "modulePath": "src/lib/agents/ea-01-giving-detector.ts",
    "family": "core",
    "locatable": true,
    "table": "corporate_prospects",
    "primaryColumn": "enrichment.has_giving_program",
    "valueType": "jsonb",
    "dateColumn": "enrichment_completed_at",
    "orgIdColumn": null,
    "agentFilter": "enrichment=not.is.null",
    "evidenceColumns": [],
    "citation": "src/lib/agents/ea-01-giving-detector.ts:149 mergeEnrichmentPatch -> corporate-enrichment-shared.ts:74-83 .update()",
    "reason": null
  },
  {
    "agentType": "ea02_community_outreach_detector",
    "modulePath": "src/lib/agents/ea-02-community-outreach-detector.ts",
    "family": "core",
    "locatable": true,
    "table": "corporate_prospects",
    "primaryColumn": "enrichment.community_involvement",
    "valueType": "jsonb",
    "dateColumn": "enrichment_completed_at",
    "orgIdColumn": null,
    "agentFilter": "enrichment=not.is.null",
    "evidenceColumns": [],
    "citation": "src/lib/agents/ea-02-community-outreach-detector.ts:122 mergeEnrichmentPatch",
    "reason": null
  },
  {
    "agentType": "ea03_sponsorship_detector",
    "modulePath": "src/lib/agents/ea-03-sponsorship-detector.ts",
    "family": "core",
    "locatable": true,
    "table": "corporate_prospects",
    "primaryColumn": "enrichment.sponsorship_activity",
    "valueType": "jsonb",
    "dateColumn": "enrichment_completed_at",
    "orgIdColumn": null,
    "agentFilter": "enrichment=not.is.null",
    "evidenceColumns": [],
    "citation": "src/lib/agents/ea-03-sponsorship-detector.ts:144 mergeEnrichmentPatch",
    "reason": null
  },
  {
    "agentType": "ea04_foundation_detector",
    "modulePath": "src/lib/agents/ea-04-foundation-detector.ts",
    "family": "core",
    "locatable": true,
    "table": "corporate_prospects",
    "primaryColumn": "enrichment.foundation_affiliation",
    "valueType": "jsonb",
    "dateColumn": "enrichment_completed_at",
    "orgIdColumn": null,
    "agentFilter": "enrichment=not.is.null",
    "evidenceColumns": [
      "enrichment.foundation_ein"
    ],
    "citation": "src/lib/agents/ea-04-foundation-detector.ts:92 mergeEnrichmentPatch",
    "reason": null
  },
  {
    "agentType": "ea05_career_page_analyzer",
    "modulePath": "src/lib/agents/ea-05-career-page-analyzer.ts",
    "family": "core",
    "locatable": true,
    "table": "corporate_prospects",
    "primaryColumn": "enrichment.company_culture_signals",
    "valueType": "jsonb",
    "dateColumn": "enrichment_completed_at",
    "orgIdColumn": null,
    "agentFilter": "enrichment=not.is.null",
    "evidenceColumns": [],
    "citation": "src/lib/agents/ea-05-career-page-analyzer.ts:136 mergeEnrichmentPatch",
    "reason": null
  },
  {
    "agentType": "ea06_press_release_analyzer",
    "modulePath": "src/lib/agents/ea-06-press-release-analyzer.ts",
    "family": "core",
    "locatable": true,
    "table": "corporate_prospects",
    "primaryColumn": "enrichment.donation_history",
    "valueType": "jsonb",
    "dateColumn": "enrichment_completed_at",
    "orgIdColumn": null,
    "agentFilter": "enrichment=not.is.null",
    "evidenceColumns": [],
    "citation": "src/lib/agents/ea-06-press-release-analyzer.ts:155 mergeEnrichmentPatch",
    "reason": null
  },
  {
    "agentType": "ea07_esg_analyzer",
    "modulePath": "src/lib/agents/ea-07-esg-analyzer.ts",
    "family": "core",
    "locatable": true,
    "table": "corporate_prospects",
    "primaryColumn": "enrichment.esg_initiatives",
    "valueType": "jsonb",
    "dateColumn": "enrichment_completed_at",
    "orgIdColumn": null,
    "agentFilter": "enrichment=not.is.null",
    "evidenceColumns": [],
    "citation": "src/lib/agents/ea-07-esg-analyzer.ts:159 mergeEnrichmentPatch",
    "reason": null
  },
  {
    "agentType": "ea08_executive_biography_analyzer",
    "modulePath": "src/lib/agents/ea-08-executive-biography-analyzer.ts",
    "family": "core",
    "locatable": true,
    "table": "corporate_prospects",
    "primaryColumn": "enrichment.decision_maker_names",
    "valueType": "jsonb",
    "dateColumn": "enrichment_completed_at",
    "orgIdColumn": null,
    "agentFilter": "enrichment=not.is.null",
    "evidenceColumns": [],
    "citation": "src/lib/agents/ea-08-executive-biography-analyzer.ts:164 mergeEnrichmentPatch",
    "reason": null
  },
  {
    "agentType": "ea09_contact_extractor",
    "modulePath": "src/lib/agents/ea-09-contact-extractor.ts",
    "family": "core",
    "locatable": true,
    "table": "corporate_prospects",
    "primaryColumn": "enrichment.verified_emails",
    "valueType": "jsonb",
    "dateColumn": "enrichment_completed_at",
    "orgIdColumn": null,
    "agentFilter": "enrichment=not.is.null",
    "evidenceColumns": [],
    "citation": "src/lib/agents/ea-09-contact-extractor.ts:150 mergeEnrichmentPatch",
    "reason": null
  },
  {
    "agentType": "ea10_social_media_analyzer",
    "modulePath": "src/lib/agents/ea-10-social-media-analyzer.ts",
    "family": "core",
    "locatable": true,
    "table": "corporate_prospects",
    "primaryColumn": "enrichment.recent_donations",
    "valueType": "jsonb",
    "dateColumn": "enrichment_completed_at",
    "orgIdColumn": null,
    "agentFilter": "enrichment=not.is.null",
    "evidenceColumns": [],
    "citation": "src/lib/agents/ea-10-social-media-analyzer.ts:152 mergeEnrichmentPatch",
    "reason": null
  },
  {
    "agentType": "cold_outreach",
    "modulePath": "src/lib/agents/cold-outreach.ts",
    "family": "core",
    "locatable": true,
    "table": "outreach_contacts",
    "primaryColumn": "contact_name",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": null,
    "evidenceColumns": [
      "source_url"
    ],
    "citation": "src/lib/agents/cold-outreach.ts:126-144 insert into outreach_contacts",
    "reason": null
  },
  {
    "agentType": "budget_builder_worker",
    "modulePath": "src/lib/agents/budget-builder.ts",
    "family": "core",
    "locatable": true,
    "table": "notes",
    "primaryColumn": "content",
    "valueType": "text",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "content=like.**Budget***",
    "evidenceColumns": [],
    "citation": "src/lib/agents/budget-builder.ts:146,153 insert into notes",
    "reason": null
  },
  {
    "agentType": "budget_builder",
    "modulePath": "src/lib/agents/budget-agent.ts",
    "family": "core",
    "locatable": true,
    "table": "draft_versions",
    "primaryColumn": "content",
    "valueType": "text",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "template_type=eq.budget_narrative",
    "evidenceColumns": [
      "knowledge_sources"
    ],
    "citation": "src/lib/agents/budget-agent.ts:279-293 insert into draft_versions",
    "reason": null
  },
  {
    "agentType": "corporate_research",
    "modulePath": "src/lib/agents/corporate-scraper.ts",
    "family": "core",
    "locatable": true,
    "table": "opportunities",
    "primaryColumn": "description",
    "valueType": "text",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "source_type=eq.corporate_giving",
    "evidenceColumns": [
      "url",
      "eligibility_requirements"
    ],
    "citation": "src/lib/agents/corporate-scraper.ts:196-198 insert into opportunities",
    "reason": null
  },
  {
    "agentType": "corporate_research",
    "modulePath": "src/lib/agents/research/corporate-giving.ts",
    "family": "core",
    "locatable": true,
    "table": "opportunities",
    "primaryColumn": "description",
    "valueType": "text",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "source_type=eq.corporate_giving",
    "evidenceColumns": [
      "url",
      "eligibility_requirements"
    ],
    "citation": "src/lib/agents/research/corporate-giving.ts:223-254 insert into opportunities",
    "reason": null
  },
  {
    "agentType": "foundation_research",
    "modulePath": "src/lib/agents/research/foundation-grants.ts",
    "family": "core",
    "locatable": true,
    "table": "opportunities",
    "primaryColumn": "description",
    "valueType": "text",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": null,
    "evidenceColumns": [
      "url",
      "eligibility_requirements"
    ],
    "citation": "src/lib/agents/research/foundation-grants.ts:239 insert into opportunities",
    "reason": null
  },
  {
    "agentType": "local_sponsorship",
    "modulePath": "src/lib/agents/research/local-sponsorship.ts",
    "family": "core",
    "locatable": true,
    "table": "opportunities",
    "primaryColumn": "description",
    "valueType": "text",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": null,
    "evidenceColumns": [
      "url",
      "eligibility_requirements"
    ],
    "citation": "src/lib/agents/research/local-sponsorship.ts:474-494 insert into opportunities",
    "reason": null
  },
  {
    "agentType": "government_research",
    "modulePath": "src/lib/agents/research/government-grants.ts",
    "family": "core",
    "locatable": true,
    "table": "opportunities",
    "primaryColumn": "description",
    "valueType": "text",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": null,
    "evidenceColumns": [
      "url",
      "eligibility_requirements"
    ],
    "citation": "src/lib/agents/research/government-grants.ts:482-500 insert into opportunities",
    "reason": null
  },
  {
    "agentType": "custom_api_research",
    "modulePath": "src/lib/agents/custom-api.ts",
    "family": "core",
    "locatable": true,
    "table": "opportunities",
    "primaryColumn": "description",
    "valueType": "text",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": null,
    "evidenceColumns": [],
    "citation": "src/lib/agents/custom-api.ts:299-301 insert into opportunities",
    "reason": null
  },
  {
    "agentType": "custom_scrape_research",
    "modulePath": "src/lib/agents/custom-scrape.ts",
    "family": "core",
    "locatable": true,
    "table": "opportunities",
    "primaryColumn": "description",
    "valueType": "text",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": null,
    "evidenceColumns": [
      "url"
    ],
    "citation": "src/lib/agents/custom-scrape.ts:324-326 insert into opportunities",
    "reason": null
  },
  {
    "agentType": "browser_automation",
    "modulePath": "src/lib/agents/browser-automation.ts",
    "family": "core",
    "locatable": true,
    "table": "applications",
    "primaryColumn": "notes",
    "valueType": "text",
    "dateColumn": "submitted_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "stage=eq.submitted",
    "evidenceColumns": [],
    "citation": "src/lib/agents/browser-automation.ts:922-940 update applications",
    "reason": null
  },
  {
    "agentType": "browser_automation",
    "modulePath": "src/lib/agents/playwright-agent.ts",
    "family": "core",
    "locatable": true,
    "table": "automation_sessions",
    "primaryColumn": "mapped_fields",
    "valueType": "jsonb",
    "dateColumn": "updated_at",
    "orgIdColumn": "organization_id",
    "agentFilter": null,
    "evidenceColumns": [],
    "citation": "src/lib/agents/playwright-agent.ts:379-387 update automation_sessions (apply mode only; discover mode persists nothing)",
    "reason": null
  },
  {
    "agentType": "form_analyzer",
    "modulePath": "src/lib/agents/form-analyzer.ts",
    "family": "core",
    "locatable": true,
    "table": "form_templates",
    "primaryColumn": "form_structure",
    "valueType": "jsonb",
    "dateColumn": "last_verified_at",
    "orgIdColumn": "organization_id",
    "agentFilter": null,
    "evidenceColumns": [
      "automation_assessment"
    ],
    "citation": "src/lib/agents/form-analyzer.ts:148-164 insert into form_templates",
    "reason": null
  },
  {
    "agentType": "form_filler",
    "modulePath": "src/lib/agents/form-filler.ts",
    "family": "core",
    "locatable": true,
    "table": "autoapply_submissions",
    "primaryColumn": "request_description",
    "valueType": "text",
    "dateColumn": "submitted_at",
    "orgIdColumn": "organization_id",
    "agentFilter": null,
    "evidenceColumns": [
      "pre_submit_screenshot_url",
      "confirmation_screenshot_url"
    ],
    "citation": "src/lib/agents/form-filler.ts:364-380 insert into autoapply_submissions",
    "reason": null
  },
  {
    "agentType": "application_cloning",
    "modulePath": "src/lib/agents/application-cloner.ts",
    "family": "core",
    "locatable": true,
    "table": "applications",
    "primaryColumn": "draft_content",
    "valueType": "text",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": null,
    "evidenceColumns": [],
    "citation": "src/lib/agents/application-cloner.ts:141-155 insert into applications",
    "reason": null
  },
  {
    "agentType": "deadline_extraction",
    "modulePath": "src/lib/agents/deadline-extractor.ts",
    "family": "core",
    "locatable": true,
    "table": "deadlines",
    "primaryColumn": "title",
    "valueType": "text",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": null,
    "evidenceColumns": [],
    "citation": "src/lib/agents/deadline-extractor.ts:156-165 insert into deadlines",
    "reason": null
  },
  {
    "agentType": "deadline_prediction",
    "modulePath": "src/lib/agents/deadline-prediction.ts",
    "family": "core",
    "locatable": true,
    "table": "opportunities",
    "primaryColumn": "description",
    "valueType": "text",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "name=like.Predicted*",
    "evidenceColumns": [],
    "citation": "src/lib/agents/deadline-prediction.ts:137-148 insert into opportunities",
    "reason": null
  },
  {
    "agentType": "final_assembly",
    "modulePath": "src/lib/agents/final-assembly.ts",
    "family": "core",
    "locatable": true,
    "table": "notes",
    "primaryColumn": "content",
    "valueType": "text",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "content=like.**Package Assembly***",
    "evidenceColumns": [],
    "citation": "src/lib/agents/final-assembly.ts:210-215 insert into notes",
    "reason": null
  },
  {
    "agentType": "email_campaign",
    "modulePath": "src/lib/agents/email-campaign.ts",
    "family": "core",
    "locatable": false,
    "reason": "only campaign_sends.status ('sent'/'bounced') is persisted; the actual rendered email content is composed at send-time and never written to any table"
  },
  {
    "agentType": "email_parser",
    "modulePath": "src/lib/agents/email-parser.ts",
    "family": "core",
    "locatable": true,
    "table": "email_activity",
    "primaryColumn": "summary",
    "valueType": "text",
    "dateColumn": "received_at",
    "orgIdColumn": "organization_id",
    "agentFilter": null,
    "evidenceColumns": [],
    "citation": "src/lib/agents/email-parser.ts:273-288 insert into email_activity",
    "reason": null
  },
  {
    "agentType": "compliance_check",
    "modulePath": "src/lib/agents/compliance-checker.ts",
    "family": "core",
    "locatable": false,
    "reason": "readyToSubmit and findings[] are returned only in the AgentExecution result payload; no supabase.from(...).insert/update call anywhere in the file"
  },
  {
    "agentType": "eligibility_scoring",
    "modulePath": "src/lib/agents/eligibility-scorer.ts",
    "family": "core",
    "locatable": true,
    "table": "opportunities",
    "primaryColumn": "eligibility_score",
    "valueType": "numeric",
    "dateColumn": "updated_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "eligibility_score=not.is.null",
    "evidenceColumns": [
      "recommendation_reasoning"
    ],
    "citation": "src/lib/agents/eligibility-scorer.ts:190-204 update opportunities {eligibility_score, recommendation, recommendation_reasoning, match_percentage, is_high_priority, match_mismatch_reasons} -- header states these columns are set ONLY by this agent, never edited manually",
    "reason": null
  },
  {
    "agentType": "grant_summary",
    "modulePath": "src/lib/agents/grant-summary.ts",
    "family": "core",
    "locatable": true,
    "table": "opportunities",
    "primaryColumn": "description",
    "valueType": "text",
    "dateColumn": "updated_at",
    "orgIdColumn": "organization_id",
    "agentFilter": null,
    "evidenceColumns": [],
    "citation": "src/lib/agents/grant-summary.ts:161-165 update opportunities",
    "reason": null
  },
  {
    "agentType": "grants_gov_research",
    "modulePath": "src/lib/agents/grants-gov.ts",
    "family": "core",
    "locatable": true,
    "table": "opportunities",
    "primaryColumn": "description",
    "valueType": "text",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "source=eq.grants.gov",
    "evidenceColumns": [
      "url"
    ],
    "citation": "src/lib/agents/grants-gov.ts:279-283 insert into opportunities",
    "reason": null
  },
  {
    "agentType": "giving_history_extractor",
    "modulePath": "src/lib/agents/giving-history.ts",
    "family": "core",
    "locatable": true,
    "table": "funder_intelligence",
    "primaryColumn": "recent_grants",
    "valueType": "jsonb",
    "dateColumn": "last_scraped_at",
    "orgIdColumn": "organization_id",
    "agentFilter": null,
    "evidenceColumns": [
      "recent_grants.filings"
    ],
    "citation": "src/lib/agents/giving-history.ts:114-125 upsert funder_intelligence",
    "reason": null
  },
  {
    "agentType": "foundation_research_finder",
    "modulePath": "src/lib/agents/foundation-finder.ts",
    "family": "core",
    "locatable": true,
    "table": "opportunities",
    "primaryColumn": "description",
    "valueType": "text",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "source=eq.foundation_finder",
    "evidenceColumns": [
      "url"
    ],
    "citation": "src/lib/agents/foundation-finder.ts:160-163 insert into opportunities",
    "reason": null
  },
  {
    "agentType": "funder_intel",
    "modulePath": "src/lib/agents/funder-intel.ts",
    "family": "core",
    "locatable": true,
    "table": "funder_intelligence",
    "primaryColumn": "priorities",
    "valueType": "jsonb",
    "dateColumn": "last_scraped_at",
    "orgIdColumn": "organization_id",
    "agentFilter": null,
    "evidenceColumns": [
      "raw_data"
    ],
    "citation": "src/lib/agents/funder-intel.ts:103-124 upsert funder_intelligence",
    "reason": null
  },
  {
    "agentType": "competitor_intelligence",
    "modulePath": "src/lib/agents/competitor-intel.ts",
    "family": "core",
    "locatable": true,
    "table": "competitor_tracking",
    "primaryColumn": "grant_purpose",
    "valueType": "text",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "source=eq.competitor_intel",
    "evidenceColumns": [],
    "citation": "src/lib/agents/competitor-intel.ts:178-180 insert into competitor_tracking",
    "reason": null
  },
  {
    "agentType": "follow_up_generator",
    "modulePath": "src/lib/agents/follow-up-generator.ts",
    "family": "core",
    "locatable": true,
    "table": "notes",
    "primaryColumn": "content",
    "valueType": "text",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": null,
    "evidenceColumns": [],
    "citation": "src/lib/agents/follow-up-generator.ts:210-221 insert into notes",
    "reason": null
  },
  {
    "agentType": "funder_relationship",
    "modulePath": "src/lib/agents/funder-relationship.ts",
    "family": "core",
    "locatable": true,
    "table": "funder_relationship_scores",
    "primaryColumn": "relationship_score",
    "valueType": "numeric",
    "dateColumn": "updated_at",
    "orgIdColumn": "organization_id",
    "agentFilter": null,
    "evidenceColumns": [
      "recent_events"
    ],
    "citation": "src/lib/agents/funder-relationship.ts:195-215 upsert funder_relationship_scores",
    "reason": null
  },
  {
    "agentType": "hud_monitor",
    "modulePath": "src/lib/agents/hud-monitor.ts",
    "family": "core",
    "locatable": true,
    "table": "opportunities",
    "primaryColumn": "description",
    "valueType": "text",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "source=eq.hud.gov",
    "evidenceColumns": [
      "url"
    ],
    "citation": "src/lib/agents/hud-monitor.ts:224-234 insert into opportunities",
    "reason": null
  },
  {
    "agentType": "government_research_housing_scrapers",
    "modulePath": "src/lib/agents/housing-specific-scrapers.ts",
    "family": "core",
    "locatable": true,
    "table": "opportunities",
    "primaryColumn": "description",
    "valueType": "text",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": null,
    "evidenceColumns": [
      "url"
    ],
    "citation": "src/lib/agents/housing-specific-scrapers.ts:165-167 insert into opportunities",
    "reason": null
  },
  {
    "agentType": "government_research_nofa_parser",
    "modulePath": "src/lib/agents/nofa-parser.ts",
    "family": "core",
    "locatable": true,
    "table": "opportunities",
    "primaryColumn": "description",
    "valueType": "text",
    "dateColumn": "updated_at",
    "orgIdColumn": "organization_id",
    "agentFilter": null,
    "evidenceColumns": [
      "opportunity_documents"
    ],
    "citation": "src/lib/agents/nofa-parser.ts:456-461 update opportunities (fill-only patch)",
    "reason": null
  },
  {
    "agentType": "sam_gov_research",
    "modulePath": "src/lib/agents/sam-gov.ts",
    "family": "core",
    "locatable": true,
    "table": "opportunities",
    "primaryColumn": "deadline",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "source=eq.sam.gov",
    "evidenceColumns": [
      "url"
    ],
    "citation": "src/lib/agents/sam-gov.ts:315-329 insert into opportunities",
    "reason": null
  },
  {
    "agentType": "simpler_grants_research",
    "modulePath": "src/lib/agents/simpler-grants.ts",
    "family": "core",
    "locatable": true,
    "table": "opportunities",
    "primaryColumn": "description",
    "valueType": "text",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "source=eq.simpler.grants.gov",
    "evidenceColumns": [
      "url"
    ],
    "citation": "src/lib/agents/simpler-grants.ts:246-261 insert into opportunities",
    "reason": null
  },
  {
    "agentType": "propublica_mining",
    "modulePath": "src/lib/agents/propublica.ts",
    "family": "core",
    "locatable": false,
    "reason": "confirmed zero supabase writes in this file; pure API-mining function returning data only to its caller"
  },
  {
    "agentType": "state_portal_housing_scrapers",
    "modulePath": "src/lib/agents/state-scrapers.ts",
    "family": "core",
    "locatable": true,
    "table": "opportunities",
    "primaryColumn": "description",
    "valueType": "text",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "source_type=eq.government_state",
    "evidenceColumns": [
      "url"
    ],
    "citation": "src/lib/agents/state-scrapers.ts:188-221 insert into opportunities",
    "reason": null
  },
  {
    "agentType": "state_portal",
    "modulePath": "src/lib/agents/state-portal.ts",
    "family": "core",
    "locatable": true,
    "table": "opportunities",
    "primaryColumn": "eligibility",
    "valueType": "text",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "source_type=eq.government_state",
    "evidenceColumns": [
      "url"
    ],
    "citation": "src/lib/agents/state-portal.ts:263-283 insert into opportunities",
    "reason": null
  },
  {
    "agentType": "government_research_usaspending",
    "modulePath": "src/lib/agents/usaspending.ts",
    "family": "core",
    "locatable": true,
    "table": "historical_awards",
    "primaryColumn": "description",
    "valueType": "text",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "source=eq.usaspending.gov",
    "evidenceColumns": [
      "awarding_agency"
    ],
    "citation": "src/lib/agents/usaspending.ts:108-110 upsert historical_awards",
    "reason": null
  },
  {
    "agentType": "state_portal_tdhca",
    "modulePath": "src/lib/agents/tdhca-scraper.ts",
    "family": "core",
    "locatable": true,
    "table": "opportunities",
    "primaryColumn": "description",
    "valueType": "text",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "source=eq.tdhca.state.tx.us",
    "evidenceColumns": [
      "url"
    ],
    "citation": "src/lib/agents/tdhca-scraper.ts:137-167 insert into opportunities",
    "reason": null
  },
  {
    "agentType": "review",
    "modulePath": "src/lib/agents/review-agent.ts",
    "family": "core",
    "locatable": true,
    "table": "notes",
    "primaryColumn": "content",
    "valueType": "text",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "content=like.**Review***",
    "evidenceColumns": [],
    "citation": "src/lib/agents/review-agent.ts:176-181 insert into notes",
    "reason": null
  },
  {
    "agentType": "recursive_learning",
    "modulePath": "src/lib/agents/recursive-learning.ts",
    "family": "core",
    "locatable": true,
    "table": "proven_narratives",
    "primaryColumn": "narrative_text",
    "valueType": "text",
    "dateColumn": "last_used_at",
    "orgIdColumn": "organization_id",
    "agentFilter": null,
    "evidenceColumns": [
      "success_patterns"
    ],
    "citation": "src/lib/agents/recursive-learning.ts:337-351 insert/327-334 update proven_narratives",
    "reason": null
  },
  {
    "agentType": "semantic_matching",
    "modulePath": "src/lib/agents/semantic-matching.ts",
    "family": "core",
    "locatable": false,
    "reason": "zero writes; only SELECTs, returns a ranked match list purely in the AgentExecution result"
  },
  {
    "agentType": "success_probability",
    "modulePath": "src/lib/agents/success-probability.ts",
    "family": "core",
    "locatable": true,
    "table": "success_probability_scores",
    "primaryColumn": "probability_score",
    "valueType": "numeric",
    "dateColumn": "calculated_at",
    "orgIdColumn": "organization_id",
    "agentFilter": null,
    "evidenceColumns": [
      "factors"
    ],
    "citation": "src/lib/agents/success-probability.ts:171-184 upsert success_probability_scores",
    "reason": null
  },
  {
    "agentType": "ag-42-change-monitor",
    "modulePath": "src/lib/agents/change-monitor-agent.ts",
    "family": "autonomous",
    "locatable": true,
    "table": "foundation_directory",
    "primaryColumn": "enrichment.change_monitor_last_change",
    "valueType": "jsonb",
    "orgIdColumn": null,
    "agentFilter": null,
    "evidenceColumns": [],
    "citation": "src/lib/agents/change-monitor-agent.ts:513-527 supabase.from('foundation_directory').update({ enrichment: {..., change_monitor_last_change} })",
    "reason": null
  },
  {
    "agentType": "ag-27-board-packet",
    "modulePath": "src/lib/agents/board-packet-agent.ts",
    "family": "autonomous",
    "locatable": true,
    "table": "board_meeting_packets",
    "primaryColumn": "packet_content",
    "valueType": "jsonb",
    "dateColumn": "generated_at",
    "orgIdColumn": "org_id",
    "agentFilter": null,
    "evidenceColumns": [],
    "citation": "src/lib/agents/board-packet-agent.ts:891-898 supabase.from('board_meeting_packets').insert({ org_id, meeting_id, packet_content, viewed_by })",
    "reason": null
  },
  {
    "agentType": "ag-30-donor-intent",
    "modulePath": "src/lib/agents/donor-intent-monitor-agent.ts",
    "family": "autonomous",
    "locatable": true,
    "table": "corporate_intent_signals",
    "primaryColumn": "intent_score",
    "valueType": "numeric",
    "dateColumn": "signal_date",
    "orgIdColumn": "org_id",
    "agentFilter": null,
    "evidenceColumns": [
      "signal_summary",
      "signal_url"
    ],
    "citation": "src/lib/agents/donor-intent-monitor-agent.ts:851-855 supabase.from('corporate_intent_signals').insert(signalRow)",
    "reason": null
  },
  {
    "agentType": "ag-10-document-expiry",
    "modulePath": "src/lib/agents/document-expiry-agent.ts",
    "family": "autonomous",
    "locatable": true,
    "table": "alerts",
    "primaryColumn": "message",
    "valueType": "text",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "dedup_key=like.autonomous:ag-10-document-expiry:*",
    "evidenceColumns": [],
    "citation": "src/lib/agents/autonomous-base.ts:409-415 createNotification -> alerts.insert; called from document-expiry-agent.ts:95-100",
    "reason": null
  },
  {
    "agentType": "ag-25-deadline-prediction",
    "modulePath": "src/lib/agents/deadline-prediction-agent.ts",
    "family": "autonomous",
    "locatable": true,
    "table": "deadline_predictions",
    "primaryColumn": "predicted_deadline",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "org_id",
    "agentFilter": null,
    "evidenceColumns": [
      "source_detail",
      "source"
    ],
    "citation": "src/lib/agents/deadline-prediction-agent.ts:519-528 supabase.from('deadline_predictions').insert(...)",
    "reason": null
  },
  {
    "agentType": "ag-35-community-need",
    "modulePath": "src/lib/agents/community-need-predictor-agent.ts",
    "family": "autonomous",
    "locatable": true,
    "table": "community_need_signals",
    "primaryColumn": "severity",
    "valueType": "jsonb",
    "dateColumn": "data_date",
    "orgIdColumn": "org_id",
    "agentFilter": null,
    "evidenceColumns": [
      "signal_description",
      "signal_category",
      "geographic_area"
    ],
    "citation": "src/lib/agents/community-need-predictor-agent.ts:653-668 supabase.from('community_need_signals').insert(...)",
    "reason": null
  },
  {
    "agentType": "ag-05-draft",
    "modulePath": "src/lib/agents/draft-generation-agent.ts",
    "family": "autonomous",
    "locatable": true,
    "table": "applications",
    "primaryColumn": "draft_content",
    "valueType": "text",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "draft_source=eq.autonomous",
    "evidenceColumns": [
      "metadata.intelligence_pattern_analysis",
      "metadata.knowledge_engine_patterns_applied",
      "compliance_check_result"
    ],
    "citation": "src/lib/agents/draft-generation-agent.ts:1940-1942 supabase.from('applications').insert(insertPayload)",
    "reason": null
  },
  {
    "agentType": "ag-28-followup",
    "modulePath": "src/lib/agents/followup-generator-agent.ts",
    "family": "autonomous",
    "locatable": true,
    "table": "application_followups",
    "primaryColumn": "content",
    "valueType": "text",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": null,
    "evidenceColumns": [],
    "citation": "src/lib/agents/followup-generator-agent.ts:196 supabase.from('application_followups').insert({...})",
    "reason": null
  },
  {
    "agentType": "ag-10-grant-dna",
    "modulePath": "src/lib/agents/grant-dna-agent.ts",
    "family": "autonomous",
    "locatable": true,
    "table": "funder_dna_profiles",
    "primaryColumn": "requirement_patterns",
    "valueType": "jsonb",
    "dateColumn": "last_analyzed_at",
    "orgIdColumn": "organization_id",
    "agentFilter": null,
    "evidenceColumns": [
      "sample_size",
      "confidence"
    ],
    "citation": "src/lib/agents/grant-dna-agent.ts:505-506 supabase.from('funder_dna_profiles').upsert(...)",
    "reason": null
  },
  {
    "agentType": "ag-digest",
    "modulePath": "src/lib/agents/autonomous-digest-agent.ts",
    "family": "autonomous",
    "locatable": true,
    "table": "alerts",
    "primaryColumn": "message",
    "valueType": "text",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "dedup_key=like.autonomous:ag-digest:morning_digest:*",
    "evidenceColumns": [],
    "citation": "src/lib/agents/autonomous-digest-agent.ts:356-368 createNotification -> alerts.insert; secondary ledger digest_item_log.insert at :712-724",
    "reason": null
  },
  {
    "agentType": "ag-36-learning-network",
    "modulePath": "src/lib/agents/learning-network-aggregator-agent.ts",
    "family": "autonomous",
    "locatable": true,
    "table": "platform_learning_patterns",
    "primaryColumn": "pattern_content",
    "valueType": "jsonb",
    "dateColumn": "last_updated",
    "orgIdColumn": null,
    "agentFilter": null,
    "evidenceColumns": [
      "winning_examples",
      "sample_count"
    ],
    "citation": "src/lib/agents/learning-network-aggregator-agent.ts:1003-1004 insert/:976-977 update; platform-wide, no organization_id",
    "reason": null
  },
  {
    "agentType": "ag-41-impact-simulation",
    "modulePath": "src/lib/agents/impact-simulation-agent.ts",
    "family": "autonomous",
    "locatable": true,
    "table": "impact_simulations",
    "primaryColumn": "simulation_result",
    "valueType": "jsonb",
    "dateColumn": "generated_at",
    "orgIdColumn": "org_id",
    "agentFilter": null,
    "evidenceColumns": [
      "simulation_result.keyRisks",
      "simulation_result.keyOpportunities",
      "simulation_result.narrative"
    ],
    "citation": "src/lib/agents/impact-simulation-agent.ts:773-784 supabase.from('impact_simulations').insert({...})",
    "reason": null
  },
  {
    "agentType": "ag-09-outcome-analyzer",
    "modulePath": "src/lib/agents/outcome-analyzer-agent.ts",
    "family": "autonomous",
    "locatable": true,
    "table": "organizations",
    "primaryColumn": "analytics.insightSummary",
    "valueType": "jsonb",
    "dateColumn": "updated_at",
    "orgIdColumn": "id",
    "agentFilter": null,
    "evidenceColumns": [],
    "citation": "src/lib/agents/outcome-analyzer-agent.ts:200-205 supabase.from('organizations').update({ analytics: {...} })",
    "reason": null
  },
  {
    "agentType": "ag-11-knowledge-gap",
    "modulePath": "src/lib/agents/knowledge-gap-agent.ts",
    "family": "autonomous",
    "locatable": true,
    "table": "alerts",
    "primaryColumn": "message",
    "valueType": "text",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "dedup_key=like.autonomous:ag-11-knowledge-gap:knowledge_gap:*",
    "evidenceColumns": [],
    "citation": "src/lib/agents/knowledge-gap-agent.ts:118-125 createNotification -> alerts.insert",
    "reason": null
  },
  {
    "agentType": "ag-17-discovery",
    "modulePath": "src/lib/agents/opportunity-discovery-agent.ts",
    "family": "autonomous",
    "locatable": true,
    "table": "opportunities",
    "primaryColumn": "eligibility_score",
    "valueType": "numeric",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "source=eq.agent",
    "evidenceColumns": [],
    "citation": "src/lib/agents/opportunity-discovery-agent.ts:785-786 supabase.from('opportunities').insert({...})",
    "reason": null
  },
  {
    "agentType": "ag-29-knowledge-indexer",
    "modulePath": "src/lib/agents/knowledge-indexer-agent.ts",
    "family": "autonomous",
    "locatable": true,
    "table": "knowledge_patterns",
    "primaryColumn": "pattern_description",
    "valueType": "text",
    "dateColumn": "updated_at",
    "orgIdColumn": null,
    "agentFilter": "pattern_type=eq.category_success_rate",
    "evidenceColumns": [
      "sample_count"
    ],
    "citation": "src/lib/agents/knowledge-indexer-agent.ts:544-571 supabase.from('knowledge_patterns').update/.insert(...)",
    "reason": null
  },
  {
    "agentType": "ag-29-fundability",
    "modulePath": "src/lib/agents/fundability-scorer-agent.ts",
    "family": "autonomous",
    "locatable": true,
    "table": "fundability_scores",
    "primaryColumn": "overall_score",
    "valueType": "numeric",
    "dateColumn": "generated_at",
    "orgIdColumn": "org_id",
    "agentFilter": null,
    "evidenceColumns": [
      "deficiencies"
    ],
    "citation": "src/lib/agents/fundability-scorer-agent.ts:1029-1042 supabase.from('fundability_scores').insert({...})",
    "reason": null
  },
  {
    "agentType": "ag-15-probability",
    "modulePath": "src/lib/agents/probability-scoring-agent.ts",
    "family": "autonomous",
    "locatable": true,
    "table": "opportunity_probability_scores",
    "primaryColumn": "overall_score",
    "valueType": "numeric",
    "dateColumn": "computed_at",
    "orgIdColumn": "organization_id",
    "agentFilter": null,
    "evidenceColumns": [
      "factors",
      "key_risks",
      "key_strengths"
    ],
    "citation": "src/lib/agents/probability-scoring-agent.ts:902-919 supabase.from('opportunity_probability_scores').upsert(...)",
    "reason": null
  },
  {
    "agentType": "ag-32-relationship-graph",
    "modulePath": "src/lib/agents/relationship-graph-builder-agent.ts",
    "family": "autonomous",
    "locatable": true,
    "table": "pig_edges",
    "primaryColumn": "relationship_type",
    "valueType": "jsonb",
    "dateColumn": "discovered_at",
    "orgIdColumn": null,
    "agentFilter": null,
    "evidenceColumns": [
      "evidence"
    ],
    "citation": "src/lib/agents/relationship-graph-builder-agent.ts:627-639 supabase.from('pig_edges').upsert({..., evidence, weight, relationship_type})",
    "reason": null
  },
  {
    "agentType": "ag-19-relationship",
    "modulePath": "src/lib/agents/relationship-builder-agent.ts",
    "family": "autonomous",
    "locatable": true,
    "table": "relationship_recommendations",
    "primaryColumn": "recommendation_text",
    "valueType": "text",
    "dateColumn": "created_at",
    "orgIdColumn": "org_id",
    "agentFilter": "status=eq.pending",
    "evidenceColumns": [],
    "citation": "src/lib/agents/relationship-builder-agent.ts:802-809 supabase.from('relationship_recommendations').insert({...})",
    "reason": null
  },
  {
    "agentType": "ag-39-roi-optimizer",
    "modulePath": "src/lib/agents/roi-optimizer-agent.ts",
    "family": "autonomous",
    "locatable": true,
    "table": "roi_insights",
    "primaryColumn": "insight_description",
    "valueType": "text",
    "dateColumn": "created_at",
    "orgIdColumn": "org_id",
    "agentFilter": null,
    "evidenceColumns": [
      "sample_size",
      "confidence"
    ],
    "citation": "src/lib/agents/roi-optimizer-agent.ts:821-834 supabase.from('roi_insights').insert({...})",
    "reason": null
  },
  {
    "agentType": "ag-08-renewal-tracker",
    "modulePath": "src/lib/agents/renewal-tracker-agent.ts",
    "family": "autonomous",
    "locatable": true,
    "table": "opportunities",
    "primaryColumn": "description",
    "valueType": "text",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "source=eq.agent",
    "evidenceColumns": [],
    "citation": "src/lib/agents/renewal-tracker-agent.ts:155-168 supabase.from('opportunities').insert({...})",
    "reason": null
  },
  {
    "agentType": "ag-12-search-optimizer",
    "modulePath": "src/lib/agents/search-profile-optimizer-agent.ts",
    "family": "autonomous",
    "locatable": true,
    "table": "alerts",
    "primaryColumn": "message",
    "valueType": "text",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "dedup_key=like.autonomous:ag-12-search-optimizer:search_profile_optimization:*",
    "evidenceColumns": [],
    "citation": "src/lib/agents/search-profile-optimizer-agent.ts:173-185 createNotification -> alerts.insert",
    "reason": null
  },
  {
    "agentType": "ag-40-strategic-advisor",
    "modulePath": "src/lib/agents/strategic-advisor-agent.ts",
    "family": "autonomous",
    "locatable": true,
    "table": "strategic_recommendations",
    "primaryColumn": "recommendation",
    "valueType": "text",
    "dateColumn": "generated_at",
    "orgIdColumn": "org_id",
    "agentFilter": null,
    "evidenceColumns": [
      "reasoning",
      "data_basis"
    ],
    "citation": "src/lib/agents/strategic-advisor-agent.ts:1283-1285 supabase.from('strategic_recommendations').insert({...})",
    "reason": null
  },
  {
    "agentType": "ag-37-simulation",
    "modulePath": "src/lib/agents/simulation-agent.ts",
    "family": "autonomous",
    "locatable": true,
    "table": "simulation_scenarios",
    "primaryColumn": "scenario_name",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "org_id",
    "agentFilter": null,
    "evidenceColumns": [],
    "citation": "src/lib/agents/simulation-agent.ts:890-900 supabase.from('simulation_scenarios').insert({...})",
    "reason": null
  },
  {
    "agentType": "ag-38-self-improvement",
    "modulePath": "src/lib/agents/self-improvement-agent.ts",
    "family": "autonomous",
    "locatable": true,
    "table": "improvement_proposals",
    "primaryColumn": "description",
    "valueType": "text",
    "dateColumn": "proposed_at",
    "orgIdColumn": null,
    "agentFilter": null,
    "evidenceColumns": [
      "evidence"
    ],
    "citation": "src/lib/agents/self-improvement-agent.ts:1159-1169 supabase.from('improvement_proposals').insert({...})",
    "reason": null
  },
  {
    "agentType": "ag-18-reputation",
    "modulePath": "src/lib/intelligence/reputation-agent.ts",
    "family": "autonomous",
    "locatable": true,
    "table": "reputation_signals",
    "primaryColumn": "summary",
    "valueType": "text",
    "dateColumn": "signal_date",
    "orgIdColumn": null,
    "agentFilter": null,
    "evidenceColumns": [
      "source_url"
    ],
    "citation": "src/lib/intelligence/reputation-agent.ts:266-279 supabase.from('reputation_signals').insert({...})",
    "reason": null
  },
  {
    "agentType": "ag22_propensity_scoring",
    "modulePath": "src/lib/agents/ag-22-propensity-scoring.ts",
    "family": "autonomous",
    "locatable": true,
    "table": "corporate_prospects",
    "primaryColumn": "scores",
    "valueType": "jsonb",
    "dateColumn": "scores_computed_at",
    "orgIdColumn": null,
    "agentFilter": null,
    "evidenceColumns": [
      "scores.rationale",
      "scores.top_factors"
    ],
    "citation": "src/lib/agents/ag-22-propensity-scoring.ts:567-570 supabase.from('corporate_prospects').update({ scores, scores_computed_at })",
    "reason": null
  },
  {
    "agentType": "ag-26-forecast",
    "modulePath": "src/lib/agents/funding-forecast-agent.ts",
    "family": "autonomous",
    "locatable": true,
    "table": "funding_forecasts",
    "primaryColumn": "projected_most_likely",
    "valueType": "jsonb",
    "dateColumn": "forecast_date",
    "orgIdColumn": "org_id",
    "agentFilter": null,
    "evidenceColumns": [
      "key_risks",
      "key_opportunities",
      "recommended_actions",
      "methodology",
      "factors"
    ],
    "citation": "src/lib/agents/funding-forecast-agent.ts:504-522 supabase.from('funding_forecasts').upsert(...)",
    "reason": null
  },
  {
    "agentType": "narrative_drafting",
    "modulePath": "src/lib/drafts/generator.ts",
    "family": "autonomous",
    "locatable": true,
    "table": "draft_versions",
    "primaryColumn": "content",
    "valueType": "text",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": null,
    "evidenceColumns": [
      "knowledge_sources"
    ],
    "citation": "src/lib/drafts/generator.ts:973-987 supabase.from('draft_versions').insert({...})",
    "reason": null
  },
  {
    "agentType": "BEN-SUP-01",
    "modulePath": "src/lib/pil/agents/sup/BEN-SUP-01.ts",
    "family": "pil",
    "locatable": true,
    "table": "pil_agent_runs",
    "primaryColumn": "output.plan",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "agent_id=eq.BEN-SUP-01",
    "evidenceColumns": [
      "output.plan"
    ],
    "citation": "src/lib/pil/agents/sup/BEN-SUP-01.ts:178-193 conclusions:{plan,dispatchedRunIds,statusCounts,objectiveSatisfied,blockedByCriticVerdict,blockedByUnresolvedRecovery}; :246-254 return; budget-exhaustion blocked shape at :290-298 conclusions:{blockedByBudgetExhaustion:true,reason}",
    "reason": null
  },
  {
    "agentType": "BEN-SUP-02",
    "modulePath": "src/lib/pil/agents/sup/BEN-SUP-02.ts",
    "family": "pil",
    "locatable": true,
    "table": "pil_agent_runs",
    "primaryColumn": "output.plan",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "agent_id=eq.BEN-SUP-02",
    "evidenceColumns": [
      "output.plan.completenessReport",
      "output.plan.sourceKeys"
    ],
    "citation": "src/lib/pil/agents/sup/BEN-SUP-02.ts:261-272 plan built; :304-312 return conclusions:{plan,infeasibleDimensions}; :193 no-active-sources skip via completed() at :332-341 conclusions:{skipped:true,reason,...}",
    "reason": null
  },
  {
    "agentType": "BEN-SUP-03",
    "modulePath": "src/lib/pil/agents/sup/BEN-SUP-03.ts",
    "family": "pil",
    "locatable": true,
    "table": "pil_agent_runs",
    "primaryColumn": "output.stageStatuses",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "agent_id=eq.BEN-SUP-03",
    "evidenceColumns": [
      "output.decisions"
    ],
    "citation": "src/lib/pil/agents/sup/BEN-SUP-03.ts:270-274 conclusions:{stageStatuses,decisions,allComplete}",
    "reason": null
  },
  {
    "agentType": "BEN-SUP-04",
    "modulePath": "src/lib/pil/agents/sup/BEN-SUP-04.ts",
    "family": "pil",
    "locatable": true,
    "table": "pil_agent_runs",
    "primaryColumn": "output.scored",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "agent_id=eq.BEN-SUP-04",
    "evidenceColumns": [
      "output.decisions"
    ],
    "citation": "src/lib/pil/agents/sup/BEN-SUP-04.ts:240-247 conclusions:{scored,constrained,decisions}; skip-on-evidence-load-failure shape at :120-134 conclusions:{allocationSkippedThisCycle:true,reason,failedProspectIds}",
    "reason": null
  },
  {
    "agentType": "BEN-SUP-05",
    "modulePath": "src/lib/pil/agents/sup/BEN-SUP-05.ts",
    "family": "pil",
    "locatable": true,
    "table": "pil_agent_runs",
    "primaryColumn": "output.report",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "agent_id=eq.BEN-SUP-05",
    "evidenceColumns": [
      "output.report.claims",
      "output.report.summary",
      "output.report.verdict"
    ],
    "citation": "src/lib/pil/agents/sup/BEN-SUP-05.ts:150-158 report built (CriticReport{targetAgentRunId,prospectId,claims,duplicateIdentityRisk,relationshipIssues,verdict,summary}); :193-201 return conclusions:{report}",
    "reason": null
  },
  {
    "agentType": "BEN-SUP-06",
    "modulePath": "src/lib/pil/agents/sup/BEN-SUP-06.ts",
    "family": "pil",
    "locatable": true,
    "table": "pil_agent_runs",
    "primaryColumn": "output.plan",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "agent_id=eq.BEN-SUP-06",
    "evidenceColumns": [
      "output.plan.detail"
    ],
    "citation": "src/lib/pil/agents/sup/BEN-SUP-06.ts:189-197 conclusions:{plan,newResearchRunId,lastStep,failingAgentRun,idempotencyStatus}; plan:RecoveryPlan{failedResearchRunId,failureClass,failedAgentId,action,detail}",
    "reason": null
  },
  {
    "agentType": "BEN-SUP-07",
    "modulePath": "src/lib/pil/agents/sup/BEN-SUP-07.ts",
    "family": "pil",
    "locatable": true,
    "table": "pil_agent_runs",
    "primaryColumn": "output.violations",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "agent_id=eq.BEN-SUP-07",
    "evidenceColumns": [
      "output.violations"
    ],
    "citation": "src/lib/pil/agents/sup/BEN-SUP-07.ts:168-176 conclusions:{violations,terminatedRunIds,sweepScope:{activeRuns,activeDelegations,killSwitches}}",
    "reason": null
  },
  {
    "agentType": "BEN-SUP-08",
    "modulePath": "src/lib/pil/agents/sup/BEN-SUP-08.ts",
    "family": "pil",
    "locatable": true,
    "table": "pil_agent_runs",
    "primaryColumn": "output.dossier",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "agent_id=eq.BEN-SUP-08",
    "evidenceColumns": [
      "output.dossier.verifiedFacts",
      "output.dossier.inferences",
      "output.dossier.overallConfidence"
    ],
    "citation": "src/lib/pil/agents/sup/BEN-SUP-08.ts:122-130 dossier built (ProspectDossier{prospectId,researchRunId,verifiedFacts,inferences,relationshipPathways,recommendedNextActions,overallConfidence}); :153-160 return conclusions:{dossier,narrativeText,dossierId,version}",
    "reason": null
  },
  {
    "agentType": "BEN-DIS-01",
    "modulePath": "src/lib/pil/agents/dis/BEN-DIS-01.ts",
    "family": "pil",
    "locatable": true,
    "table": "pil_agent_runs",
    "primaryColumn": "output.criteria",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "agent_id=eq.BEN-DIS-01",
    "evidenceColumns": [
      "output.discoveries"
    ],
    "citation": "src/lib/pil/agents/dis/BEN-DIS-01.ts:205-213 conclusions:{criteria,discoveredProspectIds,discoveries}; empty-goal skip at :51-60 conclusions:{skipped:true,reason}",
    "reason": null
  },
  {
    "agentType": "BEN-DIS-02",
    "modulePath": "src/lib/pil/agents/dis/BEN-DIS-02.ts",
    "family": "pil",
    "locatable": true,
    "table": "pil_agent_runs",
    "primaryColumn": "output.criteria",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "agent_id=eq.BEN-DIS-02",
    "evidenceColumns": [
      "output.discoveries"
    ],
    "citation": "src/lib/pil/agents/dis/BEN-DIS-02.ts:298-308 conclusions:{criteria,capacityThreshold,flaggedForDeepCapacityResearch,discoveries,reclassifiedLowerPriority,excludedOrganizationNames}; empty-goal skip :75-85",
    "reason": null
  },
  {
    "agentType": "BEN-DIS-03",
    "modulePath": "src/lib/pil/agents/dis/BEN-DIS-03.ts",
    "family": "pil",
    "locatable": true,
    "table": "pil_agent_runs",
    "primaryColumn": "output.criteria",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "agent_id=eq.BEN-DIS-03",
    "evidenceColumns": [
      "output.discoveries"
    ],
    "citation": "src/lib/pil/agents/dis/BEN-DIS-03.ts:303-310 conclusions:{criteria,discoveredProspectIds,discoveries} (discoveries carry lifecycleStatus); lookup-failure zero-result shape (no skipped flag) at :91-99; empty-goal skip :65-75",
    "reason": null
  },
  {
    "agentType": "BEN-DIS-04",
    "modulePath": "src/lib/pil/agents/dis/BEN-DIS-04.ts",
    "family": "pil",
    "locatable": true,
    "table": "pil_agent_runs",
    "primaryColumn": "output.criteria",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "agent_id=eq.BEN-DIS-04",
    "evidenceColumns": [
      "output.discoveries"
    ],
    "citation": "src/lib/pil/agents/dis/BEN-DIS-04.ts:285-298 conclusions:{criteria,discoveredProspectIds,discoveries,companyProspectIds}; failed-with-partial-progress shape (status:'failed', same conclusions fields) at :319-328; empty-goal skip :85-95",
    "reason": null
  },
  {
    "agentType": "BEN-DIS-05",
    "modulePath": "src/lib/pil/agents/dis/BEN-DIS-05.ts",
    "family": "pil",
    "locatable": true,
    "table": "pil_agent_runs",
    "primaryColumn": "output.criteria",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "agent_id=eq.BEN-DIS-05",
    "evidenceColumns": [
      "output.discoveries"
    ],
    "citation": "src/lib/pil/agents/dis/BEN-DIS-05.ts:246-254 conclusions:{criteria,discoveredProspectIds,discoveries} (discoveries carry boardInvolvementFlagged); empty-goal skip :58-68",
    "reason": null
  },
  {
    "agentType": "BEN-DIS-06",
    "modulePath": "src/lib/pil/agents/dis/BEN-DIS-06.ts",
    "family": "pil",
    "locatable": true,
    "table": "pil_agent_runs",
    "primaryColumn": "output.criteria",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "agent_id=eq.BEN-DIS-06",
    "evidenceColumns": [
      "output.discoveries"
    ],
    "citation": "src/lib/pil/agents/dis/BEN-DIS-06.ts:312-322 conclusions:{criteria,resolvedGeography,discoveredProspectIds,discoveries,sourceDiversityNote,lowDataGeographyRisk}; empty-goal skip :61-71",
    "reason": null
  },
  {
    "agentType": "BEN-DIS-07",
    "modulePath": "src/lib/pil/agents/dis/BEN-DIS-07.ts",
    "family": "pil",
    "locatable": true,
    "table": "pil_agent_runs",
    "primaryColumn": "output.criteria",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "agent_id=eq.BEN-DIS-07",
    "evidenceColumns": [
      "output.discoveries"
    ],
    "citation": "src/lib/pil/agents/dis/BEN-DIS-07.ts:294-304 conclusions:{criteria,cause,discoveredProspectIds,discoveries,staleSignalOnly,sensitiveInferenceExcluded}; empty-goal skip :95-105",
    "reason": null
  },
  {
    "agentType": "BEN-DIS-08",
    "modulePath": "src/lib/pil/agents/dis/BEN-DIS-08.ts",
    "family": "pil",
    "locatable": true,
    "table": "pil_agent_runs",
    "primaryColumn": "output.crmFundersScanned",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "agent_id=eq.BEN-DIS-08",
    "evidenceColumns": [
      "output.reclassificationFlags"
    ],
    "citation": "src/lib/pil/agents/dis/BEN-DIS-08.ts:483-495 conclusions:{crmFundersScanned,crmContactsScanned,linkedProspectIds,newlyCreatedProspectIds,reclassificationFlags,entityResolutionCandidateProspectIds}; zero-CRM-rows skip at :176-186 conclusions:{skipped:true,reason}. Note: its one real lifetime run's output:null was a stuck-run-watchdog timeout, not this skip shape.",
    "reason": null
  },
  {
    "agentType": "BEN-INT-01",
    "modulePath": "src/lib/pil/agents/int/BEN-INT-01.ts",
    "family": "pil",
    "locatable": true,
    "table": "pil_agent_runs",
    "primaryColumn": "output.report",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "agent_id=eq.BEN-INT-01",
    "evidenceColumns": [
      "output.report.delegationsIssued"
    ],
    "citation": "src/lib/pil/agents/int/BEN-INT-01.ts:186-191 report:IndividualIntelligenceReport{prospectId,dimensionCoverage,evidenceCreatedThisRun,delegationsIssued}; :333-341 conclusions:{report}; non-individual-entity_type skip at :58-60 via completedEmpty() :344-354 conclusions:{skipped:true,reason}",
    "reason": null
  },
  {
    "agentType": "BEN-INT-02",
    "modulePath": "src/lib/pil/agents/int/BEN-INT-02.ts",
    "family": "pil",
    "locatable": true,
    "table": "pil_agent_runs",
    "primaryColumn": "output.report",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "agent_id=eq.BEN-INT-02",
    "evidenceColumns": [
      "output.report.delegationsIssued"
    ],
    "citation": "src/lib/pil/agents/int/BEN-INT-02.ts:150-156 report:EmploymentCareerIntelligenceReport{dimensionCoverage,evidenceCreatedThisRun,delegationsIssued,employmentRecordsFound}; :267-275 conclusions:{report}",
    "reason": null
  },
  {
    "agentType": "BEN-INT-03",
    "modulePath": "src/lib/pil/agents/int/BEN-INT-03.ts",
    "family": "pil",
    "locatable": true,
    "table": "pil_agent_runs",
    "primaryColumn": "output.report",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "agent_id=eq.BEN-INT-03",
    "evidenceColumns": [
      "output.report.delegationsIssued"
    ],
    "citation": "src/lib/pil/agents/int/BEN-INT-03.ts:152-158 report:BusinessOwnershipIntelligenceReport{dimensionCoverage,evidenceCreatedThisRun,delegationsIssued,ownershipMentionsFound}; :259-267 conclusions:{report}",
    "reason": null
  },
  {
    "agentType": "BEN-INT-04",
    "modulePath": "src/lib/pil/agents/int/BEN-INT-04.ts",
    "family": "pil",
    "locatable": true,
    "table": "pil_agent_runs",
    "primaryColumn": "output.report",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "agent_id=eq.BEN-INT-04",
    "evidenceColumns": [
      "output.report.delegationsIssued"
    ],
    "citation": "src/lib/pil/agents/int/BEN-INT-04.ts:153-159 report:EducationAlumniIntelligenceReport{dimensionCoverage,evidenceCreatedThisRun,delegationsIssued,educationMentionsFound}; :244-252 conclusions:{report}",
    "reason": null
  },
  {
    "agentType": "BEN-INT-05",
    "modulePath": "src/lib/pil/agents/int/BEN-INT-05.ts",
    "family": "pil",
    "locatable": true,
    "table": "pil_agent_runs",
    "primaryColumn": "output.report",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "agent_id=eq.BEN-INT-05",
    "evidenceColumns": [
      "output.report.delegationsIssued"
    ],
    "citation": "src/lib/pil/agents/int/BEN-INT-05.ts:171-177 report:NonprofitBoardIntelligenceReport{dimensionCoverage,evidenceCreatedThisRun,delegationsIssued,boardMentionsFound}; :271-279 conclusions:{report}",
    "reason": null
  },
  {
    "agentType": "BEN-INT-06",
    "modulePath": "src/lib/pil/agents/int/BEN-INT-06.ts",
    "family": "pil",
    "locatable": true,
    "table": "pil_agent_runs",
    "primaryColumn": "output.report",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "agent_id=eq.BEN-INT-06",
    "evidenceColumns": [
      "output.report.delegationsIssued"
    ],
    "citation": "src/lib/pil/agents/int/BEN-INT-06.ts:238-244 report:FoundationIntelligenceReport{prospectId,ein,dimensionCoverage,evidenceCreatedThisRun,delegationsIssued}; :344-352 conclusions:{report}; non-foundation entity_type skip :79-81",
    "reason": null
  },
  {
    "agentType": "BEN-INT-07",
    "modulePath": "src/lib/pil/agents/int/BEN-INT-07.ts",
    "family": "pil",
    "locatable": true,
    "table": "pil_agent_runs",
    "primaryColumn": "output.report",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "agent_id=eq.BEN-INT-07",
    "evidenceColumns": [
      "output.report.delegationsIssued"
    ],
    "citation": "src/lib/pil/agents/int/BEN-INT-07.ts:195-201 report:GivingHistoryIntelligenceReport{dimensionCoverage,evidenceCreatedThisRun,delegationsIssued,givingMentionsFound}; :276-284 conclusions:{report}",
    "reason": null
  },
  {
    "agentType": "BEN-INT-08",
    "modulePath": "src/lib/pil/agents/int/BEN-INT-08.ts",
    "family": "pil",
    "locatable": true,
    "table": "pil_agent_runs",
    "primaryColumn": "output.report",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "agent_id=eq.BEN-INT-08",
    "evidenceColumns": [
      "output.report.uncertainties",
      "output.report.delegationsIssued"
    ],
    "citation": "src/lib/pil/agents/int/BEN-INT-08.ts:63-74 report:WealthCapacityIntelligenceReport{dimensionCoverage,evidenceCreatedThisRun,delegationsIssued,wealth:{low,high},liquidity,philanthropicCapacity:{low,high},propensity,uncertainties,escalatedForReview}; :241-252/254-262 conclusions:{report}; gap_analysis_failed skip at :277-285 conclusions:{skipped:true,reason:'gap_analysis_failed',error}. Key answer fields: wealth, philanthropicCapacity, propensity.",
    "reason": null
  },
  {
    "agentType": "BEN-INT-09",
    "modulePath": "src/lib/pil/agents/int/BEN-INT-09.ts",
    "family": "pil",
    "locatable": true,
    "table": "pil_agent_runs",
    "primaryColumn": "output.report",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "agent_id=eq.BEN-INT-09",
    "evidenceColumns": [
      "output.report.delegationsIssued"
    ],
    "citation": "src/lib/pil/agents/int/BEN-INT-09.ts:70-77 report:WealthOriginLiquidityEventReport{dimensionCoverage,evidenceCreatedThisRun,delegationsIssued,chainsBuilt,ownedCompaniesFound}; :309-316 conclusions:{report}",
    "reason": null
  },
  {
    "agentType": "BEN-INT-10",
    "modulePath": "src/lib/pil/agents/int/BEN-INT-10.ts",
    "family": "pil",
    "locatable": true,
    "table": "pil_agent_runs",
    "primaryColumn": "output.report",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "agent_id=eq.BEN-INT-10",
    "evidenceColumns": [
      "output.report.delegationsIssued"
    ],
    "citation": "src/lib/pil/agents/int/BEN-INT-10.ts:103-110 report:ContactIntelligenceReport{dimensionCoverage,evidenceCreatedThisRun,delegationsIssued,channelsFound,noPermissibleChannelFound}; :308-315 conclusions:{report}",
    "reason": null
  },
  {
    "agentType": "BEN-REL-01",
    "modulePath": "src/lib/pil/agents/rel/BEN-REL-01.ts",
    "family": "pil",
    "locatable": true,
    "table": "pil_agent_runs",
    "primaryColumn": "output.prospectId",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "agent_id=eq.BEN-REL-01",
    "evidenceColumns": [
      "output.decision.strengthEvidence",
      "output.decision.alternativeExplanations"
    ],
    "citation": "src/lib/pil/agents/rel/BEN-REL-01.ts:283-290 decision:{relationshipType,sourceAndDirection,timeInterval,directness,strengthEvidence,alternativeExplanations}; :292-302 conclusions{...,decision}",
    "reason": null
  },
  {
    "agentType": "BEN-REL-02",
    "modulePath": "src/lib/pil/agents/rel/BEN-REL-02.ts",
    "family": "pil",
    "locatable": true,
    "table": "pil_agent_runs",
    "primaryColumn": "output.prospectId",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "agent_id=eq.BEN-REL-02",
    "evidenceColumns": [
      "output.rankedPaths",
      "output.decision"
    ],
    "citation": "src/lib/pil/agents/rel/BEN-REL-02.ts:243-250 decision:{sharedOrganization,boardType,overlapInterval,roleCompatibility,pathLength,relationshipLimitations}; :254-264 conclusions{...,decision}",
    "reason": null
  },
  {
    "agentType": "BEN-REL-03",
    "modulePath": "src/lib/pil/agents/rel/BEN-REL-03.ts",
    "family": "pil",
    "locatable": true,
    "table": "pil_agent_runs",
    "primaryColumn": "output.tenantNodeId",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "agent_id=eq.BEN-REL-03",
    "evidenceColumns": [
      "output.decision.roleOwnershipLinkage"
    ],
    "citation": "src/lib/pil/agents/rel/BEN-REL-03.ts:385-392 decision:{companyLegalIdentity,roleOwnershipLinkage,subsidiaryParentBoundaries,sharedEmploymentInterval,commercialVersusPhilanthropicContext,decisionAuthorityUncertainty}; :394-403 conclusions{...,decision}; no-corporate-funders skip :114-116",
    "reason": null
  },
  {
    "agentType": "BEN-REL-04",
    "modulePath": "src/lib/pil/agents/rel/BEN-REL-04.ts",
    "family": "pil",
    "locatable": true,
    "table": "pil_agent_runs",
    "primaryColumn": "output.organizationsScanned",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "agent_id=eq.BEN-REL-04",
    "evidenceColumns": [
      "output.decision.overlapConfidence"
    ],
    "citation": "src/lib/pil/agents/rel/BEN-REL-04.ts:305-314 decision:{overlapInstitution,roleType,simultaneity,recurrence,interactionEvidence,overlapConfidence}; :316-324 conclusions:{organizationsScanned,overlapEdgeIds,ambiguousEdgeCount,decision}; no-org-nodes skip :123-125",
    "reason": null
  },
  {
    "agentType": "BEN-REL-05",
    "modulePath": "src/lib/pil/agents/rel/BEN-REL-05.ts",
    "family": "pil",
    "locatable": true,
    "table": "pil_agent_runs",
    "primaryColumn": "output.prospectId",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "agent_id=eq.BEN-REL-05",
    "evidenceColumns": [
      "output.rankedPaths",
      "output.decision"
    ],
    "citation": "src/lib/pil/agents/rel/BEN-REL-05.ts:274-284 decision:{sourceNodeAuthorization,targetIdentity,edgeValidity,pathLength,edgeStrength,introductionFeasibility}; :286-296 conclusions{...,decision}",
    "reason": null
  },
  {
    "agentType": "BEN-REL-06",
    "modulePath": "src/lib/pil/agents/rel/BEN-REL-06.ts",
    "family": "pil",
    "locatable": true,
    "table": "pil_agent_runs",
    "primaryColumn": "output.prospectId",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "agent_id=eq.BEN-REL-06",
    "evidenceColumns": [
      "output.factorsByEdgeId",
      "output.decisionDimensions"
    ],
    "citation": "src/lib/pil/agents/rel/BEN-REL-06.ts:297-312 decisionDimensions per edge {recency,frequency,duration,directInteraction,mutuality,contextRelevance}; :319-327 conclusions{...}",
    "reason": null
  },
  {
    "agentType": "BEN-REL-07",
    "modulePath": "src/lib/pil/agents/rel/BEN-REL-07.ts",
    "family": "pil",
    "locatable": true,
    "table": "pil_agent_runs",
    "primaryColumn": "output.prospectId",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "agent_id=eq.BEN-REL-07",
    "evidenceColumns": [],
    "citation": "src/lib/pil/agents/rel/BEN-REL-07.ts:354-365 conclusions:{prospectId,ein,trusteeNames,trusteeEdgeIds,familyEdgeIds,grantRecipientEdgeIds,coFunderEdgeIds}; non-foundation entity_type skip :106-108",
    "reason": null
  },
  {
    "agentType": "BEN-REL-08",
    "modulePath": "src/lib/pil/agents/rel/BEN-REL-08.ts",
    "family": "pil",
    "locatable": true,
    "table": "pil_agent_runs",
    "primaryColumn": "output.prospectId",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "agent_id=eq.BEN-REL-08",
    "evidenceColumns": [],
    "citation": "src/lib/pil/agents/rel/BEN-REL-08.ts:159-167 conclusions:{prospectId,newEdgeIds,delegatedColleagueMapping}",
    "reason": null
  },
  {
    "agentType": "BEN-QLF-01",
    "modulePath": "src/lib/pil/agents/qlf/BEN-QLF-01.ts",
    "family": "pil",
    "locatable": true,
    "table": "pil_agent_runs",
    "primaryColumn": "output.report",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "agent_id=eq.BEN-QLF-01",
    "evidenceColumns": [
      "output.report.evidenceRefs",
      "output.report.counterevidence",
      "output.report.unscoredDimensions"
    ],
    "citation": "src/lib/pil/agents/qlf/BEN-QLF-01.ts:101-116 report:MissionAffinityReport{causeAlignmentScore,populationAlignmentScore,programAlignmentScore,geographicAlignmentScore,recencyScore,overallScore,counterevidence,unscoredDimensions,evidenceRefs,confidence,delegatedToKnw03/Int07/Int06}; :275-300 conclusions:{report}",
    "reason": null
  },
  {
    "agentType": "BEN-QLF-02",
    "modulePath": "src/lib/pil/agents/qlf/BEN-QLF-02.ts",
    "family": "pil",
    "locatable": true,
    "table": "pil_agent_runs",
    "primaryColumn": "output.report",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "agent_id=eq.BEN-QLF-02",
    "evidenceColumns": [
      "output.report.disqualifyingReasons",
      "output.report.evidenceRefs"
    ],
    "citation": "src/lib/pil/agents/qlf/BEN-QLF-02.ts:212-228 report:FundingEligibilityReport{eligible,applicantClassPass,taxStatusPass,geographyPass,programRestrictionsPass,deadlineWindowPass,prerequisitesPass,disqualifyingReasons,fundingEligibilityScore,evidenceRefs,confidence,delegatedTo...}; :358-384 conclusions:{report}",
    "reason": null
  },
  {
    "agentType": "BEN-QLF-03",
    "modulePath": "src/lib/pil/agents/qlf/BEN-QLF-03.ts",
    "family": "pil",
    "locatable": true,
    "table": "pil_agent_runs",
    "primaryColumn": "output.report",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "agent_id=eq.BEN-QLF-03",
    "evidenceColumns": [
      "output.report.uncertaintyNotes",
      "output.report.evidenceRefs"
    ],
    "citation": "src/lib/pil/agents/qlf/BEN-QLF-03.ts:111-131 report:CapacityPropensityReport{capacityEstimateLow,capacityEstimateHigh,capacityConfidence,propensityScore,propensityConfidence,giftMagnitudePattern,vehicleUse,causeRelevanceScore,uncertaintyNotes,evidenceRefs,delegatedTo...}; :383-410 conclusions:{report}",
    "reason": null
  },
  {
    "agentType": "BEN-QLF-04",
    "modulePath": "src/lib/pil/agents/qlf/BEN-QLF-04.ts",
    "family": "pil",
    "locatable": true,
    "table": "pil_agent_runs",
    "primaryColumn": "output.report",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "agent_id=eq.BEN-QLF-04",
    "evidenceColumns": [
      "output.report.disqualificationReasons",
      "output.report.recommendedNextAgents"
    ],
    "citation": "src/lib/pil/agents/qlf/BEN-QLF-04.ts:206-218 report:QualificationReport{dimensionScores,overallScore,classification,decision,disqualificationReasons,belowThresholdDimensions,recommendedNextAgents,criticDelegated,humanReviewCreated,confidence}; :503-526 conclusions:{report}. classification/decision are the primary answer.",
    "reason": null
  },
  {
    "agentType": "BEN-QLF-05",
    "modulePath": "src/lib/pil/agents/qlf/BEN-QLF-05.ts",
    "family": "pil",
    "locatable": true,
    "table": "pil_agent_runs",
    "primaryColumn": "output.report",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "agent_id=eq.BEN-QLF-05",
    "evidenceColumns": [
      "output.report.unscoredDimensions",
      "output.report.evidenceRefs"
    ],
    "citation": "src/lib/pil/agents/qlf/BEN-QLF-05.ts:184-200 report:TimingReadinessReport{timingStatus,applicationWindowOpen,triggerRecencyDays,relationshipMaturityScore,tenantReadinessScore,documentReadinessScore,monitorConditions,stalenessFlags,unscoredDimensions,evidenceRefs,confidence,delegatedTo...}; :359-386 conclusions:{report}",
    "reason": null
  },
  {
    "agentType": "BEN-KNW-01",
    "modulePath": "src/lib/pil/agents/knw/BEN-KNW-01.ts",
    "family": "pil",
    "locatable": true,
    "table": "pil_agent_runs",
    "primaryColumn": "output.report",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "agent_id=eq.BEN-KNW-01",
    "evidenceColumns": [
      "output.report.conflictedFields",
      "output.report.researchGaps"
    ],
    "citation": "src/lib/pil/agents/knw/BEN-KNW-01.ts:97-104 report:DigitalTwinReport{twinVersion,completenessScore,conflictedFields,researchGaps,contradictionsOpen}; :289-321 conclusions:{report}",
    "reason": null
  },
  {
    "agentType": "BEN-KNW-02",
    "modulePath": "src/lib/pil/agents/knw/BEN-KNW-02.ts",
    "family": "pil",
    "locatable": true,
    "table": "pil_agent_runs",
    "primaryColumn": "output.results",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "agent_id=eq.BEN-KNW-02",
    "evidenceColumns": [
      "output.results.signals"
    ],
    "citation": "src/lib/pil/agents/knw/BEN-KNW-02.ts:70-80 results:EntityResolutionPairResult[]{prospectIdA,prospectIdB,matchScore,status,signals,merged,survivingProspectId,requiresHumanReview,candidateId}; :161-169 conclusions:{results}; missing-plan.prospectIds skip at :112-113 via completedEmpty() :418-427 conclusions:{skipped:true,reason:'BEN-KNW-02 requires context.plan.prospectIds with at least 2 candidate prospect ids'} -- matches census's one observed run.",
    "reason": null
  },
  {
    "agentType": "BEN-KNW-03",
    "modulePath": "src/lib/pil/agents/knw/BEN-KNW-03.ts",
    "family": "pil",
    "locatable": true,
    "table": "pil_agent_runs",
    "primaryColumn": "output.report",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "agent_id=eq.BEN-KNW-03",
    "evidenceColumns": [
      "output.report.unsupportedClaims",
      "output.report.permissibilityFlagged"
    ],
    "citation": "src/lib/pil/agents/knw/BEN-KNW-03.ts:221-239 report:EvidenceProvenanceReport{evidenceScanned,staleFlagged,agingFlagged,contradictionsFound,contradictionsRecorded,tamperingFlagged,unsupportedClaims,evidenceQualityScore,claimSupportScore,sourceDirectnessScore,sourceIndependenceScore,permissibilityFlagged}; :355-413 conclusions:{report}; no-evidence skip via completedEmpty() at :248-250",
    "reason": null
  },
  {
    "agentType": "BEN-KNW-04",
    "modulePath": "src/lib/pil/agents/knw/BEN-KNW-04.ts",
    "family": "pil",
    "locatable": true,
    "table": "pil_agent_runs",
    "primaryColumn": "output.report",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "agent_id=eq.BEN-KNW-04",
    "evidenceColumns": [
      "output.report.tierImpactingCanonicalChanges"
    ],
    "citation": "src/lib/pil/agents/knw/BEN-KNW-04.ts:204-215 report:ContradictionFreshnessReport{contradictionsProcessed,resolvedA,resolvedB,resolvedBothStale,unresolved,claimTypeStaleFlagged,tierImpactingCanonicalChanges,humanReviewCreated}; :369-405 conclusions:{report}; no-open-contradictions-and-no-stale-evidence skip at :231-236",
    "reason": null
  },
  {
    "agentType": "BEN-STR-01",
    "modulePath": "src/lib/pil/agents/str/BEN-STR-01.ts",
    "family": "pil",
    "locatable": true,
    "table": "pil_agent_runs",
    "primaryColumn": "output.report",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "agent_id=eq.BEN-STR-01",
    "evidenceColumns": [
      "output.report.riskReasons"
    ],
    "citation": "src/lib/pil/agents/str/BEN-STR-01.ts:100-116 report:EngagementStrategyReport{objective,prospectContext,relationshipPathScore,messageThemes,channels,riskFlagged,riskReasons,humanReviewCreated,engagementStrategy}; :226-252 conclusions:{report}; missing-opportunity skip (no pil_prospect_opportunities row yet, i.e. BEN-QLF-04 not run) at :124-130",
    "reason": null
  },
  {
    "agentType": "BEN-STR-02",
    "modulePath": "src/lib/pil/agents/str/BEN-STR-02.ts",
    "family": "pil",
    "locatable": true,
    "table": "pil_agent_runs",
    "primaryColumn": "output.report",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "agent_id=eq.BEN-STR-02",
    "evidenceColumns": [],
    "citation": "src/lib/pil/agents/str/BEN-STR-02.ts:84-96 report:BestFirstAskReport{askType,capacityScore,propensityScore,missionAffinityScore,recommendedAskLow,recommendedAskHigh,relationshipStage,fallbackAsks,humanReviewCreated}; :226-248 conclusions:{report}; missing-opportunity skip :140-146",
    "reason": null
  },
  {
    "agentType": "BEN-STR-03",
    "modulePath": "src/lib/pil/agents/str/BEN-STR-03.ts",
    "family": "pil",
    "locatable": true,
    "table": "pil_agent_runs",
    "primaryColumn": "output.report",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "agent_id=eq.BEN-STR-03",
    "evidenceColumns": [
      "output.report.contentEvidenceNeeds"
    ],
    "citation": "src/lib/pil/agents/str/BEN-STR-03.ts:125-135 report:CultivationStrategyReport{planId,stages,milestones,contentEvidenceNeeds,reassessmentGates,planHorizonDays,nextReassessmentAt}; :220-240 conclusions:{report}; missing-opportunity skip :143-149",
    "reason": null
  },
  {
    "agentType": "BEN-STR-04",
    "modulePath": "src/lib/pil/agents/str/BEN-STR-04.ts",
    "family": "pil",
    "locatable": true,
    "table": "pil_agent_runs",
    "primaryColumn": "output.recommendation",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "agent_id=eq.BEN-STR-04",
    "evidenceColumns": [
      "output.recommendation.risk"
    ],
    "citation": "src/lib/pil/agents/str/BEN-STR-04.ts:156-164 recommendation:NextBestActionRecommendation{opportunityId,prospectId,action,expectedValueGain,risk,cost,reviewCreated}; single-prospect return at :242-250 conclusions:{recommendation}; org-wide return at :266-274 conclusions:{recommendations,batchCapped}; no-open-opportunity 'wait' shape at :343-364 conclusions:{recommendation:{...action:'wait'...},reason:'No open pil_prospect_opportunities row exists...nothing to act on yet'} -- matches census's one observed run.",
    "reason": null
  },
  {
    "agentType": "BEN-OPS-01",
    "modulePath": "src/lib/pil/agents/ops/BEN-OPS-01.ts",
    "family": "pil",
    "locatable": true,
    "table": "pil_agent_runs",
    "primaryColumn": "output.mode",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "agent_id=eq.BEN-OPS-01",
    "evidenceColumns": [
      "output.proposals"
    ],
    "citation": "src/lib/pil/agents/ops/BEN-OPS-01.ts:82-87 proposals:LearningProposal[]{agentCode,issue,recommendation,severity}; :226-234 conclusions:{mode,windowDays,agentsEvaluated,proposals,fleetMedianCostUsd}. Zero lifetime runs per census; n=0 is a legitimate finding, not unlocatable.",
    "reason": null
  },
  {
    "agentType": "BEN-APP-01",
    "modulePath": "src/lib/pil/agents/app/BEN-APP-01.ts",
    "family": "pil",
    "locatable": true,
    "table": "pil_agent_runs",
    "primaryColumn": "output.report",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "agent_id=eq.BEN-APP-01",
    "evidenceColumns": [
      "output.report.recommendations",
      "output.report.fallbackDimensions"
    ],
    "citation": "src/lib/pil/agents/app/BEN-APP-01.ts:290-297 report:ApplicationProfileReport{recommendations,dimensionScores,fallbackDimensions,reviewsCreated} where recommendations:ApplicationRecommendation[]{requestType,requestProfileId,successProbability,recommendationStatus,strategicReasoning,fieldMappings,pitchParameters,riskFactors,relationshipStrategy,confidence,sequence}; :547-565 conclusions:{report}; no-prospectId/no-active-profiles/no-matched-profiles skips at :302,313,397-405",
    "reason": null
  },
  {
    "agentType": "BEN-APP-02",
    "modulePath": "src/lib/pil/agents/app/BEN-APP-02.ts",
    "family": "pil",
    "locatable": true,
    "table": "pil_agent_runs",
    "primaryColumn": "output.report",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "agent_id=eq.BEN-APP-02",
    "evidenceColumns": [
      "output.report.ranked"
    ],
    "citation": "src/lib/pil/agents/app/BEN-APP-02.ts:255-270 report:PriorityRankingReport{totalRanked,ranked,naturalBreakpoint,lowConfidenceRefreshCount,reviewsCreated} where ranked[]:{priorityScore,priorityPercentile,priorityRecommendation,scoreBreakdown,reasoning,nextStep}; :500-517 conclusions:{report}; no-application-profiles-yet skip via completed({ranked:[]}, reason) at :275-277",
    "reason": null
  },
  {
    "agentType": "BEN-APP-03",
    "modulePath": "src/lib/pil/agents/app/BEN-APP-03.ts",
    "family": "pil",
    "locatable": true,
    "table": "pil_agent_runs",
    "primaryColumn": "output.report",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "agent_id=eq.BEN-APP-03",
    "evidenceColumns": [
      "output.report.submissionActions"
    ],
    "citation": "src/lib/pil/agents/app/BEN-APP-03.ts:240-253 report:SubmissionOrchestratorReport{submissionSummary,submissionActions,batchCapped,escalatedStaleLegacyQueueItems}; :511-534 conclusions:{report,legacyQueueItemsCreated,reviewsCreated}; no-pil_priority_scores-rows-yet skip at :258-259. Zero lifetime runs per census; n=0 is a legitimate finding, not unlocatable.",
    "reason": null
  },
  {
    "agentType": "autoapply_queue_processor",
    "modulePath": "worker/queue-processor.ts",
    "family": "autoapply",
    "locatable": true,
    "table": "submission_queue",
    "primaryColumn": "status",
    "valueType": "jsonb",
    "dateColumn": "completed_at",
    "orgIdColumn": "organization_id",
    "agentFilter": null,
    "evidenceColumns": [
      "error_message"
    ],
    "citation": "worker/queue-processor.ts:384-387 update({status:'completed',completed_at}); :409-412 status:'skipped'; :484-487 status:'failed'",
    "reason": null
  },
  {
    "agentType": "autoapply_submission_validator",
    "modulePath": "src/lib/autoapply/submission-validator.ts",
    "family": "autoapply",
    "locatable": false,
    "reason": "checkOrgReadiness()'s ReadinessReport is cached only in-memory (worker/queue-processor.ts:804-829, a JS Map), never persisted to any table; module has zero insert/update/upsert calls"
  },
  {
    "agentType": "autoapply_pitch_personalizer",
    "modulePath": "src/lib/autoapply/pitch-personalizer.ts",
    "family": "autoapply",
    "locatable": true,
    "table": "autoapply_submissions",
    "primaryColumn": "personalized_pitch",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": null,
    "evidenceColumns": [],
    "citation": "worker/queue-processor.ts:1728 supabase.from('autoapply_submissions').insert({..., personalized_pitch})",
    "reason": null
  },
  {
    "agentType": "autoapply_form_filler",
    "modulePath": "src/lib/autoapply/form-filler-agent.ts",
    "family": "autoapply",
    "locatable": true,
    "table": "autoapply_submissions",
    "primaryColumn": "status",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": null,
    "evidenceColumns": [
      "error_message"
    ],
    "citation": "worker/queue-processor.ts:1716-1737 supabase.from('autoapply_submissions').insert({status, request_description, confirmation_number, confirmation_screenshot_url, ...})",
    "reason": null
  },
  {
    "agentType": "autoapply_captcha_solver",
    "modulePath": "src/lib/autoapply/captcha-solver.ts",
    "family": "autoapply",
    "locatable": true,
    "table": "submission_queue",
    "primaryColumn": "status",
    "valueType": "jsonb",
    "dateColumn": "paused_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "status=eq.paused_verification",
    "evidenceColumns": [
      "paused_history"
    ],
    "citation": "worker/queue-processor.ts:461-473 supabase.from('submission_queue').update({status:'paused_verification', pause_reason, paused_at, paused_screenshot_path, paused_history})",
    "reason": null
  },
  {
    "agentType": "autoapply_confirmation_parser",
    "modulePath": "src/lib/autoapply/confirmation-parser.ts",
    "family": "autoapply",
    "locatable": true,
    "table": "autoapply_submissions",
    "primaryColumn": "confirmation_data",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": null,
    "evidenceColumns": [
      "confirmation_data"
    ],
    "citation": "worker/queue-processor.ts:1727 supabase.from('autoapply_submissions').insert({..., confirmation_data})",
    "reason": null
  },
  {
    "agentType": "autoapply_form_analyzer",
    "modulePath": "src/lib/autoapply/form-analyzer-agent.ts",
    "family": "autoapply",
    "locatable": true,
    "table": "form_templates",
    "primaryColumn": "form_structure",
    "valueType": "jsonb",
    "dateColumn": "last_verified_at",
    "orgIdColumn": "organization_id",
    "agentFilter": null,
    "evidenceColumns": [
      "automation_assessment"
    ],
    "citation": "src/lib/autoapply/form-analyzer-agent.ts:270-286 supabase.from('form_templates').insert({...}).select('id').single()",
    "reason": null
  },
  {
    "agentType": "autoapply_registration",
    "modulePath": "src/lib/autoapply/registration-agent.ts",
    "family": "autoapply",
    "locatable": true,
    "table": "funder_credentials",
    "primaryColumn": "login_success",
    "valueType": "jsonb",
    "dateColumn": "updated_at",
    "orgIdColumn": "organization_id",
    "agentFilter": null,
    "evidenceColumns": [],
    "citation": "src/lib/autoapply/credential-manager.ts:56-69 upsert({organization_id, funder_id, portal_url, username, encrypted_password, updated_at}); login outcome update at :97-104",
    "reason": null
  },
  {
    "agentType": "autoapply_risk_engine",
    "modulePath": "src/lib/autoapply/risk-engine.ts",
    "family": "autoapply",
    "locatable": true,
    "table": "submission_queue",
    "primaryColumn": "risk_score",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "status=eq.pending_manual",
    "evidenceColumns": [
      "risk_factors"
    ],
    "citation": "worker/queue-processor.ts:1230-1238 supabase.from('submission_queue').update({automation_mode:'manual', status:'pending_manual', risk_score, risk_factors})",
    "reason": null
  },
  {
    "agentType": "autoapply_receipt",
    "modulePath": "src/lib/autoapply/receipt-generator.ts",
    "family": "autoapply",
    "locatable": true,
    "table": "submission_receipts",
    "primaryColumn": "receipt_data",
    "valueType": "jsonb",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": null,
    "evidenceColumns": [
      "receipt_data"
    ],
    "citation": "src/lib/autoapply/receipt-generator.ts:338-345 supabase.from('submission_receipts').insert({submission_id, organization_id, receipt_pdf_path, receipt_data})",
    "reason": null
  },
  {
    "agentType": "morning_digest",
    "modulePath": "src/lib/agents/morning-digest.ts",
    "family": "autoapply",
    "locatable": true,
    "table": "alerts",
    "primaryColumn": "message",
    "valueType": "text",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "dedup_key=like.morning-digest:*",
    "evidenceColumns": [],
    "citation": "src/lib/agents/morning-digest.ts:74-80 supabase.from('alerts').insert({...}); writes nothing only when totalItems===0",
    "reason": null
  },
  {
    "agentType": "disaster_response_deploy",
    "modulePath": "src/lib/agents/disaster-response-agent.ts",
    "family": "autoapply",
    "locatable": true,
    "table": "alerts",
    "primaryColumn": "message",
    "valueType": "text",
    "dateColumn": "created_at",
    "orgIdColumn": "organization_id",
    "agentFilter": "dedup_key=like.disaster-response:*",
    "evidenceColumns": [],
    "citation": "src/lib/agents/disaster-response-agent.ts:156-162 supabase.from('alerts').insert({...}); disaster_declarations table also written but is global (no organization_id)",
    "reason": null
  },
  {
    "agentType": "consensus_validation",
    "modulePath": "src/lib/agents/consensus-validator.ts",
    "family": "autoapply",
    "locatable": true,
    "table": "validations",
    "primaryColumn": "verdict",
    "valueType": "jsonb",
    "dateColumn": "updated_at",
    "orgIdColumn": "organization_id",
    "agentFilter": null,
    "evidenceColumns": [
      "details"
    ],
    "citation": "src/lib/agents/consensus-validator.ts:328-330 upsert({organization_id, opportunity_id, provider, model, verdict, confidence, details, ...}, {onConflict:'opportunity_id,provider'})",
    "reason": null
  }
];
