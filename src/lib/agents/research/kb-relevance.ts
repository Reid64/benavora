// KB semantic-relevance filtering for the research agents.
//
// Builds one embedding for the organization's real, configured focus (active
// search_profiles' keywords + weighted focus areas + populations served,
// enriched with any `knowledge_base` rows), then scores each candidate
// opportunity's text by cosine similarity against it — a real semantic filter
// driven by whatever the org has actually configured, not a hardcoded
// keyword list for one org. Requires no schema change: embeddings are
// computed on the fly per run and never persisted.
//
// Fails open by design: when there is no OPENAI_API_KEY, no active profiles,
// and no knowledge_base rows, `buildKbScorer` returns null and callers must
// skip filtering entirely — "we cannot judge relevance" is not the same as
// "not relevant," and a missing/failed embedding call must never cost a real
// discovery.

import type { SupabaseClient } from "@supabase/supabase-js";

import { generateEmbedding } from "@/lib/intelligence/embeddings";
import {
  getActiveProfiles,
  profileQueryTerms,
} from "@/lib/agents/research/scheduler";
import { humanizeEnum } from "@/lib/utils/formatters";

export interface KbProfileContext {
  client: SupabaseClient;
  organizationId: string;
}

interface KnowledgeBaseRow {
  funder_categories: string[] | null;
  keywords: string[] | null;
}

/**
 * Aggregate free-text describing the org's real, configured mission/focus.
 * Returns "" when the org has neither active search profiles nor
 * knowledge_base rows — callers must treat that as "nothing to score
 * against," not "reject everything."
 */
export async function buildOrgFocusText(ctx: KbProfileContext): Promise<string> {
  const parts: string[] = [];

  const profiles = await getActiveProfiles({
    client: ctx.client,
    organizationId: ctx.organizationId,
  });
  for (const profile of profiles) {
    parts.push(...profileQueryTerms(profile));
    parts.push(...profile.categories.map((c) => humanizeEnum(c)));
  }

  try {
    const { data } = await ctx.client
      .from("knowledge_base")
      .select("funder_categories, keywords")
      .eq("organization_id", ctx.organizationId)
      .limit(20);
    for (const row of (data ?? []) as KnowledgeBaseRow[]) {
      parts.push(...(row.funder_categories ?? []).map((c) => humanizeEnum(c)));
      parts.push(...(row.keywords ?? []));
    }
  } catch (err) {
    // knowledge_base is optional enrichment; its absence/failure must never
    // break scoring (search_profiles alone is a valid, sufficient focus).
    console.error("[kb-relevance] knowledge_base lookup failed:", err);
  }

  const unique = Array.from(
    new Set(parts.map((p) => p.trim()).filter((p) => p !== "")),
  );
  return unique.join(", ");
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface KbScorer {
  /**
   * 0-100 relevance score for a candidate's text against the org's focus.
   * Text-embedding cosine similarity for related short text in practice
   * clusters roughly 0.15-0.6 (rarely near 1.0 even for a strong match) — the
   * *100 scale here is for human-readable logging, not a calibrated
   * probability. Recommended reject threshold: below ~15.
   */
  score(text: string): Promise<number>;
}

/**
 * Builds a scorer bound to one embedding of the org's aggregate focus text.
 * Returns null when there is nothing to score against or embeddings are
 * unavailable (OPENAI_API_KEY unset, or the embedding call itself fails) —
 * callers must skip filtering in that case, not reject every candidate.
 */
export async function buildKbScorer(
  ctx: KbProfileContext,
): Promise<KbScorer | null> {
  if (!process.env.OPENAI_API_KEY) return null;

  const focusText = await buildOrgFocusText(ctx);
  if (!focusText) return null;

  let focusEmbedding: number[];
  try {
    focusEmbedding = await generateEmbedding(focusText);
  } catch (err) {
    console.error("[kb-relevance] failed to embed org focus text:", err);
    return null;
  }

  return {
    async score(text: string): Promise<number> {
      const trimmed = text.trim();
      if (!trimmed) return 0;
      try {
        const embedding = await generateEmbedding(trimmed);
        const similarity = cosineSimilarity(focusEmbedding, embedding);
        return Math.max(0, Math.min(100, Math.round(similarity * 100)));
      } catch (err) {
        console.error("[kb-relevance] failed to embed candidate text:", err);
        // Fail open: an embedding error must never silently discard a real
        // discovery. Return a neutral score comfortably above the reject
        // threshold so this candidate survives to the next filtering stage.
        return 50;
      }
    },
  };
}
