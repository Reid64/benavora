"use client";

import { useCallback } from "react";
import knowledgeBase from "./knowledge-base.json";

export type PageContext =
  | "dashboard"
  | "opportunities"
  | "prospects"
  | "applications"
  | "engagement"
  | "resources"
  | "settings";

interface QaEntry {
  question: string;
  answer: string;
}

interface KnowledgeBaseSection {
  title: string;
  summary?: string;
  qa?: QaEntry[];
}

interface KnowledgeBase {
  sections: Record<string, KnowledgeBaseSection>;
  page_guides?: Record<string, KnowledgeBaseSection>;
}

const DEFAULT_RESPONSE =
  "I don't have a confident answer for that yet. Could you rephrase your question, or ask about Donor Discovery, AutoApply, Draft Generation, Opportunity Matching, or the dashboard?";

// Topic sections most relevant to each page, searched before falling back to
// the full knowledge base.
const TOPIC_MAP: Record<PageContext, string[]> = {
  dashboard: ["dashboard_pages"],
  opportunities: ["opportunity_matching"],
  prospects: ["donor_discovery"],
  applications: ["draft_generation", "autoapply"],
  engagement: [],
  resources: ["draft_generation"],
  settings: [],
};

const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "do", "does", "did", "can", "could", "should", "would", "will",
  "i", "you", "he", "she", "it", "we", "they", "my", "your", "our",
  "to", "of", "in", "on", "at", "for", "with", "and", "or", "but",
  "what", "when", "where", "why", "how", "who", "which",
  "this", "that", "these", "those", "there", "here",
  "me", "us", "them", "am", "as", "if", "so", "than",
]);

function tokenize(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word));
  return new Set(words);
}

function overlapScore(queryTokens: Set<string>, candidateTokens: Set<string>): number {
  if (queryTokens.size === 0 || candidateTokens.size === 0) return 0;
  let shared = 0;
  for (const token of queryTokens) {
    if (candidateTokens.has(token)) shared += 1;
  }
  const union = new Set([...queryTokens, ...candidateTokens]).size;
  return shared / union;
}

const MATCH_THRESHOLD = 0.08;

function bestMatch(queryTokens: Set<string>, sections: KnowledgeBaseSection[]): string | null {
  let bestScore = 0;
  let bestAnswer: string | null = null;
  for (const section of sections) {
    for (const entry of section.qa ?? []) {
      const score = overlapScore(queryTokens, tokenize(entry.question));
      if (score > bestScore) {
        bestScore = score;
        bestAnswer = entry.answer;
      }
    }
  }
  return bestScore >= MATCH_THRESHOLD ? bestAnswer : null;
}

/**
 * Matches a user message against the chatbot knowledge base using word-overlap
 * (Jaccard-style) similarity over each Q&A pair's question text. When a
 * pageContext is given, the current page's own guide is searched first, then
 * topic sections relevant to that page, before falling back to the full
 * knowledge base — so the same question can surface page-specific guidance.
 */
export function useChatbotEngine(pageContext?: PageContext) {
  const getResponse = useCallback(
    (message: string): string => {
      const queryTokens = tokenize(message ?? "");
      if (queryTokens.size === 0) {
        return DEFAULT_RESPONSE;
      }

      const kb = knowledgeBase as KnowledgeBase;

      const searchTiers: KnowledgeBaseSection[][] = [];
      if (pageContext) {
        const guide = kb.page_guides?.[pageContext];
        if (guide) searchTiers.push([guide]);

        const topicSections = (TOPIC_MAP[pageContext] ?? [])
          .map((key) => kb.sections[key])
          .filter((section): section is KnowledgeBaseSection => Boolean(section));
        if (topicSections.length > 0) searchTiers.push(topicSections);
      }
      searchTiers.push(Object.values(kb.sections));

      for (const sections of searchTiers) {
        const answer = bestMatch(queryTokens, sections);
        if (answer) return answer;
      }

      return DEFAULT_RESPONSE;
    },
    [pageContext],
  );

  return { getResponse };
}
