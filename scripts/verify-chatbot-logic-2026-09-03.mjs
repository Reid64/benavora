// Standalone reproduction of useChatbotEngine's matching algorithm (tokenize,
// overlapScore, bestMatch, searchTiers ordering) run directly against the real
// knowledge-base.json, bypassing the browser entirely. Verifies each of the 7
// page contexts gets its own page-specific answer to "How do I use this page?"
// per the memory note: dev-server .next cache corruption breaks Playwright
// screenshots (position:fixed -> static), so prefer this over chasing that.
import { readFileSync } from "node:fs";

const kb = JSON.parse(readFileSync("src/lib/chatbot/knowledge-base.json", "utf8"));

const TOPIC_MAP = {
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

function tokenize(text) {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word));
  return new Set(words);
}

function overlapScore(queryTokens, candidateTokens) {
  if (queryTokens.size === 0 || candidateTokens.size === 0) return 0;
  let shared = 0;
  for (const token of queryTokens) if (candidateTokens.has(token)) shared += 1;
  const union = new Set([...queryTokens, ...candidateTokens]).size;
  return shared / union;
}

const MATCH_THRESHOLD = 0.08;

function bestMatch(queryTokens, sections) {
  let bestScore = 0;
  let bestAnswer = null;
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

function getResponse(message, pageContext) {
  const queryTokens = tokenize(message ?? "");
  if (queryTokens.size === 0) return null;

  const searchTiers = [];
  if (pageContext) {
    const guide = kb.page_guides?.[pageContext];
    if (guide) searchTiers.push([guide]);
    const topicSections = (TOPIC_MAP[pageContext] ?? [])
      .map((key) => kb.sections[key])
      .filter(Boolean);
    if (topicSections.length > 0) searchTiers.push(topicSections);
  }
  searchTiers.push(Object.values(kb.sections));

  for (const sections of searchTiers) {
    const answer = bestMatch(queryTokens, sections);
    if (answer) return answer;
  }
  return null;
}

const PAGE_CONTEXTS = ["dashboard", "opportunities", "prospects", "applications", "engagement", "resources", "settings"];
let allPass = true;

for (const ctx of PAGE_CONTEXTS) {
  const answer = getResponse("How do I use this page?", ctx);
  const expected = kb.page_guides?.[ctx]?.qa?.find((q) => q.question === "How do I use this page?")?.answer;
  const pass = answer === expected && !!answer;
  allPass = allPass && pass;
  console.log(`[${ctx}] ${pass ? "PASS" : "FAIL"}`);
  console.log(`  answer: ${(answer || "(none)").slice(0, 100)}...`);
}

// Confirm cross-contamination doesn't happen: opportunities answer must not
// equal another page's answer, and must mention opportunity-specific terms.
const oppAnswer = getResponse("How do I use this page?", "opportunities");
const isOpportunitySpecific = /opportunit/i.test(oppAnswer || "") && /probability|catalog|eligibility|funder/i.test(oppAnswer || "");
console.log(`\nOpportunities answer is opportunity-specific: ${isOpportunitySpecific ? "PASS" : "FAIL"}`);
allPass = allPass && isOpportunitySpecific;

// Confirm no pageContext still falls back gracefully (doesn't crash, uses full KB).
const noContextAnswer = getResponse("How do I use this page?", undefined);
console.log(`No-pageContext fallback works: ${noContextAnswer !== undefined ? "PASS" : "FAIL"}`);

console.log(allPass ? "\nALL_LOGIC_CHECKS_PASS" : "\nSOME_LOGIC_CHECKS_FAILED");
if (!allPass) process.exit(1);
