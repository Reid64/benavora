"use client";

import Link from "next/link";
import { ProductTour } from "@/components/marketing/ProductTour";

// Self-guided product tour: three real screenshots (Research, Draft
// Generator, AutoApply Engine) walked through automatically or by hand, no
// form and no calendar required to view it. Same dark forest chrome as the
// homepage's "Can I see it" section (src/components/marketing/CanISeeIt.tsx),
// which is the section this page expands on -- see the "Take the full tour"
// CTA there and the "Self-guided tour" card in page.tsx's "What should I do
// next?" section, both of which point here.
export default function TourClient() {
  return (
    <section className="bm-tour" aria-labelledby="tour-title">
      <div className="bm-tour-head">
        <div className="bm-eyebrow">The full product tour</div>
        <h1 id="tour-title">See discovery, drafting, and Auto Apply run end to end.</h1>
        <p className="bm-lede">
          Three real screens from the live Benavora application, walked through automatically or at your own pace.
          About a minute, start to finish. No form, no calendar, no sign-up to watch it.
        </p>
      </div>

      <ProductTour variant="full" />

      <div className="bm-tour-cta">
        <Link
          href="/demo"
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
          }}
        >
          Book a live demo <span aria-hidden="true">&rarr;</span>
        </Link>
        <Link
          href="/#fundraising-toolkit"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 12,
            borderRadius: 8,
            padding: "15px 25px",
            fontSize: 14,
            fontWeight: 600,
            color: "#f0f2ee",
            background: "transparent",
            border: "1px solid #4a5049",
            textDecoration: "none",
          }}
        >
          Back to the homepage
        </Link>
      </div>

      <style jsx>{`
        .bm-tour {
          max-width: 1120px;
          margin: 0 auto;
          padding: 64px 32px 80px;
          background: #222624;
        }
        .bm-tour-head {
          max-width: 720px;
          margin: 0 auto 48px;
          text-align: center;
        }
        .bm-eyebrow {
          font-size: 14px;
          font-weight: 600;
          letter-spacing: 0.02em;
          color: #b9cbbd;
        }
        .bm-tour-head h1 {
          font-size: clamp(30px, 3.6vw, 42px);
          line-height: 1.2;
          letter-spacing: -0.02em;
          font-weight: 550;
          color: #f0f2ee;
          margin: 18px 0 0;
        }
        .bm-lede {
          color: #bdc4be;
          max-width: 620px;
          margin: 18px auto 0;
          font-size: 16px;
          line-height: 1.8;
        }
        .bm-tour-cta {
          display: flex;
          justify-content: center;
          gap: 16px;
          flex-wrap: wrap;
          margin-top: 48px;
        }
        @media (max-width: 640px) {
          .bm-tour {
            padding: 44px 20px 52px;
          }
        }
      `}</style>
    </section>
  );
}
