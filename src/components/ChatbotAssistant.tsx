"use client";

import { useEffect, useRef, useState } from "react";
import { MessageCircle, Send, X } from "lucide-react";

import { useAssist } from "@/components/marketing/useAssist";

const NAVY = "#2C4E3B";
const GOLD = "#C49A4F";

export type ChatbotAssistantProps = {
  /**
   * Identifies the page this widget is embedded on (e.g. "google-nonprofit").
   * The in-app Assist API (/api/assist) has no server-side page-context
   * parameter, so this only customizes the widget's title/placeholder copy —
   * it's the same authenticated assistant backend used by the global
   * AppAssistPanel in the dashboard header (src/components/assist/AppAssistPanel.tsx).
   */
  pageContext: string;
};

function formatPageContext(pageContext: string): string {
  return pageContext
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function ChatbotAssistant({ pageContext }: ChatbotAssistantProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const { messages, send, loading, error, toolsUsed } = useAssist({ endpoint: "/api/assist" });
  const listRef = useRef<HTMLDivElement>(null);

  const label = formatPageContext(pageContext);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, loading]);

  function handleSend() {
    const question = input.trim();
    if (!question) return;
    setInput("");
    void send(question);
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
                Ask about your application or profile
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
                Ask about eligibility, the Google for Nonprofits application, Business Profile
                setup, or verification.
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
