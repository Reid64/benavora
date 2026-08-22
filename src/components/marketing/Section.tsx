import type { ReactNode } from "react";
import { mk, mkFont } from "@/lib/marketing/theme";

type SectionTone = "paper" | "tint" | "surface" | "forest";

const TONE_BACKGROUND: Record<SectionTone, string> = {
  paper: mk.paper,
  tint: mk.tint,
  surface: mk.surface,
  forest: mk.forest,
};

type SectionProps = {
  tone: SectionTone;
  id?: string;
  children: ReactNode;
};

export function Section({ tone, id, children }: SectionProps) {
  return (
    <section
      id={id}
      style={{
        width: "100%",
        background: TONE_BACKGROUND[tone],
      }}
    >
      <div
        className="mk-section-inner"
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "72px 24px",
        }}
      >
        {children}
      </div>
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
