# BENAVORA — Session State
## Last Updated: July 17, 2026 (overnight run)
## Mode: Active Development

---

## Current Session

**Date:** July 17, 2026 — overnight FORGE run, Platform Vision Phase 1
**Focus:** Digital Twin, Grant Probability Engine, Agent Marketplace,
Opportunity Discovery, Reputation Intelligence, Disaster Response Engine,
Knowledge Engine foundation, Executive Command Center.
**Status:** 6 of 8 features fully verified (code + schema, canonical
migration path). Reputation Intelligence and Disaster Response have
complete, working app code, but their tables were only ever migrated to a
stray `src/supabase/migrations/` directory and were never applied to the
live database — schema fix required before those two are actually
functional in production. See STATE_OF_THE_BUILD.md for full detail.

### Previous session (documentation)

---

## What Was Accomplished This Session

### Documents Produced (all v2.0)
1. STANDING_DIRECTIVES.md — 6 permanent build obligations
2. PLATFORM_VISION_ARCHITECTURE.md — 14 net-new platform pillars fully architected
3. CORPORATE_INTELLIGENCE_ARCHITECTURE.md — full corporate intelligence engine
4. PRD_v2.md — all 18 pillars with user stories, technical requirements, pricing gates
5. AGENTS_v2.md — 30 agents fully specified (AG-01 through AG-30)
6. BLUEPRINT_v2.md — master architectural blueprint (supersedes BLUEPRINT.md)
7. SCHEMA_REGISTRY_v2.md — all 67 tables documented (supersedes SCHEMA_REGISTRY.md)
8. FEATURE_REGISTRY_v2.md — 186 features tracked (supersedes Feature_Registry.md)
9. INTERACTION_MAPS_v2.md — 60+ user flows mapped (supersedes INTERACTION_MAPS.md)
10. TESTING_v2.md — 10 test types + GitHub Actions (supersedes TESTING.md)
11. FORGE_CANONICAL_INSTRUCTIONS.md — updated with all lessons learned
12. WORKER_ARCHITECTURE_v2.md — full nightly agent pipeline documented
13. STATE_OF_THE_BUILD.md — this session's full build state
14. SESSION_STATE.md — this document

### Queue Produced
- `queue-night2-platform-vision.yaml` — 30 prompts targeting Platform Vision Phase 1

### UI Work Completed (earlier today)
- Dashboard hero banner deployed with illustration
- FlightPathHUD colored cards working
- Dashboard two-column layout with action items widget

---

## Stale v1 Documents to Delete from Repo

These must be deleted when running the governance deployment command:
- BLUEPRINT.md (superseded by BLUEPRINT_v2.md)
- SCHEMA_REGISTRY.md (superseded by SCHEMA_REGISTRY_v2.md)
- Feature_Registry.md (superseded by FEATURE_REGISTRY_v2.md)
- INTERACTION_MAPS.md (superseded by INTERACTION_MAPS_v2.md)
- TESTING.md (superseded by TESTING_v2.md)
- TESTING-GUIDE.md (superseded by TESTING_v2.md)

---

## Before Tonight's FORGE Run

Execute this command to deploy all governance docs:

```powershell
$docs = @("BLUEPRINT_v2.md","SCHEMA_REGISTRY_v2.md","FEATURE_REGISTRY_v2.md","INTERACTION_MAPS_v2.md","PRD_v2.md","AGENTS_v2.md","PLATFORM_VISION_ARCHITECTURE.md","CORPORATE_INTELLIGENCE_ARCHITECTURE.md","STANDING_DIRECTIVES.md","TESTING_v2.md","FORGE_CANONICAL_INSTRUCTIONS.md","WORKER_ARCHITECTURE_v2.md","STATE_OF_THE_BUILD.md","SESSION_STATE.md")
$src = "C:\Users\manag\Downloads\Recent Downloads"
$repo = "C:\Users\manag\Documents\benavora"
$forge = "C:\Users\manag\Documents\FORGE\projects\benavora"
foreach ($f in $docs) { Copy-Item "$src\$f" "$repo\$f" -Force; Copy-Item "$src\$f" "$forge\$f" -Force }
Copy-Item "$src\queue-night2-platform-vision.yaml" "$forge\queue.yaml" -Force
$old = @("BLUEPRINT.md","SCHEMA_REGISTRY.md","Feature_Registry.md","INTERACTION_MAPS.md","TESTING.md","TESTING-GUIDE.md")
foreach ($f in $old) { if (Test-Path -LiteralPath "$repo\$f") { Remove-Item -LiteralPath "$repo\$f" } }
cd $repo; git add -A; git commit -m "docs: complete governance suite v2.0 — 14 documents"; git push origin main
```

Then launch FORGE:
```powershell
cd C:\Users\manag\Documents\FORGE; $env:NODE_OPTIONS="--max-old-space-size=8192"; $env:ANTHROPIC_API_KEY=$null; powershell -ExecutionPolicy Bypass -File .\forge.ps1 -project benavora -startFrom 0
```

After FORGE completes:
```powershell
cd "C:\Users\manag\Documents\benavora"; npx vercel deploy --prod
```

---

## Next Session Priorities

1. **Fix reputation/disaster schema gap** — copy `src/supabase/migrations/076_reputation_intelligence.sql` and `079_disaster_response.sql` into `supabase/migrations/` at the next free canonical numbers and apply via the Management API. Blocks both features in production until done.
2. UI redesign continuation — one component per CC session
3. Run batch probability scoring across all active opportunities (AG-15 nightly job — not yet run at scale)
4. Run digital twin builds for all orgs (AG-16 — built this session, not yet executed against real org data)
5. Run intelligence ingestion scripts (NIH, NSF, Federal Register, SAMHSA)
6. Run ProPublica batch enrichment against 133K foundations
7. Back up enrichment-output/ to DATAOCEAN — CRITICAL
8. Platform Vision Phase 2 FORGE queue (nights 3-5)
9. Fix duplicate Faith Foundation org records

---

## Blockers Requiring Human Action

| Blocker | Action Required |
|---|---|
| DATAOCEAN backup | Copy enrichment-output/ to D:\ immediately after any enrichment run |
| Duplicate Faith Foundation orgs | Manual delete from Supabase dashboard |
| 298K prospect CSV | Copy from D:\dataocean, run import script |
| Intelligence corpus empty | Run 5 ingestion scripts locally (not via FORGE) |
