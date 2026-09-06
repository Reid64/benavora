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

const WORKFLOW_STEPS: { label: string; body: string }[] = [
  {
    label: "1. Pick an opportunity and a template",
    body: "Choose a saved opportunity and one of six templates: grant narrative, donation request letter, budget narrative, impact statement, letter of inquiry, or full proposal.",
  },
  {
    label: "2. Retrieval pulls your own record",
    body: "The generator queries your organization profile and knowledge base, scoped to the categories that template actually needs, not your entire knowledge base indiscriminately.",
  },
  {
    label: "3. Proven narratives get priority",
    body: "Up to five of your organization's own narratives that funded a past award in this funder's category are retrieved, ranked by a real win/loss effectiveness score, not a guess at what sounds persuasive.",
  },
  {
    label: "4. Claude drafts against retrieved context only",
    body: "The prompt assembles your knowledge base, proven narratives, and real Census/HUD/BLS/CDC need data where your service area supports it, with an explicit instruction not to fabricate statistics beyond what was actually retrieved.",
  },
  {
    label: "5. Review, edit, and save",
    body: "The draft lands with staff for editing. Nothing generated here is submitted anywhere on its own.",
  },
];

const FAQ_ITEMS: { question: string; answer: string }[] = [
  {
    question: "Is this just a general AI chatbot with a nonprofit label on it?",
    answer:
      "No. Every draft is generated against retrieved context, your organization profile, your knowledge base, and your own proven narratives, assembled into the prompt before Claude writes anything. A generic chatbot has none of that context unless you paste it in yourself.",
  },
  {
    question: "Where do the statistics in a draft actually come from?",
    answer:
      "From your own knowledge base entries and, where your service area supports it, real Census, HUD, BLS, or CDC need data pulled into the same prompt. The generation prompt explicitly instructs against fabricating a statistic beyond what was retrieved.",
  },
  {
    question: "What happens if our knowledge base is incomplete?",
    answer:
      "The draft reflects that. Retrieval only returns what exists; an incomplete knowledge base produces a thinner draft, not an AI-invented substitute for missing program data.",
  },
  {
    question: "Can it write budget narratives, not just program narratives?",
    answer:
      "Yes, budget narrative is one of six templates, and it requires selecting the specific program it's for so the retrieval step pulls the right cost and outcome data.",
  },
  {
    question: "Who has to approve a draft before it's used?",
    answer:
      "A staff member. Drafts land for review and editing; nothing generated here is submitted to a funder automatically. If you also use Grant Application Automation, that stage has its own separate approval gate before anything reaches a portal.",
  },
];

export default function AiGrantWritingSoftwareClient() {
  return (
    <>
      <Section tone="forest">
        <Eyebrow>Solutions / AI Grant Writing Software</Eyebrow>
        <Display1 tone="forest">A draft grounded in your own record, not a generic template with your name swapped in.</Display1>
        <p style={{ color: mk.heroMuted, fontSize: 18, marginTop: 16, maxWidth: 680, lineHeight: 1.6 }}>
          Generic AI writing tools produce fluent text with no relationship to what your organization actually
          does. This one retrieves your organization profile, your knowledge base, and your own past-award
          narratives before Claude writes a single sentence, and it&rsquo;s instructed not to invent a
          statistic beyond what it retrieved.
        </p>
        <div style={{ display: "flex", gap: 16, marginTop: 28, flexWrap: "wrap" }}>
          <CtaPrimary href="/demo">See a real draft generated</CtaPrimary>
          <CtaGhost href="#workflow" onDark>
            See how it drafts
          </CtaGhost>
        </div>
      </Section>

      <Section tone="tint">
        <Display2>The actual Draft Generator</Display2>
        <p style={{ color: mk.ink, fontSize: 15, marginTop: 12, maxWidth: 680 }}>
          Not a mockup — the live Grant Draft Wizard, captured from a running instance of the application,
          mid-workflow at the Select Opportunity step.
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
            src="/marketing/platform-draft-generator-live.png"
            alt="The live Grant Draft Wizard, showing the Select Opportunity step of the real drafting workflow"
            width={1440}
            height={900}
            priority
            style={{ width: "100%", height: "auto", display: "block" }}
          />
        </div>
      </Section>

      <Section tone="paper" id="workflow">
        <Display2>How a draft actually gets generated</Display2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 20, marginTop: 28 }}>
          {WORKFLOW_STEPS.map((s) => (
            <div key={s.label}>
              <div style={{ fontSize: 13, fontWeight: 700, color: mk.terracotta, letterSpacing: 0.4 }}>{s.label}</div>
              <div style={{ fontSize: 15, color: mk.ink, marginTop: 8, lineHeight: 1.6 }}>{s.body}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section tone="surface">
        <Display2>Why proven narratives matter more than a well-written guess</Display2>
        <div style={{ maxWidth: 760 }}>
          <p style={{ color: mk.ink, fontSize: 16, lineHeight: 1.7 }}>
            A narrative that has already funded a real award in a given funder&rsquo;s category is a stronger
            starting point than a fresh draft optimized for how persuasive it sounds. The generator retrieves
            up to five of your own narratives with a recorded win in this opportunity&rsquo;s funder category,
            ranked by an actual win/loss effectiveness score kept on your account, and prioritizes those over
            writing something new from a blank slate.
          </p>
        </div>
      </Section>

      <Section tone="tint">
        <Display2>Stated limitations</Display2>
        <div style={{ display: "grid", gap: 16, marginTop: 24, maxWidth: 760 }}>
          <Card>
            <p style={{ color: mk.ink, fontSize: 15, lineHeight: 1.7, margin: 0 }}>
              A new account with no recorded outcomes has no proven narratives to prioritize yet. Proven-
              narrative reuse becomes stronger after your first few award decisions are recorded.
            </p>
          </Card>
          <Card>
            <p style={{ color: mk.ink, fontSize: 15, lineHeight: 1.7, margin: 0 }}>
              Every draft requires human review before it's used anywhere. This is a starting point for a
              grant writer's judgment, not a substitute for it, and it is not intended to be submitted
              unedited.
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
              READY TO SUBMIT WHAT YOU DRAFT?
            </div>
            <div style={{ fontFamily: "var(--mk-display)", fontSize: 24, color: mk.forest, marginTop: 8 }}>
              See Grant Application Automation
            </div>
            <p style={{ fontSize: 15, color: mk.ink, marginTop: 8 }}>
              An approved draft can be filled into the funder's own portal fields under the same
              human-approval model.
            </p>
          </div>
          <CtaGhost href="/solutions/grant-application-automation">See Grant Application Automation</CtaGhost>
        </div>
      </Section>

      <Section tone="forest">
        <div style={{ textAlign: "center" }}>
          <Display2 tone="forest">See a real draft generated from a sample knowledge base</Display2>
          <p style={{ color: mk.heroMuted, fontSize: 17, marginTop: 16, maxWidth: 560, marginLeft: "auto", marginRight: "auto" }}>
            A live demo walks through retrieval, proven-narrative selection, and generation on a real
            opportunity.
          </p>
          <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 28, flexWrap: "wrap" }}>
            <CtaPrimary href="/demo">Book a demo</CtaPrimary>
            <CtaGhost href="/pricing" onDark>
              See pricing
            </CtaGhost>
          </div>
        </div>
      </Section>
    </>
  );
}
