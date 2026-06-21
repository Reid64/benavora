/* eslint-disable @typescript-eslint/no-explicit-any */

export interface RiskFactor {
  name: string;
  points: number;
  description: string;
}

export type RiskClassification = 'low' | 'medium' | 'high' | 'critical';
export type RiskRecommendation = 'auto' | 'assisted' | 'manual';

export interface RiskAssessment {
  score: number;
  classification: RiskClassification;
  factors: RiskFactor[];
  recommendation: RiskRecommendation;
  shouldNotify: boolean;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function classify(score: number): { classification: RiskClassification; recommendation: RiskRecommendation } {
  if (score <= 25) return { classification: 'low', recommendation: 'auto' };
  if (score <= 50) return { classification: 'medium', recommendation: 'assisted' };
  if (score <= 75) return { classification: 'high', recommendation: 'manual' };
  return { classification: 'critical', recommendation: 'manual' };
}

export async function assessSubmissionRisk(params: {
  funder: { id: string; name: string; automation_level?: string | null; giving_portal_url?: string | null };
  requestProfile?: { request_type: string; min_value?: number | null; max_value?: number | null } | null;
  formTemplate?: { field_count?: number | null; has_file_uploads?: boolean | null; [key: string]: unknown } | null;
  orgReadiness?: { ready: boolean; missing_required: string[] } | null;
  crossClientBlocked?: boolean;
  supabase: any;
}): Promise<RiskAssessment> {
  const { funder, requestProfile, formTemplate, orgReadiness, crossClientBlocked, supabase } = params;
  const factors: RiskFactor[] = [];

  // 1. Portal is flagged as manual_only: +40 (auto-route to manual)
  if (funder.automation_level === 'manual_only') {
    factors.push({
      name: 'manual_only_portal',
      points: 40,
      description: 'Portal is flagged as manual-only — possible anti-automation terms of service detected',
    });
  }

  // 2. CAPTCHA field detected in stored form template: +10
  const formStructure = formTemplate?.['form_structure'];
  if (Array.isArray(formStructure)) {
    const hasCaptcha = formStructure.some((field: any) => {
      const label = `${String(field?.fieldLabel ?? '')} ${String(field?.fieldName ?? '')}`.toLowerCase();
      return label.includes('captcha') || label.includes('recaptcha') || label.includes('hcaptcha');
    });
    if (hasCaptcha) {
      factors.push({
        name: 'captcha_in_template',
        points: 10,
        description: 'CAPTCHA field detected in stored form template',
      });
    }
  }

  // 3. Portal requires login/account: +15
  if (Boolean(formTemplate?.['requires_login'])) {
    factors.push({
      name: 'requires_login',
      points: 15,
      description: 'Portal requires account login or registration before form access',
    });
  }

  // 4. File uploads required but org documents missing: +25
  const requiresFileUpload =
    Boolean(formTemplate?.has_file_uploads) || Boolean(formTemplate?.['requires_file_upload']);
  const missingDocs = (orgReadiness?.missing_required ?? []).some((item) =>
    /doc|file|upload|attach|tax|990|letter|cert/i.test(item),
  );
  if (requiresFileUpload && missingDocs) {
    factors.push({
      name: 'missing_required_documents',
      points: 25,
      description: 'Form requires file uploads but required documents are missing from the organization profile',
    });
  }

  // 5. Ask amount exceeds funder historical max by >50%: +15
  const requestType = requestProfile?.request_type ?? 'monetary';
  if (requestType === 'monetary') {
    const askAmount = requestProfile?.max_value ?? requestProfile?.min_value ?? null;
    if (askAmount !== null && askAmount > 0) {
      let historicalMax: number | null = null;

      const { data: relData } = await supabase
        .from('funder_relationships')
        .select('max_ask_amount')
        .eq('funder_id', funder.id)
        .maybeSingle();
      historicalMax = (relData as { max_ask_amount: number | null } | null)?.max_ask_amount ?? null;

      if (historicalMax === null) {
        const { data: histData } = await supabase
          .from('funder_giving_history')
          .select('amount')
          .eq('funder_id', funder.id)
          .order('amount', { ascending: false })
          .limit(10);
        const amounts = ((histData ?? []) as Array<{ amount: number | null }>)
          .map((r) => r.amount)
          .filter((a): a is number => typeof a === 'number' && a > 0);
        if (amounts.length > 0) historicalMax = Math.max(...amounts);
      }

      if (historicalMax !== null && historicalMax > 0 && askAmount > historicalMax * 1.5) {
        factors.push({
          name: 'ask_exceeds_historical_max',
          points: 15,
          description: `Requested amount ($${askAmount.toLocaleString()}) exceeds funder's historical maximum ($${historicalMax.toLocaleString()}) by more than 50%`,
        });
      }
    }
  }

  // 6. First submission to this funder (no prior relationship or submission record): +10
  const { data: relRow } = await supabase
    .from('funder_relationships')
    .select('id, total_submissions')
    .eq('funder_id', funder.id)
    .maybeSingle();

  const relTotalSubs = (relRow as { total_submissions: number | null } | null)?.total_submissions ?? 0;
  if (relRow === null || relTotalSubs === 0) {
    const { count: priorCount } = await supabase
      .from('autoapply_submissions')
      .select('id', { count: 'exact', head: true })
      .eq('funder_id', funder.id)
      .eq('status', 'submitted');
    if ((priorCount ?? 0) === 0) {
      factors.push({
        name: 'first_submission',
        points: 10,
        description: `No prior successful submissions to ${funder.name} — first contact carries higher uncertainty`,
      });
    }
  }

  // 7. Low form template confidence (field_count < 3 or no template): +20
  if (formTemplate === null || formTemplate === undefined) {
    factors.push({
      name: 'no_form_template',
      points: 20,
      description: 'No form template exists for this funder — form has not been analyzed yet',
    });
  } else {
    const fieldCount = formTemplate.field_count ?? null;
    if (typeof fieldCount === 'number' && fieldCount < 3) {
      factors.push({
        name: 'low_template_confidence',
        points: 20,
        description: `Form template has only ${fieldCount} mapped field${fieldCount === 1 ? '' : 's'} — analysis confidence is low`,
      });
    }
  }

  // 8. Cross-client collision detected: +15
  if (crossClientBlocked === true) {
    factors.push({
      name: 'cross_client_collision',
      points: 15,
      description: 'Another organization recently submitted to this same funder domain',
    });
  }

  // 9. Legal attestation or certification checkbox in form: +30
  if (Array.isArray(formStructure)) {
    const hasAttestation = formStructure.some((field: any) => {
      const label = `${String(field?.fieldLabel ?? '')} ${String(field?.fieldName ?? '')}`.toLowerCase();
      const isLegal = /attest|certif|swear|affirm|authoriz|agree/.test(label);
      const isCheckable = field?.fieldType === 'checkbox' || /checkbox|agree|legal/.test(label);
      return isLegal && isCheckable;
    });
    if (hasAttestation) {
      factors.push({
        name: 'legal_attestation_required',
        points: 30,
        description: 'Form contains legal attestation or certification checkboxes requiring explicit agreement',
      });
    }
  }

  // 10. Organization profile incomplete (missing required KB or documents): +25
  if (orgReadiness !== null && orgReadiness !== undefined && !orgReadiness.ready && orgReadiness.missing_required.length > 0) {
    factors.push({
      name: 'org_not_ready',
      points: 25,
      description: `Organization profile is incomplete — missing: ${orgReadiness.missing_required.slice(0, 3).join(', ')}`,
    });
  }

  const score = clamp(factors.reduce((sum, f) => sum + f.points, 0));
  const { classification, recommendation } = classify(score);
  const shouldNotify = classification === 'high' || classification === 'critical';

  return { score, classification, factors, recommendation, shouldNotify };
}
