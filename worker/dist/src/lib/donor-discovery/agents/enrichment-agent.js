"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EnrichmentAgent = exports.donorDiscoveryEvents = void 0;
const node_events_1 = require("node:events");
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const cheerio = __importStar(require("cheerio"));
const admin_1 = require("@/lib/supabase/admin");
const crawler_core_1 = require("@/lib/donor-discovery/crawler-core");
/**
 * Donor Discovery §2B enrichment agent (DONOR_DISCOVERY_ARCHITECTURE.md §2B,
 * AGENTS.md agent conventions).
 *
 * Distinct from `src/lib/enrichment/web-extractor.ts`'s `donor_prospect`
 * schema: this agent visits exactly one page (the directory record's
 * `website`, no subpage crawl), extracts a richer field set that also
 * includes `in_kind_history_signals` and `company_size_estimate`, and always
 * persists an outcome — including `skip_reason`/`error_reason` — onto the
 * shared `donor_discovery_directory` row rather than only returning a
 * result for the caller to persist.
 *
 * Worker-safe: no module-load side effects (the Anthropic client and the
 * default Supabase client are both built lazily), and the only network
 * access goes through crawler-core's `fetchCompliant` — never a bare
 * `fetch` — so the same rate limiting, robots.txt, and ToS checks apply
 * regardless of caller.
 */
const CLAUDE_MODEL = "claude-sonnet-4-6";
const CLAUDE_MAX_TOKENS = 1000;
const FETCH_TIMEOUT_MS = 5_000;
const USER_AGENT = "Benavora Platform enrichment@benavora.com";
const MAX_TEXT_CHARS = 20_000;
const ADAPTER_NAME = "enrichment-agent";
/** Emitted when enrichment finds a live donation/sponsorship form — the
 * signal DONOR_DISCOVERY_ARCHITECTURE.md §7 uses to offer "Queue in
 * AutoApply". Directory records are shared/platform-wide and carry no
 * organization_id, so this agent only emits the signal; turning it into an
 * actual `submission_queue` item for a specific org's funder record is a
 * caller/UI concern (the architecture doc describes it as an explicit
 * operator action, not an automatic one). */
exports.donorDiscoveryEvents = new node_events_1.EventEmitter();
// ── Anthropic client (lazy — no module-load side effects) ──────────────────
let anthropicClient = null;
function getClient() {
    if (anthropicClient)
        return anthropicClient;
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        throw new Error("Missing ANTHROPIC_API_KEY");
    }
    anthropicClient = new sdk_1.default({ apiKey });
    return anthropicClient;
}
// ── Empty/default record ─────────────────────────────────────────────────────
function emptyRecord() {
    return {
        has_giving_program: false,
        has_donation_form: false,
        donation_form_url: null,
        csr_page_url: null,
        giving_focus_areas: [],
        in_kind_history_signals: [],
        decision_contacts: [],
        service_area: "",
        company_size_estimate: null,
    };
}
// ── Enrichment jsonb merge ───────────────────────────────────────────────────
/**
 * A fresh non-empty value always wins; a fresh null/empty value only fills
 * a gap, it never clobbers existing data. Mirrors
 * `worker/dd-request-processor.ts`'s `mergeEnrichment` (duplicated rather
 * than shared, matching this codebase's existing convention of not sharing
 * small private helpers across donor-discovery modules).
 */
function mergeEnrichment(existing, fresh) {
    const merged = { ...(existing ?? {}) };
    for (const [key, value] of Object.entries(fresh)) {
        const isEmpty = value === null || value === undefined || (Array.isArray(value) && value.length === 0);
        if (isEmpty && merged[key] !== undefined && merged[key] !== null)
            continue;
        merged[key] = value;
    }
    return merged;
}
// ── Website text extraction ─────────────────────────────────────────────────
function htmlToCleanText(html) {
    const $ = cheerio.load(html);
    $("script, style, noscript, svg").remove();
    return $("body").text().replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_CHARS);
}
// ── Prompt ───────────────────────────────────────────────────────────────────
const JSON_SHAPE = `{
  "has_giving_program": boolean,
  "has_donation_form": boolean,
  "donation_form_url": string | null,
  "csr_page_url": string | null,
  "giving_focus_areas": string[],
  "in_kind_history_signals": string[],
  "decision_contacts": [{ "name": string, "title": string, "email": string | null, "phone": string | null }],
  "service_area": string,
  "company_size_estimate": "small" | "medium" | "large" | "enterprise"
}`;
function buildPrompt(legalName, siteText) {
    return `You are extracting structured facts about a potential corporate/business donor, "${legalName}", from its own website text, for a nonprofit's donor prospecting tool. Read the text below and return ONLY a single JSON object matching this exact shape — no prose, no markdown code fences, no explanation. Response must be valid JSON only.

${JSON_SHAPE}

Rules:
- has_giving_program: true if the company describes any charitable giving, sponsorship, community investment, or philanthropy program; false if there is no such evidence.
- has_donation_form: true only if a donation/sponsorship request form or application is described or linked; donation_form_url is that form's absolute URL if found, else null.
- csr_page_url is the absolute URL of a dedicated CSR/community/giving-back page if one exists, else null.
- giving_focus_areas defaults to [] when nothing is found — never omit the key.
- in_kind_history_signals captures evidence of non-cash giving: material/equipment/product donations, sponsorships, volunteer programs, or press mentions of donated goods or services. Defaults to [] when nothing is found.
- decision_contacts should list named individuals (with title, and email/phone only if published) who appear responsible for giving/sponsorship/community-relations decisions — do not include generic sales/support contacts. Defaults to [].
- service_area is a short description of the geographic area the company serves or operates in, or "" if there is no evidence.
- company_size_estimate must be exactly one of "small", "medium", "large", "enterprise", based on any evidence of employee count, revenue, or number of locations. Make your best estimate from context rather than "small" by default.
- Do not invent facts that are not present in the text.

WEBSITE TEXT:
${siteText}`;
}
// ── JSON response parsing ────────────────────────────────────────────────────
function stripCodeFences(text) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    return (fenced?.[1] ?? text).trim();
}
function extractJsonObject(text) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1 || end < start)
        return text;
    return text.slice(start, end + 1);
}
function asStringOrNull(v) {
    return typeof v === "string" && v.trim() ? v.trim() : null;
}
function asBoolOrDefault(v, fallback) {
    return typeof v === "boolean" ? v : fallback;
}
function asStringArray(v) {
    if (!Array.isArray(v))
        return [];
    return v.filter((x) => typeof x === "string" && x.trim().length > 0);
}
const VALID_SIZES = ["small", "medium", "large", "enterprise"];
function asCompanySizeOrNull(v) {
    return typeof v === "string" && VALID_SIZES.includes(v) ? v : null;
}
function asDecisionContacts(v) {
    if (!Array.isArray(v))
        return [];
    const out = [];
    for (const item of v) {
        if (!item || typeof item !== "object")
            continue;
        const rec = item;
        const name = asStringOrNull(rec.name);
        if (!name)
            continue;
        const contact = { name, title: asStringOrNull(rec.title) ?? "" };
        const email = asStringOrNull(rec.email);
        const phone = asStringOrNull(rec.phone);
        if (email)
            contact.email = email;
        if (phone)
            contact.phone = phone;
        out.push(contact);
    }
    return out;
}
/** Parses and coerces Claude's raw text response into an `EnrichmentRecord`. Never throws — an unparseable response is reported via `error_reason`. */
function parseEnrichmentResponse(rawText) {
    const candidate = extractJsonObject(stripCodeFences(rawText));
    let value;
    try {
        value = JSON.parse(candidate);
    }
    catch (err) {
        return {
            ...emptyRecord(),
            error_reason: `invalid_json_response: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return { ...emptyRecord(), error_reason: "claude_response_not_a_json_object" };
    }
    const obj = value;
    return {
        has_giving_program: asBoolOrDefault(obj.has_giving_program, false),
        has_donation_form: asBoolOrDefault(obj.has_donation_form, false),
        donation_form_url: asStringOrNull(obj.donation_form_url),
        csr_page_url: asStringOrNull(obj.csr_page_url),
        giving_focus_areas: asStringArray(obj.giving_focus_areas),
        in_kind_history_signals: asStringArray(obj.in_kind_history_signals),
        decision_contacts: asDecisionContacts(obj.decision_contacts),
        service_area: asStringOrNull(obj.service_area) ?? "",
        company_size_estimate: asCompanySizeOrNull(obj.company_size_estimate),
    };
}
// ── EnrichmentAgent ──────────────────────────────────────────────────────────
class EnrichmentAgent {
    supabase;
    constructor(supabase) {
        this.supabase = supabase ?? (0, admin_1.createAdminClient)();
    }
    /**
     * Enriches one `donor_discovery_directory` record by id. Always resolves
     * (never rejects) — network timeouts, robots/ToS blocks, and Claude API
     * errors are all captured in the returned record's `error_reason` and the
     * directory row is still upserted with `enriched_at` set to now, so a
     * failing site doesn't get retried again until the next TTL window.
     */
    async enrich(directoryId) {
        try {
            const { data, error } = await this.supabase
                .from("donor_discovery_directory")
                .select("id, legal_name, website, enrichment")
                .eq("id", directoryId)
                .maybeSingle();
            if (error || !data) {
                return { ...emptyRecord(), error_reason: `directory_not_found: ${error?.message ?? "no row"}` };
            }
            const row = data;
            if (!row.website) {
                const record = { ...emptyRecord(), skip_reason: "no_website" };
                await this.persistReasonOnly(row, "skip_reason", "no_website");
                return record;
            }
            const fetchResult = await (0, crawler_core_1.fetchCompliant)(row.website, {
                adapterName: ADAPTER_NAME,
                userAgent: USER_AGENT,
                timeoutMs: FETCH_TIMEOUT_MS,
            });
            if (!fetchResult.ok || !fetchResult.html) {
                const reason = fetchResult.blockedReason ?? `fetch_failed_status_${fetchResult.status}`;
                const record = { ...emptyRecord(), error_reason: reason };
                await this.persistReasonOnly(row, "error_reason", reason);
                return record;
            }
            const siteText = htmlToCleanText(fetchResult.html);
            if (!siteText) {
                const record = { ...emptyRecord(), error_reason: "no_extractable_text" };
                await this.persistReasonOnly(row, "error_reason", "no_extractable_text");
                return record;
            }
            let record;
            try {
                const message = await getClient().messages.create({
                    model: CLAUDE_MODEL,
                    max_tokens: CLAUDE_MAX_TOKENS,
                    temperature: 0,
                    messages: [{ role: "user", content: buildPrompt(row.legal_name, siteText) }],
                });
                const rawText = message.content
                    .filter((block) => block.type === "text")
                    .map((block) => block.text)
                    .join("");
                record = parseEnrichmentResponse(rawText);
            }
            catch (err) {
                record = {
                    ...emptyRecord(),
                    error_reason: `claude_api_error: ${err instanceof Error ? err.message : String(err)}`,
                };
            }
            if (record.error_reason) {
                await this.persistReasonOnly(row, "error_reason", record.error_reason);
            }
            else {
                await this.persistSuccess(row, record);
                if (record.has_donation_form) {
                    exports.donorDiscoveryEvents.emit("donation_form_found", {
                        directoryId: row.id,
                        legalName: row.legal_name,
                        donationFormUrl: record.donation_form_url,
                    });
                }
            }
            return record;
        }
        catch (err) {
            return {
                ...emptyRecord(),
                error_reason: `unexpected_error: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    }
    /** Merges a successful extraction into `enrichment`, clearing any stale skip/error reason. */
    async persistSuccess(row, record) {
        const nowIso = new Date().toISOString();
        const { skip_reason: _skip, error_reason: _err, ...extraction } = record;
        const withoutStaleReasons = { ...(row.enrichment ?? {}) };
        delete withoutStaleReasons.skip_reason;
        delete withoutStaleReasons.error_reason;
        const merged = mergeEnrichment(withoutStaleReasons, { ...extraction, extracted_at: nowIso });
        await this.updateDirectory(row.id, merged, nowIso);
    }
    /** Records a skip/error reason without touching any previously extracted fields. */
    async persistReasonOnly(row, reasonKey, reasonValue) {
        const nowIso = new Date().toISOString();
        const merged = { ...(row.enrichment ?? {}), [reasonKey]: reasonValue };
        await this.updateDirectory(row.id, merged, nowIso);
    }
    async updateDirectory(directoryId, enrichment, enrichedAt) {
        const { error } = await this.supabase
            .from("donor_discovery_directory")
            .update({ enrichment, enriched_at: enrichedAt })
            .eq("id", directoryId);
        if (error) {
            console.error(`[EnrichmentAgent] Failed to persist enrichment for ${directoryId}: ${error.message}`);
        }
    }
}
exports.EnrichmentAgent = EnrichmentAgent;
