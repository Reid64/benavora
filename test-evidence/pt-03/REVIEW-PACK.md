# PT-03 Review Pack — read this one, not the raw evidence, unless you want the raw evidence

For the full numbers and how every count was produced, see `PHASE-03-SUMMARY.md` in this same
directory. This doc is the short version: can a real user actually get through the core workflows
this app is built around, and what's the single most important thing to fix.

## The question you actually care about: are the core journeys operable end to end?

**Mostly yes — but with two real breaks along the way, and a structural gap underneath the
pipeline's stage machine that matters more than either of them.** Three full journeys were driven
through the real UI against a real (local, non-production) database: signup → onboarding →
discovery → draft → pipeline → deadline; Donor Discovery prospect → review → route into AutoApply;
and AutoApply queue → session → form-fill → submit. The Donor Discovery → AutoApply hand-off is
real, not two features tested in isolation and described as connected — the exact database row one
journey creates is the row the other journey continues from, checked at the seam. But this phase
also found that the kanban pipeline's own documented stage-transition rules are enforced in exactly
one place (a UI component), that a fully successful, fully-paid-for AI draft generation can vanish
without a trace, and that a genuinely valid password-reset link can be shown to a user as invalid.

### The one to fix first: the kanban stage machine has no enforcement below the UI

Three separate ways of skipping the one place `getTransitionRule()` actually gets checked
(`StageTransitionModal.tsx`'s own pre-submit code) all worked, every time, with zero rejection:
calling the shared `executeTransition()` function directly, writing `applications.stage` with a raw
database update that never touches `executeTransition()` at all, and a `viewer`-role session
performing a transition the app's own rule says only an owner or admin may perform. None of these are
contrived edge cases — `executeTransition()` is the pipeline's own exported, reusable function
(anything other than that one modal component that ever needs to move an application has to call it
directly), there is no API route for stage mutation at all, and the database has no constraint on
what `stage` value a row may hold or which prior value it's reachable from. The rule itself is
correct and well-tested (144 documented transitions, 80 legal, all verified correct; 3 full journeys
covering all 12 real stages with 23/23 legal transitions persisting correctly) — the problem is
purely that nothing besides one React component's pre-submit check stands between "an authenticated
user of any role" and "set any application to any stage." **WGR-130/WGR-131 (P0), WGR-132 (P1).**

### The second one: a successful, fully-paid-for AI draft can silently vanish

We drove the real 4-step Draft Generator wizard, clicked the real "Generate draft" button, and got a
real `200` back with a genuine 31,727-byte grant narrative — a real, successful Claude API call that
took just under two minutes and cost real tokens. Zero rows were written to `draft_versions`. The
route doesn't check whether its own save succeeded before returning success to the client, and the
client doesn't check the response for confirmation that a save happened before advancing the wizard
— so a silently-lost draft looks, from the user's side, exactly like a saved one, right up until they
reload the page and it's gone. The specific trigger this session found (a missing database trigger)
is a local-test-stack gap, not confirmed to exist in production — but the underlying pattern (a save
that fails silently and a client that trusts a `200` unconditionally) is real regardless of whether
that specific trigger is present anywhere. **WGR-129, P0.**

### The third one: a genuinely valid password-reset link gets rejected

We requested a real password reset, received a real email, and followed the real link. The server-
side token exchange actually succeeds — but the reset page shows "This link is no longer valid"
anyway, and the user is left unable to change their password at all (independently confirmed against
the auth server directly: the old password still works, the new one was never accepted). Root cause:
the page's mount code calls the token-exchange function with no protection against being called
twice, and this app's own React configuration (Strict Mode) calls every mount effect twice in dev —
the two calls race for a token that can only be used once, one wins for real, and the other's failure
is what the user sees. This reproduced on every attempt. It has not been confirmed to happen in a
production build, where that double-call behavior doesn't occur — flagged as a real, currently-
reproducing development-mode defect, not asserted as confirmed in production. **WGR-133, P0.**

## What actually held up, stated plainly (not everything in this phase was a finding)

- **The core signup-to-deadline loop works**, including a real agent-driven opportunity-discovery
  run against live government data sources and a real AI-generated grant narrative — the generation
  itself works; only its persistence is broken.
- **The Donor Discovery → AutoApply hand-off is genuinely wired**, confirmed by re-querying the exact
  database row at the seam, not asserted from two separately-passing tests.
- **AutoApply's simulated stages (session/form-fill/submit) made zero real external HTTP calls**,
  checked via a machine-readable flag on every stage, while still exercising the real worker's exact
  database write shapes.
- **The kanban transition rule itself is correct** — 80 of 144 documented transitions are legal, and
  every one of 23 real transition steps across 3 full journeys (including a backward move and a full
  denial/renewal cycle) persisted correctly. The gap is enforcement, not the rule.
- **2 of 3 auth flows work cleanly**: magic-link login, and session persistence across a real page
  reload (including a second browser tab in the same session with no re-login).
- **A test-harness failure was investigated and correctly not registered as an app bug**: the
  pipeline stage's first-attempt Playwright timeout was root-caused to the test script's own
  navigation-detection method, confirmed via a same-journey retry using the exact same real UI
  interaction — a discipline worth naming, since it means the register's findings are real app
  gaps, not artifacts of how the tests were written.

## Priority order, if only fixing one thing today

1. **WGR-130/WGR-131** — give the kanban transition graph a real enforcement layer below the UI
   (either a server-side check inside `executeTransition()` itself, or a proper API route for stage
   mutation with the rule enforced there, or a database constraint/trigger). Right now any
   authenticated user, or any future code that calls the shared function directly, can move an
   application to any stage from any stage.
2. **WGR-129** — make draft persistence failures loud instead of silent: have `generateDraft()`'s
   insert failure actually surface to the route's response, and have the client check for it before
   treating generation as complete. A user should never be able to lose a real, already-generated,
   already-paid-for draft with no indication anything went wrong.
3. **WGR-133** — add an idempotency guard around `exchangeCodeForSession()` in
   `ResetPasswordPageClient.tsx` (a ref/flag, or an `AbortController` on the effect's cleanup) so
   React Strict Mode's double-invoke in dev can't race the single-use PKCE verifier. Worth an
   explicit check against a production build too, to confirm whether this is dev-only or reaches
   real users.
4. **WGR-132** — same root cause as #1, narrower blast radius: extend whatever server-side
   enforcement is added there to also check role, not just legality of the transition.
5. **WGR-134** — cheap, low-severity: have the AutoApply QUEUE mini-panel check `queueError` the
   same way the Session List table on the same page already does, instead of rendering "Queue is
   empty" on any load failure.
