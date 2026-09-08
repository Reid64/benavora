"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { BotanicalMotif } from "@/components/marketing/BotanicalMotif";
import { mkGrainBackground, SectionDividerDef } from "@/lib/marketing/texture";

// A style object that also carries CSS custom properties (--node, --wire, etc).
type CSSVars = CSSProperties & Record<`--${string}`, string | number>;

type Family = {
  name: string;
  count: number;
  role: string;
  desc: string;
};

type AgentEntry = [id: string, name: string, desc: string];

// 9 specialist divisions across the 48-agent fleet. Index 8 (Auto Apply) is a
// later addition that spans 3 coordinating agents across 8 capabilities.
const FAMILIES: Family[] = [
  {
    name: "Mission Control",
    count: 6,
    role: "Govern · coordinate · assure",
    desc: "Sets objectives, delegates dynamically, adjudicates uncertainty, enforces policy, and keeps all 48 agents aligned to mission and evidence.",
  },
  {
    name: "Prospect Discovery",
    count: 9,
    role: "Search · detect · surface",
    desc: "Continuously discovers overlooked individuals, foundations, companies, networks, and time-sensitive philanthropic signals.",
  },
  {
    name: "Donor Intelligence",
    count: 10,
    role: "Enrich · infer · connect",
    desc: "Builds evidence-backed prospect intelligence across capacity, affinity, influence, philanthropic history, timing, and intent.",
  },
  {
    name: "Relationship Mapping",
    count: 6,
    role: "Map · connect · cultivate",
    desc: "Reveals warm pathways, shared affiliations, relationship strength, engagement history, and the most credible route to trust.",
  },
  {
    name: "Opportunity Scoring",
    count: 5,
    role: "Score · verify · prioritize",
    desc: "Separates real opportunity from noise through multidimensional fit, capacity, readiness, confidence, and evidence scoring.",
  },
  {
    name: "Engagement Strategy",
    count: 4,
    role: "Position · sequence · advance",
    desc: "Creates personalized next-best actions, cultivation sequences, narratives, timing strategies, and ask recommendations.",
  },
  {
    name: "Intelligence Assurance",
    count: 4,
    role: "Prove · reconcile · protect",
    desc: "Tracks provenance, challenges unsupported conclusions, resolves conflicting sources, and safeguards freshness and factual integrity.",
  },
  {
    name: "Continuous Optimization",
    count: 1,
    role: "Observe · balance · recover",
    desc: "Keeps the complete agent fleet operational through workload balancing, observability, graceful recovery, and continuous execution.",
  },
  {
    name: "Auto Apply",
    count: 3,
    role: "Prepare · navigate · submit",
    desc: "Turn qualified opportunities into complete applications with verified information, coordinated browser workflows, independent review, and confirmation tracking.",
  },
];

const AUTO_APPLY_INDEX = 8;

const INVENTORIES: AgentEntry[][] = [
  [
    ["1", "System Health Monitor", "Checks agent status, database health, API availability, and alerting."],
    ["2", "Phase Orchestrator", "Triggers appropriate agents based on completion gates and the dependency chain."],
    ["3", "Priority Sequencer", "Ranks which prospects process next based on QLF scores."],
    ["4", "Resource Manager", "Manages API rate limits, database connections, and compute scaling."],
    ["5", "Conflict Escalator", "Routes high-uncertainty and ambiguous records to human review queues."],
    ["6", "Performance Reporter", "Generates dashboards, quality metrics, and batch summaries."],
  ],
  [
    ["1", "Individual Donor Discovery", "Finds individuals with $100K+ wealth and philanthropic signals."],
    ["2", "Major Donor Discovery", "Finds high-net-worth individuals with $1M+ and foundation founders."],
    ["3", "Foundation Discovery", "Finds private and family foundations with $500K+ assets."],
    ["4", "Corporate Giving Discovery", "Finds companies with giving programs through sources such as SAM.gov and Grants.gov."],
    ["4.5", "Keyword/Industry Business Discovery", "Finds NAICS-filtered companies by sector."],
    ["5", "Executive & Board Member Discovery", "Finds C-suite executives and board members from major companies."],
    ["6", "Geographic Discovery", "Finds prospects in target ZIP codes and metros with wealth signals."],
    ["7", "Cause-Aligned Discovery", "Finds prospects already engaged in aligned causes through boards and prior giving."],
    ["8", "Hidden & Rediscovery", "Re-evaluates cold prospects in the database with fresh external data."],
  ],
  [
    ["1", "Biography Intelligence", "Builds birthplace, education, family, and career arc intelligence from sources such as Wikipedia and news."],
    ["2", "Wealth Indicators & Assets", "Assesses net worth, real estate, stocks, and business equity through property and SEC data."],
    ["3", "Business Ownership & Leadership", "Identifies founder status, positions, board seats, and investments."],
    ["4", "Giving History & Patterns", "Analyzes lifetime giving, annual averages, cause focus, and trends from 990 filings."],
    ["5", "Nonprofit Board Positions", "Finds current and past board seats, roles, tenure, and sector diversity."],
    ["6", "Education & Academic Background", "Verifies degrees, institutions, fields, honors, and institutional tier."],
    ["7", "Professional Network & Connections", "Maps LinkedIn connections, shared boards, and network influence."],
    ["8", "Media Mentions & Public Profile", "Analyzes news, speaking, awards, books, and public visibility."],
    ["9", "Social Media & Digital Presence", "Assesses LinkedIn, X/Twitter, personal websites, and content themes."],
    ["10", "Contact Intelligence & Data Verification", "Verifies email, phone, address, and best contact method."],
  ],
  [
    ["1", "Relationship History & Contact Log", "Consolidates all past interactions, calls, emails, and meetings."],
    ["2", "Engagement Level Assessment", "Scores how actively engaged the prospect is from 0–100."],
    ["3", "Communication Preference Inference", "Infers email, phone, or in-person preference, best times, and cadence."],
    ["4", "Touch Point Recommendation", "Recommends the next logical outreach type: information meeting, proposal, or ask."],
    ["5", "Relationship Manager Assignment", "Routes the prospect to the right staff member based on capacity and interest."],
    ["6", "Next Action Recommendation", "Determines what should happen with the prospect in the next 30 days."],
  ],
  [
    ["1", "Capacity Score Calculation", "Combines wealth, giving history, and board breadth into a 0–100 capacity score."],
    ["2", "Readiness Scoring", "Estimates whether the prospect is likely to respond now using engagement and timeline signals."],
    ["3", "Interest Alignment Scoring", "Measures how closely the prospect matches the nonprofit mission and cause."],
    ["4", "Competitive Risk Assessment", "Estimates likelihood of supporting competing nonprofits and related conflicts."],
    ["5", "Priority Ranking", "Produces a unified score across capacity, readiness, interest, and risk."],
  ],
  [
    ["1", "Solicitation Amount Recommendation", "Recommends the ask amount from capacity and giving history."],
    ["2", "Approach Strategy", "Selects major gift, planned giving, board recruitment, partnership, or another approach."],
    ["3", "Message Personalization", "Identifies the angle and story most likely to resonate with values, prior giving, and board interests."],
    ["4", "Timeline & Sequencing", "Determines when to approach and in what order relative to other prospects."],
  ],
  [
    ["1", "Data Conflict Detection & Resolution", "Finds contradictions across sources and applies authority rules."],
    ["2", "Stale Data Identification", "Flags intelligence older than 180 days and recommends refresh."],
    ["3", "Accuracy Scoring", "Scores the reliability of the prospect's total intelligence profile."],
    ["4", "Intelligence Gap Identification", "Identifies missing evidence that blocks or weakens QLF scoring."],
  ],
  [
    ["1", "Agent Orchestration & Scheduling", "Determines when to run each agent, manages dependencies, and performs restart recovery."],
  ],
  [
    ["1", "Application Planning", "Turns qualified opportunities into actionable application plans."],
    ["2", "Portal Navigation", "Navigates application websites and multistep forms."],
    ["3", "Account & Access", "Coordinates registration, sign-in, and email verification."],
    ["4", "Intelligent Form Completion", "Maps verified nonprofit information to required fields."],
    ["5", "Document Preparation", "Selects, validates, and uploads supporting materials."],
    ["6", "Exception Recovery", "Responds to portal changes and interrupted workflows."],
    ["7", "Submission Review", "Checks completeness, accuracy, and authorization before submission."],
    ["8", "Confirmation & Tracking", "Captures submission evidence and synchronizes application status."],
  ],
];

// Neon accent per division, also feeds the wire/arc colors.
const COLORS = ["#36c9ff", "#b565ff", "#ff4fc8", "#ff9f43", "#ffe66d", "#42f5b6", "#21e6e6", "#ff657a", "#91f28c"];

// Anchor points in the SVG's 1120x700 viewBox, matching each node's resting
// position (as a percentage of the stage). Used only as an initial value
// before the first live measurement paints the real wires.
const POINTS: [number, number][] = [
  [392, 70],
  [985, 98],
  [985, 350],
  [850, 560],
  [560, 630],
  [270, 560],
  [135, 350],
  [135, 98],
  [728, 70],
];
const CORE: [number, number] = [560, 350];

function wirePath([x, y]: [number, number], [cx, cy]: [number, number]): string {
  const curveX = (x + cx) / 2 + (y - cy) * 0.1;
  const curveY = (y + cy) / 2 - (x - cx) * 0.08;
  return `M${cx} ${cy} Q${curveX} ${curveY} ${x} ${y}`;
}

/** POINTS[i] with a safe fallback — always defined in practice (one entry per FAMILIES/node). */
function pointAt(i: number): [number, number] {
  return POINTS[i] ?? CORE;
}

const INITIAL_WIRES = FAMILIES.map((_, i) => wirePath(pointAt(i), CORE));

// Ambient floating specks behind the core - purely decorative.
const NEURONS: { left: string; top: string; fire: string; pulse: string; delay: string }[] = [
  { left: "48.4%", top: "31.1%", fire: "#fff59b", pulse: "2.3s", delay: "-.6s" },
  { left: "36.1%", top: "39.4%", fire: "#fff07a", pulse: "3.1s", delay: "-1.9s" },
  { left: "25.2%", top: "26.8%", fire: "#ff74ee", pulse: "2.7s", delay: "-.2s" },
  { left: "58.1%", top: "25.2%", fire: "#f64cff", pulse: "3.4s", delay: "-2.2s" },
  { left: "69.7%", top: "27.8%", fire: "#ffbd5d", pulse: "2.5s", delay: "-1.1s" },
  { left: "67.3%", top: "45.2%", fire: "#48dfff", pulse: "3s", delay: "-2.4s" },
  { left: "30.7%", top: "16.1%", fire: "#60f7cf", pulse: "2.4s", delay: "-.8s" },
  { left: "79.1%", top: "29.4%", fire: "#56e9ff", pulse: "3.3s", delay: "-1.5s" },
  { left: "56.6%", top: "39.1%", fire: "#ff79ed", pulse: "2.8s", delay: "-2s" },
  { left: "40.4%", top: "26.4%", fire: "#ff9f43", pulse: "3.2s", delay: "-.4s" },
];

/** Fired by other marketing components (e.g. the toolkit's Auto Apply card) to
 * open a division's inventory from outside this component's own DOM. */
export const OPEN_DIVISION_EVENT = "benavora:open-division";

/** Fired whenever a division node is selected (by direct click or via
 * OPEN_DIVISION_EVENT) so the lifecycle flow diagram further down the page can
 * animate its six-stage sequence in that division's accent color. */
export const LIFECYCLE_FLOW_EVENT = "benavora:lifecycle-flow";

export function NeuralFleetVisualization() {
  const [selected, setSelected] = useState<number | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [wirePaths, setWirePaths] = useState<string[]>(INITIAL_WIRES);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const parallaxRef = useRef<HTMLDivElement | null>(null);
  const coreRef = useRef<HTMLDivElement | null>(null);
  const nodeRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const inventoryRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  const syncWires = useCallback(() => {
    const stageEl = stageRef.current;
    const coreEl = coreRef.current;
    if (!stageEl || !coreEl) return;
    const stageRect = stageEl.getBoundingClientRect();
    if (stageRect.width === 0 || stageRect.height === 0) return;
    const coreRect = coreEl.getBoundingClientRect();
    const cx = ((coreRect.x + coreRect.width / 2 - stageRect.x) / stageRect.width) * 1120;
    const cy = ((coreRect.y + coreRect.height / 2 - stageRect.y) / stageRect.height) * 700;
    const next = nodeRefs.current.map((node, i) => {
      if (!node) return wirePath(pointAt(i), CORE);
      const r = node.getBoundingClientRect();
      const x = ((r.x + r.width / 2 - stageRect.x) / stageRect.width) * 1120;
      const y = ((r.y + r.height / 2 - stageRect.y) / stageRect.height) * 700;
      return wirePath([x, y], [cx, cy]);
    });
    setWirePaths(next);
  }, []);

  // Wires are measured off the real DOM so they still connect node-to-core
  // correctly at every responsive breakpoint, without hand-coding a matching
  // coordinate set for each one.
  useLayoutEffect(() => {
    syncWires();
    const stageEl = stageRef.current;
    if (!stageEl || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => syncWires());
    ro.observe(stageEl);
    window.addEventListener("resize", syncWires);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", syncWires);
    };
  }, [syncWires]);

  useEffect(() => {
    if (isOpen) {
      closeButtonRef.current?.focus();
    }
    if (inventoryRef.current) {
      inventoryRef.current.inert = !isOpen;
    }
  }, [isOpen]);

  const closeInventory = useCallback(() => {
    setIsOpen(false);
    if (selected !== null) {
      nodeRefs.current[selected]?.focus();
    }
  }, [selected]);

  const handleSelect = (i: number) => {
    setSelected(i);
    setIsOpen(true);
    const family = FAMILIES[i];
    if (family) {
      window.dispatchEvent(
        new CustomEvent(LIFECYCLE_FLOW_EVENT, { detail: { index: i, name: family.name, color: COLORS[i] } })
      );
    }
  };

  // Lets the toolkit's Auto Apply card (a separate component, further down the
  // page) open this section's Auto Apply node instead of only linking to it.
  useEffect(() => {
    const onOpenDivision = (e: Event) => {
      const index = (e as CustomEvent<{ index: number }>).detail?.index;
      if (typeof index !== "number" || !FAMILIES[index]) return;
      stageRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      handleSelect(index);
    };
    window.addEventListener(OPEN_DIVISION_EVENT, onOpenDivision);
    return () => window.removeEventListener(OPEN_DIVISION_EVENT, onOpenDivision);
  }, []);

  const handleRootKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (!isOpen) return;
    if (e.key === "Escape") {
      closeInventory();
    } else if (e.key === "Tab") {
      // Single-focusable-element trap: the dialog only ever exposes Close.
      e.preventDefault();
      closeButtonRef.current?.focus();
    }
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const stageEl = stageRef.current;
    const parallaxEl = parallaxRef.current;
    if (!stageEl || !parallaxEl) return;
    const r = stageEl.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width - 0.5) * 10;
    const y = ((e.clientY - r.top) / r.height - 0.5) * 8;
    parallaxEl.style.setProperty("--mx", `${x}px`);
    parallaxEl.style.setProperty("--my", `${y}px`);
  };

  const handlePointerLeave = () => {
    const parallaxEl = parallaxRef.current;
    if (!parallaxEl) return;
    parallaxEl.style.setProperty("--mx", "0px");
    parallaxEl.style.setProperty("--my", "0px");
  };

  const activeFamily = selected !== null ? FAMILIES[selected] : null;

  return (
    <section
      aria-label="Interactive map of Benavora's 48-agent prospect intelligence fleet"
      className="bnf-fleet"
      onKeyDown={handleRootKeyDown}
      style={mkGrainBackground("#222624", true)}
    >
      <BotanicalMotif
        variant="corner-roots"
        color="#3b403b"
        opacity={0.06}
        style={{ left: 0, bottom: 0, width: 200, height: 200, transform: "scaleY(-1)" }}
      />
      <div className="bnf-stage" ref={stageRef} onPointerMove={handlePointerMove} onPointerLeave={handlePointerLeave}>
        <div className="bnf-parallax" ref={parallaxRef}>
          <svg
            className="bnf-svg"
            viewBox="0 0 1120 700"
            preserveAspectRatio="none"
            role="img"
            aria-labelledby="bnf-v-title bnf-v-desc"
          >
            <title id="bnf-v-title">Benavora autonomous prospect intelligence neural fleet</title>
            <desc id="bnf-v-desc">
              Forty-eight autonomous agents organized in nine specialist divisions exchange
              intelligence continuously through a central reasoning core.
            </desc>
            <defs>
              <linearGradient id="bnf-swirl-silver" x1="0" y1="0" x2="1" y2="1">
                <stop stopColor="#9cbebc" stopOpacity="0" />
                <stop offset="0.45" stopColor="#b9d8d3" />
                <stop offset="1" stopColor="#96abbc" stopOpacity="0.15" />
              </linearGradient>
              <linearGradient id="bnf-swirl-lilac">
                <stop stopColor="#b1aec8" stopOpacity="0.08" />
                <stop offset="0.55" stopColor="#c8c2da" />
                <stop offset="1" stopColor="#9caac6" stopOpacity="0" />
              </linearGradient>
            </defs>
            <g aria-hidden="true" transform="translate(560 350)" fill="none">
              <ellipse className="bnf-arc a" rx={240} ry={150} />
              <ellipse className="bnf-arc b" rx={275} ry={177} transform="rotate(24)" />
              <ellipse className="bnf-arc c" rx={310} ry={205} transform="rotate(-17)" />
              <g className="bnf-swirl swirl-one">
                <path d="M-302 55 C-346 -84 -211 -230 -12 -238 C173 -246 319 -153 322 -28 C324 93 183 176 33 149 C-67 131 -115 63 -71 4" />
              </g>
              <g className="bnf-swirl swirl-two">
                <path d="M281 -125 C366 34 246 235 30 250 C-146 262 -314 158 -318 31 C-322 -80 -208 -160 -99 -133 C-21 -114 16 -54 -18 -7" />
              </g>
              <g className="bnf-swirl swirl-three">
                <path d="M-258 -177 C-83 -291 157 -251 264 -104 C348 12 284 191 135 215 C18 234 -73 167 -54 90" />
              </g>
            </g>
            <g aria-hidden="true" fill="none">
              {FAMILIES.map((f, i) => (
                <path
                  key={`echo-${f.name}`}
                  className="bnf-wire echo"
                  d={wirePaths[i]}
                  style={{ "--wire": COLORS[i] } as CSSVars}
                />
              ))}
              {FAMILIES.map((f, i) => (
                <path
                  key={`wire-${f.name}`}
                  className={`bnf-wire${selected === i ? " is-active" : ""}`}
                  d={wirePaths[i]}
                  style={{ "--wire": COLORS[i] } as CSSVars}
                />
              ))}
            </g>
          </svg>
          <div
            className="bnf-brain-photo"
            aria-hidden="true"
            style={{ backgroundImage: "url(/marketing/brain-network.webp)" }}
          />
          <div className="bnf-firefield" aria-hidden="true">
            {NEURONS.map((n, i) => (
              <span
                key={i}
                className="bnf-neuron"
                style={
                  {
                    left: n.left,
                    top: n.top,
                    "--fire": n.fire,
                    "--pulse": n.pulse,
                    "--delay": n.delay,
                  } as CSSVars
                }
              />
            ))}
          </div>
          <div
            className="bnf-core"
            ref={coreRef}
            aria-label="Forty-eight agentic minds, one continuously learning intelligence"
          >
            <div className="bnf-core-copy">
              <span className="bnf-core-number">48</span>
              <span className="bnf-core-label">Agentic minds</span>
              <span className="bnf-core-sub">One intelligence</span>
            </div>
          </div>
          <div className="bnf-nodes">
            {FAMILIES.map((f, i) => (
              <button
                key={f.name}
                ref={(el) => {
                  nodeRefs.current[i] = el;
                }}
                type="button"
                className={`bnf-node n${i}`}
                style={{ "--node": COLORS[i] } as CSSVars}
                aria-pressed={selected === i}
                onClick={() => handleSelect(i)}
              >
                <span className="bnf-node-head">
                  <span className="bnf-node-name">{f.name}</span>
                  <span className="bnf-count">{f.count}</span>
                </span>
                <span className="bnf-node-role">{f.role}</span>
                {i === AUTO_APPLY_INDEX ? <span className="bnf-cap-label">3 Agents · 8 Capabilities</span> : null}
              </button>
            ))}
          </div>
        </div>
        <div className={`bnf-backdrop${isOpen ? " is-open" : ""}`} aria-hidden="true" onClick={closeInventory} />
        <section
          className={`bnf-inventory${isOpen ? " is-open" : ""}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="bnf-inventory-title"
          ref={(el) => {
            inventoryRef.current = el;
          }}
        >
          <header className="bnf-inventory-head">
            <h3 className="bnf-inventory-title" id="bnf-inventory-title">
              {activeFamily
                ? `${activeFamily.name} · ${activeFamily.count} ${activeFamily.count === 1 ? "agent" : "agents"}${
                    selected === AUTO_APPLY_INDEX ? " · 8 Capabilities" : ""
                  }`
                : ""}
            </h3>
            <button type="button" className="bnf-close" aria-label="Close agent inventory" ref={closeButtonRef} onClick={closeInventory}>
              Close
            </button>
          </header>
          {selected === AUTO_APPLY_INDEX ? (
            <p className="bnf-auto-apply-intro">
              Three specialists work together: <strong>Application Planning &amp; Execution</strong>,{" "}
              <strong>Portal Exception Diagnosis &amp; Recovery</strong>, and{" "}
              <strong>Application Submission Governance</strong>. Together, they coordinate eight capabilities:
            </p>
          ) : null}
          <ol className="bnf-agent-list">
            {(selected !== null ? (INVENTORIES[selected] ?? []) : []).map((a) => (
              <li key={a[0]}>
                <span className="bnf-agent-num">{a[0]}</span>
                <span className="bnf-agent-name">{a[1]}</span>
                <span className="bnf-agent-desc">{a[2]}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>
      <div className="bnf-detail" aria-live="polite">
        {activeFamily ? (
          <>
            <div className="bnf-signal">
              <i aria-hidden="true" style={{ background: COLORS[selected as number], boxShadow: `0 0 12px ${COLORS[selected as number]}` }} />
              {activeFamily.count} {activeFamily.count === 1 ? "specialist agent" : "specialist agents"} engaged
            </div>
            <div>
              <strong>{activeFamily.name} intelligence.</strong> <span>{activeFamily.desc}</span>
            </div>
          </>
        ) : (
          <>
            <div className="bnf-signal">
              <i aria-hidden="true" />
              48 agents · 9 specialist divisions
            </div>
            <div>
              <strong>Explore the intelligence behind your next opportunity.</strong>{" "}
              <span>Select a division to discover its specialists. Select Auto Apply to explore the application process.</span>
            </div>
          </>
        )}
      </div>
      <SectionDividerDef variant="wave" fill="#222624" />
      <style jsx>{`
        .bnf-fleet {
          --background: #222624;
          --foreground: #f4f0e8;
          --card: #202320;
          --muted-foreground: #b9b8b1;
          --border: #3b403b;
          position: relative;
          isolation: isolate;
          color: var(--foreground);
          padding: 56px 24px 64px;
          overflow: hidden;
        }
        .bnf-stage {
          position: relative;
          width: 100%;
          max-width: 1120px;
          margin: auto;
          aspect-ratio: 16 / 10;
          min-height: 600px;
        }
        .bnf-parallax {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          transform: translate3d(var(--mx, 0), var(--my, 0), 0);
          transition: transform 0.7s cubic-bezier(0.2, 0.8, 0.2, 1);
        }
        .bnf-svg {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          display: block;
          overflow: visible;
        }
        .bnf-arc {
          fill: none;
          stroke: #36c9ff;
          stroke-width: 1.2;
          stroke-linecap: round;
          opacity: 0.3;
          transform-box: fill-box;
          transform-origin: center;
        }
        .bnf-arc.a {
          stroke-dasharray: 12 24;
          animation: bnfSpin 18s linear infinite;
        }
        .bnf-arc.b {
          stroke: #ff4fc8;
          stroke-dasharray: 4 18;
          animation: bnfSpinBack 13s linear infinite;
        }
        .bnf-arc.c {
          stroke: #42f5b6;
          stroke-dasharray: 28 42;
          animation: bnfSpin 27s linear infinite;
        }
        .bnf-swirl {
          transform-box: view-box;
          transform-origin: 0px 0px;
          fill: none;
          stroke: url(#bnf-swirl-silver);
          stroke-width: 2.3;
          stroke-linecap: round;
          opacity: 0.85;
          animation: bnfSwirl 32s linear infinite;
        }
        .swirl-two {
          stroke: url(#bnf-swirl-lilac);
          stroke-width: 1.8;
          opacity: 0.75;
          animation-direction: reverse;
          animation-duration: 43s;
        }
        .swirl-three {
          stroke: url(#bnf-swirl-silver);
          stroke-width: 1.1;
          opacity: 0.55;
          animation-duration: 57s;
        }
        .bnf-brain-photo {
          position: absolute;
          left: 50%;
          top: 52%;
          height: 86%;
          width: auto;
          aspect-ratio: 1;
          max-width: 74%;
          transform: translate(-50%, -50%);
          background-image: url(/marketing/brain-network.webp);
          background-size: contain;
          background-repeat: no-repeat;
          background-position: center;
          mask-image: radial-gradient(ellipse at center, #000 53%, rgba(0, 0, 0, 0.867) 72%, transparent 99%);
          -webkit-mask-image: radial-gradient(ellipse at center, #000 53%, rgba(0, 0, 0, 0.867) 72%, transparent 99%);
          z-index: 1;
          pointer-events: none;
        }
        .bnf-wire {
          fill: none;
          stroke: var(--wire, #36c9ff);
          stroke-width: 1.7;
          stroke-linecap: round;
          opacity: 0.35;
          stroke-dasharray: 2 10;
          animation: bnfFlow 2.6s linear infinite;
          transition: opacity 0.25s, stroke-width 0.25s, filter 0.25s;
        }
        .bnf-wire.echo {
          stroke-width: 5;
          opacity: 0.055;
          stroke-dasharray: none;
          animation: none;
        }
        .bnf-wire.is-active {
          opacity: 1;
          stroke-width: 3;
          filter: drop-shadow(0 0 7px var(--wire, #36c9ff));
        }
        .bnf-firefield {
          position: absolute;
          left: 50%;
          top: 52%;
          height: 86%;
          aspect-ratio: 1;
          max-width: 74%;
          transform: translate(-50%, -50%);
          clip-path: polygon(
            11% 39%, 12% 27%, 18% 17%, 29% 9%, 43% 4%, 60% 4%, 74% 9%, 84% 19%, 88% 32%, 86% 43%,
            79% 51%, 73% 52%, 78% 59%, 75% 65%, 68% 68%, 60% 66%, 57% 60%, 49% 59%, 42% 57%, 34% 55%,
            26% 51%, 18% 49%, 12% 44%
          );
          overflow: hidden;
          z-index: 2;
          pointer-events: none;
        }
        .bnf-neuron {
          --fire: #36c9ff;
          position: absolute;
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--fire);
          box-shadow: 0 0 6px var(--fire), 0 0 18px var(--fire), 0 0 34px var(--fire);
          animation: bnfNeuronFire var(--pulse, 2.8s) cubic-bezier(0.2, 0.7, 0.2, 1) infinite;
          animation-delay: var(--delay, 0s);
        }
        .bnf-neuron::before,
        .bnf-neuron::after {
          content: "";
          position: absolute;
          inset: -5px;
          border: 1px solid var(--fire);
          border-radius: 50%;
          opacity: 0;
          animation: bnfNeuronRing var(--pulse, 2.8s) ease-out infinite;
          animation-delay: var(--delay, 0s);
        }
        .bnf-neuron::after {
          animation-delay: calc(var(--delay) + 0.22s);
        }
        .bnf-core {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 190px;
          height: 190px;
          border-radius: 50%;
          transform: translate(-50%, -50%);
          display: grid;
          place-items: center;
          text-align: center;
          background: radial-gradient(circle at 38% 30%, color-mix(in srgb, #36c9ff 25%, var(--card)), #222722 64%);
          border: 1px solid color-mix(in srgb, #36c9ff 70%, var(--border));
          box-shadow: 0 0 0 12px color-mix(in srgb, #36c9ff 4%, transparent), 0 0 0 30px color-mix(in srgb, #36c9ff 3%, transparent),
            0 0 70px color-mix(in srgb, #36c9ff 32%, transparent);
          z-index: 4;
          transition: opacity 0.3s, transform 0.3s;
        }
        .bnf-core::before {
          content: "";
          position: absolute;
          inset: -10px;
          border: 1px solid color-mix(in srgb, #36c9ff 34%, transparent);
          border-radius: 50%;
          border-top-color: #36c9ff;
          animation: bnfSpin 9s linear infinite;
        }
        .bnf-core-copy {
          position: relative;
          z-index: 1;
        }
        .bnf-core-number {
          display: block;
          color: var(--foreground);
          font-size: 53px;
          font-weight: 500;
          letter-spacing: -0.07em;
        }
        .bnf-core-label {
          display: block;
          color: var(--foreground);
          font-size: 12px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          margin-top: 14px;
        }
        .bnf-core-sub {
          display: block;
          color: color-mix(in srgb, var(--foreground) 68%, transparent);
          font-size: 12px;
          margin-top: 7px;
        }
        .bnf-nodes {
          position: absolute;
          inset: 0;
        }
        .bnf-node {
          --node: #36c9ff;
          position: absolute;
          width: 170px;
          min-height: 88px;
          padding: 13px 14px;
          transform: translate(-50%, -50%);
          text-align: left;
          color: var(--foreground);
          background: #222622;
          border: 1px solid color-mix(in srgb, var(--node) 27%, var(--border));
          border-radius: 18px;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.35), 0 6px 16px -6px rgba(0, 0, 0, 0.45),
            inset 0 1px 0 rgba(255, 255, 255, 0.06);
          z-index: 5;
          cursor: pointer;
          font: inherit;
          transition: transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 0.25s, border-color 0.25s, background 0.25s;
        }
        .bnf-node::before {
          content: "";
          position: absolute;
          left: 14px;
          top: 0;
          width: 46px;
          height: 2px;
          background: var(--node);
          opacity: 0.85;
        }
        .bnf-node:hover,
        .bnf-node[aria-pressed="true"] {
          transform: translate(-50%, -50%) scale(1.075);
          border-color: var(--node);
          background: #2b302b;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.149);
          z-index: 7;
        }
        .bnf-node:focus-visible {
          outline: 2px solid #fff;
          outline-offset: 5px;
        }
        .bnf-node-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 8px;
        }
        .bnf-node-name {
          font-weight: 500;
          font-size: 14px;
        }
        .bnf-count {
          display: grid;
          place-items: center;
          flex: 0 0 28px;
          height: 28px;
          border-radius: 9px;
          color: var(--foreground);
          background: color-mix(in srgb, var(--node) 10%, #222622);
          border: 1px solid color-mix(in srgb, var(--node) 40%, transparent);
          font-weight: 500;
          font-size: 13px;
        }
        .bnf-node-role {
          display: block;
          color: var(--muted-foreground);
          margin-top: 7px;
          font-size: 12px;
        }
        .bnf-cap-label {
          display: block;
          font-size: 10px;
          letter-spacing: 0.04em;
          color: #c9d5cc;
          margin-top: 5px;
        }
        .n0 {
          left: 35%;
          top: 10%;
        }
        .n1 {
          left: 88%;
          top: 14%;
        }
        .n2 {
          left: 88%;
          top: 50%;
        }
        .n3 {
          left: 76%;
          top: 80%;
        }
        .n4 {
          left: 50%;
          top: 90%;
        }
        .n5 {
          left: 24%;
          top: 80%;
        }
        .n6 {
          left: 12%;
          top: 50%;
        }
        .n7 {
          left: 12%;
          top: 14%;
        }
        .n8 {
          left: 65%;
          top: 10%;
        }
        .bnf-detail {
          max-width: 780px;
          min-height: 68px;
          margin: 16px auto 0;
          text-align: center;
          padding: 0 16px;
          font-size: 14px;
          line-height: 1.65;
        }
        .bnf-detail strong {
          font-weight: 500;
          color: #e2e8e3;
        }
        .bnf-detail span {
          color: var(--muted-foreground);
        }
        .bnf-signal {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 8px;
          color: var(--muted-foreground);
          letter-spacing: 0.035em;
          text-transform: none;
          font-size: 11px;
        }
        .bnf-signal i {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #b6c4bc;
        }
        .bnf-backdrop {
          position: absolute;
          inset: 0;
          background: color-mix(in srgb, #000 70%, transparent);
          backdrop-filter: blur(8px);
          opacity: 0;
          pointer-events: none;
          z-index: 8;
          transition: opacity 0.35s;
        }
        .bnf-backdrop.is-open {
          opacity: 1;
          pointer-events: auto;
        }
        .bnf-inventory {
          --panel: #36c9ff;
          position: absolute;
          left: 50%;
          top: 50%;
          width: min(760px, 88%);
          max-height: 78%;
          overflow: auto;
          transform: translate(-50%, -44%) scale(0.82);
          opacity: 0;
          pointer-events: none;
          z-index: 9;
          color: var(--foreground);
          background: linear-gradient(145deg, color-mix(in srgb, var(--panel) 15%, var(--card)), var(--card) 46%);
          border: 1px solid color-mix(in srgb, var(--panel) 58%, var(--border));
          border-radius: 26px;
          box-shadow: 0 30px 90px rgba(0, 0, 0, 0.7), 0 0 48px color-mix(in srgb, var(--panel) 18%, transparent),
            inset 0 1px 0 rgba(255, 255, 255, 0.1);
          transition: opacity 0.34s, transform 0.45s cubic-bezier(0.2, 0.8, 0.2, 1);
        }
        .bnf-inventory.is-open {
          opacity: 1;
          pointer-events: auto;
          transform: translate(-50%, -50%) scale(1);
        }
        .bnf-inventory-head {
          position: sticky;
          top: 0;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          padding: 20px 22px 16px;
          background: color-mix(in srgb, var(--card) 94%, transparent);
          backdrop-filter: blur(16px);
          border-bottom: 1px solid var(--border);
          z-index: 2;
        }
        .bnf-inventory-title {
          margin: 0;
          font-weight: 500;
          font-size: 18px;
        }
        .bnf-close {
          flex: 0 0 auto;
          background: transparent;
          border: 1px solid var(--border);
          color: var(--foreground);
          border-radius: 999px;
          padding: 8px 16px;
          font-size: 13px;
          cursor: pointer;
        }
        .bnf-close:hover {
          background: rgba(255, 255, 255, 0.08);
        }
        .bnf-auto-apply-intro {
          padding: 18px 22px 0;
          color: #b8c4d7;
          font-size: 13px;
          line-height: 1.6;
        }
        .bnf-agent-list {
          list-style: none;
          margin: 0;
          padding: 10px 22px 22px;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 0 24px;
        }
        .bnf-agent-list li {
          position: relative;
          padding: 13px 0 13px 38px;
          border-bottom: 1px solid color-mix(in srgb, var(--border) 66%, transparent);
        }
        .bnf-agent-num {
          position: absolute;
          left: 0;
          top: 12px;
          display: grid;
          place-items: center;
          width: 27px;
          height: 27px;
          border-radius: 9px;
          background: color-mix(in srgb, var(--panel) 20%, transparent);
          color: var(--foreground);
          border: 1px solid color-mix(in srgb, var(--panel) 42%, transparent);
          font-weight: 500;
          font-size: 12px;
        }
        .bnf-agent-name {
          display: block;
          color: var(--foreground);
          font-weight: 500;
          font-size: 13px;
        }
        .bnf-agent-desc {
          display: block;
          color: var(--muted-foreground);
          margin-top: 3px;
          font-size: 12px;
        }
        @keyframes bnfFlow {
          to {
            stroke-dashoffset: -48;
          }
        }
        @keyframes bnfSpin {
          to {
            transform: rotate(360deg);
          }
        }
        @keyframes bnfSpinBack {
          to {
            transform: rotate(-360deg);
          }
        }
        @keyframes bnfSwirl {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
        @keyframes bnfSheen {
          0%,
          25% {
            transform: translateX(-35%);
            opacity: 0;
          }
          50% {
            opacity: 1;
          }
          75%,
          100% {
            transform: translateX(35%);
            opacity: 0;
          }
        }
        @keyframes bnfBeat {
          0%,
          100% {
            opacity: 0.35;
            transform: scale(0.75);
          }
          50% {
            opacity: 1;
            transform: scale(1.15);
          }
        }
        @keyframes bnfNeuronFire {
          0%,
          72%,
          100% {
            opacity: 0.34;
            transform: scale(0.68);
          }
          78% {
            opacity: 1;
            transform: scale(1.75);
          }
          85% {
            opacity: 0.65;
            transform: scale(1);
          }
        }
        @keyframes bnfNeuronRing {
          0%,
          72% {
            opacity: 0;
            transform: scale(0.2);
          }
          78% {
            opacity: 0.7;
          }
          94%,
          100% {
            opacity: 0;
            transform: scale(3.8);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .bnf-fleet * {
            animation: none !important;
            transition: none !important;
          }
        }
        @media (max-width: 760px) {
          .bnf-stage {
            aspect-ratio: 3 / 4;
            min-height: 720px;
          }
          .bnf-node {
            width: 145px;
            min-height: 80px;
            padding: 11px;
          }
          .bnf-core {
            width: 150px;
            height: 150px;
          }
          .bnf-core-number {
            font-size: 38px;
          }
          .n7 {
            left: 24%;
            top: 8%;
          }
          .n1 {
            left: 76%;
            top: 8%;
          }
          .n0 {
            left: 24%;
            top: 24%;
          }
          .n8 {
            left: 76%;
            top: 24%;
          }
          .n6 {
            left: 24%;
            top: 47%;
          }
          .n2 {
            left: 76%;
            top: 47%;
          }
          .n5 {
            left: 24%;
            top: 76%;
          }
          .n3 {
            left: 76%;
            top: 76%;
          }
          .n4 {
            top: 92%;
          }
          .bnf-node-role {
            font-size: 10px;
          }
          .bnf-agent-list {
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 480px) {
          .bnf-node {
            width: 136px;
          }
        }
      `}</style>
    </section>
  );
}
