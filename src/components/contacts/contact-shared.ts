import type { BadgeColor } from "@/components/ui";
import type { Enums, Tables } from "@/types/database";

type ContactRelationship = Enums<"contact_relationship">;

/** A contact row enriched with its funder's name for display and search. */
export type ContactRow = Tables<"contacts"> & {
  funderName: string;
};

/** Badge colors per relationship stage - shared across list, grid, and detail views. */
export const RELATIONSHIP_COLOR: Record<ContactRelationship, BadgeColor> = {
  cold: "gray",
  warm: "yellow",
  active: "blue",
  champion: "green",
};

/** Up-to-two-letter initials from a contact's full name. */
export function contactInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.charAt(0) ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

/** Premium fintech-toned palette used to color avatar circles by first letter. */
const AVATAR_PALETTE = [
  "#3D6B50",
  "#6B48CC",
  "#0F766E",
  "#B45309",
  "#BE185D",
  "#4C3D8F",
  "#0369A1",
  "#15803D",
  "#9333EA",
  "#C2410C",
  "#0891B2",
  "#DB2777",
  "#4338CA",
  "#059669",
  "#B85C3C",
  "#0EA5E9",
];

/** Deterministic avatar background color keyed on the contact's first-name letter. */
export function avatarColorForName(name: string): string {
  const letter = name.trim().charAt(0).toUpperCase();
  const code = letter ? letter.charCodeAt(0) - 65 : 0;
  const idx = ((code % AVATAR_PALETTE.length) + AVATAR_PALETTE.length) % AVATAR_PALETTE.length;
  return AVATAR_PALETTE[idx]!;
}
