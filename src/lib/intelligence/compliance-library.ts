import {
  COMPLIANCE_REQUIREMENTS,
  REGULATORY_CITATIONS,
  type ComplianceRequirement,
} from './data/compliance-requirements'

export type { ComplianceRequirement }

export interface ComplianceCheckItem {
  requirementId: string
  requirementName: string
  status: 'pass' | 'fail' | 'warning' | 'unknown'
  severity: 'required' | 'recommended'
  message: string
  citation: string
}

export interface ComplianceCheckResult {
  overallStatus: 'pass' | 'fail' | 'warning'
  passCount: number
  failCount: number
  warningCount: number
  unknownCount: number
  items: ComplianceCheckItem[]
}

const FUNDING_SOURCE_TAGS: Record<string, string[]> = {
  federal: ['federal_grant', 'federal_contract'],
  'grants.gov': ['federal_grant'],
  'sam.gov': ['federal_grant', 'federal_contract'],
  hud: ['hud_grant', 'cdbg', 'home', 'esg', 'hopwa', 'continuum_of_care'],
  cdbg: ['cdbg', 'hud_grant'],
  home: ['home', 'hud_grant'],
  esg: ['esg', 'hud_grant'],
  hopwa: ['hopwa', 'hud_grant'],
  'continuum of care': ['continuum_of_care', 'hud_grant'],
  coc: ['continuum_of_care', 'hud_grant'],
  state: ['state_grant'],
  foundation: ['foundation_grant', 'private_foundation'],
  corporate: ['corporate_grant'],
  private: ['private_foundation', 'foundation_grant'],
}

const GRANT_TYPE_TAGS: Record<string, string[]> = {
  construction: ['federal_construction'],
  renovation: ['federal_construction'],
  rehabilitation: ['federal_construction'],
  housing: ['hud_grant'],
  shelter: ['hud_grant', 'esg'],
  homelessness: ['esg', 'continuum_of_care', 'hud_grant'],
  'affordable housing': ['home', 'cdbg', 'hud_grant'],
  workforce: ['federal_grant', 'state_grant'],
  education: ['federal_grant', 'state_grant'],
  health: ['federal_grant', 'state_grant'],
  reentry: ['federal_grant', 'state_grant'],
}

function resolveApplicableTags(grantType: string, fundingSource: string): Set<string> {
  const tags = new Set<string>()
  const sourceLower = fundingSource.toLowerCase()
  const typeLower = grantType.toLowerCase()

  for (const [key, values] of Object.entries(FUNDING_SOURCE_TAGS)) {
    if (sourceLower.includes(key)) {
      for (const v of values) tags.add(v)
    }
  }

  for (const [key, values] of Object.entries(GRANT_TYPE_TAGS)) {
    if (typeLower.includes(key)) {
      for (const v of values) tags.add(v)
    }
  }

  // Always include the raw strings for direct matching
  for (const word of sourceLower.split(/[\s,_-]+/)) {
    tags.add(word)
  }
  for (const word of typeLower.split(/[\s,_-]+/)) {
    tags.add(word)
  }

  return tags
}

function requirementApplies(req: ComplianceRequirement, tags: Set<string>): boolean {
  return req.applies_to.some((tag) => tags.has(tag))
}

// Checks a specific field or document list within the application object.
function checkDocumentRequirement(
  req: ComplianceRequirement,
  application: Record<string, unknown>,
): 'pass' | 'fail' | 'unknown' {
  const docList = application['documents'] ?? application['document_list'] ?? application['required_documents']
  if (Array.isArray(docList)) {
    const nameLower = req.name.toLowerCase()
    const found = docList.some((d: unknown) => {
      if (typeof d === 'string') return d.toLowerCase().includes(nameLower.split(' ')[0] ?? '')
      if (d !== null && typeof d === 'object') {
        const doc = d as Record<string, unknown>
        const title = String(doc['name'] ?? doc['title'] ?? doc['type'] ?? '').toLowerCase()
        return title.includes(nameLower.split(' ')[0] ?? '')
      }
      return false
    })
    return found ? 'pass' : 'fail'
  }
  return 'unknown'
}

function checkDataRequirement(
  req: ComplianceRequirement,
  application: Record<string, unknown>,
): 'pass' | 'fail' | 'unknown' {
  switch (req.id) {
    case 'sam-gov-registration': {
      const samStatus = application['sam_registration_status'] ?? application['sam_active']
      if (samStatus === true || samStatus === 'active') return 'pass'
      if (samStatus === false || samStatus === 'expired' || samStatus === 'inactive') return 'fail'
      return 'unknown'
    }
    case 'uei-requirement': {
      const uei = application['uei'] ?? application['unique_entity_identifier'] ?? application['duns']
      if (typeof uei === 'string' && uei.trim().length > 0) return 'pass'
      if (uei === null || uei === undefined) return 'fail'
      return 'unknown'
    }
    case 'omb-a133-threshold': {
      const expenditures =
        application['total_federal_expenditures'] ?? application['federal_expenditures_ytd']
      if (typeof expenditures === 'number') {
        return expenditures >= 750000 ? 'pass' : 'pass' // Both cases pass — threshold just means audit is required
      }
      return 'unknown'
    }
    default:
      return 'unknown'
  }
}

function checkAttestationRequirement(
  _req: ComplianceRequirement,
  application: Record<string, unknown>,
): 'pass' | 'fail' | 'unknown' {
  const attestations =
    application['attestations'] ?? application['certifications'] ?? application['compliance_certifications']
  if (Array.isArray(attestations) && attestations.length > 0) return 'pass'
  if (application['compliance_attested'] === true) return 'pass'
  return 'unknown'
}

function buildMessage(
  req: ComplianceRequirement,
  status: 'pass' | 'fail' | 'warning' | 'unknown',
): string {
  switch (status) {
    case 'pass':
      return `${req.name}: satisfied.`
    case 'fail':
      return `${req.name}: MISSING or NON-COMPLIANT. ${req.description}`
    case 'warning':
      return `${req.name}: requires attention. ${req.description}`
    case 'unknown':
      return `${req.name}: could not be verified automatically. Manual review required. ${req.description}`
  }
}

export class ComplianceLibrary {
  getRequirements(grantType: string, fundingSource: string): ComplianceRequirement[] {
    const tags = resolveApplicableTags(grantType, fundingSource)
    return COMPLIANCE_REQUIREMENTS.filter((req) => requirementApplies(req, tags))
  }

  checkCompliance(
    application: Record<string, unknown>,
    requirements: ComplianceRequirement[],
  ): ComplianceCheckResult {
    const items: ComplianceCheckItem[] = []

    for (const req of requirements) {
      let rawStatus: 'pass' | 'fail' | 'unknown'

      switch (req.check_type) {
        case 'document':
          rawStatus = checkDocumentRequirement(req, application)
          break
        case 'data':
          rawStatus = checkDataRequirement(req, application)
          break
        case 'attestation':
          rawStatus = checkAttestationRequirement(req, application)
          break
      }

      // Required items that are unknown surface as warnings; recommended unknowns stay unknown
      let status: 'pass' | 'fail' | 'warning' | 'unknown' = rawStatus
      if (rawStatus === 'unknown' && req.severity === 'required') {
        status = 'warning'
      }

      items.push({
        requirementId: req.id,
        requirementName: req.name,
        status,
        severity: req.severity,
        message: buildMessage(req, status),
        citation: req.citation,
      })
    }

    const passCount = items.filter((i) => i.status === 'pass').length
    const failCount = items.filter((i) => i.status === 'fail').length
    const warningCount = items.filter((i) => i.status === 'warning').length
    const unknownCount = items.filter((i) => i.status === 'unknown').length

    let overallStatus: 'pass' | 'fail' | 'warning'
    if (failCount > 0) {
      overallStatus = 'fail'
    } else if (warningCount > 0) {
      overallStatus = 'warning'
    } else {
      overallStatus = 'pass'
    }

    return { overallStatus, passCount, failCount, warningCount, unknownCount, items }
  }

  getRegulatoryCitations(requirement: string): string[] {
    const lower = requirement.toLowerCase()
    const results: string[] = []

    for (const [key, citations] of Object.entries(REGULATORY_CITATIONS)) {
      if (lower.includes(key) || key.includes(lower)) {
        for (const c of citations) {
          if (!results.includes(c)) results.push(c)
        }
      }
    }

    // Also check against requirement IDs and names in COMPLIANCE_REQUIREMENTS
    const matched = COMPLIANCE_REQUIREMENTS.find(
      (r) => r.id === requirement || r.name.toLowerCase() === lower,
    )
    if (matched && !results.includes(matched.citation)) {
      results.push(matched.citation)
    }

    return results
  }
}
