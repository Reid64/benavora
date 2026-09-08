"use client";

import Image from "next/image";
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

const WIZARD_STEPS = [
  { step: "1", label: "Taxonomy", detail: "Pick the cause or business category you're looking for prospects within." },
  { step: "2", label: "Geography", detail: "A radius around an address, a set of states, or a national search." },
  { step: "3", label: "Review & Launch", detail: "Confirm the scope and start the run — it works through enumerating, enriching, and scoring on its own." },
];

const SIGNALS: { label: string; weight: number }[] = [
  { label: "Has an active giving program", weight: 25 },
  { label: "Has a public donation form", weight: 20 },
  { label: "In-kind giving history signals", weight: 15 },
  { label: "Linked to a matching foundation record", weight: 15 },
  { label: "Geographic match to your service area", weight: 10 },
  { label: "Company size fits a plausible ask", weight: 10 },
  { label: "Has a CSR / community page at all", weight: 5 },
];

const FAQ_ITEMS: { question: string; answer: string }[] = [
  {
    question: "What two kinds of prospects does this actually find?",
    answer:
      "Local businesses, found through Google Places within a radius you set, and IRS-registered foundations, found through the federal Business Master File filtered by NTEE cause code across whatever states (or the whole country) you choose. You pick which one a given request is for in the taxonomy step — it isn't one blended, unlabeled list.",
  },
  {
    question: "Is the score a black box?",
    answer:
      "No — it's seven weighted signals, and you can see the weights: an active giving program (25%), a public donation form (20%), in-kind giving history signals (15%), a matched foundation record (15%), geographic fit (10%), company size versus a plausible ask (10%), and simply having a CSR or community page at all (5%). Each score also comes with a two-sentence, plain-English rationale Claude writes from the same evidence, not a templated fill-in.",
  },
  {
    question: "How long does a research request actually take?",
    answer:
      "A request moves through four stages on its own — queued, enumerating, enriching, scoring — and finishes without anyone babysitting it. Runs against a real, moderate-sized geography have completed in about a minute; a much larger national search across a common cause code will naturally take longer simply because there's more to enumerate.",
  },
  {
    question: "Is this the deep 51-agent research pipeline I've heard about?",
    answer:
      "No, and we want to be direct about the difference rather than let the names blur together. This tool is live today for every account, request-based, and built for a focused question: which local businesses or foundations in this area are worth approaching. A separate, much larger research pipeline exists for deep, single-prospect dossiers with relationship mapping and cultivation strategy — it's real, working code, but it's gated behind a controlled rollout that hasn't started yet. See Donor Prospecting Intelligence for that one, and don't expect it on your account today.",
  },
  {
    question: "What happens to a prospect after it's scored?",
    answer:
      "It lands in your organization's prospect list at whatever stage it's actually in — new, reviewing, contacted, applied, received, or rejected — visible on the same Donor Discovery overview as your active requests and pipeline funnel. From there it can move into an outreach queue the same way any other prospect in your pipeline does.",
  },
];

export default function NonprofitProspectResearchClient() {
  return (
    <>
      <Section tone="forest">
        <Eyebrow>Solutions / Nonprofit Prospect Research</Eyebrow>
        <Display1 tone="forest">Tell it a cause and a place. It comes back with scored prospects, not a guess.</Display1>
        <p style={{ color: mk.heroMuted, fontSize: 18, marginTop: 16, maxWidth: 680, lineHeight: 1.6 }}>
          Set a cause taxonomy and a geography &mdash; a radius, a set of states, or the whole country
          &mdash; and a request finds local businesses through Google Places or IRS-registered foundations
          through the federal Business Master File, then scores each one on seven weighted signals with a
          plain-English reason for every score.
        </p>
        <div style={{ display: "flex", gap: 16, marginTop: 28, flexWrap: "wrap" }}>
          <CtaPrimary href="/demo">Run a prospect search on your own area</CtaPrimary>
          <CtaGhost href="#signals" onDark>
            See how scoring works
          </CtaGhost>
        </div>
      </Section>

      <Section tone="tint">
        <Display2>The actual Donor Discovery overview</Display2>
        <p style={{ color: mk.ink, fontSize: 15, marginTop: 12, maxWidth: 680 }}>
          Not a mockup &mdash; the live overview a real organization sees: prospect and signal stat
          cards, quick actions into Discover Prospects and Corporate Marketplace, and a live intent-signals
          panel, all reflecting this account&rsquo;s actual current state rather than seeded demo numbers.
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
            src="/marketing/platform-donor-discovery-live.png"
            alt="The live Donor Discovery overview page, showing real stat cards, quick-action cards into Discover Prospects and Corporate Marketplace, and a live intent-signals panel"
            width={1440}
            height={900}
            priority
            style={{ width: "100%", height: "auto", display: "block" }}
          />
        </div>
      </Section>

      <Section tone="paper">
        <Display2>A three-step request, not a form with fifty fields</Display2>
        <div style={{ display: "grid", gap: 16, marginTop: 24, maxWidth: 720 }}>
          {WIZARD_STEPS.map((s) => (
            <Card key={s.step}>
              <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
                <div
                  style={{
                    flexShrink: 0,
                    width: 32,
                    height: 32,
                    borderRadius: 999,
                    background: mk.forest,
                    color: mk.heroText,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 700,
                    fontSize: 14,
                  }}
                >
                  {s.step}
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: mk.forest }}>{s.label}</div>
                  <p style={{ fontSize: 14, color: mk.ink, marginTop: 4, lineHeight: 1.6 }}>{s.detail}</p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </Section>

      <Section tone="surface" id="signals">
        <Display2>Seven signals, weights shown, not hidden</Display2>
        <div style={{ display: "grid", gap: 10, marginTop: 24, maxWidth: 640 }}>
          {SIGNALS.map((s) => (
            <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <div style={{ width: 44, textAlign: "right", fontSize: 14, fontWeight: 700, color: mk.terracotta, flexShrink: 0 }}>
                {s.weight}%
              </div>
              <div
                style={{
                  flex: 1,
                  height: 10,
                  borderRadius: 999,
                  background: mk.line,
                  overflow: "hidden",
                }}
              >
                <div style={{ width: `${s.weight * 4}%`, height: "100%", background: mk.forest }} />
              </div>
              <div style={{ fontSize: 14, color: mk.ink, flex: 1 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section tone="tint">
        <Display2>Stated limitations</Display2>
        <div style={{ display: "grid", gap: 16, marginTop: 24, maxWidth: 760 }}>
          <Card>
            <p style={{ color: mk.ink, fontSize: 15, lineHeight: 1.7, margin: 0 }}>
              Scoring reflects what's publicly discoverable about giving activity and CSR presence, not a
              company's actual internal giving budget or decision process. Treat a high score as a reason
              to research further, not a guaranteed yes.
            </p>
          </Card>
          <Card>
            <p style={{ color: mk.ink, fontSize: 15, lineHeight: 1.7, margin: 0 }}>
              A national search across a common cause code enumerates a large number of candidates before
              enrichment and scoring can run, so a broad request naturally takes longer than a narrow,
              local one &mdash; scope the geography to what you actually need first.
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
            boxShadow: mkElevation[2],
            padding: 32,
          }}
        >
          <div style={{ maxWidth: 520 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: mk.terracotta, letterSpacing: 0.4 }}>
              NEED A DEEPER DOSSIER ON ONE SPECIFIC PROSPECT?
            </div>
            <div style={{ fontFamily: "var(--mk-display)", fontSize: 24, color: mk.forest, marginTop: 8 }}>
              See the larger research pipeline, honestly framed
            </div>
            <p style={{ fontSize: 15, color: mk.ink, marginTop: 8 }}>
              Donor Prospecting Intelligence is real, working code &mdash; currently in a controlled
              rollout, not open to every account yet.
            </p>
          </div>
          <CtaGhost href="/solutions/donor-prospecting-intelligence">See Donor Prospecting Intelligence</CtaGhost>
        </div>
      </Section>

      <Section tone="forest">
        <div style={{ textAlign: "center" }}>
          <Display2 tone="forest">Run a real prospect search on your own area</Display2>
          <p style={{ color: mk.heroMuted, fontSize: 17, marginTop: 16, maxWidth: 560, marginLeft: "auto", marginRight: "auto" }}>
            A live demo walks the three-step request and shows a real scored result, weights and all.
          </p>
          <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 28, flexWrap: "wrap" }}>
            <CtaPrimary href="/demo">Book a demo</CtaPrimary>
            <CtaGhost href="/register" onDark>
              Create an account
            </CtaGhost>
          </div>
        </div>
      </Section>
    </>
  );
}
