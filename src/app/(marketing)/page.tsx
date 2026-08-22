"use client";

import Link from "next/link";
import { Section, Display1, Display2 } from "@/components/marketing/Section";
import { CtaPrimary, CtaGhost } from "@/components/marketing/Cta";
import { DemoSlot } from "@/components/marketing/PageTemplates";
import { mk, mkRadius } from "@/lib/marketing/theme";
import { PLATFORM, SOLUTIONS } from "@/lib/marketing/nav";

const LIFECYCLE_STEPS = [
  "Organization Intelligence",
  "Opportunity Discovery",
  "Qualification",
  "Funder Research",
  "Application Development",
  "Human Review",
  "Submission",
  "Follow-Up",
  "Award Tracking",
  "Performance Learning",
  "Continuous Optimization",
];

const DOORS: { href: string; title: string; blurb: string; border: string }[] = [
  {
    href: "/platform",
    title: "The Platform",
    blurb: "Six AI systems that discover, qualify, draft and submit funding applications end to end.",
    border: mk.forest,
  },
  {
    href: "/agents",
    title: "The Agents",
    blurb: "Meet the autonomous agents doing the research, writing and monitoring on your behalf.",
    border: mk.sage,
  },
  {
    href: "/demo",
    title: "The Demo",
    blurb: "Watch a full pipeline run on a recorded fixture, from discovery to submission.",
    border: mk.terracotta,
  },
];

export default function Page() {
  return (
    <>
      <Section tone="forest">
        <div
          className="mk-hero-grid"
          style={{
            minHeight: 640,
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 48,
            alignItems: "center",
          }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: mk.sage, letterSpacing: 0.6, marginBottom: 12 }}>
              The autonomous funding acquisition platform for nonprofits
            </div>
            <Display1 tone="forest">Find it. Qualify it. Pursue it. Learn from it.</Display1>
            <p style={{ color: mk.heroMuted, fontSize: 18, marginTop: 20, maxWidth: 560, lineHeight: 1.6 }}>
              One system that discovers funding, qualifies your organization against it, drafts
              the application, submits under your approval, and learns from every outcome.
            </p>
            <div style={{ display: "flex", gap: 16, marginTop: 32, flexWrap: "wrap" }}>
              <CtaPrimary href="/demo">Book a demo</CtaPrimary>
              <CtaGhost href="/platform" onDark>
                See the platform
              </CtaGhost>
            </div>
          </div>
          <div
            style={{
              aspectRatio: "16 / 9",
              background: "rgba(255,255,255,0.06)",
              border: `1px solid ${mk.sage}`,
              borderRadius: mkRadius.shot,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 24,
            }}
          >
            <DemoSlot kind="replay" />
          </div>
        </div>
        <style jsx>{`
          @media (max-width: 900px) {
            .mk-hero-grid {
              grid-template-columns: 1fr !important;
              min-height: 0 !important;
            }
          }
        `}</style>
      </Section>

      <Section tone="paper">
        <Display2>Three doors</Display2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 20,
            marginTop: 28,
          }}
        >
          {DOORS.map((door) => (
            <div
              key={door.href}
              style={{
                background: mk.surface,
                border: `1px solid ${mk.line}`,
                borderTop: `4px solid ${door.border}`,
                borderRadius: mkRadius.card,
                padding: 24,
              }}
            >
              <Display2>{door.title}</Display2>
              <p style={{ color: mk.ink, fontSize: 15, lineHeight: 1.6, marginTop: 12 }}>{door.blurb}</p>
              <Link
                href={door.href}
                style={{ display: "inline-block", marginTop: 16, color: mk.terracotta, fontWeight: 600, fontSize: 14, textDecoration: "none" }}
              >
                Explore
              </Link>
            </div>
          ))}
        </div>
      </Section>

      <Section tone="tint">
        <Display2>The funding lifecycle</Display2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 28 }}>
          {LIFECYCLE_STEPS.map((step, i) => (
            <Link
              key={step}
              href={`/how-it-works#step-${i + 1}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: mk.surface,
                border: `1px solid ${mk.line}`,
                borderRadius: 9999,
                padding: "8px 16px",
                textDecoration: "none",
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  background: mk.forest,
                  color: mk.heroText,
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {i + 1}
              </span>
              <span style={{ color: mk.ink, fontSize: 14, fontWeight: 500 }}>{step}</span>
            </Link>
          ))}
        </div>
      </Section>

      <Section tone="surface">
        <Display2>Platform</Display2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 20,
            marginTop: 28,
          }}
        >
          {PLATFORM.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display: "block",
                background: mk.paper,
                border: `1px solid ${mk.line}`,
                borderRadius: mkRadius.card,
                padding: 22,
                textDecoration: "none",
              }}
            >
              <div style={{ color: mk.forest, fontWeight: 600, fontSize: 17 }}>{item.label}</div>
              {item.blurb ? (
                <div style={{ color: mk.muted, fontSize: 14, marginTop: 8, lineHeight: 1.55 }}>{item.blurb}</div>
              ) : null}
            </Link>
          ))}
        </div>
      </Section>

      <Section tone="paper">
        <Display2>Built for</Display2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 16,
            marginTop: 28,
          }}
        >
          {SOLUTIONS.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display: "block",
                background: mk.surface,
                border: `1px solid ${mk.line}`,
                borderRadius: mkRadius.card,
                padding: "18px 20px",
                color: mk.forest,
                fontWeight: 600,
                fontSize: 15,
                textDecoration: "none",
              }}
            >
              {item.label}
            </Link>
          ))}
        </div>
        <style jsx>{`
          @media (max-width: 900px) {
            div :global(.mk-section-inner) {
              grid-template-columns: 1fr !important;
            }
          }
        `}</style>
      </Section>

      <Section tone="tint">
        <div style={{ textAlign: "center", maxWidth: 760, margin: "0 auto" }}>
          <Display2>
            Software should not merely record fundraising activity. It should actively help
            create it.
          </Display2>
          <Link
            href="/why-benavora"
            style={{ display: "inline-block", marginTop: 24, color: mk.terracotta, fontWeight: 600, fontSize: 15, textDecoration: "none" }}
          >
            Why Benavora
          </Link>
        </div>
      </Section>

      <Section tone="forest">
        <div style={{ textAlign: "center" }}>
          <Display1 tone="forest">Let&apos;s find your next grant.</Display1>
          <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 28, flexWrap: "wrap" }}>
            <CtaPrimary href="/demo">Book a demo</CtaPrimary>
            <CtaGhost href="/resources#ask" onDark>
              Ask Benavora
            </CtaGhost>
          </div>
        </div>
      </Section>
    </>
  );
}
