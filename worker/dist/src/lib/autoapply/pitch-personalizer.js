"use strict";
/* eslint-disable @typescript-eslint/no-explicit-any */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.personalizePitch = personalizePitch;
exports.clearPitchCache = clearPitchCache;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
// Lazy singleton — only instantiated on first call.
let _claude = null;
function getClaude() {
    if (!_claude) {
        const apiKey = process.env['ANTHROPIC_API_KEY'];
        if (!apiKey)
            throw new Error('ANTHROPIC_API_KEY is not set');
        _claude = new sdk_1.default({ apiKey });
    }
    return _claude;
}
// Request types that need a non-monetary pitch frame.
const NON_MONETARY_FRAMES = {
    land: 'a land or property donation',
    in_kind: 'an in-kind goods or materials donation',
    volunteer: 'skilled volunteer labor and time contributions',
    service: 'pro bono professional services',
    facility: 'facility or space donation',
    partnership: 'a collaborative program partnership',
    sponsorship: 'event or program sponsorship',
};
// Cache TTL: 30 days
const CACHE_TTL_DAYS = 30;
async function readCache(supabase, organizationId, funderId, requestType) {
    try {
        const { data } = (await supabase
            .from('pitch_cache')
            .select('personalized_pitch, expires_at')
            .eq('organization_id', organizationId)
            .eq('funder_id', funderId)
            .eq('request_type', requestType)
            .maybeSingle());
        if (!data)
            return null;
        if (new Date(data.expires_at) < new Date())
            return null;
        return data.personalized_pitch;
    }
    catch {
        // pitch_cache table may not exist yet — degrade gracefully.
        return null;
    }
}
async function writeCache(supabase, organizationId, funderId, requestType, pitch) {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + CACHE_TTL_DAYS);
    try {
        await supabase.from('pitch_cache').upsert({
            organization_id: organizationId,
            funder_id: funderId,
            request_type: requestType,
            personalized_pitch: pitch,
            expires_at: expiresAt.toISOString(),
        }, { onConflict: 'organization_id,funder_id,request_type' });
    }
    catch {
        // Non-fatal — caching is best-effort.
    }
}
function buildPrompt(params) {
    const { orgMission, orgPrograms, orgName, funderName, funderPriorities, funderLanguage, funderCategory, requestProfile, pitchStyle, emphasis, maxLength, } = params;
    const requestType = requestProfile?.request_type ?? 'monetary';
    const frame = NON_MONETARY_FRAMES[requestType] ?? 'monetary support';
    const isMonetary = !(requestType in NON_MONETARY_FRAMES);
    const priorityList = funderPriorities.length > 0 ? funderPriorities.join(', ') : 'general community impact';
    const programList = orgPrograms.length > 0 ? orgPrograms.join('; ') : 'various community programs';
    const lengthGuide = maxLength
        ? `Keep the response under ${maxLength} characters.`
        : 'Aim for 3-5 concise sentences.';
    const needsContext = requestProfile?.needs_description
        ? `\n\nSpecific need for this request: ${requestProfile.needs_description}`
        : '';
    const pitchTemplateHint = requestProfile?.pitch_template
        ? `\n\nBase pitch structure to adapt: "${requestProfile.pitch_template}"`
        : '';
    const languageHint = funderLanguage
        ? `\n\nMirror this funder's language style where appropriate: "${funderLanguage.slice(0, 300)}"`
        : '';
    const categoryHint = funderCategory
        ? `\n\nFunder category: ${funderCategory}.`
        : '';
    const pitchStyleHint = pitchStyle
        ? `\n\nWriting style: ${pitchStyle} (write the pitch in this style).`
        : '';
    const emphasisHint = emphasis
        ? `\n\nKey theme to emphasize: ${emphasis} (make this the central thread of the pitch).`
        : '';
    if (isMonetary) {
        return `You are writing a concise, personalized pitch for a nonprofit donation request.

Organization: ${orgName}
Mission: ${orgMission}
Programs: ${programList}

Target funder: ${funderName}
Funder priorities: ${priorityList}${categoryHint}${languageHint}${pitchStyleHint}${emphasisHint}${needsContext}${pitchTemplateHint}

Rewrite the organization's mission description into a donation request pitch tailored to ${funderName}'s stated priorities. Emphasize the overlap between the org's work and what the funder cares about. Use language consistent with the funder's own terminology where possible.

Critical rules:
- Do NOT fabricate programs, outcomes, or statistics not mentioned above.
- Do NOT include a specific dollar amount in this pitch (amounts are handled separately).
- Be specific and human — avoid generic nonprofit boilerplate.
- ${lengthGuide}

Return ONLY the pitch text. No headings, no labels, no explanation.`;
    }
    return `You are writing a concise, personalized request for ${frame} from a company.

Organization: ${orgName}
Mission: ${orgMission}
Programs: ${programList}

Target funder: ${funderName}
Funder priorities: ${priorityList}${categoryHint}${languageHint}${pitchStyleHint}${emphasisHint}${needsContext}${pitchTemplateHint}

Write a pitch requesting ${frame} from ${funderName} that connects the organization's work to the funder's stated priorities. Explain clearly what the donated resource (land, materials, labor, services, etc.) will be used for and why it matters to the funder's community.

Critical rules:
- Do NOT fabricate programs, outcomes, or statistics not mentioned above.
- Be specific about what is being requested based on the need description above.
- Be specific and human — avoid generic nonprofit boilerplate.
- ${lengthGuide}

Return ONLY the pitch text. No headings, no labels, no explanation.`;
}
/**
 * Returns a personalized pitch for a funder, using cached result when available.
 *
 * Checks pitch_cache (organization_id + funder_id + request_type) first.
 * On cache miss, calls Claude claude-sonnet-4-6 to generate a tailored pitch, then caches it.
 * Non-monetary request types (land, in_kind, volunteer, service) get dedicated prompt frames.
 */
async function personalizePitch(params) {
    const { organizationId, funderId, supabase, requestProfile, bypassCache } = params;
    const requestType = requestProfile?.request_type ?? 'monetary';
    // Attempt cache read when we have both IDs and a supabase client.
    // Skip cache when bypassCache is true (e.g. A/B test variant active).
    if (organizationId && funderId && supabase && !bypassCache) {
        const cached = await readCache(supabase, organizationId, funderId, requestType);
        if (cached)
            return cached;
    }
    const prompt = buildPrompt(params);
    const message = await getClaude().messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
    });
    const content = message.content[0];
    const pitch = content?.type === 'text' ? content.text.trim() : params.orgMission;
    // Write to cache when we have both IDs and a supabase client (skip for A/B variants).
    if (organizationId && funderId && supabase && !bypassCache) {
        await writeCache(supabase, organizationId, funderId, requestType, pitch);
    }
    return pitch;
}
/**
 * Clears cached pitches for an organization, optionally scoped to a single funder.
 * Safe to call even if the pitch_cache table does not yet exist.
 */
async function clearPitchCache(supabase, orgId, funderId) {
    try {
        let query = supabase.from('pitch_cache').delete().eq('organization_id', orgId);
        if (funderId) {
            query = query.eq('funder_id', funderId);
        }
        await query;
    }
    catch {
        // Non-fatal — table may not exist yet.
    }
}
