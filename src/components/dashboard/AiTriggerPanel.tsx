"use client";

import { useState } from "react";
import Link from "next/link";

type TriggerAction =
  | { kind: "post"; endpoint: string; body?: Record<string, unknown> }
  | { kind: "link"; href: string };

export type AiTrigger = {
  key: string;
  borderColor: string;
  title: string;
  sub: string;
  yieldText: string;
  action: TriggerAction;
  ctaLabel: string;
};

type RunStatus = "idle" | "loading" | "done" | "error";

export function AiTriggerPanel({ triggers }: { triggers: AiTrigger[] }) {
  const [status, setStatus] = useState<Record<string, RunStatus>>({});
  const [resultText, setResultText] = useState<Record<string, string>>({});

  async function run(trigger: AiTrigger) {
    if (trigger.action.kind !== "post") return;
    setStatus((s) => ({ ...s, [trigger.key]: "loading" }));
    try {
      const res = await fetch(trigger.action.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: trigger.action.body ? JSON.stringify(trigger.action.body) : undefined,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus((s) => ({ ...s, [trigger.key]: "done" }));
      setResultText((s) => ({ ...s, [trigger.key]: "Triggered — check back shortly for results." }));
    } catch {
      setStatus((s) => ({ ...s, [trigger.key]: "error" }));
      setResultText((s) => ({ ...s, [trigger.key]: "Failed to trigger. Try again." }));
    }
  }

  return (
    <div>
      {triggers.map((trigger) => {
        const st = status[trigger.key] ?? "idle";
        return (
          <div
            key={trigger.key}
            style={{
              backgroundColor: "rgba(16,27,45,0.04)",
              border: "1px solid rgba(16,27,45,0.08)",
              borderLeft: `2px solid ${trigger.borderColor}`,
              borderRadius: "10px",
              padding: "12px 14px",
              marginBottom: "8px",
            }}
          >
            <div style={{ fontSize: "13px", fontWeight: 700, color: "#101B2D", marginBottom: "4px", letterSpacing: "-0.01em" }}>
              {trigger.title}
            </div>
            <div style={{ fontSize: "11px", color: "rgba(16,27,45,0.55)", marginBottom: "6px", lineHeight: 1.4 }}>
              {trigger.sub}
            </div>
            <div style={{ fontSize: "12px", fontWeight: 700, color: trigger.borderColor, marginBottom: "8px" }}>{trigger.yieldText}</div>
            {trigger.action.kind === "post" ? (
              <button
                type="button"
                onClick={() => run(trigger)}
                disabled={st === "loading"}
                style={{
                  background: "linear-gradient(135deg,#B88A2E,#D4A94D)",
                  color: "#F8F5EE",
                  border: "none",
                  borderRadius: "6px",
                  padding: "6px 12px",
                  fontSize: "11px",
                  fontWeight: 700,
                  cursor: st === "loading" ? "wait" : "pointer",
                  fontFamily: "inherit",
                }}
              >
                {st === "loading" ? "Running…" : trigger.ctaLabel}
              </button>
            ) : (
              <Link
                href={trigger.action.href}
                style={{
                  display: "inline-block",
                  background: "linear-gradient(135deg,#B88A2E,#D4A94D)",
                  color: "#F8F5EE",
                  borderRadius: "6px",
                  padding: "6px 12px",
                  fontSize: "11px",
                  fontWeight: 700,
                  textDecoration: "none",
                  fontFamily: "inherit",
                }}
              >
                {trigger.ctaLabel}
              </Link>
            )}
            {(st === "done" || st === "error") && (
              <div style={{ fontSize: "11px", color: st === "error" ? "#EF4444" : "#10B981", marginTop: "6px" }}>
                {resultText[trigger.key]}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
