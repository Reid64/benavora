import type Anthropic from "@anthropic-ai/sdk";

import { callClaudeConversation, callClaudeWithTools, DEFAULT_MODEL } from "@/lib/ai/claude";
import { generateEmbedding } from "@/lib/intelligence/embeddings";
import { insertQuery, rateCount, searchKnowledge, type SearchHit } from "@/lib/knowledge/db";
import { runTool, toolDefinitions } from "@/lib/knowledge/tools";

const MAX_CONTEXT_CHARS = 1200;
const MAX_HISTORY_TURNS = 6;
const DAILY_RATE_LIMIT = 30;
const SEARCH_K = 8;
const ANSWER_MAX_TOKENS = 700;
const MAX_TOOL_ROUNDS = 4;

const APP_SYSTEM_PROMPT_SUFFIX =
  "\nYou are inside the user's Benavora workspace. You may call tools to read their own organization's opportunities, deadlines, pipeline and drafts. Cite workspace data as [workspace]. Never reveal data for any other organization.";

const DEMO_KEYWORDS = [
  "software",
  "tool",
  "automate",
  "platform",
  "crm",
  "grant writer",
  "autoapply",
  "benavora",
  "demo",
  "pricing",
];

export interface Citation {
  n: number;
  title: string;
  url: string;
  publisher: string;
}

export interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AnswerPublicParams {
  question: string;
  history: HistoryTurn[];
  clientKey: string;
}

export interface AnswerPublicResult {
  answer: string;
  citations: Citation[];
  offerDemo: boolean;
  latencyMs: number;
}

export function buildPublicSystemPrompt(): string {
  return "You are Benavora Assist, a fundraising and nonprofit operations guide on benavora.com. Answer only from the provided sources. Every factual claim must cite a source by its number like [1]. If the sources do not cover the question, say so plainly and suggest which official resource to check; never guess. Do not give legal or tax determinations for a specific organization; explain the general rule and name the governing publication. Keep answers under 220 words unless the question asks for a procedure, then use a short numbered list. No emoji. Plain, specific language.";
}

export function formatContext(hits: SearchHit[]): string {
  return hits
    .map((hit, i) => {
      const content =
        hit.content.length > MAX_CONTEXT_CHARS
          ? hit.content.slice(0, MAX_CONTEXT_CHARS)
          : hit.content;
      return `[${i + 1}] ${hit.title} (${hit.publisher}) ${hit.canonical_url}\n${content}`;
    })
    .join("\n\n");
}

export function extractCitations(answer: string, hits: SearchHit[]): Citation[] {
  const seen = new Set<number>();
  const citations: Citation[] = [];
  const markerPattern = /\[(\d+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = markerPattern.exec(answer)) !== null) {
    const n = Number(match[1]);
    if (seen.has(n)) continue;
    const hit = hits[n - 1];
    if (!hit) continue;
    seen.add(n);
    citations.push({ n, title: hit.title, url: hit.canonical_url, publisher: hit.publisher });
  }
  return citations;
}

export function shouldOfferDemo(
  question: string,
  history: { role: string; content: string }[],
): boolean {
  const userTurns = history.filter((turn) => turn.role === "user").length;
  if (userTurns < 3) return false;
  const lowerQuestion = question.toLowerCase();
  return DEMO_KEYWORDS.some((keyword) => lowerQuestion.includes(keyword));
}

export async function answerPublic(params: AnswerPublicParams): Promise<AnswerPublicResult> {
  const startedAt = Date.now();

  const count = await rateCount(params.clientKey);
  if (count >= DAILY_RATE_LIMIT) {
    throw new Error("RATE_LIMIT");
  }

  const embedding = await generateEmbedding(params.question);
  const hits = await searchKnowledge(embedding, params.question, SEARCH_K);

  const recentHistory = params.history.slice(-MAX_HISTORY_TURNS);
  const messages = [
    ...recentHistory.map((turn) => ({ role: turn.role, content: turn.content })),
    {
      role: "user" as const,
      content: `${formatContext(hits)}\n\nQuestion: ${params.question}`,
    },
  ];

  const response = await callClaudeConversation({
    system: buildPublicSystemPrompt(),
    messages,
    maxTokens: ANSWER_MAX_TOKENS,
  });

  const citations = extractCitations(response.text, hits);
  const offerDemo = shouldOfferDemo(params.question, params.history);
  const latencyMs = Date.now() - startedAt;

  await insertQuery({
    surface: "public",
    clientKey: params.clientKey,
    question: params.question,
    answer: response.text,
    chunkIds: hits.map((hit) => hit.chunk_id),
    model: response.model ?? DEFAULT_MODEL,
    latencyMs,
  });

  return { answer: response.text, citations, offerDemo, latencyMs };
}

export function buildAppSystemPrompt(): string {
  return buildPublicSystemPrompt() + APP_SYSTEM_PROMPT_SUFFIX;
}

export interface AnswerAppParams {
  question: string;
  history: HistoryTurn[];
  orgId: string;
  userId: string;
}

export interface AnswerAppResult {
  answer: string;
  citations: Citation[];
  toolsUsed: string[];
  latencyMs: number;
}

/**
 * Same retrieval as {@link answerPublic}, plus an Anthropic tool-use loop
 * (capped at {@link MAX_TOOL_ROUNDS} rounds) letting the model read the
 * caller's own organization's opportunities, deadlines, pipeline, and drafts
 * (src/lib/knowledge/tools.ts). No daily rate limit - this surface requires
 * an authenticated session. `orgId` is threaded to every tool call and is
 * never taken from the model's tool input.
 */
export async function answerApp(params: AnswerAppParams): Promise<AnswerAppResult> {
  const startedAt = Date.now();

  const embedding = await generateEmbedding(params.question);
  const hits = await searchKnowledge(embedding, params.question, SEARCH_K);

  const recentHistory = params.history.slice(-MAX_HISTORY_TURNS);
  const messages: Anthropic.MessageParam[] = [
    ...recentHistory.map((turn) => ({ role: turn.role, content: turn.content })),
    {
      role: "user" as const,
      content: `${formatContext(hits)}\n\nQuestion: ${params.question}`,
    },
  ];

  const system = buildAppSystemPrompt();
  const tools = toolDefinitions();
  const toolsUsed: string[] = [];

  let response = await callClaudeWithTools({
    system,
    messages,
    tools,
    maxTokens: ANSWER_MAX_TOKENS,
  });

  let rounds = 0;
  while (response.stopReason === "tool_use" && rounds < MAX_TOOL_ROUNDS) {
    rounds += 1;
    messages.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      toolsUsed.push(block.name);
      let resultContent: string;
      try {
        const result = await runTool(block.name, params.orgId, block.input as Record<string, unknown>);
        resultContent = JSON.stringify(result);
      } catch (err) {
        resultContent = JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        });
      }
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: resultContent });
    }
    messages.push({ role: "user", content: toolResults });

    response = await callClaudeWithTools({
      system,
      messages,
      tools,
      maxTokens: ANSWER_MAX_TOKENS,
    });
  }

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  const citations = extractCitations(text, hits);
  const latencyMs = Date.now() - startedAt;

  await insertQuery({
    surface: "app",
    orgId: params.orgId,
    clientKey: null,
    question: params.question,
    answer: text,
    chunkIds: hits.map((hit) => hit.chunk_id),
    model: response.model ?? DEFAULT_MODEL,
    latencyMs,
  });

  return { answer: text, citations, toolsUsed: Array.from(new Set(toolsUsed)), latencyMs };
}
