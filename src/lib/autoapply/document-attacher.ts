import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { withClaudeLimit } from "./claude-concurrency";
import type { AdvancedFieldHandler } from "./advanced-field-handler";
import type { DocumentVault, OrgDocument } from "./document-vault";

export { OrgDocument };

export interface UploadField {
  selector: string;
  label: string;
  expectedDocType: string;
  acceptedFormats: string[];
  required: boolean;
}

export interface DocumentMatch {
  field: UploadField;
  matchedDocument: OrgDocument | null;
  confidence: number;
  status: "matched" | "unmatched";
}

export interface AttachmentResult {
  fieldLabel: string;
  documentName: string;
  success: boolean;
  error?: string;
}

const LABEL_KEYWORD_MAP: Array<{ keywords: string[]; docType: string }> = [
  { keywords: ["501c3", "501(c)(3)", "tax exempt", "tax exemption", "irs determination"], docType: "501c3_letter" },
  { keywords: ["990", "form 990", "tax return", "annual tax"], docType: "form_990" },
  { keywords: ["board", "board list", "board of directors", "board members", "trustees"], docType: "board_list" },
  { keywords: ["budget", "project budget", "program budget", "proposed budget"], docType: "project_budget" },
  { keywords: ["financial", "financial statements", "balance sheet", "income statement", "audit"], docType: "financial_statements" },
  { keywords: ["annual report", "year in review"], docType: "annual_report" },
  { keywords: ["org chart", "organizational chart", "organization chart", "staff chart"], docType: "organizational_chart" },
  { keywords: ["letter of support", "letters of support", "support letter", "reference letter"], docType: "letters_of_support" },
  { keywords: ["insurance", "certificate of insurance", "liability"], docType: "insurance_certificate" },
];

function matchByKeywords(label: string): string | null {
  const lower = label.toLowerCase();
  for (const { keywords, docType } of LABEL_KEYWORD_MAP) {
    if (keywords.some((kw) => lower.includes(kw))) {
      return docType;
    }
  }
  return null;
}

export class DocumentAttacher {
  private readonly anthropic: Anthropic;

  constructor(
    private readonly advancedFieldHandler: AdvancedFieldHandler,
    apiKey?: string,
  ) {
    this.anthropic = new Anthropic({ apiKey });
  }

  async detectUploadFields(page: unknown): Promise<UploadField[]> {
    const p = page as import("playwright").Page;

    type RawField = {
      selector: string;
      label: string;
      acceptAttr: string;
      nearbyText: string;
      required: boolean;
    };

    const rawFields: RawField[] = await p.evaluate(() => {
      const results: RawField[] = [];
      const inputs = document.querySelectorAll<HTMLElement>(
        'input[type="file"], .file-upload, .dropzone, [data-upload]',
      );

      inputs.forEach((el, idx) => {
        const inputEl = el as HTMLInputElement;
        const id = inputEl.id ?? "";
        const name = inputEl.name ?? "";

        let label = "";
        if (id) {
          const lbl = document.querySelector<HTMLLabelElement>(`label[for="${id}"]`);
          if (lbl) label = lbl.textContent?.trim() ?? "";
        }
        if (!label) {
          const parentLabel = el.closest("label");
          if (parentLabel) label = parentLabel.textContent?.trim() ?? "";
        }
        if (!label) {
          const wrapper = el.closest("div, fieldset, section");
          if (wrapper) {
            const heading = wrapper.querySelector("label, legend, h3, h4, p, span");
            label = heading?.textContent?.trim() ?? "";
          }
        }
        if (!label && name) label = name;

        const nearby = el.parentElement?.textContent?.trim().slice(0, 200) ?? "";

        let selector = "";
        if (id) {
          selector = `#${id}`;
        } else if (inputEl.className) {
          selector = `.${inputEl.className.trim().split(/\s+/)[0] ?? "file-input"}`;
        } else {
          selector = `input[type="file"]:nth-of-type(${idx + 1})`;
        }

        results.push({
          selector,
          label,
          acceptAttr: inputEl.accept ?? "",
          nearbyText: nearby,
          required: inputEl.required,
        });
      });

      return results;
    });

    const fields: UploadField[] = await Promise.all(
      rawFields.map(async (raw) => {
        const acceptedFormats = raw.acceptAttr
          ? raw.acceptAttr.split(",").map((s) => s.trim()).filter(Boolean)
          : [];

        const keywordMatch = matchByKeywords(raw.label + " " + raw.nearbyText);
        if (keywordMatch) {
          return {
            selector: raw.selector,
            label: raw.label || raw.selector,
            expectedDocType: keywordMatch,
            acceptedFormats,
            required: raw.required,
          };
        }

        const context = `Field label: "${raw.label}"\nNearby text: "${raw.nearbyText}"\nAccepted file types: "${raw.acceptAttr}"`;
        try {
          const response = await withClaudeLimit(() =>
            this.anthropic.messages.create({
              model: "claude-sonnet-4-6",
              max_tokens: 256,
              messages: [
                {
                  role: "user",
                  content: `You are analyzing a file upload field on a nonprofit grant application form.\n${context}\n\nWhich document type does this field expect? Reply with ONLY one of these exact strings (no explanation):\n501c3_letter, form_990, board_list, project_budget, financial_statements, annual_report, organizational_chart, letters_of_support, insurance_certificate, other`,
                },
              ],
            }),
          );
          const content = response.content[0];
          const docType = content?.type === "text" ? content.text.trim() : "other";
          return {
            selector: raw.selector,
            label: raw.label || raw.selector,
            expectedDocType: docType,
            acceptedFormats,
            required: raw.required,
          };
        } catch {
          return {
            selector: raw.selector,
            label: raw.label || raw.selector,
            expectedDocType: "other",
            acceptedFormats,
            required: raw.required,
          };
        }
      }),
    );

    return fields;
  }

  async matchDocumentsToFields(
    uploadFields: UploadField[],
    orgDocuments: OrgDocument[],
  ): Promise<DocumentMatch[]> {
    const docsByType = new Map<string, OrgDocument>();
    for (const doc of orgDocuments) {
      docsByType.set(doc.document_type, doc);
    }

    const matches: DocumentMatch[] = await Promise.all(
      uploadFields.map(async (field): Promise<DocumentMatch> => {
        const direct = docsByType.get(field.expectedDocType);
        if (direct) {
          return { field, matchedDocument: direct, confidence: 0.95, status: "matched" };
        }

        if (orgDocuments.length === 0) {
          return { field, matchedDocument: null, confidence: 0, status: "unmatched" };
        }

        const availableTypes = orgDocuments.map((d) => d.document_type).join(", ");
        try {
          const response = await withClaudeLimit(() =>
            this.anthropic.messages.create({
              model: "claude-sonnet-4-6",
              max_tokens: 64,
              messages: [
                {
                  role: "user",
                  content: `This upload field is labeled "${field.label}" and expects a document of type "${field.expectedDocType}". Which of these available document types is the best match: ${availableTypes}?\n\nReply with ONLY the exact document type string from the list, or "none" if none match.`,
                },
              ],
            }),
          );
          const content = response.content[0];
          const chosen = content?.type === "text" ? content.text.trim() : "none";

          if (chosen !== "none") {
            const matchedDoc = orgDocuments.find((d) => d.document_type === chosen) ?? null;
            if (matchedDoc) {
              return { field, matchedDocument: matchedDoc, confidence: 0.7, status: "matched" };
            }
          }
        } catch {
          // fall through to unmatched
        }

        return { field, matchedDocument: null, confidence: 0, status: "unmatched" };
      }),
    );

    return matches;
  }

  async attachDocuments(
    page: unknown,
    matches: DocumentMatch[],
    vault: DocumentVault,
  ): Promise<AttachmentResult[]> {
    const p = page as import("playwright").Page;
    const results: AttachmentResult[] = [];

    for (const match of matches) {
      if (!match.matchedDocument) continue;

      const doc = match.matchedDocument;
      const fieldLabel = match.field.label;
      let tmpPath: string | null = null;

      try {
        const buffer = await vault.getDocumentBuffer(doc.storage_path);
        const ext = path.extname(doc.file_name) || ".bin";
        tmpPath = path.join(os.tmpdir(), `benavora-attach-${doc.id}${ext}`);
        fs.writeFileSync(tmpPath, buffer);

        const success = await this.advancedFieldHandler.fillFileUpload(p, match.field.selector, tmpPath);

        if (success) {
          results.push({ fieldLabel, documentName: doc.file_name, success: true });
        } else {
          results.push({
            fieldLabel,
            documentName: doc.file_name,
            success: false,
            error: "fillFileUpload returned false — selector may not be interactable",
          });
        }
      } catch (err) {
        results.push({
          fieldLabel,
          documentName: doc.file_name,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        if (tmpPath) {
          try {
            fs.unlinkSync(tmpPath);
          } catch {
            // best-effort cleanup
          }
        }
      }
    }

    return results;
  }

  getUnmatchedFields(uploadFields: UploadField[], matches: DocumentMatch[]): UploadField[] {
    const matchedSelectors = new Set(
      matches.filter((m) => m.status === "matched").map((m) => m.field.selector),
    );
    return uploadFields.filter((f) => !matchedSelectors.has(f.selector));
  }
}
