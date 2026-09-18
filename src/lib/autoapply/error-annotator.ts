import Anthropic from '@anthropic-ai/sdk';
import { createTrackedAnthropic } from "@/lib/ai/tracked-anthropic";
import { withClaudeLimit } from './claude-concurrency';

let _client: Anthropic | null = null;

function getClaude(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  _client = createTrackedAnthropic({ apiKey }, "error-annotator");
  return _client;
}

/**
 * Uses Claude vision to analyze an error screenshot and return a concise
 * diagnostic annotation describing what went wrong and how to fix it.
 * The caller is responsible for storing the returned annotation string
 * in autoapply_screenshots.metadata.
 */
export async function annotateErrorScreenshot(params: {
  screenshotBuffer: Buffer;
  errorMessage: string;
  pageUrl: string;
}): Promise<string> {
  const { screenshotBuffer, errorMessage, pageUrl } = params;

  const base64 = screenshotBuffer.toString('base64');

  const message = await withClaudeLimit(() =>
    getClaude().messages.create({
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
    }),
  );

  const annotation = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');

  return annotation;
}
