"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

// ─── Brand tokens (matches the homepage's dark canvas exactly — this page is a
// continuation of "/", not the light chrome the other marketing sub-pages use) ──
const B = {
  bg: "#080C14",
  bgCard: "#0D1424",
  bgRaised: "#111B2E",
  bgHighlight: "#162040",
  blue: "#0EA5E9",
  blueDark: "#1E6FD9",
  blueGlow: "rgba(14,165,233,0.12)",
  purple: "#8B5CF6",
  purpleGlow: "rgba(139,92,246,0.12)",
  teal: "#06B6D4",
  green: "#10B981",
  amber: "#F59E0B",
  red: "#EF4444",
  textPrimary: "#F0F6FF",
  textSecond: "#8BA3C0",
  textMuted: "#4E6A8A",
  border: "rgba(14,165,233,0.12)",
  borderFaint: "rgba(255,255,255,0.06)",
};

const sans = "'Inter', -apple-system, BlinkMacSystemFont, sans-serif";
const display = "'Plus Jakarta Sans', 'Inter', sans-serif";

// ─── Small shared hooks ─────────────────────────────────────────────────────

function useInView(threshold = 0.3) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setInView(true);
          obs.disconnect();
        }
      },
      { threshold },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return [ref, inView] as const;
}

function useCountUp(target: number, active: boolean, duration = 1200, delay = 0) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const t0 = performance.now() + delay;
    const tick = (now: number) => {
      if (now < t0) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const p = Math.min((now - t0) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(eased * target));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, target, duration, delay]);
  return val;
}

function useStagger(count: number, active: boolean, stepMs = 200, startDelay = 0) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 1; i <= count; i++) {
      timers.push(setTimeout(() => setN(i), startDelay + i * stepMs));
    }
    return () => timers.forEach(clearTimeout);
  }, [active, count, stepMs, startDelay]);
  return n;
}

function useDelayedFlag(active: boolean, delayMs: number) {
  const [flag, setFlag] = useState(false);
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => setFlag(true), delayMs);
    return () => clearTimeout(t);
  }, [active, delayMs]);
  return flag;
}

const fade = (shown: boolean, extra: React.CSSProperties = {}): React.CSSProperties => ({
  opacity: shown ? 1 : 0,
  transform: shown ? "translateY(0)" : "translateY(10px)",
  transition: "opacity 480ms ease, transform 480ms ease",
  ...extra,
});

// ─── Tiny shared icons ──────────────────────────────────────────────────────

const IconArrow = ({ color = "currentColor" }: { color?: string } = {}) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path
      d="M3 8h10M9 4l4 4-4 4"
      stroke={color}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const IconCheckSm = ({ color = B.green }: { color?: string } = {}) => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <circle cx="7" cy="7" r="7" fill={color} fillOpacity="0.18" />
    <path
      d="M4 7.2l2 2 4-4.4"
      stroke={color}
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const IconCursor = ({ color = "#fff" }: { color?: string } = {}) => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.4))" }}>
    <path d="M3 2l11 5.2-4.6 1.5-1.6 4.6L3 2z" fill={color} stroke="#0B1220" strokeWidth="0.6" />
  </svg>
);

const IconUser = ({ color = B.textSecond }: { color?: string } = {}) => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <circle cx="10" cy="6.5" r="3.5" stroke={color} strokeWidth="1.5" />
    <path d="M3.5 17c1-3.6 4-5.5 6.5-5.5s5.5 1.9 6.5 5.5" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

// ─── Illustrative-data tag (required on every animated panel) ──────────────

function IllustrativeTag() {
  return (
    <div
      style={{
        position: "absolute",
        top: 14,
        right: 14,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 9999,
        background: "rgba(245,158,11,0.1)",
        border: `1px solid rgba(245,158,11,0.3)`,
        fontSize: 11,
        fontWeight: 600,
        color: B.amber,
        letterSpacing: "0.02em",
        zIndex: 2,
      }}
    >
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: B.amber }} />
      Illustrative example — not live customer data
    </div>
  );
}

// ─── Stage shell ─────────────────────────────────────────────────────────────

function StageShell({
  n,
  color,
  title,
  claim,
  detail,
  children,
}: {
  n: number;
  color: string;
  title: string;
  claim: string;
  detail: string;
  children: (active: boolean) => React.ReactNode;
}) {
  const [ref, inView] = useInView(0.25);
  const [open, setOpen] = useState(false);

  return (
    <section
      ref={ref}
      className="hiw-stage"
      style={{
        maxWidth: 980,
        margin: "0 auto",
        padding: "56px 20px",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 18, marginBottom: 24, flexWrap: "wrap" }}>
        <div
          style={{
            flexShrink: 0,
            width: 44,
            height: 44,
            borderRadius: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: `${color}18`,
            border: `1px solid ${color}40`,
            fontFamily: display,
            fontWeight: 800,
            fontSize: 15,
            color,
          }}
        >
          {String(n).padStart(2, "0")}
        </div>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h2
            style={{
              fontFamily: display,
              fontSize: "clamp(22px, 3vw, 30px)",
              fontWeight: 800,
              letterSpacing: "-0.01em",
              color: B.textPrimary,
              marginBottom: 8,
              lineHeight: 1.2,
            }}
          >
            {title}
          </h2>
          <p style={{ fontSize: 15.5, lineHeight: 1.65, color: B.textSecond, maxWidth: 640 }}>{claim}</p>
        </div>
      </div>

      <div
        style={{
          position: "relative",
          background: B.bgCard,
          border: `1px solid ${B.borderFaint}`,
          borderRadius: 16,
          padding: "44px 24px 28px",
          overflow: "hidden",
          minHeight: 220,
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 2,
            background: `linear-gradient(90deg, ${color}, transparent)`,
          }}
        />
        <IllustrativeTag />
        {children(inView)}
      </div>

      <button
        onClick={() => setOpen((o) => !o)}
        className="hiw-detail-toggle"
        style={{
          marginTop: 14,
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          background: "transparent",
          border: "none",
          color: B.textMuted,
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
          padding: "6px 2px",
          fontFamily: sans,
        }}
      >
        <span
          style={{
            width: 20,
            height: 20,
            borderRadius: 6,
            border: `1px solid ${B.borderFaint}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 14,
            transform: open ? "rotate(45deg)" : "none",
            transition: "transform 200ms ease",
          }}
        >
          +
        </span>
        What&apos;s real today
      </button>
      {open && (
        <p
          style={{
            marginTop: 10,
            fontSize: 13.5,
            lineHeight: 1.7,
            color: B.textSecond,
            maxWidth: 720,
            paddingLeft: 2,
          }}
        >
          {detail}
        </p>
      )}
    </section>
  );
}

// ─── Stage 1 — Onboarding & Digital Twin ────────────────────────────────────

const ONBOARDING_STEPS = ["Org Info", "Mission", "Programs", "Board", "Service Area", "Documents", "Review"];

function Stage1Animation({ active }: { active: boolean }) {
  const lit = useStagger(ONBOARDING_STEPS.length, active, 170, 200);
  const ringActive = lit >= ONBOARDING_STEPS.length;
  const pct = useCountUp(72, ringActive, 1300, 150);
  const showCard = useDelayedFlag(ringActive, 1500);

  const r = 42;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - pct / 100);

  return (
    <div>
      <div
        className="hiw-steps-row"
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 6,
          marginBottom: 40,
          flexWrap: "wrap",
        }}
      >
        {ONBOARDING_STEPS.map((label, i) => {
          const on = i < lit;
          return (
            <div key={label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, flex: "1 1 60px" }}>
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: on ? B.teal : B.bgRaised,
                  border: `1.5px solid ${on ? B.teal : B.borderFaint}`,
                  color: on ? "#062024" : B.textMuted,
                  fontSize: 12,
                  fontWeight: 700,
                  transition: "background 400ms ease, border-color 400ms ease, color 400ms ease, transform 400ms ease",
                  transform: on ? "scale(1)" : "scale(0.85)",
                }}
              >
                {on ? "✓" : i + 1}
              </div>
              <span style={{ fontSize: 10.5, color: on ? B.textPrimary : B.textMuted, textAlign: "center", lineHeight: 1.2 }}>
                {label}
              </span>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 40, flexWrap: "wrap" }}>
        <div style={{ position: "relative", width: 108, height: 108 }}>
          <svg width="108" height="108" viewBox="0 0 108 108">
            <circle cx="54" cy="54" r={r} fill="none" stroke={B.borderFaint} strokeWidth="8" />
            <circle
              cx="54"
              cy="54"
              r={r}
              fill="none"
              stroke={B.teal}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              transform="rotate(-90 54 54)"
              style={{ transition: "stroke-dashoffset 120ms linear" }}
            />
          </svg>
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span style={{ fontFamily: display, fontSize: 24, fontWeight: 800, color: B.textPrimary }}>{pct}%</span>
            <span style={{ fontSize: 10, color: B.textMuted }}>complete</span>
          </div>
        </div>

        <div style={fade(showCard, { minWidth: 240, maxWidth: 300 })}>
          <div
            style={{
              background: B.bgRaised,
              border: `1px solid ${B.border}`,
              borderRadius: 12,
              padding: "18px 20px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <IconCheckSm color={B.teal} />
              <span style={{ fontFamily: display, fontSize: 14, fontWeight: 700, color: B.textPrimary }}>
                Organization Profile Built
              </span>
            </div>
            {[
              ["Mission", "“Expand access to stable housing for families (sample).”"],
              ["Board", "5 members on file"],
              ["Service area", "Bay Area, CA"],
            ].map(([k, v]) => (
              <div key={k} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 10.5, color: B.textMuted, textTransform: "uppercase", letterSpacing: "0.06em" }}>{k}</div>
                <div style={{ fontSize: 12.5, color: B.textSecond, lineHeight: 1.4 }}>{v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Stage 2 — Opportunity Research & Discovery ─────────────────────────────

const DISCOVERY_SOURCES = [
  { name: "Grants.gov", cadence: "Daily" },
  { name: "SAM.gov", cadence: "Weekly" },
  { name: "State Portals", cadence: "Weekly" },
  { name: "990 Filings", cadence: "Batch" },
];

function Stage2Animation({ active }: { active: boolean }) {
  const lit = useStagger(DISCOVERY_SOURCES.length, active, 220, 100);
  const counterActive = lit >= DISCOVERY_SOURCES.length;
  const found = useCountUp(30, counterActive, 1200, 200);
  const filterActive = useDelayedFlag(counterActive, 1500);
  const kept = new Set([1, 4, 6]);

  return (
    <div>
      <div
        className="hiw-source-row"
        style={{ display: "flex", justifyContent: "center", gap: 14, flexWrap: "wrap", marginBottom: 26 }}
      >
        {DISCOVERY_SOURCES.map((s, i) => {
          const on = i < lit;
          return (
            <div
              key={s.name}
              style={{
                padding: "10px 16px",
                borderRadius: 10,
                background: on ? `${B.blue}14` : B.bgRaised,
                border: `1px solid ${on ? B.border : B.borderFaint}`,
                textAlign: "center",
                minWidth: 108,
                transition: "background 400ms ease, border-color 400ms ease",
                animation: on ? `hiwPulse 2.2s ease-in-out ${i * 0.25}s infinite` : "none",
              }}
            >
              <div style={{ fontSize: 12.5, fontWeight: 700, color: on ? B.textPrimary : B.textMuted }}>{s.name}</div>
              <div style={{ fontSize: 10.5, color: on ? B.blue : B.textMuted, marginTop: 2 }}>{s.cadence}</div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", justifyContent: "center", marginBottom: 22 }}>
        <div style={{ opacity: counterActive ? 1 : 0.4, transition: "opacity 400ms ease", textAlign: "center" }}>
          <div style={{ fontSize: 11, color: B.textMuted, marginBottom: 4, letterSpacing: "0.06em", textTransform: "uppercase" }}>
            AG-17 · Opportunity Discovery Agent
          </div>
          <div style={{ fontFamily: display, fontSize: 34, fontWeight: 800, color: B.blue }}>
            +{found} opportunities found
          </div>
        </div>
      </div>

      <div className="hiw-card-grid" style={{ display: "flex", justifyContent: "center", gap: 8, flexWrap: "wrap" }}>
        {Array.from({ length: 8 }).map((_, i) => {
          const isKept = kept.has(i);
          return (
            <div
              key={i}
              style={{
                width: 44,
                height: 30,
                borderRadius: 6,
                background: filterActive && isKept ? `${B.green}22` : B.bgRaised,
                border: `1px solid ${filterActive && isKept ? B.green : B.borderFaint}`,
                opacity: filterActive && !isKept ? 0.25 : 1,
                transform: filterActive && !isKept ? "scale(0.85)" : "scale(1)",
                transition: "opacity 500ms ease, transform 500ms ease, background 500ms ease, border-color 500ms ease",
              }}
            />
          );
        })}
      </div>
      <p style={{ textAlign: "center", fontSize: 11.5, color: B.textMuted, marginTop: 12 }}>
        {filterActive ? "Filtered against your organization's real focus areas" : "Scanning sources…"}
      </p>
    </div>
  );
}

// ─── Stage 3 — Filtering & Scoring ──────────────────────────────────────────

const SCORE_FACTORS = [
  { label: "Mission Alignment", weight: 30, value: 92 },
  { label: "Funding History", weight: 25, value: 78 },
  { label: "Deadline Proximity", weight: 20, value: 65 },
  { label: "Amount Fit", weight: 25, value: 88 },
];

function Stage3Animation({ active }: { active: boolean }) {
  const barsLit = useStagger(SCORE_FACTORS.length, active, 260, 150);
  const scoreActive = useDelayedFlag(active, 150 + SCORE_FACTORS.length * 260 + 400);
  const score = useCountUp(87, scoreActive, 900, 0);

  return (
    <div style={{ maxWidth: 560, margin: "0 auto" }}>
      <div style={{ fontSize: 12, color: B.textMuted, marginBottom: 18 }}>
        Sample opportunity: <span style={{ color: B.textSecond }}>&ldquo;Community Health Innovation Fund&rdquo; (illustrative)</span>
      </div>

      {SCORE_FACTORS.map((f, i) => {
        const filled = i < barsLit;
        return (
          <div key={f.label} style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 12.5 }}>
              <span style={{ color: B.textSecond }}>
                {f.label} <span style={{ color: B.textMuted }}>· weight {f.weight}%</span>
              </span>
              <span style={{ color: filled ? B.textPrimary : B.textMuted, fontWeight: 600 }}>{filled ? `${f.value}%` : "—"}</span>
            </div>
            <div style={{ height: 8, borderRadius: 999, background: B.bgRaised, overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: filled ? `${f.value}%` : "0%",
                  background: `linear-gradient(90deg, ${B.blue}, ${B.teal})`,
                  borderRadius: 999,
                  transition: "width 900ms cubic-bezier(0.16,1,0.3,1)",
                }}
              />
            </div>
          </div>
        );
      })}

      <div style={{ display: "flex", justifyContent: "center", marginTop: 26 }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 24px",
            borderRadius: 999,
            background: scoreActive ? "rgba(16,185,129,0.14)" : B.bgRaised,
            border: `1.5px solid ${scoreActive ? B.green : B.borderFaint}`,
            transition: "background 600ms ease, border-color 600ms ease",
          }}
        >
          <span style={{ fontFamily: display, fontSize: 24, fontWeight: 800, color: scoreActive ? B.green : B.textMuted }}>
            {score}
          </span>
          <span style={{ fontSize: 13, fontWeight: 600, color: scoreActive ? B.textPrimary : B.textMuted }}>
            {scoreActive ? "Strong Fit" : "scoring…"}
          </span>
        </div>
      </div>
      <p style={{ textAlign: "center", fontSize: 11, color: B.textMuted, marginTop: 10 }}>
        Computed deterministically from the factors above — not an AI guess.
      </p>
    </div>
  );
}

// ─── Stage 4 — Draft Generator & Human Approval ─────────────────────────────

const DRAFT_SECTIONS = [
  { title: "Executive Summary", lines: [92, 74] },
  { title: "Need Statement", lines: [88, 65, 80] },
  { title: "Budget Narrative", lines: [70, 90] },
  { title: "Logic Model", lines: [82, 60, 76] },
];

function Stage4Animation({ active }: { active: boolean }) {
  const sectionsLit = useStagger(DRAFT_SECTIONS.length, active, 550, 150);
  const pendingShown = useDelayedFlag(active, 150 + DRAFT_SECTIONS.length * 550 + 500);
  const cursorArrived = useDelayedFlag(pendingShown, 900);
  const approved = useDelayedFlag(cursorArrived, 500);

  return (
    <div>
      <div className="hiw-draft-grid" style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14, marginBottom: 22 }}>
        {DRAFT_SECTIONS.map((sec, si) => {
          const on = si < sectionsLit;
          return (
            <div
              key={sec.title}
              style={{
                background: B.bgRaised,
                border: `1px solid ${B.borderFaint}`,
                borderRadius: 10,
                padding: "14px 16px",
              }}
            >
              <div style={{ fontSize: 11.5, fontWeight: 700, color: on ? B.textPrimary : B.textMuted, marginBottom: 10 }}>
                {sec.title}
              </div>
              {sec.lines.map((w, li) => (
                <div
                  key={li}
                  style={{
                    height: 7,
                    borderRadius: 4,
                    background: B.bgCard,
                    marginBottom: 6,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: on ? `${w}%` : "0%",
                      background: B.borderFaint,
                      backgroundColor: on ? "rgba(240,246,255,0.16)" : "transparent",
                      borderRadius: 4,
                      transition: `width 600ms ease ${li * 130}ms`,
                    }}
                  />
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", justifyContent: "center", marginBottom: 24 }}>
        <div
          style={fade(pendingShown, {
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 18px",
            borderRadius: 999,
            background: "rgba(245,158,11,0.1)",
            border: `1px solid rgba(245,158,11,0.35)`,
          })}
        >
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: B.amber }} />
          <span style={{ fontSize: 12.5, fontWeight: 700, color: B.amber }}>Pending Human Review</span>
        </div>
      </div>

      <div style={fade(pendingShown, { maxWidth: 380, margin: "0 auto" })}>
        <div
          style={{
            position: "relative",
            background: B.bgRaised,
            border: `1px solid ${B.borderFaint}`,
            borderRadius: 12,
            padding: "20px 22px",
          }}
        >
          <div style={{ fontSize: 11, color: B.textMuted, marginBottom: 14, letterSpacing: "0.06em", textTransform: "uppercase" }}>
            Human Review
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <IconUser color={B.textSecond} />
              <span style={{ fontSize: 12.5, color: B.textSecond }}>Program Director (illustrative)</span>
            </div>
            <button
              style={{
                position: "relative",
                padding: "8px 18px",
                borderRadius: 8,
                fontSize: 12.5,
                fontWeight: 700,
                cursor: "default",
                border: "none",
                color: approved ? "#052e1c" : "#fff",
                background: approved ? B.green : `linear-gradient(135deg, ${B.blue}, ${B.blueDark})`,
                transition: "background 400ms ease, color 400ms ease, transform 200ms ease",
                transform: cursorArrived && !approved ? "scale(0.94)" : "scale(1)",
              }}
            >
              {approved ? "✓ Approved" : "Approve"}
            </button>
          </div>
          <div
            style={{
              position: "absolute",
              right: cursorArrived ? 34 : -10,
              bottom: cursorArrived ? 26 : 40,
              opacity: pendingShown && !approved ? 1 : 0,
              transition: "right 900ms cubic-bezier(0.16,1,0.3,1), bottom 900ms cubic-bezier(0.16,1,0.3,1), opacity 300ms ease",
              pointerEvents: "none",
            }}
          >
            <IconCursor />
          </div>
        </div>
        <p style={{ textAlign: "center", fontSize: 11, color: B.textMuted, marginTop: 12 }}>
          A human always reviews and approves before a draft moves toward submission.
        </p>
      </div>
    </div>
  );
}

// ─── Stage 5 — Proven Narrative Reuse ───────────────────────────────────────

function Stage5Animation({ active }: { active: boolean }) {
  const chip1Started = useDelayedFlag(active, 300);
  const chip1Arrived = useDelayedFlag(chip1Started, 900);
  const chip2Started = useDelayedFlag(chip1Arrived, 500);
  const chip2Arrived = useDelayedFlag(chip2Started, 900);

  const chipPos = chip2Started ? 100 : chip1Started ? 50 : 4;

  const nodeStyle = (litValue: boolean): React.CSSProperties => ({
    flex: 1,
    minWidth: 150,
    background: B.bgRaised,
    border: `1px solid ${litValue ? B.border : B.borderFaint}`,
    borderRadius: 12,
    padding: "16px 14px",
    textAlign: "center",
    transition: "border-color 500ms ease",
  });

  return (
    <div>
      <div className="hiw-proven-row" style={{ position: "relative", display: "flex", gap: 16, marginBottom: 8 }}>
        <div style={nodeStyle(true)}>
          <div style={{ fontSize: 20, marginBottom: 6 }}>🏆</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: B.textPrimary }}>Awarded Application</div>
          <div style={{ fontSize: 10.5, color: B.textMuted, marginTop: 4 }}>(illustrative)</div>
        </div>
        <div style={nodeStyle(chip1Arrived)}>
          <div
            style={{
              width: 32,
              height: 32,
              margin: "0 auto 8px",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: chip1Arrived ? `${B.teal}22` : B.bgCard,
              border: `1px solid ${chip1Arrived ? B.teal : B.borderFaint}`,
              transition: "background 500ms ease, border-color 500ms ease",
            }}
          >
            <span style={{ fontSize: 14 }}>📚</span>
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, color: B.textPrimary }}>Knowledge Base</div>
          <div
            style={fade(chip1Arrived, {
              display: "inline-block",
              marginTop: 6,
              fontSize: 10.5,
              fontWeight: 700,
              color: B.teal,
              padding: "2px 8px",
              borderRadius: 999,
              background: `${B.teal}18`,
            })}
          >
            Proven ✓
          </div>
        </div>
        <div style={nodeStyle(chip2Arrived)}>
          <div style={{ fontSize: 20, marginBottom: 6 }}>📝</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: B.textPrimary }}>New Draft</div>
          <div
            style={fade(chip2Arrived, {
              marginTop: 8,
              fontSize: 10.5,
              color: B.textSecond,
              background: `${B.blue}14`,
              border: `1px solid ${B.border}`,
              borderRadius: 6,
              padding: "5px 8px",
              lineHeight: 1.4,
            })}
          >
            &ldquo;…proven language reused here (illustrative)…&rdquo;
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            top: 30,
            left: `calc(${chipPos}% - 12px)`,
            width: 24,
            height: 24,
            borderRadius: "50%",
            background: B.bgCard,
            border: `1.5px solid ${B.purple}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 11,
            transition: "left 900ms cubic-bezier(0.16,1,0.3,1)",
            boxShadow: `0 0 12px ${B.purpleGlow}`,
          }}
        >
          ✎
        </div>
      </div>
      <p style={{ textAlign: "center", fontSize: 11.5, color: B.textMuted, marginTop: 22 }}>
        Every win teaches the system — language that has actually earned a grant surfaces first next time.
      </p>
    </div>
  );
}

// ─── Stage 6 — Ongoing / Continuous Research ────────────────────────────────

function Stage6Animation({ active }: { active: boolean }) {
  const ticks = [0, 1, 2, 3, 4];
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 30 }}>
      <div style={{ position: "relative", width: 140, height: 140 }}>
        <svg width="140" height="140" viewBox="0 0 140 140">
          <circle cx="70" cy="70" r="60" fill="none" stroke={B.borderFaint} strokeWidth="1.5" />
          {ticks.map((t) => {
            const angle = (t / ticks.length) * 2 * Math.PI - Math.PI / 2;
            const x = 70 + 60 * Math.cos(angle);
            const y = 70 + 60 * Math.sin(angle);
            return <circle key={t} cx={x} cy={y} r="3" fill={B.textMuted} />;
          })}
        </svg>
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            width: 2,
            height: 52,
            background: `linear-gradient(180deg, ${B.blue}, transparent)`,
            transformOrigin: "top center",
            animation: active ? "hiwSpin 6s linear infinite" : "none",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            width: 8,
            height: 8,
            marginLeft: -4,
            marginTop: -4,
            borderRadius: "50%",
            background: B.blue,
          }}
        />
        {ticks.map((t) => {
          const angle = (t / ticks.length) * 2 * Math.PI - Math.PI / 2;
          const x = 70 + 88 * Math.cos(angle);
          const y = 70 + 88 * Math.sin(angle);
          return (
            <span
              key={t}
              style={{
                position: "absolute",
                left: x,
                top: y,
                transform: "translate(-50%, -50%)",
                fontSize: 9.5,
                color: B.textMuted,
                whiteSpace: "nowrap",
              }}
            >
              Day {t + 1}
            </span>
          );
        })}
      </div>

      <div className="hiw-signal-row" style={{ display: "flex", gap: 14, flexWrap: "wrap", justifyContent: "center" }}>
        <div
          style={{
            padding: "10px 16px",
            borderRadius: 10,
            background: B.bgRaised,
            border: `1px solid ${B.border}`,
            fontSize: 12,
            color: B.textSecond,
            animation: active ? "hiwCardPop 5s ease-in-out 0s infinite" : "none",
          }}
        >
          🆕 New match: <span style={{ color: B.textPrimary, fontWeight: 600 }}>Housing Innovation Grant</span> (illustrative)
        </div>
        <div
          style={{
            padding: "10px 16px",
            borderRadius: 10,
            background: B.bgRaised,
            border: `1px solid ${B.border}`,
            fontSize: 12,
            color: B.textSecond,
            animation: active ? "hiwCardPop 5s ease-in-out 2.5s infinite" : "none",
          }}
        >
          📡 Funder signal: <span style={{ color: B.textPrimary, fontWeight: 600 }}>leadership change</span> at Sample Foundation
        </div>
      </div>
      <p style={{ fontSize: 11, color: B.textMuted, textAlign: "center", maxWidth: 460 }}>
        Daily and weekly scheduled sweeps — not continuous real-time streaming.
      </p>
    </div>
  );
}

// ─── Stage 7 — Email Parser ──────────────────────────────────────────────────

function Stage7Animation({ active }: { active: boolean }) {
  const cursorStarted = useDelayedFlag(active, 500);
  const clicked = useDelayedFlag(cursorStarted, 900);
  const outputShown = useDelayedFlag(clicked, 350);
  const yourMove = useDelayedFlag(outputShown, 500);

  return (
    <div style={{ maxWidth: 480, margin: "0 auto" }}>
      <div
        style={{
          background: B.bgRaised,
          border: `1px solid ${B.borderFaint}`,
          borderRadius: 10,
          padding: "14px 16px",
          marginBottom: 18,
          position: "relative",
        }}
      >
        <div style={{ fontSize: 11, color: B.textMuted, marginBottom: 4 }}>giving@samplefoundation.org (illustrative)</div>
        <div style={{ fontSize: 13, color: B.textPrimary, fontWeight: 600, marginBottom: 10 }}>
          Re: Your LOI Submission
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <div
            style={{
              position: "relative",
              display: "inline-block",
              padding: "7px 16px",
              borderRadius: 7,
              fontSize: 12,
              fontWeight: 700,
              color: "#fff",
              background: clicked ? B.green : `linear-gradient(135deg, ${B.blue}, ${B.blueDark})`,
              transition: "background 400ms ease, transform 200ms ease",
              transform: cursorStarted && !clicked ? "scale(0.95)" : "scale(1)",
            }}
          >
            {clicked ? "Analyzed ✓" : "Analyze"}
          </div>
        </div>
        <div
          style={{
            position: "absolute",
            right: clicked ? 30 : 4,
            bottom: clicked ? 18 : 34,
            opacity: cursorStarted && !clicked ? 1 : cursorStarted ? 0.4 : 0,
            transition: "right 900ms cubic-bezier(0.16,1,0.3,1), bottom 900ms cubic-bezier(0.16,1,0.3,1), opacity 300ms ease",
            pointerEvents: "none",
          }}
        >
          <IconCursor />
        </div>
      </div>

      <div style={fade(outputShown)}>
        <div
          style={{
            background: B.bgRaised,
            border: `1px solid ${B.border}`,
            borderRadius: 10,
            padding: "16px 18px",
            marginBottom: 18,
          }}
        >
          <div style={{ fontSize: 10.5, color: B.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
            Structured read
          </div>
          {[
            ["Classification", "Award Notification"],
            ["Urgency", "High"],
            ["Suggested next step", "Update funder record"],
          ].map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 12.5 }}>
              <span style={{ color: B.textSecond }}>{k}</span>
              <span style={{ color: B.blue, fontWeight: 700 }}>{v}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={fade(yourMove, { display: "flex", alignItems: "center", justifyContent: "center", gap: 8 })}>
        <IconUser color={B.textSecond} />
        <span style={{ fontSize: 12.5, fontWeight: 700, color: B.textSecond }}>Your move — no reply is drafted or sent automatically</span>
      </div>
    </div>
  );
}

// ─── Stage 8 — Email Mail-Merge Campaigns ───────────────────────────────────

const CAMPAIGN_RECIPIENTS = [
  { type: "Sample Foundation", line: "Hi Dr. Alvarez — following up on our Bay Area housing initiative…" },
  { type: "Sample Nonprofit Partner", line: "Hi Marcus — exploring a co-funding opportunity for…" },
  { type: "Sample Local Business", line: "Hi Priya — your community giving program caught our eye…" },
];

function Stage8Animation({ active }: { active: boolean }) {
  const previewLit = useStagger(CAMPAIGN_RECIPIENTS.length, active, 500, 200);
  const sentLit = useStagger(CAMPAIGN_RECIPIENTS.length, active, 550, 200 + CAMPAIGN_RECIPIENTS.length * 500 + 500);

  return (
    <div className="hiw-campaign-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
      {CAMPAIGN_RECIPIENTS.map((r, i) => {
        const previewOn = i < previewLit;
        const sentOn = i < sentLit;
        return (
          <div
            key={r.type}
            style={{
              background: B.bgRaised,
              border: `1px solid ${B.borderFaint}`,
              borderRadius: 12,
              padding: "16px 16px",
              minHeight: 150,
            }}
          >
            <div style={{ fontSize: 11.5, fontWeight: 700, color: B.textPrimary, marginBottom: 10 }}>{r.type}</div>
            <div style={fade(previewOn, { fontSize: 11.5, color: B.textSecond, lineHeight: 1.5, minHeight: 44 })}>
              {r.line}
            </div>
            <div style={fade(sentOn, { marginTop: 12 })}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 10.5,
                  fontWeight: 700,
                  color: B.green,
                  background: `${B.green}18`,
                  border: `1px solid ${B.green}40`,
                  borderRadius: 999,
                  padding: "3px 10px",
                }}
              >
                Sent via Resend ✓
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Stage config ────────────────────────────────────────────────────────────

const STAGES = [
  {
    n: 1,
    title: "Onboarding & Organization Profile",
    color: B.teal,
    claim: "You tell us who you are once. We build a living profile of your organization that every other system below reads from.",
    detail:
      "Real 7-step onboarding wizard. On completion, a real organization profile is built and persisted — mission, board, focus areas, service area — with a live completeness score. It also rebuilds every time you update your Knowledge Base, so it stays current, not a one-time onboarding artifact.",
    Animation: Stage1Animation,
  },
  {
    n: 2,
    title: "Opportunity Research & Discovery",
    color: B.blue,
    claim: "Every day, AG-17 checks federal and state funding sources against your organization's real focus areas — filtering out what doesn't fit before a human ever sees it.",
    detail:
      "Two always-on federal sources — Grants.gov (daily) and SAM.gov (weekly) — plus a growing set of state portals and a 990-filing mining script that exists but isn't yet run on a schedule. Not “thousands of sources in real time” — a real, honest cadence.",
    Animation: Stage2Animation,
  },
  {
    n: 3,
    title: "Filtering & Scoring",
    color: B.purple,
    claim: "Every opportunity gets a transparent, deterministic score — not a vague AI opinion. You can see exactly which factors drove the number.",
    detail:
      "The score is computed by a deterministic engine, hand-verified factor-by-factor against real production data and matched exactly — not an AI guess. The discovery → scoring chain fires automatically once an opportunity clears discovery.",
    Animation: Stage3Animation,
  },
  {
    n: 4,
    title: "Draft Generator & AutoApply Population",
    color: B.amber,
    claim: "Once a fit is confirmed, our AI drafts a real, narrative-complete application for you — but it never submits anything on its own. A human always reviews and approves first.",
    detail:
      "When a score clears your threshold, a real draft is generated automatically and every autonomous draft is hard-coded to require human approval before it can advance. Reaching AutoApply's submission queue is a separate, mostly human-gated step — not an automatic consequence of drafting.",
    Animation: Stage4Animation,
  },
  {
    n: 5,
    title: "Proven Narrative Reuse",
    color: B.green,
    claim: "Every win teaches the system. Language that's actually earned a grant before gets surfaced first for your next application in the same funder category.",
    detail:
      "When an application is marked awarded or partial, winning narrative sections are extracted and filed as proven narratives with a real effectiveness score. Every new draft in that funder category pulls proven language back in automatically — the write path and the read path are both real, confirmed end to end.",
    Animation: Stage5Animation,
  },
  {
    n: 6,
    title: "Ongoing / Continuous Research",
    color: B.red,
    claim: "The system doesn't stop after the first search. Every day it re-checks federal and state sources, and separately watches your existing funders for leadership changes, new funding priorities, and public recognition.",
    detail:
      "Genuinely scheduled: Grants.gov (daily), SAM.gov (weekly), state portals (weekly where wired), and a funder signal monitor covering news + 990 data (LinkedIn explicitly excluded for ToS reasons). Not continuous: large-scale 990 mining and NIH/NSF/Federal Register ingestion exist as real scripts but run manually today, not on an autonomous cron.",
    Animation: Stage6Animation,
  },
  {
    n: 7,
    title: "Email Parser: Classification, Not Auto-Reply",
    color: B.blue,
    claim: "When a funder emails you, hand it to the system and get an instant, structured read — what kind of email it is, what's being asked, how urgent it is. The system flags it and tells you what to do next — it does not write or send replies on your behalf.",
    detail:
      "Live-verified: classification, structured field extraction, and fuzzy funder-matching all work against real data. Confirmed absent: no Gmail webhook exists, so classification only runs when a user manually hands the system an email, and there is no auto-reply or auto-send capability anywhere in the system.",
    Animation: Stage7Animation,
  },
  {
    n: 8,
    title: "Email Mail-Merge Campaigns",
    color: B.teal,
    claim: "One system to reach out — foundations, peer nonprofits, or local businesses — with a personalized, multi-step email sequence, sent for real through your own send infrastructure.",
    detail:
      "Sending is real — a genuine Resend API call, personalized per recipient across foundations, nonprofits, or local businesses. Today, campaigns go out when you trigger a send; fully autonomous daily scheduling is the next step, not yet switched on.",
    Animation: Stage8Animation,
  },
];

// ─── Page ────────────────────────────────────────────────────────────────────

export default function HowItWorksClient() {
  return (
    <div style={{ backgroundColor: B.bg, color: B.textPrimary, fontFamily: sans, minHeight: "100vh", overflowX: "hidden" }}>
      <style
        // dangerouslySetInnerHTML (not a JSX text child) so the raw CSS string is
        // never routed through React's text-node SSR/CSR diffing — a plain
        // `<style>{`...`}</style>` here would HTML-entity-escape the apostrophe in
        // the @import url() server-side but not client-side, causing a hydration
        // text-mismatch warning (reproduced on the homepage's own identical pattern).
        dangerouslySetInnerHTML={{
          __html: `
        @import url("https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Inter:wght@400;500;600&display=swap");
        *, *::before, *::after { box-sizing: border-box; }
        a { text-decoration: none; color: inherit; }
        body { -webkit-font-smoothing: antialiased; }
        @keyframes hiwFadeUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes hiwPulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(14,165,233,0.25); } 50% { box-shadow: 0 0 0 6px rgba(14,165,233,0); } }
        @keyframes hiwSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes hiwCardPop { 0%, 12% { opacity: 0; transform: translateY(6px); } 20%, 70% { opacity: 1; transform: translateY(0); } 82%, 100% { opacity: 0; transform: translateY(-4px); } }
        .hiw-hero-fu { animation: hiwFadeUp 0.7s ease both; }
        .hiw-cta-primary:hover { filter: brightness(1.12); }
        .hiw-back:hover { color: ${B.textPrimary} !important; }

        @media (max-width: 640px) {
          .hiw-steps-row { gap: 4px; }
          .hiw-draft-grid { grid-template-columns: 1fr !important; }
          .hiw-campaign-grid { grid-template-columns: 1fr !important; }
          .hiw-proven-row { flex-direction: column; }
          .hiw-proven-row > div[style*="position: absolute"] { display: none; }
          .hiw-source-row { gap: 8px !important; }
          .hiw-signal-row { flex-direction: column; align-items: center; }
        }
      `,
        }}
      />

      {/* Nav */}
      <nav
        style={{
          position: "sticky",
          top: 0,
          zIndex: 200,
          backgroundColor: "rgba(8,12,20,0.85)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          borderBottom: `1px solid ${B.borderFaint}`,
          padding: "0 24px",
          height: 64,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Link href="/" className="hiw-back" style={{ display: "flex", alignItems: "center", gap: 10, color: B.textSecond, fontSize: 13.5, fontWeight: 500, transition: "color 200ms ease" }}>
          <Image src="/benavora_logo.png" alt="Benavora" width={32} height={24} style={{ height: 24, width: "auto", objectFit: "contain" }} />
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ transform: "rotate(180deg)", display: "inline-flex" }}><IconArrow /></span>
            Back to home
          </span>
        </Link>
        <Link
          href="/register"
          className="hiw-cta-primary"
          style={{
            fontSize: 13.5,
            fontWeight: 700,
            color: "#fff",
            padding: "8px 18px",
            borderRadius: 8,
            background: `linear-gradient(135deg, ${B.blue}, ${B.blueDark})`,
            transition: "filter 200ms ease",
          }}
        >
          Start Free Trial
        </Link>
      </nav>

      {/* Hero */}
      <section style={{ maxWidth: 820, margin: "0 auto", padding: "88px 20px 64px", textAlign: "center" }}>
        <div
          className="hiw-hero-fu"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            background: `linear-gradient(135deg, ${B.blueGlow}, ${B.purpleGlow})`,
            border: `1px solid ${B.border}`,
            borderRadius: 999,
            padding: "6px 16px",
            marginBottom: 26,
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: `linear-gradient(135deg, ${B.blue}, ${B.purple})` }} />
          <span style={{ fontSize: 12.5, color: B.blue, fontWeight: 600, letterSpacing: "0.04em" }}>The Real Pipeline</span>
        </div>
        <h1
          className="hiw-hero-fu"
          style={{
            fontFamily: display,
            fontSize: "clamp(32px, 5.5vw, 54px)",
            fontWeight: 800,
            lineHeight: 1.12,
            letterSpacing: "-0.02em",
            marginBottom: 22,
          }}
        >
          How Benavora <span style={{ background: `linear-gradient(135deg, ${B.blue} 0%, ${B.purple} 100%)`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>actually works</span>
        </h1>
        <p className="hiw-hero-fu" style={{ fontSize: 16.5, lineHeight: 1.65, color: B.textSecond, maxWidth: 560, margin: "0 auto" }}>
          Discovery, scoring, and drafting — with a human approving every step out — then learning from every
          win and keeping watch afterward. Eight real stages, scrolled through with sample data so you can see exactly
          how each one works.
        </p>
      </section>

      {/* Stages */}
      <div>
        {STAGES.map((s) => (
          <StageShell key={s.n} n={s.n} color={s.color} title={s.title} claim={s.claim} detail={s.detail}>
            {(active) => <s.Animation active={active} />}
          </StageShell>
        ))}
      </div>

      {/* Closing CTA */}
      <section
        style={{
          backgroundColor: B.bgCard,
          borderTop: `1px solid ${B.borderFaint}`,
          padding: "90px 24px",
          textAlign: "center",
        }}
      >
        <div style={{ maxWidth: 560, margin: "0 auto" }}>
          <h2
            style={{
              fontFamily: display,
              fontSize: "clamp(28px, 4vw, 40px)",
              fontWeight: 800,
              letterSpacing: "-0.02em",
              lineHeight: 1.15,
              marginBottom: 18,
            }}
          >
            See it run on your own organization.
          </h2>
          <p style={{ fontSize: 16, color: B.textSecond, lineHeight: 1.65, marginBottom: 36 }}>
            Fourteen days free. No credit card required.
          </p>
          <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
            <Link
              href="/register"
              className="hiw-cta-primary"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                background: `linear-gradient(135deg, ${B.blue}, ${B.blueDark})`,
                color: "#fff",
                fontSize: 15,
                fontWeight: 700,
                padding: "14px 30px",
                borderRadius: 10,
                boxShadow: `0 0 32px rgba(14,165,233,0.3)`,
                transition: "filter 200ms ease",
              }}
            >
              Start Free Trial <IconArrow color="#fff" />
            </Link>
            <Link
              href="/"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                color: B.textSecond,
                fontSize: 14,
                fontWeight: 500,
                padding: "14px 20px",
                borderRadius: 10,
                border: `1px solid ${B.borderFaint}`,
              }}
            >
              Back to homepage
            </Link>
          </div>
        </div>
      </section>

      <footer
        style={{
          backgroundColor: B.bg,
          borderTop: `1px solid ${B.borderFaint}`,
          padding: "24px 24px",
          textAlign: "center",
        }}
      >
        <span style={{ fontSize: 12.5, color: B.textMuted }}>© 2026 Benavora</span>
      </footer>
    </div>
  );
}
