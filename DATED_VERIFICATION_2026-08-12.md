# Dated Verification — 2026-08-12

## Scope

Re-verifies, against live evidence gathered in this session, the 15 rows named in
`FEATURE_REGISTRY_v2.md`'s "Note on the July 30 → August 7, 2026 agent-verification updates"
(the paragraph near line 571 listing rows corrected in the 2026-08-07 reconciliation pass):
`#79, #98, #135, #136, #140, #152, #156, #157, #158, #159, #161, #162, #163, #164, #165`.

Per instruction, `#98` is skipped (already independently re-verified live outside this queue as of
2026-08-11 — see `benavora-relationship-memory-tables-real-but-empty-frs-bug` / row #98's own
2026-08-11 correction). `#100` and `#116` are not part of this 15-row list and were not touched.

**This document makes no edits to `FEATURE_REGISTRY_v2.md`. Verification only — correction is a
separate, later step.**

**Method:** every database claim was checked via a live `psql`/Node-`pg` query against production
using the `DATABASE_URL` in `.env.local` (`STANDING_DIRECTIVES.md` DIRECTIVE-017). Every
code/wiring claim was checked via direct file read or repo-wide grep against the current working
tree, not against the row's own prose. One functional claim (#163) was re-executed live via
`node --import tsx` against the real `queryKnowledgeEngine()` function. All temporary verification
scripts were deleted after use; none were committed.

---

## Row #79 — Graph Database Schema

**Claim as currently written:** "`pig_nodes`/`pig_edges` confirmed live via direct `psql`/
`DATABASE_URL` this session — `to_regclass()` non-null for both, and a direct `count(*)` found 21
real `pig_nodes` rows and 20 real `pig_edges` rows... Real creating migration is
`src/supabase/migrations/077_intelligence_graph.sql`."

**Command run:**
```sql
SELECT to_regclass('public.pig_nodes'), to_regclass('public.pig_edges');
SELECT count(*) FROM pig_nodes;
SELECT count(*) FROM pig_edges;
```

**Actual output:**
```
pig_nodes: "pig_nodes"   pig_edges: "pig_edges"
pig_nodes count: 21
pig_edges count: 20
```

**Verdict: CONFIRMED.** Row counts match the row's own claimed figures exactly, re-derived fresh
this session, not copied from the row's text.

---

## Row #135 — Board Members Schema

**Claim as currently written:** "`board_members` is not new — it has existed since Phase 1... and
carries 8 real rows live (3 for Faith Foundation alone)... `board_meetings` is the genuinely new
table this row describes... confirmed live via direct `to_regclass()`."

**Command run:**
```sql
SELECT to_regclass('public.board_members');
SELECT count(*) FROM board_members;
SELECT to_regclass('public.board_meetings');
```

**Actual output:**
```
board_members: "board_members"
board_members count: 8
board_meetings: "board_meetings"
```

**Verdict: CONFIRMED.** Both tables live; row count matches the claimed 8 exactly.

---

## Row #136 — Meeting Packets Schema

**Claim as currently written:** "`board_meeting_packets`... confirmed live via direct
`to_regclass()`... `UNIQUE(meeting_id)` constraint added by AG-27's own migration... confirmed
present via `pg_constraint`... Current live row count is 0."

**Command run:**
```sql
SELECT to_regclass('public.board_meeting_packets');
SELECT count(*) FROM board_meeting_packets;
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'board_meeting_packets'::regclass;
```

**Actual output:**
```
board_meeting_packets: "board_meeting_packets"
count: 0
constraints:
  board_meeting_packets_meeting_id_fkey — FOREIGN KEY (meeting_id) REFERENCES board_meetings(id) ON DELETE CASCADE
  board_meeting_packets_meeting_id_unique — UNIQUE (meeting_id)
  board_meeting_packets_pkey — PRIMARY KEY (id)
```

**Verdict: CONFIRMED.** Table live, `UNIQUE(meeting_id)` present, row count still exactly 0 as
claimed (any real packets created/deleted by later verification sessions — e.g. AG-27, q34-003 —
were themselves cleaned up per this project's standing convention, consistent with the row's own
"synthetic test meeting/packet were deleted after verification" framing).

---

## Row #140 — Simulation Schema

**Claim as currently written:** "`impact_simulations` confirmed live via direct schema query;
actively written by AG-41's real 2026-08-03 scenario runs." (No specific row count asserted in the
row text itself.)

**Command run:**
```sql
SELECT to_regclass('public.impact_simulations');
SELECT count(*) FROM impact_simulations;
```

**Actual output:**
```
impact_simulations: "impact_simulations"
count: 9
```

**Verdict: CONFIRMED.** Table live and non-empty (9 real rows, consistent with — and larger than —
the row's own "actively written by" framing; the row makes no specific count claim to contradict).
Note for a future correction pass: the row could be updated to cite the current count (9, reflecting
additional AG-41 runs recorded in `AGENT_VERIFICATION_LOG.md` after 2026-08-03/07), but this is an
enhancement, not a falsified claim — not marking STALE for a claim the row never made.

---

## Row #152 — Command Center Page

**Claim as currently written:** "`src/app/(dashboard)/command-center/page.tsx` (599 lines)
confirmed real by direct read — a genuine `checkPermission(user.id, "owner", supabase)` gate with
redirect (`/dashboard?notice=owner_required`)... using `createAdminClient()` for real cross-org
queries... with a real nav rail linking to `/admin/orgs`, `/admin/system`, `/admin/monitor`,
`/admin/audit-log`, `/admin/sales-outreach`, `/admin/autoapply-ops`, `/admin/improvements`. Not a
stub. Not browser/screenshot-verified this session."

**Command run:**
```
wc -l "src/app/(dashboard)/command-center/page.tsx"
grep -n 'checkPermission(user.id, "owner"' "src/app/(dashboard)/command-center/page.tsx"
grep -n "createAdminClient" "src/app/(dashboard)/command-center/page.tsx"
grep -n "/admin/orgs|/admin/system|/admin/monitor|/admin/audit-log|/admin/sales-outreach|/admin/autoapply-ops|/admin/improvements" "src/app/(dashboard)/command-center/page.tsx"
git log --oneline -- "src/app/(dashboard)/command-center/page.tsx"
```

**Actual output:**
```
111 src/app/(dashboard)/command-center/page.tsx        <-- NOT 599 lines
39:  const { allowed } = await checkPermission(user.id, "owner", supabase);   <-- present, matches
(zero matches for createAdminClient in page.tsx itself)
20-26: all 7 nav-rail links present, byte-for-byte matching the claim

git log:
1fc87fa feat(command-center): wire Supabase Realtime postgres_changes subscriptions on real dashboard data sources
4e5122a feat: admin orgs list, org detail actions, system health dashboard -- platform owner complete toolset
58868a3 feat: Command Center platform-owner redesign all-org data fintech aesthetic
5a9718a chore: governance update post Phase 1 platform vision build
```
Traced `createAdminClient()` to `src/lib/command-center/snapshot.ts:7,43` (imported by page.tsx via
`getCommandCenterSnapshot()`) — confirmed present there, not missing from the app, just relocated.

**Verdict: STALE.** The functional substance (owner-only gate, service-role cross-org query, all 7
nav-rail links) is still true today — but the file itself was rewritten in commit `1fc87fa`
(after the 2026-08-07 reconciliation) from a 599-line monolith into a 111-line shell that delegates
data-fetching to `src/lib/command-center/snapshot.ts` and rendering to a new
`CommandCenterLive` component (itself the subject of later, more detailed verification in
`AGENT_VERIFICATION_LOG.md`'s q34-004/q34-005 entries — real-time subscriptions, configurable
layout, TV mode). The row's specific "(599 lines)" citation and its unqualified "using
`createAdminClient()`" (stated as if it happens inside this file) are both now inaccurate
descriptions of the current file, even though the underlying capability is intact elsewhere. A
correction pass should update the line count and note the `snapshot.ts`/`CommandCenterLive.tsx`
split, and should also fold in the already-completed q34-004 real-time findings (real-time
currently fires zero events — `supabase_realtime` publication has no member tables) rather than
leaving this row's "not browser/screenshot-verified" note standing on its own.

---

## Row #156 — Agent Registry Schema

**Claim as currently written:** "`agent_registry`/`agent_configurations` confirmed live via direct
`to_regclass()` this session... Both tables exist; both currently empty, 0 rows each — see row
#157."

**Command run:**
```sql
SELECT to_regclass('public.agent_registry'), to_regclass('public.agent_configurations');
SELECT count(*) FROM agent_registry;
SELECT count(*) FROM agent_configurations;
```

**Actual output:**
```
agent_registry: "agent_registry"   agent_configurations: "agent_configurations"
agent_registry count: 43
agent_configurations count: 43
```

**Verdict: STALE.** Both tables are still live (table-existence half of the claim holds), but "both
currently empty, 0 rows each" is false today — `agent_registry` now has 43 real seeded rows and
`agent_configurations` has 43 real rows (one per agent, from a live toggle-persistence test).
`git log` on the seed script/API route (`scripts/seed-agent-registry.ts`, commits `69578b4`/
`b1a91dd`) confirms this data was populated in a session after 2026-08-07. This is a real, dated
data-state change, not a mistaken re-read.

---

## Row #157 — Registry Seed Data

**Claim as currently written:** Status **NOT-BUILT**. "Direct live `count(*)`: `agent_registry` has
**zero rows**. The seed content exists only as a static, never-executed TypeScript array... No
seed script targets this table either."

**Command run:**
```sql
SELECT count(*) FROM agent_registry;
```
```
git log --oneline -- scripts/seed-agent-registry.ts
```

**Actual output:**
```
agent_registry count: 43
```
(Cross-referenced against `git log`, confirming `scripts/seed-agent-registry.ts` and the seeding
commits `69578b4`/`b1a91dd` exist and post-date this row's 2026-08-07 text.)

**Verdict: STALE.** The row's core claim ("zero rows," "no seed script targets this table") is
directly contradicted by live data: 43 real rows now exist, populated by a real seed script that
was written and run after this row's text was last updated. Status should no longer read
NOT-BUILT.

---

## Row #158 — Registry API

**Claim as currently written:** "BUILT — VERIFIED (returns real but currently-empty data)... Given
row #157, it currently returns `{ agents: [] }` for every org in production."

**Command run:**
```sql
SELECT count(*) FROM agent_configurations;
```
Also re-confirmed via row #156/#157's `agent_registry` count above (the table `/api/agents/registry`
joins against).

**Actual output:**
```
agent_configurations count: 43
agent_registry count: 43
```

**Verdict: STALE.** The route's own code is presumably unchanged and still correct (not re-read
this pass beyond the counts, since the counts alone settle the claim), but its documented output
("currently-empty data," "`{ agents: [] }` for every org") is no longer what it returns — the
backing tables now hold 43 real rows each, directly following from row #157's own now-stale
premise.

---

## Row #159 — Agent Marketplace UI

**Claim as currently written:** "BUILT — UNVERIFIED (wiring confirmed, not browser-tested)...
Confirmed by direct read: calls `GET /api/agents/registry` on mount... Not browser/screenshot-
verified this session — deferred to q27-004 per that step's own scope."

**Command run:**
```
test -f "src/app/(dashboard)/agents/marketplace/page.tsx"
grep -n "fetch(\"/api/agents/registry\"" "src/app/(dashboard)/agents/marketplace/page.tsx"
git log --oneline -- "src/app/(dashboard)/agents/marketplace/page.tsx"
```

**Actual output:**
```
EXISTS
84:    const res = await fetch("/api/agents/registry");

git log:
2ed3983 feat(agents): build Agent Log Viewer, real per-agent agent_runs history
b1a91dd feat(agents): build real Agent Marketplace UI at /agents/marketplace
```

**Verdict: STALE.** Wiring confirmed present (matches the row). But the row's explicit deferral
("Not browser/screenshot-verified this session — deferred to q27-004") is now out of date: q27
(referenced in the row's own text as the deferred step) has since run and is recorded in
`AGENT_VERIFICATION_LOG.md` — a real authenticated Playwright browser session against production
confirmed the page renders 43 real agent cards, a real toggle click persists through a full page
reload, and two previously-undocumented schema-drift bugs (`agent_configurations.organization_id`,
`agent_registry.avg_tokens_per_run`) were found and fixed live in the process. The row should read
BUILT — VERIFIED, not "UNVERIFIED... deferred," which describes a check that has since been done.

---

## Row #161 — pgvector Extension

**Claim as currently written:** "`SELECT extname, extversion FROM pg_extension WHERE extname =
'vector'` confirmed live this session — `vector 0.8.0` installed."

**Command run:**
```sql
SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';
```

**Actual output:**
```
extname: vector   extversion: 0.8.0
```

**Verdict: CONFIRMED.** Exact match, re-derived independently.

---

## Row #162 — Knowledge Patterns Table

**Claim as currently written:** "`knowledge_patterns` confirmed live via direct `count(*)` this
session — 33 real rows... this table has **no `embedding` column** (confirmed via
`information_schema.columns`)."

**Command run:**
```sql
SELECT count(*) FROM knowledge_patterns;
SELECT column_name FROM information_schema.columns WHERE table_name = 'knowledge_patterns' ORDER BY ordinal_position;
```

**Actual output:**
```
count: 33
columns: id, pattern_type, category, funder_name, pattern_description, success_rate,
         sample_count, confidence, created_at, updated_at   (no "embedding" column)
```

**Verdict: CONFIRMED.** Row count and column list both match exactly.

---

## Row #163 — Knowledge Engine Core

**Claim as currently written:** "`queryKnowledgeEngine()` was run live this session... returned 10
real, genuinely relevant patterns... plus a synthesized insight string — not a stub... **Minor
defect found**: the top-match insight string has a real display bug — `success_rate` is stored as a
0–1 fraction... but the insight text interpolates it directly as `"(0.73% success rate)"` instead of
`× 100`; should read '73%.'"

**Command run:** live execution of the real, unmodified `queryKnowledgeEngine('housing grant
program success', orgId, supabase)` (Faith Foundation org) via `node --import tsx`, plus a
`git log -p` on the file to find when the interpolation logic last changed.

**Actual output:**
```
patternCount: 10
insights: [
  'Top matching pattern: "Logic models structured in the W.K. Kellogg Foundation format
   (inputs, activities, outputs, outcomes, impact) are preferred by 73% of foundation
   reviewers over free-form narrative program descriptions." (73% success rate).'
]

git log -p (relevant diff, commit 08fa5c2 "...fix success_rate display bug"):
-  top.success_rate !== null ? ` (${top.success_rate}% success rate)` : ''
+  top.success_rate !== null
+    ? ` (${Math.round(top.success_rate * 100)}% success rate)`
```

**Verdict: STALE.** The core retrieval claim (10 real, relevant patterns, real synthesized insight)
is CONFIRMED — re-run live, unchanged. But the "minor defect found" (the `0.73%` display bug) is no
longer present: commit `08fa5c2` fixed it (`Math.round(success_rate * 100)`), confirmed live this
session by the actual returned string reading `"(73% success rate)"`, not `"(0.73% success rate)"`.
The row currently documents a bug as open that has since been fixed.

---

## Row #164 — Knowledge Query API

**Claim as currently written:** "`/api/intelligence/knowledge-query` (`POST`) confirmed by direct
read to be a thin wrapper... that calls `queryKnowledgeEngine()` directly with no separate logic."

**Command run:**
```
test -f "src/app/api/intelligence/knowledge-query/route.ts"
grep -n "queryKnowledgeEngine" src/app/api/intelligence/knowledge-query/route.ts
```

**Actual output:**
```
EXISTS
5:  import { queryKnowledgeEngine } from "@/lib/intelligence/knowledge-engine";
57:  const result = await queryKnowledgeEngine(query.trim(), orgId, supabase);
```

**Verdict: CONFIRMED.** Route still exists and still calls the real function directly, matching
the claim.

---

## Row #165 — Knowledge Engine UI

**Claim as currently written:** "`/intelligence/knowledge` confirmed by direct read to call
`fetch(\"/api/intelligence/knowledge-query\", ...)` — genuinely wired to the real route, not a
placeholder. Not browser/screenshot-verified this session."

**Command run:**
```
test -f "src/app/(dashboard)/intelligence/knowledge/page.tsx"
grep -n "knowledge-query" "src/app/(dashboard)/intelligence/knowledge/page.tsx"
```

**Actual output:**
```
EXISTS
107:      const res = await fetch("/api/intelligence/knowledge-query", {
```

**Verdict: CONFIRMED.** Page still exists and still calls the real route as claimed. No later
session in `AGENT_VERIFICATION_LOG.md` was found that performed a browser/screenshot check of this
specific page, so the row's "not browser/screenshot-verified" caveat also still holds — nothing
here contradicts the row as written.

---

## Summary

| Row | Verdict | Note |
|---|---|---|
| #79 | CONFIRMED | pig_nodes=21, pig_edges=20, exact match |
| #135 | CONFIRMED | board_members=8, board_meetings live |
| #136 | CONFIRMED | board_meeting_packets live, count=0, UNIQUE constraint present |
| #140 | CONFIRMED | impact_simulations live, 9 rows (row makes no specific count claim) |
| #152 | **STALE** | File rewritten 111 lines (was 599); createAdminClient moved to snapshot.ts |
| #156 | **STALE** | Tables no longer empty — 43 rows each, not 0 |
| #157 | **STALE** | "zero rows"/"no seed script" both contradicted — 43 real seeded rows exist |
| #158 | **STALE** | "currently-empty data" contradicted — 43 real rows now returned |
| #159 | **STALE** | "not browser-tested... deferred to q27-004" — q27 has since run and verified it live |
| #161 | CONFIRMED | vector 0.8.0 |
| #162 | CONFIRMED | 33 rows, no embedding column |
| #163 | **STALE** | Retrieval claim confirmed; the documented display bug is fixed (commit 08fa5c2) |
| #164 | CONFIRMED | route still a thin wrapper over queryKnowledgeEngine |
| #165 | CONFIRMED | page still wired to the real route |

**7 of 14 rows CONFIRMED current. 7 of 14 rows STALE** — six due to real, dated changes to the
codebase/data since the 2026-08-07 reconciliation (Agent Registry seeding + schema fixes via q27;
the success_rate display fix via commit `08fa5c2`; the Command Center page refactor via `1fc87fa`),
and none due to a re-reading error in the original reconciliation itself.
