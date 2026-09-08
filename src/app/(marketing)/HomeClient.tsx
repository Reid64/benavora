"use client";

import Link from "next/link";
import { Section, Display2 } from "@/components/marketing/Section";
import { CtaPrimary, CtaGhost } from "@/components/marketing/Cta";
import { NeuralFleetVisualization } from "@/components/marketing/NeuralFleetVisualization";
import { HowItWorksLifecycle } from "@/components/marketing/HowItWorksLifecycle";
import { FundraisingToolkit } from "@/components/marketing/FundraisingToolkit";
import { CanISeeIt } from "@/components/marketing/CanISeeIt";
import { DashboardPreview } from "@/components/marketing/DashboardPreview";
import { CanIControlIt } from "@/components/marketing/CanIControlIt";
import { CanITrustIt } from "@/components/marketing/CanITrustIt";
import { DoesItWorkForOrgsLikeMine } from "@/components/marketing/DoesItWorkForOrgsLikeMine";
import { WhatWillItCost } from "@/components/marketing/WhatWillItCost";
import { WhatItReplaces } from "@/components/marketing/WhatItReplaces";
import { ManualVsBenavora } from "@/components/marketing/ManualVsBenavora";
import { WillItUnderstandMyOrg } from "@/components/marketing/WillItUnderstandMyOrg";
import { Logo } from "@/components/layout/Logo";
import { mk, mkElevation, mkRadius } from "@/lib/marketing/theme";
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

const NEXT_STEPS: { href: string; title: string; blurb: string; cta: string }[] = [
  {
    href: "/scan",
    title: "Free funding scan",
    blurb: "Get a personalized read on your organization's funding readiness and likely opportunity categories.",
    cta: "Analyze My Funding Potential",
  },
  {
    href: "/tour",
    title: "Self-guided tour",
    blurb: "Walk through discovery, drafting, and Auto Apply at your own pace, no calendar required.",
    cta: "Take the Tour",
  },
  {
    href: "/demo",
    title: "Tailored demo",
    blurb: "See discovery, drafting, and Auto Apply walked through live with our team, using your own funding priorities.",
    cta: "Book a Demo",
  },
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

export default function HomeClient() {
  return (
    <>
      <div className="bm-brandbar">
        <Link href="/" aria-label="Benavora home" className="bm-brand">
          <Logo size={32} showWordmark />
        </Link>
        <p className="bm-brand-tagline">
          <span>Fund more.</span> <span className="bm-brand-tagline-accent">Do more.</span> <span>Change more.</span>
        </p>
        <style jsx>{`
          .bm-brandbar {
            max-width: 1120px;
            margin: 0 auto;
            padding: 24px 32px 0;
            background: #222624;
          }
          .bm-brand {
            display: inline-flex;
            align-items: center;
            background: #f7f5ef;
            border-radius: 10px;
            padding: 6px 12px;
          }
          .bm-brand-tagline {
            margin: 7px 0 0;
            display: flex;
            gap: 7px;
            align-items: center;
            font-size: 13px;
            line-height: 1.5;
            font-weight: 550;
            letter-spacing: 0.01em;
            color: #a7bc9f;
          }
          .bm-brand-tagline-accent {
            color: #efb344;
          }
          @media (max-width: 640px) {
            .bm-brandbar {
              padding-top: 18px;
            }
            .bm-brand-tagline {
              font-size: 11px;
              gap: 5px;
              margin-top: 6px;
            }
          }
        `}</style>
      </div>

      <header className="bm-hero">
        <p className="bm-eyebrow">Built for the people moving good forward.</p>
        <h1>
          Find the right funders.
          <br />
          <span>Move your mission forward.</span>
        </h1>
        <p className="bm-lede">
          Spend less time searching, rewriting, and filling out forms. Discover aligned funders, shape stronger grant
          narratives, and move applications forward—with more time for the mission.
        </p>
        <a className="bm-link" href="#fundraising-toolkit">
          Explore your fundraising toolkit <span aria-hidden="true">&darr;</span>
        </a>
        <style jsx>{`
          .bm-hero {
            max-width: 1120px;
            margin: 0 auto;
            padding: 76px 32px 32px;
            text-align: center;
            background: #222624;
          }
          .bm-eyebrow {
            font-size: 14px;
            color: #ced5d0;
          }
          .bm-hero h1 {
            font-size: clamp(38px, 4.7vw, 64px);
            font-weight: 550;
            letter-spacing: -0.045em;
            line-height: 1.12;
            margin: 24px auto;
            color: #f0f2ee;
          }
          .bm-hero h1 span {
            color: #f0f2ee;
          }
          .bm-lede {
            color: #bdc4be;
            max-width: 710px;
            font-size: 17px;
            line-height: 1.8;
            margin: 0 auto;
          }
          .bm-link {
            display: inline-flex;
            align-items: center;
            gap: 12px;
            border-radius: 8px;
            padding: 15px 25px;
            margin-top: 28px;
            font-size: 14px;
            font-weight: 600;
            color: #f5f7f2;
            background: #405b49;
            border: 1px solid #77927e;
            box-shadow: 0 4px 14px rgba(0, 0, 0, 0.125);
            text-decoration: none;
            transition: background 0.2s, border-color 0.2s;
          }
          .bm-link:hover {
            background: #4c6a55;
            border-color: #a0b6a5;
            color: #fff;
          }
          .bm-link:focus-visible {
            outline: 2px solid #bacfbd;
            outline-offset: 5px;
          }
          @media (max-width: 640px) {
            .bm-hero {
              padding-top: 42px;
              padding-bottom: 20px;
            }
            .bm-hero h1 {
              font-size: clamp(36px, 7vw, 50px);
            }
            .bm-lede {
              font-size: 16px;
            }
          }
        `}</style>
      </header>

      <section className="bm-autonomy-intro" aria-labelledby="autonomy-title">
        <p className="bm-eyebrow">48 specialized agents. One coordinated system.</p>
        <h2 id="autonomy-title">
          Autonomous intelligence.
          <br />
          Purposeful action.
        </h2>
        <p>
          Benavora brings together 48 specialized AI agents to discover aligned funders, evaluate opportunities, and
          coordinate application workflows—advancing your fundraising within the permissions you set, with human
          review where it matters.
        </p>
        <style jsx>{`
          .bm-autonomy-intro {
            max-width: 1120px;
            margin: 0 auto;
            text-align: center;
            padding: 38px 32px 18px;
            background: #222624;
          }
          .bm-autonomy-intro .bm-eyebrow {
            font-size: 18px;
            font-weight: 600;
            color: #b9cbbd;
          }
          .bm-autonomy-intro h2 {
            font-size: clamp(27px, 3.1vw, 40px);
            line-height: 1.17;
            letter-spacing: -0.03em;
            font-weight: 500;
            color: #f0f2ee;
            margin: 16px 0;
          }
          .bm-autonomy-intro p:last-child {
            color: #bdc4be;
            max-width: 760px;
            margin: 0 auto;
            font-size: 16px;
            line-height: 1.8;
          }
          @media (max-width: 640px) {
            .bm-autonomy-intro {
              padding-top: 28px;
            }
            .bm-autonomy-intro p:last-child {
              font-size: 15px;
            }
          }
        `}</style>
      </section>

      <NeuralFleetVisualization />

      <HowItWorksLifecycle />

      <section className="bm-identity" aria-labelledby="identity-title">
        <p className="bm-eyebrow">What Benavora is</p>
        <h2 id="identity-title">Benavora is the autonomous funding operations platform for nonprofits.</h2>
        <p className="bm-identity-sub">
          Not a tool that hands you AI-written drafts to send on your own. Benavora is a continuously operating,
          governed system for acquiring and managing nonprofit funding&mdash;discovering opportunities, preparing
          applications, and following through, inside the permissions you set and with human review where it
          matters.
        </p>
        <style jsx>{`
          .bm-identity {
            max-width: 1120px;
            margin: 0 auto;
            text-align: center;
            padding: 64px 32px 72px;
            background: #222624;
            border-top: 1px solid #3b403b;
          }
          .bm-identity .bm-eyebrow {
            font-size: 14px;
            font-weight: 600;
            letter-spacing: 0.02em;
            color: #b9cbbd;
          }
          .bm-identity h2 {
            font-size: clamp(28px, 3vw, 38px);
            line-height: 1.25;
            letter-spacing: -0.02em;
            font-weight: 550;
            color: #f0f2ee;
            max-width: 820px;
            margin: 18px auto 0;
          }
          .bm-identity-sub {
            color: #bdc4be;
            max-width: 700px;
            margin: 20px auto 0;
            font-size: 16px;
            line-height: 1.8;
          }
          @media (max-width: 640px) {
            .bm-identity {
              padding: 44px 24px 52px;
            }
            .bm-identity-sub {
              font-size: 15px;
            }
          }
        `}</style>
      </section>

      <section className="bm-outcome" aria-labelledby="outcome-title">
        <p className="bm-eyebrow">What result does it create</p>
        <h2 id="outcome-title">
          More qualified opportunities.
          <br />
          Less manual work getting there.
        </h2>
        <p className="bm-outcome-lede">
          Eligibility scoring and deduplicated discovery mean fewer irrelevant leads reach your desk, so more of
          what lands in the pipeline is worth a staff member&rsquo;s time. Drafting and portal-filling assistance
          remove the repetitive parts of preparing an application, leaving the judgment calls&mdash;and the
          mission&mdash;to your team.
        </p>
        <div className="bm-outcome-grid">
          <article>
            <h3>More that&rsquo;s worth pursuing</h3>
            <p>
              Discovery consolidates federal, foundation, and corporate sources into one feed and removes
              duplicates. Funding Intelligence checks eligibility against each notice before drafting starts, so
              what moves into the pipeline is opportunity your team has already screened, not a raw list to sort
              through by hand.
            </p>
          </article>
          <article>
            <h3>Fewer repetitive steps</h3>
            <p>
              AI Grant Studio drafts from your organization&rsquo;s own knowledge base instead of a blank page, and
              Auto Apply fills portal fields from an approved draft, holding for staff review before anything
              submits. The result is less retyping and more time for the decisions only your team can make.
            </p>
          </article>
        </div>
        <style jsx>{`
          .bm-outcome {
            max-width: 1120px;
            margin: 0 auto;
            text-align: center;
            padding: 64px 32px 20px;
            background: #222624;
            border-top: 1px solid #3b403b;
          }
          .bm-outcome .bm-eyebrow {
            font-size: 14px;
            font-weight: 600;
            letter-spacing: 0.02em;
            color: #b9cbbd;
          }
          .bm-outcome h2 {
            font-size: clamp(28px, 3vw, 38px);
            line-height: 1.25;
            letter-spacing: -0.02em;
            font-weight: 550;
            color: #f0f2ee;
            max-width: 820px;
            margin: 18px auto 0;
          }
          .bm-outcome-lede {
            color: #bdc4be;
            max-width: 700px;
            margin: 20px auto 0;
            font-size: 16px;
            line-height: 1.8;
          }
          .bm-outcome-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 36px;
            max-width: 900px;
            margin: 40px auto 0;
            text-align: left;
          }
          .bm-outcome-grid article {
            border-top: 2px solid #708778;
            padding-top: 22px;
          }
          .bm-outcome-grid h3 {
            font-size: 20px;
            font-weight: 600;
            letter-spacing: -0.01em;
            color: #f2f5ef;
            margin: 0 0 10px;
          }
          .bm-outcome-grid p {
            color: #c7cec8;
            line-height: 1.8;
            font-size: 15px;
          }
          @media (max-width: 640px) {
            .bm-outcome {
              padding: 44px 24px 12px;
            }
            .bm-outcome-lede {
              font-size: 15px;
            }
            .bm-outcome-grid {
              grid-template-columns: 1fr;
              gap: 26px;
            }
          }
        `}</style>
      </section>

      <ManualVsBenavora />

      <WhatItReplaces />

      <WillItUnderstandMyOrg />

      <CanIControlIt />

      <CanITrustIt />

      <DoesItWorkForOrgsLikeMine />

      <CanISeeIt />

      <Section tone="paper" id="try-it">
        <Display2>Try it yourself</Display2>
        <p style={{ color: mk.muted, fontSize: 15, lineHeight: 1.6, marginTop: 12, maxWidth: 640 }}>
          Click around a live, interactive preview of the Opportunities dashboard below — filter by funding source,
          expand a score breakdown, see how a recommendation is built. It runs entirely in your browser on seeded
          sample data.
        </p>
        <div style={{ marginTop: 28 }}>
          <DashboardPreview />
        </div>
      </Section>

      <WhatWillItCost />

      <FundraisingToolkit />

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
                boxShadow: mkElevation[2],
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
                boxShadow: mkElevation[1],
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
                boxShadow: mkElevation[1],
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
          <Display2 tone="forest">What should I do next?</Display2>
          <p style={{ color: mk.heroMuted, fontSize: 17, lineHeight: 1.8, maxWidth: 640, margin: "16px auto 0" }}>
            See what Benavora&rsquo;s network could accomplish for your organization.
          </p>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 20,
            marginTop: 40,
          }}
        >
          {NEXT_STEPS.map((step) => (
            <div
              key={step.href}
              style={{
                background: "rgba(255, 255, 255, 0.06)",
                border: "1px solid rgba(255, 255, 255, 0.14)",
                borderRadius: mkRadius.card,
                boxShadow: "0 1px 0 rgba(255,255,255,0.12) inset, 0 12px 28px -12px rgba(0,0,0,0.45)",
                padding: 24,
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <h3 style={{ color: mk.heroText, fontSize: 18, fontWeight: 600, margin: 0 }}>{step.title}</h3>
              <p style={{ color: mk.heroMuted, fontSize: 14, lineHeight: 1.6, margin: 0, flex: 1 }}>{step.blurb}</p>
              {step.href === "/scan" ? (
                <CtaPrimary href={step.href}>{step.cta}</CtaPrimary>
              ) : (
                <CtaGhost href={step.href} onDark>
                  {step.cta}
                </CtaGhost>
              )}
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}
