"use client";

import Link from "next/link";
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

const PIPELINE_STAGES: { label: string; body: string; href: string }[] = [
  {
    label: "1. Onboard",
    body: "Your mission, programs, service area, and documents become the knowledge base every later stage reads from.",
    href: "/how-it-works",
  },
  {
    label: "2. Research",
    body: "Eight parallel lanes check federal, state, foundation, and corporate sources so nothing sits on a single bookmark list.",
    href: "/solutions/grant-discovery-software",
  },
  {
    label: "3. Opportunities",
    body: "Candidates get scored for fit against your own profile before anyone spends time reading the full notice.",
    href: "/solutions/grant-matching-software",
  },
  {
    label: "4. Narratives",
    body: "Drafts are generated from your knowledge base and your own past-award narratives, cited to source, never invented.",
    href: "/solutions/ai-grant-writing-software",
  },
  {
    label: "5. AutoApply",
    body: "Approved drafts get filled into the funder's own portal fields and held for a person to review before anything submits.",
    href: "/solutions/grant-application-automation",
  },
  {
    label: "6. Funding Secured",
    body: "Outcomes flow back into the pipeline, so the next narrative for the same funder starts from what actually won.",
    href: "/platform/analytics",
  },
];

const ROUTE_TABLE: { need: string; page: string; href: string }[] = [
  { need: "We don't know where to find grants we qualify for", page: "Grant Discovery Software", href: "/solutions/grant-discovery-software" },
  { need: "We have a list of funders but don't know which ones fit", page: "Grant Matching Software", href: "/solutions/grant-matching-software" },
  { need: "We know the grant, we need to write the narrative", page: "AI Grant Writing Software", href: "/solutions/ai-grant-writing-software" },
  { need: "We have a draft, we need it filled into the portal", page: "Grant Application Automation", href: "/solutions/grant-application-automation" },
];

const FAQ_ITEMS: { question: string; answer: string }[] = [
  {
    question: "Is this one piece of software or several tools bundled together?",
    answer:
      "One platform, six connected stages (onboarding, research, opportunity scoring, drafting, AutoApply, and outcome tracking) that share the same organization profile and knowledge base. You don't re-enter your mission or your programs at each stage.",
  },
  {
    question: "Do we have to use the whole pipeline, or can we just use one part, like discovery?",
    answer:
      "Each stage works on its own. Most organizations start with research and drafting before turning on AutoApply, since automation depends on a knowledge base that's already been used successfully in a few drafts.",
  },
  {
    question: "How is this different from a grants database like Instrumentl or Candid?",
    answer:
      "A grants database gives you a searchable list. This platform also scores your fit against a specific opportunity, drafts the narrative from your own recorded program data, and fills the funder's portal fields for a human to review before submission.",
  },
  {
    question: "Does someone at our organization still have to review everything, or does it run on its own?",
    answer:
      "Every stage past research produces something for a person to approve: an opportunity to pursue, a draft to edit, or a filled application to submit. Nothing moves to the next stage, and nothing is ever submitted, without that action.",
  },
  {
    question: "What does the full platform cost compared to buying separate point tools?",
    answer:
      "See the Pricing page for current plan tiers. The comparison that matters most isn't tool-for-tool cost, it's not re-entering the same organizational profile into four separate subscriptions.",
  },
];

export default function NonprofitFundingSoftwareClient() {
  return (
    <>
      <Section tone="forest">
        <Eyebrow>Solutions / Nonprofit Funding Software</Eyebrow>
        <Display1 tone="forest">Nonprofit funding software that covers the whole cycle, not just one step.</Display1>
        <p style={{ color: mk.heroMuted, fontSize: 18, marginTop: 16, maxWidth: 680, lineHeight: 1.6 }}>
          Most tools sold as &ldquo;nonprofit funding software&rdquo; are really a grants database, a writing
          assistant, or a CRM wearing a broader label. Benavora runs a six-stage pipeline, shown live below,
          where research, fit scoring, drafting, and application submission share the same organization
          profile instead of four disconnected subscriptions.
        </p>
        <div style={{ display: "flex", gap: 16, marginTop: 28, flexWrap: "wrap" }}>
          <CtaPrimary href="/demo">Book a full platform walkthrough</CtaPrimary>
          <CtaGhost href="#pipeline" onDark>
            See the pipeline
          </CtaGhost>
        </div>
      </Section>

      <Section tone="tint">
        <Display2>The actual command center</Display2>
        <p style={{ color: mk.ink, fontSize: 15, marginTop: 12, maxWidth: 680 }}>
          Not a mockup — the live Dashboard for a real organization account, captured{" "}
          {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}. The
          Pipeline bar across the top is the same six stages this page walks through below.
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
            src="/marketing/platform-dashboard-overview-live.png"
            alt="The live Benavora dashboard, showing the six-stage funding pipeline, knowledge base completeness, deadlines, funder research count, AutoApply usage, and platform health"
            width={1440}
            height={900}
            priority
            style={{ width: "100%", height: "auto", display: "block" }}
          />
        </div>
      </Section>

      <Section tone="paper" id="pipeline">
        <Display2>The six-stage pipeline, in order</Display2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 20, marginTop: 28 }}>
          {PIPELINE_STAGES.map((s) => (
            <Link
              key={s.label}
              href={s.href}
              style={{
                display: "block",
                background: mk.surface,
                border: `1px solid ${mk.line}`,
                borderRadius: mkRadius.card,
                boxShadow: mkElevation[1],
                padding: 20,
                textDecoration: "none",
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: mk.terracotta, letterSpacing: 0.4 }}>{s.label}</div>
              <div style={{ fontSize: 15, color: mk.ink, marginTop: 8, lineHeight: 1.6 }}>{s.body}</div>
            </Link>
          ))}
        </div>
      </Section>

      <Section tone="surface">
        <Display2>Already know what you need?</Display2>
        <p style={{ color: mk.ink, fontSize: 15, marginTop: 12, maxWidth: 680 }}>
          The four capabilities behind this pipeline each have their own dedicated page, since &ldquo;finding a
          grant&rdquo; and &ldquo;submitting one&rdquo; are genuinely different problems with different evidence.
        </p>
        <div style={{ marginTop: 24, display: "grid", gap: 1, background: mk.line, borderRadius: mkRadius.card, boxShadow: mkElevation[1], overflow: "hidden" }}>
          {ROUTE_TABLE.map((r) => (
            <Link
              key={r.href}
              href={r.href}
              style={{
                display: "flex",
                flexWrap: "wrap",
                justifyContent: "space-between",
                gap: 12,
                background: mk.surface,
                padding: "16px 20px",
                textDecoration: "none",
              }}
            >
              <span style={{ color: mk.ink, fontSize: 15 }}>{r.need}</span>
              <span style={{ color: mk.forest, fontSize: 15, fontWeight: 600 }}>{r.page} →</span>
            </Link>
          ))}
        </div>
      </Section>

      <Section tone="tint">
        <Display2>Where the platform stops and a person decides</Display2>
        <div style={{ maxWidth: 760, marginTop: 20 }}>
          <p style={{ color: mk.ink, fontSize: 16, lineHeight: 1.7 }}>
            Research produces a feed, not a commitment. Fit scoring produces a ranked list, not a decision.
            Drafting produces a document for someone to edit. AutoApply fills a form and waits for approval
            before anything reaches a funder&rsquo;s server. The &ldquo;Funding Secured&rdquo; number at the end
            of the pipeline reflects a funder&rsquo;s own decision reported back into the platform &mdash; it is
            tracked, not influenced.
          </p>
        </div>
      </Section>

      <Section tone="paper">
        <Display2>Stated limitations</Display2>
        <div style={{ display: "grid", gap: 16, marginTop: 24, maxWidth: 760 }}>
          <Card>
            <p style={{ color: mk.ink, fontSize: 15, lineHeight: 1.7, margin: 0 }}>
              Value compounds across stages that share your knowledge base. An organization that skips
              onboarding and jumps straight to AutoApply will find every downstream stage thinner than it
              should be, since drafting and matching both read from the same profile.
            </p>
          </Card>
          <Card>
            <p style={{ color: mk.ink, fontSize: 15, lineHeight: 1.7, margin: 0 }}>
              A single grant cycle isn&rsquo;t enough to see the platform&rsquo;s full value. Proven-narrative
              reuse in drafting and funder-history in matching both depend on outcomes recorded from at least
              one prior cycle.
            </p>
          </Card>
        </div>
      </Section>

      <Section tone="surface">
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
              Not ready for a full platform walkthrough?
            </div>
            <p style={{ fontSize: 15, color: mk.ink, marginTop: 8 }}>
              Run the free Funding Potential Scan first to see the kind of funding your organization is likely
              to qualify for, no signup required.
            </p>
          </div>
          <CtaPrimary href="/scan">Try the free Funding Potential Scan</CtaPrimary>
        </div>
      </Section>

      <Section tone="forest">
        <div style={{ textAlign: "center" }}>
          <Display2 tone="forest">See the whole pipeline run on your own opportunities</Display2>
          <p style={{ color: mk.heroMuted, fontSize: 17, marginTop: 16, maxWidth: 560, marginLeft: "auto", marginRight: "auto" }}>
            A full walkthrough covers research, matching, drafting, and AutoApply together, not one stage in
            isolation.
          </p>
          <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 28, flexWrap: "wrap" }}>
            <CtaPrimary href="/demo">Book a full platform walkthrough</CtaPrimary>
            <CtaGhost href="/pricing" onDark>
              See pricing
            </CtaGhost>
          </div>
        </div>
      </Section>
    </>
  );
}
