"use strict";
// Usage metering and tier-cap enforcement for AutoApply submissions.
// Reads tier limits from the `tier_limits` table and tracks monthly/daily
// counts in `submission_usage`. Enforces hard daily caps regardless of overages.
Object.defineProperty(exports, "__esModule", { value: true });
exports.UsageMeter = void 0;
const key_encrypt_1 = require("@/lib/crypto/key-encrypt");
// --- Fallbacks (used when tier_limits table is not yet seeded) ---------------
const FALLBACK_MONTHLY = {
    free: { automated: 10, email: 5, manual: 5 },
    starter: { automated: 50, email: 20, manual: 10 },
    professional: { automated: 200, email: 100, manual: 50 },
    enterprise: { automated: 1000, email: 500, manual: -1 },
    consultant: { automated: -1, email: -1, manual: -1 },
};
const FALLBACK_DAILY = {
    free: 2, starter: 5, professional: 15, enterprise: 50, consultant: 20,
};
// --- Helpers -----------------------------------------------------------------
function getMonthStart(ref) {
    const d = ref ?? new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function getMonthEnd(ref) {
    const d = ref ?? new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}
function monthlyLimitFor(limits, type) {
    if (type === 'email')
        return limits.monthly_email;
    if (type === 'manual')
        return limits.monthly_manual;
    return limits.monthly_automated;
}
function monthlyCountFor(usage, type) {
    if (type === 'email')
        return usage.email_count;
    if (type === 'manual')
        return usage.manual_count;
    return usage.automated_count;
}
function countFieldFor(type) {
    if (type === 'email')
        return 'email_count';
    if (type === 'manual')
        return 'manual_count';
    return 'automated_count';
}
function overageFieldFor(type) {
    return type === 'email' ? 'overage_email' : 'overage_automated';
}
function overageRateFor(limits, type) {
    return type === 'email' ? limits.overage_rate_email : limits.overage_rate_automated;
}
function currentOverageCount(usage, type) {
    return type === 'email' ? usage.overage_email : usage.overage_automated;
}
// --- UsageMeter --------------------------------------------------------------
class UsageMeter {
    /**
     * Check whether an org is allowed to make a submission.
     * Daily cap is a hard block. Monthly cap blocks unless overages are enabled
     * (indicated by the presence of a Stripe customer ID).
     */
    async checkAllowance(orgId, submissionType, supabase) {
        // 1. Get org tier
        const { data: orgRow } = await supabase
            .from('organizations')
            .select('subscription_tier')
            .eq('id', orgId)
            .maybeSingle();
        const tier = orgRow?.subscription_tier ?? 'starter';
        // 2. Get tier limits (fall back to hardcoded defaults if table not seeded)
        const { data: limitsRow } = await supabase
            .from('tier_limits')
            .select('*')
            .eq('tier_name', tier)
            .maybeSingle();
        const limits = limitsRow;
        const monthlyLimit = limits
            ? monthlyLimitFor(limits, submissionType)
            : (FALLBACK_MONTHLY[tier]?.[submissionType] ?? 50);
        const dailyMax = limits?.daily_max ?? (FALLBACK_DAILY[tier] ?? 5);
        // 3. Monthly count from submission_usage for current period
        const periodStart = getMonthStart();
        const { data: usageRow } = await supabase
            .from('submission_usage')
            .select('*')
            .eq('organization_id', orgId)
            .eq('period_start', periodStart.toISOString())
            .maybeSingle();
        const usage = usageRow;
        const monthlyCount = usage ? monthlyCountFor(usage, submissionType) : 0;
        // 4. Daily count (hard cap — query actual submission records for today)
        const todayStart = new Date();
        todayStart.setUTCHours(0, 0, 0, 0);
        const { count: rawDailyCount } = await supabase
            .from('autoapply_submissions')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', orgId)
            .gte('submitted_at', todayStart.toISOString());
        const dailyCount = rawDailyCount ?? 0;
        if (dailyMax !== -1 && dailyCount >= dailyMax) {
            return {
                allowed: false,
                remaining: 0,
                atLimit: true,
                overageEnabled: false,
                dailyCount,
                dailyLimit: dailyMax,
                monthlyCount,
                monthlyLimit,
            };
        }
        // 5. Monthly limit check
        const unlimited = monthlyLimit === -1;
        const atLimit = !unlimited && monthlyCount >= monthlyLimit;
        const remaining = unlimited ? 999999 : Math.max(0, monthlyLimit - monthlyCount);
        // Overages are enabled if the org has a Stripe customer on file
        let overageEnabled = false;
        if (atLimit) {
            const { data: billingRow } = await supabase
                .from('organizations')
                .select('stripe_customer_id')
                .eq('id', orgId)
                .maybeSingle();
            overageEnabled = Boolean(billingRow?.stripe_customer_id);
        }
        return {
            allowed: !atLimit || overageEnabled,
            remaining,
            atLimit,
            overageEnabled,
            dailyCount,
            dailyLimit: dailyMax,
            monthlyCount,
            monthlyLimit,
        };
    }
    /**
     * Increment submission counts and accumulate API/proxy/CAPTCHA costs for
     * the current billing period. Creates the period row if it doesn't exist.
     */
    async recordUsage(orgId, submissionType, costs, supabase) {
        const periodStart = getMonthStart();
        const periodEnd = getMonthEnd();
        // Get tier limits for overage rate
        const { data: orgRow } = await supabase
            .from('organizations')
            .select('subscription_tier')
            .eq('id', orgId)
            .maybeSingle();
        const tier = orgRow?.subscription_tier ?? 'starter';
        const { data: limitsRow } = await supabase
            .from('tier_limits')
            .select('*')
            .eq('tier_name', tier)
            .maybeSingle();
        const limits = limitsRow;
        // Fetch current period record
        const { data: usageRow } = await supabase
            .from('submission_usage')
            .select('*')
            .eq('organization_id', orgId)
            .eq('period_start', periodStart.toISOString())
            .maybeSingle();
        const existing = usageRow;
        const cf = countFieldFor(submissionType);
        const of_ = overageFieldFor(submissionType);
        const safeType = (submissionType === 'email' || submissionType === 'manual')
            ? submissionType
            : 'automated';
        const currentCount = existing ? monthlyCountFor(existing, safeType) : 0;
        const monthlyLimit = limits ? monthlyLimitFor(limits, safeType) : -1;
        const isOverage = monthlyLimit !== -1 && currentCount >= monthlyLimit;
        const ovRate = limits ? overageRateFor(limits, submissionType) : 0;
        if (existing === null) {
            const insert = {
                organization_id: orgId,
                period_start: periodStart.toISOString(),
                period_end: periodEnd.toISOString(),
                [cf]: 1,
                api_cost_claude: costs.claude ?? 0,
                api_cost_openai: costs.openai ?? 0,
                proxy_cost: costs.proxy ?? 0,
                captcha_cost: costs.captcha ?? 0,
            };
            if (isOverage) {
                insert[of_] = 1;
                insert['overage_cost'] = ovRate;
            }
            await supabase.from('submission_usage').insert(insert);
        }
        else {
            const update = {
                [cf]: currentCount + 1,
                api_cost_claude: (existing.api_cost_claude ?? 0) + (costs.claude ?? 0),
                api_cost_openai: (existing.api_cost_openai ?? 0) + (costs.openai ?? 0),
                proxy_cost: (existing.proxy_cost ?? 0) + (costs.proxy ?? 0),
                captcha_cost: (existing.captcha_cost ?? 0) + (costs.captcha ?? 0),
            };
            if (isOverage) {
                update[of_] = currentOverageCount(existing, submissionType) + 1;
                update['overage_cost'] = (existing.overage_cost ?? 0) + ovRate;
            }
            await supabase
                .from('submission_usage')
                .update(update)
                .eq('id', existing.id);
        }
    }
    /**
     * Return a full usage report for the given org and period (defaults to current month).
     */
    async getUsageReport(orgId, periodStart, supabase) {
        const start = periodStart ? getMonthStart(periodStart) : getMonthStart();
        const end = getMonthEnd(start);
        const { data: usageRow } = await supabase
            .from('submission_usage')
            .select('*')
            .eq('organization_id', orgId)
            .eq('period_start', start.toISOString())
            .maybeSingle();
        const usage = usageRow;
        const { data: orgRow } = await supabase
            .from('organizations')
            .select('subscription_tier')
            .eq('id', orgId)
            .maybeSingle();
        const tier = orgRow?.subscription_tier ?? 'starter';
        const { data: limitsRow } = await supabase
            .from('tier_limits')
            .select('*')
            .eq('tier_name', tier)
            .maybeSingle();
        const limits = limitsRow;
        return {
            period_start: start.toISOString(),
            period_end: end.toISOString(),
            automated_count: usage?.automated_count ?? 0,
            email_count: usage?.email_count ?? 0,
            manual_count: usage?.manual_count ?? 0,
            overage_automated: usage?.overage_automated ?? 0,
            overage_email: usage?.overage_email ?? 0,
            overage_cost: usage?.overage_cost ?? 0,
            api_cost_claude: usage?.api_cost_claude ?? 0,
            api_cost_openai: usage?.api_cost_openai ?? 0,
            proxy_cost: usage?.proxy_cost ?? 0,
            captcha_cost: usage?.captcha_cost ?? 0,
            using_own_keys: usage?.using_own_keys ?? false,
            limits: limits
                ? {
                    monthly_automated: limits.monthly_automated,
                    monthly_email: limits.monthly_email,
                    monthly_manual: limits.monthly_manual,
                    daily_max: limits.daily_max,
                    allow_own_keys: limits.allow_own_keys,
                }
                : null,
        };
    }
    /**
     * Returns whether this org's tier allows own API keys, and what keys are
     * stored. Keys are stored (AES-256-GCM encrypted) in platform_config under
     * key = 'own_key_anthropic' | 'own_key_openai' by
     * POST /api/autoapply/usage/keys — NOT in integration_keys (that table's
     * integration_service enum has no 'anthropic'/'openai' values, so a lookup
     * there always returned empty regardless of what the org had saved).
     */
    async shouldUseOwnKeys(orgId, supabase) {
        const { data: orgRow } = await supabase
            .from('organizations')
            .select('subscription_tier')
            .eq('id', orgId)
            .maybeSingle();
        const tier = orgRow?.subscription_tier ?? 'starter';
        const { data: limitsRow } = await supabase
            .from('tier_limits')
            .select('allow_own_keys')
            .eq('tier_name', tier)
            .maybeSingle();
        const allowOwnKeys = limitsRow?.allow_own_keys ?? false;
        if (!allowOwnKeys) {
            return { useOwn: false };
        }
        const { data: keyRows } = await supabase
            .from('platform_config')
            .select('key, value')
            .eq('organization_id', orgId)
            .in('key', ['own_key_anthropic', 'own_key_openai']);
        const rowMap = new Map((keyRows ?? []).map((r) => [r.key, r.value]));
        const decryptOrUndefined = (ciphertext) => {
            if (!ciphertext)
                return undefined;
            try {
                return (0, key_encrypt_1.decryptKey)(ciphertext);
            }
            catch {
                return undefined;
            }
        };
        const anthropicKey = decryptOrUndefined(rowMap.get('own_key_anthropic'));
        const openaiKey = decryptOrUndefined(rowMap.get('own_key_openai'));
        return {
            useOwn: Boolean(anthropicKey ?? openaiKey),
            anthropicKey,
            openaiKey,
        };
    }
}
exports.UsageMeter = UsageMeter;
