import { Badge } from "@/components/ui";
import { humanizeEnum } from "@/lib/utils/formatters";
import type { OpportunitySourceType } from "@/lib/opportunities/source-type";

/**
 * Badge for an opportunity's funding source_type (migration 010). Always the
 * "info" variant — source_type is a nominal/descriptive field, not a status,
 * so it doesn't get a semantic color of its own; a per-type hue (the old
 * 8-color scheme) just competed visually with the real status/match badges
 * next to it without carrying extra meaning.
 */
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

/** Badge for an opportunity's funding source. */
export function SourceTypeBadge({
  sourceType,
  withDot = true,
  showUnclassified = false,
}: SourceTypeBadgeProps) {
  if (!sourceType) {
    return showUnclassified ? <Badge variant="neutral">Unclassified</Badge> : null;
  }
  return (
    <Badge variant="info" withDot={withDot}>
      {humanizeEnum(sourceType)}
    </Badge>
  );
}
