"use strict";
/* eslint-disable @typescript-eslint/no-explicit-any */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SubmissionControls = void 0;
const crypto_1 = require("crypto");
// Known shared grant/donation platforms — multiple orgs submit to the same portal,
// so rate limits are stricter to avoid cross-org visibility issues.
const SHARED_PLATFORMS = [
    'benevity.com',
    'cybergrants.com',
    'yourcause.com',
    'smartsimple.com',
    'submittable.com',
    'fluxx.io',
    'grantinterface.com',
];
// Rolling 24-hour submission caps per subscription tier. -1 = unlimited (Consultant).
const DAILY_LIMITS = {
    free: 5,
    starter: 10,
    professional: 30,
    enterprise: 100,
    consultant: Infinity,
};
function hashOrgId(orgId) {
    return (0, crypto_1.createHash)('sha256').update(orgId).digest('hex');
}
function extractDomain(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    }
    catch {
        return url;
    }
}
function isSharedPlatform(domain) {
    return SHARED_PLATFORMS.some((p) => domain === p || domain.endsWith(`.${p}`));
}
class SubmissionControls {
    /**
     * Checks whether another tenant already submitted to this funder domain in the last
     * 7 days. Org identity is anonymized via SHA-256 before storage and comparison.
     */
    async checkCrossClientDedup(funderDomain, orgId, supabase) {
        const hashedOrgId = hashOrgId(orgId);
        const windowStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const { data } = await supabase
            .from('cross_client_submissions')
            .select('submitted_at')
            .eq('funder_domain', funderDomain)
            .neq('org_hash', hashedOrgId)
            .gte('submitted_at', windowStart)
            .limit(1);
        const rows = (data ?? []);
        if (rows.length > 0) {
            const delayUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
            return {
                blocked: true,
                reason: `Another organization submitted to ${funderDomain} in the last 7 days. Suggest waiting until ${delayUntil.toDateString()} to avoid cross-client collisions.`,
                delayUntil,
            };
        }
        return { blocked: false };
    }
    /**
     * Enforces per-domain rate limits to avoid triggering WAF rules on shared platforms.
     * Shared platforms (Benevity, CyberGrants, etc.) get a stricter cap of 2 per 4 hours;
     * standard portals are capped at 3 per 2 hours.
     */
    async checkDomainThrottle(portalUrl, supabase) {
        const domain = extractDomain(portalUrl);
        const shared = isSharedPlatform(domain);
        const windowHours = shared ? 4 : 2;
        const maxSubmissions = shared ? 2 : 3;
        const windowStart = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();
        // Resolve funder IDs whose portal URL contains this domain.
        const { data: funderData } = await supabase
            .from('funders')
            .select('id')
            .ilike('giving_portal_url', `%${domain}%`);
        const funderIds = (funderData ?? []).map((f) => f.id);
        if (funderIds.length === 0) {
            return { blocked: false };
        }
        const { count } = await supabase
            .from('autoapply_submissions')
            .select('id', { count: 'exact', head: true })
            .in('funder_id', funderIds)
            .gte('submitted_at', windowStart);
        const submissionCount = (count ?? 0);
        if (submissionCount >= maxSubmissions) {
            return {
                blocked: true,
                reason: `Domain throttle: ${submissionCount} submission${submissionCount === 1 ? '' : 's'} to ${domain} in the last ${windowHours} hours (limit: ${maxSubmissions}).`,
            };
        }
        return { blocked: false };
    }
    /**
     * Enforces the organization's rolling 24-hour submission cap based on subscription tier.
     */
    async checkVelocityLimits(orgId, supabase) {
        const { data: orgData } = await supabase
            .from('organizations')
            .select('subscription_tier')
            .eq('id', orgId)
            .maybeSingle();
        const tier = orgData?.subscription_tier ?? 'starter';
        const dailyLimit = DAILY_LIMITS[tier] ?? DAILY_LIMITS['starter'] ?? 10;
        const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { count } = await supabase
            .from('autoapply_submissions')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', orgId)
            .gte('submitted_at', windowStart);
        const dailyCount = (count ?? 0);
        if (isFinite(dailyLimit) && dailyCount >= dailyLimit) {
            return {
                blocked: true,
                reason: `Daily submission limit reached: ${dailyCount}/${dailyLimit} submissions in the last 24 hours.`,
                dailyCount,
                dailyLimit,
            };
        }
        return { blocked: false, dailyCount, dailyLimit };
    }
    /**
     * Records a completed submission in the anonymized cross-client dedup log.
     * Call this after a successful form submission.
     */
    async recordSubmission(funderDomain, orgId, supabase) {
        await supabase.from('cross_client_submissions').insert({
            funder_domain: funderDomain,
            org_hash: hashOrgId(orgId),
            submitted_at: new Date().toISOString(),
        });
    }
    /**
     * Returns a summary of current submission controls state for the given organization.
     */
    async getControlsReport(orgId, supabase) {
        // --- daily count + limit ---
        const window24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const [{ count: dailyCountRaw }, { data: orgData }] = await Promise.all([
            supabase
                .from('autoapply_submissions')
                .select('id', { count: 'exact', head: true })
                .eq('organization_id', orgId)
                .gte('submitted_at', window24h),
            supabase
                .from('organizations')
                .select('subscription_tier')
                .eq('id', orgId)
                .maybeSingle(),
        ]);
        const dailyCount = (dailyCountRaw ?? 0);
        const tier = orgData?.subscription_tier ?? 'starter';
        const dailyLimit = DAILY_LIMITS[tier] ?? DAILY_LIMITS['starter'] ?? 10;
        // --- domains submitted to today (calendar day) ---
        const todayMidnight = new Date();
        todayMidnight.setHours(0, 0, 0, 0);
        const { data: submissionsToday } = await supabase
            .from('autoapply_submissions')
            .select('funder_id')
            .eq('organization_id', orgId)
            .gte('submitted_at', todayMidnight.toISOString());
        const funderIdsToday = [
            ...new Set((submissionsToday ?? [])
                .map((s) => s.funder_id)
                .filter((id) => id !== null)),
        ];
        let domainsToday = [];
        if (funderIdsToday.length > 0) {
            const { data: funderData } = await supabase
                .from('funders')
                .select('giving_portal_url')
                .in('id', funderIdsToday)
                .not('giving_portal_url', 'is', null);
            domainsToday = [
                ...new Set((funderData ?? [])
                    .map((f) => extractDomain(f.giving_portal_url ?? ''))
                    .filter((d) => d.length > 0)),
            ];
        }
        // --- active cross-client blocks: domains locked by other tenants in last 7 days ---
        const hashedOrgId = hashOrgId(orgId);
        const window7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const { data: blockData } = await supabase
            .from('cross_client_submissions')
            .select('funder_domain')
            .neq('org_hash', hashedOrgId)
            .gte('submitted_at', window7d);
        const crossClientBlocksActive = new Set((blockData ?? []).map((r) => r.funder_domain)).size;
        return {
            dailyCount,
            dailyLimit,
            domainsToday,
            crossClientBlocksActive,
        };
    }
}
exports.SubmissionControls = SubmissionControls;
