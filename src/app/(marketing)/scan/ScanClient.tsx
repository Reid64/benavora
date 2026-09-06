"use client";

import { useState, type CSSProperties, type FormEvent } from "react";

import { Section, Display1 } from "@/components/marketing/Section";
import { mk, mkRadius } from "@/lib/marketing/theme";
import { SCAN_FUNDING_PRIORITIES, SCAN_US_STATES, type ScanFundingPriority } from "@/lib/scan/constants";
import type { FundingPotentialScanResult } from "@/lib/scan/scoring-engine";
import ScanReport from "./ScanReport";

// Funding Potential Scan intake form. Collects exactly five fields, POSTs to
// /api/public/scan, and renders the resulting report immediately on-page -
// per the reciprocity principle, the report is not gated behind an email
// ask. Email capture (ScanEmailCapture.tsx, rendered inside ScanReport after
// the full report) is a separate, later step for delivering/saving/sharing
// a copy of the report that's already visible - not a gate to see it. If
// scoring failed server-side (`scan: null` in the response), this falls
// back to a no-score acknowledgement rather than fabricating a report.

const ERROR_COLOR = "#EF4444"; // governance/DESIGN_SYSTEM.md Accent-Red

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

type FieldErrors = Partial<
  Record<"orgNameOrWebsite" | "ein" | "state" | "primaryMission" | "fundingPriority", string>
>;

export default function ScanClient() {
  const [orgNameOrWebsite, setOrgNameOrWebsite] = useState("");
  const [ein, setEin] = useState("");
  const [state, setState] = useState("");
  const [primaryMission, setPrimaryMission] = useState("");
  const [fundingPriority, setFundingPriority] = useState("");
  const [hpToken, setHpToken] = useState(""); // honeypot; left empty by real users

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [scanResult, setScanResult] = useState<FundingPotentialScanResult | null>(null);
  const [submittedPriority, setSubmittedPriority] = useState<ScanFundingPriority | null>(null);
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [submittedOrgNameOrWebsite, setSubmittedOrgNameOrWebsite] = useState("");

  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    if (orgNameOrWebsite.trim().length < 2) {
      errors.orgNameOrWebsite = "Enter your organization's name or website.";
    }
    if (ein.trim() && !/^\d{2}-?\d{7}$/.test(ein.trim())) {
      errors.ein = "EIN should look like 12-3456789.";
    }
    if (!state) {
      errors.state = "Select your state.";
    }
    if (primaryMission.trim().length < 5) {
      errors.primaryMission = "Tell us your primary mission in a sentence.";
    }
    if (!fundingPriority) {
      errors.fundingPriority = "Select your current funding priority.";
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
      const res = await fetch("/api/public/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgNameOrWebsite: orgNameOrWebsite.trim(),
          ein: ein.trim() || undefined,
          state,
          primaryMission: primaryMission.trim(),
          fundingPriority,
          hpToken: hpToken || undefined,
        }),
      });

      if (!res.ok) {
        setSubmitError("We couldn't submit your scan request. Please try again.");
        return;
      }

      const body: { ok: boolean; scan: FundingPotentialScanResult | null; submissionId: string } =
        await res.json();
      setScanResult(body.scan);
      setSubmittedPriority(fundingPriority as ScanFundingPriority);
      setSubmissionId(body.submissionId);
      setSubmittedOrgNameOrWebsite(orgNameOrWebsite.trim());
      setSubmitted(true);
    } catch {
      setSubmitError("We couldn't submit your scan request. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    if (scanResult && submittedPriority && submissionId) {
      return (
        <ScanReport
          result={scanResult}
          fundingPriority={submittedPriority}
          scanSubmissionId={submissionId}
          orgNameOrWebsite={submittedOrgNameOrWebsite}
        />
      );
    }

    // Scoring failed server-side (e.g. transient data-source error) - the
    // submission itself is safely stored, so acknowledge it honestly rather
    // than fabricating a score.
    return (
      <Section tone="forest">
        <Display1 tone="forest">Thanks - we&rsquo;ve got it.</Display1>
        <p style={{ color: mk.heroMuted, fontSize: 18, marginTop: 16, maxWidth: 640 }}>
          We&rsquo;ve received your organization&rsquo;s information. We couldn&rsquo;t generate your
          scan report just now - our team will follow up with your results directly.
        </p>
      </Section>
    );
  }

  return (
    <Section tone="forest">
      <Display1 tone="forest">Free Funding Potential Scan</Display1>
      <p style={{ color: mk.heroMuted, fontSize: 18, marginTop: 16, maxWidth: 640 }}>
        Tell us a bit about your organization. It takes less than a minute.
      </p>

      <form
        onSubmit={handleSubmit}
        noValidate
        style={{
          marginTop: 32,
          maxWidth: 520,
          background: mk.surface,
          borderRadius: mkRadius.card,
          padding: 32,
        }}
      >
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
          <label style={labelStyle} htmlFor="orgNameOrWebsite">
            Organization name or website
          </label>
          <input
            id="orgNameOrWebsite"
            name="orgNameOrWebsite"
            type="text"
            style={inputStyle}
            value={orgNameOrWebsite}
            maxLength={200}
            onChange={(e) => setOrgNameOrWebsite(e.target.value)}
            placeholder="Faith Foundation or faithfoundation.org"
          />
          {fieldErrors.orgNameOrWebsite && (
            <p style={{ color: ERROR_COLOR, fontSize: 13, marginTop: 6 }}>
              {fieldErrors.orgNameOrWebsite}
            </p>
          )}
        </div>

        <div style={fieldWrapStyle}>
          <label style={labelStyle} htmlFor="ein">
            EIN <span style={{ fontWeight: 400, color: mk.muted }}>(optional)</span>
          </label>
          <input
            id="ein"
            name="ein"
            type="text"
            style={inputStyle}
            value={ein}
            maxLength={20}
            onChange={(e) => setEin(e.target.value)}
            placeholder="12-3456789"
          />
          {fieldErrors.ein && (
            <p style={{ color: ERROR_COLOR, fontSize: 13, marginTop: 6 }}>{fieldErrors.ein}</p>
          )}
        </div>

        <div style={fieldWrapStyle}>
          <label style={labelStyle} htmlFor="state">
            State
          </label>
          <select
            id="state"
            name="state"
            style={inputStyle}
            value={state}
            onChange={(e) => setState(e.target.value)}
          >
            <option value="">Select a state</option>
            {SCAN_US_STATES.map((s) => (
              <option key={s.abbr} value={s.abbr}>
                {s.name}
              </option>
            ))}
          </select>
          {fieldErrors.state && (
            <p style={{ color: ERROR_COLOR, fontSize: 13, marginTop: 6 }}>{fieldErrors.state}</p>
          )}
        </div>

        <div style={fieldWrapStyle}>
          <label style={labelStyle} htmlFor="primaryMission">
            Primary mission
          </label>
          <input
            id="primaryMission"
            name="primaryMission"
            type="text"
            style={inputStyle}
            value={primaryMission}
            maxLength={160}
            onChange={(e) => setPrimaryMission(e.target.value)}
            placeholder="e.g. Affordable housing for veterans"
          />
          {fieldErrors.primaryMission && (
            <p style={{ color: ERROR_COLOR, fontSize: 13, marginTop: 6 }}>
              {fieldErrors.primaryMission}
            </p>
          )}
        </div>

        <div style={{ ...fieldWrapStyle, marginBottom: 28 }}>
          <label style={labelStyle} htmlFor="fundingPriority">
            Current funding priority
          </label>
          <select
            id="fundingPriority"
            name="fundingPriority"
            style={inputStyle}
            value={fundingPriority}
            onChange={(e) => setFundingPriority(e.target.value)}
          >
            <option value="">Select a priority</option>
            {SCAN_FUNDING_PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          {fieldErrors.fundingPriority && (
            <p style={{ color: ERROR_COLOR, fontSize: 13, marginTop: 6 }}>
              {fieldErrors.fundingPriority}
            </p>
          )}
        </div>

        {submitError && (
          <p style={{ color: ERROR_COLOR, fontSize: 14, marginBottom: 16 }}>{submitError}</p>
        )}

        <button
          type="submit"
          disabled={submitting}
          style={{
            display: "inline-block",
            width: "100%",
            background: submitting ? mk.terracottaHover : mk.terracotta,
            color: "#FFFFFF",
            borderRadius: mkRadius.cta,
            padding: "14px 20px",
            fontWeight: 600,
            fontSize: 15,
            border: "none",
            cursor: submitting ? "default" : "pointer",
          }}
        >
          {submitting ? "Submitting..." : "Get My Funding Scan"}
        </button>
      </form>
    </Section>
  );
}
