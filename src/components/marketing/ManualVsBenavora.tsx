import { BotanicalMotif } from "@/components/marketing/BotanicalMotif";
import { mkGrainBackground, SectionDividerDef } from "@/lib/marketing/texture";

// "Manual vs. Benavora" — the flagship side-by-side transformation contrast.
// Same dark forest canvas as the surrounding homepage sections (bm- prefixed
// classes, #222624 background, #3b403b divider — see page.tsx bm-identity/
// bm-outcome, WhatItReplaces.tsx, CanIControlIt.tsx). Deliberately a distinct
// layout from WhatItReplaces.tsx's single-column strikethrough list: this is
// a two-column, center-spine comparison so "manual" and "Benavora" read as
// genuinely parallel columns, not a repeated card grid or an HTML table.
//
// Every "becomes" claim is grounded in a real, verified mechanism, not
// invented copy:
// - Discovery: nav.ts PLATFORM "Opportunity Discovery" blurb + page.tsx
//   bm-outcome copy ("Discovery consolidates federal, foundation, and
//   corporate sources into one feed and removes duplicates").
// - Prequalification: nav.ts "Funding Intelligence" blurb ("Reads the NOFO,
//   scores eligibility") + WillItUnderstandMyOrg.tsx's citation of
//   eligibility-scoring-agent.ts reading mission_statement/tax_status/
//   service_area/target_population/annual_budget before drafting starts.
// - Narrative intelligence: nav.ts "AI Grant Writer" blurb ("Drafts from
//   your knowledge base with source citations") + WillItUnderstandMyOrg.tsx's
//   citation of the organizations.outcomes.narrative_snapshot ->
//   proven_narratives pipeline (real migration-backed tables, not a
//   collected-at-signup claim).
// - Pipeline/escalation: nav.ts "Pipeline and CRM" blurb ("Every prospect,
//   stage and deadline in one place") + src/lib/alerts/alerts-service.ts
//   (DEADLINE_WINDOW_DAYS = 7, deadlineSeverity()) — a real alert fires once
//   a deadline enters its window, not a claim about a specific escalation
//   workflow beyond that.
// - Governed browser assistance: nav.ts "AutoApply" blurb ("Fills and
//   submits portals under human approval") + CanIControlIt.tsx's citation of
//   risk-engine.ts/queue-processor.ts — CAPTCHA, high/critical risk, and
//   missing portal credentials always pause for a person; low/medium-risk
//   submissions proceed without waiting on one, so "governed" (not "every
//   submission is approved by a human") is the accurate framing.
// - Funding memory: the same proven_narratives + onboarding profile data
//   (organization, programs, documents) cited above — one shared knowledge
//   base the whole team draws from, not a claim about a feature literally
//   named "funding memory".
const ROWS: { was: string; becomes: string; detail: string }[] = [
  {
    was: "Search across disconnected websites",
    becomes: "Continuous multi-source discovery",
    detail: "Opportunity Discovery pulls federal, foundation, and corporate sources into one deduplicated feed.",
  },
  {
    was: "Read every opportunity manually",
    becomes: "Eligibility and fit prequalification",
    detail: "Funding Intelligence reads the notice and scores eligibility against your organization profile before a draft ever starts.",
  },
  {
    was: "Recreate narratives repeatedly",
    becomes: "Institutional narrative intelligence",
    detail: "AI Grant Writer drafts from your knowledge base with source citations, and tracked outcomes feed back into a library of proven narratives.",
  },
  {
    was: "Track deadlines in spreadsheets",
    becomes: "Automated pipeline and escalation",
    detail: "Pipeline and CRM keeps every prospect, stage, and deadline in one place, and an alert fires on its own once a deadline enters its window.",
  },
  {
    was: "Fill repetitive web forms",
    becomes: "Governed browser assistance",
    detail: "AutoApply fills funder portals from an approved draft. CAPTCHA challenges, high-risk submissions, and missing credentials always pause for a person.",
  },
  {
    was: "Lose organizational knowledge",
    becomes: "Reusable funding memory",
    detail: "Organization details, program data, and proven narrative language live in one shared knowledge base, not one person's inbox.",
  },
];

export function ManualVsBenavora() {
  return (
    <section
      className="bm-contrast"
      aria-labelledby="contrast-title"
      style={{ position: "relative", ...mkGrainBackground("#222624", true) }}
    >
      <BotanicalMotif
        variant="branches"
        color="#efb344"
        opacity={0.09}
        style={{ left: -20, bottom: -20, width: 220, height: 220 }}
      />
      <p className="bm-eyebrow">The manual way, and the Benavora way</p>
      <h2 id="contrast-title">
        Six things fundraising teams do by hand.
        <br />
        None of them need to be manual anymore.
      </h2>
      <div className="bm-contrast-cols" aria-hidden="true">
        <span className="bm-col-label bm-col-label--was">The manual way</span>
        <span className="bm-col-label bm-col-label--now">With Benavora</span>
      </div>
      <ol className="bm-contrast-rows">
        {ROWS.map((row, i) => (
          <li key={row.becomes} className={i % 2 === 1 ? "bm-row bm-row--alt" : "bm-row"}>
            <p className="bm-row-was">{row.was}</p>
            <span className="bm-row-arrow" aria-hidden="true">
              &rarr;
            </span>
            <div className="bm-row-now">
              <strong>{row.becomes}</strong>
              <p>{row.detail}</p>
            </div>
          </li>
        ))}
      </ol>
      <SectionDividerDef variant="arc" fill="#222624" />
      <style jsx>{`
        .bm-contrast {
          max-width: 1120px;
          margin: 0 auto;
          padding: 64px 32px 72px;
          border-top: 1px solid #3b403b;
        }
        .bm-eyebrow {
          font-size: 14px;
          font-weight: 600;
          letter-spacing: 0.02em;
          color: #b9cbbd;
          text-align: center;
        }
        .bm-contrast h2 {
          font-size: clamp(28px, 3vw, 38px);
          line-height: 1.25;
          letter-spacing: -0.02em;
          font-weight: 550;
          color: #f0f2ee;
          max-width: 760px;
          margin: 18px auto 0;
          text-align: center;
        }
        .bm-contrast-cols {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 40px minmax(0, 1.35fr);
          max-width: 900px;
          margin: 48px auto 0;
          padding: 0 0 14px;
        }
        .bm-col-label {
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .bm-col-label--was {
          color: #7d8580;
        }
        .bm-col-label--now {
          color: #efb344;
          grid-column: 3;
        }
        .bm-contrast-rows {
          list-style: none;
          margin: 0 auto;
          padding: 0;
          max-width: 900px;
        }
        .bm-row {
          position: relative;
          display: grid;
          grid-template-columns: minmax(0, 1fr) 40px minmax(0, 1.35fr);
          align-items: start;
          gap: 4px 4px;
          padding: 26px 0;
          border-top: 1px solid #3b403b;
        }
        .bm-contrast-rows li:last-child {
          border-bottom: 1px solid #3b403b;
        }
        .bm-row--alt {
          background: rgba(255, 255, 255, 0.015);
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.35), 0 6px 16px -6px rgba(0, 0, 0, 0.45),
            inset 0 1px 0 rgba(255, 255, 255, 0.06);
        }
        .bm-row::before {
          content: "";
          position: absolute;
          left: calc(100% * (1 / 2.35) - 0.5px);
          top: 0;
          bottom: 0;
          width: 1px;
          background: #3b403b;
        }
        .bm-row:first-child::before {
          top: -1px;
        }
        .bm-row-was {
          margin: 0;
          padding-right: 20px;
          color: #8b938c;
          font-style: italic;
          font-size: 15px;
          line-height: 1.6;
          text-align: right;
        }
        .bm-row-arrow {
          display: flex;
          align-items: flex-start;
          justify-content: center;
          padding-top: 1px;
          font-size: 17px;
          color: #efb344;
        }
        .bm-row--alt .bm-row-arrow {
          color: #a7bc9f;
        }
        .bm-row-now {
          padding-left: 20px;
        }
        .bm-row-now strong {
          display: block;
          color: #f2f5ef;
          font-size: 17px;
          font-weight: 600;
          letter-spacing: -0.01em;
          margin-bottom: 8px;
        }
        .bm-row-now p {
          margin: 0;
          color: #bdc4be;
          font-size: 14px;
          line-height: 1.7;
        }
        @media (max-width: 720px) {
          .bm-contrast {
            padding: 44px 24px 52px;
          }
          .bm-contrast-cols {
            display: none;
          }
          .bm-row {
            grid-template-columns: 1fr;
            gap: 10px;
            padding: 20px 0;
          }
          .bm-row::before {
            display: none;
          }
          .bm-row-was {
            text-align: left;
            padding-right: 0;
          }
          .bm-row-arrow {
            justify-content: flex-start;
            transform: rotate(90deg);
            padding-top: 0;
          }
          .bm-row-now {
            padding-left: 0;
          }
        }
      `}</style>
    </section>
  );
}
