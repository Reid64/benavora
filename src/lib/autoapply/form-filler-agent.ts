import type { SupabaseClient } from '@supabase/supabase-js';
import type { Page } from 'playwright';
import Anthropic from '@anthropic-ai/sdk';
import type { StealthBrowser } from './stealth-browser.js';
import { AdvancedFieldHandler } from './advanced-field-handler.js';
import { MultiPageFormHandler } from './multi-page-handler.js';
import { DocumentAttacher } from './document-attacher.js';
import { DocumentVault } from './document-vault.js';
import type { OrgDocument } from './document-vault.js';
import { parseConfirmationPage } from './confirmation-parser.js';
import { CaptchaSolver } from './captcha-solver.js';
import type { CaptchaDetection } from './captcha-solver.js';
import { ScreenshotManager } from './screenshot-manager.js';
import { WebhookNotifier } from './webhook-notifier.js';

/** agent_runs.agent_type value for this module (AR-1.2). */
export const AGENT_TYPE = 'autoapply_form_filler';

export interface RequestProfile {
  request_type: string;
  name: string;
  needs_description: string;
  pitch_template?: string | null;
  form_field_overrides?: Record<string, string>;
}

export interface DossierRiskFactor {
  factor: string;
  mitigation?: string | null;
}

export interface DossierContext {
  /** pil_prospect_dossiers.id — used to fetch that row's `dossier` jsonb for fieldMappings resolution. */
  dossierId?: string;
  /** benavoraField (e.g. "request.narrative") -> dot path into the dossier's jsonb `dossier` column. */
  fieldMappings?: Record<string, string>;
  /** Funder-tailored pitch text (e.g. from pitch-personalizer); takes priority over requestProfile.pitch_template. */
  personalizedPitch?: string;
  riskFactors?: DossierRiskFactor[];
  successProbability?: number;
}

/**
 * Thrown when dossier risk factors mean this submission should be postponed
 * rather than attempted. Mirrors the SkipError/CaptchaPauseError pattern the
 * worker (worker/queue-processor.ts) already special-cases in its catch
 * block — the worker needs an equivalent `instanceof DeferredSubmissionError`
 * branch there to persist a non-failure status; without it this still
 * surfaces as a generic failed attempt via the existing catch-all.
 */
export class DeferredSubmissionError extends Error {
  constructor(
    public readonly reason: string,
    message: string,
  ) {
    super(message);
    this.name = 'DeferredSubmissionError';
  }
}

export interface FillOptions {
  page: Page;
  template: Record<string, unknown>;
  organizationId: string;
  funderId: string;
  requestProfile?: RequestProfile;
  /** Prospect-dossier intelligence (field mappings, tailored pitch, risk factors) layered on top of KB/org data. */
  dossierContext?: DossierContext;
  /**
   * Id of the automation_sessions row gating this submission
   * (BEHAVIORAL_CONTRACTS §18: automation pauses at `awaiting_approval` and only
   * a human's approve() can advance it to `approved`). fillAndSubmit() verifies
   * this session's status is 'approved' immediately before submitting and
   * throws otherwise — there is no bypass. Omitting sessionId is treated the
   * same as an unapproved session: submission is blocked.
   */
  sessionId?: string;
}

export interface FillResult {
  confirmationNumber: string | null;
  requestDescription: string | null;
  confirmationScreenshot: Buffer | null;
  pagesCompleted?: number;
  attachedDocuments?: string[];
  unmatchedUploadFields?: string[];
  sessionTimedOut?: boolean;
  captchaEncountered: boolean;
  captchaSolved: boolean;
  /** Passed through from dossierContext.successProbability, if supplied, for the caller to persist. */
  successProbability?: number | null;
}

type FieldType =
  | 'text'
  | 'email'
  | 'tel'
  | 'url'
  | 'number'
  | 'textarea'
  | 'select'
  | 'checkbox'
  | 'radio'
  | 'date'
  | 'file'
  | 'hidden'
  | 'unknown';

interface DomFieldInfo {
  type: FieldType;
  name: string;
}

interface PageFillResult {
  attachedDocs: string[];
  unmatchedFields: string[];
}

interface KBEntry {
  category: string | null;
  content: string | null;
}

interface OrgRow {
  name: string | null;
}

export class FormFillerAgent {
  private readonly claude: Anthropic;

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly browser: StealthBrowser,
  ) {
    void this.browser;
    this.claude = new Anthropic();
  }

  async fillAndSubmit(options: FillOptions): Promise<FillResult> {
    const { page, template, organizationId, funderId, requestProfile, dossierContext, sessionId } =
      options;

    // Postpone rather than fill/submit when the dossier flags a known blocker
    // (e.g. the org is mid CEO-transition) — checked up front, before any
    // page interaction or session approval, so a stale intelligence signal
    // never wastes an approved automation session or leaves a half-filled
    // form on the funder's own portal.
    const ceoTransition = dossierContext?.riskFactors?.find(
      (rf) => rf.factor === 'ceo_transition_pending',
    );
    if (ceoTransition) {
      throw new DeferredSubmissionError(
        'pending_org_transition',
        `CEO transition detected for this prospect — postponing submission.${
          ceoTransition.mitigation ? ` ${ceoTransition.mitigation}` : ''
        }`,
      );
    }

    const advancedHandler = new AdvancedFieldHandler();
    const multiPageHandler = new MultiPageFormHandler();
    const vault = new DocumentVault(this.supabase);
    const attacher = new DocumentAttacher(advancedHandler);
    const captchaSolver = new CaptchaSolver();
    const screenshotManager = new ScreenshotManager();
    const webhookNotifier = new WebhookNotifier();

    const fillData = await this.buildFillData(organizationId, requestProfile, dossierContext);
    const requestDescription = fillData['request.description'] ?? null;

    const orgDocuments = await vault.getAllDocuments(organizationId).catch((): OrgDocument[] => []);
    const fieldMapping = this.extractFieldMapping(template, requestProfile);

    const allAttachedDocs: string[] = [];
    const allUnmatchedUploadFields: string[] = [];
    let pagesCompleted = 0;
    let sessionTimedOut = false;
    let captchaEncountered = false;
    let captchaSolved = false;
    let captchaStepNumber = 0;

    // Detect/solve/inject any CAPTCHA on the current page before AdvancedFieldHandler
    // starts filling fields. Runs on initial page load and after every multi-page
    // navigation. Never throws and never blocks the fill — a missing 2captcha key or
    // a failed solve just leaves the CAPTCHA unsolved and submission proceeds.
    const checkCaptcha = async (currentPage: Page): Promise<void> => {
      const detection = await captchaSolver
        .detectCaptcha(currentPage)
        .catch((): CaptchaDetection | null => null);
      if (detection === null || detection.type === null) return;

      captchaEncountered = true;
      const captchaType = detection.type;
      const pageUrl = currentPage.url();
      console.log(`[CaptchaSolver] ${captchaType} detected on ${pageUrl}`);

      const token = await captchaSolver
        .solveCaptcha(detection, currentPage)
        .catch((): string | null => null);

      let solved = false;
      if (token === null) {
        console.log('[CaptchaSolver] WARN: solve failed — continuing without token');
      } else {
        await captchaSolver.injectSolution(currentPage, detection, token).catch(() => null);
        await new Promise((resolve) => setTimeout(resolve, 1500));
        solved = true;
        captchaSolved = true;
        console.log(`[CaptchaSolver] ${captchaType} solved and injected successfully`);
      }

      // Audit trail: one automation_steps row per CAPTCHA encounter. Failure here
      // must never block the fill flow.
      try {
        if (sessionId) {
          captchaStepNumber += 1;
          await this.supabase.from('automation_steps').insert({
            session_id: sessionId,
            step_number: 9000 + captchaStepNumber,
            action: 'captcha_detected',
            description: `${captchaType} captcha on ${pageUrl}`,
            status: solved ? 'completed' : 'failed',
            input_data: { captcha_type: captchaType, page_url: pageUrl },
            output_data: { solved },
          });
        }
      } catch {
        // Audit failure must never block the fill flow
      }

      // Best-effort screenshot of the CAPTCHA state. Failure must never block the fill flow.
      try {
        await screenshotManager.captureAndUpload(
          currentPage,
          `captcha-${solved ? 'solved' : 'detected'}-${Date.now()}`,
          { orgId: organizationId, funderId, submissionId: null, supabase: this.supabase },
        );
      } catch {
        // Screenshot failure must never block the fill flow
      }

      // Notify the operator when a CAPTCHA could not be solved — human intervention
      // may be needed. alerting.ts's checkAlerts() is a periodic system-wide threshold
      // scan (worker offline / success rate / cost / tenant anomaly) with no per-event
      // dispatch and no caller anywhere in this codebase; WebhookNotifier is the real,
      // already-wired operator-notification path this same pipeline uses for
      // review_needed/submission_failed events, so a CAPTCHA failure is routed there too.
      if (!solved) {
        try {
          await webhookNotifier.notify({
            orgId: organizationId,
            event: 'captcha_solve_failed',
            data: { funderId, captchaType, pageUrl },
            supabase: this.supabase,
          });
        } catch {
          // Alerting failure must never block the fill flow
        }
      }
    };

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
          if (!recovered) break;
          sessionTimedOut = false;
        }

        await checkCaptcha(page);

        const pageResult = await this.fillPageFields(
          page,
          fieldMapping,
          fillData,
          advancedHandler,
          attacher,
          orgDocuments,
          vault,
          requestProfile,
        );
        allAttachedDocs.push(...pageResult.attachedDocs);
        allUnmatchedUploadFields.push(...pageResult.unmatchedFields);
        pagesCompleted++;

        const currentInfo = await multiPageHandler
          .detectMultiPage(page)
          .catch(() => ({ isMultiPage: false, nextButton: undefined }));

        if (!currentInfo.isMultiPage || !currentInfo.nextButton) break;

        const navigated = await multiPageHandler
          .navigateToNextPage(page, currentInfo.nextButton)
          .catch(() => false);

        if (!navigated) {
          // Navigation failed — likely a per-page validation error; stop advancing
          break;
        }

        pageNum++;
      }
    } else {
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
        if (recovered) sessionTimedOut = false;
      }

      if (!sessionTimedOut) {
        await checkCaptcha(page);

        const pageResult = await this.fillPageFields(
          page,
          fieldMapping,
          fillData,
          advancedHandler,
          attacher,
          orgDocuments,
          vault,
          requestProfile,
        );
        allAttachedDocs.push(...pageResult.attachedDocs);
        allUnmatchedUploadFields.push(...pageResult.unmatchedFields);
        pagesCompleted = 1;
      }
    }

    // Accept terms before submitting
    await advancedHandler.acceptTerms(page).catch(() => false);

    // BEHAVIORAL_CONTRACTS §18: never submit without a human-approved session.
    await this.assertSessionApproved(sessionId, organizationId);

    let confirmationNumber: string | null = null;
    let confirmationScreenshot: Buffer | null = null;

    try {
      await this.submitForm(page);
      await page.waitForTimeout(3000);
      const confirmData = await parseConfirmationPage(page).catch(() => null);
      confirmationNumber =
        confirmData?.confirmation_number ?? confirmData?.reference_id ?? null;
    } catch {
      // Submission failed; screenshot captures the failure state
    }

    try {
      confirmationScreenshot = (await page.screenshot({ fullPage: false })) as Buffer;
    } catch {
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
      captchaEncountered,
      captchaSolved,
      successProbability: dossierContext?.successProbability ?? null,
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
  private async assertSessionApproved(
    sessionId: string | undefined,
    organizationId: string,
  ): Promise<void> {
    if (!sessionId) {
      throw new Error('Submission blocked: session not approved');
    }

    const { data, error } = await this.supabase
      .from('automation_sessions')
      .select('status')
      .eq('id', sessionId)
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (error || !data || (data as { status: string }).status !== 'approved') {
      throw new Error('Submission blocked: session not approved');
    }
  }

  private async buildFillData(
    organizationId: string,
    requestProfile?: RequestProfile,
    dossierContext?: DossierContext,
  ): Promise<Record<string, string>> {
    const fillData: Record<string, string> = {};

    try {
      const { data: orgData } = await this.supabase
        .from('organizations')
        .select('name')
        .eq('id', organizationId)
        .single();
      const orgRow = orgData as OrgRow | null;
      if (orgRow?.name) fillData['organization.name'] = orgRow.name;
    } catch {
      // org lookup failed — continue without it
    }

    let entries: KBEntry[] = [];
    try {
      const { data: kbData } = await this.supabase
        .from('knowledge_base_entries')
        .select('category, content')
        .eq('organization_id', organizationId);
      entries = (kbData as KBEntry[] | null) ?? [];
    } catch {
      // KB lookup failed — continue without entries
    }

    for (const entry of entries) {
      const cat = (entry.category ?? '').toLowerCase();
      const text = entry.content ?? '';
      if (!text) continue;

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
    } else {
      const mission =
        fillData['organization.mission_statement'] ??
        fillData['organization.name'] ??
        'our organization';
      fillData['request.description'] = `We are requesting support for ${mission}`;
      fillData['request.type'] = 'monetary';
      fillData['request.narrative'] = fillData['request.description'] ?? '';
    }

    // Dossier-personalized pitch outranks the request profile's generic pitch template.
    if (dossierContext?.personalizedPitch) {
      fillData['request.narrative'] = dossierContext.personalizedPitch;
    }

    // Dossier-mapped values (e.g. a tailored program/EIN framing pulled from the
    // prospect's own dossier) outrank everything above — resolved last so they win.
    if (dossierContext?.dossierId && dossierContext.fieldMappings) {
      const dossierValues = await this.resolveDossierFieldMappings(
        dossierContext.dossierId,
        dossierContext.fieldMappings,
      );
      Object.assign(fillData, dossierValues);
    }

    return fillData;
  }

  /**
   * Resolves each benavoraField -> dossierPath mapping against the real
   * pil_prospect_dossiers.dossier jsonb column (migration 163) for the given
   * dossier id. pil_prospect_dossiers has no separate field_mappings/
   * success_probability columns — that structured intelligence lives inside
   * this opaque jsonb blob, so dossierPath is a dot-path into it (e.g.
   * "recommendation.pitch.program_name").
   */
  private async resolveDossierFieldMappings(
    dossierId: string,
    fieldMappings: Record<string, string>,
  ): Promise<Record<string, string>> {
    const resolved: Record<string, string> = {};

    try {
      const { data } = await this.supabase
        .from('pil_prospect_dossiers')
        .select('dossier')
        .eq('id', dossierId)
        .maybeSingle();

      const dossier = (data as { dossier: Record<string, unknown> } | null)?.dossier;
      if (!dossier) return resolved;

      for (const [benavoraField, dossierPath] of Object.entries(fieldMappings)) {
        const value = this.getNestedValue(dossier, dossierPath);
        if (value !== undefined && value !== null && value !== '') {
          resolved[benavoraField] = String(value);
        }
      }
    } catch {
      // Dossier lookup failed — fill proceeds with KB/org data only
    }

    return resolved;
  }

  private getNestedValue(source: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce<unknown>((acc, key) => {
      if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
        return (acc as Record<string, unknown>)[key];
      }
      return undefined;
    }, source);
  }

  private extractFieldMapping(
    template: Record<string, unknown>,
    requestProfile?: RequestProfile,
  ): Record<string, string> {
    const raw = template['field_mapping'];
    const base: Record<string, string> =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, string>)
        : {};

    if (requestProfile?.form_field_overrides) {
      return { ...base, ...requestProfile.form_field_overrides };
    }

    return { ...base };
  }

  private async fillPageFields(
    page: Page,
    fieldMapping: Record<string, string>,
    fillData: Record<string, string>,
    advancedHandler: AdvancedFieldHandler,
    attacher: DocumentAttacher,
    orgDocuments: OrgDocument[],
    vault: DocumentVault,
    requestProfile?: RequestProfile,
  ): Promise<PageFillResult> {
    const attachedDocs: string[] = [];
    const unmatchedFields: string[] = [];
    let triggerConditional = false;

    // Fill fields present in the stored template mapping
    for (const [benavoraField, selector] of Object.entries(fieldMapping)) {
      const value = fillData[benavoraField];
      if (!value || !selector) continue;

      const domInfo = await this.getFieldInfo(page, selector);
      if (domInfo.type === 'file' || domInfo.type === 'hidden') continue;

      if (domInfo.type === 'select') {
        const ok = await advancedHandler.fillSelect(page, selector, value).catch(() => false);
        if (ok) triggerConditional = true;
      } else if (domInfo.type === 'checkbox') {
        const flag =
          value.toLowerCase() === 'true' ||
          value === '1' ||
          value.toLowerCase() === 'yes';
        await advancedHandler.fillCheckbox(page, selector, flag).catch(() => null);
      } else if (domInfo.type === 'radio') {
        await advancedHandler.fillRadio(page, domInfo.name, value).catch(() => null);
        triggerConditional = true;
      } else if (domInfo.type === 'date') {
        await advancedHandler.fillDatePicker(page, selector, value).catch(() => null);
      } else {
        await page.fill(selector, value).catch(() => null);
      }
    }

    // Wait for any conditionally-revealed fields after select/radio interactions
    if (triggerConditional) {
      await advancedHandler.handleConditionalFields(page).catch(() => null);
    }

    // Fill any visible form fields not covered by the template via Claude
    await this.fillUnmappedFields(page, fieldMapping, fillData, advancedHandler, requestProfile).catch(
      () => null,
    );

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
          if (r.success) attachedDocs.push(r.documentName);
        }
        const unmatched = attacher.getUnmatchedFields(uploadFields, matches);
        unmatchedFields.push(...unmatched.map((f) => f.label || f.selector));
      } else {
        unmatchedFields.push(...uploadFields.map((f) => f.label || f.selector));
      }
    }

    return { attachedDocs, unmatchedFields };
  }

  private async getFieldInfo(page: Page, selector: string): Promise<DomFieldInfo> {
    return page
      .evaluate((sel: string): { type: string; name: string } => {
        const el = document.querySelector(sel);
        if (!el) return { type: 'unknown', name: '' };
        const tag = el.tagName.toLowerCase();
        if (tag === 'select')
          return { type: 'select', name: (el as HTMLSelectElement).name };
        if (tag === 'textarea')
          return { type: 'textarea', name: (el as HTMLTextAreaElement).name };
        if (tag === 'input') {
          const inp = el as HTMLInputElement;
          return { type: inp.type || 'text', name: inp.name };
        }
        return { type: 'unknown', name: '' };
      }, selector)
      .then((info) => ({
        type: (info.type as FieldType) ?? 'unknown',
        name: info.name ?? '',
      }))
      .catch((): DomFieldInfo => ({ type: 'unknown', name: '' }));
  }

  private async fillUnmappedFields(
    page: Page,
    fieldMapping: Record<string, string>,
    fillData: Record<string, string>,
    advancedHandler: AdvancedFieldHandler,
    requestProfile?: RequestProfile,
  ): Promise<void> {
    const covered = new Set(Object.values(fieldMapping));

    type RawField = { selector: string; label: string; type: string; name: string };

    const visible = await page
      .evaluate((): RawField[] => {
        const results: RawField[] = [];
        const inputs = document.querySelectorAll<HTMLElement>(
          'input:not([type="hidden"]):not([type="submit"]):not([type="button"])' +
            ':not([type="file"]):not([type="checkbox"]):not([type="radio"]),' +
            'select, textarea',
        );
        inputs.forEach((el, idx) => {
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') return;

          const inp = el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
          const id = inp.id ? `#${inp.id}` : '';
          const nameAttr = inp.name ? `[name="${inp.name}"]` : '';
          const selector =
            id || nameAttr || `${el.tagName.toLowerCase()}:nth-of-type(${idx + 1})`;

          const labelEl = inp.id
            ? document.querySelector<HTMLLabelElement>(`label[for="${inp.id}"]`)
            : null;
          const label =
            labelEl?.textContent?.trim() ??
            inp.getAttribute('placeholder') ??
            inp.name ??
            '';

          const tag = el.tagName.toLowerCase();
          const type =
            tag === 'select' || tag === 'textarea'
              ? tag
              : (inp as HTMLInputElement).type || 'text';

          results.push({ selector, label, type, name: inp.name });
        });
        return results;
      })
      .catch((): RawField[] => []);

    const unhandled = visible.filter((f) => !covered.has(f.selector));
    if (unhandled.length === 0) return;

    const fillContext = JSON.stringify(
      Object.entries(fillData).map(([k, v]) => ({ field: k, value: v.slice(0, 200) })),
    );
    const fieldContext = JSON.stringify(
      unhandled.map((f) => ({ selector: f.selector, label: f.label, type: f.type })),
    );

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
            content:
              `You are filling out a nonprofit funding request form. ${requestTypeFrame}\n` +
              `Match each visible form field to the best available data value.\n` +
              `Available data: ${fillContext}\n` +
              `Visible form fields: ${fieldContext}\n` +
              `Reply ONLY with valid JSON array (no markdown): [{"selector":"...","value":"..."}]. ` +
              `Only include fields that have relevant data. Skip file, checkbox, and radio fields.`,
          },
        ],
      })
      .catch(() => null);

    if (!message) return;

    const raw = message.content[0]?.type === 'text' ? message.content[0].text : '';
    try {
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return;

      const mappings = JSON.parse(jsonMatch[0]) as Array<{
        selector: string;
        value: string;
      }>;

      for (const { selector, value } of mappings) {
        if (!selector || !value) continue;

        const info = await this.getFieldInfo(page, selector);
        if (info.type === 'select') {
          await advancedHandler.fillSelect(page, selector, value).catch(() => null);
          await advancedHandler.handleConditionalFields(page).catch(() => null);
        } else if (info.type === 'radio') {
          await advancedHandler.fillRadio(page, info.name, value).catch(() => null);
        } else {
          await page.fill(selector, value).catch(() => null);
        }
      }
    } catch {
      // Claude response unparseable — continue without filling unmapped fields
    }
  }

  private async submitForm(page: Page): Promise<void> {
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
