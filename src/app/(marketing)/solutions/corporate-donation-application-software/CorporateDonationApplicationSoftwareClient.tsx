"use client";

import Image from "next/image";
import { Section, Display1, Display2 } from "@/components/marketing/Section";
import { CtaPrimary, CtaGhost } from "@/components/marketing/Cta";
import { mk, mkElevation, mkRadius } from "@/lib/marketing/theme";

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 13, fontWeight: 600, color: mk.heroMuted, letterSpacing: 0.6, marginBottom: 12 }}>
      {children}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: mk.surface, border: `1px solid ${mk.line}`, borderRadius: mkRadius.card, boxShadow: mkElevation[1], padding: 20 }}>
      {children}
    </div>
  );
}

const TIMING_ROWS: { quarter: string; score: string; note: string }[] = [
  { quarter: "Q4 (Oct–Dec)", score: "1.0 — optimal", note: "Year-end giving season, when most corporate CSR budgets actually move." },
  { quarter: "Q1 (Jan–Mar)", score: "0.8 — strong", note: "New fiscal-year budget just opened at most companies." },
  { quarter: "Q3 (Jul–Sep)", score: "0.6 — moderate", note: "Mid-cycle; budget exists but isn't the priority window." },
  { quarter: "Q2 (Apr–Jun)", score: "0.5 — weakest", note: "Furthest from both budget-open and year-end urgency." },
];

const AMOUNT_ROWS: { category: string; amount: string }[] = [
  { category: "Corporate foundation", amount: "$25,000 default ask" },
  { category: "Corporate donation program", amount: "$10,000 default ask" },
  { category: "Corporate sponsorship", amount: "$10,000 default ask" },
];

const FAQ_ITEMS: { question: string; answer: string }[] = [
  {
    question: "What's actually different about how AutoApply handles a corporate ask?",
    answer:
      "Three concrete things, not a marketing distinction. It scores the current month against a corporate-specific seasonal curve rather than a generic one. It falls back to a corporate-category-specific default ask amount when there's no giving history to go on, instead of one generic number. And it runs a field-extraction pass tuned specifically to corporate and foundation donation-portal HTML, not a generic web form.",
  },
  {
    question: "Where does the Q4-heavy timing model actually come from?",
    answer:
      "It's a fixed seasonal curve built into the submission timing logic: Q4 scores 1.0 (optimal), Q1 scores 0.8, Q3 scores 0.6, and Q2 — the furthest quarter from both a fresh budget and year-end urgency — scores lowest at 0.5. It's the same real function that also carries separate curves for government and foundation funders, so a corporate ask is never scored against a government fiscal calendar by mistake.",
  },
  {
    question: "How does it decide how much to actually ask for?",
    answer:
      "When there's no prior giving history to calculate from, the default ask is set by the funder's specific category: $25,000 for a corporate foundation, $10,000 for a corporate giving program or a corporate sponsorship. These aren't the same number split three ways — a foundation-run corporate giving arm gets a materially different default than a direct sponsorship ask.",
  },
  {
    question: "Does the capability match care what kind of company it is?",
    answer:
      "Yes. A company's type maps to what it plausibly gives — a law firm or consulting company matches best against a service-type ask, a retailer against an in-kind donation, and a corporate foundation or corporate-giving program against a monetary ask. A request that doesn't match the company's likely giving type is scored lower, not silently submitted anyway.",
  },
  {
    question: "Is this a separate application product from the rest of AutoApply?",
    answer:
      "No, and we'd rather be direct about that than invent a separate corporate product that doesn't exist. Corporate opportunities move through the exact same governed AutoApply submission engine as every other funder type — timing, amount, and field-extraction are simply parameterized by the funder's category, corporate included, not handled by a different pipeline.",
  },
];

export default function CorporateDonationApplicationSoftwareClient() {
  return (
    <>
      <Section tone="forest">
        <Eyebrow>Solutions / Corporate Donation Application Software</Eyebrow>
        <Display1 tone="forest">A corporate ask, timed and sized like one &mdash; not a government grant with the labels swapped.</Display1>
        <p style={{ color: mk.heroMuted, fontSize: 18, marginTop: 16, maxWidth: 680, lineHeight: 1.6 }}>
          The same submission engine that fills and submits government and foundation applications also
          handles corporate giving portals &mdash; but it scores the calendar, the default ask amount, and
          the company&rsquo;s likely giving type differently for a corporate program than it does for a
          government grant, because they aren&rsquo;t the same thing.
        </p>
        <div style={{ display: "flex", gap: 16, marginTop: 28, flexWrap: "wrap" }}>
          <CtaPrimary href="/demo">See a corporate submission scored</CtaPrimary>
          <CtaGhost href="#timing" onDark>
            See the seasonal model
          </CtaGhost>
        </div>
      </Section>

      <Section tone="tint">
        <Display2>The actual Opportunities feed, filtered to Corporate</Display2>
        <p style={{ color: mk.ink, fontSize: 15, marginTop: 12, maxWidth: 680 }}>
          Not a mockup &mdash; the live Opportunities list with its &ldquo;Corporate&rdquo; filter chip
          selected, one of the same five source-family chips (Federal, Foundation, Corporate,
          State/Local, plus deadline-based Rolling and Closing Soon chips) every organization sees.
          This particular account has no corporate-source opportunities loaded yet, and we&rsquo;d
          rather show that honest empty state than a staged one.
        </p>
        <div
          style={{
            marginTop: 24,
            borderRadius: mkRadius.shot,
            overflow: "hidden",
            border: `1px solid ${mk.line}`,
            boxShadow: "0 12px 32px rgba(31,58,46,0.14)",
          }}
        >
          <Image
            src="/marketing/platform-opportunities-corporate-filter-live.png"
            alt="The live Opportunities page with the Corporate filter chip selected, showing this account's real (currently empty) corporate-source result set"
            width={1440}
            height={900}
            priority
            style={{ width: "100%", height: "auto", display: "block" }}
          />
        </div>
      </Section>

      <Section tone="paper" id="timing">
        <Display2>The seasonal timing model, exactly as coded</Display2>
        <div style={{ display: "grid", gap: 12, marginTop: 24, maxWidth: 720 }}>
          {TIMING_ROWS.map((row) => (
            <Card key={row.quarter}>
              <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: mk.forest }}>{row.quarter}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: mk.terracotta }}>{row.score}</div>
              </div>
              <p style={{ fontSize: 14, color: mk.ink, marginTop: 6, lineHeight: 1.6 }}>{row.note}</p>
            </Card>
          ))}
        </div>
      </Section>

      <Section tone="surface">
        <Display2>Default ask, by corporate category</Display2>
        <p style={{ color: mk.ink, fontSize: 15, marginTop: 12, maxWidth: 680 }}>
          Only used when there&rsquo;s no giving history to calculate a better number from &mdash; a
          fallback, not the whole model.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginTop: 24, maxWidth: 720 }}>
          {AMOUNT_ROWS.map((row) => (
            <Card key={row.category}>
              <div style={{ fontSize: 13, fontWeight: 700, color: mk.terracotta, letterSpacing: 0.4 }}>
                {row.category.toUpperCase()}
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, color: mk.forest, marginTop: 8 }}>{row.amount}</div>
            </Card>
          ))}
        </div>
      </Section>

      <Section tone="tint">
        <Display2>Stated limitations</Display2>
        <div style={{ display: "grid", gap: 16, marginTop: 24, maxWidth: 760 }}>
          <Card>
            <p style={{ color: mk.ink, fontSize: 15, lineHeight: 1.7, margin: 0 }}>
              The seasonal model and default amounts are heuristics built from general corporate giving
              patterns, not a per-company calendar. A specific company that gives off-cycle will still be
              scored against the general curve unless its own giving history says otherwise.
            </p>
          </Card>
          <Card>
            <p style={{ color: mk.ink, fontSize: 15, lineHeight: 1.7, margin: 0 }}>
              There is no dedicated corporate-application product separate from AutoApply itself &mdash;
              everything above is real parameterization inside the same governed submission engine
              described on the Grant Application Automation page, not a second system.
            </p>
          </Card>
        </div>
      </Section>

      <Section tone="paper">
        <Display2>FAQ</Display2>
        <div style={{ marginTop: 24, display: "grid", gap: 18, maxWidth: 760 }}>
          {FAQ_ITEMS.map((f) => (
            <div key={f.question}>
              <div style={{ fontSize: 16, fontWeight: 600, color: mk.forest }}>{f.question}</div>
              <div style={{ fontSize: 15, color: mk.ink, marginTop: 6, lineHeight: 1.6 }}>{f.answer}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section tone="tint">
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 20,
            background: mk.surface,
            border: `1px solid ${mk.line}`,
            borderRadius: mkRadius.shot,
            boxShadow: mkElevation[2],
            padding: 32,
          }}
        >
          <div style={{ maxWidth: 520 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: mk.terracotta, letterSpacing: 0.4 }}>
              NEED COMPANIES TO ASK FIRST?
            </div>
            <div style={{ fontFamily: "var(--mk-display)", fontSize: 24, color: mk.forest, marginTop: 8 }}>
              Start with the corporate database
            </div>
            <p style={{ fontSize: 15, color: mk.ink, marginTop: 8 }}>
              Corporate Giving Database is where these opportunities and prospects come from before they
              reach this submission engine.
            </p>
          </div>
          <CtaGhost href="/solutions/corporate-giving-database">See Corporate Giving Database</CtaGhost>
        </div>
      </Section>

      <Section tone="forest">
        <div style={{ textAlign: "center" }}>
          <Display2 tone="forest">See a real corporate ask timed and sized</Display2>
          <p style={{ color: mk.heroMuted, fontSize: 17, marginTop: 16, maxWidth: 560, marginLeft: "auto", marginRight: "auto" }}>
            A live demo scores a real corporate opportunity against the seasonal model and shows the
            default ask it would fall back to.
          </p>
          <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 28, flexWrap: "wrap" }}>
            <CtaPrimary href="/demo">Book a demo</CtaPrimary>
            <CtaGhost href="/register" onDark>
              Create an account
            </CtaGhost>
          </div>
        </div>
      </Section>
    </>
  );
}
