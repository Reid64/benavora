"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FormFillerAgent = void 0;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const advanced_field_handler_js_1 = require("./advanced-field-handler.js");
const multi_page_handler_js_1 = require("./multi-page-handler.js");
const document_attacher_js_1 = require("./document-attacher.js");
const document_vault_js_1 = require("./document-vault.js");
const confirmation_parser_js_1 = require("./confirmation-parser.js");
class FormFillerAgent {
    supabase;
    browser;
    claude;
    constructor(supabase, browser) {
        this.supabase = supabase;
        this.browser = browser;
        void this.browser;
        this.claude = new sdk_1.default();
    }
    async fillAndSubmit(options) {
        const { page, template, organizationId, funderId, requestProfile, sessionId } = options;
        void funderId;
        const advancedHandler = new advanced_field_handler_js_1.AdvancedFieldHandler();
        const multiPageHandler = new multi_page_handler_js_1.MultiPageFormHandler();
        const vault = new document_vault_js_1.DocumentVault(this.supabase);
        const attacher = new document_attacher_js_1.DocumentAttacher(advancedHandler);
        const fillData = await this.buildFillData(organizationId, requestProfile);
        const requestDescription = fillData['request.description'] ?? null;
        const orgDocuments = await vault.getAllDocuments(organizationId).catch(() => []);
        const fieldMapping = this.extractFieldMapping(template, requestProfile);
        const allAttachedDocs = [];
        const allUnmatchedUploadFields = [];
        let pagesCompleted = 0;
        let sessionTimedOut = false;
        const multiPageInfo = await multiPageHandler
            .detectMultiPage(page)
            .catch(() => ({ isMultiPage: false, nextButton: undefined }));
        if (multiPageInfo.isMultiPage) {
            let pageNum = 1;
            const maxPages = 20;
            while (pageNum <= maxPages) {
                const sessionActive = await advancedHandler
                    .handleSessionTimeout(page)
                    .catch(() => false);
                if (!sessionActive) {
                    sessionTimedOut = true;
                    await page.reload().catch(() => null);
                    await page.waitForTimeout(2000);
                    const recovered = await advancedHandler
                        .handleSessionTimeout(page)
                        .catch(() => false);
                    if (!recovered)
                        break;
                    sessionTimedOut = false;
                }
                const pageResult = await this.fillPageFields(page, fieldMapping, fillData, advancedHandler, attacher, orgDocuments, vault, requestProfile);
                allAttachedDocs.push(...pageResult.attachedDocs);
                allUnmatchedUploadFields.push(...pageResult.unmatchedFields);
                pagesCompleted++;
                const currentInfo = await multiPageHandler
                    .detectMultiPage(page)
                    .catch(() => ({ isMultiPage: false, nextButton: undefined }));
                if (!currentInfo.isMultiPage || !currentInfo.nextButton)
                    break;
                const navigated = await multiPageHandler
                    .navigateToNextPage(page, currentInfo.nextButton)
                    .catch(() => false);
                if (!navigated) {
                    // Navigation failed — likely a per-page validation error; stop advancing
                    break;
                }
                pageNum++;
            }
        }
        else {
            const sessionActive = await advancedHandler
                .handleSessionTimeout(page)
                .catch(() => true);
            if (!sessionActive) {
                sessionTimedOut = true;
                await page.reload().catch(() => null);
                await page.waitForTimeout(2000);
                const recovered = await advancedHandler
                    .handleSessionTimeout(page)
                    .catch(() => false);
                if (recovered)
                    sessionTimedOut = false;
            }
            if (!sessionTimedOut) {
                const pageResult = await this.fillPageFields(page, fieldMapping, fillData, advancedHandler, attacher, orgDocuments, vault, requestProfile);
                allAttachedDocs.push(...pageResult.attachedDocs);
                allUnmatchedUploadFields.push(...pageResult.unmatchedFields);
                pagesCompleted = 1;
            }
        }
        // Accept terms before submitting
        await advancedHandler.acceptTerms(page).catch(() => false);
        // BEHAVIORAL_CONTRACTS §18: never submit without a human-approved session.
        await this.assertSessionApproved(sessionId, organizationId);
        let confirmationNumber = null;
        let confirmationScreenshot = null;
        try {
            await this.submitForm(page);
            await page.waitForTimeout(3000);
            const confirmData = await (0, confirmation_parser_js_1.parseConfirmationPage)(page).catch(() => null);
            confirmationNumber =
                confirmData?.confirmation_number ?? confirmData?.reference_id ?? null;
        }
        catch {
            // Submission failed; screenshot captures the failure state
        }
        try {
            confirmationScreenshot = (await page.screenshot({ fullPage: false }));
        }
        catch {
            // Best-effort screenshot
        }
        return {
            confirmationNumber,
            requestDescription,
            confirmationScreenshot,
            pagesCompleted,
            attachedDocuments: allAttachedDocs,
            unmatchedUploadFields: allUnmatchedUploadFields,
            sessionTimedOut,
        };
    }
    // ─── Private helpers ───────────────────────────────────────────────────────
    /**
     * Verify the automation session backing this submission is 'approved'
     * before allowing a submit. Queries automation_sessions directly (rather
     * than importing AutomationSessionManager from src/lib/automation/) because
     * this file is compiled as part of the standalone AutoApply worker build,
     * whose tsconfig only includes src/lib/autoapply/** and src/lib/supabase/**
     * — see worker/tsconfig.json.
     */
    async assertSessionApproved(sessionId, organizationId) {
        if (!sessionId) {
            throw new Error('Submission blocked: session not approved');
        }
        const { data, error } = await this.supabase
            .from('automation_sessions')
            .select('status')
            .eq('id', sessionId)
            .eq('organization_id', organizationId)
            .maybeSingle();
        if (error || !data || data.status !== 'approved') {
            throw new Error('Submission blocked: session not approved');
        }
    }
    async buildFillData(organizationId, requestProfile) {
        const fillData = {};
        try {
            const { data: orgData } = await this.supabase
                .from('organizations')
                .select('name')
                .eq('id', organizationId)
                .single();
            const orgRow = orgData;
            if (orgRow?.name)
                fillData['organization.name'] = orgRow.name;
        }
        catch {
            // org lookup failed — continue without it
        }
        let entries = [];
        try {
            const { data: kbData } = await this.supabase
                .from('knowledge_base_entries')
                .select('category, content')
                .eq('organization_id', organizationId);
            entries = kbData ?? [];
        }
        catch {
            // KB lookup failed — continue without entries
        }
        for (const entry of entries) {
            const cat = (entry.category ?? '').toLowerCase();
            const text = entry.content ?? '';
            if (!text)
                continue;
            if (cat.includes('mission') || cat === 'organization_profile') {
                fillData['organization.mission_statement'] ??= text;
            }
            if (cat.includes('vision')) {
                fillData['organization.vision'] ??= text;
            }
            if (cat.includes('program')) {
                const prev = fillData['organization.programs'];
                fillData['organization.programs'] = prev ? `${prev}\n${text}` : text;
            }
            if (cat.includes('ein') || cat.includes('tax_id')) {
                fillData['organization.ein'] ??= text;
            }
            if (cat.includes('address') || cat.includes('location')) {
                fillData['organization.address'] ??= text;
            }
            if (cat.includes('phone') || cat.includes('telephone')) {
                fillData['organization.phone'] ??= text;
            }
            if (cat.includes('website') || cat === 'url') {
                fillData['organization.website'] ??= text;
            }
            if (cat.includes('contact_name') || cat.includes('executive_director')) {
                fillData['organization.contact_name'] ??= text;
            }
            if (cat.includes('contact_email')) {
                fillData['organization.contact_email'] ??= text;
            }
            if (cat.includes('contact_title')) {
                fillData['organization.contact_title'] ??= text;
            }
            if (cat.includes('budget') || cat.includes('annual_budget')) {
                fillData['organization.budget'] ??= text;
            }
            if (cat.includes('staff') || cat.includes('employees')) {
                fillData['organization.staff_count'] ??= text;
            }
            if (cat.includes('year_founded') || cat === 'founded') {
                fillData['organization.year_founded'] ??= text;
            }
            if (cat.includes('service_area') || cat.includes('geography')) {
                fillData['organization.service_area'] ??= text;
            }
        }
        fillData['organization.tax_status'] ??= '501(c)(3) nonprofit organization';
        // Request description driven by request profile when present
        if (requestProfile) {
            fillData['request.description'] = requestProfile.needs_description;
            fillData['request.type'] = requestProfile.request_type;
            fillData['request.narrative'] =
                requestProfile.pitch_template ?? requestProfile.needs_description;
        }
        else {
            const mission = fillData['organization.mission_statement'] ??
                fillData['organization.name'] ??
                'our organization';
            fillData['request.description'] = `We are requesting support for ${mission}`;
            fillData['request.type'] = 'monetary';
            fillData['request.narrative'] = fillData['request.description'] ?? '';
        }
        return fillData;
    }
    extractFieldMapping(template, requestProfile) {
        const raw = template['field_mapping'];
        const base = raw && typeof raw === 'object' && !Array.isArray(raw)
            ? raw
            : {};
        if (requestProfile?.form_field_overrides) {
            return { ...base, ...requestProfile.form_field_overrides };
        }
        return { ...base };
    }
    async fillPageFields(page, fieldMapping, fillData, advancedHandler, attacher, orgDocuments, vault, requestProfile) {
        const attachedDocs = [];
        const unmatchedFields = [];
        let triggerConditional = false;
        // Fill fields present in the stored template mapping
        for (const [benavoraField, selector] of Object.entries(fieldMapping)) {
            const value = fillData[benavoraField];
            if (!value || !selector)
                continue;
            const domInfo = await this.getFieldInfo(page, selector);
            if (domInfo.type === 'file' || domInfo.type === 'hidden')
                continue;
            if (domInfo.type === 'select') {
                const ok = await advancedHandler.fillSelect(page, selector, value).catch(() => false);
                if (ok)
                    triggerConditional = true;
            }
            else if (domInfo.type === 'checkbox') {
                const flag = value.toLowerCase() === 'true' ||
                    value === '1' ||
                    value.toLowerCase() === 'yes';
                await advancedHandler.fillCheckbox(page, selector, flag).catch(() => null);
            }
            else if (domInfo.type === 'radio') {
                await advancedHandler.fillRadio(page, domInfo.name, value).catch(() => null);
                triggerConditional = true;
            }
            else if (domInfo.type === 'date') {
                await advancedHandler.fillDatePicker(page, selector, value).catch(() => null);
            }
            else {
                await page.fill(selector, value).catch(() => null);
            }
        }
        // Wait for any conditionally-revealed fields after select/radio interactions
        if (triggerConditional) {
            await advancedHandler.handleConditionalFields(page).catch(() => null);
        }
        // Fill any visible form fields not covered by the template via Claude
        await this.fillUnmappedFields(page, fieldMapping, fillData, advancedHandler, requestProfile).catch(() => null);
        // Detect and attach documents to upload fields
        const uploadFields = await attacher.detectUploadFields(page).catch(() => []);
        if (uploadFields.length > 0) {
            if (orgDocuments.length > 0) {
                const matches = await attacher
                    .matchDocumentsToFields(uploadFields, orgDocuments)
                    .catch(() => []);
                const results = await attacher
                    .attachDocuments(page, matches, vault)
                    .catch(() => []);
                for (const r of results) {
                    if (r.success)
                        attachedDocs.push(r.documentName);
                }
                const unmatched = attacher.getUnmatchedFields(uploadFields, matches);
                unmatchedFields.push(...unmatched.map((f) => f.label || f.selector));
            }
            else {
                unmatchedFields.push(...uploadFields.map((f) => f.label || f.selector));
            }
        }
        return { attachedDocs, unmatchedFields };
    }
    async getFieldInfo(page, selector) {
        return page
            .evaluate((sel) => {
            const el = document.querySelector(sel);
            if (!el)
                return { type: 'unknown', name: '' };
            const tag = el.tagName.toLowerCase();
            if (tag === 'select')
                return { type: 'select', name: el.name };
            if (tag === 'textarea')
                return { type: 'textarea', name: el.name };
            if (tag === 'input') {
                const inp = el;
                return { type: inp.type || 'text', name: inp.name };
            }
            return { type: 'unknown', name: '' };
        }, selector)
            .then((info) => ({
            type: info.type ?? 'unknown',
            name: info.name ?? '',
        }))
            .catch(() => ({ type: 'unknown', name: '' }));
    }
    async fillUnmappedFields(page, fieldMapping, fillData, advancedHandler, requestProfile) {
        const covered = new Set(Object.values(fieldMapping));
        const visible = await page
            .evaluate(() => {
            const results = [];
            const inputs = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"])' +
                ':not([type="file"]):not([type="checkbox"]):not([type="radio"]),' +
                'select, textarea');
            inputs.forEach((el, idx) => {
                const style = window.getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden')
                    return;
                const inp = el;
                const id = inp.id ? `#${inp.id}` : '';
                const nameAttr = inp.name ? `[name="${inp.name}"]` : '';
                const selector = id || nameAttr || `${el.tagName.toLowerCase()}:nth-of-type(${idx + 1})`;
                const labelEl = inp.id
                    ? document.querySelector(`label[for="${inp.id}"]`)
                    : null;
                const label = labelEl?.textContent?.trim() ??
                    inp.getAttribute('placeholder') ??
                    inp.name ??
                    '';
                const tag = el.tagName.toLowerCase();
                const type = tag === 'select' || tag === 'textarea'
                    ? tag
                    : inp.type || 'text';
                results.push({ selector, label, type, name: inp.name });
            });
            return results;
        })
            .catch(() => []);
        const unhandled = visible.filter((f) => !covered.has(f.selector));
        if (unhandled.length === 0)
            return;
        const fillContext = JSON.stringify(Object.entries(fillData).map(([k, v]) => ({ field: k, value: v.slice(0, 200) })));
        const fieldContext = JSON.stringify(unhandled.map((f) => ({ selector: f.selector, label: f.label, type: f.type })));
        const requestTypeFrame = requestProfile
            ? `This is a ${requestProfile.request_type} request. The request need: ${requestProfile.needs_description.slice(0, 300)}.`
            : 'This is a general monetary donation request.';
        const message = await this.claude.messages
            .create({
            model: 'claude-sonnet-4-6',
            max_tokens: 1024,
            messages: [
                {
                    role: 'user',
                    content: `You are filling out a nonprofit funding request form. ${requestTypeFrame}\n` +
                        `Match each visible form field to the best available data value.\n` +
                        `Available data: ${fillContext}\n` +
                        `Visible form fields: ${fieldContext}\n` +
                        `Reply ONLY with valid JSON array (no markdown): [{"selector":"...","value":"..."}]. ` +
                        `Only include fields that have relevant data. Skip file, checkbox, and radio fields.`,
                },
            ],
        })
            .catch(() => null);
        if (!message)
            return;
        const raw = message.content[0]?.type === 'text' ? message.content[0].text : '';
        try {
            const jsonMatch = raw.match(/\[[\s\S]*\]/);
            if (!jsonMatch)
                return;
            const mappings = JSON.parse(jsonMatch[0]);
            for (const { selector, value } of mappings) {
                if (!selector || !value)
                    continue;
                const info = await this.getFieldInfo(page, selector);
                if (info.type === 'select') {
                    await advancedHandler.fillSelect(page, selector, value).catch(() => null);
                    await advancedHandler.handleConditionalFields(page).catch(() => null);
                }
                else if (info.type === 'radio') {
                    await advancedHandler.fillRadio(page, info.name, value).catch(() => null);
                }
                else {
                    await page.fill(selector, value).catch(() => null);
                }
            }
        }
        catch {
            // Claude response unparseable — continue without filling unmapped fields
        }
    }
    async submitForm(page) {
        const explicitSelectors = [
            'input[type="submit"]',
            'button[type="submit"]',
        ];
        for (const sel of explicitSelectors) {
            const el = await page.$(sel);
            if (el) {
                await el.click();
                return;
            }
        }
        // Fall back to text-match on any visible button
        const btn = page
            .locator('button')
            .filter({ hasText: /submit|send application|apply now|send request/i })
            .first();
        if ((await btn.count()) > 0) {
            await btn.click();
        }
    }
}
exports.FormFillerAgent = FormFillerAgent;
