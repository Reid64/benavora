# Page Treatment Protocol — read this in full before touching any page

Every per-page prompt in queues 66-69 references this document. It is the single source of
truth for how every page gets treated. Do not improvise outside it.

## Approved colors (from the real Benavora logo — do not use anything else)
- Deep blue `#1D4ED8` — Dashboard section, Admin/Platform section
- Sky blue `#0284C7` — Research & Discovery section
- Mid blue `#2563EB` — Draft & Automation section
- Teal-blue `#0E7490` — Applications & Pipeline section
- Violet `#7C3AED` — Intelligence & Reports section
- Blue-violet `#4C51C6` — Outreach & Communication section
- Bright teal `#22D3EE` — FIXED, reserved for primary action buttons only, regardless of section

## Mandatory steps for every page, in order

1. **Load-check first.** Visit the real page with a real authenticated session. If it errors
   or shows a "Could not load..." message, that is a real bug — diagnose the actual root
   cause (check the API route, check the query, check RLS) and fix it BEFORE any styling
   work. Do not style a broken page and call it done.

2. **Recolor the page's DOMINANT VISUAL SURFACE, not just a header or side rail.**
   This is the single most important rule in this document — confirmed by real, direct
   testing on 2026-08-16 that a header/border/sidebar-only treatment reads as "a few accents"
   and does NOT register as a redesign, while recoloring the majority of the visible content
   area does.

   Concretely: identify the actual root container or dominant content panel that occupies
   most of the page's visible area (often the page's own root div, or its main content card
   if the layout has a distinct wrapping panel). Change ITS background from white/neutral
   gray to a light tint derived from the section's accent hex (roughly 5-15% strength — e.g.
   `#0284C7` sky blue becomes a light tint like `#E0F2FE`; `#7C3AED` violet becomes something
   like `#F3E8FF`; derive each section's tint the same way, verify real text contrast after).
   This must cover edge-to-edge, not a strip or a border.

   Individual cards/tiles/rows WITHIN that dominant surface should stay white or near-white
   so they read as distinct, poppable, clickable elements floating above the tinted surface
   — do not tint every nested element, only the dominant background layer.

   Additionally, apply the full-strength section accent (not the light tint) to: the page's
   own header/title bar, primary stat/metric numbers, and section-relevant icon accents, and
   any sticky side rail/wizard panel the page has (as a solid fill, per the original
   /draft-generator test). These are ADDITIONAL to the dominant-surface tint, not a
   substitute for it.

   Do NOT touch:
   - The shared sidebar/header shell (already deep blue, handled globally, not per-page).
   - Nav item text (already enforced solid white, handled globally).
   - Real semantic status colors — green/amber/red for success/warning/error/urgency must
     stay their real meaning. Never repaint a status badge with the section accent.

3. **Empty states get real polish, not placeholder gray text.** If a page currently shows
   "No X yet" with plain text: give it a real icon (not a generic broken-image icon), a clear
   one-line headline, one supporting sentence explaining what will appear here, and — where
   the page has a real action that would populate it (Run Analysis, Add Entity, Discover
   Prospects, etc.) — a clear primary CTA button styled in the fixed teal `#22D3EE`. Do NOT
   fabricate fake data to make a page look populated. An honest, well-designed empty state is
   the correct outcome for a page with no real data yet.

4. **Locked/paywalled pages** (e.g. Competitor Intelligence's "Enterprise and Consultant
   plans only" gate): keep the lock treatment intact and functional. Apply the section accent
   to the surrounding chrome only, never to the paywall message itself.

5. **Never break real functionality.** Every button, form, filter, and data table that
   currently works must still work exactly the same after this pass. This is a visual pass,
   not a refactor.

6. **Real verification, every page, no exceptions.** Playwright screenshot before your change
   and after. Confirm: the section accent is genuinely visible, no layout broke, no console
   errors appeared, real data (where it exists) still renders correctly, and any empty state
   now looks intentional rather than broken. Do not report a page complete without this.

## What "done" means for one page
The page loads without error, carries its correct section accent on header/stats only, has a
genuinely polished empty state if it needs one, every real interactive element still works,
and you have real before/after screenshot evidence.
