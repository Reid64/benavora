export const mk = {
  forest: "#1F3A2E",
  sage: "#8FA68E",
  paper: "#F7F5EF",
  surface: "#FFFFFF",
  terracotta: "#B85A2E",
  terracottaHover: "#A9532C",
  ink: "#2B2B28",
  muted: "#6F6F69",
  line: "#DDD8CC",
  tint: "#E8EDE6",
  heroText: "#F7F5EF",
  heroMuted: "#B9C8B8",
  wordmarkGold: "#C49A4F",
} as const;
export type MkColor = keyof typeof mk;
export const mkFont = { display: "var(--mk-display)", body: "var(--mk-body)" } as const;
export const mkRadius = { card: 12, cta: 6, shot: 24 } as const;

// Three-level elevation system: every level layers a soft ambient shadow (large
// blur, low spread, reads as "distance from the page"), a tighter directional
// shadow (small blur, tells the eye where the light comes from), and an inset
// top highlight (simulates a lit top edge on a lifted surface). Replaces flat
// single box-shadows / border-only cards sitewide — see the depth-system pass,
// content/marketing pages and PageTemplates.tsx.
export const mkElevation = {
  1: "0 1px 2px rgba(31,58,46,0.07), 0 6px 14px -6px rgba(31,58,46,0.14), inset 0 1px 0 rgba(255,255,255,0.55)",
  2: "0 2px 5px rgba(31,58,46,0.09), 0 16px 32px -12px rgba(31,58,46,0.20), inset 0 1px 0 rgba(255,255,255,0.5)",
  3: "0 4px 10px rgba(31,58,46,0.13), 0 30px 60px -16px rgba(31,58,46,0.30), inset 0 1px 0 rgba(255,255,255,0.45)",
} as const;
export type MkElevationLevel = keyof typeof mkElevation;

// Same three-level structure (ambient + directional + inset top highlight),
// re-tuned for the site's dark surfaces (forest hero panels, the near-black
// homepage sections, the pricing page's dark-navy cards) where a light-based
// ambient shadow would be invisible and the "lifted" cue instead has to come
// from a brighter inset highlight against the dark fill.
export const mkElevationDark = {
  1: "0 1px 2px rgba(0,0,0,0.35), 0 6px 16px -6px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)",
  2: "0 2px 6px rgba(0,0,0,0.4), 0 16px 32px -10px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.08)",
  3: "0 4px 12px rgba(0,0,0,0.45), 0 30px 60px -14px rgba(0,0,0,0.65), inset 0 1px 0 rgba(255,255,255,0.1)",
} as const;
