"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";

// Self-guided product tour: three real, Playwright-captured screenshots of
// live Benavora pages (Research Command Center, Draft Generator, AutoApply
// Engine), captured authenticated as the real E2E test owner against the
// dev server -- see scripts/audit/tour-candidate-shots.mjs and
// test-evidence/marketing/tour-candidates/. No fixture/illustration stands
// in for a real screen. Step order matches the homepage's own description of
// this tour ("discovery, drafting, and Auto Apply") in the "What should I do
// next?" section of src/app/(marketing)/page.tsx.
//
// durationMs values sum to 70s, inside the 60-90s self-guided interaction
// target; each step also advances on click/keyboard so a visitor can move
// faster or slower than the autoplay pace.
export type TourStep = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  image: { src: string; alt: string };
  href: string;
  linkLabel: string;
  durationMs: number;
};

export const TOUR_STEPS: TourStep[] = [
  {
    id: "research",
    eyebrow: "Step 1 of 3 · Discovery",
    title: "Research Command Center",
    description:
      "Research agents pull from government, corporate, and foundation sources in one place — Grants.gov, SAM.gov, USASpending.gov, NIH RePORTER, NSF Award Search, HRSA, and HUD Exchange among them.",
    image: {
      src: "/marketing/tour/01-research.png",
      alt: "Benavora's Research Command Center listing authoritative federal and foundation funding data sources including Grants.gov, SAM.gov, and HUD Exchange",
    },
    href: "/platform/opportunity-discovery",
    linkLabel: "See Opportunity Discovery",
    durationMs: 20000,
  },
  {
    id: "draft",
    eyebrow: "Step 2 of 3 · Drafting",
    title: "Draft Generator",
    description:
      "A four-step wizard — select an opportunity, customize, generate, review and export — drafts from your organization's own Knowledge Base. The AI never invents organizational facts; gaps are flagged for your input.",
    image: {
      src: "/marketing/tour/02-draft-generator.png",
      alt: "Benavora's Draft Generator wizard with an opportunity selected and steps for Customize, Generate, and Review and Export",
    },
    href: "/platform/ai-grant-writer",
    linkLabel: "See AI Grant Writer",
    durationMs: 25000,
  },
  {
    id: "autoapply",
    eyebrow: "Step 3 of 3 · Submission",
    title: "AutoApply Engine",
    description:
      "Once a draft is approved, AutoApply queues funders, analyzes each portal's form, and submits automatically — with a live session viewer showing the browser automation in real time and worker status confirming it's running.",
    image: {
      src: "/marketing/tour/03-autoapply.png",
      alt: "Benavora's AutoApply Engine showing the worker online, a live session viewer, and queue controls",
    },
    href: "/platform/autoapply",
    linkLabel: "See AutoApply",
    durationMs: 25000,
  },
];

type ProductTourProps = {
  variant?: "full" | "compact";
};

export function ProductTour({ variant = "full" }: ProductTourProps) {
  const isCompact = variant === "compact";
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [progress, setProgress] = useState(0);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef(0);
  const pausedElapsedRef = useRef(0);
  const prevIndexRef = useRef(index);

  // index is always kept in [0, TOUR_STEPS.length) by goTo()'s modulo wrap.
  const step = TOUR_STEPS[index]!;

  useEffect(() => {
    const reduceMotion =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) setPlaying(false);
  }, []);

  useEffect(() => {
    // Reset elapsed time only when the step actually changed, not on every
    // play/pause toggle -- otherwise pausing (hover, focus, click) snapped the
    // progress bar back to 0 instead of freezing it in place.
    if (prevIndexRef.current !== index) {
      prevIndexRef.current = index;
      pausedElapsedRef.current = 0;
      setProgress(0);
    }
    if (!playing) return undefined;

    startRef.current = performance.now();
    function tick(now: number) {
      const elapsed = pausedElapsedRef.current + (now - startRef.current);
      const pct = Math.min(100, (elapsed / step.durationMs) * 100);
      setProgress(pct);
      if (pct >= 100) {
        setIndex((i) => (i + 1) % TOUR_STEPS.length);
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      pausedElapsedRef.current += performance.now() - startRef.current;
    };
  }, [index, playing, step.durationMs]);

  function goTo(next: number) {
    setIndex(((next % TOUR_STEPS.length) + TOUR_STEPS.length) % TOUR_STEPS.length);
  }

  function onFrameKeyDown(e: React.KeyboardEvent) {
    if (isCompact) return;
    if (e.key === "ArrowRight") goTo(index + 1);
    if (e.key === "ArrowLeft") goTo(index - 1);
    if (e.key === " ") {
      e.preventDefault();
      setPlaying((p) => !p);
    }
  }

  // Hover/focus-to-pause only applies to the compact homepage preview, which
  // has no manual controls; the full variant's explicit Play/Pause button
  // would otherwise fight this (hovering to reach the button already pauses
  // it, so the button's own toggle immediately un-pauses it again).
  const hoverPauseProps = isCompact
    ? {
        onMouseEnter: () => setPlaying(false),
        onMouseLeave: () => setPlaying(true),
        onFocus: () => setPlaying(false),
        onBlur: () => setPlaying(true),
      }
    : {};

  return (
    <div
      className={`pt-root ${isCompact ? "pt-compact" : "pt-full"}`}
      {...hoverPauseProps}
      onKeyDown={onFrameKeyDown}
      tabIndex={isCompact ? -1 : 0}
      role="group"
      aria-roledescription="carousel"
      aria-label="Benavora self-guided product tour"
    >
      <div className="pt-progress-row" role="tablist" aria-label="Tour steps">
        {TOUR_STEPS.map((s, i) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={i === index}
            aria-label={`Step ${i + 1}: ${s.title}`}
            className="pt-progress-track"
            onClick={() => goTo(i)}
          >
            <span
              className="pt-progress-fill"
              style={{ width: i < index ? "100%" : i === index ? `${progress}%` : "0%" }}
            />
          </button>
        ))}
      </div>

      <div className="pt-frame">
        <div className="pt-frame-bar" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <Image
          src={step.image.src}
          alt={step.image.alt}
          width={1440}
          height={900}
          className="pt-frame-img"
          sizes={isCompact ? "(max-width: 900px) 100vw, 640px" : "(max-width: 900px) 100vw, 1000px"}
          priority={index === 0}
        />
      </div>

      <div className="pt-caption">
        <p className="pt-eyebrow">{step.eyebrow}</p>
        <h3 className="pt-title">{step.title}</h3>
        <p className="pt-description">{step.description}</p>
        {!isCompact ? (
          <Link
            href={step.href}
            style={{
              display: "inline-block",
              marginTop: 14,
              color: "#efb344",
              fontWeight: 600,
              fontSize: 14,
              textDecoration: "none",
            }}
          >
            {step.linkLabel} <span aria-hidden="true">&rarr;</span>
          </Link>
        ) : null}
      </div>

      {!isCompact ? (
        <div className="pt-controls">
          <button type="button" className="pt-nav-btn" onClick={() => goTo(index - 1)} aria-label="Previous step">
            &larr; Back
          </button>
          <button
            type="button"
            className="pt-nav-btn"
            onClick={() => setPlaying((p) => !p)}
            aria-label={playing ? "Pause tour" : "Play tour"}
          >
            {playing ? "Pause" : "Play"}
          </button>
          <button type="button" className="pt-nav-btn" onClick={() => goTo(index + 1)} aria-label="Next step">
            Next &rarr;
          </button>
        </div>
      ) : null}

      <style jsx>{`
        .pt-root {
          outline: none;
        }
        .pt-progress-row {
          display: flex;
          gap: 8px;
          max-width: ${isCompact ? "640px" : "1000px"};
          margin: 0 auto 16px;
        }
        .pt-progress-track {
          flex: 1;
          height: 4px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.14);
          border: none;
          padding: 0;
          cursor: pointer;
          overflow: hidden;
        }
        .pt-progress-fill {
          display: block;
          height: 100%;
          background: #efb344;
          transition: width 0.1s linear;
        }
        .pt-frame {
          max-width: ${isCompact ? "640px" : "1000px"};
          margin: 0 auto;
          border-radius: ${isCompact ? "14px" : "20px"};
          overflow: hidden;
          background: #171a18;
          border: 1px solid #3b403b;
          box-shadow: 0 24px 48px rgba(0, 0, 0, 0.35);
        }
        .pt-frame-bar {
          display: flex;
          gap: 7px;
          padding: 12px 16px;
          background: #1b1e1c;
          border-bottom: 1px solid #3b403b;
        }
        .pt-frame-bar span {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: #4a5049;
        }
        :global(.pt-frame-img) {
          display: block;
          width: 100%;
          height: auto;
        }
        .pt-caption {
          max-width: ${isCompact ? "640px" : "720px"};
          margin: ${isCompact ? "20px" : "28px"} auto 0;
          text-align: center;
        }
        .pt-eyebrow {
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0.02em;
          color: #b9cbbd;
          margin: 0;
        }
        .pt-title {
          font-size: ${isCompact ? "20px" : "24px"};
          font-weight: 600;
          color: #f0f2ee;
          margin: 8px 0 0;
        }
        .pt-description {
          color: #bdc4be;
          font-size: ${isCompact ? "14px" : "15px"};
          line-height: 1.7;
          margin: 10px 0 0;
        }
        .pt-controls {
          display: flex;
          justify-content: center;
          gap: 12px;
          margin-top: 24px;
        }
        .pt-nav-btn {
          background: transparent;
          border: 1px solid #4a5049;
          color: #f0f2ee;
          border-radius: 8px;
          padding: 9px 16px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
        }
        .pt-nav-btn:hover {
          border-color: #77927e;
          background: rgba(255, 255, 255, 0.06);
        }
        @media (max-width: 640px) {
          .pt-frame {
            border-radius: 12px;
          }
          .pt-title {
            font-size: ${isCompact ? "18px" : "20px"};
          }
        }
      `}</style>
    </div>
  );
}
