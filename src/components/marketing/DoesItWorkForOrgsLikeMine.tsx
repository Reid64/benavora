import Link from "next/link";

// "Does it work for organizations like mine?" — deliberately answered with an
// honest single-pilot status instead of fabricated case studies, a logo wall,
// or an unmeasured outcome number. Same dark forest canvas as the surrounding
// homepage sections (bm- prefixed classes, #222624 background, #3b403b
// divider — see page.tsx bm-identity/bm-outcome, CanITrustIt.tsx,
// WillItUnderstandMyOrg.tsx).
//
// Every claim below is read from real, verified project state, not invented:
// - FAITH Foundation (org id b1ab7402-dfc2-4712-869f-70ea3566cc1d) is
//   Benavora's one active pilot org — onboarding_completed=true, subscription
//   status='active' (AGENT_VERIFICATION_LOG.md pre-flight checks), a real
//   Texas 501(c)(3) working on emergency/transitional housing (governance/
//   BLUEPRINT.md "Primary Use Case (In-House)"; AUTONOMOUS_PLATFORM_VISION.md
//   "rural Texas emergency/transitional housing").
// - The submission side is real and live-verified (2026-09-03): a
//   submission_queue row was driven through real Claude-personalized
//   drafting and a real portal form-fill by the live Railway worker, landing
//   a real autoapply_submissions row (status=submitted) — not a mock.
// - What is explicitly NOT claimed: a closed confirmation-email loop, or any
//   award/dollar/win-rate outcome. confirmation-monitor.ts currently no-ops
//   every cycle because its Gmail OAuth refresh token has never been set (a
//   one-time human consent step, not a code gap), so end-to-end confirmation
//   receipt has not been observed with a real funder. See memory
//   benavora-autoapply-e2e-loop-blocked-on-email-2026-09-03. No outcome
//   number is stated here because none has been measured.
export function DoesItWorkForOrgsLikeMine() {
  return (
    <section className="bm-fitcheck" aria-labelledby="fitcheck-title">
      <p className="bm-eyebrow">Does it work for organizations like mine?</p>
      <h2 id="fitcheck-title">
        One real pilot running today.
        <br />
        Case studies are still being written.
      </h2>
      <p className="bm-fitcheck-lede">
        We&rsquo;d rather tell you exactly where we are than dress up a placeholder. Benavora doesn&rsquo;t have a
        published case study yet. What it has is a live pilot.
      </p>

      <div className="bm-pilot-card">
        <span className="bm-pilot-badge">Pilot underway</span>
        <h3>FAITH Foundation</h3>
        <p>
          A Texas 501(c)(3) working on emergency and transitional housing. Its organization profile, programs, and
          documents are fully onboarded, and it&rsquo;s the org Benavora runs the AutoApply pipeline against in
          production&mdash;real opportunity discovery, real Claude-drafted applications, and real portal submissions
          held for human approval before anything goes out.
        </p>
        <p className="bm-pilot-caveat">
          What we&rsquo;re not claiming yet: award outcomes. We haven&rsquo;t published a dollar figure or win rate
          because we haven&rsquo;t measured one we&rsquo;re willing to stand behind. As more organizations complete a
          full pilot, this section becomes real case studies&mdash;not just one honest status update.
        </p>
      </div>

      <div className="bm-cta-wrap">
        <Link
          href="/solutions/housing"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 12,
            borderRadius: 8,
            padding: "15px 25px",
            fontSize: 14,
            fontWeight: 600,
            color: "#f5f7f2",
            background: "#405b49",
            border: "1px solid #77927e",
            boxShadow: "0 4px 14px rgba(0, 0, 0, 0.125)",
            textDecoration: "none",
            transition: "background 0.2s, border-color 0.2s",
          }}
        >
          See how Benavora fits housing-focused nonprofits <span aria-hidden="true">&rarr;</span>
        </Link>
      </div>

      <style jsx>{`
        .bm-fitcheck {
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
        .bm-fitcheck h2 {
          font-size: clamp(28px, 3vw, 38px);
          line-height: 1.25;
          letter-spacing: -0.02em;
          font-weight: 550;
          color: #f0f2ee;
          max-width: 820px;
          margin: 18px auto 0;
        }
        .bm-fitcheck-lede {
          color: #bdc4be;
          max-width: 660px;
          margin: 20px auto 0;
          font-size: 16px;
          line-height: 1.8;
        }
        .bm-pilot-card {
          max-width: 680px;
          margin: 40px auto 0;
          text-align: left;
          background: #262b27;
          border: 1px solid #3b403b;
          border-top: 3px solid #efb344;
          border-radius: 12px;
          padding: 28px 32px;
        }
        .bm-pilot-badge {
          display: inline-block;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: #efb344;
          background: rgba(239, 179, 68, 0.12);
          border: 1px solid rgba(239, 179, 68, 0.35);
          border-radius: 9999px;
          padding: 5px 12px;
        }
        .bm-pilot-card h3 {
          font-size: 20px;
          font-weight: 600;
          color: #f2f5ef;
          margin: 14px 0 10px;
        }
        .bm-pilot-card p {
          color: #c7cec8;
          font-size: 15px;
          line-height: 1.75;
          margin: 0;
        }
        .bm-pilot-caveat {
          color: #9aa39c;
          margin-top: 14px !important;
          padding-top: 14px;
          border-top: 1px solid #3b403b;
        }
        .bm-cta-wrap {
          margin-top: 28px;
        }
        @media (max-width: 720px) {
          .bm-fitcheck {
            padding: 44px 24px 52px;
          }
          .bm-fitcheck-lede {
            font-size: 15px;
          }
          .bm-pilot-card {
            padding: 22px 20px;
          }
        }
      `}</style>
    </section>
  );
}
