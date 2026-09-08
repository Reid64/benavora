"use client";

import { useEffect, useState } from "react";
import { Section, Display1, Display2 } from "@/components/marketing/Section";
import { CtaPrimary, CtaGhost } from "@/components/marketing/Cta";
import { mk, mkElevation, mkRadius } from "@/lib/marketing/theme";

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 13, fontWeight: 600, color: mk.heroMuted, letterSpacing: 0.6, marginBottom: 12 }}>
      {children}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: mk.surface, border: `1px solid ${mk.line}`, borderRadius: mkRadius.card, boxShadow: mkElevation[1], padding: 20 }}>
      {children}
    </div>
  );
}

// Illustrates one prospect's real dossier lifecycle - not a screen recording;
// the feature has no live screen any organization can reach yet (rollout
// gate defaults off), same disclosure convention as /platform/prospect-intelligence.
const DOSSIER_STAGES = [
  { label: "Name in, identity confirmed", detail: "A single name or a natural-language request goes in. Discovery agents disambiguate exactly who this is before any deeper research spends a token on the wrong person." },
  { label: "Two scores, never blended", detail: "Wealth capacity (what they could plausibly give) and giving propensity (how likely they are to actually give) are calculated separately and shown separately — a high-capacity, low-propensity prospect never gets quietly rounded up into a 'good prospect.'" },
  { label: "The network around them, mapped", detail: "Board seats, corporate ties, foundation affiliations, and professional relationships become a graph with a warm-introduction path and a relationship-strength score attached to each connection, not just a name list." },
  { label: "A contradiction, left visible", detail: "When two sources disagree on a fact, that disagreement is recorded, not silently resolved by picking one. An agent investigates and either resolves it, marks both stale, or leaves it open for a person — never papered over with a single confident number." },
  { label: "A cultivation plan, not just a score", detail: "A recommended first ask and a four-stage cultivation plan — shared ground, warm introduction, deepen engagement, reassess readiness — come out the other end, ready for staff to act on." },
];

function DossierAnimation() {
  const [step, setStep] = useState(0);
  const current = DOSSIER_STAGES[step % DOSSIER_STAGES.length] ?? DOSSIER_STAGES[0]!;

  useEffect(() => {
    const id = setInterval(() => setStep((s) => (s + 1) % DOSSIER_STAGES.length), 3800);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{ background: mk.surface, border: `1px solid ${mk.line}`, borderRadius: mkRadius.shot, boxShadow: mkElevation[2], padding: 32 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: mk.muted, letterSpacing: 0.4 }}>
        ANIMATED SEQUENCE — ONE PROSPECT&rsquo;S DOSSIER, NOT A SCREEN RECORDING
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 20, marginBottom: 24, flexWrap: "wrap" }}>
        {DOSSIER_STAGES.map((s, i) => (
          <div
            key={s.label}
            style={{
              flex: "1 1 60px",
              height: 6,
              borderRadius: 999,
              background: i === step ? mk.terracotta : mk.line,
              transition: "background 400ms ease",
            }}
          />
        ))}
      </div>
      <div style={{ fontFamily: "var(--mk-display)", fontSize: 22, color: mk.forest }}>{current.label}</div>
      <div style={{ fontSize: 15, color: mk.ink, marginTop: 10, lineHeight: 1.6, maxWidth: 640 }}>{current.detail}</div>
    </div>
  );
}

const FAQ_ITEMS: { question: string; answer: string }[] = [
  {
    question: "Can I actually turn this on for my organization today?",
    answer:
      "Not yet for essentially anyone. It's real, working code — its own database schema, orchestrator, and staff dashboard all exist — but access is gated behind a single organization-level rollout flag that defaults off, and the controlled rollout itself (small pilot group, then wider expansion, then general availability) hasn't started. We'd rather tell you that directly than show a screenshot implying your account can use it right now.",
  },
  {
    question: "Why keep wealth capacity and giving propensity as two separate numbers?",
    answer:
      "Because collapsing them into one score hides the exact decision a fundraiser actually has to make. A prospect can plausibly afford a large gift and still be unlikely to make one, or the reverse — a moderate-capacity prospect who gives reliably. Two separate scores let staff decide the right ask and the right approach instead of chasing one blended number that answers neither question well.",
  },
  {
    question: "Does anything in this pipeline contact a donor on its own?",
    answer:
      "No. Every one of the fifty-one registered agents researches, scores, or drafts a recommendation for a person to review — none of them sends an email, places a call, or otherwise reaches a prospect. Approving actual outreach is kept as its own distinct review type, separate from every other kind of check the system runs.",
  },
  {
    question: "What happens when two sources genuinely disagree about a prospect?",
    answer:
      "The disagreement itself becomes part of the record. A dedicated agent investigates and either resolves it in favor of one source, marks both as stale, or leaves it open for a person to decide — whichever of those is actually true is what shows up in the dossier, not a single confident-looking number that quietly picked a side.",
  },
  {
    question: "How is this different from the prospect-research tool that's already live?",
    answer:
      "Nonprofit Prospect Research is available today: a request-based search over local businesses and IRS-registered foundations, scored on seven visible signals. This pipeline is a different scale of thing — a single-prospect, evidence-cited dossier with relationship mapping and a cultivation plan, typically aimed at major individual donors and foundations you've already identified — and it's the one still behind the rollout gate.",
  },
];

export default function DonorProspectingIntelligenceClient() {
  return (
    <>
      <Section tone="forest">
        <Eyebrow>Solutions / Donor Prospecting Intelligence</Eyebrow>
        <Display1 tone="forest">Capacity and propensity are two different questions. This keeps them that way.</Display1>
        <p style={{ color: mk.heroMuted, fontSize: 18, marginTop: 16, maxWidth: 680, lineHeight: 1.6 }}>
          A fifty-one-agent research pipeline builds one evidence-cited dossier per major donor prospect
          &mdash; identity confirmed, wealth capacity and giving propensity scored separately, the
          relationship network around them mapped with warm-introduction paths, and a recommended
          cultivation plan at the end. It&rsquo;s real, working code, and it&rsquo;s currently in a
          controlled rollout, not open to every account.
        </p>
        <div style={{ display: "flex", gap: 16, marginTop: 28, flexWrap: "wrap" }}>
          <CtaPrimary href="/demo">Ask about early access</CtaPrimary>
          <CtaGhost href="#dossier" onDark>
            See how a dossier gets built
          </CtaGhost>
        </div>
      </Section>

      <Section tone="tint">
        <Display2>Where this actually stands today</Display2>
        <div style={{ maxWidth: 720 }}>
          <p style={{ color: mk.ink, fontSize: 16, lineHeight: 1.7 }}>
            This is not a roadmap slide. The orchestrator, the nine-family agent sequence, and a
            staff-facing dashboard all exist and run end to end. What&rsquo;s missing is availability: the
            rollout flag that opens it defaults off per organization, and no organization has been through
            the rollout yet.
          </p>
        </div>
      </Section>

      <Section tone="paper" id="dossier">
        <Display2>How one prospect&rsquo;s dossier actually gets built</Display2>
        <div style={{ marginTop: 24 }}>
          <DossierAnimation />
        </div>
      </Section>

      <Section tone="surface">
        <Display2>What comes out the other end</Display2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20, marginTop: 24 }}>
          <Card>
            <div style={{ fontSize: 13, fontWeight: 700, color: mk.terracotta, letterSpacing: 0.4 }}>
              TWO SEPARATE SCORES
            </div>
            <p style={{ fontSize: 14, color: mk.ink, marginTop: 8, lineHeight: 1.6 }}>
              Wealth capacity and giving propensity, always kept apart &mdash; never averaged into one
              number that answers neither question.
            </p>
          </Card>
          <Card>
            <div style={{ fontSize: 13, fontWeight: 700, color: mk.terracotta, letterSpacing: 0.4 }}>
              A MAPPED NETWORK
            </div>
            <p style={{ fontSize: 14, color: mk.ink, marginTop: 8, lineHeight: 1.6 }}>
              Board, corporate, and foundation ties as a graph with a warm-introduction path and a
              relationship-strength score per connection.
            </p>
          </Card>
          <Card>
            <div style={{ fontSize: 13, fontWeight: 700, color: mk.terracotta, letterSpacing: 0.4 }}>
              A CULTIVATION PLAN
            </div>
            <p style={{ fontSize: 14, color: mk.ink, marginTop: 8, lineHeight: 1.6 }}>
              A recommended first ask plus a four-stage plan &mdash; shared ground, warm introduction,
              deepen engagement, reassess readiness.
            </p>
          </Card>
        </div>
      </Section>

      <Section tone="tint">
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

      <Section tone="paper">
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
            boxShadow: mkElevation[2],
            padding: 32,
          }}
        >
          <div style={{ maxWidth: 520 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: mk.terracotta, letterSpacing: 0.4 }}>
              WANT SOMETHING YOU CAN USE TODAY?
            </div>
            <div style={{ fontFamily: "var(--mk-display)", fontSize: 24, color: mk.forest, marginTop: 8 }}>
              Start with Nonprofit Prospect Research
            </div>
            <p style={{ fontSize: 15, color: mk.ink, marginTop: 8 }}>
              It's live for every account now — request-based, scored on seven visible signals.
            </p>
          </div>
          <CtaGhost href="/solutions/nonprofit-prospect-research">See Nonprofit Prospect Research</CtaGhost>
        </div>
      </Section>

      <Section tone="forest">
        <div style={{ textAlign: "center" }}>
          <Display2 tone="forest">Ask about early access</Display2>
          <p style={{ color: mk.heroMuted, fontSize: 17, marginTop: 16, maxWidth: 560, marginLeft: "auto", marginRight: "auto" }}>
            The controlled rollout hasn&rsquo;t started. Talk to us about a pilot, or start with what&rsquo;s
            live today.
          </p>
          <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 28, flexWrap: "wrap" }}>
            <CtaPrimary href="/demo">Talk to us</CtaPrimary>
            <CtaGhost href="/solutions/nonprofit-prospect-research" onDark>
              See what's live today
            </CtaGhost>
          </div>
        </div>
      </Section>
    </>
  );
}
