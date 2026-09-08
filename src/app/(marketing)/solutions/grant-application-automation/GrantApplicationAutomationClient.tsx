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

const GATE_STEPS: { label: string; body: string }[] = [
  {
    label: "1. Control-plane + readiness gate",
    body: "Checked first against platform, domain, funder, and tenant pause switches, then against your organization's own readiness: a complete knowledge base, required documents, and at least one active request profile. Any block stops the item here, before a browser session opens.",
  },
  {
    label: "2. Rate and volume checks",
    body: "A rolling 24-hour submission cap tied to your subscription tier, a per-domain throttle stricter on shared platforms like Benevity or CyberGrants, and a 7-day cross-client dedup check for whether another organization already submitted to this same funder domain.",
  },
  {
    label: "3. Risk assessment",
    body: "Ten weighted factors, manual-only portal flags, CAPTCHA presence, missing documents, an ask amount exceeding the funder's historical maximum, an unanalyzed form, and more, produce a 0-100 score. Low routes to automated processing; medium proceeds with extra logging; high and critical route to a human queue before the browser ever opens.",
  },
  {
    label: "4. CAPTCHA / verification pause",
    body: "If a CAPTCHA or a verification challenge appears on the loaded portal, the run stops immediately, a screenshot is captured, and the item is marked paused for a person to resolve. Nothing here is auto-solved.",
  },
  {
    label: "5. Approved session, then fill and submit",
    body: "Only after every gate above clears does the pipeline open a real, audit-logged automation session and let the form-filling agent submit, and even then, only for applications a staff member already configured a request profile for.",
  },
];

const FAQ_ITEMS: { question: string; answer: string }[] = [
  {
    question: "Does this submit applications without anyone ever looking at them?",
    answer:
      "No. Submission only happens for applications where a staff member already configured a request profile, and only after the readiness, rate, and risk gates clear. Anything flagged high or critical risk routes to a human review queue first.",
  },
  {
    question: "What happens when a portal shows a CAPTCHA?",
    answer:
      "The run stops immediately, a screenshot is captured, and the item is marked paused for a person to resolve. It is never auto-solved.",
  },
  {
    question: "Is browser automation against a funder's terms of service?",
    answer:
      "Terms vary by platform, which is exactly why the risk engine checks for manual-only portal flags and routes anything ambiguous to a human before submission, rather than treating every portal as automatable by default.",
  },
  {
    question: "What portals does this actually work on?",
    answer:
      "It has been built and gated against common shared grant and giving platforms, including stricter per-domain throttling on platforms like Benevity and CyberGrants. A portal it hasn't analyzed yet, or one flagged manual-only, is routed to a person rather than attempted.",
  },
  {
    question: "What stops it from submitting the same grant twice, or submitting too many applications at once?",
    answer:
      "A rolling 24-hour submission cap tied to your plan, a per-domain throttle, and a 7-day cross-client dedup check that looks for whether another organization on the platform already submitted to the same funder domain, all run before a session opens.",
  },
];

export default function GrantApplicationAutomationClient() {
  return (
    <>
      <Section tone="forest">
        <Eyebrow>Solutions / Grant Application Automation</Eyebrow>
        <Display1 tone="forest">Automated form-filling that stops the moment a human actually needs to look.</Display1>
        <p style={{ color: mk.heroMuted, fontSize: 18, marginTop: 16, maxWidth: 680, lineHeight: 1.6 }}>
          Filling the same fields into a funder's portal, over and over, is the part of grant applications
          least worth a person's time, and the part most likely to go wrong unattended. This automation runs
          an approved draft through five gates, readiness, rate limits, risk scoring, and a CAPTCHA pause,
          before anything reaches a funder's server.
        </p>
        <div style={{ display: "flex", gap: 16, marginTop: 28, flexWrap: "wrap" }}>
          <CtaPrimary href="/demo">See the real gate sequence</CtaPrimary>
          <CtaGhost href="#gates" onDark>
            See the five gates
          </CtaGhost>
        </div>
      </Section>

      <Section tone="tint">
        <Display2>The actual AutoApply dashboard</Display2>
        <p style={{ color: mk.ink, fontSize: 15, marginTop: 12, maxWidth: 680 }}>
          Not a mockup — the live AutoApply dashboard, captured from a running instance of the application,
          showing real queued and processed submission items.
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
            src="/marketing/platform-autoapply-dashboard-live.png"
            alt="The live AutoApply dashboard, showing the real submission queue and processing status"
            width={1440}
            height={900}
            priority
            style={{ width: "100%", height: "auto", display: "block" }}
          />
        </div>
      </Section>

      <Section tone="paper" id="gates">
        <Display2>Five gates, in the order they actually run</Display2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 20, marginTop: 28 }}>
          {GATE_STEPS.map((s) => (
            <div key={s.label}>
              <div style={{ fontSize: 13, fontWeight: 700, color: mk.terracotta, letterSpacing: 0.4 }}>{s.label}</div>
              <div style={{ fontSize: 15, color: mk.ink, marginTop: 8, lineHeight: 1.6 }}>{s.body}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section tone="surface">
        <Display2>Why risk scoring runs before a browser ever opens</Display2>
        <div style={{ maxWidth: 760 }}>
          <p style={{ color: mk.ink, fontSize: 16, lineHeight: 1.7 }}>
            Ten weighted factors, including whether the portal has been flagged manual-only, whether a CAPTCHA
            has been seen there before, whether required documents are missing, and whether the ask amount
            exceeds the funder's historical maximum, are scored before any automation session starts. A high
            or critical score routes the item to a human review queue instead of letting a browser session
            find the problem live against a funder's real portal.
          </p>
        </div>
      </Section>

      <Section tone="tint">
        <Display2>Stated limitations</Display2>
        <div style={{ display: "grid", gap: 16, marginTop: 24, maxWidth: 760 }}>
          <Card>
            <p style={{ color: mk.ink, fontSize: 15, lineHeight: 1.7, margin: 0 }}>
              An organization with an incomplete knowledge base, missing required documents, or no active
              request profile will see items held at the readiness gate, not a submission attempted anyway.
            </p>
          </Card>
          <Card>
            <p style={{ color: mk.ink, fontSize: 15, lineHeight: 1.7, margin: 0 }}>
              Not every funder portal has been analyzed. An unfamiliar or manual-only-flagged portal is routed
              to a person rather than attempted automatically.
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
              NOT READY TO AUTOMATE SUBMISSION YET?
            </div>
            <div style={{ fontFamily: "var(--mk-display)", fontSize: 24, color: mk.forest, marginTop: 8 }}>
              Start with drafting
            </div>
            <p style={{ fontSize: 15, color: mk.ink, marginTop: 8 }}>
              AI Grant Writing Software produces the approved draft this automation fills into a portal.
            </p>
          </div>
          <CtaGhost href="/solutions/ai-grant-writing-software">See AI Grant Writing Software</CtaGhost>
        </div>
      </Section>

      <Section tone="forest">
        <div style={{ textAlign: "center" }}>
          <Display2 tone="forest">See the real submission gate sequence in a live walkthrough</Display2>
          <p style={{ color: mk.heroMuted, fontSize: 17, marginTop: 16, maxWidth: 560, marginLeft: "auto", marginRight: "auto" }}>
            A live demo walks through readiness, rate limits, risk scoring, and the human approval step
            together.
          </p>
          <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 28, flexWrap: "wrap" }}>
            <CtaPrimary href="/demo">Book a demo</CtaPrimary>
            <CtaGhost href="/trust" onDark>
              Read the Trust and Governance page
            </CtaGhost>
          </div>
        </div>
      </Section>
    </>
  );
}
