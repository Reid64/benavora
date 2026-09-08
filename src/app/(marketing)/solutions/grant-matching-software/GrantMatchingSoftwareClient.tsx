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

const FAQ_ITEMS: { question: string; answer: string }[] = [
  {
    question: "What's the difference between grant discovery and grant matching?",
    answer:
      "Discovery finds candidate opportunities across sources you might not have checked. Matching takes a mission statement or a funder list you already have and scores how well each one actually fits, either instantly by keyword overlap or, for funders in your own list, by Claude-scored semantic alignment with a stated reason.",
  },
  {
    question: "How is the match percentage calculated?",
    answer:
      "The instant Funder Matching pass scores by keyword overlap between your mission statement and a foundation's stated focus-area text, a plain, explainable calculation, not a black-box model. The semantic pass, run per-funder on funders already in your organization's list, has Claude score 0-100 with a one-sentence reason and filters out anything scoring below 40.",
  },
  {
    question: "Does a high match score mean we'll win the grant?",
    answer:
      "No. Both scores measure stated alignment between your mission and a funder's stated priorities, not competitive strength, deadline timing, or funding availability that cycle. Treat a high score as a reason to read the full opportunity, not a guarantee.",
  },
  {
    question: "Can we match against funders we've already researched, not just a shared directory?",
    answer:
      "Yes. The semantic pass scores against your organization's own funder list. The instant keyword pass searches a shared foundation directory of over 130,000 indexed profiles, useful for finding new candidates outside what you've already researched.",
  },
  {
    question: "Does running a match cost extra AI usage every time?",
    answer:
      "The keyword-overlap pass is a plain-text comparison with no AI call, so it's effectively free to re-run. The semantic pass calls Claude per funder scored, and is metered the same way other AI-driven agent runs are on your plan.",
  },
];

export default function GrantMatchingSoftwareClient() {
  return (
    <>
      <Section tone="forest">
        <Eyebrow>Solutions / Grant Matching Software</Eyebrow>
        <Display1 tone="forest">A ranked list of funders isn&rsquo;t the same as knowing which ones actually fit.</Display1>
        <p style={{ color: mk.heroMuted, fontSize: 18, marginTop: 16, maxWidth: 680, lineHeight: 1.6 }}>
          A search feed tells you a grant exists. Matching software tells you, before you spend an hour
          reading the full notice, how closely it actually aligns with your mission &mdash; scored two ways:
          an instant keyword-overlap pass against a shared foundation directory, and a Claude-scored semantic
          pass with a stated reason for every funder already on your own list.
        </p>
        <div style={{ display: "flex", gap: 16, marginTop: 28, flexWrap: "wrap" }}>
          <CtaPrimary href="/demo">See your mission scored against real funders</CtaPrimary>
          <CtaGhost href="#scores" onDark>
            See how scoring works
          </CtaGhost>
        </div>
      </Section>

      <Section tone="tint">
        <Display2>The actual Funder Matching results</Display2>
        <p style={{ color: mk.ink, fontSize: 15, marginTop: 12, maxWidth: 680 }}>
          Not a mockup — a real mission statement (&ldquo;emergency housing, case management, and workforce
          training for veterans and their families experiencing homelessness&rdquo;) submitted against the
          live foundation directory, showing real ranked results with match percentages and the specific
          shared keyword behind each one.
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
            src="/marketing/platform-funder-matching-live.png"
            alt="The live Funder Matching page, showing ranked foundation results with match percentages and the shared keyword behind each score"
            width={1440}
            height={900}
            priority
            style={{ width: "100%", height: "auto", display: "block" }}
          />
        </div>
      </Section>

      <Section tone="paper" id="scores">
        <Display2>Two scoring passes, for two different questions</Display2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20, marginTop: 24 }}>
          <Card>
            <div style={{ fontSize: 13, fontWeight: 700, color: mk.terracotta, letterSpacing: 0.4 }}>
              INSTANT KEYWORD MATCH
            </div>
            <div style={{ fontSize: 16, fontWeight: 600, color: mk.forest, marginTop: 8 }}>
              &ldquo;Which new funders should we look at?&rdquo;
            </div>
            <p style={{ fontSize: 14, color: mk.ink, marginTop: 8, lineHeight: 1.6 }}>
              A plain keyword-overlap comparison between your mission text and each foundation&rsquo;s stated
              focus areas across a shared, 130,000-plus profile directory. No AI call, returns instantly, and
              every result shows the specific keyword that produced the score.
            </p>
          </Card>
          <Card>
            <div style={{ fontSize: 13, fontWeight: 700, color: mk.terracotta, letterSpacing: 0.4 }}>
              SEMANTIC FUNDER SCORING
            </div>
            <div style={{ fontSize: 16, fontWeight: 600, color: mk.forest, marginTop: 8 }}>
              &ldquo;Of the funders we already track, which are worth pursuing first?&rdquo;
            </div>
            <p style={{ fontSize: 14, color: mk.ink, marginTop: 8, lineHeight: 1.6 }}>
              Claude reads your mission, programs, and service area against each funder&rsquo;s recorded
              priorities and geographic focus, returning a 0-100 score with a one-sentence reason. Funders
              scoring below 40 are filtered out rather than padded onto the list.
            </p>
          </Card>
        </div>
      </Section>

      <Section tone="surface">
        <Display2>Why the real results above include low scores</Display2>
        <div style={{ maxWidth: 760 }}>
          <p style={{ color: mk.ink, fontSize: 16, lineHeight: 1.7 }}>
            The screenshot above shows genuine results for a real mission statement, including entries scored
            as low as 0% and 5% match. Most of a foundation directory is not a fit for any single
            organization&rsquo;s mission, and showing the full honest range, not just the top hits, is what
            makes a match score something you can trust rather than a list quietly curated to look better than
            it is.
          </p>
        </div>
      </Section>

      <Section tone="tint">
        <Display2>Stated limitations</Display2>
        <div style={{ display: "grid", gap: 16, marginTop: 24, maxWidth: 760 }}>
          <Card>
            <p style={{ color: mk.ink, fontSize: 15, lineHeight: 1.7, margin: 0 }}>
              Keyword-overlap matching only sees what a foundation&rsquo;s own directory listing states. A real
              fit whose listing doesn&rsquo;t spell out its focus areas in matching language will score lower
              than it should.
            </p>
          </Card>
          <Card>
            <p style={{ color: mk.ink, fontSize: 15, lineHeight: 1.7, margin: 0 }}>
              Semantic scoring is Claude&rsquo;s reasoning about likely alignment from text, not a funder&rsquo;s
              official statement of intent. Treat it as a research aid for prioritizing outreach, not a
              substitute for reading the funder&rsquo;s own current guidelines.
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
              HAVEN&rsquo;T FOUND FUNDERS TO MATCH AGAINST YET?
            </div>
            <div style={{ fontFamily: "var(--mk-display)", fontSize: 24, color: mk.forest, marginTop: 8 }}>
              Start with discovery
            </div>
            <p style={{ fontSize: 15, color: mk.ink, marginTop: 8 }}>
              Grant Discovery Software builds the candidate list this matching pass scores against.
            </p>
          </div>
          <CtaGhost href="/solutions/grant-discovery-software">See Grant Discovery Software</CtaGhost>
        </div>
      </Section>

      <Section tone="forest">
        <div style={{ textAlign: "center" }}>
          <Display2 tone="forest">Score your mission against real funder data</Display2>
          <p style={{ color: mk.heroMuted, fontSize: 17, marginTop: 16, maxWidth: 560, marginLeft: "auto", marginRight: "auto" }}>
            A live demo runs both scoring passes against your own mission statement and funder list.
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
