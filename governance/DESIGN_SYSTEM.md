Project: benavora, Category: Nonprofit Fundraising SaaS, Colors: Background #E4E9F0, Surface #F7F5F1, Surface Raised #FBFAF7, Sidebar #1A2B3C, Primary #0077B6, Secondary/Accent #00B4D8, Accent-Amber #F59E0B, Accent-Violet #6B48CC, Accent-Green #10B981, Accent-Red #EF4444, Text #1E293B, Muted #8B93A5, Border #D9D3C5. Fonts: Plus Jakarta Sans only.

(Corrected 2026-08-15 — this file's prior color values, e.g. Background #C4D0DC / Surface #FFFFFF,
had drifted from the real canonical palette in `src/app/globals.css`'s `:root` custom properties for
some time; the values above are read directly from that file, the actual single source of truth.
`tailwind.config.ts`'s color scales are supposed to reference those same variables — see
`CSS_OVERRIDE_INVESTIGATION_2026-08-15.md` for where that broke down for the legacy `navy`/`teal`
scales and Tailwind's untouched built-in palette, and what was fixed vs. what's still intentionally
guarded by `globals.css`'s `!important` compatibility layer. `FEATURE_REGISTRY_v2.md`'s "The One UI
Rule" section has the current, per-color-family, evidence-based version of that constraint — do not
treat inline-hex-only as a blanket rule without reading that section first.)
