"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
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

// --- Section 4: animated pipeline sequence ----------------------------------
// This is an illustrated animation of the real 8-lane pipeline
// (orchestrator.ts), not a screen recording - it never touches a live
// account, matching how every other interactive demo on this site is
// disclosed (see /trust).
const PIPELINE_STEPS = [
  {
    label: "1. Search profile fires",
    detail:
      "A staff-defined search profile (keywords, categories, geography, focus areas) triggers a sweep - on demand from the Research page, or on schedule.",
  },
  {
    label: "2. 8 lanes run in parallel",
    detail:
      "4 base research families (Government, Corporate, Foundation, Local Sponsorship) plus 4 specialized passes (Grants.gov API, state agencies, foundation directories, faith-based) run at once via Promise.allSettled - one lane failing never blocks the others.",
  },
  {
    label: "3. Cross-lane dedup",
    detail:
      "Because lanes run concurrently, two lanes can independently find the same opportunity. A post-sweep pass matches by URL, then name + funder, and keeps only the earliest row.",
  },
  {
    label: "4. Consensus validation",
    detail:
      "New findings can be checked independently by two AI providers (Claude and Gemini) against existence, eligibility coherence, deadline plausibility, and amount sanity. Agreement earns a Verified badge; disagreement is left for staff to judge.",
  },
  {
    label: "5. Feed, not pipeline",
    detail:
      "Results land in a reviewable feed. Nothing is added to the pipeline, scored for eligibility, or drafted without a staff member acting on it.",
  },
];

function PipelineAnimation() {
  const [step, setStep] = useState(0);
  const currentStep = PIPELINE_STEPS[step % PIPELINE_STEPS.length] ?? PIPELINE_STEPS[0]!;

  useEffect(() => {
    const id = setInterval(() => {
      setStep((s) => (s + 1) % PIPELINE_STEPS.length);
    }, 3200);
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
        {PIPELINE_STEPS.map((s, i) => (
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
    question: "Does Discovery submit anything, or add opportunities to our pipeline automatically?",
    answer:
      "No. Discovery's output is a deduplicated feed. A staff member decides which opportunity moves into eligibility scoring, drafting, or the pipeline - nothing advances on its own.",
  },
  {
    question: "What happens when the AI validators disagree on a finding?",
    answer:
      "Consensus validation only runs when a second AI provider is configured, and it never browses the live web - it reasons from the finding's own internal consistency. An opportunity is only marked Verified when both providers independently agree; disagreement leaves it unmarked for a staff member to judge instead of guessing.",
  },
  {
    question: "Which sources does Discovery actually search?",
    answer:
      "Government sources (Grants.gov, SAM.gov, state agencies), foundation sources (foundation directories, faith-based searches), corporate giving programs, and local sponsorship pages - run as 8 parallel lanes per sweep.",
  },
  {
    question: "Can we control what shows up in our feed?",
    answer:
      "Yes. Search profiles (up to 10 active per organization) carry keywords, categories, geography, focus-area weights, population-served tags, and exclusion lists, and each research family can be individually enabled or disabled per profile.",
  },
  {
    question: "How is this different from just checking Grants.gov ourselves?",
    answer:
      "Grants.gov is one of the 8 lanes. Discovery also runs SAM.gov, state-agency searches, foundation directories, corporate giving pages, and faith-based sources in parallel on the same sweep, then removes the duplicates a manual multi-site search would force you to spot yourself.",
  },
];

export default function DiscoveryClient() {
  return (
    <>
      {/* 1-2: outcome-focused headline + specific problem statement */}
      <Section tone="forest">
        <Eyebrow tone="forest">Platform / Opportunity Discovery</Eyebrow>
        <Display1 tone="forest">Stop finding out about a grant after it closed.</Display1>
        <p style={{ color: mk.heroMuted, fontSize: 18, marginTop: 16, maxWidth: 680, lineHeight: 1.6 }}>
          Grant staff at small and mid-sized nonprofits lose real hours every week checking Grants.gov,
          SAM.gov, and a rotating list of foundation and corporate giving pages by hand — and still miss
          opportunities that were never on anyone&rsquo;s bookmark list. Discovery runs eight research
          lanes against those sources at once and hands you one deduplicated feed instead of a dozen browser
          tabs.
        </p>
        <div style={{ display: "flex", gap: 16, marginTop: 28, flexWrap: "wrap" }}>
          <CtaPrimary href="/register">Find My Best Fit Opportunities</CtaPrimary>
          <CtaGhost href="#pipeline" onDark>
            See how it works
          </CtaGhost>
        </div>
      </Section>

      {/* 3: real screenshot of the live Research page */}
      <Section tone="tint">
        <Display2>The actual Research page</Display2>
        <p style={{ color: mk.ink, fontSize: 15, marginTop: 12, maxWidth: 680 }}>
          Not a mockup — this is the live Research Command Center, captured from a running instance of the
          application on {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}.
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
            src="/marketing/platform-discovery-research-live.png"
            alt="The live Research Command Center page, showing the research resource directory and agent launchpad"
            width={1440}
            height={900}
            priority
            style={{ width: "100%", height: "auto", display: "block" }}
          />
        </div>
      </Section>

      {/* 4: product demonstration - animated sequence */}
      <Section tone="paper" id="pipeline">
        <Display2>Watch a sweep run</Display2>
        <p style={{ color: mk.ink, fontSize: 15, marginTop: 12, maxWidth: 680 }}>
          Each step below mirrors a real stage in the orchestration code (
          <code>src/lib/agents/research/orchestrator.ts</code>).
        </p>
        <div style={{ marginTop: 24 }}>
          <PipelineAnimation />
        </div>
      </Section>

      {/* 5: workflow explanation using the real research agent architecture */}
      <Section tone="surface">
        <Display2>How it actually works</Display2>
        <div style={{ display: "grid", gap: 16, marginTop: 24, maxWidth: 760 }}>
          <p style={{ color: mk.ink, fontSize: 16, lineHeight: 1.7 }}>
            Discovery is not one agent — it is eight research lanes launched together. Four base families
            (Government Grants, Corporate Giving, Foundation Grants, Local Sponsorship) sweep broadly; four
            specialized passes reuse the Government and Foundation agent classes under a narrower focus
            (the Grants.gov API directly, state agencies, foundation directories, and faith-based sources)
            so each source type gets its own dedicated search rather than one generic query trying to cover
            all of them.
          </p>
          <p style={{ color: mk.ink, fontSize: 16, lineHeight: 1.7 }}>
            All eight lanes run concurrently via <code>Promise.allSettled</code> — one lane timing out or
            erroring never blocks the other seven, and every lane&rsquo;s status is reported back so staff
            can see exactly which sources returned results and which didn&rsquo;t on a given run.
          </p>
          <p style={{ color: mk.ink, fontSize: 16, lineHeight: 1.7 }}>
            Running lanes in parallel creates a real side effect: two lanes can independently discover the
            same opportunity before either has committed its row. A cross-lane deduplication pass runs after
            every sweep, matching first on URL and then on funder name plus program title, and keeps the
            earliest-created row when it finds a collision.
          </p>
          <p style={{ color: mk.ink, fontSize: 16, lineHeight: 1.7 }}>
            Every run is triggered either on demand from the Research page (per-lane buttons, or &ldquo;Run
            All&rdquo;) or on a schedule tied to an organization&rsquo;s active search profiles, and is
            logged to an agent run history with status, items found, items processed, duration, and any
            error — visible from the same page.
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
              <li>Staff-configured search profile: keywords, funder categories, geography</li>
              <li>Focus-area weights and populations-served tags, woven into query building</li>
              <li>Negative filters: excluded categories and excluded funder names</li>
              <li>Per-agent enable/disable toggles on each profile</li>
              <li>Live source responses: Grants.gov, SAM.gov, state portals, foundation directories, corporate and local sponsorship pages</li>
            </ul>
          </Card>
          <Card>
            <div style={{ fontSize: 13, fontWeight: 700, color: mk.terracotta, letterSpacing: 0.4 }}>
              OUTPUTS
            </div>
            <ul style={{ marginTop: 12, paddingLeft: 18, color: mk.ink, fontSize: 15, lineHeight: 1.8 }}>
              <li>Deduplicated opportunity rows: name, source, category, amount range, deadline</li>
              <li>A consensus validation badge on opportunities checked by both AI providers</li>
              <li>An agent run log per lane: status, items found/processed, duration, errors</li>
              <li>A count of cross-lane duplicates removed in that sweep</li>
            </ul>
          </Card>
        </div>
      </Section>

      {/* 7: human control model */}
      <Section tone="surface">
        <Display2>Where a person is in the loop</Display2>
        <div style={{ maxWidth: 760, marginTop: 20 }}>
          <p style={{ color: mk.ink, fontSize: 16, lineHeight: 1.7 }}>
            Discovery does not decide what your organization pursues. It builds a reviewed feed; a staff
            member decides which listing moves into eligibility scoring and, from there, into drafting. No
            opportunity that Discovery surfaces is added to the pipeline, scored, or drafted without that
            action.
          </p>
          <p style={{ color: mk.ink, fontSize: 16, lineHeight: 1.7, marginTop: 16 }}>
            The one place Discovery itself makes an automated judgment is consensus validation, and it is
            built to defer rather than assert: two independent AI providers each judge a finding&rsquo;s
            existence, eligibility coherence, deadline plausibility, and amount sanity from the finding&rsquo;s
            own text — they are instructed to return &ldquo;unverifiable&rdquo; rather than invent an answer,
            and a Verified badge only appears when both providers agree. When they disagree, the finding is
            left unmarked for a person to judge instead of the system picking a side.
          </p>
          <p style={{ color: mk.ink, fontSize: 16, lineHeight: 1.7, marginTop: 16 }}>
            Search profiles themselves are staff-authored and staff-maintained: which sources run, which
            categories count, which funders are excluded, and whether a given research family runs at all
            are all settings a person sets, not something the system infers on its own.
          </p>
        </div>
      </Section>

      {/* 8: quantified proof - honestly pending */}
      <Section tone="tint">
        <Display2>Quantified results</Display2>
        <Card>
          <p style={{ color: mk.ink, fontSize: 16, lineHeight: 1.7, margin: 0 }}>
            We don&rsquo;t have a published win-rate, time-saved, or dollar-figure number for Discovery yet.
            Those figures depend on real pilot usage over a full grant cycle, and we&rsquo;d rather show you
            an honest &ldquo;pending&rdquo; than a number we backed into. This section will be replaced with
            real pilot data once we have it.
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
              LIVE FUNDING DATA SOURCES
            </div>
            <p style={{ fontSize: 15, color: mk.muted, marginTop: 8 }}>
              Polled directly by Discovery&rsquo;s research lanes.
            </p>
            <ul style={{ marginTop: 12, paddingLeft: 18, color: mk.ink, fontSize: 15, lineHeight: 1.8 }}>
              <li><strong>Grants.gov</strong> — public search API, no authentication required</li>
              <li><strong>SAM.gov</strong> — opportunities search API, API-key gated</li>
            </ul>
          </Card>
          <Card>
            <div style={{ fontSize: 13, fontWeight: 700, color: mk.terracotta, letterSpacing: 0.4 }}>
              CONNECTED MAILBOX INTEGRATIONS
            </div>
            <p style={{ fontSize: 15, color: mk.muted, marginTop: 8 }}>
              Not part of Discovery&rsquo;s search — connected once at the organization level and used
              downstream, for example to track submission confirmations after AutoApply.
            </p>
            <ul style={{ marginTop: 12, paddingLeft: 18, color: mk.ink, fontSize: 15, lineHeight: 1.8 }}>
              <li><strong>Gmail</strong> — OAuth-connected mailbox sync</li>
              <li><strong>Zoho Mail</strong> — OAuth-connected mailbox, alternate to Gmail</li>
            </ul>
          </Card>
        </div>
      </Section>

      {/* 10: security and reliability */}
      <Section tone="tint">
        <Display2>Security and reliability</Display2>
        <div style={{ maxWidth: 680 }}>
          <p style={{ color: mk.ink, fontSize: 16, lineHeight: 1.7 }}>
            Every research query is scoped to your organization, every sweep is logged to an auditable run
            history, and consensus validation is explicit about what it can and can&rsquo;t verify rather
            than guessing. For the platform-wide security and governance model — including how approval
            gates work elsewhere in the platform — see the Trust and Governance page.
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
            We don&rsquo;t have a published customer story for Discovery yet. Once an organization has run it
            through a real grant cycle and agreed to be named, their story will go here — not a composite or
            hypothetical example.
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
              Not ready to connect your data yet?
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
          <Display2 tone="forest">Find My Best Fit Opportunities</Display2>
          <p style={{ color: mk.heroMuted, fontSize: 17, marginTop: 16, maxWidth: 560, marginLeft: "auto", marginRight: "auto" }}>
            Set up a search profile and let eight research lanes start checking government, foundation, and
            corporate sources for you.
          </p>
          <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 28, flexWrap: "wrap" }}>
            <CtaPrimary href="/register">Find My Best Fit Opportunities</CtaPrimary>
            <CtaGhost href="/demo" onDark>
              Book a demo instead
            </CtaGhost>
          </div>
        </div>
      </Section>
    </>
  );
}
