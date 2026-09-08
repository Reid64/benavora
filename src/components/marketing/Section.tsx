import type { ReactNode } from "react";
import { mk, mkFont } from "@/lib/marketing/theme";
import { BotanicalMotif } from "@/components/marketing/BotanicalMotif";
import { mkGrainBackground, MK_TONE_DIVIDER, SectionDividerDef } from "@/lib/marketing/texture";

type SectionTone = "paper" | "tint" | "surface" | "forest";

const TONE_BACKGROUND: Record<SectionTone, string> = {
  paper: mk.paper,
  tint: mk.tint,
  surface: mk.surface,
  forest: mk.forest,
};

// Botanical watermark per tone: alternating corners/variants so the motif
// reads as a recurring signature rather than the same sticker pasted on every
// section. Forest (hero) sections get the strongest — still low-opacity —
// pass since they're the site's most repeated section type.
const TONE_MOTIF: Record<
  SectionTone,
  { variant: "roots" | "branches" | "corner-roots"; color: string; opacity: number; style: React.CSSProperties }
> = {
  forest: {
    variant: "roots",
    color: mk.sage,
    opacity: 0.14,
    style: { right: -40, top: -20, width: 280, height: 280 },
  },
  paper: {
    variant: "corner-roots",
    color: mk.forest,
    opacity: 0.07,
    style: { left: 0, top: 0, width: 200, height: 200 },
  },
  tint: {
    variant: "branches",
    color: mk.forest,
    opacity: 0.06,
    style: { right: 0, bottom: -30, width: 240, height: 240 },
  },
  surface: {
    variant: "corner-roots",
    color: mk.sage,
    opacity: 0.08,
    style: { right: 0, top: 0, width: 180, height: 180, transform: "scaleX(-1)" },
  },
};

type SectionProps = {
  tone: SectionTone;
  id?: string;
  children: ReactNode;
  /** Suppress the bottom-edge organic divider (e.g. the page's last section
   * before the footer, when the seam should read as a clean stop instead). */
  divider?: boolean;
};

export function Section({ tone, id, children, divider = true }: SectionProps) {
  const isDark = tone === "forest";
  const motif = TONE_MOTIF[tone];
  return (
    <section
      id={id}
      style={{
        width: "100%",
        position: "relative",
        overflow: "visible",
        fontFamily: mkFont.body,
        ...mkGrainBackground(TONE_BACKGROUND[tone], isDark),
      }}
    >
      <BotanicalMotif
        variant={motif.variant}
        color={motif.color}
        opacity={motif.opacity}
        style={motif.style}
      />
      <div
        className="mk-section-inner"
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "72px 24px",
          position: "relative",
          zIndex: 1,
        }}
      >
        {children}
      </div>
      {divider ? <SectionDividerDef variant={MK_TONE_DIVIDER[tone]} fill={TONE_BACKGROUND[tone]} /> : null}
      <style jsx>{`
        @media (max-width: 900px) {
          .mk-section-inner {
            padding: 48px 24px !important;
          }
        }
      `}</style>
    </section>
  );
}

type DisplayProps = {
  tone?: SectionTone;
  children: ReactNode;
};

export function Display1({ tone, children }: DisplayProps) {
  const color = tone === "forest" ? mk.heroText : mk.forest;
  return (
    <>
      <h1
        className="mk-display1"
        style={{
          fontFamily: mkFont.display,
          color,
          fontSize: 48,
          lineHeight: 1.1,
          margin: 0,
        }}
      >
        {children}
      </h1>
      <style jsx>{`
        @media (max-width: 900px) {
          .mk-display1 {
            font-size: 34px !important;
          }
        }
      `}</style>
    </>
  );
}

export function Display2({ tone, children }: DisplayProps) {
  const color = tone === "forest" ? mk.heroText : mk.forest;
  return (
    <>
      <h2
        className="mk-display2"
        style={{
          fontFamily: mkFont.display,
          color,
          fontSize: 34,
          lineHeight: 1.15,
          margin: 0,
        }}
      >
        {children}
      </h2>
      <style jsx>{`
        @media (max-width: 900px) {
          .mk-display2 {
            font-size: 26px !important;
          }
        }
      `}</style>
    </>
  );
}
