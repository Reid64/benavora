"use client";

import Link from "next/link";
import { useState } from "react";

import { PRICING_PLANS } from "@/lib/utils/pricing-plans";

// Same dark brand tokens as the landing page pricing section
// (src/app/(marketing)/MarketingPageClient.tsx) for visual consistency.
const B = {
  bg: "#080C14",
  bgCard: "#0D1424",
  bgRaised: "#111B2E",
  bgHighlight: "#162040",
  blue: "#0EA5E9",
  blueDark: "#1E6FD9",
  blueGlow: "rgba(14,165,233,0.12)",
  purple: "#8B5CF6",
  purpleGlow: "rgba(139,92,246,0.12)",
  green: "#10B981",
  textPrimary: "#F0F6FF",
  textSecond: "#8BA3C0",
  textMuted: "#4E6A8A",
  border: "rgba(14,165,233,0.12)",
  borderFaint: "rgba(255,255,255,0.06)",
};

const sans = "'Inter', -apple-system, BlinkMacSystemFont, sans-serif";
const display = "'Plus Jakarta Sans', 'Inter', sans-serif";

const IconCheck = ({ color = B.blue }: { color?: string }) => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ flexShrink: 0, marginTop: 1 }}>
    <circle cx="9" cy="9" r="9" fill={color} fillOpacity="0.12" />
    <path d="M5.5 9L7.8 11.5L12.5 6.5" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const GradText = ({ children }: { children: React.ReactNode }) => (
  <span
    style={{
      background: `linear-gradient(135deg, ${B.blue} 0%, ${B.purple} 100%)`,
      WebkitBackgroundClip: "text",
      WebkitTextFillColor: "transparent",
      backgroundClip: "text",
    }}
  >
    {children}
  </span>
);

type Card = {
  id: "starter" | "professional" | "enterprise";
  accentColor: string;
  badge: string | null;
  highlight: boolean;
  tagline: string;
  features: string[];
  cta: string;
  href: string;
};

const CARDS: Card[] = [
  {
    id: "starter",
    accentColor: "#06B6D4",
    badge: null,
    highlight: false,
    tagline: "For nonprofits entering competitive funding markets.",
    features: [
      "Grant discovery (SAM.gov, Grants.gov, Foundation search)",
      "Eligibility & probability scoring",
      "AI draft generation (5 drafts/month)",
      "Digital Twin (basic)",
      "AutoApply (5 sessions/month)",
      "Email support",
    ],
    cta: "Start Free Trial",
    href: "/register?plan=starter",
  },
  {
    id: "professional",
    accentColor: B.blue,
    badge: "Most Popular",
    highlight: true,
    tagline: "For development teams managing serious funding pipelines.",
    features: [
      "Everything in Starter, plus:",
      "Unlimited AI drafts",
      "Unlimited AutoApply sessions",
      "Donor Discovery (corporate prospects)",
      "Fundability Intelligence Score",
      "Relationship Intelligence",
      "ROI Optimizer",
      "Priority support",
    ],
    cta: "Start Free Trial",
    href: "/register?plan=professional",
  },
  {
    id: "enterprise",
    accentColor: B.purple,
    badge: null,
    highlight: false,
    tagline: "For large organizations automating funding operations at scale.",
    features: [
      "Everything in Professional, plus:",
      "Fully Autonomous Mode (30 AI agents running nightly)",
      "Strategic Advisor (proactive weekly recommendations)",
      "Digital Twin auto-population",
      "Community Need Prediction",
      "Global Learning Network access",
      "White-glove onboarding (2 hours with team)",
      "Dedicated success manager",
      "SLA guarantee",
    ],
    cta: "Contact Sales",
    href: "mailto:sales@benavora.com",
  },
];

const FAQS: [string, string][] = [
  ["How long does setup take?", "Digital Twin setup takes about 15 minutes. Your first matched opportunities typically appear within 24 hours, once the nightly discovery run completes."],
  ["Do I need technical skills?", "No. Benavora is designed for nonprofit staff, not developers — every workflow is a guided form, not a config file."],
  ["Is my data secure?", "Yes. Every organization's data is isolated with Postgres row-level security and encrypted at rest, following SOC 2-aligned practices."],
  ["Can I cancel anytime?", "Yes. No long-term contracts. Cancel from your billing page anytime and your access continues through the end of the current billing period."],
  ["Does AutoApply work on all portals?", "AutoApply has dedicated adapters for CyberGrants and Benevity, plus AI-driven form analysis for generic corporate giving portals. New named adapters are added as more portals get mapped."],
  ["What's in the Intelligence Library?", "113 real awarded grant narratives spanning major NTEE categories, used to ground your AI-generated drafts in language that has actually won funding."],
];

export default function PricingPageClient() {
  const [annual, setAnnual] = useState(true);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  return (
    <div style={{ backgroundColor: B.bg, color: B.textPrimary, fontFamily: sans }}>
      <style
        // dangerouslySetInnerHTML (not a JSX text child) so the raw CSS string is
        // never routed through React's text-node SSR/CSR diffing — a plain
        // `<style>{`...`}</style>` here would HTML-entity-escape the apostrophe/
        // ampersand in the @import url() server-side but not client-side, causing
        // a hydration text-mismatch and a broken stylesheet URL in strict-mode
        // browsers (reproduced on the homepage's own identical pattern, fixed the
        // same way in HowItWorksClient.tsx).
        dangerouslySetInnerHTML={{
          __html: `
        @import url("https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Inter:wght@400;500;600&display=swap");
        .pp-tc { transition: all 200ms ease; }
        .pp-card-hover { transition: transform 220ms ease, box-shadow 220ms ease, border-color 220ms ease; }
        .pp-card-hover:hover { transform: translateY(-4px); }
        .pp-btn-primary:hover { filter: brightness(1.12); }
        .pp-faq-row:hover { background: ${B.bgRaised} !important; }
      `,
        }}
      />

      {/* Header */}
      <section style={{ maxWidth: 900, margin: "0 auto", padding: "88px 24px 48px", textAlign: "center" }}>
        <h1
          style={{
            fontFamily: display,
            fontSize: "clamp(34px, 5vw, 54px)",
            fontWeight: 800,
            letterSpacing: "-0.02em",
            marginBottom: 18,
          }}
        >
          Simple, <GradText>Transparent Pricing</GradText>
        </h1>
        <p style={{ fontSize: 18, color: B.textSecond, marginBottom: 36 }}>
          Start free. Upgrade when you&apos;re ready.
        </p>

        {/* Toggle */}
        <div
          style={{
            display: "inline-flex",
            backgroundColor: B.bgCard,
            border: `1px solid ${B.borderFaint}`,
            borderRadius: 12,
            padding: 4,
            gap: 4,
          }}
        >
          {([
            ["Monthly", false],
            ["Annual — save 20%", true],
          ] as [string, boolean][]).map(([label, val]) => (
            <button
              key={label}
              className="pp-tc"
              onClick={() => setAnnual(val)}
              style={{
                padding: "9px 22px",
                borderRadius: 9,
                border: "none",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
                background: annual === val ? `linear-gradient(135deg, ${B.blue}, ${B.blueDark})` : "transparent",
                color: annual === val ? "#fff" : B.textSecond,
                boxShadow: annual === val ? "0 0 16px rgba(14,165,233,0.2)" : "none",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {/* Cards */}
      <section style={{ maxWidth: 1220, margin: "0 auto", padding: "0 24px 100px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
          {CARDS.map((card) => {
            const plan = PRICING_PLANS[card.id];
            const hl = card.highlight;
            return (
              <div
                key={card.id}
                className="pp-card-hover"
                style={{
                  borderRadius: 16,
                  padding: "36px 28px",
                  display: "flex",
                  flexDirection: "column",
                  position: "relative",
                  overflow: "hidden",
                  background: hl ? `linear-gradient(160deg, ${B.bgHighlight} 0%, ${B.bgRaised} 100%)` : B.bgCard,
                  border: hl ? `1px solid ${B.border}` : `1px solid ${B.borderFaint}`,
                  boxShadow: hl ? "0 0 60px rgba(14,165,233,0.12), 0 0 100px rgba(139,92,246,0.08)" : "none",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 2,
                    background: hl ? `linear-gradient(90deg, ${B.blue}, ${B.purple})` : `linear-gradient(90deg, ${card.accentColor}, transparent)`,
                  }}
                />

                {card.badge && (
                  <div
                    style={{
                      position: "absolute",
                      top: 16,
                      right: 20,
                      background: `linear-gradient(135deg, ${B.blue}, ${B.purple})`,
                      color: "#fff",
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      padding: "4px 12px",
                      borderRadius: 9999,
                    }}
                  >
                    {card.badge}
                  </div>
                )}

                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    color: card.accentColor,
                    marginBottom: 8,
                  }}
                >
                  {plan.name}
                </div>

                <div style={{ marginBottom: 8, display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                  {annual && (
                    <span style={{ fontSize: 22, fontWeight: 600, color: B.textMuted, textDecoration: "line-through" }}>
                      ${plan.monthly}
                    </span>
                  )}
                  <span style={{ fontFamily: display, fontSize: 50, fontWeight: 800, color: B.textPrimary, letterSpacing: "-0.02em" }}>
                    ${annual ? plan.annual : plan.monthly}
                  </span>
                  <span style={{ fontSize: 14, color: B.textMuted }}>/mo</span>
                </div>

                {annual && (
                  <div style={{ fontSize: 12, color: B.green, fontWeight: 600, marginBottom: 8 }}>
                    Billed annually · ${(plan.annual * 12).toLocaleString()} / yr
                  </div>
                )}

                <p style={{ fontSize: 13.5, lineHeight: 1.55, color: B.textSecond, marginBottom: 28 }}>{card.tagline}</p>

                {card.href.startsWith("mailto:") ? (
                  <a
                    href={card.href}
                    className="pp-tc pp-btn-primary"
                    style={{
                      width: "100%",
                      padding: "13px 0",
                      borderRadius: 9,
                      fontSize: 14,
                      fontWeight: 700,
                      cursor: "pointer",
                      marginBottom: 28,
                      display: "block",
                      textAlign: "center",
                      background: "transparent",
                      color: card.accentColor,
                      border: `1.5px solid ${card.accentColor}40`,
                    }}
                  >
                    {card.cta}
                  </a>
                ) : (
                  <Link
                    href={card.href}
                    className="pp-tc pp-btn-primary"
                    style={{
                      width: "100%",
                      padding: "13px 0",
                      borderRadius: 9,
                      fontSize: 14,
                      fontWeight: 700,
                      cursor: "pointer",
                      marginBottom: 28,
                      display: "block",
                      textAlign: "center",
                      background: hl ? `linear-gradient(135deg, ${B.blue}, ${B.blueDark})` : "transparent",
                      color: hl ? "#fff" : card.accentColor,
                      border: hl ? "none" : `1.5px solid ${card.accentColor}40`,
                      boxShadow: hl ? "0 0 24px rgba(14,165,233,0.25)" : "none",
                    }}
                  >
                    {card.cta}
                  </Link>
                )}

                <div style={{ flex: 1 }}>
                  {card.features.map((text, j) => (
                    <div key={j} style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 11 }}>
                      <IconCheck color={card.accentColor} />
                      <span style={{ fontSize: 13.5, lineHeight: 1.45, color: B.textPrimary }}>{text}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* FAQ */}
      <section style={{ maxWidth: 760, margin: "0 auto", padding: "0 24px 100px" }}>
        <h2
          style={{
            fontFamily: display,
            fontSize: "clamp(28px, 3.5vw, 40px)",
            fontWeight: 800,
            letterSpacing: "-0.02em",
            textAlign: "center",
            marginBottom: 52,
          }}
        >
          Common <GradText>questions</GradText>
        </h2>
        {FAQS.map(([q, a], i) => (
          <div
            key={i}
            className="pp-faq-row pp-tc"
            style={{
              borderBottom: `1px solid ${B.borderFaint}`,
              borderRadius: i === 0 ? "10px 10px 0 0" : i === FAQS.length - 1 ? "0 0 10px 10px" : 0,
            }}
          >
            <button
              onClick={() => setOpenFaq(openFaq === i ? null : i)}
              style={{
                width: "100%",
                padding: "20px 16px",
                backgroundColor: "transparent",
                border: "none",
                color: B.textPrimary,
                fontSize: 16,
                fontWeight: 500,
                textAlign: "left",
                cursor: "pointer",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontFamily: sans,
              }}
            >
              <span>{q}</span>
              <span
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  backgroundColor: openFaq === i ? B.blueGlow : "transparent",
                  border: `1px solid ${openFaq === i ? B.border : B.borderFaint}`,
                  color: openFaq === i ? B.blue : B.textMuted,
                  fontSize: 20,
                  fontWeight: 300,
                  flexShrink: 0,
                  marginLeft: 16,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transform: openFaq === i ? "rotate(45deg)" : "none",
                  transition: "transform 200ms ease, background 200ms ease",
                }}
              >
                +
              </span>
            </button>
            {openFaq === i && (
              <div style={{ padding: "0 16px 20px", fontSize: 15, color: B.textSecond, lineHeight: 1.72 }}>{a}</div>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
