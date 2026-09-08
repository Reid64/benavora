"use client";

import type { CSSProperties, SyntheticEvent } from "react";
import { OPEN_DIVISION_EVENT } from "@/components/marketing/NeuralFleetVisualization";
import { BotanicalMotif } from "@/components/marketing/BotanicalMotif";
import { mkGrainBackground, SectionDividerDef } from "@/lib/marketing/texture";

type ToneVars = CSSProperties & { "--tone": string };

// Index of the Auto Apply division inside NeuralFleetVisualization.FAMILIES.
// Kept in sync manually; the two components communicate only through
// OPEN_DIVISION_EVENT so neither needs to import the other's internals.
const AUTO_APPLY_DIVISION_INDEX = 8;

const PROOF_POINTS: { heading: [string, string]; body: string }[] = [
  {
    heading: ["More than answers.", "Forward progress."],
    body: "Agents plan, execute, evaluate results, and adapt their next steps.",
  },
  {
    heading: ["From discovery", "to application."],
    body: "Programmatic workflows connect research, qualification, preparation, and authorized submission.",
  },
  {
    heading: ["Your mission.", "Your control."],
    body: "Defined permissions and review checkpoints govern consequential actions.",
  },
];

type Feature = {
  tag: string;
  benefit: string;
  body: string;
  summary: string;
  detailsBody: string;
  tone: string;
  wide?: boolean;
  isAutoApply?: boolean;
};

const FEATURES: Feature[] = [
  {
    tag: "AI Grant Studio",
    benefit: "Your mission. Your voice.",
    body: "Draft stronger applications with your organization’s information and a library of successful past grant narratives. Humanize the language so every draft sounds natural and reflects your mission.",
    summary: "Explore AI Grant Studio",
    detailsBody:
      "Use successful narratives as reference material, then adapt the structure and language to your own verified facts. Review and refine the draft before submission.",
    tone: "#75e6c0",
    wide: true,
  },
  {
    tag: "Funding Fit & Success Scoring",
    benefit: "Find your strongest opportunities.",
    body: "Focus your effort with estimated success likelihood scoring informed by eligibility, mission alignment, and available funding intelligence.",
    summary: "Explore Funding Fit & Success Scoring",
    detailsBody:
      "Use scores to compare opportunities and prioritize your next application. Estimates guide decisions; they do not guarantee an award.",
    tone: "#ffe66d",
  },
  {
    tag: "Auto Apply",
    benefit: "From opportunity to application.",
    body: "Three specialist agents coordinate eight capabilities—from portal navigation and form completion to independent review and confirmation tracking. Human authorization is requested when required.",
    summary: "Explore Auto Apply",
    detailsBody:
      "Application planning · Portal navigation · Account and access · Intelligent form completion · Document preparation · Exception recovery · Submission review · Confirmation and tracking.",
    tone: "#91f28c",
    isAutoApply: true,
  },
  {
    tag: "Email Campaigns",
    benefit: "Make every introduction personal.",
    body: "Create personalized mail merge campaigns that connect your mission with the donors and organizations you want to reach.",
    summary: "Explore Email Campaigns",
    detailsBody:
      "Bring prospect information into tailored outreach, making it easier to communicate relevant needs and opportunities at scale.",
    tone: "#b565ff",
  },
  {
    tag: "Inbox Intelligence",
    benefit: "Turn responses into next steps.",
    body: "Parse incoming mail to surface donor replies, application updates, and follow-up needs.",
    summary: "Explore Inbox Intelligence",
    detailsBody:
      "Bring useful information out of the inbox and into your fundraising workflow, so the next action is easier to identify.",
    tone: "#36c9ff",
  },
  {
    tag: "Custom Donor Discovery",
    benefit: "Search beyond the obvious.",
    body: "Discover prospective donors and organizations through targeted web scraping by keyword, industry, and cause.",
    summary: "Explore Custom Donor Discovery",
    detailsBody:
      "Define the types of organizations you want to reach and use focused searches to build a more relevant prospect pool.",
    tone: "#ff9f43",
  },
  {
    tag: "Enriched Funding Databases",
    benefit: "Start with a richer picture.",
    body: "Explore enriched foundation and nonprofit records to research funders, identify partners, and prioritize outreach.",
    summary: "Explore Enriched Funding Databases",
    detailsBody:
      "Combine organizational context with funding intelligence to understand who may align with your work before you make an approach.",
    tone: "#ff4fc8",
  },
  {
    tag: "Google Setup Guides",
    benefit: "Build your digital foundation.",
    body: "Follow step-by-step guides for Google for Nonprofits and Google Business Profile, including eligibility considerations.",
    summary: "Explore Google Setup Guides",
    detailsBody:
      "Get structured guidance through the setup process and understand which program requirements apply to your organization.",
    tone: "#21e6e6",
  },
];

function handleAutoApplyToggle(e: SyntheticEvent<HTMLDetailsElement>) {
  if (!e.currentTarget.open) return;
  window.dispatchEvent(
    new CustomEvent(OPEN_DIVISION_EVENT, { detail: { index: AUTO_APPLY_DIVISION_INDEX } })
  );
}

export function FundraisingToolkit() {
  return (
    <>
      <section
        className="bm-autonomy-benefits"
        aria-label="How autonomous fundraising works"
        style={mkGrainBackground("#222624", true)}
      >
        {PROOF_POINTS.map((p) => (
          <article key={p.heading.join(" ")}>
            <h3>
              {p.heading[0]}
              <br />
              {p.heading[1]}
            </h3>
            <p>{p.body}</p>
          </article>
        ))}
      </section>

      <section
        id="fundraising-toolkit"
        className="bm-toolkit"
        style={{ position: "relative", ...mkGrainBackground("#222624", true) }}
      >
        <BotanicalMotif
          variant="roots"
          color="#efb344"
          opacity={0.08}
          style={{ right: -20, top: -10, width: 230, height: 230 }}
        />
        <div className="bm-eyebrow">Your fundraising toolkit</div>
        <h2>
          More time for the mission.
          <br />
          More intelligence behind every move.
        </h2>
        <p className="bm-intro">
          Less repetitive work. More relevant opportunities. Connected tools to help you research funders, tell your
          story, and follow through with confidence.
        </p>
        <div className="bm-grid">
          {FEATURES.map((f) => (
            <article key={f.tag} className={`bm-feature${f.wide ? " bm-wide" : ""}`} style={{ "--tone": f.tone } as ToneVars}>
              <h3 className="bm-tag">{f.tag}</h3>
              <p className="bm-feature-benefit">{f.benefit}</p>
              <p>{f.body}</p>
              <details onToggle={f.isAutoApply ? handleAutoApplyToggle : undefined}>
                <summary>{f.summary}</summary>
                <p>{f.detailsBody}</p>
              </details>
            </article>
          ))}
        </div>
        <div className="bm-end">
          <h3>Multiply your team&#8217;s capacity&mdash;not its workload.</h3>
          <p>Discover opportunity. Tell your story. Take the next step with confidence.</p>
          <a className="bm-link" href="#benavora-neural-fleet">
            Explore the 48-agent network <span aria-hidden="true">&uarr;</span>
          </a>
        </div>
        <SectionDividerDef variant="arc" fill="#222624" />
      </section>

      <style jsx>{`
        .bm-autonomy-benefits {
          max-width: 1120px;
          margin: 0 auto;
          padding: 46px 32px 12px;
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 36px;
        }
        .bm-autonomy-benefits article {
          border-top: 2px solid #708778;
          padding-top: 22px;
        }
        .bm-autonomy-benefits h3 {
          font-size: 26px;
          font-weight: 600;
          letter-spacing: -0.02em;
          line-height: 1.3;
          color: #f2f5ef;
          margin-bottom: 14px;
        }
        .bm-autonomy-benefits p {
          color: #c7cec8;
          line-height: 1.8;
          font-size: 15px;
        }

        .bm-toolkit {
          max-width: 1120px;
          margin: 0 auto;
          padding: 90px 32px 76px;
        }
        .bm-eyebrow {
          font-size: 18px;
          font-weight: 600;
          color: #b9cbbd;
        }
        .bm-toolkit h2 {
          font-size: clamp(34px, 3.7vw, 48px);
          line-height: 1.18;
          font-weight: 600;
          letter-spacing: -0.03em;
          color: #f4f0e8;
          margin: 17px 0 20px;
        }
        .bm-intro {
          color: #bdc4be;
          max-width: 680px;
          font-size: 16px;
          line-height: 1.8;
        }
        .bm-grid {
          display: grid;
          grid-template-columns: repeat(6, minmax(0, 1fr));
          gap: 0 30px;
          margin-top: 36px;
        }
        .bm-feature {
          --tone: #b9c2bd;
          grid-column: span 2;
          border-top: 2px solid #6d8273;
          padding-top: 26px;
          padding-bottom: 32px;
        }
        .bm-feature.bm-wide {
          grid-column: span 4;
          background: #354b3d;
          border: 1px solid #728977;
          border-top: 1px solid #728977;
          border-radius: 12px;
          padding: 32px;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4), 0 16px 32px -10px rgba(0, 0, 0, 0.55),
            inset 0 1px 0 rgba(255, 255, 255, 0.08);
        }
        .bm-feature h3.bm-tag {
          font-size: 25px;
          line-height: 1.2;
          font-weight: 650;
          letter-spacing: -0.025em;
          color: #f2f5ef;
          margin: 0 0 12px;
        }
        .bm-feature.bm-wide h3.bm-tag {
          font-size: 32px;
        }
        .bm-feature p.bm-feature-benefit {
          font-size: 18px;
          line-height: 1.4;
          font-weight: 500;
          color: #c4d2c6;
          margin: 0 0 17px;
        }
        .bm-feature.bm-wide p.bm-feature-benefit {
          font-size: 21px;
          color: #edf3e9;
        }
        .bm-feature p {
          color: #bdc4be;
          line-height: 1.8;
          font-size: 15px;
        }
        .bm-feature.bm-wide p {
          color: #e0e8df;
        }
        .bm-feature details {
          margin-top: 19px;
          border-top: 1px solid #3b4038;
          padding-top: 14px;
        }
        .bm-feature.bm-wide details {
          border-color: #68806d;
        }
        .bm-feature summary {
          font-size: 12px;
          color: #c8d5cd;
          cursor: pointer;
        }
        .bm-feature.bm-wide summary {
          color: #edf4e9;
        }
        .bm-feature details p {
          margin-top: 12px;
          font-size: 13px;
        }
        .bm-feature summary:focus-visible {
          outline: 2px solid #c5b28c;
          outline-offset: 5px;
        }

        .bm-end {
          text-align: center;
          border-top: 1px solid #48514a;
          margin-top: 48px;
          padding-top: 48px;
        }
        .bm-end h3 {
          font-size: 28px;
          font-weight: 500;
          color: #f0f2ee;
          max-width: 690px;
          margin: 0 auto 12px;
          line-height: 1.3;
        }
        .bm-end p {
          color: #bdc4be;
          line-height: 1.7;
        }
        .bm-link {
          display: inline-flex;
          align-items: center;
          gap: 12px;
          border-radius: 8px;
          padding: 15px 25px;
          margin-top: 24px;
          font-size: 14px;
          font-weight: 600;
          color: #f5f7f2;
          background: #405b49;
          border: 1px solid #77927e;
          box-shadow: 0 4px 14px rgba(0, 0, 0, 0.125);
          text-decoration: none;
          transition: background 0.2s, border-color 0.2s;
        }
        .bm-link:hover {
          background: #4c6a55;
          border-color: #a0b6a5;
          color: #fff;
        }
        .bm-link:focus-visible {
          outline: 2px solid #bacfbd;
          outline-offset: 5px;
        }

        @media (max-width: 900px) {
          .bm-autonomy-benefits {
            grid-template-columns: 1fr;
            gap: 26px;
            padding-top: 32px;
          }
          .bm-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 0 24px;
          }
          .bm-feature,
          .bm-feature.bm-wide {
            grid-column: span 1;
          }
          .bm-feature.bm-wide h3.bm-tag {
            font-size: 28px;
          }
          .bm-toolkit {
            padding-top: 60px;
          }
        }
        @media (max-width: 640px) {
          .bm-grid {
            grid-template-columns: 1fr;
          }
          .bm-feature.bm-wide {
            padding: 24px;
          }
        }
      `}</style>
    </>
  );
}
