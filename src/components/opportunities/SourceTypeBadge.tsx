import { Badge } from "@/components/ui";
import type { BadgeColor } from "@/components/ui";
import { humanizeEnum } from "@/lib/utils/formatters";
import type { OpportunitySourceType } from "@/lib/opportunities/source-type";

/**
 * Color-coded badge for an opportunity's funding source_type (migration 010).
 * Each source gets a distinct hue so the Opportunities list, cards, and detail
 * view read at a glance. Colors are kept in one place here, mirroring
 * OPPORTUNITY_STATUS_COLOR in eligibility.tsx.
 */
export const SOURCE_TYPE_COLOR: Record<OpportunitySourceType, BadgeColor> = {
  government_federal: "blue",
  government_state: "sky",
  government_local: "teal",
  private_foundation: "purple",
  corporate_giving: "orange",
  community_foundation: "green",
  faith_based: "yellow",
  international: "pink",
};

export type SourceTypeBadgeProps = {
  /** The opportunity's source_type, or null when it has not been classified. */
  sourceType: OpportunitySourceType | null;
  /** Render the leading color dot. Defaults to true. */
  withDot?: boolean;
  /**
   * When the source_type is null, render a muted "Unclassified" badge instead
   * of nothing. Off by default so inline placements can omit it cleanly.
   */
  showUnclassified?: boolean;
};

/** Badge for an opportunity's funding source, color-coded per source type. */
export function SourceTypeBadge({
  sourceType,
  withDot = true,
  showUnclassified = false,
}: SourceTypeBadgeProps) {
  if (!sourceType) {
    return showUnclassified ? <Badge color="gray">Unclassified</Badge> : null;
  }
  return (
    <Badge color={SOURCE_TYPE_COLOR[sourceType]} withDot={withDot}>
      {humanizeEnum(sourceType)}
    </Badge>
  );
}
