# Benavora Design System v2 — Page-by-Page Assignment
## Supersedes PAGE_TREATMENT_PROTOCOL.md's earlier blue/violet system entirely.
## Reference implementation: /draft-generator (commits through c8324cb) — every prompt below
## must produce results that hold up to the same standard, verified the same way.

---

## Universal rules — apply to every page, no exceptions

1. **Background:** Soft Stone `#D8D3C8`, site-wide, permanent. Set once via the shared layout
   shell — do not override per-page.

2. **Text on Soft Stone:** Deep Navy `#101B2D` for headers/titles. Never white, never
   near-white, anywhere on a light background. Body copy: Deep Navy or a dark neutral with
   real, checked contrast — not gray-on-stone that washes out.

3. **The layering technique (mandatory, this is what made Draft Generator work):**
   Any card, panel, or grouped content section gets a colored FRAME (the section's assigned
   dominant color below) with lighter content — Warm Ivory `#F8F5EE` — sitting inside it,
   plus a real box-shadow so the inner content visibly lifts off the frame. Never a single
   flat-colored surface. Never flat white/ivory floating directly on stone with no frame.

4. **White-value audit is mandatory on every page prompt.** Grep for white/near-white
   values before AND after changes. Zero unintended matches required before commit. This is
   not optional — it's the single check that caught every real regression tonight.

5. **Buttons:** primary actions get the section's dominant color (gold-family fill, dark
   text) unless the page has multiple distinct actions that benefit from their own identity
   (see Draft & Automation's 6-button precedent below) — in which case, draw from the proven
   accent family: Teal `#2E6B66`, Plum `#7A5980`, Slate Blue `#4F6D8F`, Amber `#C17817`,
   Rust `#A3492F`, Olive `#5C6935`. All button text must be checked for real WCAG-AA contrast
   against its own fill — not assumed.

6. **Real semantic status colors (success green, warning amber-as-status, error red, urgency
   red) are NEVER touched by any of this.** They stay exactly what they are. This system
   governs brand/structural color only.

---

## Section assignments

### Dashboard/Home
**Frame:** Rich Gold `#B88A2E`. **Secondary accent:** Deep Navy `#101B2D`.
The "home base" — matches Draft Generator's own dominant treatment, since both are central,
first-touch experiences.

### Research & Discovery
*(Research, Opportunities, Donor Discovery + Prospects + Intent Signals, Nonprofit Directory,
Foundations, Funders, Contacts)*
**Frame:** Bronze `#A4712C`. **Secondary accent:** Slate Blue `#4F6D8F`.
Warm, "prospecting" tone for the frame; analytical slate blue for scores/data callouts.

### Applications & Pipeline
*(Applications, Deadlines, Compliance, Documents, Outcomes & Analytics, Financials,
Marketplace)*
**Frame:** Deep Navy `#101B2D`. **Secondary accent:** Teal `#2E6B66`.
Formal, official tone matching compliance/deadline seriousness; teal for status/progress
indicators.

### Draft & Automation
*(Draft Generator — already built, reference standard; AutoApply, Knowledge Base, Alerts,
Activity)*
**Frame:** Rich Gold `#B88A2E`. **Full accent family available for distinct action buttons:**
Teal, Plum, Slate Blue, Amber, Rust, Olive — exactly as proven on Draft Generator's Score
Draft/Humanize/Rescore/Copy/Download/Download PDF buttons. Match that pattern on AutoApply's
and Knowledge Base's own distinct actions.

### Intelligence & Reports
*(Reports + Simulator + ROI Insights + Funding Forecast; Intelligence's 13 sub-pages —
Digital Twin, Match Feed, Knowledge Engine, Recommendations, Gap Analyzer, Competitors,
Semantic Matches, Reputation, Disaster Response, Community Need, Donor Intent, Relationship
Graph, Strategic Advisor)*
**Frame:** Plum `#7A5980`. **Secondary accent:** Slate Blue `#4F6D8F`.
Distinct, contemplative tone for the app's analytical/predictive layer — this is the section
that was most neglected in the earlier blue-based attempt; give it real, deliberate identity.

### Outreach & Communication
*(Email Hub, Campaigns, Templates; Outreach, Outreach/Templates)*
**Frame:** Rust `#A3492F`. **Secondary accent:** Bronze `#A4712C`.
Warm, "reaching out" tone — distinct from Research's bronze-dominant look via the rust-led
frame, while still feeling related.

### Admin/Platform
*(Command Center, Organizations, System Health, Import, Sales Outreach, AutoApply Ops,
Monitor, Improvements, Audit Log, Settings)*
**Frame:** Deep Navy `#101B2D`. **Secondary accent:** Rich Gold `#B88A2E`.
Serious, control-panel tone, navy-dominant like Applications & Pipeline but paired with gold
instead of teal to keep it visually distinct — this is the owner-facing backend, not a daily
user page.

---

## Safety-sensitive elements (unchanged rule from the earlier protocol)
Impersonate (admin/orgs), Clear Stuck Jobs (admin/system), and Danger Zone (settings) must
stay visually distinct from their section's normal color treatment — do not blend them into
the general frame color. These represent real, consequential actions.
