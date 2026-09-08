"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import { LIFECYCLE_FLOW_EVENT } from "@/components/marketing/NeuralFleetVisualization";
import { BotanicalMotif } from "@/components/marketing/BotanicalMotif";
import { mkGrainBackground, SectionDividerDef } from "@/lib/marketing/texture";

type CSSVars = CSSProperties & Record<`--${string}`, string | number>;

// Six-stage summary of the lifecycle already itemized in more granular form as
// "The funding lifecycle" further down this page (Organization Intelligence →
// Continuous Optimization). Placed directly after the NeuralFleetVisualization
// so the two sections reinforce each other: that section shows the 9
// specialist divisions, this one shows what they do, in order. Division names,
// agent counts, and accent colors are taken verbatim from FAMILIES/COLORS in
// NeuralFleetVisualization.tsx — not invented independently.
const STAGES: {
  label: string;
  blurb: string;
  divisions: { name: string; color: string }[];
}[] = [
  {
    label: "Discover",
    blurb: "Continuously surfaces individuals, foundations, companies, and time-sensitive funding signals worth pursuing.",
    divisions: [{ name: "Prospect Discovery", color: "#b565ff" }],
  },
  {
    label: "Qualify",
    blurb: "Builds evidence-backed intelligence on each opportunity, then scores fit, capacity, and readiness before it reaches a human.",
    divisions: [
      { name: "Donor Intelligence", color: "#ff4fc8" },
      { name: "Opportunity Scoring", color: "#ffe66d" },
    ],
  },
  {
    label: "Prepare",
    blurb: "Drafts narrative and positioning from your organization's own knowledge base, and assembles the supporting materials an application needs.",
    divisions: [{ name: "Engagement Strategy", color: "#42f5b6" }],
  },
  {
    label: "Apply",
    blurb: "Navigates the portal, completes the form from verified information, and holds for staff review before anything submits.",
    divisions: [{ name: "Auto Apply", color: "#91f28c" }],
  },
  {
    label: "Follow Up",
    blurb: "Tracks engagement history and recommends the next credible action—and, once a status changes, the right next move.",
    divisions: [{ name: "Relationship Mapping", color: "#ff9f43" }],
  },
  {
    label: "Learn",
    blurb: "Reconciles conflicting sources, flags stale intelligence, and keeps the fleet itself running—so the next cycle starts smarter.",
    divisions: [
      { name: "Intelligence Assurance", color: "#21e6e6" },
      { name: "Continuous Optimization", color: "#ff657a" },
    ],
  },
];

// Reverse-lookup so a division picked in the brain diagram above can highlight
// its "home" stage(s) here. Mission Control has no entry — it coordinates all
// six stages rather than owning one — so it falls through to ALL_STAGE_INDEXES.
const DIVISION_HOME_STAGES = new Map<string, number[]>();
STAGES.forEach((stage, stageIndex) => {
  stage.divisions.forEach((d) => {
    const existing = DIVISION_HOME_STAGES.get(d.name) ?? [];
    existing.push(stageIndex);
    DIVISION_HOME_STAGES.set(d.name, existing);
  });
});
const ALL_STAGE_INDEXES = STAGES.map((_, i) => i);
const FALLBACK_FLOW_COLOR = "#efb344";

// Anchor points for the flow path, in the SVG's 1200x200 viewBox. A gentle
// zigzag rather than a straight line, echoing the wire aesthetic of the brain
// diagram above.
const FLOW_POINTS: [number, number][] = [
  [60, 112],
  [276, 66],
  [492, 142],
  [708, 66],
  [924, 142],
  [1140, 96],
];

function buildFlowPath(points: [number, number][]): string {
  const first = points[0] ?? [0, 0];
  let d = `M${first[0]} ${first[1]}`;
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i - 1] ?? [0, 0];
    const [x2, y2] = points[i] ?? [0, 0];
    const dx = (x2 - x1) / 2;
    d += ` C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`;
  }
  return d;
}
const FLOW_PATH_D = buildFlowPath(FLOW_POINTS);
const PARTICLE_COUNT = 5;
const PARTICLE_STAGGER = 0.055;
const SWEEP_DURATION_MS = 4200;
const COOLDOWN_MS = 1100;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export function HowItWorksLifecycle() {
  const [litUpTo, setLitUpTo] = useState(-1);
  const [homeStages, setHomeStages] = useState<Set<number>>(new Set());
  const [activeColor, setActiveColor] = useState<string | null>(null);
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const pathRef = useRef<SVGPathElement | null>(null);
  const particleRefs = useRef<(SVGCircleElement | null)[]>([]);
  const rafRef = useRef<number | null>(null);
  const cooldownRef = useRef<number | null>(null);
  const litRef = useRef(-1);

  const clearParticles = () => {
    particleRefs.current.forEach((el) => {
      if (el) el.style.opacity = "0";
    });
  };

  const playSequence = useCallback((color: string, homeStageIndexes: number[], label: string) => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    if (cooldownRef.current !== null) window.clearTimeout(cooldownRef.current);

    setActiveColor(color);
    setActiveLabel(label);
    setHomeStages(new Set(homeStageIndexes));
    litRef.current = -1;
    setLitUpTo(-1);

    if (prefersReducedMotion()) {
      setIsPlaying(false);
      setLitUpTo(5);
      cooldownRef.current = window.setTimeout(() => {
        setLitUpTo(-1);
        setActiveColor(null);
        setActiveLabel(null);
      }, 1600);
      return;
    }

    const pathEl = pathRef.current;
    if (!pathEl) return;
    const totalLength = pathEl.getTotalLength();
    setIsPlaying(true);

    const start = performance.now();
    const tick = (now: number) => {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / SWEEP_DURATION_MS);
      const stage = Math.min(5, Math.floor(t * 6));
      if (stage !== litRef.current) {
        litRef.current = stage;
        setLitUpTo(stage);
      }
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const el = particleRefs.current[i];
        if (!el) continue;
        const pt = t - i * PARTICLE_STAGGER;
        if (pt < 0 || pt > 1) {
          el.style.opacity = "0";
          continue;
        }
        const { x, y } = pathEl.getPointAtLength(pt * totalLength);
        el.setAttribute("cx", String(x));
        el.setAttribute("cy", String(y));
        el.style.opacity = String(1 - i * 0.2);
      }
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
        setIsPlaying(false);
        cooldownRef.current = window.setTimeout(() => {
          setLitUpTo(-1);
          setActiveColor(null);
          setActiveLabel(null);
          clearParticles();
        }, COOLDOWN_MS);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    const onLifecycleFlow = (e: Event) => {
      const detail = (e as CustomEvent<{ index: number; name: string; color: string }>).detail;
      if (!detail) return;
      const homeStageIndexes = DIVISION_HOME_STAGES.get(detail.name) ?? ALL_STAGE_INDEXES;
      playSequence(detail.color, homeStageIndexes, detail.name);
    };
    window.addEventListener(LIFECYCLE_FLOW_EVENT, onLifecycleFlow);
    return () => window.removeEventListener(LIFECYCLE_FLOW_EVENT, onLifecycleFlow);
  }, [playSequence]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (cooldownRef.current !== null) window.clearTimeout(cooldownRef.current);
    };
  }, []);

  const handleReplay = () => {
    playSequence(FALLBACK_FLOW_COLOR, ALL_STAGE_INDEXES, "Mission Control");
  };

  return (
    <section
      className="bm-hiw"
      aria-labelledby="hiw-title"
      style={{ position: "relative", ...mkGrainBackground("#222624", true) }}
    >
      <BotanicalMotif
        variant="roots"
        color="#efb344"
        opacity={0.1}
        style={{ right: -30, top: -10, width: 220, height: 220 }}
      />
      <p className="bm-eyebrow">How does it work</p>
      <h2 id="hiw-title">
        Six stages. The same divisions you just explored above.
      </h2>
      <p className="bm-hiw-lede">
        Mission Control coordinates every stage below across all 48 agents; each stage itself is carried by one or
        more of the specialist divisions in the network above—shown here in their matching accent color. Select a
        division above, or replay the sequence here, to watch it move through the lifecycle.
      </p>

      <button type="button" className="bm-hiw-replay" onClick={handleReplay}>
        <span aria-hidden="true" className="bm-hiw-replay-dot" />
        Replay the lifecycle sequence
      </button>

      <div className="bm-hiw-flow" aria-hidden="true" style={{ "--flow": activeColor ?? "#5c6459" } as CSSVars}>
        <svg viewBox="0 0 1200 200" preserveAspectRatio="xMidYMid meet" className="bm-hiw-flow-svg">
          <path ref={pathRef} className="bm-hiw-flow-track" d={FLOW_PATH_D} />
          <path
            className={`bm-hiw-flow-progress${isPlaying ? " is-playing" : ""}`}
            d={FLOW_PATH_D}
            style={{ "--stage": litUpTo } as CSSVars}
          />
          {FLOW_POINTS.map(([x, y], i) => (
            <circle
              key={`anchor-${STAGES[i]?.label}`}
              cx={x}
              cy={y}
              r={litUpTo >= i ? 10 : 7}
              className={`bm-hiw-flow-anchor${litUpTo >= i ? " is-lit" : ""}${homeStages.has(i) ? " is-home" : ""}`}
              style={{ "--dot": STAGES[i]?.divisions[0]?.color ?? "#5c6459" } as CSSVars}
            />
          ))}
          {Array.from({ length: PARTICLE_COUNT }).map((_, i) => (
            <circle
              key={`particle-${i}`}
              ref={(el) => {
                particleRefs.current[i] = el;
              }}
              r={i === 0 ? 6 : 4}
              className="bm-hiw-flow-particle"
              style={{ opacity: 0 }}
            />
          ))}
        </svg>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {isPlaying && activeLabel ? `Playing the lifecycle sequence for ${activeLabel}.` : ""}
      </p>

      <ol className="bm-hiw-row">
        {STAGES.map((s, i) => (
          <li key={s.label} className="bm-hiw-stage">
            {i > 0 ? <span className="bm-hiw-arrow" aria-hidden="true">&rarr;</span> : null}
            <div
              className={`bm-hiw-card${litUpTo >= i ? " is-lit" : ""}${homeStages.has(i) ? " is-home" : ""}`}
              style={{ "--flow": activeColor ?? "#5c6459" } as CSSVars}
            >
              <span className="bm-hiw-num">{i + 1}</span>
              <h3>{s.label}</h3>
              <p>{s.blurb}</p>
              <div className="bm-hiw-divisions">
                {s.divisions.map((d) => (
                  <span key={d.name} className="bm-hiw-division">
                    <i aria-hidden="true" style={{ background: d.color, boxShadow: `0 0 6px ${d.color}` }} />
                    {d.name}
                  </span>
                ))}
              </div>
            </div>
          </li>
        ))}
      </ol>

      <Link href="/how-it-works" className="bm-hiw-link">
        See the full pipeline, stage by stage <span aria-hidden="true">&rarr;</span>
      </Link>

      <SectionDividerDef variant="diagonal" fill="#222624" />

      <style jsx>{`
        .bm-hiw {
          max-width: 1120px;
          margin: 0 auto;
          text-align: center;
          padding: 64px 32px 72px;
          border-top: 1px solid #3b403b;
        }
        .bm-eyebrow {
          font-size: 14px;
          font-weight: 600;
          letter-spacing: 0.02em;
          color: #b9cbbd;
        }
        .bm-hiw h2 {
          font-size: clamp(28px, 3vw, 38px);
          line-height: 1.25;
          letter-spacing: -0.02em;
          font-weight: 550;
          color: #f0f2ee;
          max-width: 760px;
          margin: 18px auto 0;
        }
        .bm-hiw-lede {
          color: #bdc4be;
          max-width: 680px;
          margin: 18px auto 0;
          font-size: 15px;
          line-height: 1.75;
        }
        .bm-hiw-replay {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          margin-top: 22px;
          padding: 9px 18px;
          border-radius: 999px;
          border: 1px solid #4a5049;
          background: #2b302b;
          color: #e9ede8;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: border-color 0.2s, background 0.2s;
        }
        .bm-hiw-replay:hover {
          border-color: #efb344;
          background: #313730;
        }
        .bm-hiw-replay:focus-visible {
          outline: 2px solid #fff;
          outline-offset: 3px;
        }
        .bm-hiw-replay-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #efb344;
          box-shadow: 0 0 6px #efb344;
        }
        .bm-hiw-flow {
          margin: 28px auto 0;
          max-width: 1000px;
        }
        .bm-hiw-flow-svg {
          width: 100%;
          height: auto;
          display: block;
          overflow: visible;
        }
        .bm-hiw-flow-track {
          fill: none;
          stroke: #3b403b;
          stroke-width: 2;
        }
        .bm-hiw-flow-progress {
          fill: none;
          stroke: var(--flow, #5c6459);
          stroke-width: 2.5;
          opacity: 0.35;
          transition: opacity 0.3s;
        }
        .bm-hiw-flow-progress.is-playing {
          opacity: 0.85;
          filter: drop-shadow(0 0 5px var(--flow, #5c6459));
        }
        .bm-hiw-flow-anchor {
          fill: #222624;
          stroke: var(--dot, #5c6459);
          stroke-width: 2;
          transition: r 0.3s cubic-bezier(0.2, 0.8, 0.2, 1), fill 0.3s;
        }
        .bm-hiw-flow-anchor.is-lit {
          fill: var(--dot, #5c6459);
          filter: drop-shadow(0 0 8px var(--dot, #5c6459));
        }
        .bm-hiw-flow-anchor.is-home {
          stroke-width: 3;
          stroke-dasharray: 2 3;
        }
        .bm-hiw-flow-particle {
          fill: var(--flow, #efb344);
          filter: drop-shadow(0 0 6px var(--flow, #efb344));
        }
        .sr-only {
          position: absolute;
          width: 1px;
          height: 1px;
          padding: 0;
          margin: -1px;
          overflow: hidden;
          clip: rect(0, 0, 0, 0);
          white-space: nowrap;
          border: 0;
        }
        .bm-hiw-row {
          list-style: none;
          margin: 32px 0 0;
          padding: 0;
          display: flex;
          align-items: stretch;
          justify-content: center;
          gap: 0;
          flex-wrap: wrap;
        }
        .bm-hiw-stage {
          display: flex;
          align-items: stretch;
        }
        .bm-hiw-arrow {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 18px;
          flex: 0 0 auto;
          color: #5c6459;
          font-size: 14px;
        }
        .bm-hiw-card {
          position: relative;
          text-align: left;
          width: 152px;
          background: #202320;
          border: 1px solid #3b403b;
          border-radius: 16px;
          padding: 16px 13px;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.35), 0 6px 16px -6px rgba(0, 0, 0, 0.45),
            inset 0 1px 0 rgba(255, 255, 255, 0.06);
          transition: border-color 0.3s, box-shadow 0.3s, transform 0.3s;
        }
        .bm-hiw-card.is-lit {
          border-color: var(--flow, #5c6459);
          box-shadow: 0 0 0 1px color-mix(in srgb, var(--flow, #5c6459) 45%, transparent), 0 0 22px
            color-mix(in srgb, var(--flow, #5c6459) 35%, transparent);
          transform: translateY(-3px);
        }
        .bm-hiw-card.is-home {
          border-style: dashed;
        }
        .bm-hiw-num {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: #2b302b;
          border: 1px solid #4a5049;
          color: #cfd6cf;
          font-size: 12px;
          font-weight: 600;
        }
        .bm-hiw-card h3 {
          margin: 12px 0 8px;
          font-size: 17px;
          font-weight: 600;
          color: #f2f5ef;
        }
        .bm-hiw-card p {
          margin: 0;
          font-size: 12px;
          line-height: 1.5;
          color: #b3bab4;
          min-height: 100px;
        }
        .bm-hiw-divisions {
          margin-top: 12px;
          padding-top: 12px;
          border-top: 1px solid #34382f;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .bm-hiw-division {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          font-size: 11px;
          color: #9fa89f;
        }
        .bm-hiw-division i {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          flex: 0 0 auto;
        }
        .bm-hiw-link {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          margin-top: 36px;
          color: #efb344;
          font-weight: 600;
          font-size: 14px;
          text-decoration: none;
        }
        .bm-hiw-link:hover {
          color: #f5c469;
        }
        @media (prefers-reduced-motion: reduce) {
          .bm-hiw-flow-particle {
            display: none;
          }
          .bm-hiw-card,
          .bm-hiw-flow-anchor,
          .bm-hiw-flow-progress {
            transition: none;
          }
        }
        @media (max-width: 900px) {
          .bm-hiw-row {
            flex-direction: column;
            align-items: center;
          }
          .bm-hiw-arrow {
            width: auto;
            height: 24px;
            transform: rotate(90deg);
          }
          .bm-hiw-card {
            width: 100%;
            max-width: 340px;
          }
          .bm-hiw-card p {
            min-height: 0;
          }
        }
        @media (max-width: 640px) {
          .bm-hiw {
            padding: 44px 24px 52px;
          }
          .bm-hiw-flow {
            max-width: 100%;
          }
        }
      `}</style>
    </section>
  );
}
