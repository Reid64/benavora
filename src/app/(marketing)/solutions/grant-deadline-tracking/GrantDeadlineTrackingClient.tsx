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

const URGENCY_TIERS: { label: string; color: string; body: string }[] = [
  { label: "Red — critical", color: mk.terracotta, body: "A critical alert fires and the opportunity is chained straight into drafting, so the narrative starts before the window closes further." },
  { label: "Amber — warning", color: "#C9A227", body: "A warning alert fires and the opportunity is chained into probability scoring, so someone can decide whether it's worth the drafting effort at this notice." },
  { label: "Yellow — notice", color: mk.sage, body: "Bundled into the normal notice flow rather than a standalone interruption." },
  { label: "Green — tracked", color: mk.forest, body: "Tracked silently. No alert fires until it moves into a higher tier." },
];

const DETECTION_SOURCES: { label: string; body: string }[] = [
  { label: "Explicit text", body: "The deadline stated directly in the opportunity's own description, read first." },
  { label: "SAM.gov lookup", body: "For federal opportunities, a direct SAM.gov check when the description doesn't state one." },
  { label: "Bounded AI web search", body: "A scoped Claude-plus-web-search pass when neither of the above resolves it." },
  { label: "Funder cycle pattern", body: "Two or more historical deadlines from the same funder let the platform compute an average cycle length and a next-open-date estimate." },
  { label: "Estimated fallback", body: "For irregular funders with no clean pattern, a looser typical-cycle estimate rather than leaving the field empty." },
];

const FAQ_ITEMS: { question: string; answer: string }[] = [
  {
    question: "Does this only track deadlines a funder already published?",
    answer:
      "No. When an opportunity has no stated deadline, a detection pass tries the opportunity's own text, a SAM.gov lookup for federal listings, a bounded AI web search, and finally the requesting funder's own historical cycle pattern, in that order, before falling back to a looser typical-cycle estimate rather than leaving the field blank.",
  },
  {
    question: "How accurate are the predicted deadlines, and does it just guess with confidence?",
    answer:
      "Every prediction records which of the five detection methods produced it and a fixed confidence value for that method, and the agent reads back its own past predictions against what the real deadline turned out to be, discounting its own pattern-based confidence when its track record on a given funder has been poor. A predicted deadline is always labeled as a prediction, not presented as a confirmed date.",
  },
  {
    question: "What actually happens when a deadline gets close?",
    answer:
      "Deadlines are tiered by urgency. The closest ones trigger a critical alert and automatically chain the opportunity into drafting; the next tier triggers a warning alert and chains into probability scoring so someone can judge whether it's worth pursuing at that notice; the next tier is bundled into a normal notice; the furthest-out tier is tracked with no alert at all. Every deadline in your pipeline also gets separate 7, 14, and 30-day reminders regardless of tier.",
  },
  {
    question: "Does deadline prediction run automatically, or do we have to turn it on?",
    answer:
      "It's an explicit opt-in, off by default for every organization. Recurrence metadata for a funder — its typical cycle length and next likely open date — gets updated automatically once two or more historical deadlines exist, since that's low-risk to compute either way, but creating a new placeholder opportunity for a predicted cycle only happens for funders with a clean annual or quarterly pattern, so a noisy history doesn't clutter the pipeline with a placeholder nobody asked for.",
  },
  {
    question: "Is there one unified notification inbox for all of this?",
    answer:
      "Not yet, and we'd rather say that than imply otherwise. Deadline alerts and general platform notifications currently run as two separate systems with different entry points rather than one merged inbox — a real gap on our own roadmap, not a hidden one.",
  },
];

export default function GrantDeadlineTrackingClient() {
  return (
    <>
      <Section tone="forest">
        <Eyebrow>Solutions / Grant Deadline Tracking</Eyebrow>
        <Display1 tone="forest">Stop finding out about a deadline the week it closes.</Display1>
        <p style={{ color: mk.heroMuted, fontSize: 18, marginTop: 16, maxWidth: 700, lineHeight: 1.6 }}>
          A spreadsheet only tracks the deadlines someone remembered to type in, and it has nothing to say
          about the funder who hasn&rsquo;t posted next year&rsquo;s cycle yet. This extracts every deadline it
          can find directly from a notice, predicts the ones that aren&rsquo;t posted yet from that funder&rsquo;s
          own history, and tiers reminders by how urgent each one actually is.
        </p>
        <div style={{ display: "flex", gap: 16, marginTop: 28, flexWrap: "wrap" }}>
          <CtaPrimary href="/register">Start tracking your deadlines</CtaPrimary>
          <CtaGhost href="#detection" onDark>
            See how detection works
          </CtaGhost>
        </div>
      </Section>

      <Section tone="tint">
        <Display2>The actual pipeline, deadlines and all</Display2>
        <p style={{ color: mk.ink, fontSize: 15, marginTop: 12, maxWidth: 680 }}>
          Not a mockup — the live Applications Pipeline, captured from a running instance of the application.
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
            src="/marketing/platform-applications-pipeline-live.png"
            alt="The live Applications Pipeline, showing deadlines across every active opportunity"
            width={1440}
            height={900}
            priority
            style={{ width: "100%", height: "auto", display: "block" }}
          />
        </div>
      </Section>

      <Section tone="paper" id="detection">
        <Display2>Five ways to find a deadline that isn&rsquo;t posted yet</Display2>
        <p style={{ color: mk.ink, fontSize: 15, marginTop: 12, maxWidth: 680 }}>
          Run in order, stopping at the first method that resolves a real date, so a clean funder cycle never
          waits on a slower search step.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 20, marginTop: 24 }}>
          {DETECTION_SOURCES.map((s) => (
            <Card key={s.label}>
              <div style={{ fontSize: 15, fontWeight: 700, color: mk.forest }}>{s.label}</div>
              <div style={{ fontSize: 14, color: mk.ink, marginTop: 8, lineHeight: 1.6 }}>{s.body}</div>
            </Card>
          ))}
        </div>
      </Section>

      <Section tone="surface">
        <Display2>Four urgency tiers, four different actions</Display2>
        <p style={{ color: mk.ink, fontSize: 15, marginTop: 12, maxWidth: 680 }}>
          Not every close deadline deserves the same interruption. Tiering means the alert you get matches
          how much runway is actually left.
        </p>
        <div style={{ display: "grid", gap: 12, marginTop: 24, maxWidth: 760 }}>
          {URGENCY_TIERS.map((t) => (
            <div key={t.label} style={{ display: "flex", gap: 16, alignItems: "flex-start", background: mk.surface, border: `1px solid ${mk.line}`, borderRadius: mkRadius.card, boxShadow: mkElevation[1], padding: "16px 20px" }}>
              <div style={{ width: 10, height: 10, borderRadius: 999, background: t.color, marginTop: 6, flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: mk.forest }}>{t.label}</div>
                <div style={{ fontSize: 14, color: mk.ink, marginTop: 4, lineHeight: 1.6 }}>{t.body}</div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section tone="tint">
        <Display2>Stated limitations</Display2>
        <div style={{ display: "grid", gap: 16, marginTop: 24, maxWidth: 760 }}>
          <Card>
            <p style={{ color: mk.ink, fontSize: 15, lineHeight: 1.7, margin: 0 }}>
              A predicted deadline is a prediction, not a confirmed date — it&rsquo;s labeled as such, and the
              confidence behind it is discounted for funders where the platform&rsquo;s own past predictions
              have run inaccurate.
            </p>
          </Card>
          <Card>
            <p style={{ color: mk.ink, fontSize: 15, lineHeight: 1.7, margin: 0 }}>
              Deadline alerts and general platform notifications are two separate systems today, not one
              merged inbox. It&rsquo;s a real gap, and closing it is on the roadmap rather than papered over
              here.
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
              Not ready to connect your pipeline yet?
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
          <Display2 tone="forest">Never find out about a deadline the week it closes</Display2>
          <p style={{ color: mk.heroMuted, fontSize: 17, marginTop: 16, maxWidth: 560, marginLeft: "auto", marginRight: "auto" }}>
            Connect your pipeline and let deadline extraction, prediction, and tiered reminders run on every
            opportunity you track.
          </p>
          <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 28, flexWrap: "wrap" }}>
            <CtaPrimary href="/register">Start tracking your deadlines</CtaPrimary>
            <CtaGhost href="/demo" onDark>
              Book a demo instead
            </CtaGhost>
          </div>
        </div>
      </Section>
    </>
  );
}
