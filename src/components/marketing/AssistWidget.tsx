"use client";

import { useEffect, useRef, useState } from "react";
import { mk, mkRadius } from "@/lib/marketing/theme";
import { useAssist } from "@/components/marketing/useAssist";

export function AssistWidget() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const { messages, send, loading, error, offerDemo } = useAssist();
  const listRef = useRef<HTMLDivElement>(null);

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
        aria-label="Ask Benavora"
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          width: 56,
          height: 56,
          borderRadius: "50%",
          background: mk.forest,
          color: "#FFFFFF",
          border: "none",
          cursor: "pointer",
          fontSize: 13,
          fontWeight: 600,
          zIndex: 1000,
          boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
        }}
      >
        Ask
      </button>

      {open ? (
        <div
          className="mk-assist-panel"
          style={{
            position: "fixed",
            bottom: 92,
            right: 24,
            width: 380,
            height: 560,
            background: mk.surface,
            border: `1px solid ${mk.line}`,
            borderRadius: 12,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            zIndex: 1000,
            boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "14px 16px",
              borderBottom: `1px solid ${mk.line}`,
              flexShrink: 0,
            }}
          >
            <div style={{ color: mk.forest, fontWeight: 600, fontSize: 16 }}>Ask Benavora</div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              style={{
                background: "transparent",
                border: "none",
                color: mk.muted,
                fontSize: 20,
                cursor: "pointer",
                lineHeight: 1,
              }}
            >
              &times;
            </button>
          </div>

          <div ref={listRef} style={{ flex: 1, overflowY: "auto", padding: 16 }}>
            {messages.map((m, i) => (
              <div key={i} style={{ marginBottom: 12 }}>
                <div
                  style={{
                    display: "inline-block",
                    maxWidth: "90%",
                    padding: "10px 12px",
                    borderRadius: 10,
                    fontSize: 14,
                    lineHeight: 1.5,
                    whiteSpace: "pre-wrap",
                    background: m.role === "user" ? mk.tint : mk.surface,
                    border: m.role === "assistant" ? `1px solid ${mk.line}` : "none",
                    color: mk.ink,
                  }}
                >
                  {m.content}
                </div>
                {m.role === "assistant" && m.citations && m.citations.length > 0 ? (
                  <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {m.citations.map((c) => (
                      <a
                        key={c.n}
                        href={c.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: 12, color: mk.terracotta, textDecoration: "none" }}
                      >
                        [{c.n}] {c.title}
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
            {loading ? <div style={{ fontSize: 13, color: mk.muted }}>Thinking...</div> : null}
            {error ? (
              <div style={{ fontSize: 13, color: mk.terracotta, marginTop: 8 }}>{error}</div>
            ) : null}
            {offerDemo ? (
              <div style={{ marginTop: 12 }}>
                <a
                  href="/demo"
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: mk.terracotta,
                    textDecoration: "none",
                  }}
                >
                  Book a demo
                </a>
              </div>
            ) : null}
          </div>

          <div style={{ padding: 12, borderTop: `1px solid ${mk.line}`, flexShrink: 0 }}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about grants, eligibility, compliance..."
              rows={2}
              style={{
                width: "100%",
                resize: "none",
                border: `1px solid ${mk.line}`,
                borderRadius: 8,
                padding: 8,
                fontSize: 14,
                fontFamily: "inherit",
                color: mk.ink,
                boxSizing: "border-box",
              }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
              <button
                type="button"
                onClick={handleSend}
                disabled={loading || input.trim().length === 0}
                style={{
                  background: mk.terracotta,
                  color: "#FFFFFF",
                  border: "none",
                  borderRadius: mkRadius.cta,
                  padding: "12px 20px",
                  fontWeight: 600,
                  fontSize: 15,
                  cursor: loading ? "default" : "pointer",
                  opacity: loading || input.trim().length === 0 ? 0.6 : 1,
                }}
              >
                Send
              </button>
            </div>
            <div style={{ fontSize: 11, color: mk.muted, marginTop: 8 }}>
              General guidance from public sources. Not legal or tax advice.
            </div>
          </div>

          <style jsx>{`
            @media (max-width: 640px) {
              .mk-assist-panel {
                left: 0 !important;
                right: 0 !important;
                bottom: 0 !important;
                width: 100% !important;
                height: 80vh !important;
                border-radius: 12px 12px 0 0 !important;
              }
            }
          `}</style>
        </div>
      ) : null}
    </>
  );
}
