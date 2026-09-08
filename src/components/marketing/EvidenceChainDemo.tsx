"use client";

import { useState } from "react";

import { mk, mkRadius } from "@/lib/marketing/theme";
import { humanizeEnum } from "@/lib/utils/formatters";
import type { KnowledgeSource } from "@/types/ai";

// Illustrative example only — not a real client's Knowledge Base entry or
// draft. The shapes and formatting below are not invented for this widget;
// they are copied from the real pipeline so the walkthrough is honest about
// the mechanism, even though the content is a stand-in:
//   - KB_ENTRY mirrors the `knowledge_base` table row shape (id, title,
//     category, content — supabase/migrations/001_initial_schema.sql).
//   - PROMPT_BLOCK reuses the literal template string from
//     renderKnowledgeEntries() in src/lib/ai/prompts/grant-narrative.ts
//     (`### ${title} (${humanizeEnum(category)})\n${content}`), including the
//     real humanizeEnum() formatter.
//   - CITATION mirrors the KnowledgeSource object the draft generator builds
//     at src/lib/drafts/generator.ts (~L932-936) and persists to
//     draft_versions.knowledge_sources — the same shape KnowledgePreview.tsx
//     renders back to a user after a real draft.
const KB_ENTRY = {
  id: "kb_8f2c1a90",
  title: "Program Description: Weekend Youth Tutoring",
  category: "program_description" as const,
  content:
    "We run a twice-weekly, volunteer-staffed reading and math tutoring program for K-8 students at three Title I elementary schools in our service area. In the 2025-26 school year the program served 140 students across 12 volunteer tutors, with 78% of participants showing a measured grade-level reading gain by the spring assessment.",
};

const PROMPT_BLOCK = `### ${KB_ENTRY.title} (${humanizeEnum(KB_ENTRY.category)})\n${KB_ENTRY.content}`;

const DRAFT_BEFORE = "Our ";
const DRAFT_HIGHLIGHT =
  "Weekend Youth Tutoring program already serves 140 K-8 students across three Title I schools, with 78% of last year's participants showing a measured grade-level reading gain";
const DRAFT_AFTER =
  " by the spring assessment — capacity this grant would let us double.";

const CITATION: KnowledgeSource = {
  id: KB_ENTRY.id,
  kind: "knowledge_base",
  title: KB_ENTRY.title,
};

type StageProps = {
  index: number;
  revealed: boolean;
  label: string;
  eyebrow: string;
  children: React.ReactNode;
};

function Stage({ index, revealed, label, eyebrow, children }: StageProps) {
  return (
    <div
      className="ecd-stage"
      style={{
        transitionDelay: revealed ? `${index * 140}ms` : "0ms",
      }}
    >
      <div className="ecd-stage-head">
        <span className="ecd-stage-num">{index + 1}</span>
        <div>
          <p className="ecd-stage-eyebrow">{eyebrow}</p>
          <p className="ecd-stage-label">{label}</p>
        </div>
      </div>
      <div className="ecd-stage-body">{children}</div>

      <style jsx>{`
        .ecd-stage {
          opacity: ${revealed ? 1 : 0};
          transform: translateY(${revealed ? 0 : 10}px);
          transition: opacity 0.35s ease, transform 0.35s ease;
          border: 1px solid ${mk.line};
          border-radius: ${mkRadius.card}px;
          background: ${mk.surface};
          padding: 18px 20px;
        }
        .ecd-stage-head {
          display: flex;
          align-items: flex-start;
          gap: 12px;
        }
        .ecd-stage-num {
          flex-shrink: 0;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 26px;
          height: 26px;
          border-radius: 50%;
          background: ${mk.forest};
          color: ${mk.heroText};
          font-size: 13px;
          font-weight: 600;
        }
        .ecd-stage-eyebrow {
          margin: 0;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: ${mk.sage};
        }
        .ecd-stage-label {
          margin: 2px 0 0;
          font-size: 15px;
          font-weight: 600;
          color: ${mk.ink};
        }
        .ecd-stage-body {
          margin-top: 12px;
        }
      `}</style>
    </div>
  );
}

function Connector({ revealed, delayMs }: { revealed: boolean; delayMs: number }) {
  return (
    <div
      aria-hidden="true"
      style={{
        display: "flex",
        justifyContent: "center",
        opacity: revealed ? 1 : 0,
        transition: `opacity 0.3s ease ${revealed ? delayMs : 0}ms`,
      }}
    >
      <svg width="16" height="22" viewBox="0 0 16 22" fill="none">
        <path
          d="M8 0V16M8 16L2 10M8 16L14 10"
          stroke={mk.sage}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

/**
 * Click-to-reveal evidence chain: a Knowledge Base entry, the exact text
 * block the draft generator hands the model, and the citation that lands in
 * the generated draft. Backs the "every draft cites its source" claim on
 * /trust with the real mechanism instead of an unverifiable assertion.
 */
export function EvidenceChainDemo() {
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="ecd-wrap">
      <button
        type="button"
        className="ecd-toggle"
        aria-expanded={revealed}
        onClick={() => setRevealed((v) => !v)}
      >
        <span>&ldquo;Every draft cites its source&rdquo; — see the evidence chain</span>
        <span className="ecd-toggle-icon" aria-hidden="true">
          {revealed ? "−" : "+"}
        </span>
      </button>

      {revealed ? (
        <div className="ecd-panel">
          <p className="ecd-disclosure">
            Illustrative example below — a stand-in organization and draft, not a real
            client&rsquo;s Knowledge Base or proposal. The data shapes and formatting are the
            real ones your account uses.
          </p>

          <Stage index={0} revealed={revealed} eyebrow="Step 1 · In your Knowledge Base" label="A verified organizational fact">
            <div className="ecd-kb-card">
              <div className="ecd-kb-meta">
                <span className="ecd-kb-badge">{humanizeEnum(KB_ENTRY.category)}</span>
                <span className="ecd-kb-id">id: {KB_ENTRY.id}</span>
              </div>
              <p className="ecd-kb-title">{KB_ENTRY.title}</p>
              <p className="ecd-kb-content">{KB_ENTRY.content}</p>
            </div>
          </Stage>

          <Connector revealed={revealed} delayMs={140} />

          <Stage
            index={1}
            revealed={revealed}
            eyebrow="Step 2 · Handed to the model, verbatim"
            label="Included in the draft's grounding data"
          >
            <pre className="ecd-code">{PROMPT_BLOCK}</pre>
            <p className="ecd-note">
              This is the same template Benavora&rsquo;s draft generator uses to pass a Knowledge
              Base entry to the model — the entry&rsquo;s own title, category, and content, not a
              paraphrase. The model is instructed to flag anything it needs that isn&rsquo;t here as{" "}
              <code>[NEEDS INPUT]</code> rather than invent it.
            </p>
          </Stage>

          <Connector revealed={revealed} delayMs={280} />

          <Stage
            index={2}
            revealed={revealed}
            eyebrow="Step 3 · In the generated draft"
            label="The fact appears, with its citation"
          >
            <p className="ecd-draft-excerpt">
              &ldquo;{DRAFT_BEFORE}
              <mark className="ecd-mark">{DRAFT_HIGHLIGHT}</mark>
              {DRAFT_AFTER}&rdquo;
            </p>
            <div className="ecd-citation-row">
              <span className="ecd-citation-dot" aria-hidden="true" />
              <span className="ecd-citation-text">{CITATION.title}</span>
            </div>
            <p className="ecd-note">
              That citation is saved alongside the draft (not just displayed once) — the exact
              record shown to whoever reviews it:
            </p>
            <pre className="ecd-code ecd-code-small">{JSON.stringify(CITATION, null, 2)}</pre>
          </Stage>
        </div>
      ) : null}

      <style jsx>{`
        .ecd-wrap {
          margin: 28px 0;
          max-width: 100%;
        }
        .ecd-toggle {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          width: 100%;
          text-align: left;
          padding: 16px 20px;
          border-radius: ${mkRadius.card}px;
          border: 1px solid ${mk.line};
          background: ${mk.tint};
          color: ${mk.forest};
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.15s ease, border-color 0.15s ease;
        }
        .ecd-toggle:hover {
          background: #dfe7dc;
          border-color: ${mk.sage};
        }
        .ecd-toggle-icon {
          flex-shrink: 0;
          font-size: 18px;
          line-height: 1;
        }
        .ecd-panel {
          display: flex;
          flex-direction: column;
          gap: 4px;
          margin-top: 16px;
        }
        .ecd-disclosure {
          font-size: 13px;
          color: ${mk.muted};
          font-style: italic;
          margin: 0 0 8px;
        }
        .ecd-kb-card {
          border: 1px dashed ${mk.line};
          border-radius: 8px;
          padding: 12px 14px;
          background: ${mk.paper};
        }
        .ecd-kb-meta {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 6px;
        }
        .ecd-kb-badge {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.03em;
          text-transform: uppercase;
          color: ${mk.terracotta};
        }
        .ecd-kb-id {
          font-size: 11px;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          color: ${mk.muted};
        }
        .ecd-kb-title {
          margin: 0 0 6px;
          font-size: 14px;
          font-weight: 600;
          color: ${mk.ink};
        }
        .ecd-kb-content {
          margin: 0;
          font-size: 13px;
          line-height: 1.6;
          color: ${mk.muted};
        }
        .ecd-code {
          margin: 0 0 10px;
          padding: 12px 14px;
          border-radius: 8px;
          background: #1c2620;
          color: #d9e6dc;
          font-size: 12.5px;
          line-height: 1.6;
          white-space: pre-wrap;
          overflow-x: auto;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        }
        .ecd-code-small {
          margin-bottom: 0;
          font-size: 12px;
        }
        .ecd-note {
          margin: 0;
          font-size: 13px;
          line-height: 1.6;
          color: ${mk.muted};
        }
        .ecd-draft-excerpt {
          margin: 0 0 12px;
          font-size: 14px;
          line-height: 1.7;
          color: ${mk.ink};
        }
        .ecd-mark {
          background: #f4e2c8;
          color: ${mk.ink};
          padding: 0 2px;
          border-radius: 3px;
        }
        .ecd-citation-row {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 10px;
        }
        .ecd-citation-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: ${mk.sage};
          flex-shrink: 0;
        }
        .ecd-citation-text {
          font-size: 13px;
          font-weight: 600;
          color: ${mk.forest};
        }
      `}</style>
    </div>
  );
}
