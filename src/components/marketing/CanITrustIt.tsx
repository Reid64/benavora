import Link from "next/link";
import { BotanicalMotif } from "@/components/marketing/BotanicalMotif";
import { mkGrainBackground, SectionDividerDef } from "@/lib/marketing/texture";

// "Can I trust it?" — a short teaser only. The full Trust and Governance
// content lives at /trust (content/marketing/trust.mdx, rendered through
// src/app/(marketing)/[...slug]/page.tsx) and is out of scope here; this
// section must not duplicate or preempt it. Same dark forest canvas as the
// surrounding homepage sections (bm- prefixed classes, #222624 background,
// #3b403b divider — see page.tsx bm-identity/bm-outcome, CanIControlIt.tsx,
// CanISeeIt.tsx).
//
// Both claims below are read from the real implementation, not invented:
// - Provenance: opportunities.source_type (opportunity_source_type enum,
//   src/types/database.ts) tags every funding record with where it came
//   from; src/lib/sources/funding-source-registry.ts seeds the underlying
//   federal/foundation/state source catalog (migration 097).
// - Drafts: src/lib/drafts/generator.ts (~L929-959) attaches a `sources`
//   transparency list to every generated draft — every knowledge_base
//   entry, proven narrative, and intelligence-library excerpt the model
//   was given — plus (L825-834) named citations on need-statement
//   statistics pulled from government data sources.
// - Human oversight: this deliberately matches CanIControlIt.tsx's
//   corrected framing, not the "always approved" claim on /trust and
//   /platform/autoapply that does not match assessSubmissionRisk()
//   (src/lib/autoapply/risk-engine.ts) — low/medium-risk submissions proceed
//   without a human approving the final form; CAPTCHA, high/critical risk,
//   and missing portal credentials always pause for one.
export function CanITrustIt() {
  return (
    <section
      className="bm-trustit"
      aria-labelledby="trustit-title"
      style={{ position: "relative", ...mkGrainBackground("#222624", true) }}
    >
      <BotanicalMotif
        variant="corner-roots"
        color="#efb344"
        opacity={0.06}
        style={{ right: 0, top: 0, width: 190, height: 190, transform: "scaleX(-1)" }}
      />
      <p className="bm-eyebrow">Can I trust it?</p>
      <h2 id="trustit-title">
        Every source is named.
        <br />
        Every stop is on purpose.
      </h2>
      <p className="bm-trustit-lede">
        Every opportunity is tagged to the funding source it came from, and every AI-drafted narrative ships with
        the exact records it was built from. Automation moves on routine work by itself; anything unfamiliar or
        high-risk — a CAPTCHA, a first-time funder — stops for a person before it goes further.
      </p>

      <div className="bm-cta-wrap">
        <Link
          href="/trust"
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
          Read Trust and Governance <span aria-hidden="true">&rarr;</span>
        </Link>
      </div>

      <SectionDividerDef variant="arc" fill="#222624" />

      <style jsx>{`
        .bm-trustit {
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
        .bm-trustit h2 {
          font-size: clamp(28px, 3vw, 38px);
          line-height: 1.25;
          letter-spacing: -0.02em;
          font-weight: 550;
          color: #f0f2ee;
          max-width: 820px;
          margin: 18px auto 0;
        }
        .bm-trustit-lede {
          color: #bdc4be;
          max-width: 680px;
          margin: 20px auto 0;
          font-size: 16px;
          line-height: 1.8;
        }
        .bm-cta-wrap {
          margin-top: 28px;
        }
        @media (max-width: 720px) {
          .bm-trustit {
            padding: 44px 24px 52px;
          }
          .bm-trustit-lede {
            font-size: 15px;
          }
        }
      `}</style>
    </section>
  );
}
