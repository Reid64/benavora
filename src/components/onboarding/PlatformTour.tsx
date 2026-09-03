"use client";

// Guided platform tour, triggered by a `?tour=true` query param on the
// dashboard route (see src/app/(dashboard)/onboarding/page.tsx —
// handleChoosePlan/handleSkip redirect here right after onboarding
// completes). Highlights six real, already-rendered nav anchors via plain
// `id` attributes (DashboardShell mounts this once, so it overlays every
// dashboard page — see id anchors added to FlightPathHUD.tsx, Header.tsx,
// and Sidebar.tsx) rather than duplicating any of that UI.
//
// `id` was used instead of `data-tour` for the anchor attributes: Next's
// <Link> types its props off React.AnchorHTMLAttributes, which has no
// index signature for arbitrary `data-*` keys, so an unrecognized
// `data-tour` prop is a real tsc error there — `id` is a standard,
// unambiguous prop on every element/component and carries no such risk.
//
// CRITICAL (BLUEPRINT §7.5): inline style={{}} only, hardcoded hex — no
// Tailwind color classes, no CSS variables.

import { Suspense, useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";

interface TourStep {
  anchorId: string;
  title: string;
  description: string;
  color: string;
}

const TOUR_STEPS: TourStep[] = [
  {
    anchorId: "tour-flightpath-hud",
    title: "Your Grant Pipeline",
    description:
      "The FlightPath HUD tracks every stage of your funding journey — Onboard, Research, Opportunities, Grant Narratives, AutoApply, and Donor Discovery. Click any stage to jump straight there.",
    color: "#3D6B50",
  },
  {
    anchorId: "tour-tab-opportunities",
    title: "Opportunities",
    description:
      "Every grant and funding match we find lives here, ranked by an AI-computed win probability. New matches unlock automatically overnight as agents run.",
    color: "#0096C7",
  },
  {
    anchorId: "tour-tab-draft-generator",
    title: "Draft Generator",
    description:
      "Generate a complete grant narrative from your Knowledge Base in seconds. Every draft cites real organizational data — it never fabricates facts.",
    color: "#6B48CC",
  },
  {
    anchorId: "tour-tab-autoapply",
    title: "AutoApply",
    description:
      "Let Benavora fill out and submit funder portal forms for you, with a human approval checkpoint before anything is ever sent externally.",
    color: "#023E8A",
  },
  {
    anchorId: "tour-nav-settings",
    title: "Settings — Agents",
    description:
      "Turn on autonomous agents and set your confidence threshold from Settings > Agents — you control exactly how much Benavora does on its own.",
    color: "#2C4E3B",
  },
];

const TOUR_COMPLETED_KEY = "benavora_tour_completed";
const CARD_WIDTH = 340;
const CARD_ESTIMATED_HEIGHT = 210;
const GAP = 14;

interface AnchorRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function measure(anchorId: string): AnchorRect | null {
  const el = document.getElementById(anchorId);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

function PlatformTourInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const wantsTour = searchParams.get("tour") === "true";

  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<AnchorRect | null>(null);

  useEffect(() => {
    if (!wantsTour) return;
    if (window.localStorage.getItem(TOUR_COMPLETED_KEY) === "true") return;
    setStepIndex(0);
    setActive(true);
    // Only needs to fire once per mount — a second ?tour=true on the same
    // page (e.g. back button) re-triggers via a fresh navigation/mount, not
    // this effect re-running on unrelated re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const step = active ? TOUR_STEPS[stepIndex] : undefined;

  const updateRect = useCallback(() => {
    if (!step) return;
    setRect(measure(step.anchorId));
  }, [step]);

  useEffect(() => {
    if (!active || !step) return;
    updateRect();
    document.getElementById(step.anchorId)?.scrollIntoView({ behavior: "smooth", block: "center" });
    const interval = window.setInterval(updateRect, 150);
    window.addEventListener("resize", updateRect);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("resize", updateRect);
    };
  }, [active, step, updateRect]);

  const finish = useCallback(() => {
    setActive(false);
    window.localStorage.setItem(TOUR_COMPLETED_KEY, "true");
    router.replace(pathname);
  }, [router, pathname]);

  function next() {
    if (!step) return;
    if (stepIndex >= TOUR_STEPS.length - 1) {
      finish();
      return;
    }
    setStepIndex((i) => i + 1);
  }

  if (!active || !step) return null;

  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;

  let cardTop: number;
  let cardLeft: number;
  if (rect) {
    const spaceBelow = viewportH - (rect.top + rect.height);
    const placeBelow = spaceBelow > CARD_ESTIMATED_HEIGHT + GAP || rect.top < CARD_ESTIMATED_HEIGHT + GAP;
    cardTop = placeBelow
      ? Math.min(rect.top + rect.height + GAP, viewportH - CARD_ESTIMATED_HEIGHT - GAP)
      : Math.max(GAP, rect.top - CARD_ESTIMATED_HEIGHT - GAP);
    cardLeft = Math.min(Math.max(GAP, rect.left), viewportW - CARD_WIDTH - GAP);
  } else {
    cardTop = viewportH / 2 - CARD_ESTIMATED_HEIGHT / 2;
    cardLeft = viewportW / 2 - CARD_WIDTH / 2;
  }

  return (
    <>
      <div
        aria-hidden
        style={{
          position: "fixed",
          inset: 0,
          backgroundColor: "rgba(15, 23, 42, 0.45)",
          zIndex: 90,
        }}
      />

      {rect && (
        <div
          aria-hidden
          style={{
            position: "fixed",
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            border: `3px solid ${step.color}`,
            borderRadius: 12,
            boxShadow: `0 0 0 4px ${step.color}33, 0 0 24px ${step.color}66`,
            zIndex: 91,
            pointerEvents: "none",
            transition: "top 0.15s ease, left 0.15s ease, width 0.15s ease, height 0.15s ease",
          }}
        />
      )}

      <div
        role="dialog"
        aria-modal="true"
        aria-label={step.title}
        style={{
          position: "fixed",
          top: cardTop,
          left: cardLeft,
          width: CARD_WIDTH,
          backgroundColor: "#FFFFFF",
          borderRadius: 16,
          borderTop: `4px solid ${step.color}`,
          boxShadow: "0 20px 50px rgba(15, 23, 42, 0.35)",
          padding: "20px 20px 16px",
          zIndex: 92,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
          <p
            style={{
              margin: 0,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: step.color,
            }}
          >
            Step {stepIndex + 1} of {TOUR_STEPS.length}
          </p>
          <button
            type="button"
            onClick={finish}
            aria-label="Close tour"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "#94A3B8",
              padding: 2,
              lineHeight: 0,
            }}
          >
            <X size={16} />
          </button>
        </div>

        <h3 style={{ margin: "8px 0 6px", fontSize: 16, fontWeight: 700, color: "#0F172A" }}>
          {step.title}
        </h3>
        <p style={{ margin: "0 0 16px", fontSize: 13, lineHeight: 1.5, color: "#475569" }}>
          {step.description}
        </p>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <button
            type="button"
            onClick={finish}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
              color: "#64748B",
              padding: "8px 4px",
            }}
          >
            Skip tour
          </button>
          <button
            type="button"
            onClick={next}
            style={{
              backgroundColor: step.color,
              color: "#FFFFFF",
              border: "none",
              borderRadius: 999,
              padding: "8px 20px",
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {stepIndex === TOUR_STEPS.length - 1 ? "Finish" : "Next"}
          </button>
        </div>
      </div>
    </>
  );
}

export function PlatformTour() {
  return (
    <Suspense fallback={null}>
      <PlatformTourInner />
    </Suspense>
  );
}
