import { BookText, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui";
import type { KnowledgeSource } from "@/types/ai";

export type KnowledgePreviewProps = {
  /** Sources that informed the draft (KB entries + proven narratives). */
  sources: KnowledgeSource[];
};

/**
 * Transparency panel (BLUEPRINT §4.8 / BEHAVIORAL_CONTRACTS §9): shows exactly
 * which Knowledge Base entries and proven narratives informed the draft. An
 * empty list is itself a signal - the draft had little verified content to draw
 * on, which the confidence score reflects.
 */
export function KnowledgePreview({ sources }: KnowledgePreviewProps) {
  const kb = sources.filter((s) => s.kind === "knowledge_base");
  const proven = sources.filter((s) => s.kind === "proven_narrative");

  if (sources.length === 0) {
    return (
      <p className="text-sm text-navy-500">
        No Knowledge Base entries were available for this template. The draft was
        generated from your organization profile alone - add narratives to raise
        confidence and grounding.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {kb.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-navy-500">
            <BookText className="h-3.5 w-3.5" aria-hidden />
            Knowledge Base ({kb.length})
          </div>
          <ul className="space-y-1.5">
            {kb.map((source) => (
              <li
                key={source.id}
                className="flex items-center gap-2 text-sm text-navy-700"
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-teal-400" aria-hidden />
                {source.title}
              </li>
            ))}
          </ul>
        </div>
      )}

      {proven.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-navy-500">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            Proven narratives ({proven.length})
          </div>
          <div className="flex flex-wrap gap-2">
            {proven.map((source) => (
              <Badge key={source.id} color="green">
                {source.title}
              </Badge>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-navy-400">
        These entries were supplied to the AI as the only source of
        organizational facts. Anything it could not ground is marked{" "}
        <code className="rounded bg-navy-100 px-1 py-0.5 text-navy-600">
          [NEEDS INPUT]
        </code>{" "}
        in the draft.
      </p>
    </div>
  );
}
