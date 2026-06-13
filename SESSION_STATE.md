# BENAVORA — Session State

## Current Session: Post-Tier-2 / Pre-Tier-3 Handoff
## Updated: 2026-06-12
## Mode: FORGE 1.0 Autonomous Pipeline

## Build History
- Original FORGE Build: 42/42 PASSED (Grade B audit)
- Tier 1: 4/4 PASSED (Draft Persistence, Nav State, KB Detail, Humanizer)
- Tier 2: 7/7 PASSED (Categorization, Parallel Research, Search Config, Analytics, Eligibility, Alerts, Multi-Model)
- Post-Tier-2 extensions (beyond queue.yaml): 5 additional FORGE sessions run
  - Funding source-type classification (migration 010, SourceTypeBadge, filter tabs, inferSourceType)
  - Search Profile Configuration page + profile-driven agents (migration 011)
  - Opportunity match-percentage scoring (migration 012)
  - Alerts: daily action list + sidebar badges (migration 013)
  - Cross-provider AI consensus validation (migration 014, Gemini integration)

## Last Completed Session: Cross-provider consensus validation (migration 014)
## Next Build: Tier 3 (s3-p01 through s3-p10 in queue.yaml)

## Migrations Written vs. Applied
| Migration | File | Live DB Applied? |
|-----------|------|-----------------|
| 001–009 | Various (auth, core tables, drafts) | YES — original build |
| 010_opportunity_source_type.sql | enum + source_type column + index | NOT YET |
| 011_search_profile_configuration.sql | 8 new search_profile columns | NOT YET |
| 012_opportunity_match_percentage.sql | match_percentage, is_high_priority, match_mismatch_reasons | NOT YET |
| 013_alerts.sql | alerts table + enums | NOT YET |
| 014_validations.sql | validations table + validation_verdict enum | NOT YET |

**To apply migrations:** `node apply-migration.mjs supabase/migrations/<file>.sql` (requires SB_TOKEN_FILE).
Apply in order: 010 → 011 → 012 → 013 → 014.

## Gate Status (as of last session)
- `pnpm tsc --noEmit` — BLOCKED every session (requires approval); NOT confirmed passing
- `pnpm run build` — BLOCKED every session; NOT confirmed passing
- `pnpm lint` — BLOCKED every session; NOT confirmed passing
- Static self-reviews performed each session; no Iron Law 3 violation claimed

## Blockers
- Migrations 010–014 not applied to live Supabase DB (supabase account ownership unresolved)
- Gate commands require interactive approval — not run autonomously
- Vercel project not yet deployed
- forge.ps1 needs --model claude-sonnet-4-6 flag for cost control

## Active Machine: ROG Laptop (C:\Users\manag\Documents\benavora)
## FORGE Location: C:\Users\manag\Documents\FORGE
## FORGE Entry Point: forge.ps1 (NOT forge.js)
## Launch Command: cd C:\Users\manag\Documents\FORGE && powershell -ExecutionPolicy Bypass -File .\forge.ps1 -project benavora -startFrom 0

## Codebase Inventory (audited 2026-06-12)
| Area | Count |
|------|-------|
| App pages (page.tsx) | 43 |
| API routes (route.ts) | 40 |
| React components (.tsx) | 79 |
| Agent modules (src/lib/agents/*.ts) | 23 |
| Service libs (src/lib/**) | see STATE_OF_THE_BUILD.md |
| SQL migrations | 15 (001–014; 010–014 not applied) |

## Tier 3 Prompts (from queue.yaml)
1. s3-p01 — Budget Narrative Generator
2. s3-p02 — Document Assembly Engine
3. s3-p03 — Funder Intelligence Agent
4. s3-p04 — Renewal Tracker
5. s3-p05 — Success Pattern Learning
6. s3-p06 — Compliance Pre-Check
7. s3-p07 — Cold Outreach Sequences
8. s3-p08 — Grant Calendar View
9. s3-p09 — Email Parsing Agent
10. s3-p10 — Board Report Generator

## Pre-Tier-3 Checklist
- [ ] Apply migrations 010–014 to live Supabase DB
- [ ] Run gate sequence and confirm clean: pnpm tsc --noEmit → pnpm run build → pnpm lint
- [ ] Add --model claude-sonnet-4-6 to forge.ps1
- [ ] Pre-install deps: pnpm add archiver pdf-lib @react-pdf/renderer resend
- [ ] Resolve Supabase account ownership for migrations
- [ ] Deploy to Vercel

## Environment
- [x] Supabase project created (vbjplpquqxxfbpazyalt)
- [x] GitHub repo: Reid64/benavora
- [ ] Vercel project deployed
- [x] .env.local configured
- [x] Claude API key set
- [x] Supabase Storage bucket created + cleaned
- [ ] GEMINI_API_KEY set (needed for consensus validation, migration 014)

## Notes
- ROG Node v20 causes WebSocket issues — use direct fetch or upgrade
- FORGE 2.0 has critical bugs — stick with FORGE 1.0 (forge.ps1) for Tier 3
- Google auth `as any` casts in src/lib/integrations/google/*.ts are load-bearing — do NOT remove
- source_type on opportunities (physical column) ≠ source_type alias in grants API (maps to category); see STATE_OF_THE_BUILD.md
- Manual is_proven toggle on KB narratives overrides agent — by design (Contracts §8)
