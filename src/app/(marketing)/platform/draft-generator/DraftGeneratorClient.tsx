"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Section, Display1, Display2 } from "@/components/marketing/Section";
import { CtaPrimary, CtaGhost } from "@/components/marketing/Cta";
import { mk, mkElevation, mkRadius } from "@/lib/marketing/theme";

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
        boxShadow: mkElevation[1],
        padding: 20,
      }}
    >
      {children}
    </div>
  );
}

// --- Section 3: animated workflow sequence ----------------------------------
// This is an illustrated animation of the real generateDraft() pipeline
// (src/lib/drafts/generator.ts), not a screen recording - it never touches a
// live account, matching how every other interactive demo on this site is
// disclosed (see /trust).
const WORKFLOW_STEPS = [
  {
    label: "1. Pick an opportunity and a template",
    detail:
      "Staff choose one saved opportunity from the pipeline and one of six templates - grant narrative, donation request letter, budget narrative, impact statement, letter of inquiry, or full proposal. Budget narrative also requires picking the program it's for.",
  },
  {
    label: "2. Retrieval pulls your organization's own record",
    detail:
      "generateDraft() queries your organization profile (mission, service area, population served) and your knowledge base, scoped to the categories that template actually needs, plus anything filed under a custom category.",
  },
  {
    label: "3. Narratives proven by real award outcomes get priority",
    detail:
      "A separate query pulls up to 5 of your organization's own narratives that funded a past award in this opportunity's funder category, ranked by a real win/loss effectiveness score - not a guess at what sounds persuasive.",
  },
  {
    label: "4. Claude drafts against real retrieved context",
    detail:
      "The retrieved knowledge-base entries, proven narratives, and (where your service area supports it) real Census/HUD/BLS/CDC need data are assembled into the prompt with an explicit instruction not to fabricate statistics beyond what was actually retrieved.",
  },
  {
    label: "5. Review, edit, and save",
    detail:
      "The draft lands in an editable text area with a confidence score and a source list. Saving writes it onto a normal pipeline item - nothing in this step submits anywhere.",
  },
];

function WorkflowAnimation() {
  const [step, setStep] = useState(0);
  const currentStep = WORKFLOW_STEPS[step % WORKFLOW_STEPS.length] ?? WORKFLOW_STEPS[0]!;

  useEffect(() => {
    const id = setInterval(() => {
      setStep((s) => (s + 1) % WORKFLOW_STEPS.length);
    }, 3200);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      style={{
        background: mk.surface,
        border: `1px solid ${mk.line}`,
        borderRadius: mkRadius.shot,
        boxShadow: mkElevation[2],
        padding: 32,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: mk.muted, letterSpacing: 0.4 }}>
        ANIMATED SEQUENCE — ILLUSTRATES THE REAL PIPELINE, NOT A SCREEN RECORDING
      </div>
      <div
        style={{
          display: "flex",
          gap: 8,
          marginTop: 20,
          marginBottom: 24,
          flexWrap: "wrap",
        }}
      >
        {WORKFLOW_STEPS.map((s, i) => (
          <div
            key={s.label}
            style={{
              flex: "1 1 140px",
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
    question: "Does Draft Generator invent facts about our organization?",
    answer:
      "No. Every factual claim it has to work with comes from your own organization profile, your knowledge base, or your proven narratives - the source list underneath the draft shows exactly which entries were used. Where it pulls in outside need-statement data (Census, HUD, BLS, CDC figures for your service area), the prompt explicitly instructs the model not to fabricate a statistic beyond what was actually retrieved.",
  },
  {
    question: "What exactly makes a narrative \"proven\"?",
    answer:
      "A narrative earns proven status automatically once it has been cited in at least two awarded outcomes - the platform recalculates a real win/loss effectiveness score from your organization's actual outcome history every time a new result comes in. An owner or admin can also manually toggle a narrative's proven status; that override holds until the next time an awarded outcome recalculates it, at which point the automatic score can move it again.",
  },
  {
    question: "Can a draft get submitted to a funder without anyone reading it?",
    answer:
      "No. The wizard's only forward action is Save, which writes the draft onto a normal pipeline item - it never calls a submission endpoint. Drafts can also be generated automatically by an agent with no person involved in the writing, but that code path is structurally blocked from submitting: it can only save a draft flagged as pending review, and it never sets a submission timestamp. The only route from a draft into AutoApply requires a person to click Approve or Submit in the Draft Queue.",
  },
  {
    question: "Does approving a draft always require a second, separate submit click?",
    answer:
      "Approving is always a human action - there's no code path that approves a draft automatically. An organization can optionally set a confidence threshold so that approving a draft above that threshold moves it straight into the AutoApply queue without a second manual Submit click. Below that threshold, or with no threshold set, Approve and Submit are two separate clicks.",
  },
  {
    question: "Which templates can it actually generate?",
    answer:
      "Six: grant narrative, donation request letter, budget narrative, impact statement, letter of inquiry, and full proposal. Budget narrative additionally requires picking which program the line items belong to.",
  },
  {
    question: "Can I email a finished draft straight from the page?",
    answer:
      "Not yet. Review & Export shows an Email Draft button, but it's currently disabled pending a Gmail connection - we'd rather show it disabled than claim it works.",
  },
];

export default function DraftGeneratorClient() {
  return (
    <>
      {/* 1-2: outcome-focused headline + specific problem statement */}
      <Section tone="forest">
        <Eyebrow tone="forest">Platform / Draft Generator</Eyebrow>
        <Display1 tone="forest">Stop starting every grant narrative from a blank page.</Display1>
        <p style={{ color: mk.heroMuted, fontSize: 18, marginTop: 16, maxWidth: 680, lineHeight: 1.6 }}>
          Grant staff re-type the same mission statement, program description, and outcomes data into a
          new narrative every time a notice comes in — and reviewers have no way to tell which sentences
          are backed by a real source and which an AI tool invented. Draft Generator pulls directly from
          your organization&rsquo;s own knowledge base and its narratives proven by real award outcomes, and
          hands you an editable first draft you finish and save — not a document that leaves the building
          on its own.
        </p>
        <div style={{ display: "flex", gap: 16, marginTop: 28, flexWrap: "wrap" }}>
          <CtaPrimary href="/register">Analyze a Grant Narrative</CtaPrimary>
          <CtaGhost href="#workflow" onDark>
            See how it works
          </CtaGhost>
        </div>
      </Section>

      {/* 3: real screenshot of the live Draft Generator page */}
      <Section tone="tint">
        <Display2>The actual Draft Generator</Display2>
        <p style={{ color: mk.ink, fontSize: 15, marginTop: 12, maxWidth: 680 }}>
          Not a mockup — this is the live 4-step Draft Generator wizard, captured from a running instance of
          the application on {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}.
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
            alt="The live Draft Generator wizard, showing the Select Opportunity step"
            width={1440}
            height={900}
            priority
            style={{ width: "100%", height: "auto", display: "block" }}
          />
        </div>
      </Section>

      {/* 4: product demonstration - animated sequence */}
      <Section tone="paper" id="workflow">
        <Display2>Watch a draft get built</Display2>
        <p style={{ color: mk.ink, fontSize: 15, marginTop: 12, maxWidth: 680 }}>
          Each step below mirrors a real stage in the generation code (
          <code>src/lib/drafts/generator.ts</code>).
        </p>
        <div style={{ marginTop: 24 }}>
          <WorkflowAnimation />
        </div>
      </Section>

      {/* 5: workflow explanation using the real drafting architecture */}
      <Section tone="surface">
        <Display2>How it actually works</Display2>
        <div style={{ display: "grid", gap: 16, marginTop: 24, maxWidth: 760 }}>
          <p style={{ color: mk.ink, fontSize: 16, lineHeight: 1.7 }}>
            Draft Generator is a real 4-step wizard — Select Opportunity, Customize, Generate, Review
            &amp; Export — with genuine step state, not a cosmetic progress bar. You can jump between steps
            freely, and nothing you&rsquo;ve entered is lost moving back and forth.
          </p>
          <p style={{ color: mk.ink, fontSize: 16, lineHeight: 1.7 }}>
            Generation itself is a multi-source retrieval pipeline, not a single prompt to an AI model.
            Before drafting, the code pulls your organization&rsquo;s profile (mission, service area,
            population served), your knowledge-base entries scoped to whichever categories that template
            actually needs, and — where your service area supports it — real Census, HUD, BLS, and CDC
            need-statement data for your county or state, with an explicit instruction to the model not to
            fabricate a statistic beyond what was actually retrieved.
          </p>
          <p style={{ color: mk.ink, fontSize: 16, lineHeight: 1.7 }}>
            Narratives proven by real award outcomes get a separate, prioritized query: up to five of your
            organization&rsquo;s own narratives that funded a past award in this opportunity&rsquo;s funder
            category, ranked by a real win/loss effectiveness score and injected as high-weight examples —
            not a generic &ldquo;proven&rdquo; label with nothing behind it.
          </p>
          <p style={{ color: mk.ink, fontSize: 16, lineHeight: 1.7 }}>
            Every knowledge-base entry, proven narrative, and outside data point actually supplied to the
            model is tracked and shown back to you in a source list underneath the draft — the same list the
            model was given, not a reconstruction after the fact.
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
              <li>One saved, scored opportunity from your pipeline</li>
              <li>One of six templates: grant narrative, donation request letter, budget narrative, impact statement, letter of inquiry, full proposal</li>
              <li>Your organization profile and knowledge-base entries, scoped to the template</li>
              <li>Up to 5 of your own narratives proven by real award outcomes in this funder category</li>
              <li>Real Census/HUD/BLS/CDC need data for your service area, when available</li>
            </ul>
          </Card>
          <Card>
            <div style={{ fontSize: 13, fontWeight: 700, color: mk.terracotta, letterSpacing: 0.4 }}>
              OUTPUTS
            </div>
            <ul style={{ marginTop: 12, paddingLeft: 18, color: mk.ink, fontSize: 15, lineHeight: 1.8 }}>
              <li>An editable draft with a real confidence score based on how much source material backed it</li>
              <li>A source list showing exactly which knowledge-base entries and proven narratives were used</li>
              <li>Optional humanized rewrite and rubric-based rescoring, on request</li>
              <li>A saved draft version and a normal pipeline entry once you click Save</li>
            </ul>
          </Card>
        </div>
      </Section>

      {/* 7: human control model */}
      <Section tone="surface">
        <Display2>Where a person is in the loop</Display2>
        <div style={{ maxWidth: 760, marginTop: 20 }}>
          <p style={{ color: mk.ink, fontSize: 16, lineHeight: 1.7 }}>
            Writing a draft and submitting a draft are two separately-gated actions in the code, not two
            names for the same button. In the wizard, the only forward action a draft can take is Save,
            which writes the text onto a normal pipeline item. Nothing on this page calls AutoApply or any
            portal-submission endpoint.
          </p>
          <p style={{ color: mk.ink, fontSize: 16, lineHeight: 1.7, marginTop: 16 }}>
            Drafts can also be generated with no person writing them — an agent can produce a full draft on
            its own from a queued opportunity. That path is structurally blocked from submitting: the code
            that creates those drafts fails outright unless it marks the row pending review, and it never
            sets a submission timestamp. The review screen built for those drafts can only dismiss one from
            the queue, never submit it.
          </p>
          <p style={{ color: mk.ink, fontSize: 16, lineHeight: 1.7, marginTop: 16 }}>
            The one real path from a draft into AutoApply is the Draft Queue, and it always requires a
            person to click Approve or Submit. An organization can optionally set a confidence threshold so
            an approved draft above that threshold skips a second, separate Submit click — but Approve
            itself is always a person clicking a button, never something the system does on its own.
          </p>
        </div>
      </Section>

      {/* 8: quantified proof - honestly pending */}
      <Section tone="tint">
        <Display2>Quantified results</Display2>
        <Card>
          <p style={{ color: mk.ink, fontSize: 16, lineHeight: 1.7, margin: 0 }}>
            We don&rsquo;t have a published draft-acceptance rate, time-saved-per-draft, or win-rate-lift
            number for Draft Generator yet. Those figures depend on real usage over a full grant cycle, and
            we&rsquo;d rather show you an honest &ldquo;pending&rdquo; than a number we backed into. This
            section will be replaced with real pilot data once we have it.
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
              DRAFTING AND REWRITING
            </div>
            <p style={{ fontSize: 15, color: mk.muted, marginTop: 8 }}>
              Both the initial draft and the optional &ldquo;Humanize&rdquo; rewrite are generated by the
              same underlying model.
            </p>
            <ul style={{ marginTop: 12, paddingLeft: 18, color: mk.ink, fontSize: 15, lineHeight: 1.8 }}>
              <li><strong>Claude (Anthropic)</strong> — drafting and rewriting</li>
            </ul>
          </Card>
          <Card>
            <div style={{ fontSize: 13, fontWeight: 700, color: mk.terracotta, letterSpacing: 0.4 }}>
              REAL EXTERNAL NEED DATA
            </div>
            <p style={{ fontSize: 15, color: mk.muted, marginTop: 8 }}>
              Pulled for your service area&rsquo;s county or state, when a draft&rsquo;s template calls for a
              need statement.
            </p>
            <ul style={{ marginTop: 12, paddingLeft: 18, color: mk.ink, fontSize: 15, lineHeight: 1.8 }}>
              <li><strong>Census, HUD, BLS, CDC</strong> — aggregated county/state need-statement figures</li>
            </ul>
          </Card>
        </div>
        <p style={{ color: mk.muted, fontSize: 14, marginTop: 20, maxWidth: 680 }}>
          Not yet connected: the Email Draft button in Review &amp; Export is visible but disabled pending a
          Gmail connection — we&rsquo;re disclosing that here rather than implying it already works.
        </p>
      </Section>

      {/* 10: security and reliability */}
      <Section tone="tint">
        <Display2>Security and reliability</Display2>
        <div style={{ maxWidth: 680 }}>
          <p style={{ color: mk.ink, fontSize: 16, lineHeight: 1.7 }}>
            Every knowledge-base and proven-narrative query is scoped to your organization, every generated
            draft is saved as a version you can trace, and the source list shown under a draft is the same
            list the model was actually given — not a reconstruction after the fact. For the platform-wide
            security and governance model — including how the AutoApply approval gate works downstream of a
            saved draft — see the Trust and Governance page.
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
            We don&rsquo;t have a published customer story for Draft Generator yet. Once an organization has
            used it through a real grant cycle and agreed to be named, their story will go here — not a
            composite or hypothetical example.
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
            boxShadow: mkElevation[2],
            padding: 32,
          }}
        >
          <div style={{ maxWidth: 520 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: mk.terracotta, letterSpacing: 0.4 }}>
              FREE, NO ACCOUNT REQUIRED
            </div>
            <div style={{ fontFamily: "var(--mk-display)", fontSize: 24, color: mk.forest, marginTop: 8 }}>
              Not ready to connect your knowledge base yet?
            </div>
            <p style={{ fontSize: 15, color: mk.ink, marginTop: 8 }}>
              Run the free Funding Potential Scan first — a short, no-signup check of the kind of funding
              your organization is likely to qualify for.
            </p>
          </div>
          <CtaPrimary href="/scan">Try the free Funding Potential Scan</CtaPrimary>
        </div>
      </Section>

      {/* 14: tailored call to action */}
      <Section tone="forest">
        <div style={{ textAlign: "center" }}>
          <Display2 tone="forest">Analyze a Grant Narrative</Display2>
          <p style={{ color: mk.heroMuted, fontSize: 17, marginTop: 16, maxWidth: 560, marginLeft: "auto", marginRight: "auto" }}>
            Connect your knowledge base and let Draft Generator turn a scored opportunity into an editable
            first draft — sourced from your own facts and narratives proven by real award outcomes.
          </p>
          <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 28, flexWrap: "wrap" }}>
            <CtaPrimary href="/register">Analyze a Grant Narrative</CtaPrimary>
            <CtaGhost href="/demo" onDark>
              Book a demo instead
            </CtaGhost>
          </div>
        </div>
      </Section>
    </>
  );
}
