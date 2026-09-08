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

const SOURCE_LANES: { label: string; body: string }[] = [
  { label: "Government", body: "Grants.gov API directly, plus SAM.gov opportunity listings." },
  { label: "State agencies", body: "State-administered federal pass-through funding that never appears on a federal site." },
  { label: "Foundation", body: "Foundation directories, screened for stated focus areas and geography." },
  { label: "Faith-based", body: "Denominational and faith-affiliated funder sources, run as their own lane rather than folded into general foundation search." },
  { label: "Corporate giving", body: "Corporate foundation and giving-program pages." },
  { label: "Local sponsorship", body: "Local and regional sponsorship listings that rarely show up in a national grants database." },
];

const FAQ_ITEMS: { question: string; answer: string }[] = [
  {
    question: "Does this replace checking Grants.gov ourselves?",
    answer:
      "Grants.gov is one of the lanes it runs, alongside SAM.gov, state agencies, foundation directories, corporate giving pages, and local sponsorship sources, deduplicated into one feed.",
  },
  {
    question: "How often does it check for new opportunities?",
    answer:
      "On demand from the Research page, per lane or all at once, or on a schedule tied to your organization's active search profiles.",
  },
  {
    question: "Does it cover state and foundation grants that never show up on a federal site?",
    answer:
      "Yes. State-agency and foundation-directory sources run as their own dedicated lanes rather than being folded into a single generic web search.",
  },
  {
    question: "Can we control what shows up in our feed?",
    answer:
      "Yes. Search profiles carry keywords, funder categories, geography, focus-area weights, and exclusion lists, and each research lane can be enabled or disabled independently.",
  },
  {
    question: "What happens after discovery finds something? Does it get submitted automatically?",
    answer:
      "No. Discovery's output is a reviewed feed. A staff member decides which listing moves into fit scoring, and from there into drafting; nothing advances on its own.",
  },
];

export default function GrantDiscoverySoftwareClient() {
  return (
    <>
      <Section tone="forest">
        <Eyebrow>Solutions / Grant Discovery Software</Eyebrow>
        <Display1 tone="forest">Stop finding out about a grant after it closed.</Display1>
        <p style={{ color: mk.heroMuted, fontSize: 18, marginTop: 16, maxWidth: 680, lineHeight: 1.6 }}>
          Manual grant discovery means checking Grants.gov, SAM.gov, and a rotating list of bookmarked
          foundation and corporate pages by hand, and still missing the opportunity that was never on
          anyone&rsquo;s list. This software runs six source categories, split across eight parallel research
          lanes, and hands back one deduplicated feed instead of a dozen browser tabs.
        </p>
        <div style={{ display: "flex", gap: 16, marginTop: 28, flexWrap: "wrap" }}>
          <CtaPrimary href="/register">Find opportunities across every source</CtaPrimary>
          <CtaGhost href="#sources" onDark>
            See what it searches
          </CtaGhost>
        </div>
      </Section>

      <Section tone="tint">
        <Display2>The actual Research feed</Display2>
        <p style={{ color: mk.ink, fontSize: 15, marginTop: 12, maxWidth: 680 }}>
          Not a mockup — the live Research Command Center, captured from a running instance of the
          application.
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
            src="/marketing/platform-discovery-research-live.png"
            alt="The live Research Command Center page, showing the multi-source research directory and agent launchpad"
            width={1440}
            height={900}
            priority
            style={{ width: "100%", height: "auto", display: "block" }}
          />
        </div>
      </Section>

      <Section tone="paper" id="sources">
        <Display2>Six source categories, run as eight lanes</Display2>
        <p style={{ color: mk.ink, fontSize: 15, marginTop: 12, maxWidth: 680 }}>
          Each source type gets its own dedicated search rather than one generic query trying to cover all
          of them, run concurrently so one slow or failing source never blocks the rest.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 20, marginTop: 24 }}>
          {SOURCE_LANES.map((s) => (
            <Card key={s.label}>
              <div style={{ fontSize: 15, fontWeight: 700, color: mk.forest }}>{s.label}</div>
              <div style={{ fontSize: 14, color: mk.ink, marginTop: 8, lineHeight: 1.6 }}>{s.body}</div>
            </Card>
          ))}
        </div>
      </Section>

      <Section tone="surface">
        <Display2>Why breadth alone creates a dedup problem</Display2>
        <div style={{ maxWidth: 760 }}>
          <p style={{ color: mk.ink, fontSize: 16, lineHeight: 1.7 }}>
            Running lanes in parallel means two lanes can independently find the same opportunity, for
            example a foundation grant that also gets picked up through a state-agency listing. A cross-lane
            deduplication pass runs after every sweep, matching first on URL and then on funder name plus
            program title, and keeps the earliest row when it finds a collision, so the feed you review
            doesn&rsquo;t force you to spot the duplicate yourself.
          </p>
        </div>
      </Section>

      <Section tone="tint">
        <Display2>Stated limitations</Display2>
        <div style={{ display: "grid", gap: 16, marginTop: 24, maxWidth: 760 }}>
          <Card>
            <p style={{ color: mk.ink, fontSize: 15, lineHeight: 1.7, margin: 0 }}>
              Discovery surfaces candidates. It does not itself judge whether your organization would qualify
              or win &mdash; that scoring happens on the dedicated{" "}
              <a href="/solutions/grant-matching-software" style={{ color: mk.forest }}>Grant Matching Software</a>{" "}
              page&rsquo;s pass, a separate step a staff member triggers.
            </p>
          </Card>
          <Card>
            <p style={{ color: mk.ink, fontSize: 15, lineHeight: 1.7, margin: 0 }}>
              A source going down or changing its page structure can cause that single lane to return zero
              results for a sweep. Every lane reports its own status, so a failure shows up as &ldquo;this
              source returned nothing this run,&rdquo; not a silently thinner feed.
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
              FREE, NO ACCOUNT REQUIRED
            </div>
            <div style={{ fontFamily: "var(--mk-display)", fontSize: 24, color: mk.forest, marginTop: 8 }}>
              Not ready to connect your data yet?
            </div>
            <p style={{ fontSize: 15, color: mk.ink, marginTop: 8 }}>
              Run the free Funding Potential Scan first, a short, no-signup check of the kind of funding your
              organization is likely to qualify for.
            </p>
          </div>
          <CtaPrimary href="/scan">Try the free Funding Potential Scan</CtaPrimary>
        </div>
      </Section>

      <Section tone="forest">
        <div style={{ textAlign: "center" }}>
          <Display2 tone="forest">Find opportunities across every source, in one feed</Display2>
          <p style={{ color: mk.heroMuted, fontSize: 17, marginTop: 16, maxWidth: 560, marginLeft: "auto", marginRight: "auto" }}>
            Set up a search profile and let eight research lanes start checking government, state, foundation,
            and corporate sources for you.
          </p>
          <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 28, flexWrap: "wrap" }}>
            <CtaPrimary href="/register">Find opportunities across every source</CtaPrimary>
            <CtaGhost href="/demo" onDark>
              Book a demo instead
            </CtaGhost>
          </div>
        </div>
      </Section>
    </>
  );
}
