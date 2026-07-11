"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SubmissionValidator = void 0;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const EIN_RE = /^\d{2}-\d{7}$/;
const DIGITS_RE = /\D/g;
const ZIP5_RE = /^\d{5}$/;
const ZIP9_RE = /^\d{9}$/;
function labelContains(field, ...terms) {
    const haystack = `${field.fieldLabel} ${field.fieldName}`.toLowerCase();
    return terms.some((t) => haystack.includes(t));
}
function validateFieldFormat(field, value) {
    const v = value.trim();
    if (labelContains(field, "ein", "employer identification", "tax id", "tax-id", "taxid")) {
        if (!EIN_RE.test(v)) {
            return { error: "EIN must be in XX-XXXXXXX format (e.g. 12-3456789)" };
        }
    }
    if (labelContains(field, "phone", "tel", "telephone", "mobile", "cell", "fax")) {
        const digits = v.replace(DIGITS_RE, "");
        if (digits.length < 10) {
            return { error: "Phone number must contain at least 10 digits" };
        }
    }
    if (field.fieldName.toLowerCase().includes("email") ||
        labelContains(field, "email", "e-mail")) {
        if (!v.includes("@") || !v.includes(".")) {
            return { error: "Email address must contain @ and a domain (e.g. name@example.org)" };
        }
    }
    if (labelContains(field, "url", "website", "web site", "homepage", "portal")) {
        if (!v.startsWith("http://") && !v.startsWith("https://")) {
            return { error: "URL must start with http:// or https://" };
        }
    }
    if (labelContains(field, "zip", "postal", "zip code", "zipcode")) {
        const digits = v.replace(DIGITS_RE, "");
        if (!ZIP5_RE.test(digits) && !ZIP9_RE.test(digits)) {
            return { error: "ZIP code must be 5 or 9 digits (e.g. 78701 or 787014321)" };
        }
    }
    if (labelContains(field, "date", "deadline", "due date", "expir", "effective") &&
        !labelContains(field, "update", "created")) {
        const d = new Date(v);
        if (isNaN(d.getTime())) {
            return { error: `"${v}" is not a valid date` };
        }
    }
    return {};
}
let _client = null;
function getClaude() {
    if (!_client) {
        const apiKey = process.env["ANTHROPIC_API_KEY"];
        if (!apiKey)
            throw new Error("ANTHROPIC_API_KEY is not set");
        _client = new sdk_1.default({ apiKey });
    }
    return _client;
}
class SubmissionValidator {
    async validateFormData(formFields, fieldValues, _orgData) {
        const errors = [];
        const warnings = [];
        for (const field of formFields) {
            const value = fieldValues[field.fieldName] ?? fieldValues[field.selector] ?? "";
            if (field.required && value.trim() === "") {
                errors.push({
                    field: field.fieldLabel || field.fieldName,
                    message: `"${field.fieldLabel || field.fieldName}" is required`,
                });
                continue;
            }
            if (value.trim() === "")
                continue;
            const { error, warning } = validateFieldFormat(field, value);
            if (error) {
                errors.push({ field: field.fieldLabel || field.fieldName, message: error });
            }
            else if (warning) {
                warnings.push({ field: field.fieldLabel || field.fieldName, message: warning });
            }
        }
        return { valid: errors.length === 0, errors, warnings };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async checkOrgReadiness(orgId, supabase) {
        const missing_required = [];
        const missing_recommended = [];
        const blockers = [];
        // --- KB completeness: query organizations table ---
        const { data: org } = await supabase
            .from("organizations")
            .select("mission_statement, ein, address_line1, contact_name, contact_email, phone")
            .eq("id", orgId)
            .single();
        const kbRequired = [
            ["mission_statement", "Mission statement"],
            ["ein", "EIN (Employer Identification Number)"],
            ["address_line1", "Organization address"],
            ["contact_name", "Primary contact name"],
            ["contact_email", "Primary contact email"],
        ];
        const kbRecommended = [
            ["phone", "Organization phone number"],
        ];
        const orgRow = (org ?? {});
        for (const [key, label] of kbRequired) {
            const val = orgRow[key];
            if (!val || String(val).trim() === "") {
                missing_required.push(label);
            }
        }
        for (const [key, label] of kbRecommended) {
            const val = orgRow[key];
            if (!val || String(val).trim() === "") {
                missing_recommended.push(label);
            }
        }
        // Check programs (recommended)
        const { data: programs } = await supabase
            .from("programs")
            .select("id")
            .eq("organization_id", orgId);
        if (!programs || programs.length === 0) {
            missing_recommended.push("Program descriptions");
        }
        // --- Document vault check ---
        const { data: docs } = await supabase
            .from("org_documents")
            .select("document_type")
            .eq("organization_id", orgId)
            .eq("is_current", true);
        const presentDocs = new Set((docs ?? []).map((d) => d.document_type));
        const docRequired = [
            ["501c3_letter", "501(c)(3) determination letter"],
            ["form_990", "IRS Form 990"],
        ];
        const docRecommended = [
            ["board_list", "Board member list"],
        ];
        for (const [type, label] of docRequired) {
            if (!presentDocs.has(type)) {
                missing_required.push(label);
            }
        }
        for (const [type, label] of docRecommended) {
            if (!presentDocs.has(type)) {
                missing_recommended.push(label);
            }
        }
        // --- Active request profiles ---
        const { data: profiles } = await supabase
            .from("request_profiles")
            .select("id")
            .eq("organization_id", orgId)
            .eq("active", true);
        if (!profiles || profiles.length === 0) {
            missing_required.push("At least one active request profile");
            blockers.push("No active request profiles — AutoApply cannot determine what to request from funders");
        }
        // Required KB or doc gaps are also blockers
        if (missing_required.some((m) => m !== "At least one active request profile")) {
            blockers.push("Required organization information is incomplete — form filling will produce inaccurate submissions");
        }
        const ready = missing_required.length === 0;
        // Score: required items worth 70 pts, recommended worth 30 pts
        const totalRequired = kbRequired.length + docRequired.length + 1; // +1 for profiles
        const totalRecommended = kbRecommended.length + 1 + docRecommended.length; // +1 for programs
        const metRequired = totalRequired - missing_required.length;
        const metRecommended = totalRecommended - missing_recommended.length;
        const score = Math.round((metRequired / totalRequired) * 70 + (metRecommended / totalRecommended) * 30);
        return {
            ready,
            score: Math.max(0, Math.min(100, score)),
            missing_required,
            missing_recommended,
            blockers,
        };
    }
    async detectExistingSubmission(page) {
        const p = page;
        let pageText = "";
        try {
            pageText = await p.evaluate(() => document.body?.innerText ?? "");
        }
        catch {
            return { hasPending: false };
        }
        if (!pageText.trim()) {
            return { hasPending: false };
        }
        const claude = getClaude();
        const response = await claude.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: 256,
            messages: [
                {
                    role: "user",
                    content: `Does the following web page text show any indication that a donation or grant request from this organization is already pending, under review, or has already been submitted? Look for phrases like "You have a pending request", "Already submitted", "Your application is under review", "Duplicate submission detected", or similar.

Respond with JSON only: { "hasPending": true/false, "message": "<the exact phrase found, or null>" }

Page text:
${pageText.slice(0, 4000)}`,
                },
            ],
        });
        const raw = response.content[0]?.type === "text" ? response.content[0].text : "";
        try {
            const jsonMatch = raw.match(/\{[\s\S]*\}/);
            if (!jsonMatch)
                return { hasPending: false };
            const parsed = JSON.parse(jsonMatch[0]);
            return {
                hasPending: parsed.hasPending === true,
                message: parsed.message ?? undefined,
            };
        }
        catch {
            return { hasPending: false };
        }
    }
}
exports.SubmissionValidator = SubmissionValidator;
