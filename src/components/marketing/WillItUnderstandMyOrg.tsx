import Link from "next/link";

// "Will it understand my organization?" — answers the personalization
// objection with the real first-login setup flow (OnboardingWizard,
// src/components/onboarding/OnboardingWizard.tsx + src/lib/onboarding.ts),
// on the same dark forest canvas as the surrounding homepage sections
// (bm- prefixed classes, #222624 background, #3b403b divider — see
// page.tsx bm-identity/bm-outcome, WhatItReplaces.tsx, CanISeeIt.tsx).
//
// Field and step names below are pulled from the real wizard components, not
// invented: OrgProfileStep.tsx (mission_statement, tax_status,
// target_population, service_area), ProgramsStep.tsx (name, description,
// budget, beneficiaries_served), DocumentsStep.tsx/DocumentUploader.tsx
// (document_category enum incl. program_documents, marketing_materials,
// application_attachments, letters_of_support), and SearchProfileStep.tsx
// (keywords, categories, geographic_scope on the search_profiles table).
// eligibility-scoring-agent.ts confirms mission_statement/tax_status/
// service_area/target_population/annual_budget are the exact columns the
// eligibility scoring pass reads — so "Organization" step data is not
// decorative, it is a live scoring input.
//
// The closing line describes the outcomes -> proven_narratives loop
// (organizations.outcomes.narrative_snapshot feeding proven_narratives,
// migration-backed tables in src/types/database.ts) as something that
// deepens with use, rather than claiming it is collected at onboarding —
// that pipeline is populated by tracked application outcomes, not a signup
// field.
const STEPS: { step: string; captures: string; enables: string }[] = [
  {
    step: "Organization",
    captures:
      "Legal name, EIN, tax status, mission and vision statements, target population, and service area.",
    enables:
      "The exact fields the eligibility scoring pass checks against every notice, before a draft ever starts.",
  },
  {
    step: "Programs",
    captures:
      "Each program you run, with a description, budget, and how many people it serves.",
    enables:
      "Draft language grounded in what you actually do, not a generic program category.",
  },
  {
    step: "Documents",
    captures:
      "Your 501(c)(3) letter and W-9, plus whatever else you choose to attach — past proposals, board materials, marketing collateral.",
    enables:
      "AI Grant Studio drafting from what your organization has already written, instead of a blank page.",
  },
  {
    step: "Grant search",
    captures: "Keywords, funder categories to focus on, and a geographic scope.",
    enables:
      "Research agents that hunt for funding matching your actual reach, not everything containing your keyword.",
  },
];

export function WillItUnderstandMyOrg() {
  return (
    <section className="bm-understand" aria-labelledby="understand-title">
      <p className="bm-eyebrow">Will it understand my organization?</p>
      <h2 id="understand-title">
        It learns your organization the way
        <br />a new hire would — by asking.
      </h2>
      <p className="bm-understand-lede">
        Before Benavora drafts anything, your organization goes through a real setup flow, not a form that gets
        ignored after signup. Four steps, each one feeding a real part of the system.
      </p>

      <ul className="bm-understand-list">
        {STEPS.map((s) => (
          <li key={s.step}>
            <span className="bm-step">{s.step}</span>
            <span className="bm-body">
              <span className="bm-captures">{s.captures}</span>
              <span className="bm-enables">{s.enables}</span>
            </span>
          </li>
        ))}
      </ul>

      <p className="bm-understand-closer">
        And it keeps learning after setup. As applications move through Benavora and real outcomes come back
        &mdash; awarded, declined, funder feedback &mdash; that record feeds back into your knowledge base, so later
        drafts build on language that has actually worked for your organization, not just what was entered on day
        one.
      </p>

      <div className="bm-cta-wrap">
        <Link
          href="/how-it-works"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 12,
            borderRadius: 8,
            padding: "15px 25px",
            fontSize: 14,
            fontWeight: 600,
            color: "#f5f7f2",
            background: "#405b49",
            border: "1px solid #77927e",
            boxShadow: "0 4px 14px rgba(0, 0, 0, 0.125)",
            textDecoration: "none",
            transition: "background 0.2s, border-color 0.2s",
          }}
        >
          See the full setup flow <span aria-hidden="true">&rarr;</span>
        </Link>
      </div>

      <style jsx>{`
        .bm-understand {
          max-width: 1120px;
          margin: 0 auto;
          text-align: center;
          padding: 64px 32px 72px;
          background: #222624;
          border-top: 1px solid #3b403b;
        }
        .bm-eyebrow {
          font-size: 14px;
          font-weight: 600;
          letter-spacing: 0.02em;
          color: #b9cbbd;
        }
        .bm-understand h2 {
          font-size: clamp(28px, 3vw, 38px);
          line-height: 1.25;
          letter-spacing: -0.02em;
          font-weight: 550;
          color: #f0f2ee;
          max-width: 820px;
          margin: 18px auto 0;
        }
        .bm-understand-lede {
          color: #bdc4be;
          max-width: 660px;
          margin: 20px auto 0;
          font-size: 16px;
          line-height: 1.8;
        }
        .bm-understand-list {
          list-style: none;
          margin: 40px auto 0;
          padding: 0;
          max-width: 860px;
          text-align: left;
          display: flex;
          flex-direction: column;
        }
        .bm-understand-list li {
          display: flex;
          align-items: flex-start;
          gap: 24px;
          padding: 22px 0;
          border-top: 1px solid #3b403b;
        }
        .bm-understand-list li:last-child {
          border-bottom: 1px solid #3b403b;
        }
        .bm-step {
          flex: 0 0 auto;
          width: 140px;
          color: #efb344;
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.03em;
          text-transform: uppercase;
          padding-top: 2px;
        }
        .bm-body {
          flex: 1 1 auto;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .bm-captures {
          color: #f2f5ef;
          font-size: 15px;
          line-height: 1.6;
        }
        .bm-enables {
          color: #9aa39c;
          font-size: 14px;
          line-height: 1.6;
        }
        .bm-understand-closer {
          color: #bdc4be;
          max-width: 720px;
          margin: 36px auto 0;
          font-size: 15px;
          line-height: 1.8;
        }
        .bm-cta-wrap {
          margin-top: 28px;
        }
        @media (max-width: 720px) {
          .bm-understand {
            padding: 44px 24px 52px;
          }
          .bm-understand-lede,
          .bm-understand-closer {
            font-size: 15px;
          }
          .bm-understand-list li {
            flex-direction: column;
            gap: 8px;
            padding: 18px 0;
          }
          .bm-step {
            width: auto;
          }
        }
      `}</style>
    </section>
  );
}
