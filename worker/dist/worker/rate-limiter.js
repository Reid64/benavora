"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RateLimiter = void 0;
const index_js_1 = require("./index.js");
const ONE_HOUR_MS = 60 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * ONE_HOUR_MS;
const BASE_DELAY_MS = 60 * 1000;
const MAX_JITTER_MS = 60 * 1000;
function humanReadable(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes === 0)
        return `${seconds}s`;
    return `${minutes}m ${seconds}s`;
}
class RateLimiter {
    async waitBetweenSubmissions() {
        const jitter = Math.floor(Math.random() * (MAX_JITTER_MS + 1));
        const delay = BASE_DELAY_MS + jitter;
        console.log(`[RateLimiter] Waiting ${humanReadable(delay)} before next submission`);
        await new Promise((resolve) => setTimeout(resolve, delay));
    }
    async canSubmitToDomain(funderId) {
        const cutoff = new Date(Date.now() - TWENTY_FOUR_HOURS_MS).toISOString();
        const { data, error } = await index_js_1.supabase
            .from('autoapply_submissions')
            .select('submitted_at')
            .eq('funder_id', funderId)
            .not('submitted_at', 'is', null)
            .gt('submitted_at', cutoff)
            .order('submitted_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (error) {
            console.error(`[RateLimiter] Error checking submission history for funder ${funderId}:`, error.message);
            return true;
        }
        if (data !== null) {
            const lastSubmitted = data.submitted_at;
            const hoursAgo = ((Date.now() - new Date(lastSubmitted).getTime()) / ONE_HOUR_MS).toFixed(1);
            console.log(`[RateLimiter] Funder ${funderId} was submitted to ${hoursAgo}h ago — skipping (24h cooldown)`);
            return false;
        }
        return true;
    }
    getBackoffDelay(errorType, retryCount) {
        switch (errorType) {
            case 'site_error':
            case 'timeout': {
                const delay = ONE_HOUR_MS * Math.pow(2, retryCount);
                const capped = Math.min(delay, TWENTY_FOUR_HOURS_MS);
                console.log(`[RateLimiter] Backoff for ${errorType} (retry ${retryCount}): ${humanReadable(capped)}`);
                return capped;
            }
            case 'form_changed':
                console.log(`[RateLimiter] Backoff for form_changed: immediate retry`);
                return 0;
            case 'captcha_blocked':
                console.log(`[RateLimiter] Backoff for captcha_blocked: no auto-retry`);
                return -1;
            case 'captcha_failed':
                console.log(`[RateLimiter] Backoff for captcha_failed: no auto-retry`);
                return -1;
            case 'account_required':
                console.log(`[RateLimiter] Backoff for account_required: no auto-retry`);
                return -1;
            default:
                console.log(`[RateLimiter] Unknown error type "${errorType}" — defaulting to 1h backoff`);
                return ONE_HOUR_MS;
        }
    }
}
exports.RateLimiter = RateLimiter;
