# PT-04 Review Pack — read this one, not the raw evidence, unless you want the raw evidence

For the full numbers and how every count was produced, see `PHASE-04-SUMMARY.md` in this same
directory. This doc is the short version: which computed numbers does a real user actually see, are
they correct, and what's the single most important thing to fix.

## The question you actually care about: are the numbers users see correct?

**Mostly yes, with one confirmed exception that's live in production today.** Six business-logic
functions were checked this phase: how a draft narrative's confidence score is computed, how
AutoApply decides an org is "ready" to submit, how a budget reconciliation report is totaled, how
deadline reminders decide when to fire, and how a grant opportunity's match/fit probability score
is computed — both its internal arithmetic (call the function, hand-check the math) and, separately,
whether the number a user actually sees on screen still matches what that arithmetic *should*
produce right now. Five of six came back clean. The sixth — match/fit probability — has correct
arithmetic but a real, currently-live staleness bug in when that arithmetic gets re-run.

### The one to fix first: match/fit scores go stale and nothing ever refreshes them

The Opportunities page shows every opportunity a probability/fit score and a recommendation
("apply" / "consider" / "skip"). That score is computed once by `computeGrantProbability()` and
then just... read forever. Nothing recomputes it when the data it's based on changes. We found a
real opportunity where the organization's eligibility score was calculated 17 days *after* the
opportunity's probability score was — so the probability score is still using a placeholder
"we don't know yet" value for eligibility, even though a real eligibility score has existed for over
two weeks. Applying the documented formula to the real, current data gives a probability of 47; the
number on screen says 42. We checked 9 more real, live rows the same way and found the identical
pattern on 3 of them (all belonging to the same organization) — this isn't a one-off, it's what
happens to every opportunity whose data changes after it's first scored. **WGR-135, P1.**

In the one case we deep-dived, the wrong number didn't change the recommendation category (both 42
and 47 land on "consider") — so nobody was told to skip something they should apply to, or vice
versa, in that specific instance. But there's no mechanism stopping a bigger drift from crossing
that line for some other opportunity, and there's no visual indicator anywhere telling a user the
number they're looking at might be two weeks (or more) out of date.

## What actually held up, stated plainly (not everything in this phase was a finding)

- **Every formula's own arithmetic is correct.** Draft-confidence scoring, AutoApply
  readiness scoring, budget reconciliation, deadline-reminder thresholds, and the match/fit
  engine's internal math were all hand-verified against 21 total test scenarios covering documented
  branch boundaries, penalty stacking, neutral-fallback defaults, and exact threshold edges (e.g.
  confirming the "apply" recommendation fires at score `>=70`, not `>70` — a real class of bug this
  was specifically checked against). Zero mismatches. **WGR-136, WGR-137.**
- **A real budget reconciliation, run through the real live API with real seeded data, totaled
  correctly to the penny** — $26,500 budgeted, $7,000.75 spent, $19,499.25 remaining, marked
  "under budget," matching an independently hand-summed check exactly.
- **Deadline reminders fired at exactly the right day-offsets across 6 real scenarios**, including
  the trickiest case (a deadline due today, where all five reminder thresholds should fire at once)
  and the idempotency rule that an already-sent reminder never re-fires.
- **The match/fit engine's own arithmetic is not the problem** — it computes the correct number
  every time it's actually called. The bug isn't in the formula; it's that the formula almost never
  gets called again after the first time.

## Priority order, if only fixing one thing today

1. **WGR-135** — give `opportunity_probability_scores` a real recompute trigger. The cleanest fix
   is a chained recompute the moment `opportunities.eligibility_score` (or the org's
   `organizational_digital_twins.twin_completeness_score`, or a new same-category `outcomes` row)
   changes — the same event-driven pattern this codebase already uses elsewhere for cross-feature
   updates, not a new architecture. A cheaper interim fix: a nightly sweep that re-scores any row
   older than N days, or a staleness indicator in the UI so a user at least knows the number might
   be out of date. Either is better than the current state, where a score computed once in early
   August is still being shown as current in late August with zero signal that anything changed
   underneath it.
2. Everything else this phase touched (draft confidence, AutoApply readiness, budget reconciliation,
   deadline reminders, and the probability engine's own math) needs no action — it's correct as
   implemented, hand-verified against real data and real API calls, not just read from source.

## Next-phase note

This phase verified computation correctness for the six functions with a documented, checkable
formula and clear production impact. It did not attempt an exhaustive sweep of every scoring/
aggregation function in the codebase (e.g. the corporate-prospect propensity rubric, forecast
projections, or the various agent-decision confidence scores) — those exist and would benefit from
the same hand-verification-against-real-data method used here, but were out of this phase's scope.
A future phase picking that up should also revisit whether WGR-135's staleness pattern (compute
once, never revisit) recurs on any of those other persisted scores — the same architectural gap
(no change-triggered recompute) is a plausible risk anywhere a computed value is persisted rather
than derived live.
