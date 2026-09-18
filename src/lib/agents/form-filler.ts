// Form Filler Agent — fills and submits a corporate giving form using Playwright
// and a stored form_template. Uploads screenshots to Supabase Storage and creates
// an autoapply_submissions record with full audit trail.
//
// NOTE: Playwright requires a Chromium binary installed at runtime. This agent
// runs correctly in local Node.js and on the dedicated AutoApply worker. It
// will not run in Vercel serverless (no binary). The /api/agents/form-filler
// route is for development and worker-proxied use only.

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { StealthBrowser } from "@/lib/autoapply/stealth-browser";
import { callClaude, DEFAULT_MAX_TOKENS, DEFAULT_MODEL } from "@/lib/ai/claude";
import {
  AgentError,
  BaseAgent,
  type AgentExecution,
  type BaseAgentOptions,
  AGENT_TIMEOUT_MULTI_STEP_MS,
} from "@/lib/agents/base-agent";
import type { FieldMappingEntry } from "@/lib/agents/form-analyzer";
import type { AgentType } from "@/types/agents";

const PLAYWRIGHT_TIMEOUT_MS = 30_000;
const AUTOAPPLY_BUCKET = "autoapply-screenshots";

export interface FormFillerInput {
  funderId: string;
  requestAmount?: number;
  requestDescription?: string;
}

export interface FormFillerResult {
  submissionId: string;
  funderId: string;
  status: string;
  confirmationNumber: string | null;
  preScreenshotUrl: string | null;
  postScreenshotUrl: string | null;
  requestDescription: string;
}

export interface FormFillerAgentOptions extends BaseAgentOptions {
  model?: string;
  maxTokens?: number;
}

interface OrgProfile {
  name: string | null;
  ein: string | null;
  tax_status: string | null;
  mission_statement: string | null;
  email: string | null;
  phone: string | null;
  address_line1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  website: string | null;
  service_area: string | null;
  target_population: string | null;
}

interface RequestData {
  amount: string;
  description: string;
}

function resolveFieldValue(
  kbMapping: string,
  org: OrgProfile,
  request: RequestData,
): string {
  switch (kbMapping) {
    case "organizations.name":
      return org.name ?? "";
    case "organizations.ein":
      return org.ein ?? "";
    case "organizations.mission_statement":
      return org.mission_statement ?? "";
    case "organizations.email":
      return org.email ?? "";
    case "organizations.phone":
      return org.phone ?? "";
    case "organizations.address_line1":
      return org.address_line1 ?? "";
    case "organizations.city":
      return org.city ?? "";
    case "organizations.state":
      return org.state ?? "";
    case "organizations.zip":
      return org.zip ?? "";
    case "organizations.website":
      return org.website ?? "";
    case "request.amount":
      return request.amount;
    case "request.description":
      return request.description;
    default:
      return "";
  }
}

export class FormFillerAgent extends BaseAgent<FormFillerInput, FormFillerResult> {
  readonly agentType: AgentType = "form_filler";

  private readonly model: string;
  private readonly maxTokens: number;

  constructor(options: FormFillerAgentOptions) {
    super({ ...options, timeoutMs: options.timeoutMs ?? AGENT_TIMEOUT_MULTI_STEP_MS });
    this.model = options.model ?? DEFAULT_MODEL;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  protected async execute(
    input: FormFillerInput,
  ): Promise<AgentExecution<FormFillerResult>> {
    // Query form_templates — most recent template for this funder
    const { data: template, error: templateError } = await this.client
      .from("form_templates")
      .select("id, portal_url, field_mapping, file_upload_fields")
      .eq("funder_id", input.funderId)
      .eq("organization_id", this.organizationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (templateError || !template) {
      throw new AgentError(
        "Form template not found. Run form analysis first.",
        "no_template",
        404,
      );
    }

    // Query organization profile
    const { data: org, error: orgError } = await this.client
      .from("organizations")
      .select(
        "name, ein, tax_status, mission_statement, email, phone, address_line1, city, state, zip, website, service_area, target_population",
      )
      .eq("id", this.organizationId)
      .single();

    if (orgError || !org) {
      throw new AgentError("Organization profile not found.", "no_org", 404);
    }

    // Query funder for name (for Claude prompt and output summary)
    const { data: funder, error: funderError } = await this.client
      .from("funders")
      .select("id, name")
      .eq("id", input.funderId)
      .eq("organization_id", this.organizationId)
      .single();

    if (funderError || !funder) {
      throw new AgentError("Funder not found.", "not_found", 404);
    }

    const orgProfile = org as unknown as OrgProfile;

    // Generate request description if not provided
    let requestDescription = input.requestDescription ?? "";
    let tokensUsed = 0;

    if (!requestDescription) {
      const response = await callClaude({
        prompt: [
          `Write a concise donation request (150-200 words) from ${orgProfile.name ?? "our organization"},`,
          `a ${orgProfile.tax_status ?? "nonprofit"} organization,`,
          `to ${funder.name as string}.`,
          `The organization's mission: ${orgProfile.mission_statement ?? "serving the community"}.`,
          `Service area: ${orgProfile.service_area ?? "local area"}.`,
          `Target population: ${orgProfile.target_population ?? "community members"}.`,
          `Request amount: $${input.requestAmount?.toString() ?? "general support"}.`,
          `Tone: professional, grateful, specific about community impact.`,
        ].join(" "),
        model: this.model,
        maxTokens: this.maxTokens,
      });
      requestDescription = response.text.trim();
      tokensUsed = response.usage.totalTokens;
    }

    const portalUrl = template.portal_url as string;
    const rawMapping = Array.isArray(template.field_mapping)
      ? (template.field_mapping as unknown as FieldMappingEntry[])
      : [];
    const fileUploadFields =
      template.file_upload_fields != null &&
      typeof template.file_upload_fields === "object" &&
      !Array.isArray(template.file_upload_fields)
        ? (template.file_upload_fields as Record<string, string>)
        : {};

    const requestData: RequestData = {
      amount: input.requestAmount?.toString() ?? "",
      description: requestDescription,
    };

    let preScreenshotUrl: string | null = null;
    let postScreenshotUrl: string | null = null;
    let confirmationNumber: string | null = null;

    // StealthBrowser applies fingerprint randomization, UA rotation, US
    // timezone/locale, and human-behavior helpers. AutoApply runs headful
    // (less detectable than headless) on the worker.
    const stealth = new StealthBrowser({ headless: false });
    const { browser, page } = await stealth.launch().catch(
      (launchErr: unknown) => {
        const msg =
          launchErr instanceof Error ? launchErr.message : "launch failed";
        throw new AgentError(
          `Playwright could not launch Chromium: ${msg}. Run npx playwright install chromium on the worker host.`,
          "playwright_unavailable",
          503,
        );
      },
    );

    try {
      await page.goto(portalUrl, {
        timeout: PLAYWRIGHT_TIMEOUT_MS,
        waitUntil: "domcontentloaded",
      });

      const tempFiles: string[] = [];
      try {
        // Fill each mapped field
        for (const field of rawMapping) {
          if (field.manualReviewRequired) continue;

          const nameSelector = `[name="${field.fieldName}"]`;
          const idSelector = `#${field.fieldName}`;
          const combinedSelector = `${nameSelector}, ${idSelector}`;

          if (field.fieldType === "file") {
            const storagePath = fileUploadFields[field.fieldName];
            if (storagePath) {
              const { data: fileBlob } = await this.client.storage
                .from(`org-${this.organizationId}`)
                .download(storagePath);
              if (fileBlob) {
                const buffer = Buffer.from(await fileBlob.arrayBuffer());
                const tmpPath = path.join(
                  os.tmpdir(),
                  `benavora_upload_${field.fieldName}_${Date.now()}`,
                );
                fs.writeFileSync(tmpPath, buffer);
                tempFiles.push(tmpPath);
                await page.setInputFiles(combinedSelector, tmpPath).catch(
                  () => undefined,
                );
              }
            }
          } else if (field.fieldType === "select") {
            const value = resolveFieldValue(
              field.kbMapping,
              orgProfile,
              requestData,
            );
            if (value) {
              await page
                .selectOption(combinedSelector, value)
                .catch(() => undefined);
            }
          } else if (field.fieldType === "checkbox") {
            const value = resolveFieldValue(
              field.kbMapping,
              orgProfile,
              requestData,
            );
            if (value === "true" || value === "yes") {
              await page.check(combinedSelector).catch(() => undefined);
            }
          } else {
            const value = resolveFieldValue(
              field.kbMapping,
              orgProfile,
              requestData,
            );
            if (value) {
              // Human-like typing instead of an instant fill.
              await stealth
                .humanType(page, combinedSelector, value)
                .catch(() => undefined);
            }
          }
        }

        // Pre-submission screenshot
        const preBuffer = await page.screenshot({ fullPage: false });
        const prePath = `${this.organizationId}/autoapply/screenshots/${input.funderId}_pre.png`;
        const { error: preErr } = await this.client.storage
          .from(AUTOAPPLY_BUCKET)
          .upload(prePath, preBuffer, {
            contentType: "image/png",
            upsert: true,
          });
        if (!preErr) {
          const { data: preUrlData } = this.client.storage
            .from(AUTOAPPLY_BUCKET)
            .getPublicUrl(prePath);
          preScreenshotUrl = preUrlData.publicUrl ?? null;
        }

        // Human-like click on submit — try typed button first, then text fallback
        const submitted = await stealth
          .humanClick(page, 'button[type="submit"], input[type="submit"]')
          .then(() => true)
          .catch(() => false);
        if (!submitted) {
          await stealth
            .humanClick(
              page,
              'button:has-text("Submit"), button:has-text("Apply"), button:has-text("Send"), button:has-text("Donate")',
            )
            .catch(() => undefined);
        }

        // Wait 5 seconds for the confirmation page to load
        await new Promise<void>((resolve) => setTimeout(resolve, 5_000));

        // Post-submission screenshot
        const postBuffer = await page.screenshot({ fullPage: false });
        const postPath = `${this.organizationId}/autoapply/screenshots/${input.funderId}_post.png`;
        const { error: postErr } = await this.client.storage
          .from(AUTOAPPLY_BUCKET)
          .upload(postPath, postBuffer, {
            contentType: "image/png",
            upsert: true,
          });
        if (!postErr) {
          const { data: postUrlData } = this.client.storage
            .from(AUTOAPPLY_BUCKET)
            .getPublicUrl(postPath);
          postScreenshotUrl = postUrlData.publicUrl ?? null;
        }

        // Extract confirmation number from page text
        const bodyText = (await page.textContent("body")) ?? "";
        const confirmMatch = bodyText.match(
          /(?:confirmation|reference|tracking|application)\s*(?:#|number|no\.?|id)[:\s]*([A-Z0-9\-]{4,20})/i,
        );
        confirmationNumber = confirmMatch?.[1] ?? null;
      } finally {
        for (const tmpPath of tempFiles) {
          try {
            fs.unlinkSync(tmpPath);
          } catch {
            // best-effort temp file cleanup
          }
        }
      }
    } finally {
      await browser.close();
    }

    // Create autoapply_submissions record
    const now = new Date().toISOString();
    const { data: submission, error: submissionError } = await this.client
      .from("autoapply_submissions")
      .insert({
        organization_id: this.organizationId,
        funder_id: input.funderId,
        form_template_id: template.id as string,
        status: "submitted",
        request_description: requestDescription,
        request_amount: input.requestAmount ?? null,
        pre_submit_screenshot_url: preScreenshotUrl,
        confirmation_screenshot_url: postScreenshotUrl,
        confirmation_number: confirmationNumber,
        retry_count: 0,
        submitted_at: now,
      })
      .select("id")
      .single();

    if (submissionError || !submission) {
      throw new AgentError(
        "Failed to save submission record.",
        "write_failed",
      );
    }

    // Update funder last_contacted_at
    await this.client
      .from("funders")
      .update({ last_contacted_at: now, updated_at: now })
      .eq("id", input.funderId)
      .eq("organization_id", this.organizationId);

    return {
      data: {
        submissionId: submission.id as string,
        funderId: input.funderId,
        status: "submitted",
        confirmationNumber,
        preScreenshotUrl,
        postScreenshotUrl,
        requestDescription,
      },
      outputSummary: `AutoApply submitted to "${funder.name as string}". Confirmation: ${confirmationNumber ?? "none extracted"}. Amount: $${input.requestAmount?.toString() ?? "general support"}.`,
      itemsFound: 1,
      itemsProcessed: 1,
      tokensUsed,
    };
  }
}

