// State grant portal scraper — best-effort text scan, not a real HTML
// parser. State portals are fragile and change markup without notice
// (BLUEPRINT.md §15), so this deliberately does basic string search rather
// than depending on a DOM/CSS selector library: it degrades to an empty
// result instead of throwing when a portal's structure shifts.

import type { PortalConfig } from "./portal-config";

export interface ScrapedOpportunity {
  title: string;
  deadline: string | null;
  sourceUrl: string;
  state: string;
}

const DATE_PATTERN =
  /\b(?:\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})\b/i;

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Fetches config.searchUrl and does a basic string search for blocks
 * containing titleSelector, pulling a nearby deadline via deadlineSelector
 * or a plain date pattern. Returns [] on any network, HTTP, or parse error —
 * callers loop over many states and a single portal failure must not abort
 * the batch (see error_count on state_portals, SCHEMA_REGISTRY.md §2.45).
 */
export async function scrapePortal(
  config: PortalConfig,
): Promise<ScrapedOpportunity[]> {
  try {
    const response = await fetch(config.searchUrl, {
      signal: AbortSignal.timeout(30_000),
      headers: { "User-Agent": "BenavoraGrantResearchBot/1.0" },
    });

    if (!response.ok) return [];

    const html = await response.text();
    if (!html) return [];

    const results: ScrapedOpportunity[] = [];
    const lowerHtml = html.toLowerCase();
    const titleNeedle = config.titleSelector.toLowerCase();
    const deadlineNeedle = config.deadlineSelector.toLowerCase();

    let searchFrom = 0;
    let matchIndex = lowerHtml.indexOf(titleNeedle, searchFrom);

    while (matchIndex !== -1 && results.length < 50) {
      const windowStart = matchIndex;
      const windowEnd = Math.min(html.length, matchIndex + 600);
      const chunk = html.slice(windowStart, windowEnd);
      const text = stripTags(chunk);

      if (text) {
        const title = text.slice(0, 200).trim();

        let deadline: string | null = null;
        const deadlineIdx = lowerHtml.indexOf(deadlineNeedle, matchIndex);
        if (deadlineIdx !== -1 && deadlineIdx < matchIndex + 2000) {
          const deadlineChunk = stripTags(
            html.slice(deadlineIdx, Math.min(html.length, deadlineIdx + 200)),
          );
          const dateMatch = DATE_PATTERN.exec(deadlineChunk);
          if (dateMatch) deadline = dateMatch[0];
        }
        if (!deadline) {
          const dateMatch = DATE_PATTERN.exec(text);
          if (dateMatch) deadline = dateMatch[0];
        }

        if (title.length >= 5) {
          results.push({
            title,
            deadline,
            sourceUrl: config.searchUrl,
            state: config.state,
          });
        }
      }

      searchFrom = matchIndex + titleNeedle.length;
      matchIndex = lowerHtml.indexOf(titleNeedle, searchFrom);
    }

    return results;
  } catch {
    return [];
  }
}
