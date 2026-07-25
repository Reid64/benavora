"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";

export type FlipCardData = {
  key: string;
  icon: string;
  label: string;
  value: string;
  sub: string;
  frontGradient: string;
  borderColor: string;
  accentGradient: string;
  href: string;
  ctaLabel: string;
  back: ReactNode;
};

export function FlipCards({ cards }: { cards: FlipCardData[] }) {
  const [flipped, setFlipped] = useState<Record<string, boolean>>({});

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: "12px", marginBottom: "20px" }}>
      {cards.map((card) => {
        const isFlipped = flipped[card.key] ?? false;
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
                  padding: "14px",
                  backfaceVisibility: "hidden",
                  WebkitBackfaceVisibility: "hidden",
                  display: "flex",
                  flexDirection: "column",
                  background: card.frontGradient,
                  border: `1px solid ${card.borderColor}`,
                }}
              >
                <div style={{ height: "2px", background: card.accentGradient, borderRadius: "1px", marginBottom: "10px" }} />
                <div style={{ fontSize: "20px", marginBottom: "2px" }}>{card.icon}</div>
                <div style={{ fontSize: "10px", fontWeight: 700, color: "#FFFFFF", letterSpacing: "0.06em" }}>
                  {card.label}
                </div>
                <div style={{ fontSize: "26px", fontWeight: 800, color: "#FFFFFF", marginTop: "4px", lineHeight: 1 }}>
                  {card.value}
                </div>
                <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.75)", marginTop: "auto" }}>{card.sub}</div>
              </div>

              {/* Back */}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: "12px",
                  padding: "14px",
                  backfaceVisibility: "hidden",
                  WebkitBackfaceVisibility: "hidden",
                  display: "flex",
                  flexDirection: "column",
                  background: card.frontGradient,
                  border: `1px solid ${card.borderColor}`,
                  transform: "rotateY(180deg)",
                  overflow: "hidden",
                }}
              >
                <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>{card.back}</div>
                <Link
                  href={card.href}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    color: "#FFFFFF",
                    textDecoration: "none",
                    marginTop: "8px",
                    flexShrink: 0,
                  }}
                >
                  {card.ctaLabel}
                </Link>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
