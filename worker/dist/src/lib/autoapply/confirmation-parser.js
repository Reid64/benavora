"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseConfirmationPage = parseConfirmationPage;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
let _client = null;
function getClaude() {
    if (!_client) {
        const apiKey = process.env["ANTHROPIC_API_KEY"];
        if (!apiKey)
            throw new Error("ANTHROPIC_API_KEY is not set");
        _client = new sdk_1.default({ apiKey });
    }
    return _client;
}
const EMPTY_CONFIRMATION = {
    confirmation_number: null,
    reference_id: null,
    expected_response_date: null,
    next_steps: null,
    thank_you_message: null,
    contact_for_questions: null,
};
async function parseConfirmationPage(page) {
    const p = page;
    // Capture screenshot for reference (non-blocking if it fails)
    try {
        await p.screenshot({ type: "png", fullPage: true });
    }
    catch {
        // Screenshot failure should not abort parsing
    }
    let pageText = "";
    try {
        pageText = await p.evaluate(() => document.body?.innerText ?? "");
    }
    catch {
        return { ...EMPTY_CONFIRMATION };
    }
    if (!pageText.trim()) {
        return { ...EMPTY_CONFIRMATION };
    }
    const claude = getClaude();
    const response = await claude.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 512,
        messages: [
            {
                role: "user",
                content: `Extract the following from this confirmation page text. Return JSON only with no markdown or explanation:
{
  "confirmation_number": "<confirmation or submission number, or null>",
  "reference_id": "<reference or tracking ID if different from confirmation_number, or null>",
  "expected_response_date": "<date or timeframe for expected response/decision, or null>",
  "next_steps": "<any next steps or follow-up instructions described, or null>",
  "thank_you_message": "<the thank-you or acknowledgment message shown to the applicant, or null>",
  "contact_for_questions": "<email, phone, or name of person/team to contact with questions, or null>"
}

If a field is not present in the text, set it to null. Do not fabricate values.

Page text:
${pageText.slice(0, 6000)}`,
            },
        ],
    });
    const raw = response.content[0]?.type === "text" ? response.content[0].text : "";
    try {
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch)
            return { ...EMPTY_CONFIRMATION };
        const parsed = JSON.parse(jsonMatch[0]);
        return {
            confirmation_number: parsed.confirmation_number ?? null,
            reference_id: parsed.reference_id ?? null,
            expected_response_date: parsed.expected_response_date ?? null,
            next_steps: parsed.next_steps ?? null,
            thank_you_message: parsed.thank_you_message ?? null,
            contact_for_questions: parsed.contact_for_questions ?? null,
        };
    }
    catch {
        return { ...EMPTY_CONFIRMATION };
    }
}
