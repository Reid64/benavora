# Benavora Page Treatment Protocol v2 — the proven system
## Every per-page prompt in queues 70-73 reads this in full before touching anything.
## This replaces PAGE_TREATMENT_PROTOCOL.md's earlier blue-based system entirely.
## Reference implementation, held to the same bar every page below must meet:
## /draft-generator, commits through 585ed4f.

---

## The confirmed, permanent foundation

- **Background:** Soft Stone `#D8D3C8`, site-wide, already set via the shared layout shell.
  Do not touch it per-page — it is already correct globally.
- **Header/title text on Soft Stone:** Deep Navy `#101B2D`. Never white, never near-white.
- **Scrollbar:** already fixed globally (bronze `#A4712C` thumb, wider track). Do not touch.

## The layering technique — mandatory on every card/panel/grouped section

Any card, panel, or grouped content block gets a colored FRAME (that page's section-assigned
dominant color, see mapping below) with lighter content — Warm Ivory `#F8F5EE` — sitting
inside it, plus a real `box-shadow` so the inner content visibly lifts off the frame. Never
a single flat-colored surface. Never flat white/ivory floating directly on stone with no
frame around it.

## White-value audit — mandatory, before AND after, every page

Before touching a page: grep the page file and every component it imports for `#FFFFFF`,
`#FFF`, `white`, any Tailwind `white` class, or any hex lighter than `#F0F0F0` used as text
or a background/fill. List what you find. After your changes: re-run the identical grep. It
must return zero unintended matches (the only sanctioned exception is Warm Ivory `#F8F5EE`
used as layered card content per the technique above). Report both counts explicitly.

## Buttons

Primary action on a page: that page's section-dominant color, fill, with real checked
WCAG-AA contrast text. If a page has multiple distinct real actions that benefit from their
own identity (the way Draft Generator's Score Draft/Humanize/Rescore/Copy/Download/Download
PDF each got their own color), draw from this proven accent family instead of inventing new
colors: Teal `#2E6B66`, Plum `#7A5980`, Slate Blue `#4F6D8F`, Amber `#C17817`, Rust `#A3492F`,
Olive `#5C6935`. Every button fill/text pairing must be contrast-checked, not assumed.

## What must never change

Real semantic status colors (success green, warning, error/urgency red) stay exactly what
they are — this system governs brand/structural color only, never status meaning. Locked/
paywalled pages keep their lock treatment functional, frame color applies to surrounding
chrome only. Safety-sensitive actions (Impersonate, Clear Stuck Jobs, Danger Zone) must stay
visually distinct from their section's normal treatment, never blended in.

## Section-by-section frame + accent assignment

| Section | Frame | Secondary accent |
|---|---|---|
| Dashboard/Home | Gold `#B88A2E` | Navy `#101B2D` |
| Research & Discovery | Bronze `#A4712C` | Slate Blue `#4F6D8F` |
| Applications & Pipeline | Navy `#101B2D` | Teal `#2E6B66` |
| Draft & Automation | Gold `#B88A2E` | Full accent family (buttons) |
| Intelligence & Reports | Plum `#7A5980` | Slate Blue `#4F6D8F` |
| Outreach & Communication | Rust `#A3492F` | Bronze `#A4712C` |
| Admin/Platform | Navy `#101B2D` | Gold `#B88A2E` |

## Verification standard, every page, no exceptions

1. Real Playwright screenshot before and after.
2. White-value audit counts, before and after, reported explicitly.
3. Real computed-style check (`getComputedStyle`, not source-reading) on at least the frame
   and one button, confirming the actual rendered color matches what was specified.
4. Confirm no real functionality broke — every button, filter, and form still works.
5. Report honestly. If a page's layering doesn't hold up in the actual screenshot, say so —
   do not claim success on a flat result.

## What "done" means for one page

Loads without error. Correct section frame + accent applied via the layering technique with
a real shadow. Zero unintended white/near-white values. Every real interactive element still
works. Real before/after screenshot and computed-style evidence exists.
