"use client";

import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";

import { Section, Display1 } from "@/components/marketing/Section";
import { mk, mkRadius } from "@/lib/marketing/theme";
import { DEMO_ROLE_OPTIONS } from "@/lib/demo/constants";

// Tailored demo flow (/demo). Implements BENAVORA MARKETING PAGE.docx section
// 6, "The demo should be a deliverable":
//   1. Exactly four fields before showing the calendar (work email,
//      organization website, role, primary funding challenge) - POSTs to
//      /api/public/demo.
//   2. A Calendly inline embed for booking. Calendly is the launch-speed
//      default (no custom booking backend has been built or decided on) -
//      see NEXT_PUBLIC_CALENDLY_URL in .env.local.example. If that env var
//      is unset, this renders an honest "not configured yet" fallback
//      instead of a broken iframe.
//   3. After booking, an optional (skippable) step to upload an old
//      proposal or name a real opportunity for the demo - POSTs to
//      /api/public/demo/prepare.
//
// "See how Benavora would fund your mission" (section 6) replaces generic
// "Talk to Sales" language on this page - see also PricingPageClient.tsx and
// WhatWillItCost.tsx, whose "Contact Sales" CTAs got the same replacement.

const ERROR_COLOR = "#EF4444";

const inputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "12px 14px",
  borderRadius: 8,
  border: `1px solid ${mk.line}`,
  background: mk.surface,
  color: mk.ink,
  fontSize: 16,
  fontFamily: "inherit",
};

const labelStyle: CSSProperties = {
  display: "block",
  fontWeight: 600,
  fontSize: 14,
  color: mk.ink,
  marginBottom: 6,
};

const fieldWrapStyle: CSSProperties = { marginBottom: 20 };

const cardStyle: CSSProperties = {
  marginTop: 32,
  maxWidth: 560,
  background: mk.surface,
  borderRadius: mkRadius.card,
  padding: 32,
};

const primaryButtonStyle: CSSProperties = {
  display: "inline-block",
  background: mk.terracotta,
  color: "#FFFFFF",
  borderRadius: mkRadius.cta,
  padding: "14px 20px",
  fontWeight: 600,
  fontSize: 15,
  border: "none",
  cursor: "pointer",
};

const ghostButtonStyle: CSSProperties = {
  display: "inline-block",
  background: "transparent",
  color: mk.muted,
  borderRadius: mkRadius.cta,
  padding: "14px 20px",
  fontWeight: 600,
  fontSize: 15,
  border: `1px solid ${mk.line}`,
  cursor: "pointer",
};

type Step = "intake" | "calendar" | "prepare" | "done";

type IntakeFieldErrors = Partial<
  Record<"workEmail" | "orgWebsite" | "role" | "primaryFundingChallenge", string>
>;

function IntakeForm({
  onSubmitted,
}: {
  onSubmitted: (demoRequestId: string, workEmail: string) => void;
}) {
  const [workEmail, setWorkEmail] = useState("");
  const [orgWebsite, setOrgWebsite] = useState("");
  const [role, setRole] = useState("");
  const [primaryFundingChallenge, setPrimaryFundingChallenge] = useState("");
  const [hpToken, setHpToken] = useState("");

  const [fieldErrors, setFieldErrors] = useState<IntakeFieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function validate(): IntakeFieldErrors {
    const errors: IntakeFieldErrors = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(workEmail.trim())) {
      errors.workEmail = "Enter a valid work email.";
    }
    if (orgWebsite.trim().length < 3) {
      errors.orgWebsite = "Enter your organization's website.";
    }
    if (!role) {
      errors.role = "Select your role.";
    }
    if (primaryFundingChallenge.trim().length < 5) {
      errors.primaryFundingChallenge = "Tell us your primary funding challenge in a sentence.";
    }
    return errors;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;

    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSubmitError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/public/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workEmail: workEmail.trim(),
          orgWebsite: orgWebsite.trim(),
          role,
          primaryFundingChallenge: primaryFundingChallenge.trim(),
          hpToken: hpToken || undefined,
        }),
      });

      if (!res.ok) {
        setSubmitError("We couldn't submit your request. Please try again.");
        return;
      }

      const body: { ok: boolean; demoRequestId: string } = await res.json();
      onSubmitted(body.demoRequestId, workEmail.trim());
    } catch {
      setSubmitError("We couldn't submit your request. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate style={cardStyle}>
      {/* Honeypot - hidden from real visitors, off-screen rather than
          display:none so it still receives autofill from simple bots. */}
      <div
        aria-hidden="true"
        style={{ position: "absolute", left: -9999, top: -9999, height: 0, overflow: "hidden" }}
      >
        <label htmlFor="hp_token">Leave this field blank</label>
        <input
          id="hp_token"
          name="hp_token"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={hpToken}
          onChange={(e) => setHpToken(e.target.value)}
        />
      </div>

      <div style={fieldWrapStyle}>
        <label style={labelStyle} htmlFor="workEmail">
          Work email
        </label>
        <input
          id="workEmail"
          name="workEmail"
          type="email"
          style={inputStyle}
          value={workEmail}
          maxLength={200}
          onChange={(e) => setWorkEmail(e.target.value)}
          placeholder="you@yourorganization.org"
        />
        {fieldErrors.workEmail && (
          <p style={{ color: ERROR_COLOR, fontSize: 13, marginTop: 6 }}>{fieldErrors.workEmail}</p>
        )}
      </div>

      <div style={fieldWrapStyle}>
        <label style={labelStyle} htmlFor="orgWebsite">
          Organization website
        </label>
        <input
          id="orgWebsite"
          name="orgWebsite"
          type="text"
          style={inputStyle}
          value={orgWebsite}
          maxLength={200}
          onChange={(e) => setOrgWebsite(e.target.value)}
          placeholder="yourorganization.org"
        />
        {fieldErrors.orgWebsite && (
          <p style={{ color: ERROR_COLOR, fontSize: 13, marginTop: 6 }}>{fieldErrors.orgWebsite}</p>
        )}
      </div>

      <div style={fieldWrapStyle}>
        <label style={labelStyle} htmlFor="role">
          Role
        </label>
        <select id="role" name="role" style={inputStyle} value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">Select your role</option>
          {DEMO_ROLE_OPTIONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        {fieldErrors.role && <p style={{ color: ERROR_COLOR, fontSize: 13, marginTop: 6 }}>{fieldErrors.role}</p>}
      </div>

      <div style={{ ...fieldWrapStyle, marginBottom: 28 }}>
        <label style={labelStyle} htmlFor="primaryFundingChallenge">
          Primary funding challenge
        </label>
        <textarea
          id="primaryFundingChallenge"
          name="primaryFundingChallenge"
          style={{ ...inputStyle, minHeight: 88, resize: "vertical" }}
          value={primaryFundingChallenge}
          maxLength={500}
          onChange={(e) => setPrimaryFundingChallenge(e.target.value)}
          placeholder="e.g. We keep missing deadlines because research and drafting eat all our capacity"
        />
        {fieldErrors.primaryFundingChallenge && (
          <p style={{ color: ERROR_COLOR, fontSize: 13, marginTop: 6 }}>
            {fieldErrors.primaryFundingChallenge}
          </p>
        )}
      </div>

      {submitError && <p style={{ color: ERROR_COLOR, fontSize: 14, marginBottom: 16 }}>{submitError}</p>}

      <button type="submit" disabled={submitting} style={{ ...primaryButtonStyle, width: "100%" }}>
        {submitting ? "Submitting..." : "Show me a time"}
      </button>
    </form>
  );
}

declare global {
  interface Window {
    Calendly?: {
      initInlineWidget: (options: { url: string; parentElement: HTMLElement; prefill?: Record<string, unknown> }) => void;
    };
  }
}

function CalendlyStep({
  workEmail,
  onBooked,
}: {
  workEmail: string;
  onBooked: () => void;
}) {
  const calendlyUrl = process.env.NEXT_PUBLIC_CALENDLY_URL;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scriptLoaded, setScriptLoaded] = useState(false);

  useEffect(() => {
    if (!calendlyUrl) return;

    function handleMessage(event: MessageEvent) {
      // Calendly's documented postMessage embed API
      // (developer.calendly.com/references/embed-postmessage) - fires once
      // the visitor actually completes a booking inside the iframe.
      if (
        typeof event.data === "object" &&
        event.data !== null &&
        (event.data as { event?: string }).event === "calendly.event_scheduled"
      ) {
        onBooked();
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendlyUrl]);

  useEffect(() => {
    if (!calendlyUrl) return;
    const existing = document.querySelector<HTMLScriptElement>('script[data-calendly-widget="true"]');
    if (existing) {
      setScriptLoaded(true);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://assets.calendly.com/assets/external/widget.js";
    script.async = true;
    script.dataset.calendlyWidget = "true";
    script.onload = () => setScriptLoaded(true);
    document.body.appendChild(script);
  }, [calendlyUrl]);

  useEffect(() => {
    if (!calendlyUrl || !scriptLoaded || !containerRef.current || !window.Calendly) return;
    window.Calendly.initInlineWidget({
      url: calendlyUrl,
      parentElement: containerRef.current,
      prefill: workEmail ? { email: workEmail } : undefined,
    });
  }, [calendlyUrl, scriptLoaded, workEmail]);

  if (!calendlyUrl) {
    return (
      <div style={cardStyle}>
        <p style={{ color: mk.ink, fontSize: 16, lineHeight: 1.6 }}>
          Thanks - we&rsquo;ve got your request. Online scheduling isn&rsquo;t connected yet, so a member of our
          team will follow up by email to find a time.
        </p>
        <button type="button" style={{ ...ghostButtonStyle, marginTop: 20 }} onClick={onBooked}>
          Continue
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 32, maxWidth: 900 }}>
      <div
        ref={containerRef}
        style={{ minWidth: 320, height: 700, background: mk.surface, borderRadius: mkRadius.card }}
      />
      <div style={{ marginTop: 16 }}>
        <button type="button" style={ghostButtonStyle} onClick={onBooked}>
          I&rsquo;ve booked a time &rarr;
        </button>
      </div>
    </div>
  );
}

function PrepareStep({ demoRequestId, onDone }: { demoRequestId: string; onDone: () => void }) {
  const [mode, setMode] = useState<"choose" | "upload" | "opportunity">("choose");
  const [file, setFile] = useState<File | null>(null);
  const [opportunityReference, setOpportunityReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submitUpload(e: FormEvent) {
    e.preventDefault();
    if (!file || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.set("demoRequestId", demoRequestId);
      formData.set("action", "proposal_upload");
      formData.set("proposal", file);
      const res = await fetch("/api/public/demo/prepare", { method: "POST", body: formData });
      if (!res.ok) {
        setError("We couldn't upload that file. Please try again.");
        return;
      }
      onDone();
    } catch {
      setError("We couldn't upload that file. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitOpportunity(e: FormEvent) {
    e.preventDefault();
    if (opportunityReference.trim().length < 3 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.set("demoRequestId", demoRequestId);
      formData.set("action", "opportunity_reference");
      formData.set("opportunityReference", opportunityReference.trim());
      const res = await fetch("/api/public/demo/prepare", { method: "POST", body: formData });
      if (!res.ok) {
        setError("We couldn't save that. Please try again.");
        return;
      }
      onDone();
    } catch {
      setError("We couldn't save that. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (mode === "choose") {
    return (
      <div style={cardStyle}>
        <p style={{ color: mk.ink, fontSize: 16, marginBottom: 20 }}>
          Optional: give us something real to work with during the call.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <button type="button" style={primaryButtonStyle} onClick={() => setMode("upload")}>
            Upload an old proposal
          </button>
          <button type="button" style={primaryButtonStyle} onClick={() => setMode("opportunity")}>
            Name a real opportunity to use instead
          </button>
          <button type="button" style={ghostButtonStyle} onClick={onDone}>
            Skip this
          </button>
        </div>
      </div>
    );
  }

  if (mode === "upload") {
    return (
      <form onSubmit={submitUpload} style={cardStyle}>
        <label style={labelStyle} htmlFor="proposal">
          Upload an old proposal (PDF, DOC, or DOCX)
        </label>
        <input
          id="proposal"
          name="proposal"
          type="file"
          accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          style={{ ...inputStyle, padding: "10px 12px" }}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        {error && <p style={{ color: ERROR_COLOR, fontSize: 14, marginTop: 12 }}>{error}</p>}
        <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
          <button type="submit" disabled={!file || submitting} style={primaryButtonStyle}>
            {submitting ? "Uploading..." : "Upload"}
          </button>
          <button type="button" style={ghostButtonStyle} onClick={onDone}>
            Skip this
          </button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={submitOpportunity} style={cardStyle}>
      <label style={labelStyle} htmlFor="opportunityReference">
        Name or link to a real opportunity you&rsquo;d like us to use
      </label>
      <input
        id="opportunityReference"
        name="opportunityReference"
        type="text"
        style={inputStyle}
        value={opportunityReference}
        maxLength={500}
        onChange={(e) => setOpportunityReference(e.target.value)}
        placeholder="e.g. The Home Depot Foundation - Path to Pro, or a grants.gov link"
      />
      {error && <p style={{ color: ERROR_COLOR, fontSize: 14, marginTop: 12 }}>{error}</p>}
      <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
        <button
          type="submit"
          disabled={opportunityReference.trim().length < 3 || submitting}
          style={primaryButtonStyle}
        >
          {submitting ? "Saving..." : "Save"}
        </button>
        <button type="button" style={ghostButtonStyle} onClick={onDone}>
          Skip this
        </button>
      </div>
    </form>
  );
}

export default function DemoClient() {
  const [step, setStep] = useState<Step>("intake");
  const [demoRequestId, setDemoRequestId] = useState<string | null>(null);
  const [workEmail, setWorkEmail] = useState("");

  return (
    <Section tone="forest">
      <Display1 tone="forest">See how Benavora would fund your mission.</Display1>
      <p style={{ color: mk.heroMuted, fontSize: 18, marginTop: 16, maxWidth: 640 }}>
        Every tailored demo includes a preliminary organizational funding profile, several relevant funding
        categories, a sample opportunity evaluation, a sample Benavora-generated narrative, a workflow capacity
        estimate, a recommended first automation, and a proposed 30- or 90-day implementation path.
      </p>

      {step === "intake" && (
        <IntakeForm
          onSubmitted={(id, email) => {
            setDemoRequestId(id);
            setWorkEmail(email);
            setStep("calendar");
          }}
        />
      )}

      {step === "calendar" && (
        <CalendlyStep workEmail={workEmail} onBooked={() => setStep("prepare")} />
      )}

      {step === "prepare" && demoRequestId && (
        <PrepareStep demoRequestId={demoRequestId} onDone={() => setStep("done")} />
      )}

      {step === "done" && (
        <div style={cardStyle}>
          <p style={{ color: mk.ink, fontSize: 16, lineHeight: 1.6 }}>
            You&rsquo;re all set. We&rsquo;ll see you on the call - and we&rsquo;ll come prepared with your
            funding profile ready to go.
          </p>
        </div>
      )}
    </Section>
  );
}
