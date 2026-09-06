"use client";

import { useEffect, useState } from "react";
import { Section, Display1, Display2 } from "@/components/marketing/Section";
import { CtaPrimary, CtaGhost } from "@/components/marketing/Cta";
import { mk, mkRadius } from "@/lib/marketing/theme";

function Eyebrow({ tone, children }: { tone: "forest" | "paper"; children: React.ReactNode }) {
  const color = tone === "forest" ? mk.heroMuted : mk.terracotta;
  return (
    <div style={{ fontSize: 13, fontWeight: 600, color, letterSpacing: 0.6, marginBottom: 12 }}>
      {children}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: mk.surface,
        border: `1px solid ${mk.line}`,
        borderRadius: mkRadius.card,
        padding: 20,
      }}
    >
      {children}
    </div>
  );
}

// --- Section 4: animated sequence -------------------------------------------
// Illustrates the real family order a research run walks through
// (src/lib/pil/research-orchestrator.ts's FAMILY_SEQUENCE, plus the dossier
// synthesis step that runs immediately before completion) - not a screen
// recording, same disclosure convention as every other interactive demo on
// this site (see /trust).
const PIPELINE_STEPS = [
  {
    label: "1. Supervisory — plan the research",
    detail:
      "A Chief Prospect Intelligence Orchestrator turns a goal (a name, or a natural-language request) into a structured research plan, allocates a token and dollar budget for the run, and a critic agent reviews the plan before any research starts.",
  },
  {
    label: "2. Discovery — find the right entity",
    detail:
      "Eight discovery agents (individual major donors, foundations, corporate giving programs, executives, geographic and cause-aligned searches, and CRM/hidden-prospect rediscovery) identify and disambiguate exactly who or what is being researched.",
  },
  {
    label: "3. Prospect Intelligence — go deep",
    detail:
      "Ten agents build out the profile: employment and career history, business ownership, education, nonprofit board seats, foundation affiliations, giving history, wealth capacity, wealth-origin/liquidity events, and verified contact information.",
  },
  {
    label: "4. Relationship Intelligence — map the network",
    detail:
      "Board, corporate, foundation, and professional relationships are mapped into a graph, with warm-introduction paths and a relationship-strength score attached to each connection.",
  },
  {
    label: "5. Qualification — score fit, eligibility, and timing",
    detail:
      "Separate agents score mission affinity (cause, population, program, and geographic alignment), funding eligibility (six pass/fail dimensions), capacity and giving propensity (kept as two distinct scores, never blended), and timing/readiness — then classify the opportunity into a priority tier.",
  },
  {
    label: "6. Strategy — decide the approach",
    detail:
      "An engagement strategy, a recommended first ask, and a four-stage cultivation plan (identify shared ground → warm introduction → deepen engagement → readiness reassessment) are drafted for staff to act on.",
  },
  {
    label: "7. Knowledge Integrity — reconcile and resolve",
    detail:
      "Duplicate entities are resolved, evidence is checked for contradictions and staleness, and the prospect's full record is assembled into a versioned digital twin.",
  },
  {
    label: "8. Operations — measure the fleet",
    detail:
      "Agent-level performance and cost across the run feed back into the platform's own learning loop, separate from any one prospect's dossier.",
  },
  {
    label: "9. Application — connect to AutoApply",
    detail:
      "Once qualified, the prospect is matched against your organization's own request profiles, ranked by an estimated success probability, and handed to AutoApply's submission queue — the same governed pipeline described on the AutoApply page.",
  },
];

function PipelineAnimation() {
  const [step, setStep] = useState(0);
  const currentStep = PIPELINE_STEPS[step % PIPELINE_STEPS.length] ?? PIPELINE_STEPS[0]!;

  useEffect(() => {
    const id = setInterval(() => {
      setStep((s) => (s + 1) % PIPELINE_STEPS.length);
    }, 3400);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      style={{
        background: mk.surface,
        border: `1px solid ${mk.line}`,
        borderRadius: mkRadius.shot,
        padding: 32,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: mk.muted, letterSpacing: 0.4 }}>
        ANIMATED SEQUENCE — ILLUSTRATES THE REAL FAMILY ORDER, NOT A SCREEN RECORDING
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 20, marginBottom: 24, flexWrap: "wrap" }}>
        {PIPELINE_STEPS.map((s, i) => (
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
      <div style={{ fontFamily: "var(--mk-display)", fontSize: 22, color: mk.forest }}>
        {currentStep.label}
      </div>
      <div style={{ fontSize: 15, color: mk.ink, marginTop: 10, lineHeight: 1.6, maxWidth: 640 }}>
        {currentStep.detail}
      </div>
    </div>
  );
}

const FAQ_ITEMS: { question: string; answer: string }[] = [
  {
    question: "Is Prospect Intelligence available on my account today?",
    answer:
      "Not yet for most organizations. It's gated behind an organization-level rollout flag that defaults to off, and the platform's own canary rollout hasn't started — every teammate at a given org sees the same on/off state, so it's never partially on for one person and off for another. If you want in before the wider rollout, ask us — see the call to action below.",
  },
  {
    question: "Does it contact donors or prospects on its own?",
    answer:
      "No. Every agent in the pipeline researches, scores, and drafts a recommended strategy for staff to review — none of them send an email, place a call, or otherwise reach a prospect. Approving actual outreach is its own dedicated human-review type, separate from every other kind of review the system files.",
  },
  {
    question: "Where does the evidence actually come from?",
    answer:
      "Open web sources, public records, news, nonprofit filings (IRS Form 990), SEC EDGAR, corporate and foundation information, licensed databases, and permitted APIs — each one tracked in a source registry as permitted, restricted, or prohibited before any agent is allowed to query it. Every claim in a dossier carries its source, a retrieval date, and one of several verification levels — verified fact, corroborated fact, single-source fact, reasoned inference, or estimate — so a guess is never presented as a confirmed fact.",
  },
  {
    question: "What happens when two sources disagree?",
    answer:
      "The disagreement is recorded as a contradiction, not silently resolved by picking one side. A dedicated agent investigates and either resolves it in favor of one source, marks both as stale, or leaves it open for a person to decide — the dossier reflects whichever of those is actually true, rather than presenting a single confident number.",
  },
  {
    question: "How does this connect to AutoApply?",
    answer:
      "Once a research run finishes, qualified prospects are automatically matched against your organization's own request profiles and handed to AutoApply's submission queue for the governed application process described on the AutoApply page. Nothing about that hand-off skips AutoApply's own eligibility, risk, and rate checks.",
  },
];

export default function ProspectIntelligenceClient() {
  return (
    <>
      {/* 1-2: outcome-focused headline + specific problem statement */}
      <Section tone="forest">
        <Eyebrow tone="forest">Platform / Prospect Intelligence</Eyebrow>
        <Display1 tone="forest">Know who to ask, before you ask them.</Display1>
        <p style={{ color: mk.heroMuted, fontSize: 18, marginTop: 16, maxWidth: 700, lineHeight: 1.6 }}>
          Researching a major donor or foundation by hand means a dozen browser tabs, a guess at how
          much to ask for, and no record of why you approached them that way. Prospect Intelligence
          runs a 51-agent research pipeline against one prospect at a time — discovery, deep
          background, relationship mapping, mission-fit and capacity scoring, and a cultivation
          strategy — and hands you a single evidence-backed dossier instead.
        </p>
        <div style={{ display: "flex", gap: 16, marginTop: 28, flexWrap: "wrap" }}>
          <CtaPrimary href="/demo">Build My Prospect Map</CtaPrimary>
          <CtaGhost href="#pipeline" onDark>
            See how the pipeline works
          </CtaGhost>
        </div>
      </Section>

      {/* 3: honest status — built, not yet a live screenshot every customer can see */}
      <Section tone="tint">
        <Display2>Where this actually stands today</Display2>
        <div style={{ maxWidth: 720, marginTop: 20 }}>
          <p style={{ color: mk.ink, fontSize: 16, lineHeight: 1.7 }}>
            Prospect Intelligence is real, working code — not a mockup or a roadmap slide. It has its
            own database schema, a staff-facing dashboard inside the platform (research monitor,
            prospect list, agent activity, human review queue), and a working orchestrator that
            drives a research run through all nine agent families end to end.
          </p>
          <p style={{ color: mk.ink, fontSize: 16, lineHeight: 1.7, marginTop: 16 }}>
            What it isn&rsquo;t yet: turned on for every organization. Access is gated behind a
            single organization-level rollout flag that defaults to off — if the flag service is
            unreachable or unset for your organization, the feature stays hidden rather than opening
            up by accident. The platform&rsquo;s own rollout plan (a small named pilot group first,
            then a wider expansion, then general availability) hasn&rsquo;t started yet. We&rsquo;d
            rather tell you that plainly than show you a screenshot that implies your account can use
            this right now.
          </p>
          <div style={{ marginTop: 20 }}>
            <CtaGhost href="/demo">Ask about early access</CtaGhost>
          </div>
        </div>
      </Section>

      {/* 4: product demonstration - animated sequence */}
      <Section tone="paper" id="pipeline">
        <Display2>Watch a research run move through the pipeline</Display2>
        <p style={{ color: mk.ink, fontSize: 15, marginTop: 12, maxWidth: 680 }}>
          Each step below mirrors a real stage in the orchestrator (
          <code>src/lib/pil/research-orchestrator.ts</code>).
        </p>
        <div style={{ marginTop: 24 }}>
          <PipelineAnimation />
        </div>
      </Section>

      {/* 5: workflow explanation using the real architecture */}
      <Section tone="surface">
        <Display2>How it actually works</Display2>
        <div style={{ display: "grid", gap: 16, marginTop: 24, maxWidth: 760 }}>
          <p style={{ color: mk.ink, fontSize: 16, lineHeight: 1.7 }}>
            A research run starts from a goal — a name to look into, or a natural-language request —
            and is driven by a single orchestrator through nine agent families in a fixed order:
            Supervisory, Discovery, Prospect Intelligence, Relationship Intelligence, Qualification,
            Strategy, Knowledge Integrity, Operations, and Application. Fifty-one agents are
            registered across those families, each with a defined mission, an autonomy level, and (for
            most of them) an explicit human boundary it cannot cross on its own.
          </p>
          <p style={{ color: mk.ink, fontSize: 16, lineHeight: 1.7 }}>
            Progress is checkpointed after every family, not just at the end — if a run is interrupted,
            it resumes from the next incomplete family instead of starting over. If any agent comes
            back needing a person's judgment, the run pauses in a resumable state and waits for that
            review to be resolved rather than skipping ahead or failing outright.
          </p>
          <p style={{ color: mk.ink, fontSize: 16, lineHeight: 1.7 }}>
            The last step before a run completes is always dossier synthesis — a dedicated agent turns
            everything gathered into a single narrative dossier with facts and inferences explicitly
            separated, evidence citations, confidence scores, and recommended next actions. Once that's
            done, qualified prospects are automatically handed to AutoApply's queue.
          </p>
        </div>
      </Section>

      {/* 6: inputs and outputs */}
      <Section tone="tint">
        <Display2>Inputs and outputs</Display2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 20,
            marginTop: 24,
          }}
        >
          <Card>
            <div style={{ fontSize: 13, fontWeight: 700, color: mk.terracotta, letterSpacing: 0.4 }}>
              INPUTS
            </div>
            <ul style={{ marginTop: 12, paddingLeft: 18, color: mk.ink, fontSize: 15, lineHeight: 1.8 }}>
              <li>A goal: a specific name to research, or a natural-language request</li>
              <li>Your organization&rsquo;s own request profiles, for matching once qualified</li>
              <li>A token and dollar budget for the run, enforced agent by agent</li>
              <li>Permitted sources: open web, public records, news, 990s, SEC EDGAR, and more</li>
            </ul>
          </Card>
          <Card>
            <div style={{ fontSize: 13, fontWeight: 700, color: mk.terracotta, letterSpacing: 0.4 }}>
              OUTPUTS
            </div>
            <ul style={{ marginTop: 12, paddingLeft: 18, color: mk.ink, fontSize: 15, lineHeight: 1.8 }}>
              <li>A narrative dossier with facts, inferences, citations, and confidence scores</li>
              <li>Mission-affinity, funding-eligibility, capacity/propensity, and timing scores</li>
              <li>A relationship graph with warm-introduction paths and strength ratings</li>
              <li>A cultivation plan and, once qualified, a ranked entry in AutoApply&rsquo;s queue</li>
            </ul>
          </Card>
        </div>
      </Section>

      {/* 7: human control model */}
      <Section tone="surface">
        <Display2>Where a person is in the loop</Display2>
        <div style={{ maxWidth: 760, marginTop: 20 }}>
          <p style={{ color: mk.ink, fontSize: 16, lineHeight: 1.7 }}>
            No agent in this pipeline contacts a prospect. Every one of them researches, scores, or
            drafts a recommendation for a person to act on — approving actual outreach is its own
            explicit review type, separate from every other kind of check below.
          </p>
          <p style={{ color: mk.ink, fontSize: 16, lineHeight: 1.7, marginTop: 16 }}>
            <strong>Human review queue.</strong> Identity linkage, capacity determinations, policy
            exceptions, autonomy increases, high-impact actions, and outreach approval all route to a
            queue a person has to resolve. An agent that hits one of these doesn&rsquo;t skip it or
            fail the run — it pauses in a resumable state until a person decides.
          </p>
          <p style={{ color: mk.ink, fontSize: 16, lineHeight: 1.7, marginTop: 16 }}>
            <strong>An agent watches the agents.</strong> A dedicated Autonomy Governor continuously
            monitors every active run for policy violations and can terminate one immediately — and by
            design it cannot approve its own authority increases or policy exceptions; only a human
            decision can resolve those.
          </p>
          <p style={{ color: mk.ink, fontSize: 16, lineHeight: 1.7, marginTop: 16 }}>
            <strong>Every action is logged.</strong> An append-only audit trail records every agent and
            human action, and a policy engine attaches an allow, deny, or require-human decision to
            each one — so any recommendation the system produces can be traced back to exactly what it
            saw and why it decided that.
          </p>
        </div>
      </Section>

      {/* 8: quantified results - honestly pending */}
      <Section tone="tint">
        <Display2>Quantified results</Display2>
        <Card>
          <p style={{ color: mk.ink, fontSize: 16, lineHeight: 1.7, margin: 0 }}>
            We don&rsquo;t have a published research-accuracy or dollars-identified figure for
            Prospect Intelligence yet — the rollout that would generate real numbers hasn&rsquo;t
            started. We&rsquo;d rather show you an honest &ldquo;pending&rdquo; than a number we backed
            into. This section will be replaced with real pilot data once we have it.
          </p>
        </Card>
      </Section>

      {/* 9: integrations - verified against real code, nothing invented */}
      <Section tone="surface">
        <Display2>What it actually connects to</Display2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 20,
            marginTop: 24,
          }}
        >
          <Card>
            <div style={{ fontSize: 13, fontWeight: 700, color: mk.terracotta, letterSpacing: 0.4 }}>
              RESEARCH SOURCES
            </div>
            <p style={{ fontSize: 15, color: mk.muted, marginTop: 8 }}>
              Tracked in a source registry as permitted, restricted, or prohibited before any agent
              can query them, with a rate limit and a stored, hashed snapshot behind every claim.
            </p>
            <ul style={{ marginTop: 12, paddingLeft: 18, color: mk.ink, fontSize: 15, lineHeight: 1.8 }}>
              <li>Open web, public records, and news</li>
              <li>IRS Form 990 filings and SEC EDGAR</li>
              <li>Corporate and foundation information, licensed databases, permitted APIs</li>
            </ul>
          </Card>
          <Card>
            <div style={{ fontSize: 13, fontWeight: 700, color: mk.terracotta, letterSpacing: 0.4 }}>
              DOWNSTREAM
            </div>
            <ul style={{ marginTop: 12, paddingLeft: 18, color: mk.ink, fontSize: 15, lineHeight: 1.8 }}>
              <li><strong>AutoApply</strong> — a completed, qualified research run is handed straight to AutoApply&rsquo;s submission queue</li>
              <li><strong>Outbound webhooks</strong> — organizations already configured for AutoApply&rsquo;s queue-populated event are notified the same way</li>
            </ul>
          </Card>
        </div>
      </Section>

      {/* 10: security and reliability */}
      <Section tone="tint">
        <Display2>Security and reliability</Display2>
        <div style={{ maxWidth: 680 }}>
          <p style={{ color: mk.ink, fontSize: 16, lineHeight: 1.7 }}>
            Access is org-scoped end to end — every table carries an organization id, and the rollout
            flag itself is evaluated per organization, so one team&rsquo;s access never leaks into
            another&rsquo;s. If the flag service is unreachable or a flag is unset, the feature fails
            closed and stays hidden rather than opening up by accident. Every claim in a dossier is
            tied to a stored source snapshot with a content hash, so evidence can be checked against
            what was actually retrieved, not just trusted. Cost budgets can be set at the
            organization, agent, or single-run level, with an optional hard stop. For the
            platform-wide security and governance model, see the Trust and Governance page.
          </p>
          <div style={{ marginTop: 20 }}>
            <CtaGhost href="/trust">Read the Trust and Governance page</CtaGhost>
          </div>
        </div>
      </Section>

      {/* 11: customer story - honest placeholder */}
      <Section tone="surface">
        <Display2>Customer story</Display2>
        <Card>
          <p style={{ color: mk.muted, fontSize: 15, fontWeight: 600, margin: 0 }}>COMING SOON</p>
          <p style={{ color: mk.ink, fontSize: 16, lineHeight: 1.7, marginTop: 10, marginBottom: 0 }}>
            We don&rsquo;t have a published customer story for Prospect Intelligence yet — no
            organization has used it in production, because the rollout hasn&rsquo;t started. Once a
            pilot organization has run it against a real cultivation cycle and agreed to be named,
            their story will go here — not a composite or hypothetical example.
          </p>
        </Card>
      </Section>

      {/* 12: FAQ */}
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

      {/* 13: contextual free tool */}
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
              Not sure which funders to research first?
            </div>
            <p style={{ fontSize: 15, color: mk.ink, marginTop: 8 }}>
              Run the free Funding Potential Scan first — a short, no-signup check of the kind of
              funding your organization is likely to qualify for.
            </p>
          </div>
          <CtaPrimary href="/scan">Try the free Funding Potential Scan</CtaPrimary>
        </div>
      </Section>

      {/* 14: tailored call to action */}
      <Section tone="forest">
        <div style={{ textAlign: "center" }}>
          <Display2 tone="forest">Build My Prospect Map</Display2>
          <p style={{ color: mk.heroMuted, fontSize: 17, marginTop: 16, maxWidth: 560, marginLeft: "auto", marginRight: "auto" }}>
            Prospect Intelligence is in controlled rollout, not yet open to every account. Talk to us
            about early access, or see the governed pipeline it feeds once a prospect is qualified.
          </p>
          <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 28, flexWrap: "wrap" }}>
            <CtaPrimary href="/demo">Build My Prospect Map</CtaPrimary>
            <CtaGhost href="/platform/autoapply" onDark>
              See what happens after a prospect qualifies
            </CtaGhost>
          </div>
        </div>
      </Section>
    </>
  );
}
