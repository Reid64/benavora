"use client";

import { useEffect, useRef, useState } from "react";

import { useAssist } from "@/components/marketing/useAssist";

// In-app Benavora Assist panel (knw-004). Right-side slide-over opened from
// the "Assist" button in the dashboard header. Uses the app's Deep Navy /
// Rich Gold palette (NOT the marketing palette) - every color is an inline
// hex per the app-wide "One UI Rule" (globals.css !important overrides both
// Tailwind color classes and CSS vars).

const NAVY = "#101B2D";
const GOLD = "#B88A2E";
const PANEL_WIDTH = 420;

export interface AppAssistPanelProps {
  open: boolean;
  onClose: () => void;
}

export function AppAssistPanel({ open, onClose }: AppAssistPanelProps) {
  const [input, setInput] = useState("");
  const { messages, send, loading, error, toolsUsed } = useAssist({ endpoint: "/api/assist" });
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, loading]);

  if (!open) return null;

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
    <div
      role="dialog"
      aria-label="Benavora Assist"
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: PANEL_WIDTH,
        maxWidth: "100vw",
        backgroundColor: "#FFFFFF",
        borderLeft: `1px solid ${NAVY}`,
        display: "flex",
        flexDirection: "column",
        zIndex: 1000,
        boxShadow: "-8px 0 32px rgba(0,0,0,0.25)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 20px",
          backgroundColor: NAVY,
          flexShrink: 0,
        }}
      >
        <div style={{ color: "#FFFFFF", fontWeight: 700, fontSize: 16 }}>Benavora Assist</div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Assist"
          style={{
            background: "transparent",
            border: "none",
            color: "#FFFFFF",
            fontSize: 22,
            cursor: "pointer",
            lineHeight: 1,
          }}
        >
          &times;
        </button>
      </div>

      <div ref={listRef} style={{ flex: 1, overflowY: "auto", padding: 20 }}>
        {messages.length === 0 ? (
          <div style={{ fontSize: 13, color: "#5B6472" }}>
            Ask about your deadlines, pipeline, drafts, or general fundraising questions.
          </div>
        ) : null}
        {messages.map((m, i) => (
          <div key={i} style={{ marginBottom: 14 }}>
            <div
              style={{
                display: "inline-block",
                maxWidth: "92%",
                padding: "10px 14px",
                borderRadius: 10,
                fontSize: 14,
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
                backgroundColor: m.role === "user" ? "#F1EEE7" : "#FFFFFF",
                border: m.role === "assistant" ? `1px solid ${NAVY}` : "none",
                color: NAVY,
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
                    style={{ fontSize: 12, color: GOLD, textDecoration: "none" }}
                  >
                    [{c.n}] {c.title}
                  </a>
                ))}
              </div>
            ) : null}
            {m.role === "assistant" && i === messages.length - 1 && toolsUsed.length > 0 ? (
              <div style={{ marginTop: 6, fontSize: 11, color: "#5B6472" }}>
                Used: {toolsUsed.join(", ")}
              </div>
            ) : null}
          </div>
        ))}
        {loading ? <div style={{ fontSize: 13, color: "#5B6472" }}>Thinking...</div> : null}
        {error ? <div style={{ fontSize: 13, color: "#B3261E", marginTop: 8 }}>{error}</div> : null}
      </div>

      <div style={{ padding: 16, borderTop: `1px solid #D9D3C5`, flexShrink: 0 }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about your deadlines, pipeline, or drafts..."
          rows={2}
          style={{
            width: "100%",
            resize: "none",
            border: `1px solid #D9D3C5`,
            borderRadius: 8,
            padding: 8,
            fontSize: 14,
            fontFamily: "inherit",
            color: NAVY,
            boxSizing: "border-box",
          }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
          <button
            type="button"
            onClick={handleSend}
            disabled={loading || input.trim().length === 0}
            style={{
              backgroundColor: GOLD,
              color: NAVY,
              border: "none",
              borderRadius: 8,
              padding: "10px 20px",
              fontWeight: 700,
              fontSize: 14,
              cursor: loading ? "default" : "pointer",
              opacity: loading || input.trim().length === 0 ? 0.6 : 1,
            }}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
