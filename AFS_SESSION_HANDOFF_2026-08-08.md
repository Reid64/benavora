# AFS Platform — Session Handoff (2026-08-06/07/08 session → next session)

Paste this entire document as your first message in the new chat.

## What this project is
AFS (Architectural Flashing Supply) platform — a full-stack RFQ/quoting
system for Steve Harycki (owner, AFS, Burnet TX) built by Reid Whitesides
at Visual AI Method. Next.js 14/TypeScript/Tailwind/Supabase/Vercel.
Project root: `C:\Users\manag\Documents\afs-website`. Live site:
`afs-website-alpha.vercel.app`. GitHub:
`architectural-flashing-supply/afs-platform`.

Read `STATE_OF_THE_BUILD.md` and `SESSION_STATE.md` at the project root
first — a governance-doc update was requested at the end of this session
(prompt given, execution/push NOT independently confirmed before this
handoff was written — verify it actually landed, see Priority 0 below).

---

## Priority 0 — Verify the last few things actually happened

This session ended with several prompts given to Claude Code whose
completion was **not independently confirmed** before the session ended.
Per this session's own hard-won lesson (see "Key Learnings" below), do
not assume any of these are done. Check each:

```powershell
cd C:\Users\manag\Documents\afs-website
git log --oneline -10
git status
pnpm tsc --noEmit
```

Compare the log against the commit list in "Confirmed Deployed" below.
Specifically verify:
1. Did the governance-docs update (STATE_OF_THE_BUILD.md/SESSION_STATE.md
   accuracy pass) actually get committed and pushed?
2. Did the **literal exact-coordinate hem glyph fix** (see FlashDraft
   section below) get run at all? It was specified in full but never
   confirmed executed before this session ended.
3. Did the **mid-leg hem removal** fix (disabling drag-back-on-any-leg
   hem creation as fabrication-impossible) get run? It was queued twice;
   user accidentally ran a different prompt first; unclear if it was ever
   actually executed.
4. Is there an unrelated, **abandoned, half-specified task** sitting in
   your context about a "Class 4 badge on the shingles page" being made
   2x larger — this was cut off mid-prompt-composition when the user
   asked for this handoff instead. It was never sent to Claude Code. Low
   priority, but don't lose it; user may want it done.

For every deployment claim in this document, re-verify via:
```powershell
vercel ls
```
or, if the Vercel MCP connector is available (see "Tools" below), via
`Vercel:get_project` / `Vercel:list_deployments` directly — do not trust
a Claude Code summary's claim of "pushed successfully" without seeing the
actual `git push` output and, ideally, confirming `readyState: READY` on
the resulting deployment yourself.

---

## Priority 1 — PathfinderEdge / Thalmann integration (PRODUCTION-BLOCKING)

**This is a live shop-floor problem, not a software bug.** On Saturday
(the day this session ran long), Steve attempted to send a real test
job from PathfinderEdge directly to the Thalmann CNC bending machine
(not through the AFS platform — directly through PathfinderEdge's own
UI) and **it did not reach the machine.** Cause unknown as of this
handoff. This is blocking real production work, not a build-quality
issue.

### What's confirmed true:
- Catalog **`afs`** (lowercase, ID **20115**) is the correct sync target
  under Thalmann's catalog filter in PathfinderEdge Admin — confirmed
  directly by Seth Oliver at AMS Controls (support contact, see below)
  and by screenshots of the actual filter UI. Catalog `AFS` (uppercase,
  ID 20116) and `Profiles for Pricing` are NOT synced.
- A profile (`32890799`) was successfully created via
  `POST https://afs.pathfinderedge.com/api/v1/profiles` returning HTTP
  200 — **but this was NOT created by the AFS platform's own code.**
  `lib/integrations/pathfinder-edge.ts` is confirmed (read directly,
  multiple times this session) to be a complete stub — every exported
  function returns a hardcoded `not_configured` result with **zero real
  network calls anywhere in the file.** The origin of the successful
  create-profile request is unknown; it was NOT made from within this
  application. It may have been a manual/scripted test from a prior
  session or from Steve's/Reid's own machine — searched git history and
  this repo for any trace of it (`git log --all -S "32890799"`, full-repo
  text search) and found **nothing.** It is not recorded anywhere in this
  codebase.
- The old "AFS Website Integration" API key was deleted and a new key
  was generated from PathfinderEdge's "Machine API keys" admin page.
  Testing the new key against `GET /api/v1/catalogs` with both
  `Authorization: Bearer <key>` and `X-API-Key: <key>` headers both
  returned **401 Unauthorized** (not 404 — the endpoint is real and
  responding, just rejecting the auth).
- Seth Oliver's diagnosis (unconfirmed, needs verification): the original
  working key may have been a *different type/scope* of key than the one
  generated from the "Machine API keys" page — possibly explaining the
  401 even with a correctly-formatted header. He asked Reid to compare
  the header format from the original successful request against the
  new one — **this could not be done because no record of the original
  request exists anywhere searchable.**

### What's NOT yet confirmed / needs investigation next session:
- Whether Saturday's direct-from-PathfinderEdge send failure is related
  to the API key issue at all (it shouldn't be — that's a user-session
  action, not the Machine API key — but this needs confirming, not
  assuming).
- Whether PathfinderEdge has a Jobs/Sync/Queue log visible in its Admin
  panel that would show the actual send attempt and its real error.
- What the Thalmann's own physical control panel showed (if anything)
  when the send was attempted.

### Action plan, in order:
1. **Call AMS Controls directly** (not email — this is time-sensitive):
   Seth Oliver, direct **(314) 292-5692**, office **(314) 344-3144 x192**,
   email `soliver@amscontrols.com`. Ask him to pull server-side logs for
   Saturday's send attempt and explain definitively why it failed.
   Reid has an explicit, strong, standing preference (see Key Learnings)
   for root-cause fixes over workarounds — do not suggest manual/local
   machine workarounds unless Reid asks for one specifically.
2. Once real log data comes back, resolve the 401/auth-header question
   using that data, not further guessing.
3. Only after PathfinderEdge send-from-its-own-UI is confirmed working
   again should any further work happen on `lib/integrations/pathfinder-edge.ts`
   (which remains a complete stub — building the AFS platform's own
   automated push-to-PathfinderEdge integration is a separate, not-yet-
   started task that should wait until the more basic manual-send path
   is confirmed healthy again).

---

## Priority 2 — FlashDraft hem glyph geometry (UNRESOLVED — do not trust prior "fixed" claims)

This has been the single most contentious, most-iterated item this
session — at least 5 separate fix attempts, each claimed complete by
Claude Code, each subsequently shown to still be wrong when the user
actually looked at it. **Do not mark this as resolved without the user
explicitly confirming against real, current, live evidence.**

### Chronological attempt history (all confirmed deployed via Vercel,
### all subsequently found still-wrong by the user):
1. Original hem popup: unreliable double-click trigger, all three hem
   types rendered as identical dots with text labels only.
2. First redesign attempt: widened hit radius, added `drawHemGlyph()`
   canvas glyphs — user found Open looked like "a backwards J," Smashed
   looked more open than Open, Teardrop was two disconnected primitives
   (a stick + a separate filled circle) reading as a toggle switch.
3. Second redesign: literal capsule/loop coordinates specified by Reid's
   session partner (component tags used, precise geometry) — user found
   Teardrop now looked like "an umbrella."
4. Investigated: found the **live production canvas was not
   devicePixelRatio-aware** (unlike the debug view and popup icons, which
   were) — hypothesized this was scaling/distorting otherwise-correct
   shapes. Fixed DPR handling, differentiated Open/Smashed further.
   Commit `abb5da8`, confirmed deployed (`dpl_7gig4KbJbw22szpXE3vCZAzLpjzr`,
   READY). **User has not yet confirmed this fixed it or not** — last
   screenshots after this fix still showed a small red blob/hook shape
   that didn't clearly read as correct, though it was visibly different
   (no longer the lollipop/disconnected-circle shape).
5. A **6-hour, expensive Claude Code audit session** ran, producing real
   evidence (5 PNG files: `hem-audit-open.png`, `hem-audit-smashed.png`,
   `hem-audit-teardrop.png`, `hem-audit-popup.png`, `hem-audit-applied.png`,
   committed in `3786ff0`) showing: Open and Smashed render as solid
   filled capsule/pill shapes (some differentiation, but no visible gap
   or relationship to the leg line) and **Teardrop renders as a genuinely
   broken, self-intersecting paisley/scribble shape** — confirmed
   objectively wrong, not a subjective complaint.
6. **Final action taken this session**: a fully literal, exact
   `ctx.beginPath()`/`ctx.arc()`/`ctx.bezierCurveTo()` canvas-path
   specification was written (by Claude, verified visually via an
   independently-rendered SVG reference image before being handed off —
   see below) and given to Claude Code as a **verbatim, do-not-reinterpret**
   implementation prompt. **Whether this was ever actually run is
   UNCONFIRMED** — this is the single most important thing to check first
   in the new session (see Priority 0).

### Reference image cross-check (visual ground truth, already built and verified):
Claude independently built and visually verified (rendered via
`wkhtmltoimage`, inspected directly) a correct reference at
`/mnt/user-data/outputs/hem-shapes-reference.png` in this conversation —
this shows what Open/Smashed/Teardrop SHOULD look like: Open = a clear
hook with a visible parallel offset gap; Smashed = the same shape crushed
nearly flat; Teardrop = one continuous closed raindrop/loop shape, no
detached pieces. If that image is not available in the new session,
regenerate it — the exact SVG path data and Canvas-equivalent path
commands are recorded in this session's history and are correct
(visually confirmed, not guessed).

### If the literal-coordinate fix (item 6 above) was never run, or was
### run and still doesn't look right:
Do **not** write another descriptive-language prompt for Claude Code to
interpret. That approach has failed at least 4 times. Instead:
1. Render the exact reference image again (SVG → PNG via `wkhtmltoimage`,
   or equivalent), look at it directly, confirm it's correct.
2. Hand Claude Code the literal path commands verbatim (recorded in this
   session, reconstructable from the reference image's SVG source),
   explicitly instructed not to reinterpret, redesign, or adjust.
3. Have Claude Code save screenshots of the result (both the isolated
   debug view AND the real applied canvas/popup) as files, and require
   those files be sent back for direct visual confirmation before
   claiming success — no prose-only "verified via Playwright" claims
   accepted as sufficient for this specific item, given the track record.

### Related, also possibly unconfirmed:
- **Mid-leg hem creation was determined to be fabrication-impossible**
  (a hem can only exist at a true terminal cut edge of the flat pattern,
  never mid-leg while material continues on both sides — confirmed
  against every real reference image collected: AFS order sheets,
  PathfinderEdge screenshots, hand sketches — all show hems only at true
  ends). A fix to **remove the "drag back on any leg for a hem there"
  gesture entirely**, leaving only endpoint double-click as the way to
  create a hem, was specified in full but **execution status is
  unconfirmed** (see Priority 0, item 3).

---

## Priority 3 — FlashDraft interaction bugs (mostly resolved, spot-check before trusting)

These were fixed, confirmed deployed, and — unlike the hem glyphs — were
generally verified working by live Playwright testing with good rigor
(root causes traced, not guessed). Still worth a quick manual spot-check
given today's overall trust deficit, but treat these as likely genuinely
fixed:

- **Two-step line drawing** (empty-canvas click required a separate
  drag instead of one continuous click-drag-draw motion) — fixed,
  commit in the `36579a0`-era range.
- **Mid-leg hem-drag endpoint-priority conflict** (starting the drag-back
  gesture at/near an interior vertex or the last point got swallowed by
  vertex-drag or line-continuation instead) — fixed via direction-based
  disambiguation (a 60° backward cone), Playwright-verified from all
  three previously-broken starting points. Commit `36579a0`.
  **NOTE**: this entire gesture may since have been removed per the
  fabrication-impossibility finding above — check current state.
- **Leg-body reshape gesture** (grab a leg's body, drag forward/
  perpendicular to reshape length/angle) — built from scratch, extends
  the same direction-based disambiguation pattern. Commit `1292e0f`.
  Caught and fixed a real teleport-vs-extend bug during its own
  verification (grab-offset tracking).
- **Reflex/collinear angle guard rail** (a drag could push a bend past
  180°, and `buildBendSummary()`'s use of `Math.acos()` would silently
  misreport a true reflex angle as its unsigned supplement in submitted
  quote text — a real fabrication-accuracy risk, not cosmetic) — fixed
  by clamping drag angle to [1°, 179°] at the interaction level
  (prevention, not attempted correct-representation of reflex angles).
  Commit `875c51e`.
- **Stray drag state on mere cursor movement** (a leg-body click left
  `legBodyDragCandidateRef` armed if pointerup never fired correctly —
  e.g. release outside canvas, popup stealing focus — causing subsequent
  mouse movement with NO button held to silently continue a live
  reshape drag) — fixed at three layers: unconditional cleanup in
  `handlePointerUp`, `onLostPointerCapture`, and a window blur listener,
  plus a defensive `e.buttons === 0` guard. Commit `4866dea`.
- **Undo/redo silently broken** — two real bugs, not one: (a) hem
  creation/removal never pushed undo history at all (history was
  `Point[]`-only, widened to a full `ProfileSnapshot`); (b) a sneaky
  `autoFocus`-triggered stray blur on the segment-length input was
  silently calling `commitPoints()` with an unchanged value on every
  reshape/hem-drag start, polluting the undo stack so every subsequent
  Undo click was a no-op. Both fixed, commit `4866dea`.
- **Clear/Reset button** — confirmed already existed (`clearCanvas`) and
  works correctly; nothing needed.
- **Negative/"impossible" bend angle display** ("-90°", "-75°" shown on
  canvas — CNC brakes only accept 0–180° interior angles, direction is
  never a sign on the angle) — **this was raised by the user but the fix
  for it may not have been run** — the user clarified mid-conversation
  that the actual complaint was about hems appearing mid-leg (the
  fabrication-impossibility issue above), not the negative-angle display
  specifically. Worth double-checking whether negative angle labels are
  still visible anywhere in the UI (canvas labels, `buildBendSummary()`
  output) — this remains a real correctness concern per this project's
  own governance note that Thalmann bend angles must be unsigned 0–180°,
  even if it wasn't the main thread pursued this session.

---

## Priority 4 — FlashDraft template rebuild (NOT STARTED — fully specified, zero implementation)

A complete 21-item template replacement was designed and locked with the
user, with extensive real reference images collected (AFS order sheets,
manufacturer spec sheets, PathfinderEdge screenshots) for most items.
**Zero implementation work has begun** — this was repeatedly deprioritized
in favor of fixing FlashDraft interaction bugs as they surfaced.

### Final locked template list (replaces the current 10-item set entirely):
1. Z Closure
2. Sill
3. J-Channel
4. Z-Spacer Trim
5. Outside Corner
6. Inside Corner
7. Window Drip (NOT "Window Drip Rev" — that variant was explicitly dropped)
8. Siding Starter
9. Stucco Perimeter
10. Pitch Change
11. Drip Edge
12. Drip Edge with Kick
13. Hook Drip Edge
14. Sidewall
15. Head Wall (confirmed distinct from "Endwall" — user sent a specific
    red-colored head wall reference image)
16. Ridge Cap Vented
17. Counter
18. Peak Wall (= the chart's plain "Peak" entry — 6", specify angle,
    painted side — confirmed by user)
19. Gutter
20. Valley

**Explicitly deleted/dropped from consideration**: "Cap w/ Kick & Hem"
(folded into Coping Cap as a variant instead), "J-Closure" (deleted per
user instruction — distinct from J-Channel, real reference image exists
but user said drop it), "Closure Trim" (disregarded — no reference ever
provided, redundant with other items).

### Multi-variant "pop-up picker" categories (NOT flat template buttons):
- **Coping Cap** — real AFS order-sheet reference shows 3 distinct
  cleat-configuration variants (2-piece cleat / 1-piece cleat / face
  cleat) plus the main cap cross-section with 2 hemmed leg ends.
- **Valley** — real AFS order-sheet reference shows 3 distinct leg-end
  treatments (closed/rolled hem, open hook, heavy reinforced closed fold).

Design intent: these two get a reusable `VariantPicker` component (build
generically, not hardcoded per-profile, so other profiles can get the
same treatment later without rebuilding the mechanism) — clicking the
category button opens a small thumbnail selector, user picks the real
variant, that specific geometry loads into the canvas.

### Reference images collected (exist in this conversation's history,
### re-extractable if needed, or user has originals):
- PAC-CLAD Color Guide PDF (full Standard/Premium/Timber Series color
  palette with hex-equivalent swatches) — for the color-picker feature
  (Priority 5).
- Real photos/diagrams for: Coping Cap (3D render + your own order-sheet
  sketches), Counter Flashing, Endwall (with cleat), Gravel Stop (x2,
  NOT on final list, disregard), Base Flashing Open Hem (not on list),
  Cleat (not on list), Sidewall + Sidewall Flashing Detail diagram,
  Siding Starter, Drip Edge (pitched/90°), J-Channel (3 hem variants:
  open/smashed/teardrop — useful for hem glyph calibration too), Aluminum
  J Channel, Z-Spacer Trim, Outside Corner (x2 separate images — strong
  corroboration), Pitch Change (dimensioned, "Pitch Change 10', Non
  Stocked Trim"), Ridge Cap Vented, Sill Pan, Stucco Perimeter, Window
  Drip, Z-Closure Flashing, Inside Corner, Gutter, Valley, Head Wall (red,
  dimensioned), Drip Edge with Kick (Northshore Sheet Metals, fully
  dimensioned E/A/B/C/D table), J-Closure (dropped, but reference exists:
  1-1/4" x 1-1/4" roofing-specific closure), Z-Closure Trim, Hook Drip
  Edge (dimensioned, 4-3/8"/2"/3/8"). A "Standard Flashings and Trims"
  manufacturer reference chart was also provided as a **future
  build-from reference**, not applied to this pass — contains a "Peak"
  entry (confirmed = Peak Wall) plus many other profiles not on the
  current 20-item list, worth mining later.
- Real AFS order-sheet hand-sketches (5 total from one batch) showing
  J-Channel, Sill Flashing, Flashing Fastened, Closure Flashing, Outside
  Corner Trim, J-Closure Trim, Z-Spacer Trim — these are genuinely
  representative of real incoming customer/field orders (per Reid: "the
  vast majority of incoming project quotes will look exactly like this")
  and are valuable both as template geometry sources AND as Blueprint
  Takeoff AI test documents (hand-sketched quadrant-layout order forms).

### Explicit design constraints given by Reid, must be honored:
- Geometry for all shapes must come from real reference images (shape
  only) — **never copy painted/rendered colors from a reference photo**
  into the canonical geometry data; color is a separate, dynamic,
  user-selected attribute (see Priority 5).
- Do not copy exact dimensions from any single reference image as if
  universal — use reasonable standard dimensions consistent with AFS's
  own conventions, not whatever one stock photo happened to show.

### Sequencing (as designed, never started):
- **Pass 1**: Canonical profile geometry data — add real bend-point/leg
  data for all 20 flat-list profiles plus the Coping Cap and Valley
  variant sets to `lib/data/catalog.ts` or equivalent.
- **Pass 2**: Swap FlashDraft's template button row for the new list,
  build the reusable `VariantPicker` component, wire Coping Cap and
  Valley to it.
- **Pass 3**: Canvas background changed to a lighter gray; sidebar
  dimension-input boxes redesigned to be more compact (currently
  described by Reid as "quite bulky").
- **Pass 4**: PAC-CLAD "Painted Color" selector added to the sidebar,
  sourced from the color guide PDF, wired so selecting a color actually
  changes the rendered material color in the 3D preview (confirmed
  separate ask, zero hours spent on it despite explicit frustration
  about this — see Reid's own words: "not a damn thing has changed with
  that either").

---

## Confirmed-deployed commit history, most recent first (verify against
## live `git log` — do not trust this list blindly, it was accurate as
## of this handoff being written)

```
abb5da8  fix: DPR-aware live canvas, unified glyph scale constants, Open/Smashed differentiation
3786ff0  audit: add hem glyph rendering audit evidence images
0a117eb  feat: add hem glyph debug view, fix illegible popup icon size
4866dea  fix: stray drag state on mere cursor movement, undo/redo history gaps
912f0b9  fix: rewrite drawHemGlyph with literal capsule/loop coords, unify popup icons, fix drag-artifact bug
875c51e  fix: clamp bend angle to prevent reflex/collinear states, redesign hem glyphs, fix reshape UX conflict with length input
1292e0f  feat: leg-body reshape gesture via direction-based disambiguation, extending the hem-drag pattern
36579a0  fix: direction-based disambiguation lets leg-hem-drag arm correctly from interior vertices and the last point
518ccc2  refactor: extract HemType/Hem to shared lib/types/profile.ts for reuse across FlashDraft and future Photo-to-Quote
88c98a5  fix: replace fabricated 16in roof panel default with drawing-first extraction + user width selection; fix catalog copy and profile-type dropdown gap
4cec386  fix: resolve informal profile labels to canonical geometry, infer topology from extracted dimension shape for unmapped types
c9c2da8  fix: use Anthropic Files API for takeoff PDFs instead of inline base64, avoiding 32MB request-size limit
9c2a2ff  fix: raise page limit to 100 with real enforcement, add scope-directive control to Blueprint Takeoff, fix takeoff request body contract mismatch
202ec8c  fix: add editable dropdowns and dimension inputs to takeoff results, vary 3D preview by profile type
471629f  fix: correct type predicate for Supabase materials joined relation array shape
```
(Full session may have additional commits after `abb5da8` if the
governance-doc-update or literal-hem-coordinate prompts were actually
run — check `git log` for anything newer.)

---

## Blueprint Takeoff AI — separately resolved this session, likely stable

Several real infrastructure bugs were found and fixed on the `/upload`
Blueprint Takeoff flow, unrelated to FlashDraft. These are believed
solid (confirmed via direct log/deployment verification, not just
Claude Code claims):

- **Vercel serverless function body limit (4.5MB, hard platform ceiling,
  unconfigurable)** was silently breaking any upload over that size.
  Fixed by switching to direct browser-to-Supabase-Storage upload via
  signed URL, bypassing the function entirely for raw file bytes.
- **Anthropic Messages API 32MB total request-size limit** (inline
  base64 encoding inflates raw bytes ~33%, so files over ~24MB raw were
  blowing this ceiling even after the Vercel fix) — fixed by switching
  to Anthropic's Files API (upload once, reference by `file_id`, delete
  after processing) instead of inline base64.
- **Migration 014** (`takeoff_uploads` status enum needed `'pending'`
  added for the new upload flow) was written but not initially applied
  to live Supabase — found via direct `pg_constraint` query (the
  reliable way to check; PostgREST-based checks give false positives on
  this project, confirmed multiple times), applied directly via SQL
  Editor, re-verified.
- **Extraction coverage**: system prompt strengthened to require
  page-by-page systematic review with no early stopping, and to
  explicitly permit/expect null material/gauge/dimension fields when a
  drawing genuinely doesn't specify them (very common on real
  architectural CD sets — confirmed on 3 separate real documents this
  session: a 20-page residential set, a 57-page commercial set, and
  real AFS hand-sketch order forms all showed this pattern). AI-generated
  defaults are visually badged as "AFS standard default," never
  presented as if extracted from the drawing.
- **Roof panel quantity math**: a fabricated "16\" AFS default" coverage
  width was found live in `lib/data/catalog.ts` (introduced in a PRIOR
  session, not this one, without the user's knowledge or approval) —
  this was silently feeding real quantity calculations. Removed entirely
  and replaced with a drawing-first extraction (use a real width if the
  drawing specifies one) falling back to an interactive user-selected
  width picker (`STANDARD_PANEL_WIDTHS`: 12"/16"/18" common, 20"/24"
  less-common) when the drawing doesn't specify — quantity stays
  null/blank until the user picks, never silently defaulted.
- **3D preview geometry**: `PROFILE_TYPE_TO_CANONICAL_SLUG` was an
  8-entry exact-match dictionary; any AI-extracted informal label
  (e.g. "Outside Corner Trim," "Sill Flashing" from real hand-sketches)
  fell through to a generic 3-bucket shape classifier, making visually
  distinct profiles render identically. Fixed with a `resolveCanonicalSlug()`
  synonym-mapping layer plus dimension-field-based topology inference for
  genuinely unmapped types — verified to correctly diverge on the three
  specific items that surfaced the bug.

---

## Photo-to-Quote AI — confirmed NOT built (do not assume otherwise)

Despite extensive discussion and one Claude Code prompt drafted for it,
**zero implementation exists.** No Photos tab, no upload UI, no API
route — confirmed via `git log`, file search, and direct Claude Code
investigation multiple times this session. A prior test where the user
uploaded a hand-sketch PNG and got a good extraction result went through
the **Blueprint Takeoff** pipeline (which accepts direct-vision file
types like PNG), not a Photo-to-Quote feature — this caused real
confusion earlier in the session and should not be repeated.

Per `SPEC_PHOTO_TO_QUOTE_AI.md`, if/when this gets built: it must NEVER
pre-fill dimension fields from AI analysis (a hard spec requirement,
different from Blueprint Takeoff's AFS-default-prefill pattern — photos
lack a reliable scale reference, so even a labeled default risks being
read as authoritative). It should use the Files API from day one (10
photos × 20MB each can exceed 32MB inline), real enforced size/count
limits, and should incorporate hem detection via the now-shared
`lib/types/profile.ts` types from day one rather than bolted on later.

---

## Security — DO NOT re-raise, permanent standing instruction

Multiple credential exposures happened this session (`.env.local` pasted
in full into chat, `.env.local.backup`/`.env.local.new` accidentally
committed to the git remote). **Reid has explicitly and repeatedly
instructed: do not flag, warn about, or raise exposed/committed API keys
or secrets during development.** All credentials (Stripe, Supabase,
Anthropic, PathfinderEdge, Google Maps, bridge secret, etc.) will be
rotated in one pass immediately before DNS cutover/going live, not
incrementally now. This is saved in persistent memory — do not bring it
up again unless Reid asks directly.

---

## Key learnings & principles (carry forward, hard-won this session)

- **A Claude Code "verified live" or "committed and pushed" claim is not
  sufficient evidence on its own.** This session had at least 2 confirmed
  incidents of real fixes sitting uncommitted or unpushed while the user
  retested against stale production code and reasonably concluded
  nothing had changed — once from a computer restart interrupting a
  session before commit, once from Claude Code's own summary describing
  work that turned out to be sitting in the working tree, uncommitted,
  because the instruction to commit/push was never explicit in the
  prompt. **Every prompt to Claude Code must now explicitly instruct it
  to run `git add -A`, commit, `git push origin main`, and paste the
  actual push output as the final step of its own task** — this is no
  longer something to leave for the user to remember separately.
- **Always independently verify the deployment**, not just trust the
  push succeeded — check `readyState: READY` via Vercel (CLI `vercel ls`
  or the Vercel MCP connector if available) before telling the user to
  test.
- **Descriptive/prose specifications for canvas/SVG geometry, handed to
  a coding agent that has never seen the actual reference image, do not
  converge** — this was proven across at least 4 separate failed
  attempts at the hem glyphs. When visual correctness matters, render
  and visually inspect a reference yourself before writing any
  implementation prompt, and hand off literal, frozen path/coordinate
  data with an explicit "do not reinterpret" instruction — not English
  descriptions of shapes.
- **Spec docs describe design intent, not built reality.** This session
  repeatedly found spec documents describing features (Photo-to-Quote,
  a pdfjs-dist rasterization pipeline, page-limit enforcement) that had
  never actually been implemented in code. Always verify via `git log`,
  direct file reads, or a Claude Code investigation before assuming a
  described feature exists.
- **One Claude Code prompt at a time, always** — Reid has stated this
  as an absolute rule multiple times this session, including after an
  incident where 3 prompts were sent in one message and the wrong one
  got run first. Never stack prompts. Never suggest running multiple
  fixes "in parallel."
- **Reid wants definitive root-cause fixes, never workarounds,
  compromises, or manual bypasses** — this is now a strong, permanent,
  standing instruction covering all domains, not just code (see the
  PathfinderEdge production-emergency exchange this session, where this
  was stated forcefully and saved to persistent memory).
- **A single fabricated/placeholder value silently reaching production**
  (the 16" roof panel default) happened in a PRIOR session without the
  user's knowledge, and was only caught by chance during unrelated work
  this session. Any numeric default, coverage width, or assumption
  introduced anywhere in the takeoff/quoting pipeline must be flagged to
  the user explicitly at the time it's introduced, with its source
  stated plainly — never silently assumed.
- **A "diagnostic only, no fixes" instruction can still result in real,
  valuable, evidence-based findings** (the endpoint-priority conflict on
  the hem-drag gesture, the DPR-canvas discovery, the mid-leg
  fabrication-impossibility finding) — this pattern (diagnose with live
  Playwright testing → report → THEN fix in a separate, later prompt)
  worked well across most of this session's bugs except the hem glyph
  geometry itself, where even repeated diagnosis-then-fix cycles failed
  to converge because the fixes kept being descriptive rather than
  literal.

---

## Working style rules (carry forward exactly, unchanged from prior sessions)

- pnpm only, never npm/yarn
- Claude Code places all files automatically — never ask the user to
  manually create/edit files
- Full file replacement, never surgical edits, in Claude Code runs
- No background tasks — real-time processing output only
- **One prompt/command at a time — never stack multiple in a row (this
  was violated once this session; do not repeat)**
- Every command must include the launch path for the project root
  (`C:\Users\manag\Documents\afs-website`)
- **Every Claude Code prompt must now explicitly instruct it to commit
  and push as its own final step, pasting real push output** (new rule
  this session, see Key Learnings)
- STATE_OF_THE_BUILD.md and SESSION_STATE.md updated after every real
  run — these are the source of truth, not memory, and must reflect
  VERIFIED status, not claimed status
- `pnpm tsc --noEmit` must pass 0 errors before any prompt is complete —
  and must be independently re-run and confirmed by the human, not just
  trusted from a Claude Code summary
- No customer-facing pricing anywhere before a formal AFS-generated quote
- PowerShell: no `&&` as a separator; `-LiteralPath` for paths with
  square brackets; git commands run sequentially, not chained; `curl` in
  PowerShell is an alias for `Invoke-WebRequest` and does not accept
  real curl flags like `-s` — use real `Invoke-WebRequest` syntax or
  avoid the ambiguity entirely

---

## Tools available in this environment

- **Vercel MCP connector**: scoped correctly to `steveharyckis-projects`
  (team ID `team_dfBIZiaZlYIIHoq6UPOJaRJm`, project ID
  `prj_In4blcKRV8BoeaYg9y3nsskdOCpD`). Available tools vary by session —
  sometimes includes `list_deployments`/`get_runtime_logs`/
  `get_runtime_errors`, sometimes only `list_projects`/`get_project`/
  `list_teams`. Check what's actually loaded via `tool_search` before
  assuming a specific tool exists; fall back to the Vercel CLI
  (`vercel ls`, `vercel logs`) when a needed tool isn't available.
- **Supabase MCP connector**: as of last check, scoped to unrelated
  projects (`tarritrix`, `tarritrix-audit`), NOT this project's real
  Supabase backend (`lxfiziwsqezjjybeguqq`). Would need reconnecting
  under the correct scope to be useful for direct database queries —
  otherwise, direct SQL via the Supabase Dashboard SQL Editor (run by
  the user) remains the reliable path, as used successfully this session
  for the migration 014 verification.

## Key contacts

- **Steve Harycki** — AFS owner/president, handles machine operations,
  shop computer `DESKTOP-MB7AMMP`, email `steve@architecturalflashingsupply.com`
- **Trica** — AFS administration, `trica@architecturalflashingsupply.com`
- **Seth Oliver** — Senior Industrial Controls Technician, AMS Controls
  (PathfinderEdge support). Direct: (314) 292-5692. Office:
  (314) 344-3144 x192. Email: `soliver@amscontrols.com`.
- **Ricky** — also at AMS Controls, mentioned as "actively working on
  upgrades for Edge" per Seth's earlier email; unclear if same or
  different escalation path than Seth.
