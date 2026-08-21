"use client";

import Image from "next/image";
import { useState, useEffect, useRef } from "react";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";

// Proper Next.js font loading (build-time self-hosted, not a runtime
// fonts.googleapis.com request) instead of the inline @import this used to
// carry inside the raw <style> block below. That @import's single-quoted
// url('...') was a real hydration-mismatch source: React's server renderer
// HTML-entity-escapes apostrophes in a <style> tag's text children
// (' -> &#x27;), but <style> is a browser "raw text" element whose content
// the HTML parser never entity-decodes, so the SSR'd DOM's actual text node
// kept the literal &#x27; while the client's first render produced a real
// apostrophe - a genuine content difference, not a false positive, and
// exactly the "Text content does not match server-rendered HTML" error this
// component threw on every load.
const interFont = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], display: "swap" });
const plusJakartaSansFont = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

// ─── Brand Tokens ─────────────────────────────────────────────────────────────
// Dashboard/Home section treatment — PAGE_TREATMENT_PROTOCOL_V2.md /
// DESIGN_SYSTEM_V2_ASSIGNMENT.md. Frame: Rich Gold, the dominant treatment
// for this page (the site's front door), matching Dashboard's own
// assignment. 2026-08-18: replaced the old blue/purple/teal brand-blue
// token system (`blue` alone was referenced 34 times, by far the most-used
// token) with Gold as the dominant identity; kept the deliberate dark hero
// canvas (a real landing-page convention, not the "flat white card"
// anti-pattern this rollout targets) and Bronze/Navy as secondary accents
// in place of the old teal/purple.
const B = {
  // Canvas
  bg:         "#080C14",   // near-black hero canvas
  bgCard:     "#0D1424",   // card surface
  bgRaised:   "#111B2E",   // elevated card
  bgHighlight:"#1F1708",   // featured/highlighted (gold-tinted dark)
  // Brand gold (dominant)
  blue:       "#D4A94D",   // primary accent — brighter gold for dark-bg contrast
  blueDark:   "#B88A2E",   // Rich Gold
  blueGlow:   "rgba(184,138,46,0.16)",
  // Secondary — Bronze (was purple)
  purple:     "#C99A52",
  purpleGlow: "rgba(164,113,44,0.14)",
  // Tertiary — Slate Blue (was teal)
  teal:       "#7691AF",
  // Utility
  green:      "#10B981",
  amber:      "#F59E0B",
  red:        "#EF4444",
  // Text
  textPrimary:"#F8F5EE",
  textSecond: "#B9AE96",
  textMuted:  "#7C7261",
  // Borders
  border:     "rgba(184,138,46,0.18)",
  borderFaint:"rgba(255,255,255,0.06)",
};

const sans    = `${interFont.style.fontFamily}, -apple-system, BlinkMacSystemFont, sans-serif`;
const display = `${plusJakartaSansFont.style.fontFamily}, ${interFont.style.fontFamily}, sans-serif`;

// ─── Animated Counter ─────────────────────────────────────────────────────────
function Counter({ target, suffix = "", decimals = 0 }: { target: number; suffix?: string; decimals?: number }) {
  const [val, setVal] = useState(0);
  const started = useRef(false);
  const el = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => {
      if (e?.isIntersecting && !started.current) {
        started.current = true;
        const t0 = Date.now();
        const tick = () => {
          const p = Math.min((Date.now() - t0) / 2000, 1);
          const eased = 1 - Math.pow(1 - p, 3);
          setVal(parseFloat((eased * target).toFixed(decimals)));
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }
    }, { threshold: 0.3 });
    if (el.current) obs.observe(el.current);
    return () => obs.disconnect();
  }, [target, decimals]);
  return <span ref={el}>{decimals > 0 ? val.toFixed(decimals) : val.toLocaleString()}{suffix}</span>;
}

// ─── SVG Icons ────────────────────────────────────────────────────────────────
const IconCheck = ({ color = B.blue }: { color?: string } = {}) => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ flexShrink: 0, marginTop: 1 }}>
    <circle cx="9" cy="9" r="9" fill={color} fillOpacity="0.12" />
    <path d="M5.5 9L7.8 11.5L12.5 6.5" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);
const IconLock = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ flexShrink: 0, marginTop: 1 }}>
    <circle cx="9" cy="9" r="9" fill="#fff" fillOpacity="0.04" />
    <rect x="5" y="8" width="8" height="6" rx="1.5" stroke={B.textMuted} strokeWidth="1.5"/>
    <path d="M6.5 8V6.5a2.5 2.5 0 015 0V8" stroke={B.textMuted} strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);
const IconArrow = ({ color = "currentColor" }: { color?: string } = {}) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M3 8h10M9 4l4 4-4 4" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

// ─── Data ─────────────────────────────────────────────────────────────────────
type Tier = {
  name: string;
  monthly: number;
  annual: number;
  annualTotal: number;
  tagline: string;
  seats: string;
  badge: string | null;
  highlight: boolean;
  accentColor: string;
  cta: string;
  ctaNote: string;
  features: [boolean, string][];
};

const TIERS: Tier[] = [
  {
    name: "Starter",
    monthly: 397,
    annual: 317,
    annualTotal: 3804,
    tagline: "For nonprofits entering competitive funding markets.",
    seats: "2 users · 1 organization",
    badge: null,
    highlight: false,
    accentColor: B.teal,
    cta: "Start Free Trial",
    ctaNote: "14 days · No credit card required",
    features: [
      [true,  "Grant opportunity research & discovery"],
      [true,  "AI eligibility scoring (0–100)"],
      [true,  "10 AI-generated grant drafts / month"],
      [true,  "Knowledge Base with proven narratives"],
      [true,  "NOFA document parsing & inline viewer"],
      [true,  "Application pipeline tracking"],
      [true,  "Deadline management & alerts"],
      [true,  "Outcome tracking & recursive learning"],
      [false, "50 AI drafts per month"],
      [false, "AutoApply browser automation"],
      [false, "Multi-tenant client management"],
    ],
  },
  {
    name: "Professional",
    monthly: 897,
    annual: 717,
    annualTotal: 8604,
    tagline: "For development teams managing serious funding pipelines.",
    seats: "5 users · 1 organization",
    badge: "Most Popular",
    highlight: true,
    accentColor: B.blue,
    cta: "Start Free Trial",
    ctaNote: "14 days · No credit card required",
    features: [
      [true,  "Everything in Starter"],
      [true,  "50 AI-generated drafts / month"],
      [true,  "Document assembly engine"],
      [true,  "NOFA parsing with auto-enrichment"],
      [true,  "Budget narrative generator"],
      [true,  "Funder intelligence reports"],
      [true,  "Compliance pre-check"],
      [true,  "Board report generator"],
      [true,  "Priority email support"],
      [false, "AutoApply browser automation"],
      [false, "Multi-tenant client management"],
    ],
  },
  {
    name: "Enterprise",
    monthly: 2497,
    annual: 1997,
    annualTotal: 23964,
    tagline: "For large organizations automating funding operations at scale.",
    seats: "25 users · 1 organization",
    badge: null,
    highlight: false,
    accentColor: B.purple,
    cta: "Contact Sales",
    ctaNote: "Demo call required",
    features: [
      [true,  "Everything in Professional"],
      [true,  "Unlimited AI-generated drafts"],
      [true,  "AutoApply: Manual & Batch modes"],
      [true,  "Playwright browser automation"],
      [true,  "AI form analysis & auto-fill"],
      [true,  "Screenshot capture & confirmation logs"],
      [true,  "1.97M+ nonprofit database (IRS BMF)"],
      [true,  "Three-model consensus validation"],
      [true,  "Custom research agent profiles"],
      [true,  "Dedicated onboarding specialist"],
      [true,  "Priority support with SLA"],
    ],
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

const BILLING_OPTIONS: [string, boolean][] = [["Monthly", false], ["Annual — save 20%", true]];

// ─── Shared component: gradient text ─────────────────────────────────────────
const GradText = ({ children, style = {} }: { children: React.ReactNode; style?: React.CSSProperties }) => (
  <span style={{
    background: `linear-gradient(135deg, ${B.blue} 0%, ${B.purple} 100%)`,
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    backgroundClip: "text",
    ...style,
  }}>{children}</span>
);

// ─── Shared: pill badge ───────────────────────────────────────────────────────
const Eyebrow = ({ children }: { children: React.ReactNode }) => (
  <div style={{
    display: "inline-flex", alignItems: "center", gap: 8,
    background: `linear-gradient(135deg, ${B.blueGlow}, ${B.purpleGlow})`,
    border: `1px solid ${B.border}`,
    borderRadius: 9999, padding: "6px 16px", marginBottom: 28,
  }}>
    <div style={{
      width: 6, height: 6, borderRadius: "50%",
      background: `linear-gradient(135deg, ${B.blue}, ${B.purple})`,
    }} />
    <span style={{ fontSize: 13, color: B.blue, fontWeight: 600, letterSpacing: "0.04em" }}>
      {children}
    </span>
  </div>
);

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function BenavoraMarketing() {
  const [annual, setAnnual]   = useState(true);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [_hovered, setHovered] = useState<number | null>(null);

  return (
    <div style={{ backgroundColor: B.bg, color: B.textPrimary, fontFamily: sans, minHeight: "100vh", overflowX: "hidden" }}>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        ::selection { background: ${B.blue}; color: #fff; }
        body { -webkit-font-smoothing: antialiased; }
        a { text-decoration: none; color: inherit; }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(24px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes glow {
          0%, 100% { opacity: 0.5; }
          50%       { opacity: 1; }
        }
        .fu  { animation: fadeUp 0.7s ease both; }
        .fu1 { animation: fadeUp 0.7s 0.12s ease both; }
        .fu2 { animation: fadeUp 0.7s 0.24s ease both; }
        .fu3 { animation: fadeUp 0.7s 0.38s ease both; }
        .tc  { transition: all 200ms ease; }
        .card-hover { transition: transform 220ms ease, box-shadow 220ms ease, border-color 220ms ease; }
        .card-hover:hover { transform: translateY(-4px); }
        .btn-primary:hover  { filter: brightness(1.12); }
        .btn-outline:hover  { background: ${B.blueGlow} !important; }
        .faq-row:hover { background: ${B.bgRaised} !important; }
      `}</style>

      {/* ═══ Ambient background glow ═══ */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, overflow: "hidden" }}>
        <div style={{
          position: "absolute", top: "-20%", left: "50%", transform: "translateX(-50%)",
          width: 900, height: 600,
          background: `radial-gradient(ellipse, rgba(14,165,233,0.08) 0%, transparent 70%)`,
          animation: "glow 6s ease-in-out infinite",
        }} />
        <div style={{
          position: "absolute", top: "30%", right: "-10%",
          width: 600, height: 600,
          background: `radial-gradient(ellipse, rgba(139,92,246,0.06) 0%, transparent 70%)`,
        }} />
      </div>

      <div style={{ position: "relative", zIndex: 1 }}>

        {/* ═══ Nav ═══ */}
        <nav style={{
          position: "sticky", top: 0, zIndex: 200,
          backgroundColor: "rgba(8,12,20,0.85)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          borderBottom: `1px solid ${B.borderFaint}`,
          padding: "0 48px", height: 68,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div />
          <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
            {["Product", "For Consultants", "Pricing"].map(l => (
              <a key={l} href={l === "Pricing" ? "#pricing" : "#"} style={{ fontSize: 14, color: B.textSecond, fontWeight: 500 }}
                className="tc">{l}</a>
            ))}
            <a href="/login" style={{
              fontSize: 14, fontWeight: 600, color: B.textPrimary,
              padding: "8px 20px", borderRadius: 8,
              border: `1px solid ${B.border}`,
            }} className="tc btn-outline">Sign In</a>
            <a href="#pricing" style={{
              fontSize: 14, fontWeight: 600, color: "#fff",
              padding: "8px 20px", borderRadius: 8,
              background: `linear-gradient(135deg, ${B.blue}, ${B.blueDark})`,
              boxShadow: `0 0 20px rgba(14,165,233,0.25)`,
            }} className="tc btn-primary">Get Started</a>
          </div>
        </nav>

        {/* ═══ Hero ═══ */}
        <section style={{ maxWidth: 1000, margin: "0 auto", padding: "120px 48px 100px", textAlign: "center" }}>
          <div className="fu" style={{ display: "flex", justifyContent: "center", marginBottom: 48, paddingLeft: 0 }}>
            <Image
              src="/benavora_logo.png"
              alt="Benavora"
              width={480}
              height={320}
              priority
              style={{ height: 320, width: "auto", objectFit: "contain" }}
            />
          </div>

          <div className="fu">
            <Eyebrow>AI-Powered Nonprofit Funding Platform</Eyebrow>
          </div>

          <h1 className="fu1" style={{
            fontFamily: display, fontSize: "clamp(46px, 6.5vw, 76px)",
            fontWeight: 800, lineHeight: 1.06, letterSpacing: "-0.03em",
            marginBottom: 28,
          }}>
            Your mission deserves<br />
            <GradText>every dollar available to it.</GradText>
          </h1>

          <p className="fu2" style={{
            fontSize: 20, lineHeight: 1.65, color: B.textSecond,
            maxWidth: 580, margin: "0 auto 52px",
          }}>
            Benavora finds the grants you're missing, writes the applications your team doesn't have time for, and submits corporate donation requests — autonomously, overnight, while you sleep.
          </p>

          <div className="fu3" style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap", alignItems: "center" }}>
            <a href="#pricing" className="tc btn-primary" style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              background: `linear-gradient(135deg, ${B.blue}, ${B.blueDark})`,
              color: "#fff", fontSize: 16, fontWeight: 700,
              padding: "15px 32px", borderRadius: 10,
              boxShadow: `0 0 32px rgba(14,165,233,0.3)`,
            }}>
              Start Free Trial <IconArrow color="#fff" />
            </a>
            <a href="#" className="tc" style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              color: B.textSecond, fontSize: 15, fontWeight: 500,
              padding: "15px 20px", borderRadius: 10,
              border: `1px solid ${B.borderFaint}`,
            }}>
              Watch a demo →
            </a>
          </div>

          {/* Trust badges */}
          <div className="fu3" style={{
            display: "flex", gap: 8, justifyContent: "center",
            flexWrap: "wrap", marginTop: 44,
          }}>
            {[
              "14-day free trial",
              "No credit card required",
              "SOC 2 compliant",
              "Data never used for training",
            ].map(b => (
              <div key={b} style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "6px 14px", borderRadius: 9999,
                backgroundColor: B.bgCard, border: `1px solid ${B.borderFaint}`,
                fontSize: 13, color: B.textSecond,
              }}>
                <IconCheck color={B.teal} />
                {b}
              </div>
            ))}
          </div>
        </section>

        {/* ═══ Social Proof ═══ */}
        <section style={{ maxWidth: 1100, margin: "0 auto", padding: "0 48px 90px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
            {[
              { n: 1.97, s: "M+", d: 2, label: "Nonprofits in our IRS BMF database" },
              { n: 113,  s: "",   d: 0, label: "Awarded grant narratives in the Intelligence Library" },
              { n: 30,   s: "",   d: 0, label: "Autonomous AI agents working day and night" },
            ].map((stat, i) => (
              <div key={i} style={{
                textAlign: "center", padding: "30px 20px", borderRadius: 14,
                backgroundColor: B.bgCard, border: `1px solid ${B.borderFaint}`,
              }}>
                <div style={{
                  fontFamily: display, fontSize: 42, fontWeight: 800,
                  color: B.blue, letterSpacing: "-0.02em", marginBottom: 10,
                }}>
                  <Counter target={stat.n} suffix={stat.s} decimals={stat.d} />
                </div>
                <p style={{ fontSize: 14, color: "rgba(255,255,255,0.7)", lineHeight: 1.5 }}>
                  {stat.label}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ═══ Stats — The Problem ═══ */}
        <section style={{
          background: `linear-gradient(180deg, ${B.bg} 0%, ${B.bgCard} 50%, ${B.bg} 100%)`,
          borderTop: `1px solid ${B.borderFaint}`,
          borderBottom: `1px solid ${B.borderFaint}`,
        }}>
          <div style={{ maxWidth: 1200, margin: "0 auto", padding: "80px 48px" }}>
            <p style={{
              textAlign: "center", fontSize: 13, fontWeight: 600,
              letterSpacing: "0.12em", textTransform: "uppercase",
              color: B.textMuted, marginBottom: 56,
            }}>
              The nonprofit funding reality in 2026
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 1, backgroundColor: B.borderFaint }}>
              {[
                { n: 93,  s: "%",  d: 0, label: "of nonprofits say grant writing consumes more staff time than any other function", color: B.blue },
                { n: 40,  s: " hrs", d: 0, label: "average hours spent per grant application — research, draft, compliance, submit", color: B.purple },
                { n: 14,  s: "%",  d: 0, label: "average success rate on unsolicited grant applications filed by US nonprofits", color: B.teal },
                { n: 2.1, s: "M+", d: 1, label: "active US nonprofits competing for the same constrained pool of philanthropic dollars", color: B.amber },
              ].map((stat, i) => (
                <div key={i} style={{
                  backgroundColor: B.bgCard,
                  padding: "44px 36px",
                  position: "relative", overflow: "hidden",
                }}>
                  <div style={{
                    position: "absolute", top: 0, left: 0, right: 0, height: 2,
                    background: `linear-gradient(90deg, ${stat.color}, transparent)`,
                  }} />
                  <div style={{
                    fontFamily: display, fontSize: 52, fontWeight: 800,
                    color: stat.color, lineHeight: 1, marginBottom: 14,
                    letterSpacing: "-0.02em",
                  }}>
                    <Counter target={stat.n} suffix={stat.s} decimals={stat.d} />
                  </div>
                  <p style={{ fontSize: 13.5, lineHeight: 1.65, color: B.textSecond, maxWidth: 200 }}>
                    {stat.label}
                  </p>
                </div>
              ))}
            </div>
            <p style={{
              textAlign: "center", marginTop: 44,
              fontFamily: display, fontSize: 20, fontWeight: 600,
              color: B.textSecond,
            }}>
              The problem isn't your mission.{" "}
              <GradText>It's the infrastructure around it.</GradText>
            </p>
          </div>
        </section>

        {/* ═══ Feature Deep-Dive ═══ */}
        <section style={{ maxWidth: 1280, margin: "0 auto", padding: "100px 48px" }}>
          <div style={{ textAlign: "center", marginBottom: 64 }}>
            <Eyebrow>The Platform</Eyebrow>
            <h2 style={{
              fontFamily: display, fontSize: "clamp(32px, 4vw, 48px)",
              fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.15,
            }}>
              Six AI systems working in parallel —<br />
              <GradText>day and night.</GradText>
            </h2>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
            {[
              {
                n: "01", title: "AI Grant Discovery",
                color: B.teal,
                body: "Scans SAM.gov, Grants.gov, land bank and community land trust authorities, and 1.97M+ nonprofit and foundation records every night — scoring each opportunity against your organization before it reaches your inbox.",
              },
              {
                n: "02", title: "Autonomous Draft Generation",
                color: B.blue,
                body: "A five-phase pipeline — intelligence gathering, narrative strategy, section drafting, compliance check, confidence scoring — draws on 113 awarded grant narratives to write application-ready drafts.",
              },
              {
                n: "03", title: "AutoApply",
                color: B.purple,
                body: "Playwright-powered browser automation fills and submits corporate giving portal forms — CyberGrants, Benevity, and generic portals — with anti-detection browsing and 2Captcha-backed CAPTCHA solving.",
              },
              {
                n: "04", title: "Fundability Intelligence",
                color: B.amber,
                body: "Scores your organization against each opportunity, identifies the specific deficiencies holding your probability down, and auto-fixes what it can — always routed to you for approval first.",
              },
              {
                n: "05", title: "Digital Twin",
                color: B.green,
                body: "A complete organizational intelligence profile — mission, programs, financials, board, proven narratives — that every other agent reads first so nothing it generates is generic.",
              },
              {
                n: "06", title: "Strategic Advisor",
                color: B.red,
                body: "Reads the output of every other agent in the roster and surfaces one prioritized list of proactive recommendations — the things you should be doing that you didn't think to ask about.",
              },
            ].map((item, i) => (
              <div key={i} className="card-hover" style={{
                backgroundColor: B.bgCard,
                borderRadius: 16, padding: "36px 32px",
                border: `1px solid ${B.borderFaint}`,
                position: "relative", overflow: "hidden",
              }}>
                <div style={{
                  position: "absolute", top: 0, left: 0, right: 0, height: 2,
                  background: `linear-gradient(90deg, ${item.color}, transparent)`,
                }} />
                <div style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  width: 36, height: 36, borderRadius: 9,
                  backgroundColor: `${item.color}18`,
                  border: `1px solid ${item.color}30`,
                  fontFamily: display, fontSize: 13, fontWeight: 700, color: item.color,
                  marginBottom: 18,
                }}>{item.n}</div>
                <h3 style={{
                  fontFamily: display, fontSize: 19, fontWeight: 700,
                  color: B.textPrimary, marginBottom: 12, lineHeight: 1.3,
                }}>{item.title}</h3>
                <p style={{ fontSize: 14, lineHeight: 1.65, color: B.textSecond }}>
                  {item.body}
                </p>
              </div>
            ))}
          </div>

          <div style={{ textAlign: "center", marginTop: 40 }}>
            <a href="/how-it-works" className="tc" style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              color: B.blue, fontSize: 15, fontWeight: 600,
            }}>
              See the full pipeline, stage by stage <IconArrow color={B.blue} />
            </a>
          </div>
        </section>

        {/* ═══ How It Works ═══ */}
        <section style={{
          backgroundColor: B.bgCard,
          borderTop: `1px solid ${B.borderFaint}`,
          borderBottom: `1px solid ${B.borderFaint}`,
          padding: "90px 48px",
        }}>
          <div style={{ maxWidth: 1000, margin: "0 auto" }}>
            <div style={{ textAlign: "center", marginBottom: 64 }}>
              <Eyebrow>How It Works</Eyebrow>
              <h2 style={{
                fontFamily: display, fontSize: "clamp(30px, 4vw, 46px)",
                fontWeight: 800, letterSpacing: "-0.02em",
              }}>
                From setup to submission in <GradText>three steps.</GradText>
              </h2>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 24 }}>
              {[
                { n: "1", title: "Complete your Digital Twin", body: "Answer guided questions about your mission, programs, financials, and board. Takes about 5 minutes.", color: B.teal },
                { n: "2", title: "Agents discover & score overnight", body: "Autonomous agents scan every source, score each opportunity against your profile, and queue the strongest matches while you sleep.", color: B.blue },
                { n: "3", title: "Review and submit with one click", body: "Wake up to AI-drafted applications ready for review. Approve, edit, or submit — you're always in control of what goes out.", color: B.purple },
              ].map((step, i) => (
                <div key={i} style={{ textAlign: "center" }}>
                  <div style={{
                    width: 56, height: 56, borderRadius: "50%",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    margin: "0 auto 24px",
                    background: `linear-gradient(135deg, ${step.color}25, ${step.color}10)`,
                    border: `1.5px solid ${step.color}50`,
                    fontFamily: display, fontSize: 22, fontWeight: 800, color: step.color,
                  }}>{step.n}</div>
                  <h3 style={{ fontFamily: display, fontSize: 18, fontWeight: 700, marginBottom: 10, color: B.textPrimary }}>
                    {step.title}
                  </h3>
                  <p style={{ fontSize: 14, lineHeight: 1.65, color: B.textSecond, maxWidth: 280, margin: "0 auto" }}>
                    {step.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ═══ The Math ═══ */}
        <section style={{
          backgroundColor: B.bgCard,
          borderTop: `1px solid ${B.borderFaint}`,
          borderBottom: `1px solid ${B.borderFaint}`,
          padding: "90px 48px",
        }}>
          <div style={{ maxWidth: 1060, margin: "0 auto" }}>
            <div style={{ textAlign: "center", marginBottom: 60 }}>
              <Eyebrow>The Math</Eyebrow>
              <h2 style={{
                fontFamily: display, fontSize: "clamp(30px, 4vw, 46px)",
                fontWeight: 800, letterSpacing: "-0.02em",
              }}>
                One grant award covers <GradText>years of Benavora.</GradText>
              </h2>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 52px 1fr", alignItems: "center", gap: 0 }}>
              {/* Without */}
              <div style={{
                backgroundColor: B.bgRaised, borderRadius: 16, padding: "36px 32px",
                border: `1px solid ${B.borderFaint}`,
              }}>
                <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: B.textMuted, marginBottom: 24 }}>
                  Without Benavora
                </div>
                {[
                  ["Grant writer salary (FTE)", "$62,000 / yr"],
                  ["Benefits & overhead (28%)", "$17,360 / yr"],
                  ["Hours on research alone", "~480 hrs / yr"],
                  ["Applications submitted / year", "12–18"],
                  ["Average win rate", "~14%"],
                  ["Expected awards / year", "2–3"],
                ].map(([l, v], i) => (
                  <div key={i} style={{
                    display: "flex", justifyContent: "space-between",
                    padding: "10px 0", borderBottom: `1px solid ${B.borderFaint}`,
                    fontSize: 14,
                  }}>
                    <span style={{ color: B.textSecond }}>{l}</span>
                    <span style={{ fontWeight: 600, color: B.textPrimary }}>{v}</span>
                  </div>
                ))}
                <div style={{
                  marginTop: 20, paddingTop: 16,
                  borderTop: `2px solid rgba(239,68,68,0.3)`,
                  display: "flex", justifyContent: "space-between", alignItems: "baseline",
                }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>Annual cost</span>
                  <span style={{ fontFamily: display, fontSize: 30, fontWeight: 800, color: B.red }}>$79,360</span>
                </div>
              </div>

              {/* VS */}
              <div style={{ textAlign: "center", fontSize: 14, fontWeight: 600, color: B.textMuted }}>vs.</div>

              {/* With */}
              <div style={{
                borderRadius: 16, padding: "36px 32px",
                background: `linear-gradient(160deg, ${B.bgHighlight} 0%, ${B.bgRaised} 100%)`,
                border: `1px solid ${B.border}`,
                position: "relative", overflow: "hidden",
              }}>
                <div style={{
                  position: "absolute", top: 0, left: 0, right: 0, height: 2,
                  background: `linear-gradient(90deg, ${B.blue}, ${B.purple})`,
                }} />
                <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: B.blue, marginBottom: 24 }}>
                  With Benavora Professional
                </div>
                {[
                  ["Platform subscription", "$897 / mo → $10,764 / yr"],
                  ["Hours on research", "~40 hrs / yr (agent-assisted)"],
                  ["Opportunities monitored", "Continuous · all sources"],
                  ["Applications submitted / year", "60–120+"],
                  ["AutoApply submissions / night", "400+ capable"],
                  ["Expected awards / year", "8–15"],
                ].map(([l, v], i) => (
                  <div key={i} style={{
                    display: "flex", justifyContent: "space-between",
                    padding: "10px 0", borderBottom: `1px solid ${B.borderFaint}`,
                    fontSize: 14,
                  }}>
                    <span style={{ color: B.textSecond }}>{l}</span>
                    <span style={{ fontWeight: 600, color: B.textPrimary }}>{v}</span>
                  </div>
                ))}
                <div style={{
                  marginTop: 20, paddingTop: 16,
                  borderTop: `2px solid ${B.border}`,
                  display: "flex", justifyContent: "space-between", alignItems: "baseline",
                }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>Annual cost</span>
                  <span style={{ fontFamily: display, fontSize: 30, fontWeight: 800, color: B.blue }}>$10,764</span>
                </div>
                <div style={{
                  marginTop: 14, borderRadius: 8, padding: "12px 16px", textAlign: "center",
                  background: `linear-gradient(135deg, ${B.blueGlow}, ${B.purpleGlow})`,
                  border: `1px solid ${B.border}`,
                }}>
                  <span style={{ fontSize: 13, color: B.blue, fontWeight: 600 }}>
                    $68,596 in annual savings. One foundation grant covers 5+ years of the platform.
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ═══ Pricing ═══ */}
        <section id="pricing" style={{ maxWidth: 1220, margin: "0 auto", padding: "100px 48px" }}>
          <div style={{ textAlign: "center", marginBottom: 56 }}>
            <Eyebrow>Pricing</Eyebrow>
            <h2 style={{
              fontFamily: display, fontSize: "clamp(30px, 4vw, 46px)",
              fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 32,
            }}>
              Straightforward. <GradText>No surprises.</GradText>
            </h2>

            {/* Toggle */}
            <div style={{
              display: "inline-flex",
              backgroundColor: B.bgCard,
              border: `1px solid ${B.borderFaint}`,
              borderRadius: 12, padding: 4, gap: 4,
            }}>
              {BILLING_OPTIONS.map(([label, val]) => (
                <button key={label} className="tc" onClick={() => setAnnual(val)} style={{
                  padding: "9px 22px", borderRadius: 9, border: "none",
                  fontSize: 14, fontWeight: 600, cursor: "pointer",
                  background: annual === val
                    ? `linear-gradient(135deg, ${B.blue}, ${B.blueDark})`
                    : "transparent",
                  color: annual === val ? "#fff" : B.textSecond,
                  boxShadow: annual === val ? `0 0 16px rgba(14,165,233,0.2)` : "none",
                }}>{label}</button>
              ))}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
            {TIERS.map((tier, i) => {
              const price = annual ? tier.annual : tier.monthly;
              const hl = tier.highlight;
              return (
                <div key={tier.name} className="card-hover"
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered(null)}
                  style={{
                    borderRadius: 16, padding: "36px 28px",
                    display: "flex", flexDirection: "column",
                    position: "relative", overflow: "hidden",
                    background: hl
                      ? `linear-gradient(160deg, ${B.bgHighlight} 0%, ${B.bgRaised} 100%)`
                      : B.bgCard,
                    border: hl
                      ? `1px solid ${B.border}`
                      : `1px solid ${B.borderFaint}`,
                    boxShadow: hl
                      ? `0 0 60px rgba(14,165,233,0.12), 0 0 100px rgba(139,92,246,0.08)`
                      : "none",
                  }}>
                  {/* Top accent bar */}
                  <div style={{
                    position: "absolute", top: 0, left: 0, right: 0, height: 2,
                    background: hl
                      ? `linear-gradient(90deg, ${B.blue}, ${B.purple})`
                      : `linear-gradient(90deg, ${tier.accentColor}, transparent)`,
                  }} />

                  {tier.badge && (
                    <div style={{
                      position: "absolute", top: 16, right: 20,
                      background: `linear-gradient(135deg, ${B.blue}, ${B.purple})`,
                      color: "#fff", fontSize: 11, fontWeight: 700,
                      letterSpacing: "0.06em", textTransform: "uppercase",
                      padding: "4px 12px", borderRadius: 9999,
                    }}>{tier.badge}</div>
                  )}

                  <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: tier.accentColor, marginBottom: 8 }}>
                    {tier.name}
                  </div>

                  <div style={{ marginBottom: 8 }}>
                    <span style={{ fontFamily: display, fontSize: 50, fontWeight: 800, color: B.textPrimary, letterSpacing: "-0.02em" }}>
                      ${price}
                    </span>
                    <span style={{ fontSize: 14, color: B.textMuted }}> /mo</span>
                  </div>

                  {annual && (
                    <div style={{ fontSize: 12, color: B.green, fontWeight: 600, marginBottom: 8 }}>
                      Billed annually · ${tier.annualTotal.toLocaleString()} / yr
                    </div>
                  )}

                  <p style={{ fontSize: 13.5, lineHeight: 1.55, color: B.textSecond, marginBottom: 14 }}>
                    {tier.tagline}
                  </p>
                  <div style={{ fontSize: 12, color: B.textMuted, marginBottom: 28 }}>
                    {tier.seats}
                  </div>

                  <button className="tc btn-primary" style={{
                    width: "100%", padding: "13px 0", borderRadius: 9,
                    fontSize: 14, fontWeight: 700, cursor: "pointer", marginBottom: 28,
                    background: hl
                      ? `linear-gradient(135deg, ${B.blue}, ${B.blueDark})`
                      : "transparent",
                    color: hl ? "#fff" : tier.accentColor,
                    border: hl ? "none" : `1.5px solid ${tier.accentColor}40`,
                    boxShadow: hl ? `0 0 24px rgba(14,165,233,0.25)` : "none",
                  }}>{tier.cta}</button>

                  <div style={{ flex: 1 }}>
                    {tier.features.map(([yes, text], j) => (
                      <div key={j} style={{
                        display: "flex", alignItems: "flex-start", gap: 10,
                        marginBottom: 11, opacity: yes ? 1 : 0.35,
                      }}>
                        {yes ? <IconCheck color={tier.accentColor} /> : <IconLock />}
                        <span style={{ fontSize: 13.5, lineHeight: 1.45, color: yes ? B.textPrimary : B.textMuted }}>
                          {text}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div style={{ marginTop: 20, fontSize: 12, color: B.textMuted, textAlign: "center" }}>
                    {tier.ctaNote}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Competitor context */}
          <div style={{
            marginTop: 20, padding: "16px 24px", borderRadius: 10,
            backgroundColor: B.bgCard, border: `1px solid ${B.borderFaint}`,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 32,
            flexWrap: "wrap",
          }}>
            <span style={{ fontSize: 13, color: B.textMuted }}>How we compare:</span>
            {[
              ["Instrumentl Full Lifecycle", "$999/mo", "discovery + tracking only, bolt-on AI editing"],
              ["SmartSimple", "$500+/mo", "no AI, complex implementation, high consulting cost"],
              ["Benavora Enterprise", "$2,497/mo", "AutoApply + AI factory + 1.97M database + digital twin"],
            ].map(([name, price, note], i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: i === 2 ? B.blue : B.textSecond }}>{name}</span>
                <span style={{ fontSize: 13, color: i === 2 ? B.blue : B.textMuted }}>{price}</span>
                <span style={{ fontSize: 12, color: B.textMuted }}>· {note}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ═══ Outcomes ═══ */}
        <section style={{
          backgroundColor: B.bgCard,
          borderTop: `1px solid ${B.borderFaint}`,
          borderBottom: `1px solid ${B.borderFaint}`,
          padding: "80px 48px",
        }}>
          <div style={{ maxWidth: 1160, margin: "0 auto" }}>
            <div style={{ textAlign: "center", marginBottom: 48 }}>
              <p style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: B.textMuted, marginBottom: 12 }}>
                Illustrative outcomes
              </p>
              <h2 style={{
                fontFamily: display, fontSize: "clamp(28px, 3.5vw, 40px)",
                fontWeight: 800, letterSpacing: "-0.02em",
              }}>
                Outcomes <GradText>organizations like yours achieve.</GradText>
              </h2>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
              {[
                { stat: "3x", body: "Organizations using AI grant discovery find 3x more matching opportunities than manual search alone.", color: B.teal },
                { stat: "40 → 4 hrs", body: "Automated draft generation reduces average application time from roughly 40 hours to about 4.", color: B.blue },
                { stat: "+28 pts", body: "Nonprofits with a complete Digital Twin score an average of 28 points higher on fundability.", color: B.purple },
              ].map((t, i) => (
                <div key={i} className="card-hover" style={{
                  backgroundColor: B.bgRaised, borderRadius: 14, padding: "32px 28px",
                  border: `1px solid ${B.borderFaint}`,
                  position: "relative", overflow: "hidden",
                }}>
                  <div style={{
                    position: "absolute", top: 0, left: 0, right: 0, height: 2,
                    background: `linear-gradient(90deg, ${t.color}, transparent)`,
                  }} />
                  <div style={{ fontFamily: display, fontSize: 36, fontWeight: 800, color: t.color, lineHeight: 1, marginBottom: 16 }}>
                    {t.stat}
                  </div>
                  <p style={{ fontSize: 14.5, lineHeight: 1.7, color: B.textPrimary }}>{t.body}</p>
                </div>
              ))}
            </div>
            <p style={{ textAlign: "center", marginTop: 32, fontSize: 12.5, color: B.textMuted }}>
              Illustrative projections based on platform capabilities, not guaranteed results for any individual organization.
            </p>
          </div>
        </section>

        {/* ═══ FAQ ═══ */}
        <section style={{ maxWidth: 760, margin: "0 auto", padding: "90px 48px" }}>
          <h2 style={{
            fontFamily: display, fontSize: "clamp(28px, 3.5vw, 40px)",
            fontWeight: 800, letterSpacing: "-0.02em",
            textAlign: "center", marginBottom: 52,
          }}>
            Common <GradText>questions</GradText>
          </h2>
          {FAQS.map(([q, a], i) => (
            <div key={i} className="faq-row tc" style={{
              borderBottom: `1px solid ${B.borderFaint}`,
              borderRadius: i === 0 ? "10px 10px 0 0" : i === FAQS.length - 1 ? "0 0 10px 10px" : 0,
            }}>
              <button onClick={() => setOpenFaq(openFaq === i ? null : i)} style={{
                width: "100%", padding: "20px 16px", backgroundColor: "transparent",
                border: "none", color: B.textPrimary, fontSize: 16, fontWeight: 500,
                textAlign: "left", cursor: "pointer",
                display: "flex", justifyContent: "space-between", alignItems: "center",
                fontFamily: sans,
              }}>
                <span>{q}</span>
                <span style={{
                  width: 28, height: 28, borderRadius: 8,
                  backgroundColor: openFaq === i ? B.blueGlow : "transparent",
                  border: `1px solid ${openFaq === i ? B.border : B.borderFaint}`,
                  color: openFaq === i ? B.blue : B.textMuted,
                  fontSize: 20, fontWeight: 300, flexShrink: 0, marginLeft: 16,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transform: openFaq === i ? "rotate(45deg)" : "none",
                  transition: "transform 200ms ease, background 200ms ease",
                }}>+</span>
              </button>
              {openFaq === i && (
                <div style={{ padding: "0 16px 20px", fontSize: 15, color: B.textSecond, lineHeight: 1.72 }}>
                  {a}
                </div>
              )}
            </div>
          ))}
        </section>

        {/* ═══ Final CTA ═══ */}
        <section style={{
          backgroundColor: B.bgCard,
          borderTop: `1px solid ${B.borderFaint}`,
          padding: "100px 48px",
          textAlign: "center",
          position: "relative", overflow: "hidden",
        }}>
          <div style={{
            position: "absolute", top: "50%", left: "50%",
            transform: "translate(-50%, -50%)",
            width: 800, height: 400,
            background: `radial-gradient(ellipse, rgba(14,165,233,0.07) 0%, rgba(139,92,246,0.05) 50%, transparent 70%)`,
            pointerEvents: "none",
          }} />
          <div style={{ maxWidth: 620, margin: "0 auto", position: "relative" }}>
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              marginBottom: 32, padding: "8px 20px", borderRadius: 9999,
              background: `linear-gradient(135deg, ${B.blueGlow}, ${B.purpleGlow})`,
              border: `1px solid ${B.border}`,
            }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: `linear-gradient(135deg, ${B.blue}, ${B.purple})` }} />
              <span style={{ fontSize: 13, color: B.blue, fontWeight: 600 }}>Start free · No credit card · 5-minute setup</span>
            </div>
            <h2 style={{
              fontFamily: display, fontSize: "clamp(36px, 5vw, 54px)",
              fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.1,
              marginBottom: 20,
            }}>
              Your mission is too important<br />
              <GradText>to leave funding to chance.</GradText>
            </h2>
            <p style={{ fontSize: 18, color: B.textSecond, lineHeight: 1.65, marginBottom: 44 }}>
              Discover your first opportunities in under five minutes. Fourteen days free.
            </p>
            <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap", alignItems: "center" }}>
              <a href="#pricing" className="tc btn-primary" style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                background: `linear-gradient(135deg, ${B.blue}, ${B.blueDark})`,
                color: "#fff", fontSize: 16, fontWeight: 700,
                padding: "16px 36px", borderRadius: 10,
                boxShadow: `0 0 40px rgba(14,165,233,0.3)`,
              }}>
                Start Free Trial <IconArrow color="#fff" />
              </a>
              <a href="#" className="tc" style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                color: B.textSecond, fontSize: 15, fontWeight: 500,
                padding: "16px 20px", borderRadius: 10,
                border: `1px solid ${B.borderFaint}`,
              }}>
                Schedule a demo →
              </a>
            </div>
          </div>
        </section>

        {/* ═══ Footer ═══ */}
        <footer style={{
          backgroundColor: B.bg,
          borderTop: `1px solid ${B.borderFaint}`,
          padding: "28px 48px",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <Image
            src="/benavora_logo.png"
            alt="Benavora"
            width={48}
            height={32}
            style={{ height: 32, width: "auto", objectFit: "contain", opacity: 0.7 }}
          />
          <div style={{ display: "flex", gap: 28, alignItems: "center" }}>
            {["Privacy", "Terms", "Security", "Contact"].map(l => (
              <a key={l} href="#" style={{ fontSize: 13, color: B.textMuted }}>{l}</a>
            ))}
          </div>
          <span style={{ fontSize: 13, color: B.textMuted }}>© 2026 Benavora</span>
        </footer>
      </div>
    </div>
  );
}
