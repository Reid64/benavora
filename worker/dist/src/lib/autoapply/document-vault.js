"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DocumentVault = exports.DOCUMENT_TYPES = void 0;
const STORAGE_BUCKET = "org-documents";
exports.DOCUMENT_TYPES = {
    TAX_EXEMPTION: "501c3_letter",
    FORM_990: "form_990",
    BOARD_LIST: "board_list",
    PROJECT_BUDGET: "project_budget",
    FINANCIAL_STATEMENTS: "financial_statements",
    ANNUAL_REPORT: "annual_report",
    ORG_CHART: "organizational_chart",
    LETTERS_OF_SUPPORT: "letters_of_support",
    INSURANCE_CERT: "insurance_certificate",
    OTHER: "other",
};
const ALL_STANDARD_TYPES = [
    "501c3_letter",
    "form_990",
    "board_list",
    "project_budget",
    "financial_statements",
    "annual_report",
    "organizational_chart",
    "letters_of_support",
    "insurance_certificate",
    "other",
];
const REQUIRED_TYPES = ["501c3_letter", "form_990"];
class DocumentVault {
    supabase;
    constructor(supabase) {
        this.supabase = supabase;
    }
    async uploadDocument(params) {
        const { orgId, documentType, file, fileName, mimeType, uploadedBy, expiresAt } = params;
        const storagePath = `${orgId}/${documentType}/${fileName}`;
        const { error: uploadError } = await this.supabase.storage
            .from(STORAGE_BUCKET)
            .upload(storagePath, file, { contentType: mimeType, upsert: true });
        if (uploadError) {
            throw new Error(`Storage upload failed: ${uploadError.message}`);
        }
        // Retire any existing current document of this type before inserting the new one.
        await this.supabase
            .from("org_documents")
            .update({ is_current: false })
            .eq("organization_id", orgId)
            .eq("document_type", documentType)
            .eq("is_current", true);
        const { data, error: insertError } = await this.supabase
            .from("org_documents")
            .insert({
            organization_id: orgId,
            document_type: documentType,
            file_name: fileName,
            storage_path: storagePath,
            mime_type: mimeType,
            file_size: file.length,
            uploaded_by: uploadedBy ?? null,
            expires_at: expiresAt ?? null,
            is_current: true,
        })
            .select("id")
            .single();
        if (insertError || !data) {
            throw new Error(`Database insert failed: ${insertError?.message ?? "no data returned"}`);
        }
        return data.id;
    }
    async getDocument(orgId, documentType) {
        const { data } = await this.supabase
            .from("org_documents")
            .select("*")
            .eq("organization_id", orgId)
            .eq("document_type", documentType)
            .eq("is_current", true)
            .single();
        return data ?? null;
    }
    async getDocumentBuffer(storagePath) {
        const { data, error } = await this.supabase.storage
            .from(STORAGE_BUCKET)
            .download(storagePath);
        if (error || !data) {
            throw new Error(`Storage download failed: ${error?.message ?? "no data returned"}`);
        }
        return Buffer.from(await data.arrayBuffer());
    }
    async getAllDocuments(orgId) {
        const { data } = await this.supabase
            .from("org_documents")
            .select("*")
            .eq("organization_id", orgId)
            .eq("is_current", true)
            .order("document_type");
        return data ?? [];
    }
    async getReadinessReport(orgId) {
        const docs = await this.getAllDocuments(orgId);
        const now = new Date().toISOString();
        const presentByType = new Map();
        for (const doc of docs) {
            presentByType.set(doc.document_type, doc);
        }
        const expired = ALL_STANDARD_TYPES.filter((t) => {
            const doc = presentByType.get(t);
            return doc?.expires_at != null && doc.expires_at < now;
        });
        const expiredSet = new Set(expired);
        const missing = ALL_STANDARD_TYPES.filter((t) => !presentByType.has(t));
        const validCount = ALL_STANDARD_TYPES.filter((t) => presentByType.has(t) && !expiredSet.has(t)).length;
        const score = Math.round((validCount / ALL_STANDARD_TYPES.length) * 100);
        const ready = REQUIRED_TYPES.every((t) => presentByType.has(t) && !expiredSet.has(t));
        return { ready, missing, expired, score };
    }
}
exports.DocumentVault = DocumentVault;
