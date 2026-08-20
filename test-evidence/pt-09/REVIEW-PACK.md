# PT-09 Review Pack — read this one, not the raw evidence, unless you want the raw evidence

For the full table and how every number was produced, see `PHASE-09-SUMMARY.md` in this same
directory. This doc is the short version: is the agentic layer real, how much of the old "BUILT"
registry can you trust, and what to do next.

## The question you actually care about: is the agentic layer real or aspirational?

**Mostly real. 26 of 43 canonical agents (60%) genuinely write real data when you invoke them for
real and check the database directly — not "the code ran without an error," an actual new row, with
real Claude-generated or deterministically-computed content in it, independently re-queried through
a connection separate from the agent's own client.** That's the honest floor: over half the roster
does what it says.

**But 30% of the roster (13 of 43) looked built by every signal this project had before today, and
turned out to fire clean and write nothing.** That's the number this phase exists to surface. Before
this audit, "is AG-18 built?" was answered by: does a registry row exist, does the code compile, did
a prior session's `agent_runs` row say `status: completed`. All three of those say yes for AG-18. All
three say yes for the other 12. None of the three can tell the difference between "ran and did the
job" and "ran, found nothing, and quietly did nothing" — and that gap is exactly where 13 agents were
hiding.

## The verdict breakdown

| Verdict | Count | What it means |
|---|---|---|
| **WORKS** | 26 | Invoked for real, wrote a real row with real content, independently re-verified. |
| **WIRED-NO-OUTPUT** | 12 | Ran clean, `agent_runs` completed, zero business-table writes. The false-pass class. |
| **PENDING-SCOPE** | 4 | 3 have no code at all (AG-31/33/34); 1 (AG-12, AutoApply) has real code but no safe way to test it without actually emailing or submitting to a real third party. |
| **ERROR-SWALLOWED** | 1 | AG-14 (Donor Discovery) — the real production dependency is missing and the failure never reaches anywhere a human would see it. |
| **TRIGGER-BROKEN** | 1 | AG-20 — a real, reproducible timeout bug, not an infrastructure gap. |

## Can you trust the old "BUILT" registry? Plainly: not on its own, not anymore

Here's the honest statement. `FEATURE_REGISTRY_v2.md`, `agent_registry`'s own metadata, and the
"BUILT — VERIFIED" language scattered across `STATE_OF_THE_BUILD.md`'s session history were all built
on the same three signals described above — does the code exist, does the trigger fire, did a run
complete without throwing. **Those signals were reliable for "is this agent reachable" and
unreliable for "does this agent produce anything."** 13 of 43 agents passed every one of those checks
and still don't do their job. That's not a small asterisk — it's 30% of the roster.

What you *can* trust going forward: this phase's own table, because every row cites a real row-delta
from a real database, re-queried independently. Anything this project claims about an agent from now
on should point at a row delta like the ones in `PHASE-09-SUMMARY.md`, not at a registry status or a
clean `agent_runs.status`.

One qualifier in the other direction, so this isn't read as "the registry is worse than it looks":
this phase also found the registry *undercounts* the real roster. 6 more agents exist on disk, fully
working (all 6 tested came back WORKS), sharing a canonical number with a completely different
registered agent — invisible to the registry entirely. And a 7th real agent (AG-43, Funder Signal
Monitor) has no registry row at all. The registry isn't uniformly optimistic; it's just an unreliable
map in both directions — some things it says are running aren't doing anything, and some things that
are running and working aren't in it at all.

## The 13 false-pass casualties, at a glance

| Agent | What it's supposed to do | Why it writes nothing |
|---|---|---|
| AG-05 (Corporate Giving research) | Discover corporate-giving opportunities | Zero opportunities/funders found this run — plausibly a real CAPTCHA/bot-block on the live Google search dependency, not confirmed either way. |
| AG-13 (Foundation Enrichment) | Enrich foundation website/contact data | Hits a CAPTCHA wall with no solver key configured — a real, currently-scheduled weekly production job. |
| AG-14 (Donor Discovery) | Process queued donor-discovery requests | The RPC it depends on doesn't exist in production. Fails silently into a server log line — nobody would ever see this happening. |
| AG-18 (Reputation Intelligence) | Monitor funder reputation risk | Its search dependency (DuckDuckGo's free API) is a near-empty test index, not a real search API — very likely near-permanently broken for real queries, not just this run. |
| AG-23 / AG-32 (Relationship Graph) | Map board-member-to-funder connections | Real run, zero connections found — plus AG-23 itself has never had backing code; the real class only ever answers to AG-32's number. |
| AG-24 (Outreach Generator) | — | Not actually agent-framework code at all; its registry entry describes writes it was never designed to make. |
| AG-25 (Deadline Prediction) | Predict ambiguous/missing deadlines | Every seeded opportunity already had a real deadline — a grounded null result on this data, not confirmed broken against real ambiguous cases. |
| AG-26 (Funding Forecast) | Monthly funding forecast per org | A real database constraint the upsert needs is missing — the write fails every time. |
| AG-30 (Donor Intent Monitor) | Detect corporate donor intent signals | 6 real Claude web-searches, zero call failures, zero results — plausibly because the seed company names have no real web footprint. |
| AG-36 (Learning Network Aggregator) | Extract cross-org learning patterns | This run's own delta was 2 updates / 0 creates — genuinely correct idempotent behavior on this data, not a broken pipeline (see the summary for why this one's different from the other 12). |
| AG-40 (Strategic Advisor) | Generate strategic recommendations | Reproduces an already-known schema bug (org-blind org profile) plus its own separate zero-row result. |
| AG-42 (Change Monitor) | Detect real-world funder/foundation changes | Real run, zero corporate-monitoring events — first-run-with-no-baseline is a plausible explanation, not confirmed. |
| AG-43 (Funder Signal Monitor) | Watch funders for relationship signals | Same class of "real search, synthetic test data, nothing to find" as AG-30 — plus it has no registry row at all. |

Six of these (AG-13, AG-18, AG-26, AG-20-adjacent-via-WGR-033, plus the AutoApply
enrichment-processor pipeline behind AG-20/21/22) trace back to real, fixable infrastructure or
dependency problems (missing DB constraint, missing RPC, a search API that structurally can't do the
job, a boot-wiring gap already flagged in PT-08). The rest are genuinely ambiguous on this specific
test data — real seed limitations, not confirmed code defects — and that ambiguity is stated
explicitly in every row, not smoothed over.

## What's flagged but not (yet) a confirmed bug

- **AG-12 (AutoApply)** — this project's single most consequential automated action (real emails to
  real funders, real browser form submissions to real government/foundation portals) has **no
  dry-run mode anywhere in the codebase.** That's not a finding about whether it works — it's a
  finding that nobody can verify whether it works without actually doing the thing. Worth a real
  simulation-mode build before this agent gets another blind pass. WGR-092.
- **AG-31/33/34** — no code exists for any of the three. AG-31 is honestly tracked as
  not-yet-built in the registry; AG-33/34 aren't in the registry at all. Neither is a surprise, both
  are now on record with a fresh grep confirming it, not an old claim carried forward.

## Recommendation

**Trust the 26 WORKS agents as real.** They earned it — real Claude calls, real deterministic
computation, real writes, independently re-checked.

**Don't trust "BUILT" from any prior document without a row-delta check like the ones in this
phase**, going forward. The registry, the trigger-wiring status, and a clean `agent_runs` completion
are each necessary but none of them, together or alone, are sufficient — that's the concrete lesson
30% of the roster just taught this audit program.

**Five things worth fixing before the next full pass, in rough priority order:** the missing
`funding_forecasts` upsert constraint (AG-26, a one-line DDL fix); the missing donor-discovery RPC
(AG-14, currently fails silently — at minimum this should log somewhere a human would see it); a
CAPTCHA-solver key for the scheduled foundation-enrichment job (AG-13); a genuine assessment of
whether DuckDuckGo's free API can ever serve AG-18's actual purpose, or whether it needs a real
search provider; and a decision on whether `worker/enrichment-processor.ts` (AG-20/21/22 plus 8
unregistered EA-0X agents, WGR-033) is worth wiring into boot given AG-20's own separate timeout bug
would still need fixing regardless.

Everything else in the 13 — the "real search found nothing on synthetic test data" cluster (AG-05,
AG-30, AG-42, AG-43) and the idempotent-update case (AG-36) — needs re-testing against real-world
subject data before it can be called broken or confirmed working. That's the natural next audit
pass, not a fix to make blind.
