"use client";

import Image from "next/image";
import { Section, Display1, Display2 } from "@/components/marketing/Section";
import { CtaPrimary, CtaGhost } from "@/components/marketing/Cta";
import { mk, mkRadius } from "@/lib/marketing/theme";

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 13, fontWeight: 600, color: mk.heroMuted, letterSpacing: 0.6, marginBottom: 12 }}>
      {children}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: mk.surface, border: `1px solid ${mk.line}`, borderRadius: mkRadius.card, padding: 20 }}>
      {children}
    </div>
  );
}

const SCRAPE_TARGETS = [
  "The Home Depot Foundation",
  "Walmart.org",
  "Wells Fargo",
  "Bank of America",
  "JPMorgan Chase",
];

const FAQ_ITEMS: { question: string; answer: string }[] = [
  {
    question: "How big is the database today, honestly?",
    answer:
      "As of our last data check, the shared corporate prospect pool held 49 companies. It's a real, working database, not a demo dataset, but we'd rather tell you the actual current size than round it up. Most rows have a name, location, and industry; employee-count and revenue estimates are still sparse — enrichment is an ongoing process, not a finished one.",
  },
  {
    question: "Is the propensity score an AI prediction?",
    answer:
      "Where it's been computed, yes — a 0-100 overall likelihood score. Right now only a small minority of companies in the pool have one, because scoring runs as a separate enrichment pass rather than at the moment a company is added. Rows without a score simply show none, sorted after the ones that have it — we don't backfill a placeholder number.",
  },
  {
    question: "What can I actually filter by?",
    answer:
      "Company name, industry, and four ownership flags — family-owned, veteran-owned, minority-owned, and woman-owned — are populated and filter correctly today. Employee-count and revenue filters are real, functioning substring searches against those fields, but since most rows don't have those fields populated yet, they won't return much until enrichment catches up.",
  },
  {
    question: "Where does a new company giving-opportunity come from, separately from the prospect database?",
    answer:
      "A separate, on-demand agent fetches five major corporate foundation and giving pages directly — Home Depot, Walmart.org, Wells Fargo, Bank of America, and JPMorgan Chase — extracts any current giving program via Claude, and adds it as a real opportunity in your organization's own pipeline. It's triggered by a staff member, not on a schedule, and only creates a record when the page actually describes a program; an empty page produces nothing rather than a fabricated entry.",
  },
  {
    question: "Is this the same as a full corporate-intelligence research pipeline?",
    answer:
      "No, and we'd rather say that plainly than blur the two. A separate, much larger research pipeline for deep corporate and individual donor profiling exists in the platform and is real, working code — but it's gated behind a controlled rollout that hasn't started for any organization yet. What's described on this page is available today: a real, growing prospect database and a real, on-demand giving-page scraper, not that larger pipeline.",
  },
];

export default function CorporateGivingDatabaseClient() {
  return (
    <>
      <Section tone="forest">
        <Eyebrow>Solutions / Corporate Giving Database</Eyebrow>
        <Display1 tone="forest">A real, growing database of companies that actually give — not a purchased list.</Display1>
        <p style={{ color: mk.heroMuted, fontSize: 18, marginTop: 16, maxWidth: 680, lineHeight: 1.6 }}>
          A shared, filterable pool of companies with community-giving activity &mdash; searchable by
          industry, ownership type, and a propensity score where one has been computed &mdash; plus a
          separate on-demand agent that pulls real, current giving-program opportunities directly from
          five major corporate foundation pages into your own pipeline.
        </p>
        <div style={{ display: "flex", gap: 16, marginTop: 28, flexWrap: "wrap" }}>
          <CtaPrimary href="/demo">See the corporate database live</CtaPrimary>
          <CtaGhost href="#marketplace" onDark>
            See what&rsquo;s in it today
          </CtaGhost>
        </div>
      </Section>

      <Section tone="tint" id="marketplace">
        <Display2>The actual Corporate Marketplace</Display2>
        <p style={{ color: mk.ink, fontSize: 15, marginTop: 12, maxWidth: 680 }}>
          Not a mockup &mdash; the live, shared marketplace of corporate prospects, filterable by industry,
          ownership type, and sorted by propensity score or recency, with a real per-company detail link.
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
            src="/marketing/platform-corporate-marketplace-live.png"
            alt="The live Corporate Marketplace page, showing filterable corporate prospect cards with industry, ownership badges, and a propensity score"
            width={1440}
            height={900}
            priority
            style={{ width: "100%", height: "auto", display: "block" }}
          />
        </div>
      </Section>

      <Section tone="paper">
        <Display2>Where a real company record comes from</Display2>
        <p style={{ color: mk.ink, fontSize: 15, marginTop: 12, maxWidth: 720 }}>
          A separate, on-demand agent fetches these five corporate giving pages directly and extracts any
          current giving program with Claude &mdash; a staff member triggers it, it isn&rsquo;t on a
          schedule yet, and a page with no active program simply produces nothing.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginTop: 24, maxWidth: 760 }}>
          {SCRAPE_TARGETS.map((name) => (
            <Card key={name}>
              <div style={{ fontSize: 14, fontWeight: 700, color: mk.forest }}>{name}</div>
            </Card>
          ))}
        </div>
      </Section>

      <Section tone="surface">
        <Display2>What&rsquo;s real today, and what isn&rsquo;t yet</Display2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20, marginTop: 24 }}>
          <Card>
            <div style={{ fontSize: 13, fontWeight: 700, color: mk.terracotta, letterSpacing: 0.4 }}>
              WORKING TODAY
            </div>
            <ul style={{ marginTop: 12, paddingLeft: 18, color: mk.ink, fontSize: 15, lineHeight: 1.8 }}>
              <li>Search and filter by company name, industry, and ownership type</li>
              <li>Sort by propensity score (where computed) or by recently added</li>
              <li>Trigger the five-target giving-page scraper on demand</li>
              <li>Link straight from a result into your outreach queue, pre-selected</li>
            </ul>
          </Card>
          <Card>
            <div style={{ fontSize: 13, fontWeight: 700, color: mk.terracotta, letterSpacing: 0.4 }}>
              STILL EARLY
            </div>
            <ul style={{ marginTop: 12, paddingLeft: 18, color: mk.ink, fontSize: 15, lineHeight: 1.8 }}>
              <li>Employee-count and revenue estimates are populated for very few companies</li>
              <li>A propensity score exists for only a small minority of the database</li>
              <li>The five-target scraper is manually triggered, not yet on a recurring schedule</li>
              <li>A much larger 51-agent research pipeline exists but isn&rsquo;t open to any org yet</li>
            </ul>
          </Card>
        </div>
      </Section>

      <Section tone="tint">
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

      <Section tone="paper">
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
            padding: 32,
          }}
        >
          <div style={{ maxWidth: 520 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: mk.terracotta, letterSpacing: 0.4 }}>
              READY TO ASK A COMPANY YOU&rsquo;VE FOUND?
            </div>
            <div style={{ fontFamily: "var(--mk-display)", fontSize: 24, color: mk.forest, marginTop: 8 }}>
              See how a corporate ask actually gets submitted
            </div>
            <p style={{ fontSize: 15, color: mk.ink, marginTop: 8 }}>
              Corporate Donation Application Software covers what happens once you&rsquo;ve picked a company.
            </p>
          </div>
          <CtaGhost href="/solutions/corporate-donation-application-software">
            See Corporate Donation Application Software
          </CtaGhost>
        </div>
      </Section>

      <Section tone="forest">
        <div style={{ textAlign: "center" }}>
          <Display2 tone="forest">Search the corporate database yourself</Display2>
          <p style={{ color: mk.heroMuted, fontSize: 17, marginTop: 16, maxWidth: 560, marginLeft: "auto", marginRight: "auto" }}>
            A live demo shows the real filters, the real data gaps, and exactly how a company moves from
            the database into an outreach queue.
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
