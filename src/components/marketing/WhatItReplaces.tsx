import { BotanicalMotif } from "@/components/marketing/BotanicalMotif";
import { mkGrainBackground, SectionDividerDef } from "@/lib/marketing/texture";

// "What does it replace" — names the specific manual workaround each platform
// capability removes, on the same dark forest canvas as the surrounding
// homepage sections (bm- prefixed classes, #222624 background, #3b403b
// divider — see page.tsx bm-identity/bm-outcome and CanISeeIt.tsx). Capability
// names and one-line descriptions are pulled verbatim from
// src/lib/marketing/nav.ts (PLATFORM.items) and FundraisingToolkit.tsx
// (Inbox Intelligence), not invented for this section.
const REPLACEMENTS: { was: string; nowTag: string; nowBody: string }[] = [
  {
    was: "A spreadsheet for tracking deadlines",
    nowTag: "Pipeline and CRM",
    nowBody: "Every prospect, stage, and deadline in one place.",
  },
  {
    was: "Research spread across a dozen browser tabs",
    nowTag: "Opportunity Discovery",
    nowBody: "Foundation, corporate, and government sources in one feed.",
  },
  {
    was: "Retyping the same answers into every funder portal",
    nowTag: "AutoApply",
    nowBody: "Fills and submits portals under human approval.",
  },
  {
    was: "Narrative drafts scattered across Google Docs",
    nowTag: "AI Grant Writer",
    nowBody: "Drafts from your knowledge base, with source citations.",
  },
  {
    was: "An inbox you have to remember to check for replies",
    nowTag: "Inbox Intelligence",
    nowBody: "Parses incoming mail to surface donor replies and follow-up needs.",
  },
];

export function WhatItReplaces() {
  return (
    <section
      className="bm-replaces"
      aria-labelledby="replaces-title"
      style={{ position: "relative", ...mkGrainBackground("#222624", true) }}
    >
      <BotanicalMotif
        variant="corner-roots"
        color="#3b403b"
        opacity={0.09}
        style={{ right: 0, bottom: 0, width: 200, height: 200, transform: "scale(-1, -1)" }}
      />
      <p className="bm-eyebrow">What does it replace</p>
      <h2 id="replaces-title">
        The manual workarounds your team built
        <br />
        because nothing else did the job.
      </h2>
      <p className="bm-replaces-lede">
        Benavora is not another tab to keep open. It replaces specific manual tasks with a system built to do them.
      </p>
      <ul className="bm-replaces-list">
        {REPLACEMENTS.map((r) => (
          <li key={r.nowTag}>
            <span className="bm-was">{r.was}</span>
            <span className="bm-arrow" aria-hidden="true">
              &rarr;
            </span>
            <span className="bm-now">
              <strong>{r.nowTag}</strong> &mdash; {r.nowBody}
            </span>
          </li>
        ))}
      </ul>
      <SectionDividerDef variant="blob" fill="#222624" />
      <style jsx>{`
        .bm-replaces {
          max-width: 1120px;
          margin: 0 auto;
          text-align: center;
          padding: 64px 32px 72px;
          border-top: 1px solid #3b403b;
        }
        .bm-eyebrow {
          font-size: 14px;
          font-weight: 600;
          letter-spacing: 0.02em;
          color: #b9cbbd;
        }
        .bm-replaces h2 {
          font-size: clamp(28px, 3vw, 38px);
          line-height: 1.25;
          letter-spacing: -0.02em;
          font-weight: 550;
          color: #f0f2ee;
          max-width: 820px;
          margin: 18px auto 0;
        }
        .bm-replaces-lede {
          color: #bdc4be;
          max-width: 640px;
          margin: 20px auto 0;
          font-size: 16px;
          line-height: 1.8;
        }
        .bm-replaces-list {
          list-style: none;
          margin: 40px auto 0;
          padding: 0;
          max-width: 820px;
          text-align: left;
          display: flex;
          flex-direction: column;
        }
        .bm-replaces-list li {
          display: flex;
          align-items: baseline;
          gap: 16px;
          padding: 18px 0;
          border-top: 1px solid #3b403b;
        }
        .bm-replaces-list li:last-child {
          border-bottom: 1px solid #3b403b;
        }
        .bm-was {
          flex: 0 0 auto;
          width: 300px;
          color: #8b938c;
          font-size: 14px;
          line-height: 1.5;
          text-decoration: line-through;
          text-decoration-color: #5a615c;
        }
        .bm-arrow {
          flex: 0 0 auto;
          color: #efb344;
          font-size: 16px;
        }
        .bm-now {
          flex: 1 1 auto;
          color: #c7cec8;
          font-size: 15px;
          line-height: 1.6;
        }
        .bm-now strong {
          color: #f2f5ef;
          font-weight: 600;
        }
        @media (max-width: 720px) {
          .bm-replaces {
            padding: 44px 24px 52px;
          }
          .bm-replaces-lede {
            font-size: 15px;
          }
          .bm-replaces-list li {
            flex-direction: column;
            gap: 6px;
            padding: 16px 0;
          }
          .bm-was {
            width: auto;
          }
          .bm-arrow {
            display: none;
          }
        }
      `}</style>
    </section>
  );
}
