"use client";

import { useEffect, useRef, useState } from "react";
import { MessageCircle, Send, X } from "lucide-react";

import { useAssist } from "@/components/marketing/useAssist";
import { useChatbotEngine, type PageContext } from "@/lib/chatbot/useChatbotEngine";

const NAVY = "#2C4E3B";
const GOLD = "#C49A4F";

const KNOWLEDGE_BASE_PAGE_CONTEXTS = new Set<PageContext>([
  "dashboard",
  "opportunities",
  "prospects",
  "applications",
  "engagement",
  "resources",
  "settings",
]);

function isKnowledgeBasePageContext(pageContext: string): pageContext is PageContext {
  return (KNOWLEDGE_BASE_PAGE_CONTEXTS as Set<string>).has(pageContext);
}

export type ChatbotAssistantProps = {
  /**
   * Identifies the page this widget is embedded on. For the 7 known dashboard
   * page contexts (dashboard, opportunities, prospects, applications,
   * engagement, resources, settings), answers come instantly from the local,
   * page-scoped knowledge base (useChatbotEngine) — no network call. Any
   * other value (e.g. "google-nonprofit") falls back to the live, authenticated
   * Assist API (/api/assist) — the same backend used by the global
   * AppAssistPanel in the dashboard header (src/components/assist/AppAssistPanel.tsx).
   */
  pageContext: PageContext | "google-nonprofit";
};

function formatPageContext(pageContext: string): string {
  return pageContext
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

type LocalMessage = { role: "user" | "assistant"; content: string };

export function ChatbotAssistant({ pageContext }: ChatbotAssistantProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  const label = formatPageContext(pageContext);
  const useLocalEngine = isKnowledgeBasePageContext(pageContext);

  const { getResponse } = useChatbotEngine(useLocalEngine ? pageContext : undefined);
  const [localMessages, setLocalMessages] = useState<LocalMessage[]>([]);
  const remote = useAssist({ endpoint: "/api/assist" });

  const messages = useLocalEngine ? localMessages : remote.messages;
  const loading = useLocalEngine ? false : remote.loading;
  const error = useLocalEngine ? null : remote.error;
  const toolsUsed = useLocalEngine ? [] : remote.toolsUsed;

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, loading]);

  function handleSend() {
    const question = input.trim();
    if (!question) return;
    setInput("");
    if (useLocalEngine) {
      const answer = getResponse(question);
      setLocalMessages((prev) => [...prev, { role: "user", content: question }, { role: "assistant", content: answer }]);
    } else {
      void remote.send(question);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close assistant" : "Open assistant"}
        aria-expanded={open}
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg transition-transform hover:scale-105"
        style={{ backgroundColor: open ? NAVY : GOLD }}
      >
        {open ? <X className="h-6 w-6" aria-hidden /> : <MessageCircle className="h-6 w-6" aria-hidden />}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={`${label} Assistant`}
          className="fixed bottom-24 right-6 z-40 flex h-[520px] w-[380px] max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-surface shadow-2xl"
        >
          <div className="flex shrink-0 items-center justify-between px-4 py-3" style={{ backgroundColor: NAVY }}>
            <div>
              <p className="text-sm font-bold text-white">{label} Assistant</p>
              <p className="text-xs" style={{ color: GOLD }}>
                {useLocalEngine ? "Ask about this page" : "Ask about your application or profile"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close assistant"
              className="rounded-md p-1 text-white/80 transition hover:bg-white/10 hover:text-white"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>

          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.length === 0 && (
              <p className="text-xs leading-relaxed text-slate-500">
                {useLocalEngine
                  ? `Try "How do I use this page?" or ask about ${label}.`
                  : "Ask about eligibility, the Google for Nonprofits application, Business Profile setup, or verification."}
              </p>
            )}
            {messages.map((m, i) => (
              <div key={i}>
                <div
                  className="inline-block max-w-[92%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm leading-relaxed"
                  style={
                    m.role === "user"
                      ? { backgroundColor: "#F1EEE7", color: NAVY }
                      : { backgroundColor: "white", border: `1px solid ${NAVY}`, color: NAVY }
                  }
                >
                  {m.content}
                </div>
                {m.role === "assistant" && i === messages.length - 1 && toolsUsed.length > 0 && (
                  <p className="mt-1 text-[11px] text-slate-400">Used: {toolsUsed.join(", ")}</p>
                )}
              </div>
            ))}
            {loading && <p className="text-xs text-slate-400">Thinking...</p>}
            {error && <p className="text-xs text-red-600">{error}</p>}
          </div>

          <div className="shrink-0 border-t border-slate-200 p-3">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a question..."
                rows={1}
                className="min-h-[38px] flex-1 resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#3D6B50]"
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={loading || input.trim().length === 0}
                aria-label="Send"
                className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg text-white transition disabled:opacity-50"
                style={{ backgroundColor: GOLD }}
              >
                <Send className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default ChatbotAssistant;
