"use client";

import { useState } from "react";
import Link from "next/link";

type TriggerAction =
  | { kind: "post"; endpoint: string; body?: Record<string, unknown> }
  | { kind: "link"; href: string };

export type AiTrigger = {
  key: string;
  icon: string;
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
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "12px",
              padding: "16px",
              marginBottom: "10px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
              <span style={{ fontSize: "16px" }} aria-hidden>
                {trigger.icon}
              </span>
              <span style={{ fontSize: "14px", fontWeight: 800, color: "#FFFFFF" }}>{trigger.title}</span>
            </div>
            <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.7)", marginBottom: "6px" }}>{trigger.sub}</div>
            <div style={{ fontSize: "13px", fontWeight: 700, color: "#00D4FF", marginBottom: "10px" }}>
              {trigger.yieldText}
            </div>
            {trigger.action.kind === "post" ? (
              <button
                type="button"
                onClick={() => run(trigger)}
                disabled={st === "loading"}
                style={{
                  background: "linear-gradient(135deg,#0077B6,#00D4FF)",
                  color: "white",
                  border: "none",
                  borderRadius: "7px",
                  padding: "7px 14px",
                  fontSize: "12px",
                  fontWeight: 700,
                  cursor: st === "loading" ? "wait" : "pointer",
                }}
              >
                {st === "loading" ? "Running…" : trigger.ctaLabel}
              </button>
            ) : (
              <Link
                href={trigger.action.href}
                style={{
                  display: "inline-block",
                  background: "linear-gradient(135deg,#0077B6,#00D4FF)",
                  color: "white",
                  borderRadius: "7px",
                  padding: "7px 14px",
                  fontSize: "12px",
                  fontWeight: 700,
                  textDecoration: "none",
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
