/**
 * Original thin-line root/branch illustration system — Benavora's visual
 * signature for "funding taking root, organizations growing." Two hand-built
 * bezier path sets (not a stock icon-pack asset): `roots` fans downward and
 * outward like a root ball, `branches` fans upward like a canopy. Both are
 * stroke-only, currentColor, and meant to render at low opacity (0.05-0.12)
 * as background texture — never above 0.16, never as a foreground graphic.
 *
 * Usage: absolutely-position this in a `position: relative` container and
 * let it bleed off the edge; see Section.tsx for the sitewide placement.
 */
import type { CSSProperties } from "react";

type MotifVariant = "roots" | "branches" | "corner-roots";

const PATHS: Record<MotifVariant, { viewBox: string; paths: string[]; nodes: [number, number][] }> = {
  roots: {
    viewBox: "0 0 320 320",
    paths: [
      "M160,10 C160,60 160,70 160,100",
      "M160,100 C160,130 120,140 96,168 C78,190 70,210 58,246",
      "M160,100 C160,130 190,142 208,172 C222,196 226,218 232,252",
      "M160,100 C150,124 132,132 108,150 C88,164 66,172 40,180",
      "M160,100 C172,126 190,130 214,144 C238,158 258,164 286,168",
      "M96,168 C86,186 70,192 48,198",
      "M208,172 C220,188 238,192 262,196",
      "M58,246 C48,266 40,280 30,300",
      "M232,252 C244,270 252,284 262,304",
    ],
    nodes: [
      [160, 10],
      [40, 180],
      [286, 168],
      [30, 300],
      [262, 304],
      [48, 198],
      [262, 196],
    ],
  },
  branches: {
    viewBox: "0 0 320 320",
    paths: [
      "M160,310 C160,260 160,250 160,220",
      "M160,220 C160,190 120,180 96,152 C78,130 70,110 58,74",
      "M160,220 C160,190 190,178 208,148 C222,124 226,102 232,68",
      "M160,220 C150,196 132,188 108,170 C88,156 66,148 40,140",
      "M160,220 C172,194 190,190 214,176 C238,162 258,156 286,152",
      "M96,152 C86,134 70,128 48,122",
      "M208,148 C220,132 238,128 262,124",
      "M58,74 C48,54 40,40 30,20",
      "M232,68 C244,50 252,36 262,16",
    ],
    nodes: [
      [160, 310],
      [30, 20],
      [262, 16],
      [40, 140],
      [286, 152],
      [48, 122],
      [262, 124],
    ],
  },
  "corner-roots": {
    viewBox: "0 0 220 220",
    paths: [
      "M0,4 C40,4 46,10 62,24 C80,40 86,58 96,84",
      "M62,24 C74,20 84,20 100,22",
      "M62,24 C58,38 60,48 66,62",
      "M96,84 C112,92 122,96 140,100",
      "M96,84 C96,100 102,110 112,124",
      "M0,54 C30,56 42,64 58,80 C72,94 78,108 84,128",
      "M0,104 C20,108 30,116 42,130",
    ],
    nodes: [
      [96, 84],
      [140, 100],
      [112, 124],
      [84, 128],
    ],
  },
};

export function BotanicalMotif({
  variant,
  color,
  opacity = 0.08,
  style,
  className,
}: {
  variant: MotifVariant;
  color: string;
  opacity?: number;
  style?: CSSProperties;
  className?: string;
}) {
  const spec = PATHS[variant];
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={className}
      viewBox={spec.viewBox}
      style={{
        position: "absolute",
        pointerEvents: "none",
        opacity,
        overflow: "visible",
        ...style,
      }}
    >
      <g fill="none" stroke={color} strokeWidth={1.25} strokeLinecap="round">
        {spec.paths.map((d, i) => (
          <path key={i} d={d} />
        ))}
        {spec.nodes.map(([cx, cy], i) => (
          <circle key={i} cx={cx} cy={cy} r={3} fill={color} stroke="none" />
        ))}
      </g>
    </svg>
  );
}

export default BotanicalMotif;
