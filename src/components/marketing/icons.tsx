import type { CSSProperties } from "react";

// Original, hand-drawn icon set for the marketing site, styled to the
// "Forest and Paper" brand (seed-pod / sprout motifs) instead of reusing
// generic lucide-react glyphs. Each icon inherits color via `currentColor`
// so it drops into existing text/badge styling unchanged.

type MkIconProps = {
  size?: number;
  style?: CSSProperties;
};

/** Seed-pod outline with a dot-and-stem mark, used in place of lucide's Info. */
export function MkInfoIcon({ size = 16, style }: MkIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      style={{ display: "inline-block", flexShrink: 0, ...style }}
      aria-hidden="true"
    >
      <path
        d="M8 1.3 L14.1 5.15 V10.85 L8 14.7 L1.9 10.85 V5.15 Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="5.7" r="1" fill="currentColor" />
      <path d="M8 8.1 V11.3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Sprouting-curve disclosure indicator, used in place of lucide's
 * ChevronUp/ChevronDown. `direction="up"` rotates the same mark 180deg
 * rather than swapping to a mirrored glyph, matching how the two lucide
 * icons were used interchangeably at the call site.
 */
export function MkDisclosureIcon({
  direction = "down",
  size = 14,
  style,
}: MkIconProps & { direction?: "up" | "down" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      style={{
        display: "inline-block",
        flexShrink: 0,
        transform: direction === "up" ? "rotate(180deg)" : undefined,
        transition: "transform 150ms ease",
        ...style,
      }}
      aria-hidden="true"
    >
      <path
        d="M2.6 4.6c1.15 2.3 2.5 3.9 4.4 3.9s3.25-1.6 4.4-3.9"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="7" cy="10.6" r="1" fill="currentColor" />
    </svg>
  );
}
