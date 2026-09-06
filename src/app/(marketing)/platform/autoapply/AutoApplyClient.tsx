"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Section, Display1, Display2 } from "@/components/marketing/Section";
import { CtaPrimary, CtaGhost } from "@/components/marketing/Cta";
import { mk, mkRadius } from "@/lib/marketing/theme";

function Eyebrow({ tone, children }: { tone: "forest" | "paper"; children: React.ReactNode }) {
  const color = tone === "forest" ? mk.heroMuted : mk.terracotta;
  return (
    <div style={{ fontSize: 13, fontWeight: 600, color, letterSpacing: 0.6, marginBottom: 12 }}>
      {children}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: mk.surface,
        border: `1px solid ${mk.line}`,
        borderRadius: mkRadius.card,
        padding: 20,
      }}
    >
      {children}
    </div>
  );
}

// --- Section 4: animated sequence -------------------------------------------
// Illustrates the real per-item gate sequence in worker/queue-processor.ts
// (control-plane check -> org readiness -> usage allowance -> velocity/domain/
// cross-client checks -> risk assessment -> CAPTCHA/verification detection ->
// approved automation session -> fill and submit) - not a screen recording,
// same disclosure convention as every other interactive demo on this site
// (see /trust).
const GATE_STEPS = [
  {
    label: "1. Control-plane + readiness gate",
    detail:
      "Before anything else, the item is checked against platform, domain, funder, and tenant pause switches (queue-controls.ts), then against the organization's own readiness — a complete knowledge base, required documents, and at least one active request profile (submission-validator.ts). Any block stops the item here.",
  },
  {
    label: "2. Rate and volume checks",
    detail:
      "A rolling 24-hour submission cap tied to subscription tier, a per-domain throttle (stricter on shared platforms like Benevity or CyberGrants), and a 7-day cross-client dedup check — has any other organization on the platform already submitted to this same funder domain? — all run before a browser session ever launches (submission-controls.ts).",
  },
  {
    label: "3. Risk assessment",
    detail:
      "Ten weighted factors — manual-only portal flags, CAPTCHA presence, missing documents, an ask amount that exceeds the funder's historical maximum, an unanalyzed form, and more — produce a 0-100 score. Low routes to automated processing; medium proceeds with extra logging; high and critical are routed to a human queue before the browser ever opens (risk-engine.ts).",
  },
  {
    label: "4. CAPTCHA / verification pause",
    detail:
      "If a CAPTCHA or a verification challenge (\"verify you're human\", a one-time passcode prompt, an account lock) appears on the loaded portal, the run stops immediately, a screenshot is captured, and the item is marked paused for a person to resolve. Nothing here is auto-solved.",
  },
  {
    label: "5. Approved session, then fill and submit",
    detail:
      "Only after every gate above clears does the pipeline open a real, audit-logged automation session and let the form-filling agent submit — and even then, only for the applications a staff member already configured a request profile for.",
  },
];

function GateAnimation() {
  const [step, setStep] = useState(0);
  const currentStep = GATE_STEPS[step % GATE_STEPS.length] ?? GATE_STEPS[0]!;

  useEffect(() => {
    const id = setInterval(() => {
      setStep((s) => (s + 1) % GATE_STEPS.length);
    }, 3400);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      style={{
        background: mk.surface,
        border: `1px solid ${mk.line}`,
        borderRadius: mkRadius.shot,
        padding: 32,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: mk.muted, letterSpacing: 0.4 }}>
        ANIMATED SEQUENCE — ILLUSTRATES THE REAL GATE ORDER, NOT A SCREEN RECORDING
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 20, marginBottom: 24, flexWrap: "wrap" }}>
        {GATE_STEPS.map((s, i) => (
          <div
            key={s.label}
            style={{
              flex: "1 1 140px",
              height: 6,
              borderRadius: 999,
              background: i === step ? mk.terracotta : mk.line,
              transition: "background 400ms ease",
            }}
          />
        ))}
      </div>
      <div style={{ fontFamily: "var(--mk-display)", fontSize: 22, color: mk.forest }}>
        {currentStep.label}
      </div>
      <div style={{ fontSize: 15, color: mk.ink, marginTop: 10, lineHeight: 1.6, maxWidth: 640 }}>
        {currentStep.detail}
      </div>
    </div>
  );
}

const FAQ_ITEMS: { question: string; answer: string }[] = [
  {
    question: "Does AutoApply submit to every funder it can find, as fast as possible?",
    answer:
      "No. AutoApply only works applications a staff member has already configured a request profile for — it doesn't decide who to contact. On top of that, tier-based daily caps, per-domain throttling, and a 7-day cross-client dedup check all bound how much it submits, and a risk engine routes anything uncertain to a human queue instead of pushing it through.",
  },
  {
    question: "What happens when a portal shows a CAPTCHA?",
    answer:
      "The pipeline stops immediately. Benavora does not solve CAPTCHAs or verification challenges — detection of a CAPTCHA (reCAPTCHA, hCaptcha, Turnstile, or an image challenge) or a verification phrase on the page pauses the item with a screenshot, and it waits for a person to resolve it and resume.",
  },
  {
    question: "What stops two organizations from spamming the same funder?",
    answer:
      "A cross-client dedup check runs before every web-form submission: if any other organization on the platform submitted to that funder's domain in the last 7 days, the new submission is blocked with a suggested resume date. Organization identity is compared only as a SHA-256 hash, never as a raw ID.",
  },
  {
    question: "Which submissions get routed to a human instead of going out automatically?",
    answer:
      "The risk engine scores every submission across factors like a manual-only portal flag, a legal attestation checkbox, an ask amount well above the funder's historical maximum, or missing required documents. A high or critical score routes the item to a manual queue before a browser session ever opens — it is never submitted automatically.",
  },
  {
    question: "How do we know a submission actually went through?",
    answer:
      "A confirmation monitor polls a dedicated inbox (and, for organizations that connect their own Zoho Mail account, their own inbox too) every 5 minutes, matches incoming email by sender domain and organization name, and extracts a confirmation number when one is present. A match that could belong to more than one open submission is left for a person to resolve rather than guessed.",
  },
];

export default function AutoApplyClient() {
  return (
    <>
      {/* 1-2: outcome-focused headline + specific problem statement */}
      <Section tone="forest">
        <Eyebrow tone="forest">Platform / AutoApply</Eyebrow>
        <Display1 tone="forest">Qualify deeply. Apply selectively. Never lose momentum.</Display1>
        <p style={{ color: mk.heroMuted, fontSize: 18, marginTop: 16, maxWidth: 700, lineHeight: 1.6 }}>
          Once your team has decided which funders to pursue and set up a request profile for each,
          someone still has to open the portal, re-type the same organizational details, attach the
          right documents, and hope nothing was missed — for every single application. AutoApply
          takes over that mechanical work for the applications you've already chosen, behind a stack
          of real eligibility, risk, and rate checks that decide, submission by submission, whether it
          runs automatically or waits for a person.
        </p>
        <div style={{ display: "flex", gap: 16, marginTop: 28, flexWrap: "wrap" }}>
          <CtaPrimary href="/demo">See a Governed Application Run</CtaPrimary>
          <CtaGhost href="#gates" onDark>
            See how the gates work
          </CtaGhost>
        </div>
      </Section>

      {/* 3: real screenshot of the live dashboard */}
      <Section tone="tint">
        <Display2>The actual AutoApply dashboard</Display2>
        <p style={{ color: mk.ink, fontSize: 15, marginTop: 12, maxWidth: 680 }}>
          Not a mockup — worker status, session metrics, the live session viewer, and the submission
          queue with per-item status, captured from a running instance of the application on{" "}
          {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}.
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
            alt="The live AutoApply dashboard, showing worker status, session metrics, the live session viewer, and the submission queue with per-item status"
            width={1440}
            height={900}
            priority
            style={{ width: "100%", height: "auto", display: "block" }}
          />
        </div>
      </Section>

      {/* 4: product demonstration - animated sequence */}
      <Section tone="paper" id="gates">
        <Display2>Watch a submission clear the gates</Display2>
        <p style={{ color: mk.ink, fontSize: 15, marginTop: 12, maxWidth: 680 }}>
          Each step below mirrors a real stage in the worker pipeline (
          <code>worker/queue-processor.ts</code>).
        </p>
        <div style={{ marginTop: 24 }}>
          <GateAnimation />
        </div>
      </Section>

      {/* 5: workflow explanation using the real architecture */}
      <Section tone="surface">
        <Display2>How it actually works</Display2>
        <div style={{ display: "grid", gap: 16, marginTop: 24, maxWidth: 760 }}>
          <p style={{ color: mk.ink, fontSize: 16, lineHeight: 1.7 }}>
            AutoApply never chooses who to contact. A staff member sets up a request profile — what
            you're asking for, from whom, and the pitch to use — and queues it. From there, a single
            worker process picks up one item at a time and runs it through the same ordered set of
            checks every time: is any part of the platform, this domain, this funder, or this tenant
            currently paused; is the organization's own profile complete enough to fill a form
            accurately; has this organization already hit its rate limit; has another organization
            already used this exact funder recently; and finally, what does the risk engine think of
            this specific combination of funder, form, and ask amount.
          </p>
          <p style={{ color: mk.ink, fontSize: 16, lineHeight: 1.7 }}>
            Two submission channels exist depending on what the funder actually offers: a web form,
            filled and submitted by a stealth browser session once every gate above clears, or a plain
            email submission (via Resend) when a funder only publishes a contact address and no portal.
            Both are logged the same way in <code>autoapply_submissions</code>.
          </p>
          <p style={{ color: mk.ink, fontSize: 16, lineHeight: 1.7 }}>
            AutoApply also isn't the platform's only path to a funder's portal — a separate,
            human-approved browser-automation flow exists for application-scoped runs. The two check
            each other's active work on the same organization+funder pair before starting, so neither
            can run the same submission twice without either knowing about it.
          </p>
          <p style={{ color: mk.ink, fontSize: 16, lineHeight: 1.7 }}>
            The phrase we use internally is the one you'll see across this page: qualify deeply, apply
            selectively, never lose momentum. Depth comes from the readiness and risk checks below.
            Selectivity comes from the fact that nothing is contacted that a person didn't configure a
            request profile for. Momentum comes from not having to re-open the same portal by hand.
          </p>
        </div>
      </Section>

      {/* 6: inputs and outputs */}
      <Section tone="tint">
        <Display2>Inputs and outputs</Display2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 20,
            marginTop: 24,
          }}
        >
          <Card>
            <div style={{ fontSize: 13, fontWeight: 700, color: mk.terracotta, letterSpacing: 0.4 }}>
              INPUTS
            </div>
            <ul style={{ marginTop: 12, paddingLeft: 18, color: mk.ink, fontSize: 15, lineHeight: 1.8 }}>
              <li>A staff-authored request profile: what's being asked for, the pitch, and value range</li>
              <li>Organization profile data: mission, EIN, address, contact, and required documents</li>
              <li>The funder's own portal — its form fields, login requirements, and file uploads</li>
              <li>Subscription tier, which sets the rolling daily submission cap</li>
              <li>Platform / domain / funder / tenant pause switches, set by staff or an admin</li>
            </ul>
          </Card>
          <Card>
            <div style={{ fontSize: 13, fontWeight: 700, color: mk.terracotta, letterSpacing: 0.4 }}>
              OUTPUTS
            </div>
            <ul style={{ marginTop: 12, paddingLeft: 18, color: mk.ink, fontSize: 15, lineHeight: 1.8 }}>
              <li>A submission record per attempt: channel, status, timing, and confirmation data</li>
              <li>A risk score and the specific factors that produced it, on every routed item</li>
              <li>Stage screenshots (page load, pre-fill, post-fill, post-submit, or a CAPTCHA pause)</li>
              <li>Confirmation-email matches, with an extracted confirmation number when present</li>
            </ul>
          </Card>
        </div>
      </Section>

      {/* 7: human control model */}
      <Section tone="surface">
        <Display2>Where a person is in the loop</Display2>
        <div style={{ maxWidth: 760, marginTop: 20 }}>
          <p style={{ color: mk.ink, fontSize: 16, lineHeight: 1.7 }}>
            A person decides which funders to pursue and configures the request profile for each — that
            never happens automatically. From there, three separate mechanisms decide, per submission,
            whether a person needs to be involved before it goes out:
          </p>
          <p style={{ color: mk.ink, fontSize: 16, lineHeight: 1.7, marginTop: 16 }}>
            <strong>Risk-based routing.</strong> Ten weighted factors — a portal flagged manual-only, a
            legal attestation checkbox, an ask amount more than 50% above the funder's historical
            maximum, missing required documents, an unanalyzed or low-confidence form, and others —
            produce a 0-100 score. Anything scoring above 50 is routed to a manual queue before a
            browser session ever opens, it is never submitted automatically, and a webhook notification
            fires for the same "high" and "critical" band — any score above 50.
          </p>
          <p style={{ color: mk.ink, fontSize: 16, lineHeight: 1.7, marginTop: 16 }}>
            <strong>CAPTCHA and verification pauses.</strong> Benavora does not solve CAPTCHAs or
            identity-verification challenges. Detecting either — reCAPTCHA, hCaptcha, Turnstile, or a
            page containing phrases like "verify you're human" or "enter the code sent to" — stops the
            run immediately, captures a screenshot, and waits for a person to resolve it and resume.
          </p>
          <p style={{ color: mk.ink, fontSize: 16, lineHeight: 1.7, marginTop: 16 }}>
            <strong>Portals that require a one-time human setup.</strong> A small number of portals need
            a person to create and configure an account before any automated login is possible; those
            are surfaced as an actionable status rather than silently retried forever.
          </p>
          <p style={{ color: mk.ink, fontSize: 16, lineHeight: 1.7, marginTop: 16 }}>
            Even for a submission that clears every check, the form-filling step still requires a real,
            audit-logged approval record to exist before it will submit anything — there is no code path
            that skips straight to submission.
          </p>
        </div>
      </Section>

      {/* 8: quantified results - honestly pending */}
      <Section tone="tint">
        <Display2>Quantified results</Display2>
        <Card>
          <p style={{ color: mk.ink, fontSize: 16, lineHeight: 1.7, margin: 0 }}>
            We don&rsquo;t have a published submission-success rate or time-saved figure for AutoApply
            yet. Those numbers depend on real usage across a full grant cycle, and we&rsquo;d rather
            show you an honest &ldquo;pending&rdquo; than a number we backed into. This section will be
            replaced with real pilot data once we have it.
          </p>
        </Card>
      </Section>

      {/* 9: integrations - verified against real code, nothing invented */}
      <Section tone="surface">
        <Display2>What it actually connects to</Display2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 20,
            marginTop: 24,
          }}
        >
          <Card>
            <div style={{ fontSize: 13, fontWeight: 700, color: mk.terracotta, letterSpacing: 0.4 }}>
              SUBMISSION CHANNELS
            </div>
            <ul style={{ marginTop: 12, paddingLeft: 18, color: mk.ink, fontSize: 15, lineHeight: 1.8 }}>
              <li><strong>Funder web portals</strong> — via a stealth browser session, one funder at a time</li>
              <li><strong>Resend</strong> — plain email submission when a funder has no portal, only a contact address</li>
            </ul>
          </Card>
          <Card>
            <div style={{ fontSize: 13, fontWeight: 700, color: mk.terracotta, letterSpacing: 0.4 }}>
              CONFIRMATION TRACKING
            </div>
            <p style={{ fontSize: 15, color: mk.muted, marginTop: 8 }}>
              Polled every 5 minutes to match inbound confirmations back to a submission.
            </p>
            <ul style={{ marginTop: 12, paddingLeft: 18, color: mk.ink, fontSize: 15, lineHeight: 1.8 }}>
              <li><strong>Gmail</strong> — a dedicated, read-only Benavora inbox shared across all organizations</li>
              <li><strong>Zoho Mail</strong> — an organization&rsquo;s own connected mailbox, for orgs whose confirmations land there instead</li>
            </ul>
          </Card>
        </div>
      </Section>

      {/* 10: security and reliability */}
      <Section tone="tint">
        <Display2>Security and reliability</Display2>
        <div style={{ maxWidth: 680 }}>
          <p style={{ color: mk.ink, fontSize: 16, lineHeight: 1.7 }}>
            Every portal URL is validated against private and internal address ranges before a browser
            or a health check ever reaches it. Cross-client dedup compares organizations only as a
            SHA-256 hash, never a raw identity. Admins can halt automated submission at four
            independent levels — platform-wide, a specific domain, a specific funder, or a single
            organization — and every one of those pause switches is checked before an item runs. For
            the platform-wide security and governance model, see the Trust and Governance page.
          </p>
          <div style={{ marginTop: 20 }}>
            <CtaGhost href="/trust">Read the Trust and Governance page</CtaGhost>
          </div>
        </div>
      </Section>

      {/* 11: customer story - honest placeholder */}
      <Section tone="surface">
        <Display2>Customer story</Display2>
        <Card>
          <p style={{ color: mk.muted, fontSize: 15, fontWeight: 600, margin: 0 }}>COMING SOON</p>
          <p style={{ color: mk.ink, fontSize: 16, lineHeight: 1.7, marginTop: 10, marginBottom: 0 }}>
            We don&rsquo;t have a published customer story for AutoApply yet. Once an organization has
            run it through a real grant cycle and agreed to be named, their story will go here — not a
            composite or hypothetical example.
          </p>
        </Card>
      </Section>

      {/* 12: FAQ */}
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

      {/* 13: contextual free tool */}
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
            padding: 32,
          }}
        >
          <div style={{ maxWidth: 520 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: mk.terracotta, letterSpacing: 0.4 }}>
              FREE, NO ACCOUNT REQUIRED
            </div>
            <div style={{ fontFamily: "var(--mk-display)", fontSize: 24, color: mk.forest, marginTop: 8 }}>
              Not sure your organization is ready for AutoApply yet?
            </div>
            <p style={{ fontSize: 15, color: mk.ink, marginTop: 8 }}>
              Run the free Funding Potential Scan first — a short, no-signup check of the kind of
              funding your organization is likely to qualify for.
            </p>
          </div>
          <CtaPrimary href="/scan">Try the free Funding Potential Scan</CtaPrimary>
        </div>
      </Section>

      {/* 14: tailored call to action */}
      <Section tone="forest">
        <div style={{ textAlign: "center" }}>
          <Display2 tone="forest">See a Governed Application Run</Display2>
          <p style={{ color: mk.heroMuted, fontSize: 17, marginTop: 16, maxWidth: 560, marginLeft: "auto", marginRight: "auto" }}>
            Watch a real submission move through readiness checks, the risk engine, and approval before
            it ever reaches a funder's portal — on the applications your team has already chosen.
          </p>
          <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 28, flexWrap: "wrap" }}>
            <CtaPrimary href="/demo">See a Governed Application Run</CtaPrimary>
            <CtaGhost href="/register" onDark>
              Or start your own eligibility check
            </CtaGhost>
          </div>
        </div>
      </Section>
    </>
  );
}
