"use client";

import Image from "next/image";
import { Section, Display1, Display2 } from "@/components/marketing/Section";
import { CtaPrimary, CtaGhost } from "@/components/marketing/Cta";
import { mk, mkRadius } from "@/lib/marketing/theme";

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 13, fontWeight: 600, color: mk.heroMuted, letterSpacing: 0.6, marginBottom: 12 }}>
      {children}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: mk.surface, border: `1px solid ${mk.line}`, borderRadius: mkRadius.card, padding: 20 }}>
      {children}
    </div>
  );
}

const REVENUE_LANES: { label: string; body: string; href: string }[] = [
  { label: "Grants", body: "Government, state, foundation, faith-based, and corporate-foundation sources, discovered, scored, drafted, and submitted through one pipeline.", href: "/solutions/nonprofit-funding-software" },
  { label: "Corporate giving", body: "A shared corporate-giving prospect directory feeds cultivation sequences and, where the funder accepts it, an application submission.", href: "/solutions/corporate-giving-database" },
  { label: "Individual and major donors", body: "Prospect research and relationship-building outreach across email, LinkedIn, phone, and mail, distinct from the grant pipeline entirely.", href: "/solutions/nonprofit-outreach-automation" },
];

const TOGGLE_SUMMARY: { label: string; body: string }[] = [
  { label: "Research and scoring", body: "Can run on a schedule once turned on, since the output is a feed or a ranked list — nothing here reaches a funder or a donor." },
  { label: "Drafting", body: "Can generate unsupervised above a confidence threshold you set (50–95), but the draft still lands in a review queue, not a sent message." },
  { label: "AutoApply and outreach sends", body: "AutoApply requires the request profile a person already configured, plus a real-time risk and readiness check on every item. Non-email outreach channels stop at a drafted task for a person to act on." },
];

const FAQ_ITEMS: { question: string; answer: string }[] = [
  {
    question: "What does \"autonomous\" actually mean here?",
    answer:
      "Nine separate capabilities each have their own on/off setting, defaulting to off: opportunity discovery, probability scoring, draft generation, funder and contact monitoring, relationship building, deadline prediction, follow-up scheduling, AutoApply, and disaster-response outreach. Turning one on lets that specific stage run without a person manually starting it every time. It does not remove the approval gates downstream of it — see the Human-in-the-Loop AI page for exactly what those are.",
  },
  {
    question: "Does it cover donor fundraising, or only grants?",
    answer:
      "Both, as two separate systems that share an organization profile: the grant pipeline (research, scoring, drafting, AutoApply) and donor/corporate-giving outreach (prospect research, cultivation sequences, and multi-channel drafted outreach). They don't force you to treat a grant funder and an individual donor the same way, because they aren't the same thing.",
  },
  {
    question: "Who decides which funders or donors actually get contacted?",
    answer:
      "A staff member configures which funders get a request profile and which prospects enter an outreach sequence — the platform doesn't decide who to contact on its own. Autonomy toggles change how much of the research and preparation work happens without someone manually triggering it, not who ends up on the list.",
  },
  {
    question: "How is this different from the six-stage pipeline described on the Nonprofit Funding Software page?",
    answer:
      "That page walks through the grant-specific pipeline in order, end to end. This page is about the platform's autonomy model across every revenue lane it runs — grants, corporate giving, and individual donors together — and which of those lanes can run unattended today versus which always need a person to start them.",
  },
  {
    question: "Can we turn everything on and check back later?",
    answer:
      "You can, and the nightly caps (a bounded number of AutoApply submissions and auto-generated drafts per night) exist specifically so \"everything on\" doesn't mean unlimited volume. But every autonomy toggle is opt-in per organization, and we'd rather you turn them on gradually as you see what each one produces than flip all nine on day one.",
  },
];

export default function AutonomousFundraisingPlatformClient() {
  return (
    <>
      <Section tone="forest">
        <Eyebrow>Solutions / Autonomous Fundraising Platform</Eyebrow>
        <Display1 tone="forest">Autonomous means nine separate switches, not one.</Display1>
        <p style={{ color: mk.heroMuted, fontSize: 18, marginTop: 16, maxWidth: 700, lineHeight: 1.6 }}>
          A platform that claims to run your fundraising on its own, with no detail about where it stops,
          isn&rsquo;t describing software you can trust with a funder relationship. This runs grant research,
          scoring, drafting, application submission, and donor and corporate-giving outreach as one connected
          system — but every stage that could reach a funder, a donor, or a contact has its own explicit
          autonomy setting, off until an owner or admin turns it on.
        </p>
        <div style={{ display: "flex", gap: 16, marginTop: 28, flexWrap: "wrap" }}>
          <CtaPrimary href="/demo">See the whole system run</CtaPrimary>
          <CtaGhost href="/solutions/human-in-the-loop-ai" onDark>
            See exactly where it stops
          </CtaGhost>
        </div>
      </Section>

      <Section tone="tint">
        <Display2>The actual command center</Display2>
        <p style={{ color: mk.ink, fontSize: 15, marginTop: 12, maxWidth: 680 }}>
          Not a mockup — the live Dashboard for a real organization account, captured from a running instance
          of the application.
        </p>
        <div
          style={{
            marginTop: 24,
            borderRadius: mkRadius.shot,
            overflow: "hidden",
            border: `1px solid ${mk.line}`,
            boxShadow: "0 12px 32px rgba(31,58,46,0.14)",
          }}
        >
          <Image
            src="/marketing/platform-corporate-marketplace-live.png"
            alt="The live platform, showing corporate-giving opportunities alongside the grant pipeline"
            width={1440}
            height={900}
            priority
            style={{ width: "100%", height: "auto", display: "block" }}
          />
        </div>
      </Section>

      <Section tone="paper">
        <Display2>Three revenue lanes, one shared profile</Display2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 20, marginTop: 24 }}>
          {REVENUE_LANES.map((l) => (
            <Card key={l.label}>
              <div style={{ fontSize: 15, fontWeight: 700, color: mk.forest }}>{l.label}</div>
              <div style={{ fontSize: 14, color: mk.ink, marginTop: 8, lineHeight: 1.6 }}>{l.body}</div>
              <a href={l.href} style={{ fontSize: 14, color: mk.terracotta, fontWeight: 600, marginTop: 12, display: "inline-block" }}>
                See this lane →
              </a>
            </Card>
          ))}
        </div>
      </Section>

      <Section tone="surface">
        <Display2>What "autonomous" is allowed to touch at each stage</Display2>
        <div style={{ display: "grid", gap: 16, marginTop: 24, maxWidth: 760 }}>
          {TOGGLE_SUMMARY.map((t) => (
            <Card key={t.label}>
              <div style={{ fontSize: 15, fontWeight: 700, color: mk.forest }}>{t.label}</div>
              <div style={{ fontSize: 14, color: mk.ink, marginTop: 8, lineHeight: 1.6 }}>{t.body}</div>
            </Card>
          ))}
        </div>
        <p style={{ color: mk.ink, fontSize: 15, marginTop: 20, maxWidth: 700 }}>
          The full breakdown of every gate — the exact risk-score threshold, what triggers a CAPTCHA pause,
          and how a draft actually gets approved — lives on the{" "}
          <a href="/solutions/human-in-the-loop-ai" style={{ color: mk.forest, fontWeight: 600 }}>
            Human-in-the-Loop AI
          </a>{" "}
          page, not repeated here.
        </p>
      </Section>

      <Section tone="tint">
        <Display2>Stated limitations</Display2>
        <div style={{ display: "grid", gap: 16, marginTop: 24, maxWidth: 760 }}>
          <Card>
            <p style={{ color: mk.ink, fontSize: 15, lineHeight: 1.7, margin: 0 }}>
              Grant fundraising and donor/corporate-giving outreach share an organization profile but run as
              genuinely separate systems underneath — there isn&rsquo;t one unified activity feed across both
              yet.
            </p>
          </Card>
          <Card>
            <p style={{ color: mk.ink, fontSize: 15, lineHeight: 1.7, margin: 0 }}>
              Turning on every autonomy toggle produces more work for a reviewer, not less work overall — the
              approval queues fill faster, they don&rsquo;t disappear. Nightly caps bound the volume; they
              don&rsquo;t remove the review step.
            </p>
          </Card>
        </div>
      </Section>

      <Section tone="paper">
        <Display2>FAQ</Display2>
        <div style={{ marginTop: 24, display: "grid", gap: 18, maxWidth: 760 }}>
          {FAQ_ITEMS.map((f) => (
            <div key={f.question}>
              <div style={{ fontSize: 16, fontWeight: 600, color: mk.forest }}>{f.question}</div>
              <div style={{ fontSize: 15, color: mk.ink, marginTop: 6, lineHeight: 1.6 }}>{f.answer}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section tone="tint">
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 20,
            background: mk.surface,
            border: `1px solid ${mk.line}`,
            borderRadius: mkRadius.shot,
            padding: 32,
          }}
        >
          <div style={{ maxWidth: 520 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: mk.terracotta, letterSpacing: 0.4 }}>
              FREE, NO ACCOUNT REQUIRED
            </div>
            <div style={{ fontFamily: "var(--mk-display)", fontSize: 24, color: mk.forest, marginTop: 8 }}>
              Not ready to turn any autonomy toggle on yet?
            </div>
            <p style={{ fontSize: 15, color: mk.ink, marginTop: 8 }}>
              Run the free Funding Potential Scan first, a short, no-signup check of the kind of funding your
              organization is likely to qualify for.
            </p>
          </div>
          <CtaPrimary href="/scan">Try the free Funding Potential Scan</CtaPrimary>
        </div>
      </Section>

      <Section tone="forest">
        <div style={{ textAlign: "center" }}>
          <Display2 tone="forest">See how much of it you actually want running on its own</Display2>
          <p style={{ color: mk.heroMuted, fontSize: 17, marginTop: 16, maxWidth: 560, marginLeft: "auto", marginRight: "auto" }}>
            A full walkthrough covers every lane and every autonomy toggle, so you decide what to turn on and
            when.
          </p>
          <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 28, flexWrap: "wrap" }}>
            <CtaPrimary href="/demo">See the whole system run</CtaPrimary>
            <CtaGhost href="/pricing" onDark>
              See pricing
            </CtaGhost>
          </div>
        </div>
      </Section>
    </>
  );
}
