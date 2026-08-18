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
                  border: `1.5px solid ${card.borderColor}`,
                  boxShadow: "0 4px 14px rgba(16,27,45,0.12)",
                }}
              >
                <div style={{ height: "3px", background: card.accentGradient, borderRadius: "1px", marginBottom: "10px" }} />
                <div
                  style={{
                    fontSize: "10px",
                    fontWeight: 700,
                    color: "#64748B",
                    textTransform: "uppercase",
                    letterSpacing: "0.12em",
                    marginBottom: "6px",
                  }}
                >
                  {card.label}
                </div>
                <div style={{ fontSize: "28px", fontWeight: 800, color: "#101B2D", lineHeight: 1 }}>{card.value}</div>
                <div style={{ fontSize: "11px", color: "#475569", marginTop: "auto" }}>{card.sub}</div>
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
                  border: `1.5px solid ${card.borderColor}`,
                  boxShadow: "0 4px 14px rgba(16,27,45,0.12)",
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
                    color: "#101B2D",
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
