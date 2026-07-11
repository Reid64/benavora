"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COMPLIANCE_MATRIX = void 0;
exports.checkDocumentCompliance = checkDocumentCompliance;
exports.COMPLIANCE_MATRIX = {
    monetary: {
        required: ['501c3_letter', 'form_990'],
        recommended: ['board_list', 'project_budget', 'financial_statements'],
        freshness: { form_990: 365, financial_statements: 365, board_list: 180 },
    },
    land: {
        required: ['501c3_letter', 'form_990', 'project_budget'],
        recommended: ['insurance_certificate'],
        freshness: { form_990: 365 },
    },
    in_kind: {
        required: ['501c3_letter'],
        recommended: ['form_990'],
        freshness: { form_990: 365 },
    },
    volunteer: {
        required: ['501c3_letter'],
        recommended: [],
        freshness: {},
    },
    service: {
        required: ['501c3_letter'],
        recommended: ['form_990'],
        freshness: { form_990: 365 },
    },
    partnership: {
        required: ['501c3_letter'],
        recommended: ['annual_report'],
        freshness: {},
    },
    sponsorship: {
        required: ['501c3_letter'],
        recommended: ['annual_report'],
        freshness: {},
    },
    facility: {
        required: ['501c3_letter', 'insurance_certificate'],
        recommended: ['form_990'],
        freshness: { insurance_certificate: 365 },
    },
};
/**
 * Check whether an org's uploaded documents satisfy compliance requirements for
 * a given request type.
 *
 * @param requestType   - One of the keys in COMPLIANCE_MATRIX (e.g. 'monetary').
 * @param orgDocuments  - Documents fetched for the org (is_current=true rows).
 * @param callerOrgId   - When provided, documents belonging to a different org are
 *                        filtered out to prevent cross-tenant data leakage.
 */
function checkDocumentCompliance(requestType, orgDocuments, callerOrgId) {
    const missing_required = [];
    const stale_documents = [];
    const warnings = [];
    const rule = exports.COMPLIANCE_MATRIX[requestType];
    if (!rule) {
        warnings.push(`Unknown request_type '${requestType}' — no compliance matrix entry`);
        return { compliant: false, missing_required, stale_documents, warnings };
    }
    // Cross-tenant guard: exclude docs owned by a different org.
    const docs = callerOrgId
        ? orgDocuments.filter((d) => d.organization_id === callerOrgId)
        : orgDocuments;
    if (callerOrgId && docs.length < orgDocuments.length) {
        warnings.push('Some documents excluded due to cross-tenant ownership mismatch');
    }
    // Build lookup: document_type → current document (only is_current ones).
    const byType = new Map();
    for (const doc of docs) {
        if (doc.is_current) {
            byType.set(doc.document_type, doc);
        }
    }
    const nowMs = Date.now();
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    const isStale = (doc, docType) => {
        const freshnessDays = rule.freshness[docType];
        if (!freshnessDays)
            return false;
        const uploadedAtMs = new Date(doc.created_at).getTime();
        return nowMs - uploadedAtMs > freshnessDays * MS_PER_DAY;
    };
    for (const docType of rule.required) {
        const doc = byType.get(docType);
        if (!doc) {
            missing_required.push(docType);
        }
        else if (isStale(doc, docType)) {
            stale_documents.push(docType);
        }
    }
    for (const docType of rule.recommended) {
        const doc = byType.get(docType);
        if (!doc) {
            warnings.push(`Recommended document missing: ${docType}`);
        }
        else if (isStale(doc, docType)) {
            stale_documents.push(docType);
            warnings.push(`Recommended document stale: ${docType}`);
        }
    }
    // compliant only when no required docs are missing AND no required docs are stale
    const requiredStale = stale_documents.filter((d) => rule.required.includes(d));
    const compliant = missing_required.length === 0 && requiredStale.length === 0;
    return { compliant, missing_required, stale_documents, warnings };
}
