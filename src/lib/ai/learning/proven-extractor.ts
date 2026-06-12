// Proven-narrative extractor — the AI half of the Recursive Learning Agent
// (AGENTS.md Agent 10, steps 2a–2c).
//
// Given the narrative that was actually submitted on an AWARDED (or PARTIAL)
// application, it splits the draft into reusable sections, labels each with a
// Knowledge Base category, and — when a section clearly derives from one of the
// organization's existing KB entries — links it back to that entry's id. The
// agent then upserts proven_narratives and flags the matched KB entries.
//
// This module owns prompt construction and response parsing only; the agent
// calls Claude (callClaude) and persists the results. Per Behavioral Contracts
// §9/§10 the model must quote the submitted draft verbatim and never invent
// content — sections that don't map to a real, reusable passage are dropped.

import { humanizeEnum } from "@/lib/utils/formatters";
import {
  KNOWLEDGE_BASE_CATEGORIES,
  STANDARD_ANSWER_CATEGORY,
} from "@/lib/utils/constants";
import type { Enums } from "@/types/database";

type KnowledgeBaseCategory = Enums<"knowledge_base_category">;

/** Section types the extractor may assign — narrative KB categories only. */
const SECTION_TYPES: readonly KnowledgeBaseCategory[] =
  KNOWLEDGE_BASE_CATEGORIES.filter((c) => c !== STANDARD_ANSWER_CATEGORY);

/** A candidate KB entry the extractor can attribute a section to. */
export interface KnowledgeCandidate {
  id: string;
  category: string;
  title: string;
  content: string;
}

export interface ProvenExtractionContext {
  /** The frozen draft submitted on the awarded application. */
  narrativeSnapshot: string;
  /** Funder category the award came from — recorded on each proven narrative. */
  funderCategory: string;
  /** Existing KB entries a section may be linked back to (optional). */
  knowledgeCandidates: KnowledgeCandidate[];
}

export interface ExtractedSection {
  /** A narrative KB category (e.g. "need_statement", "impact"). */
  sectionType: KnowledgeBaseCategory;
  /** The reusable passage, quoted from the submitted draft. */
  text: string;
  /** id of the KB entry this passage derives from, or null if newly observed. */
  knowledgeBaseId: string | null;
}

export interface ProvenExtractionPrompt {
  system: string;
  prompt: string;
}

/** Truncate candidate content to keep the prompt bounded. */
const CANDIDATE_MAX_CHARS = 500;

function renderCandidates(candidates: KnowledgeCandidate[]): string {
  if (candidates.length === 0) {
    return "(No existing Knowledge Base entries were supplied. Set knowledgeBaseId to null for every section.)";
  }
  return candidates
    .map((c) => {
      const content = c.content.replace(/\s+/g, " ").trim().slice(0, CANDIDATE_MAX_CHARS);
      return `- id: ${c.id}\n  category: ${c.category}\n  title: ${c.title}\n  content: ${content}`;
    })
    .join("\n");
}

/**
 * Build the extraction prompt. The model returns a single JSON object with a
 * `sections` array; each section quotes the draft, names a KB category, and
 * either links a candidate KB id or null.
 */
export function buildProvenExtractionPrompt(
  context: ProvenExtractionContext,
): ProvenExtractionPrompt {
  const system = [
    "You analyze a grant application narrative that WON funding and extract the reusable, high-value sections so they can be reused on future applications.",
    "",
    "RULES:",
    "1. Quote text VERBATIM from the submitted narrative. Never paraphrase, summarize, or invent content.",
    "2. Extract only substantive, self-contained passages worth reusing (a mission statement, need statement, impact paragraph, capacity description, etc.). Skip salutations, addresses, dates, and funder-specific filler.",
    `3. Label each section with exactly one category from this list: ${SECTION_TYPES.join(", ")}.`,
    "4. If a section clearly derives from one of the provided Knowledge Base entries, set knowledgeBaseId to that entry's id. Otherwise set knowledgeBaseId to null.",
    "5. Return AT MOST 8 sections — the strongest ones.",
    "6. Respond with ONLY a single JSON object, no prose and no code fences, in exactly this shape:",
    JSON.stringify({
      sections: [
        {
          sectionType: "<one category from the list>",
          text: "<verbatim passage from the submitted narrative>",
          knowledgeBaseId: "<candidate id or null>",
        },
      ],
    }),
  ].join("\n");

  const prompt = [
    "# Awarded application",
    `- Funder category: ${humanizeEnum(context.funderCategory)}`,
    "",
    "## Existing Knowledge Base entries (for attribution)",
    renderCandidates(context.knowledgeCandidates),
    "",
    "## Submitted narrative (the winning draft)",
    context.narrativeSnapshot.trim() || "(The narrative was empty.)",
    "",
    "## Output",
    "Extract the reusable proven sections now. Return ONLY the JSON object described above.",
  ].join("\n");

  return { system, prompt };
}

// --- response parsing --------------------------------------------------------

function isSectionType(value: unknown): value is KnowledgeBaseCategory {
  return (
    typeof value === "string" &&
    (SECTION_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Parse the extraction JSON into validated sections. Tolerant of stray prose or
 * code fences (scans for the first balanced object). Returns [] when the model
 * produced no usable sections; throws nothing here so a barren-but-valid result
 * (e.g. a short draft) is treated as "nothing to extract" rather than a failure.
 * Sections with an unknown sectionType, empty text, or a knowledgeBaseId not in
 * `validKbIds` are dropped (the latter prevents fabricated id linkage).
 */
export function parseExtractionResponse(
  text: string,
  validKbIds: Set<string>,
): ExtractedSection[] {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return [];

  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }

  const sections = (raw as { sections?: unknown })?.sections;
  if (!Array.isArray(sections)) return [];

  const out: ExtractedSection[] = [];
  for (const entry of sections) {
    const s = (entry ?? {}) as Record<string, unknown>;
    if (!isSectionType(s.sectionType)) continue;
    const passage = typeof s.text === "string" ? s.text.trim() : "";
    if (passage === "") continue;

    const kbId =
      typeof s.knowledgeBaseId === "string" && validKbIds.has(s.knowledgeBaseId)
        ? s.knowledgeBaseId
        : null;

    out.push({ sectionType: s.sectionType, text: passage, knowledgeBaseId: kbId });
  }
  return out.slice(0, 8);
}
