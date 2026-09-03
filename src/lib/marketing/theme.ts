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
