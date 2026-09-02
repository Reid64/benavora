# BENAVORA — State of the Build
## Last Updated: July 18, 2026
## Updated by: Reid Whitesides + Claude

---

## Platform Overview

| Metric | Value |
|---|---|
| Production URL | www.benavora.com / benavora.vercel.app |
| Repository | Reid64/benavora (private) |
| Stack | Next.js 14, Supabase, Vercel Pro, Railway, TypeScript, pnpm |
| Migrations applied | 097 confirmed + 099 applied manually |
| Database tables | 67+ confirmed |
| Build status | PASSING |
| Vercel auto-deploy | BROKEN — always run npx vercel deploy --prod manually |
| GitHub Actions | FIXED — push trigger removed, schedule-only + manual dispatch |

---

## Data Population Status (as of July 18, 2026)

| Dataset | Table | Records | Status |
|---|---|---|---|
| IRS BMF Nonprofits | nonprofits | 1,978,526 | COMPLETE — all 51 states, 0 failures |
| Foundation Directory | foundation_directory | 133,812 | COMPLETE |
| ProPublica Foundation Enrichment | foundation_directory.enrichment | ~77,400/133,812 | IN PROGRESS |
| ProPublica Nonprofit Enrichment | nonprofits | Running | IN PROGRESS — just launched |
| IRS 990 XML Enrichment | nonprofits | 0 | BLOCKED — IRS 403s individual XML files |
| Intelligence Library | intelligence_funded_proposals | 31 | SEEDED |
| Knowledge Patterns | knowledge_patterns | 30 | SEEDED |
| Opportunity Scores | opportunity_probability_scores | 500 | COMPLETE |
| Digital Twins | organizational_digital_twins | 10 orgs | COMPLETE — Faith Foundation 60-70% |
| Federal Grant Discovery | discovery_matches | ~500 | COMPLETE |

---

## Scripts Status

| Script | Command | Status |
|---|---|---|
| ingest-nonprofit-bmf.ts | pnpm ingest:bmf | COMPLETE |
| enrich-foundations-propublica.ts | pnpm enrich:propublica | RUNNING (~10hrs left) |
| enrich-nonprofits-bmf-propublica.ts | pnpm enrich:nonprofits-pp | RUNNING (9-10 days at 400ms/record) |
| enrich-990-xml.ts | pnpm enrich:990xml | BLOCKED — IRS 403 on individual XML. Needs ZIP rewrite. |
| enrich-website-contacts.ts | pnpm enrich:nonprofit-websites | READY — run after websites are populated |
| batch-score-opportunities.ts | pnpm score:opportunities | COMPLETE — 500 scored |
| batch-score-eligibility.ts | pnpm score:eligibility | NOT YET RUN |
| build-digital-twins.ts | pnpm build:twins | COMPLETE |
| seed-intelligence-corpus.ts | pnpm seed:intelligence | COMPLETE |
| seed-knowledge-patterns.ts | pnpm seed:patterns | COMPLETE |
| poll-federal-grants.ts | pnpm poll:federal | COMPLETE |

---

## Known Issues

| Issue | Severity | Status |
|---|---|---|
| IRS 990 XML individual files return 403 | HIGH | BLOCKED — rewrite needed using ZIP bundles |
| Supabase Management API token 401 | MEDIUM | Use SQL editor directly for DDL |
| Vercel GitHub auto-deploy broken | HIGH | WORKAROUND: npx vercel deploy --prod |
| Duplicate Faith Foundation orgs | MEDIUM | UNRESOLVED — manual dedup needed |
| DATAOCEAN backup never done | CRITICAL | Back up enrichment-output/ to D:\ before any reruns |
| Nonprofit ProPublica enrichment speed | MEDIUM | 9-10 days at 400ms/record — consider Railway worker |

---

## Session Accomplishments July 17-18

### July 17
- 22/22 FORGE prompts passed (Platform Vision Phase 1)
- Dashboard redesign v2.0 deployed
- 17 data population FORGE prompts passed
- Intelligence Library and Knowledge Patterns seeded
- Digital Twins built for 10 orgs
- 500 opportunities scored
- 14 governance docs v2.0 produced
- Complete platform documentation produced (~250 pages, 4 documents)

### July 18
- IRS BMF import confirmed: 1,978,526 records, 0 failures
- 15 enrichment columns added to nonprofits table
- Dependencies installed: node-fetch cheerio p-limit fast-xml-parser
- enrich-990-xml.ts built (blocked by IRS 403)
- enrich-website-contacts.ts built
- enrich-nonprofits-bmf-propublica.ts built and launched
- GitHub Actions email flood fixed (push trigger removed)

---

## DO NOT INTERRUPT

Window 1: enrich-foundations-propublica.ts (~10 hours remaining)
Window 2: enrich-nonprofits-bmf-propublica.ts (days remaining)

---

## Next Priorities

1. Fix enrich-990-xml.ts to use ZIP bundle downloads
2. Run pnpm score:eligibility after twin completeness improves
3. Platform Vision Phase 2 FORGE queue
4. UI redesign continuation (one component per CC session)
5. Resolve duplicate Faith Foundation org records
6. Back up enrichment-output/ to DATAOCEAN (D:\)
