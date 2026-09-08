/**
 * Background grain + organic section-edge system, shared by Section.tsx so
 * every marketing section gets it automatically — no per-page wiring.
 *
 * Grain: an SVG fractal-noise filter (two stacked octaves at different
 * frequencies, tuned specifically for this palette rather than a pulled-in
 * noise texture) rendered as a data URI and blended over the flat tone color
 * with `overlay`, at a low enough opacity that it reads as paper grain, not
 * static. Self-authored parameters (frequency/opacity/blend mode) so this
 * doesn't look like the same three noise textures every template site ships.
 *
 * Divider: each section tone gets its own bottom-edge organic shape (wave /
 * diagonal / arc / overlapping blobs), rendered as a full-bleed SVG that
 * overlaps down into whatever follows. Keying the shape off `tone` — rather
 * than a shared shape everywhere — is what gives "varies between sections":
 * every paper→tint, tint→forest, etc. transition in the whole site reuses one
 * of these four shapes, so no two adjacent tones ever look identical, without
 * needing per-instance props on 25+ pages.
 */

function grainSvg(outAlpha: number): string {
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180">
  <filter id="g">
    <feTurbulence type="fractalNoise" baseFrequency="0.012 0.9" numOctaves="2" seed="7" stitchTiles="stitch" result="fine" />
    <feTurbulence type="fractalNoise" baseFrequency="0.35" numOctaves="1" seed="3" stitchTiles="stitch" result="coarse" />
    <feBlend in="fine" in2="coarse" mode="multiply" result="blended" />
    <feColorMatrix in="blended" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 ${outAlpha} 0" />
  </filter>
  <rect width="100%" height="100%" filter="url(#g)" />
</svg>
`.trim();
}

// Dark (forest) sections can carry a stronger grain since it reads against a
// saturated color; light (paper/tint/surface) sections need a much fainter
// pass so body text contrast never drops.
export const mkGrainDataUriDark = `data:image/svg+xml,${encodeURIComponent(grainSvg(0.55))}`;
export const mkGrainDataUriLight = `data:image/svg+xml,${encodeURIComponent(grainSvg(0.14))}`;

export function mkGrainBackground(toneBg: string, dark: boolean): import("react").CSSProperties {
  return {
    backgroundColor: toneBg,
    backgroundImage: `url("${dark ? mkGrainDataUriDark : mkGrainDataUriLight}")`,
    backgroundBlendMode: dark ? "overlay" : "multiply",
    backgroundSize: "180px 180px",
    backgroundRepeat: "repeat",
  };
}

export type MkDividerVariant = "wave" | "diagonal" | "arc" | "blob";

const DIVIDER_HEIGHT = 56;

const DIVIDER_PATHS: Record<MkDividerVariant, string> = {
  wave:
    "M0,0 L1200,0 L1200,26 C1000,54 900,4 700,30 C520,52 420,6 240,28 C140,40 60,44 0,22 Z",
  diagonal: "M0,0 L1200,0 L1200,44 L0,10 Z",
  arc: "M0,0 L1200,0 L1200,16 Q600,66 0,16 Z",
  blob:
    "M0,0 L1200,0 L1200,18 Q980,58 760,24 Q560,-8 380,26 Q180,52 0,12 Z",
};

export const MK_TONE_DIVIDER: Record<"forest" | "paper" | "tint" | "surface", MkDividerVariant> = {
  forest: "wave",
  paper: "diagonal",
  tint: "arc",
  surface: "blob",
};

export function SectionDividerDef({ variant, fill }: { variant: MkDividerVariant; fill: string }) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: -DIVIDER_HEIGHT + 1,
        height: DIVIDER_HEIGHT,
        zIndex: 2,
        pointerEvents: "none",
        lineHeight: 0,
      }}
    >
      <svg
        viewBox="0 0 1200 56"
        preserveAspectRatio="none"
        width="100%"
        height="100%"
        style={{ display: "block" }}
      >
        <path d={DIVIDER_PATHS[variant]} fill={fill} />
      </svg>
    </div>
  );
}
