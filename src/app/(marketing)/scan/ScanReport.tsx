import type { CSSProperties } from "react";

import { Section, Display1, Display2 } from "@/components/marketing/Section";
import { mk, mkRadius } from "@/lib/marketing/theme";
import {
  SCAN_FUNDING_PRIORITIES,
  SCAN_TIER_COPY,
  type ScanFundingPriority,
} from "@/lib/scan/constants";
import type { FundingPotentialScanResult } from "@/lib/scan/scoring-engine";
import ScanEmailCapture from "./ScanEmailCapture";

// Funding Potential Scan report. Renders immediately after form submission,
// before any email is requested - the reciprocity principle this scan is
// built on requires real value up front, not behind a wall. Every section
// below reads only from the scoring engine's real FundingPotentialScanResult
// (src/lib/scan/scoring-engine.ts) - nothing here invents a specific funder
// name, dollar figure, or claim about the visitor's actual documentation,
// since the engine intentionally never collects or returns any of that.
//
// Email capture (ScanEmailCapture.tsx) renders as the final card below, after
// the full report - the visitor already has the report on-page either way;
// the email ask is for delivery/save/share of that same content, not for
// unlocking it.

const TIER_COPY = SCAN_TIER_COPY;

const ELIGIBILITY_CHECKLIST: string[] = [
  "IRS 501(c)(3) determination letter (or fiscal sponsor agreement, if pending)",
  "Most recent Form 990 or 990-EZ/990-N filing",
  "Current year operating budget and most recent audited or reviewed financials",
  "Board of directors list with affiliations",
  "Organizational mission statement and a one-page program description",
  "W-9 and, for government funding, a SAM.gov registration and active UEI number",
];

const STRATEGY_OUTLINE: Array<{ window: string; title: string; items: string[] }> = [
  {
    window: "Days 1-30",
    title: "Get eligibility-ready",
    items: [
      "Assemble the documentation checklist above so you're not blocked once a strong-fit opportunity appears.",
      "Confirm your mission statement clearly names the categories this scan identified, since funders and grant databases match on stated focus area.",
      "Track every deadline for opportunities in your identified categories, even ones you're not ready to apply to yet.",
    ],
  },
  {
    window: "Days 31-60",
    title: "Build your pipeline",
    items: [
      "Shortlist the open opportunities that match your category, geography, and funding priority.",
      "Draft your core case for support once, then adapt it per opportunity rather than starting from scratch each time.",
      "Identify which shortlisted opportunities need a relationship or introduction before you apply cold.",
    ],
  },
  {
    window: "Days 61-90",
    title: "Apply and track",
    items: [
      "Submit applications for your best-fit, deadline-driven opportunities first.",
      "Log what each funder asked for and how you answered it, so the next application reuses that work.",
      "Revisit this scan periodically - the tracked opportunity pool changes as new funding is discovered.",
    ],
  },
];

const cardStyle: CSSProperties = {
  background: mk.surface,
  borderRadius: mkRadius.card,
  padding: 28,
  border: `1px solid ${mk.line}`,
};

const sectionGapStyle: CSSProperties = { marginTop: 28 };

const disclaimerStyle: CSSProperties = {
  fontSize: 13,
  color: mk.muted,
  lineHeight: 1.6,
  marginTop: 16,
};

type ScanReportProps = {
  result: FundingPotentialScanResult;
  fundingPriority: ScanFundingPriority;
  scanSubmissionId: string;
  orgNameOrWebsite: string;
};

export default function ScanReport({
  result,
  fundingPriority,
  scanSubmissionId,
  orgNameOrWebsite,
}: ScanReportProps) {
  const tier = TIER_COPY[result.tier];
  const priorityLabel =
    SCAN_FUNDING_PRIORITIES.find((p) => p.value === fundingPriority)?.label ?? "your funding priority";
  const showAlignedMatches = !result.degraded && result.matchedCount > 0;

  return (
    <Section tone="paper">
      <Display1>Your Funding Potential Scan</Display1>
      <p style={{ color: mk.muted, fontSize: 18, marginTop: 16, maxWidth: 680 }}>
        Here's what we found, based on your stated mission, state, and current priority of{" "}
        {priorityLabel.toLowerCase()}.
      </p>

      {/* Funding readiness profile */}
      <div style={{ ...cardStyle, ...sectionGapStyle }}>
        <Display2>Funding readiness profile</Display2>
        <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginTop: 20 }}>
          <span style={{ fontSize: 56, fontWeight: 700, color: tier.color, lineHeight: 1 }}>
            {result.score}
          </span>
          <div>
            <div style={{ fontSize: 20, fontWeight: 600, color: mk.ink }}>{tier.label}</div>
            <div style={{ fontSize: 14, color: mk.muted }}>out of 100</div>
          </div>
        </div>
        <p style={{ color: mk.ink, fontSize: 16, marginTop: 16, maxWidth: 640 }}>{tier.blurb}</p>
        {result.guidance.map((line, i) => (
          <p key={i} style={{ color: mk.ink, fontSize: 15, marginTop: 12, maxWidth: 640, lineHeight: 1.6 }}>
            {line}
          </p>
        ))}
        <p style={disclaimerStyle}>{result.methodology}</p>
      </div>

      {/* Likely opportunity categories */}
      <div style={{ ...cardStyle, ...sectionGapStyle }}>
        <Display2>Likely opportunity categories</Display2>
        {result.categoriesConsidered.length > 0 ? (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 20 }}>
              {result.categoriesConsidered.map((label) => (
                <span
                  key={label}
                  style={{
                    background: mk.tint,
                    color: mk.forest,
                    borderRadius: 999,
                    padding: "8px 16px",
                    fontSize: 14,
                    fontWeight: 600,
                  }}
                >
                  {label}
                </span>
              ))}
            </div>
            <p style={{ color: mk.muted, fontSize: 14, marginTop: 16 }}>
              Derived from keywords in your stated mission, matched against Benavora's tracked funding
              categories - not a guarantee that funding exists in every category listed.
            </p>
          </>
        ) : (
          <p style={{ color: mk.ink, fontSize: 15, marginTop: 16, maxWidth: 640 }}>
            We couldn't confidently match your mission statement to one of our tracked funding
            categories. Organizations in a similar position typically explore government grants,
            private foundations, and local community grants while refining how their mission statement
            names a specific focus area.
          </p>
        )}
      </div>

      {/* Sample aligned funders - only rendered when the engine returned real, non-degraded matches */}
      {showAlignedMatches && (
        <div style={{ ...cardStyle, ...sectionGapStyle }}>
          <Display2>Aligned funding matches</Display2>
          <p style={{ color: mk.ink, fontSize: 15, marginTop: 20, maxWidth: 640, lineHeight: 1.6 }}>
            We found {result.matchedCount} open opportunit{result.matchedCount === 1 ? "y" : "ies"} in
            Benavora's live database that match your category and aren't geographically restricted
            against your state.
          </p>
          {result.amountRange && (
            <p style={{ color: mk.ink, fontSize: 15, marginTop: 8, maxWidth: 640, lineHeight: 1.6 }}>
              Typical award sizes among these run from ${result.amountRange.min.toLocaleString()} to $
              {result.amountRange.max.toLocaleString()}.
            </p>
          )}
          <p style={{ color: mk.muted, fontSize: 14, marginTop: 16, maxWidth: 640 }}>
            This free scan doesn't disclose individual funder names or opportunity records - those are
            available in full once your organization's profile is set up in Benavora, so we can also
            check them against your specific eligibility.
          </p>
        </div>
      )}

      {/* Documentation / eligibility gaps */}
      <div style={{ ...cardStyle, ...sectionGapStyle }}>
        <Display2>Documentation &amp; eligibility checklist</Display2>
        <p style={{ color: mk.muted, fontSize: 14, marginTop: 16, maxWidth: 640 }}>
          General guidance, not a review of your organization's actual documents - this scan didn't
          collect or examine any of your filings. Most funders in your identified categories expect:
        </p>
        <ul style={{ marginTop: 16, paddingLeft: 20, maxWidth: 640 }}>
          {ELIGIBILITY_CHECKLIST.map((item) => (
            <li key={item} style={{ color: mk.ink, fontSize: 15, lineHeight: 1.8 }}>
              {item}
            </li>
          ))}
        </ul>
      </div>

      {/* 90-day funding strategy outline */}
      <div style={{ ...cardStyle, ...sectionGapStyle }}>
        <Display2>Recommended 90-day funding strategy</Display2>
        <p style={{ color: mk.muted, fontSize: 14, marginTop: 16, maxWidth: 640 }}>
          A general roadmap for organizations in your position - adjust pacing to your team's capacity.
        </p>
        <div style={{ display: "grid", gap: 20, marginTop: 20 }}>
          {STRATEGY_OUTLINE.map((phase) => (
            <div key={phase.window}>
              <div style={{ fontSize: 13, fontWeight: 700, color: mk.terracotta, letterSpacing: 0.02 }}>
                {phase.window}
              </div>
              <div style={{ fontSize: 17, fontWeight: 600, color: mk.ink, marginTop: 4 }}>
                {phase.title}
              </div>
              <ul style={{ marginTop: 8, paddingLeft: 20 }}>
                {phase.items.map((item) => (
                  <li key={item} style={{ color: mk.ink, fontSize: 15, lineHeight: 1.7 }}>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <ScanEmailCapture
        scanSubmissionId={scanSubmissionId}
        orgNameOrWebsite={orgNameOrWebsite}
        result={result}
      />
    </Section>
  );
}
