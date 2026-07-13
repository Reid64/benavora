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
