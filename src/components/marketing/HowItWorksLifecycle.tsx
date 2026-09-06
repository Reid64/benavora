import Link from "next/link";

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

export function HowItWorksLifecycle() {
  return (
    <section className="bm-hiw" aria-labelledby="hiw-title">
      <p className="bm-eyebrow">How does it work</p>
      <h2 id="hiw-title">
        Six stages. The same divisions you just explored above.
      </h2>
      <p className="bm-hiw-lede">
        Mission Control coordinates every stage below across all 48 agents; each stage itself is carried by one or
        more of the specialist divisions in the network above—shown here in their matching accent color.
      </p>

      <ol className="bm-hiw-row">
        {STAGES.map((s, i) => (
          <li key={s.label} className="bm-hiw-stage">
            {i > 0 ? <span className="bm-hiw-arrow" aria-hidden="true">&rarr;</span> : null}
            <div className="bm-hiw-card">
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

      <style jsx>{`
        .bm-hiw {
          max-width: 1120px;
          margin: 0 auto;
          text-align: center;
          padding: 64px 32px 72px;
          background: #222624;
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
        .bm-hiw-row {
          list-style: none;
          margin: 44px 0 0;
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
        }
      `}</style>
    </section>
  );
}
