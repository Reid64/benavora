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

const STAGE_FAMILIES: { label: string; color: string; stages: string }[] = [
  { label: "Discovery", color: "#06B6D4", stages: "Discovered → Eligibility Review → Qualified" },
  { label: "Drafting", color: "#8B5CF6", stages: "Drafting → Awaiting Documents → Ready for Review" },
  { label: "Submitted", color: "#0EA5E9", stages: "Submitted → Follow-up Due" },
  { label: "Awarded", color: "#10B981", stages: "Awarded → Reporting Required → Renewal Opportunity" },
  { label: "Denied", color: "#EF4444", stages: "Denied (reapply only if the opportunity recurs)" },
];

const FAQ_ITEMS: { question: string; answer: string }[] = [
  {
    question: "What actually stops an application from skipping a stage?",
    answer:
      "A forward-transition graph defined once and shared by every view of the pipeline. Each of the twelve stages lists exactly which stages it's allowed to move to next, and most of those edges carry a condition — for example, an application can't move from Eligibility Review to Qualified until an eligibility score exists, and can't move from Drafting to Awaiting Documents until the draft actually has content. A move that isn't in the graph is rejected outright, not just discouraged.",
  },
  {
    question: "Can staff move an application backward, and is that logged differently?",
    answer:
      "Yes, moving an application to an earlier stage is always allowed, but unlike a forward move it requires a written note explaining why — there's no silent backward move. Every transition, forward or backward, writes a row to a pipeline history table with who changed it, the from and to stage, and any note, so the full stage history of an application is a real audit trail, not an inferred one.",
  },
  {
    question: "Who's allowed to actually submit an application?",
    answer:
      "Only an owner or admin can move an application into the Submitted stage; every other forward and backward transition is open to any role that can edit. That single role check is enforced in the same shared transition logic every view uses, so it can't be bypassed from a different screen.",
  },
  {
    question: "What happens after an application is awarded or denied?",
    answer:
      "Awarded applications move to Reporting Required and then, once a report is submitted, to Renewal Opportunity — which starts a brand-new application for the next funding cycle rather than overwriting the awarded record. A denied application can only be reapplied to if the underlying opportunity is actually recurring (annual, quarterly, or rolling); one-time opportunities have nowhere to go from Denied, on purpose.",
  },
  {
    question: "Does moving a stage trigger anything else automatically?",
    answer:
      "Submitting notifies the funder-relationship tracking for that funder. Submitted, awarded, and denied all trigger a best-effort follow-up-sequence check, and submission separately feeds the pipeline's own win-rate tracking. All three are fire-and-forget calls — if one fails, the stage transition itself still completes; a flaky notification never blocks the record of what actually happened to the application.",
  },
];

export default function FundingPipelineSoftwareClient() {
  return (
    <>
      <Section tone="forest">
        <Eyebrow>Solutions / Nonprofit Funding Pipeline Software</Eyebrow>
        <Display1 tone="forest">A pipeline that won&rsquo;t let a stage get skipped, or a move go unrecorded.</Display1>
        <p style={{ color: mk.heroMuted, fontSize: 18, marginTop: 16, maxWidth: 680, lineHeight: 1.6 }}>
          A spreadsheet tab per funder tells you where things stood the last time someone remembered to
          update it. This pipeline is a governed twelve-stage state machine: every forward move is checked
          against a real condition, every backward move requires a written reason, only an owner or admin
          can actually submit, and every transition writes to a permanent history record &mdash; whether or
          not anyone was watching when it happened.
        </p>
        <div style={{ display: "flex", gap: 16, marginTop: 28, flexWrap: "wrap" }}>
          <CtaPrimary href="/demo">See your applications on a real pipeline</CtaPrimary>
          <CtaGhost href="#stages" onDark>
            See the stage graph
          </CtaGhost>
        </div>
      </Section>

      <Section tone="tint">
        <Display2>The actual Applications pipeline</Display2>
        <p style={{ color: mk.ink, fontSize: 15, marginTop: 12, maxWidth: 680 }}>
          Not a mockup &mdash; the live Applications page, filtered by lifecycle family with a live count
          per tab, each row showing the funder, the deadline, days spent in the current stage, and the
          latest success-probability score where one has been calculated.
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
            src="/marketing/platform-applications-pipeline-live.png"
            alt="The live Applications page, showing pipeline stage-family tabs with counts and a list of applications each tagged with funder, deadline, and days in stage"
            width={1440}
            height={900}
            priority
            style={{ width: "100%", height: "auto", display: "block" }}
          />
        </div>
      </Section>

      <Section tone="paper" id="stages">
        <Display2>Twelve stages, five families, one shared rulebook</Display2>
        <p style={{ color: mk.ink, fontSize: 15, marginTop: 12, maxWidth: 720 }}>
          The board, the list view, and the stage-transition modal all read the same transition graph, so
          they can never disagree about what&rsquo;s allowed next.
        </p>
        <div style={{ display: "grid", gap: 12, marginTop: 24, maxWidth: 760 }}>
          {STAGE_FAMILIES.map((f) => (
            <Card key={f.label}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span aria-hidden style={{ height: 10, width: 10, borderRadius: 999, background: f.color, flexShrink: 0 }} />
                <div style={{ fontSize: 15, fontWeight: 700, color: mk.forest }}>{f.label}</div>
              </div>
              <p style={{ fontSize: 14, color: mk.ink, marginTop: 8, marginLeft: 20, lineHeight: 1.6 }}>{f.stages}</p>
            </Card>
          ))}
        </div>
      </Section>

      <Section tone="surface">
        <Display2>What a condition actually checks</Display2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20, marginTop: 24 }}>
          <Card>
            <div style={{ fontSize: 13, fontWeight: 700, color: mk.terracotta, letterSpacing: 0.4 }}>
              DATA-BACKED CONDITIONS
            </div>
            <p style={{ fontSize: 14, color: mk.ink, marginTop: 8, lineHeight: 1.6 }}>
              Moving to Qualified or Denied requires an eligibility score to already exist. Moving to
              Awaiting Documents requires draft content. Moving to Ready for Review requires every
              required document to actually be attached, with a live &ldquo;3/5 attached&rdquo; count, not
              a checkbox someone can tick early.
            </p>
          </Card>
          <Card>
            <div style={{ fontSize: 13, fontWeight: 700, color: mk.terracotta, letterSpacing: 0.4 }}>
              MANUAL CONFIRMATIONS
            </div>
            <p style={{ fontSize: 14, color: mk.ink, marginTop: 8, lineHeight: 1.6 }}>
              Two conditions &mdash; the compliance check before submitting, and confirming a report was
              submitted before a renewal cycle opens &mdash; have no stored field to check automatically,
              so the system asks for an explicit confirmation instead of inventing a result it can&rsquo;t
              actually verify.
            </p>
          </Card>
        </div>
      </Section>

      <Section tone="tint">
        <Display2>Stated limitations</Display2>
        <div style={{ display: "grid", gap: 16, marginTop: 24, maxWidth: 760 }}>
          <Card>
            <p style={{ color: mk.ink, fontSize: 15, lineHeight: 1.7, margin: 0 }}>
              The success-probability score shown on some rows comes from a separate scoring pass and
              isn&rsquo;t recalculated by the pipeline itself &mdash; a row without one yet simply shows no
              score, rather than a placeholder number.
            </p>
          </Card>
          <Card>
            <p style={{ color: mk.ink, fontSize: 15, lineHeight: 1.7, margin: 0 }}>
              The two manual conditions (compliance check, report submitted) rely on a person confirming
              honestly. The pipeline enforces that the confirmation happened before the stage moves; it
              can&rsquo;t independently verify that the compliance check or the report itself was done
              correctly.
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
              WANT THE WHOLE CYCLE, NOT JUST THE PIPELINE VIEW?
            </div>
            <div style={{ fontFamily: "var(--mk-display)", fontSize: 24, color: mk.forest, marginTop: 8 }}>
              See how discovery, drafting, and submission feed this pipeline
            </div>
            <p style={{ fontSize: 15, color: mk.ink, marginTop: 8 }}>
              Nonprofit Funding Software covers the full cycle this pipeline tracks the stages of.
            </p>
          </div>
          <CtaGhost href="/solutions/nonprofit-funding-software">See Nonprofit Funding Software</CtaGhost>
        </div>
      </Section>

      <Section tone="forest">
        <div style={{ textAlign: "center" }}>
          <Display2 tone="forest">Put your own applications on a governed pipeline</Display2>
          <p style={{ color: mk.heroMuted, fontSize: 17, marginTop: 16, maxWidth: 560, marginLeft: "auto", marginRight: "auto" }}>
            A live demo walks through a real stage transition, including what happens when a condition
            isn&rsquo;t met yet.
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
