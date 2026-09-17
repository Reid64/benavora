// Email security layer types (Phase 6.1, QUEUE-PHASE6-1).
//
// Shared shapes for the SPF/DKIM/DMARC authenticity checks, phishing
// detection, attachment scanning, PII masking, and sender risk scoring that
// run ahead of email-parser.ts's content extraction (AGENTS.md email_parser
// agent family).

export interface SPFResult {
  pass: boolean;
  policyType: "pass" | "fail" | "softfail" | "neutral";
  explanation: string;
}

export interface DKIMResult {
  valid: boolean;
  domains: string[];
  keyLength: number;
}

export interface DMARCResult {
  pass: boolean;
  policy: "none" | "quarantine" | "reject";
  alignmentMode: "strict" | "relaxed";
}

/** Combined output of the three authenticity checks, as fed to downstream scoring. */
export interface AuthenticationResult {
  spf: SPFResult;
  dkim: DKIMResult;
  dmarc: DMARCResult;
}

export interface PhishingIndicators {
  score: number;
  urlMismatch: boolean;
  homographAttack: boolean;
  credentialHarvestingLanguage: boolean;
  domainLookalike: boolean;
  indicators: string[];
}

export interface AttachmentScan {
  filename: string;
  mimeType: string;
  verdict: "safe" | "suspicious" | "malware";
  reason: string;
}

export interface PIIMask {
  type: "email" | "phone" | "ssn" | "creditcard" | "password" | "apikey";
  hash: string;
  masked: string;
}

export type SenderRiskLevel = "SAFE" | "CAUTION" | "BLOCK";

export interface EmailSecurityContext {
  spf: SPFResult;
  dkim: DKIMResult;
  dmarc: DMARCResult;
  phishing: PhishingIndicators;
  attachments: AttachmentScan[];
  piiDetected: PIIMask[];
  senderRiskLevel: SenderRiskLevel;
}
