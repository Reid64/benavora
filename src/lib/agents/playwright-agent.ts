// PlaywrightAgent - URL-based browser automation for corporate giving portals.
//
// Unlike BrowserAutomationAgent (which starts from an applicationId and fills a
// pre-linked portal), this agent starts from a raw URL. It is the entry point for
// ad-hoc discovery and apply flows against any corporate giving portal.
//
// Two modes:
//   discover - navigate and extract opportunity metadata only; no form filling.
//              No automation_sessions row is created.
//   apply    - detect form fields via Claude, map templateData, pause for human
//              approval. NEVER submits without an approved automation_sessions row.
//
// Keyword filtering: before filling any form the agent checks whether the
// opportunity keywords passed in overlap with the org's search_profile keywords.
// No match → status='skipped'.
//
// Human approval flow:
//   1. Agent creates an automation_sessions row with status='awaiting_approval'.
//   2. The Automation page surfaces it as a pending approval.
//   3. User clicks Approve → existing approve route resumes submission.
//   4. User clicks Reject → session marked cancelled.

import {
  AgentError,
  BaseAgent,
  type AgentExecution,
  type BaseAgentOptions,
} from "@/lib/agents/base-agent";
import { callClaude } from "@/lib/ai/claude";
import { BrowserEngine } from "@/lib/automation/browser-engine";
import { AutomationSessionManager } from "@/lib/automation/session-manager";
import type { AgentType } from "@/types/agents";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Org profile data used to auto-fill form fields. Passed in by the route after
 * loading from the organizations / profiles tables (never trusted from the
 * request body).
 */
export interface TemplateData {
  orgName?: string;
  ein?: string;
  mission?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
  email?: string;
  website?: string;
  contactName?: string;
  contactEmail?: string;
  requestedAmount?: string;
  taxStatus?: string;
  serviceArea?: string;
  targetPopulation?: string;
}

export interface PlaywrightAgentInput {
  /** Corporate giving portal URL to navigate to. */
  url: string;
  /** Keywords describing the opportunity (used for search_profile matching). */
  keywords: string[];
  /** 'discover' = extract metadata only; 'apply' = detect + fill form. */
  mode: "discover" | "apply";
  /** Org profile data for form filling (pre-loaded by the route). */
  templateData: TemplateData;
}

export interface DiscoveredOpportunity {
  title: string | null;
  description: string | null;
  deadline: string | null;
  amountMax: number | null;
  eligibility: string | null;
}

export interface PlaywrightAgentResult {
  status: "pending_approval" | "discovered" | "skipped" | "failed";
  screenshots: string[];
  /** Field label → filled value for the fields the agent mapped. */
  formData: Record<string, string>;
  /** automation_sessions.id; only present in apply mode. */
  approvalId: string | null;
  skipReason?: string;
  discovered?: DiscoveredOpportunity;
}

// ---------------------------------------------------------------------------
// Internal Claude response shapes
// ---------------------------------------------------------------------------

interface RawDetectedField {
  fieldLabel?: unknown;
  fieldType?: unknown;
  fieldName?: unknown;
  required?: unknown;
  options?: unknown;
}

interface DetectedField {
  fieldLabel: string;
  fieldType: "text" | "select" | "textarea" | "checkbox" | "file";
  fieldName: string;
  required: boolean;
  options: string[];
}

interface RawDiscovered {
  title?: unknown;
  description?: unknown;
  deadline?: unknown;
  amount_max?: unknown;
  eligibility?: unknown;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export class PlaywrightAgent extends BaseAgent<
  PlaywrightAgentInput,
  PlaywrightAgentResult
> {
  readonly agentType: AgentType = "browser_automation";

  constructor(options: BaseAgentOptions) {
    super({ ...options, timeoutMs: options.timeoutMs ?? 300_000 });
  }

  protected async execute(
    input: PlaywrightAgentInput,
  ): Promise<AgentExecution<PlaywrightAgentResult>> {
    const url = (input.url ?? "").trim();
    if (!url) {
      throw new AgentError("url is required.", "invalid_input", 400);
    }
    if (!input.mode || !["discover", "apply"].includes(input.mode)) {
      throw new AgentError(
        "mode must be 'discover' or 'apply'.",
        "invalid_input",
        400,
      );
    }

    // Keyword gate (apply mode only): check org search_profiles before opening
    // a browser session. Skip early to avoid unnecessary browser launches.
    if (input.mode === "apply") {
      const keywordMatch = await this.checkKeywords(input.keywords);
      if (!keywordMatch.matched) {
        return {
          data: {
            status: "skipped",
            screenshots: [],
            formData: {},
            approvalId: null,
            skipReason: "keywords do not match org profile",
          },
          outputSummary: `Skipped ${url}: keywords do not match org profile (profile keywords: ${keywordMatch.profileKeywords.join(", ")}).`,
          itemsFound: 0,
          itemsProcessed: 0,
        };
      }
    }

    if (input.mode === "discover") {
      return this.runDiscover(url);
    }
    return this.runApply(url, input);
  }

  // -------------------------------------------------------------------------
  // Discover mode: navigate + extract, no session row created.
  // -------------------------------------------------------------------------

  private async runDiscover(
    url: string,
  ): Promise<AgentExecution<PlaywrightAgentResult>> {
    // Use a temporary opaque id for BrowserEngine storage paths only. No
    // automation_sessions row is created because discover runs don't require
    // human approval and have no submission lifecycle.
    const tempId = `discover-${Date.now().toString(16)}`;

    const engine = new BrowserEngine({
      client: this.client,
      organizationId: this.organizationId,
      sessionId: tempId,
      headless: false,
    });

    const screenshots: string[] = [];

    try {
      await engine.launch();
      await engine.navigate(url);
      const landingShot = await engine.screenshot("landing");
      screenshots.push(landingShot.storagePath);

      const pageHtml = await safePageHtml(engine.page);
      const { discovered, tokensUsed } =
        await this.extractOpportunityData(pageHtml);

      const discoverShot = await engine.screenshot("discover-result");
      screenshots.push(discoverShot.storagePath);

      return {
        data: {
          status: "discovered",
          screenshots,
          formData: {},
          approvalId: null,
          discovered,
        },
        outputSummary: `Discovered opportunity at ${url}: "${discovered.title ?? "(no title)"}".`,
        itemsFound: 1,
        itemsProcessed: 0,
        tokensUsed,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      const errorShot = await engine
        .captureErrorScreenshot("discover-error")
        .catch(() => null);
      if (errorShot) screenshots.push(errorShot.storagePath);

      return {
        data: {
          status: "failed",
          screenshots,
          formData: {},
          approvalId: null,
        },
        outputSummary: `Discover failed for ${url}: ${message}`,
        itemsFound: 0,
        itemsProcessed: 0,
      };
    } finally {
      await engine.close();
    }
  }

  // -------------------------------------------------------------------------
  // Apply mode: detect fields, fill, pause for human approval.
  // -------------------------------------------------------------------------

  private async runApply(
    url: string,
    input: PlaywrightAgentInput,
  ): Promise<AgentExecution<PlaywrightAgentResult>> {
    const sessions = new AutomationSessionManager({
      client: this.client,
      organizationId: this.organizationId,
    });

    // Create session row before launching the browser so the run is inspectable
    // even if browser work fails (BEHAVIORAL_CONTRACTS §15 - never silently fail).
    const session = await sessions.createSession({
      targetUrl: url,
      startedBy: this.triggeredBy,
    });
    const sessionId = session.id;

    // Headed mode (headless: false) per spec - makes CAPTCHA visible to humans
    // monitoring the run.
    const engine = new BrowserEngine({
      client: this.client,
      organizationId: this.organizationId,
      sessionId,
      headless: false,
    });

    const screenshots: string[] = [];
    let totalTokens = 0;
    let step = 0;

    try {
      await sessions.start(sessionId);
      await engine.launch();

      // --- navigate + landing screenshot -------------------------------------
      await sessions.recordStep(sessionId, {
        stepNumber: ++step,
        action: "navigate",
        description: `Navigate to ${url}`,
        status: "pending",
      });
      await engine.navigate(url);
      const landingShot = await engine.screenshot("landing");
      await sessions.recordScreenshot(sessionId, landingShot, {
        description: "Landing page",
      });
      screenshots.push(landingShot.storagePath);

      // --- detect form fields via Claude -------------------------------------
      await sessions.recordStep(sessionId, {
        stepNumber: ++step,
        action: "detect_form",
        description: "Detect form fields via Claude",
        status: "pending",
      });

      const pageHtml = await safePageHtml(engine.page);
      const { fields, tokensUsed: detectTokens } =
        await this.detectFormFields(pageHtml);
      totalTokens += detectTokens;

      const detectShot = await engine.screenshot("form-detected");
      await sessions.recordScreenshot(sessionId, detectShot, {
        description: "Page after field detection",
      });
      screenshots.push(detectShot.storagePath);

      // --- map templateData to detected fields -------------------------------
      const { formData, mappedFields, unmappedRequired } =
        mapTemplateToFields(fields, input.templateData);

      await sessions.recordStep(sessionId, {
        stepNumber: ++step,
        action: "fill_field",
        description: `Mapped ${mappedFields.length} of ${fields.length} field(s)`,
        status: "pending",
        inputData: {
          mappedCount: mappedFields.length,
          totalFields: fields.length,
        },
      });

      // --- fill non-file fields ----------------------------------------------
      // File uploads and form submission ALWAYS pause for human approval
      // (BEHAVIORAL_CONTRACTS §18: "Automation NEVER auto-submits forms").
      const fileFields = fields.filter((f) => f.fieldType === "file");
      const fillableFields = mappedFields.filter(
        (m) => m.field.fieldType !== "file",
      );

      for (const mapping of fillableFields) {
        try {
          await fillSingleField(engine.page, mapping.field, mapping.value);
        } catch {
          // Field fill failure is non-fatal; record it but continue.
        }
      }

      const filledShot = await engine.screenshot("form-filled");
      await sessions.recordScreenshot(sessionId, filledShot, {
        description: "Form after auto-fill",
      });
      screenshots.push(filledShot.storagePath);

      // Persist the field mapping to the session so the approval reviewer can
      // see what was auto-filled and replay it when they approve.
      const mappedForStorage = fillableFields.map((m) => ({
        field: {
          fieldLabel: m.field.fieldLabel,
          fieldName: m.field.fieldName,
          fieldType: m.field.fieldType,
          selector: `[name="${m.field.fieldName}"]`,
          required: m.field.required,
        },
        value: m.value,
        source: "template_data",
      }));
      const unmappedForStorage = fields
        .filter(
          (f) =>
            !fillableFields.some((m) => m.field.fieldName === f.fieldName),
        )
        .map((f) => ({
          fieldLabel: f.fieldLabel,
          fieldName: f.fieldName,
          fieldType: f.fieldType,
          required: f.required,
        }));

      await this.client
        .from("automation_sessions")
        .update({
          mapped_fields: mappedForStorage,
          unmapped_fields: unmappedForStorage,
          updated_at: new Date().toISOString(),
        })
        .eq("id", sessionId)
        .eq("organization_id", this.organizationId);

      // PAUSE - file uploads and form submission require human approval.
      const note = buildApplyNote(
        fillableFields.length,
        fileFields.length,
        unmappedRequired,
      );
      await sessions.markAwaitingApproval(sessionId, note);

      return {
        data: {
          status: "pending_approval",
          screenshots,
          formData,
          approvalId: sessionId,
        },
        outputSummary: note,
        itemsFound: fields.length,
        itemsProcessed: fillableFields.length,
        tokensUsed: totalTokens,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      const errorShot = await engine
        .captureErrorScreenshot("playwright-error")
        .catch(() => null);
      if (errorShot) {
        screenshots.push(errorShot.storagePath);
        await sessions
          .recordScreenshot(sessionId, errorShot, {
            description: "Error state",
          })
          .catch(() => undefined);
      }
      await sessions.markFailed(sessionId, message).catch(() => undefined);

      return {
        data: {
          status: "failed",
          screenshots,
          formData: {},
          approvalId: null,
        },
        outputSummary: `PlaywrightAgent failed for ${url}: ${message}`,
        itemsFound: 0,
        itemsProcessed: 0,
      };
    } finally {
      await engine.close();
    }
  }

  // --- keyword filtering -----------------------------------------------------

  private async checkKeywords(
    opportunityKeywords: string[],
  ): Promise<{ matched: boolean; profileKeywords: string[] }> {
    if (opportunityKeywords.length === 0) {
      // No keywords supplied → treat as matched (conservative default).
      return { matched: true, profileKeywords: [] };
    }

    const { data: profiles } = await this.client
      .from("search_profiles")
      .select("keywords")
      .eq("organization_id", this.organizationId)
      .eq("is_active", true);

    if (!profiles || profiles.length === 0) {
      return { matched: true, profileKeywords: [] };
    }

    const profileKeywords: string[] = [];
    for (const p of profiles) {
      const kws = p.keywords;
      if (Array.isArray(kws)) {
        for (const k of kws) {
          if (typeof k === "string" && k.trim()) {
            profileKeywords.push(k.trim().toLowerCase());
          }
        }
      }
    }

    if (profileKeywords.length === 0) {
      return { matched: true, profileKeywords: [] };
    }

    const lowerOpp = opportunityKeywords.map((k) => k.toLowerCase());
    const matched = lowerOpp.some((kw) =>
      profileKeywords.some((pk) => pk.includes(kw) || kw.includes(pk)),
    );

    return { matched, profileKeywords };
  }

  // --- Claude: discover mode -------------------------------------------------

  private async extractOpportunityData(
    pageHtml: string,
  ): Promise<{ discovered: DiscoveredOpportunity; tokensUsed: number }> {
    const content =
      pageHtml.length > 80_000 ? pageHtml.slice(0, 80_000) : pageHtml;

    const prompt = `Extract grant/donation opportunity details from this corporate giving page. Return a single JSON object with: title (string or null), description (string or null), deadline (ISO date string or null), amount_max (number or null), eligibility (string or null). ONLY valid JSON, no markdown fences.

Page content:
${content}`;

    const result = await callClaude({ prompt, maxTokens: 1024 });
    const raw = parseJsonSafe<RawDiscovered>(result.text);

    return {
      discovered: {
        title: toStr(raw?.title),
        description: toStr(raw?.description),
        deadline: toStr(raw?.deadline),
        amountMax: toNum(raw?.amount_max),
        eligibility: toStr(raw?.eligibility),
      },
      tokensUsed: result.usage.totalTokens,
    };
  }

  // --- Claude: field detection -----------------------------------------------

  private async detectFormFields(
    pageHtml: string,
  ): Promise<{ fields: DetectedField[]; tokensUsed: number }> {
    const content =
      pageHtml.length > 80_000 ? pageHtml.slice(0, 80_000) : pageHtml;

    const prompt = `Identify all form fields on this corporate donation/grant application page. Return a JSON array where each element has: fieldLabel (string), fieldType ("text"|"select"|"textarea"|"checkbox"|"file"), fieldName (string - the name or id attribute), required (boolean), options (array of strings for select fields, empty array otherwise). If no form fields found, return []. ONLY valid JSON, no markdown fences.

Page content:
${content}`;

    const result = await callClaude({ prompt, maxTokens: 2048 });
    const raw = parseJsonArraySafe<RawDetectedField>(result.text);

    const fields: DetectedField[] = [];
    for (const item of raw) {
      const label = toStr(item?.fieldLabel);
      const name = toStr(item?.fieldName);
      if (!label && !name) continue;
      const rawType = toStr(item?.fieldType);
      const fieldType: DetectedField["fieldType"] =
        rawType !== null && isValidFieldType(rawType) ? rawType : "text";
      const rawOptions = item?.options;
      const options: string[] = Array.isArray(rawOptions)
        ? rawOptions.filter((o): o is string => typeof o === "string")
        : [];
      fields.push({
        fieldLabel: label ?? name ?? "",
        fieldType,
        fieldName: name ?? label ?? "",
        required: item?.required === true,
        options,
      });
    }

    return { fields, tokensUsed: result.usage.totalTokens };
  }
}

// ---------------------------------------------------------------------------
// Form field filling helpers (operate on a live Playwright Page)
// ---------------------------------------------------------------------------

type PlaywrightPage = import("playwright").Page;

async function safePageHtml(page: PlaywrightPage): Promise<string> {
  try {
    return await page.evaluate(
      () => document.documentElement.outerHTML ?? "",
    );
  } catch {
    return "";
  }
}

async function fillSingleField(
  page: PlaywrightPage,
  field: DetectedField,
  value: string,
): Promise<void> {
  // File inputs always pause for human approval - never auto-fill.
  if (field.fieldType === "file") return;

  // Build candidate selectors in preference order.
  const selectors: string[] = [];
  if (field.fieldName) {
    selectors.push(`[name="${field.fieldName}"]`, `#${field.fieldName}`);
  }
  if (field.fieldLabel) {
    selectors.push(`[aria-label="${field.fieldLabel}"]`);
  }

  for (const sel of selectors) {
    try {
      const locator = page.locator(sel).first();
      if ((await locator.count()) === 0) continue;

      if (field.fieldType === "select") {
        await locator.selectOption(value);
      } else if (field.fieldType === "checkbox") {
        const shouldCheck = value === "true" || value === "1" || value === "yes";
        if (shouldCheck) {
          await locator.check();
        } else {
          await locator.uncheck();
        }
      } else {
        await locator.fill(value);
      }
      return; // success - stop trying selectors
    } catch {
      // Try next selector.
    }
  }
}

// ---------------------------------------------------------------------------
// Template → form field mapping
// ---------------------------------------------------------------------------

interface FieldMapping {
  field: DetectedField;
  value: string;
}

function mapTemplateToFields(
  fields: DetectedField[],
  template: TemplateData,
): {
  formData: Record<string, string>;
  mappedFields: FieldMapping[];
  unmappedRequired: string[];
} {
  const formData: Record<string, string> = {};
  const mappedFields: FieldMapping[] = [];

  // Keyword → templateData key lookup table for intelligent field matching.
  const keywordMap: Array<{ keywords: string[]; key: keyof TemplateData }> = [
    {
      keywords: ["organization name", "org name", "nonprofit name", "applicant name", "organization"],
      key: "orgName",
    },
    {
      keywords: ["ein", "tax id", "employer identification", "federal tax"],
      key: "ein",
    },
    {
      keywords: ["mission", "purpose", "description"],
      key: "mission",
    },
    {
      keywords: ["address", "street", "mailing"],
      key: "address",
    },
    { keywords: ["city"], key: "city" },
    { keywords: ["state", "province"], key: "state" },
    { keywords: ["zip", "postal"], key: "zip" },
    { keywords: ["phone", "telephone", "mobile"], key: "phone" },
    { keywords: ["email", "e-mail"], key: "email" },
    { keywords: ["website", "url", "web"], key: "website" },
    {
      keywords: [
        "contact name",
        "contact person",
        "primary contact",
        "your name",
        "full name",
        "name",
      ],
      key: "contactName",
    },
    { keywords: ["contact email", "your email"], key: "contactEmail" },
    {
      keywords: ["amount requested", "grant amount", "request amount", "funding amount"],
      key: "requestedAmount",
    },
    { keywords: ["tax status", "501", "tax exempt"], key: "taxStatus" },
    { keywords: ["service area", "geographic"], key: "serviceArea" },
    {
      keywords: ["target population", "population served", "who do you serve"],
      key: "targetPopulation",
    },
  ];

  for (const field of fields) {
    if (field.fieldType === "file") continue; // never auto-fill file inputs

    const haystack = `${field.fieldLabel} ${field.fieldName}`.toLowerCase();
    let matchedValue: string | undefined;

    for (const { keywords, key } of keywordMap) {
      if (keywords.some((kw) => haystack.includes(kw))) {
        const val = template[key];
        if (val !== undefined && val !== "") {
          matchedValue = String(val);
          break;
        }
      }
    }

    if (matchedValue !== undefined) {
      formData[field.fieldLabel] = matchedValue;
      mappedFields.push({ field, value: matchedValue });
    }
  }

  const unmappedRequired = fields
    .filter(
      (f) =>
        f.required &&
        f.fieldType !== "file" &&
        !mappedFields.some((m) => m.field.fieldName === f.fieldName),
    )
    .map((f) => f.fieldLabel || f.fieldName);

  return { formData, mappedFields, unmappedRequired };
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function parseJsonSafe<T>(text: string): T | null {
  const clean = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  try {
    return JSON.parse(clean) as T;
  } catch {
    return null;
  }
}

function parseJsonArraySafe<T>(text: string): T[] {
  const clean = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  try {
    const parsed: unknown = JSON.parse(clean);
    if (Array.isArray(parsed)) return parsed as T[];
    if (parsed !== null && typeof parsed === "object") {
      const candidate = (parsed as Record<string, unknown>)["fields"];
      if (Array.isArray(candidate)) return candidate as T[];
    }
  } catch {
    // Not JSON.
  }
  return [];
}

function toStr(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  return s === "" || s === "null" ? null : s;
}

function toNum(val: unknown): number | null {
  if (typeof val === "number" && !isNaN(val) && val > 0) return val;
  if (typeof val === "string") {
    const n = parseFloat(val.replace(/[^0-9.]/g, ""));
    if (!isNaN(n) && n > 0) return n;
  }
  return null;
}

function isValidFieldType(
  s: string,
): s is "text" | "select" | "textarea" | "checkbox" | "file" {
  return ["text", "select", "textarea", "checkbox", "file"].includes(s);
}

function buildApplyNote(
  mappedCount: number,
  fileFieldCount: number,
  unmappedRequired: string[],
): string {
  const parts: string[] = [
    `Auto-filled ${mappedCount} field${mappedCount === 1 ? "" : "s"}.`,
  ];
  if (fileFieldCount > 0) {
    parts.push(
      `${fileFieldCount} file upload${fileFieldCount === 1 ? "" : "s"} require manual attachment.`,
    );
  }
  if (unmappedRequired.length > 0) {
    parts.push(
      `${unmappedRequired.length} required field${unmappedRequired.length === 1 ? "" : "s"} need human input: ${unmappedRequired.join(", ")}.`,
    );
  }
  parts.push("Review and approve to submit.");
  return parts.join(" ");
}
