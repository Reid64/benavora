import Link from "next/link";

// "What will it cost and how fast can I start?" — a structural placeholder
// only. Final pricing has not been published for this section; tier names
// (Starter / Growth / Enterprise) are illustrative labels, not the live
// /pricing page's tiers (Starter / Professional / Enterprise, which does
// carry real dollar figures — see src/lib/utils/pricing-plans.ts). Do not
// backfill invented numbers here; when real pricing for this section is
// decided, replace TIERS[].price and remove this comment. Same dark forest
// canvas as the surrounding homepage sections (bm- prefixed classes,
// #222624 background, #3b403b divider — see page.tsx bm-identity/bm-outcome,
// CanITrustIt.tsx, DoesItWorkForOrgsLikeMine.tsx).
//
// "How fast can I start" below only states what's structurally verified:
// /register is a public, unauthenticated route (src/app/register/page.tsx)
// and the onboarding wizard that follows it is self-serve
// (src/app/(dashboard)/onboarding/page.tsx, STEPS/TOTAL_STEPS-driven) — not a
// sales-gated signup. No specific setup-time duration is claimed; that would
// require a measurement this section doesn't have evidence for.
const TIERS: { name: string; blurb: string; cta: string; href: string }[] = [
  {
    name: "Starter",
    blurb: "Pricing for this tier is still being finalized.",
    cta: "Get in touch",
    href: "/pricing",
  },
  {
    name: "Growth",
    blurb: "Pricing for this tier is still being finalized.",
    cta: "Get in touch",
    href: "/pricing",
  },
  {
    name: "Enterprise",
    blurb: "Pricing for this tier is still being finalized.",
    cta: "See how Benavora would fund your mission",
    href: "/demo",
  },
];

export function WhatWillItCost() {
  return (
    <section className="bm-cost" aria-labelledby="cost-title">
      <p className="bm-eyebrow">What will it cost and how fast can I start?</p>
      <h2 id="cost-title">
        Pricing is still being finalized.
        <br />
        Here&rsquo;s the shape of it so far.
      </h2>
      <p className="bm-cost-lede">
        We&rsquo;d rather show you an honest placeholder than a number we can&rsquo;t stand behind yet. These are
        the tiers we&rsquo;re building toward — reach out and we&rsquo;ll tell you where things stand for your
        organization.
      </p>

      <div className="bm-cost-grid">
        {TIERS.map((tier) => (
          <div className="bm-cost-card" key={tier.name}>
            <div className="bm-cost-name">{tier.name}</div>
            <div className="bm-cost-price">Contact for pricing</div>
            <p className="bm-cost-blurb">{tier.blurb}</p>
            <a href={tier.href} className="bm-cost-link">
              {tier.cta} <span aria-hidden="true">&rarr;</span>
            </a>
          </div>
        ))}
      </div>

      <p className="bm-cost-speed">
        Starting is self-serve: create an account and work through your organization profile yourself — there&rsquo;s
        no procurement process or implementation team in the way. Enterprise setup starts with a conversation with
        our team instead.
      </p>

      <div className="bm-cta-wrap">
        <Link
          href="/pricing"
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
          See pricing details <span aria-hidden="true">&rarr;</span>
        </Link>
      </div>

      <style jsx>{`
        .bm-cost {
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
        .bm-cost h2 {
          font-size: clamp(28px, 3vw, 38px);
          line-height: 1.25;
          letter-spacing: -0.02em;
          font-weight: 550;
          color: #f0f2ee;
          max-width: 820px;
          margin: 18px auto 0;
        }
        .bm-cost-lede {
          color: #bdc4be;
          max-width: 660px;
          margin: 20px auto 0;
          font-size: 16px;
          line-height: 1.8;
        }
        .bm-cost-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 16px;
          max-width: 940px;
          margin: 40px auto 0;
          text-align: left;
        }
        .bm-cost-card {
          background: #1b1e1c;
          border: 1px dashed #4a5049;
          border-radius: 14px;
          padding: 24px 22px;
          display: flex;
          flex-direction: column;
        }
        .bm-cost-name {
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #efb344;
          margin-bottom: 12px;
        }
        .bm-cost-price {
          font-size: 20px;
          font-weight: 550;
          font-style: italic;
          color: #8b938c;
          margin-bottom: 10px;
        }
        .bm-cost-blurb {
          color: #9aa39c;
          font-size: 13.5px;
          line-height: 1.6;
          margin: 0 0 18px;
          flex: 1;
        }
        .bm-cost-link {
          font-size: 13.5px;
          font-weight: 600;
          color: #d7e0d5;
          text-decoration: none;
        }
        .bm-cost-link:hover {
          color: #efb344;
        }
        .bm-cost-speed {
          color: #bdc4be;
          max-width: 700px;
          margin: 36px auto 0;
          font-size: 15px;
          line-height: 1.8;
        }
        .bm-cta-wrap {
          margin-top: 28px;
        }
        @media (max-width: 720px) {
          .bm-cost {
            padding: 44px 24px 52px;
          }
          .bm-cost-lede,
          .bm-cost-speed {
            font-size: 15px;
          }
          .bm-cost-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </section>
  );
}
