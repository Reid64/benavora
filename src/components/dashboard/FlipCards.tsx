"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";

export type FlipCardData = {
  key: string;
  label: string;
  value: string;
  sub: string;
  frontGradient: string;
  borderColor: string;
  accentGradient: string;
  /** Solid base hex for this card's accent (first stop of accentGradient) —
   * used as the header-band fill and to derive the tinted body background.
   * Every color here must be a literal inline hex/rgba value: this app's
   * globals.css compatibility layer overrides Tailwind color classes and CSS
   * vars with !important, so only inline hex renders correctly. */
  accentHex: string;
  href: string;
  ctaLabel: string;
  back: ReactNode;
};

/** Small bottom-right "Back" control on the flipped face. Flips the card back
 * to its front without navigating — separate hit target from the card's
 * click-through (outer div) and the CTA link, both of which navigate. */
function FlipBackButton({ accentHex, onFlipBack }: { accentHex: string; onFlipBack: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onFlipBack();
      }}
      aria-label="Flip card back to front"
      title="Flip back"
      style={{
        position: "absolute",
        bottom: "8px",
        right: "8px",
        display: "flex",
        alignItems: "center",
        gap: "4px",
        padding: "4px 8px",
        borderRadius: "999px",
        border: "none",
        background: accentHex,
        color: "#FFFFFF",
        fontSize: "10px",
        fontWeight: 700,
        letterSpacing: "0.02em",
        cursor: "pointer",
        boxShadow: "0 2px 6px rgba(16,27,45,0.25)",
        zIndex: 2,
      }}
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 14 4 9l5-5" />
        <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11" />
      </svg>
      Back
    </button>
  );
}

export function FlipCards({ cards }: { cards: FlipCardData[] }) {
  const [flipped, setFlipped] = useState<Record<string, boolean>>({});

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: "12px", marginBottom: "20px" }}>
      {cards.map((card) => {
        const isFlipped = flipped[card.key] ?? false;
        const tintedBody = `${card.accentHex}14`; // 8% alpha over the page background
        return (
          <div
            key={card.key}
            style={{ height: "170px", perspective: "900px", cursor: "pointer" }}
            onClick={() => setFlipped((prev) => ({ ...prev, [card.key]: !prev[card.key] }))}
          >
            <div
              style={{
                position: "relative",
                width: "100%",
                height: "100%",
                transition: "transform 0.6s cubic-bezier(.4,.2,.2,1)",
                transformStyle: "preserve-3d",
                transform: isFlipped ? "rotateY(180deg)" : "rotateY(0deg)",
              }}
            >
              {/* Front */}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: "12px",
                  backfaceVisibility: "hidden",
                  WebkitBackfaceVisibility: "hidden",
                  display: "flex",
                  flexDirection: "column",
                  background: tintedBody,
                  border: `1.5px solid ${card.borderColor}`,
                  boxShadow: "0 4px 14px rgba(16,27,45,0.12)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    background: card.accentGradient,
                    padding: "7px 14px",
                    fontSize: "10px",
                    fontWeight: 700,
                    color: "#FFFFFF",
                    textTransform: "uppercase",
                    letterSpacing: "0.12em",
                    flexShrink: 0,
                  }}
                >
                  {card.label}
                </div>
                <div style={{ padding: "12px 14px 14px", display: "flex", flexDirection: "column", flex: 1 }}>
                  <div style={{ fontSize: "28px", fontWeight: 800, color: "#101B2D", lineHeight: 1 }}>{card.value}</div>
                  <div style={{ fontSize: "11px", color: "#475569", marginTop: "auto" }}>{card.sub}</div>
                </div>
              </div>

              {/* Back */}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: "12px",
                  backfaceVisibility: "hidden",
                  WebkitBackfaceVisibility: "hidden",
                  display: "flex",
                  flexDirection: "column",
                  background: tintedBody,
                  border: `1.5px solid ${card.borderColor}`,
                  boxShadow: "0 4px 14px rgba(16,27,45,0.12)",
                  transform: "rotateY(180deg)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    background: card.accentGradient,
                    padding: "7px 14px",
                    fontSize: "10px",
                    fontWeight: 700,
                    color: "#FFFFFF",
                    textTransform: "uppercase",
                    letterSpacing: "0.12em",
                    flexShrink: 0,
                  }}
                >
                  {card.label}
                </div>
                <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column", minHeight: 0, padding: "10px 14px 14px" }}>
                  <div style={{ flex: 1, overflowY: "auto", minHeight: 0, paddingBottom: "22px" }}>{card.back}</div>
                  <Link
                    href={card.href}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      fontSize: "11px",
                      fontWeight: 700,
                      color: "#101B2D",
                      textDecoration: "none",
                      marginTop: "8px",
                      flexShrink: 0,
                      maxWidth: "calc(100% - 56px)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {card.ctaLabel}
                  </Link>
                  <FlipBackButton
                    accentHex={card.accentHex}
                    onFlipBack={() => setFlipped((prev) => ({ ...prev, [card.key]: false }))}
                  />
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
