"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.annotateErrorScreenshot = annotateErrorScreenshot;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
let _client = null;
function getClaude() {
    if (_client)
        return _client;
    const apiKey = process.env['ANTHROPIC_API_KEY'];
    if (!apiKey)
        throw new Error('ANTHROPIC_API_KEY is not set');
    _client = new sdk_1.default({ apiKey });
    return _client;
}
/**
 * Uses Claude vision to analyze an error screenshot and return a concise
 * diagnostic annotation describing what went wrong and how to fix it.
 * The caller is responsible for storing the returned annotation string
 * in autoapply_screenshots.metadata.
 */
async function annotateErrorScreenshot(params) {
    const { screenshotBuffer, errorMessage, pageUrl } = params;
    const base64 = screenshotBuffer.toString('base64');
    const message = await getClaude().messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 512,
        messages: [
            {
                role: 'user',
                content: [
                    {
                        type: 'image',
                        source: {
                            type: 'base64',
                            media_type: 'image/png',
                            data: base64,
                        },
                    },
                    {
                        type: 'text',
                        text: `This is a screenshot of a web form submission that failed with the error: '${errorMessage}'. Page URL: ${pageUrl}. Analyze the screenshot and describe: 1) What specific error is shown on the page? 2) Which form field caused the error (if visible)? 3) What is the most likely fix? Return a concise annotation in 2-3 sentences.`,
                    },
                ],
            },
        ],
    });
    const annotation = message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');
    return annotation;
}
