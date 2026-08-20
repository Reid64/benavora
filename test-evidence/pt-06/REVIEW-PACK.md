# PT-06 Review Pack — read this one, not the raw evidence, unless you want the raw evidence

For the full numbers and how each was produced, see `PHASE-06-SUMMARY.md` in this same directory.
This doc is the short version: what's actually true about the schema right now, what needs your
decision before anyone touches it, and what we recommend next.

## The question you actually care about: what's the real state of the schema?

**This project has no migration-tracking table.** Every migration was applied by hand, ever, via a
direct database connection — never through the Supabase CLI's own migration workflow. There is no
ledger anywhere that says which of the 199 migration files on disk actually ran. That single fact is
the root cause of nearly everything below, so it's worth sitting with before the numbers.

**The settled drift number: 57 of 165 checkable migrations (34.5%) are on disk but not applied to
production.** That replaces the "28 of 108" figure `MIGRATION_AUDIT.md` cited back in July — the real
gap is materially bigger, not smaller, once both migration directories and a proper DDL-statement
extraction are used instead of a single-point schema check. 108 are genuinely applied. 34 more have no
`CREATE`/`ALTER` statement to check at all (RLS-only or backfill-only files) and are honestly recorded
as unverifiable-this-way rather than guessed either direction.

**Two migration directories exist (`supabase/migrations`, `src/supabase/migrations`) and their
numbering diverged completely somewhere before file `072`.** From `072` through `127` — 56 straight
numbers — both directories used the same number for entirely unrelated content. Applying migrations
"in order" across both trees together has never meant anything; the number only orders files within
its own directory. On top of that, 8 pairs of files *inside the same directory* also share one number
(most visibly `052_governance_layer.sql` / `052_webhook_configs.sql` in `supabase/migrations`, already
flagged once before but now confirmed as one instance of a repeating pattern, not a one-off).

**The code that depends on the missing pieces is not hypothetical.** A separate, independent
cross-reference of 1,070 files and 11,474 real column references against the live schema found 21
tables and 50 columns that real, non-test application code queries and don't exist live. 53 of the 57
unapplied migration files have at least one real call site already waiting on them. This is currently
broken, reachable code — not dead migrations sitting behind dead code.

**14 of the 57 unapplied files are missing an entire table**, not just a column — these are the ones
capable of a full route 500, and 4 of them already are (PT-02's WGR-005 through WGR-009). The other
43 unapplied files are drifted columns/enum values on tables that already exist — 8 of those were
individually read-verified against real, live call sites this phase; the rest are indexed by name in
`WGR-062` for a future session to triage rather than left unrecorded.

**Everything else this phase checked came back clean or contained**: 267 live foreign keys, zero
orphaned rows. Zero tables without a primary key. Both `ein`-based unique indexes (the one place a
duplicate would be a real data-integrity failure, not just messy) are genuinely enforced — zero
duplicates on 133,812 and 1,978,526 rows respectively. The generated TypeScript types are fully clean
against the live schema; every drift finding above is hand-written query code, invisible to `tsc`.

## What needs a migration-apply decision — the actionable remediation list

None of this was applied by this phase — diagnosis and cataloguing only, per this program's standing
read-only rule. Applying any of it is a real write to production and needs to happen deliberately, one
file at a time, with the understanding that **there is no tracking table to stop the same file being
applied twice by accident** — and this phase directly tested what that costs: 5 of 6 sampled `CREATE
TABLE` migrations fail loudly (safe) on a second apply, but one, `003_onboarding.sql`, is a data
backfill with no re-apply guard that silently overwrote a real row's state with zero error when
re-run. Any manual apply process going forward should track what it has already run, by hand if
nothing else exists to do it automatically.

**Tier 1 — apply now, no product ambiguity, each unblocks a route that already 500s in production:**

| Migration | Unblocks |
|---|---|
| `supabase/migrations/086_white_label.sql` | `GET /api/consultant/clients` (WGR-006) |
| `supabase/migrations/087_notification_preferences.sql` | `GET /api/settings/notifications` (WGR-009) |
| `supabase/migrations/103_schoolfunder.sql` | `GET /api/schoolfunder` (WGR-008) |

**Tier 2 — blocked on your decision, not ours (see the still-owed item below):**

| Migration | Depends on |
|---|---|
| `supabase/migrations/083_followup_sequences.sql` | Your call on WGR-007 — see below |

**Tier 3 — high-value, no known product ambiguity, but each is a genuinely new table/column set worth
a deliberate look before applying rather than a blind batch run (full list of all 14 missing-table
files and their real live consumer counts is in `PHASE-06-SUMMARY.md`'s PT-06-002 table):**

- `supabase/migrations/052_governance_layer.sql` — the entire AutoApply governance/risk-gating/
  usage-tracking layer (`funder_relationships`, `queue_controls`, `submission_usage`, `tier_limits`).
  Highest real-consumer-count of any single missing-table migration in this audit (1,261 references
  across those 4 tables, per `consumer-check.json`).
- `src/supabase/migrations/097_deadline_prediction_agent.sql`, `src/supabase/migrations/
  095_autoapply_portal_type.sql`, `supabase/migrations/106_intelligence_library_schema_upgrade.sql`,
  `supabase/migrations/105_applications_metadata_column.sql` — each individually read-verified this
  phase against a real, live-code consumer (registered `WGR-047`/`WGR-053`/`WGR-050`/`WGR-049`).

**Two known cross-directory duplicate-content pairs — pick one per pair, don't apply both:**
`src/supabase/migrations/101_twin_auto_populate_log.sql` vs. `supabase/migrations/
102_twin_auto_populate_log.sql` both add the identical `organizational_digital_twins
.twin_auto_populate_log` column (`WGR-048`) — applying one satisfies the other. The 8 same-directory
duplicate-prefix pairs listed in `PHASE-06-SUMMARY.md` were NOT individually checked for content
overlap this phase — verify each pair defines genuinely different objects before assuming both can be
applied independently.

## Still owed — the same real product decision from PT-02, not resolved here either

**WGR-007** (`GET /api/outreach/sequences` 500ing, and now also `081_application_followups.sql` sitting
unapplied alongside it): apply the dormant `followup_sequences` migration as-is, or retire that route
in favor of AG-28's `application_followups` model instead. We checked, again, whether the alternative
is even ready — it still isn't; `application_followups` is also missing from production. Neither
option is a same-day fix without its own apply step first. This is your call, same as it was after
PT-02; PT-06 doesn't change the decision, only confirms both paths are equally unbuilt today.

## Recommendation for the next phase

**Go — and go to PT-05 (tenant isolation), not PT-08.** PT-08 (jobs/scheduler/queue) is already done —
it has its own `PHASE-08-SUMMARY.md`/`REVIEW-PACK.md` on disk and its own recommendation (PT-09,
per-agent verification), from a session that ran independently of this one. The live choice in front
of you is PT-05 vs. PT-09; we recommend PT-05.

The case for PT-05 specifically, made stronger by this phase, not just repeated from PT-02's original
pitch: this phase produced the exact input PT-05 needs and didn't have before — a concrete, live-
verified list of 13 tenant-scoped tables with no foreign key back to `organizations` at all (WGR-064),
out of 120 tables that carry a tenant column. That's not a general "go check isolation" reminder
anymore; it's 13 named tables to test cross-org access against, with the schema-level reason a leak
would be possible already documented. PT-05 also directly extends PT-02's own finding that "the app
trusts a query result without double-checking it" was the root cause of several real 2026-08 bugs
(the pagination truncations) — the same trust-without-verification pattern is exactly what a cross-org
leak would exploit, and now there's a real target list instead of "test broadly."

PT-09 (per-agent trigger verification) is also a reasonable next step and was PT-08's own
recommendation — nothing here argues against it, only that PT-05 has a higher severity ceiling (a
real cross-org data leak is a P0, not the P1/P2 drift and data-quality findings this phase surfaced)
and now has concrete evidence to run against. Your call either way; both are legitimate.
