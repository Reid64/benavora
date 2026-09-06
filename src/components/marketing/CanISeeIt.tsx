import Link from "next/link";
import { ProductTour } from "@/components/marketing/ProductTour";

// "Can I see it" — a compact preview of the self-guided /tour, auto-cycling
// through three real, live screenshots of the product (not illustrations or
// mockups), matching the dark forest canvas the surrounding homepage
// sections use (bm- prefixed classes, #222624 background — see page.tsx and
// FundraisingToolkit.tsx). Screenshots captured against an authenticated
// session with real seeded rows; see scripts/audit/tour-candidate-shots.mjs
// and test-evidence/marketing/tour-candidates/ for how they were captured.
export function CanISeeIt() {
  return (
    <section className="bm-seeit" aria-labelledby="seeit-title">
      <div className="bm-eyebrow">Can I see it?</div>
      <h2 id="seeit-title">
        This is the real product.
        <br />
        Not a mockup.
      </h2>
      <p className="bm-lede">
        A minute-long preview of Research, Draft Generator, and AutoApply—screenshotted live from an authenticated
        Benavora account, the same interface your team works in every day.
      </p>

      <div className="bm-preview">
        <ProductTour variant="compact" />
      </div>

      <div className="bm-cta-wrap">
        <Link
          href="/tour"
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
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLAnchorElement).style.background = "#4c6a55";
            (e.currentTarget as HTMLAnchorElement).style.borderColor = "#a0b6a5";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLAnchorElement).style.background = "#405b49";
            (e.currentTarget as HTMLAnchorElement).style.borderColor = "#77927e";
          }}
        >
          Take the full tour <span aria-hidden="true">&rarr;</span>
        </Link>
      </div>

      <style jsx>{`
        .bm-seeit {
          max-width: 1120px;
          margin: 0 auto;
          text-align: center;
          padding: 64px 32px 80px;
          background: #222624;
          border-top: 1px solid #3b403b;
        }
        .bm-eyebrow {
          font-size: 14px;
          font-weight: 600;
          letter-spacing: 0.02em;
          color: #b9cbbd;
        }
        .bm-seeit h2 {
          font-size: clamp(28px, 3vw, 38px);
          line-height: 1.25;
          letter-spacing: -0.02em;
          font-weight: 550;
          color: #f0f2ee;
          max-width: 820px;
          margin: 18px auto 0;
        }
        .bm-lede {
          color: #bdc4be;
          max-width: 640px;
          margin: 20px auto 0;
          font-size: 16px;
          line-height: 1.8;
        }
        .bm-preview {
          margin: 40px auto 0;
        }
        .bm-cta-wrap {
          margin-top: 28px;
        }
        @media (max-width: 640px) {
          .bm-seeit {
            padding: 44px 24px 52px;
          }
          .bm-lede {
            font-size: 15px;
          }
          .bm-preview {
            margin-top: 28px;
          }
        }
      `}</style>
    </section>
  );
}
