"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DocumentAttacher = void 0;
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const LABEL_KEYWORD_MAP = [
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
function matchByKeywords(label) {
    const lower = label.toLowerCase();
    for (const { keywords, docType } of LABEL_KEYWORD_MAP) {
        if (keywords.some((kw) => lower.includes(kw))) {
            return docType;
        }
    }
    return null;
}
class DocumentAttacher {
    advancedFieldHandler;
    anthropic;
    constructor(advancedFieldHandler, apiKey) {
        this.advancedFieldHandler = advancedFieldHandler;
        this.anthropic = new sdk_1.default({ apiKey });
    }
    async detectUploadFields(page) {
        const p = page;
        const rawFields = await p.evaluate(() => {
            const results = [];
            const inputs = document.querySelectorAll('input[type="file"], .file-upload, .dropzone, [data-upload]');
            inputs.forEach((el, idx) => {
                const inputEl = el;
                const id = inputEl.id ?? "";
                const name = inputEl.name ?? "";
                let label = "";
                if (id) {
                    const lbl = document.querySelector(`label[for="${id}"]`);
                    if (lbl)
                        label = lbl.textContent?.trim() ?? "";
                }
                if (!label) {
                    const parentLabel = el.closest("label");
                    if (parentLabel)
                        label = parentLabel.textContent?.trim() ?? "";
                }
                if (!label) {
                    const wrapper = el.closest("div, fieldset, section");
                    if (wrapper) {
                        const heading = wrapper.querySelector("label, legend, h3, h4, p, span");
                        label = heading?.textContent?.trim() ?? "";
                    }
                }
                if (!label && name)
                    label = name;
                const nearby = el.parentElement?.textContent?.trim().slice(0, 200) ?? "";
                let selector = "";
                if (id) {
                    selector = `#${id}`;
                }
                else if (inputEl.className) {
                    selector = `.${inputEl.className.trim().split(/\s+/)[0] ?? "file-input"}`;
                }
                else {
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
        const fields = await Promise.all(rawFields.map(async (raw) => {
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
                const response = await this.anthropic.messages.create({
                    model: "claude-sonnet-4-6",
                    max_tokens: 256,
                    messages: [
                        {
                            role: "user",
                            content: `You are analyzing a file upload field on a nonprofit grant application form.\n${context}\n\nWhich document type does this field expect? Reply with ONLY one of these exact strings (no explanation):\n501c3_letter, form_990, board_list, project_budget, financial_statements, annual_report, organizational_chart, letters_of_support, insurance_certificate, other`,
                        },
                    ],
                });
                const content = response.content[0];
                const docType = content?.type === "text" ? content.text.trim() : "other";
                return {
                    selector: raw.selector,
                    label: raw.label || raw.selector,
                    expectedDocType: docType,
                    acceptedFormats,
                    required: raw.required,
                };
            }
            catch {
                return {
                    selector: raw.selector,
                    label: raw.label || raw.selector,
                    expectedDocType: "other",
                    acceptedFormats,
                    required: raw.required,
                };
            }
        }));
        return fields;
    }
    async matchDocumentsToFields(uploadFields, orgDocuments) {
        const docsByType = new Map();
        for (const doc of orgDocuments) {
            docsByType.set(doc.document_type, doc);
        }
        const matches = await Promise.all(uploadFields.map(async (field) => {
            const direct = docsByType.get(field.expectedDocType);
            if (direct) {
                return { field, matchedDocument: direct, confidence: 0.95, status: "matched" };
            }
            if (orgDocuments.length === 0) {
                return { field, matchedDocument: null, confidence: 0, status: "unmatched" };
            }
            const availableTypes = orgDocuments.map((d) => d.document_type).join(", ");
            try {
                const response = await this.anthropic.messages.create({
                    model: "claude-sonnet-4-6",
                    max_tokens: 64,
                    messages: [
                        {
                            role: "user",
                            content: `This upload field is labeled "${field.label}" and expects a document of type "${field.expectedDocType}". Which of these available document types is the best match: ${availableTypes}?\n\nReply with ONLY the exact document type string from the list, or "none" if none match.`,
                        },
                    ],
                });
                const content = response.content[0];
                const chosen = content?.type === "text" ? content.text.trim() : "none";
                if (chosen !== "none") {
                    const matchedDoc = orgDocuments.find((d) => d.document_type === chosen) ?? null;
                    if (matchedDoc) {
                        return { field, matchedDocument: matchedDoc, confidence: 0.7, status: "matched" };
                    }
                }
            }
            catch {
                // fall through to unmatched
            }
            return { field, matchedDocument: null, confidence: 0, status: "unmatched" };
        }));
        return matches;
    }
    async attachDocuments(page, matches, vault) {
        const p = page;
        const results = [];
        for (const match of matches) {
            if (!match.matchedDocument)
                continue;
            const doc = match.matchedDocument;
            const fieldLabel = match.field.label;
            let tmpPath = null;
            try {
                const buffer = await vault.getDocumentBuffer(doc.storage_path);
                const ext = path.extname(doc.file_name) || ".bin";
                tmpPath = path.join(os.tmpdir(), `benavora-attach-${doc.id}${ext}`);
                fs.writeFileSync(tmpPath, buffer);
                const success = await this.advancedFieldHandler.fillFileUpload(p, match.field.selector, tmpPath);
                if (success) {
                    results.push({ fieldLabel, documentName: doc.file_name, success: true });
                }
                else {
                    results.push({
                        fieldLabel,
                        documentName: doc.file_name,
                        success: false,
                        error: "fillFileUpload returned false — selector may not be interactable",
                    });
                }
            }
            catch (err) {
                results.push({
                    fieldLabel,
                    documentName: doc.file_name,
                    success: false,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
            finally {
                if (tmpPath) {
                    try {
                        fs.unlinkSync(tmpPath);
                    }
                    catch {
                        // best-effort cleanup
                    }
                }
            }
        }
        return results;
    }
    getUnmatchedFields(uploadFields, matches) {
        const matchedSelectors = new Set(matches.filter((m) => m.status === "matched").map((m) => m.field.selector));
        return uploadFields.filter((f) => !matchedSelectors.has(f.selector));
    }
}
exports.DocumentAttacher = DocumentAttacher;
