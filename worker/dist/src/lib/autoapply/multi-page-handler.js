"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MultiPageFormHandler = void 0;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
class MultiPageFormHandler {
    claude;
    constructor() {
        this.claude = new sdk_1.default();
    }
    async detectMultiPage(page) {
        const result = await page.evaluate(() => {
            let nextButton = null;
            const buttons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"]'));
            for (const btn of buttons) {
                const text = (btn.textContent ??
                    btn.value ??
                    '')
                    .toLowerCase()
                    .trim();
                if (text === 'next' ||
                    text === 'continue' ||
                    text === 'next step' ||
                    text === 'proceed') {
                    const id = btn.id ? `#${btn.id}` : null;
                    const cls = btn.className
                        ? `.${btn.className.trim().split(/\s+/)[0]}`
                        : null;
                    nextButton = id ?? cls ?? 'button:has-text("Next")';
                    break;
                }
            }
            const stepMatch = document.body.innerText.match(/step\s+(\d+)\s+of\s+(\d+)/i);
            const pageMatch = document.body.innerText.match(/page\s+(\d+)\s+of\s+(\d+)/i);
            const match = stepMatch ?? pageMatch;
            const progressBar = document.querySelector('[role="progressbar"], .progress-bar, .wizard-progress');
            const wizardSteps = document.querySelectorAll('[data-step], .wizard-step, .form-step');
            const formDataStep = document.querySelector('form[data-step]');
            const isMultiPage = !!(nextButton ||
                match ||
                progressBar ||
                wizardSteps.length > 1 ||
                formDataStep);
            return {
                isMultiPage,
                currentPage: match ? parseInt(match[1] ?? '1', 10) : undefined,
                pageCount: match
                    ? parseInt(match[2] ?? '1', 10)
                    : wizardSteps.length > 1
                        ? wizardSteps.length
                        : undefined,
                nextButton: nextButton ?? undefined,
                progressIndicator: progressBar
                    ? progressBar.className || 'progressbar'
                    : undefined,
            };
        });
        // Use Claude as a fallback when the structural heuristics are inconclusive
        if (!result.isMultiPage && !result.nextButton) {
            const snippet = (await page.content()).slice(0, 6000);
            try {
                const message = await this.claude.messages.create({
                    model: 'claude-sonnet-4-6',
                    max_tokens: 256,
                    messages: [
                        {
                            role: 'user',
                            content: `Analyze this HTML snippet. Answer ONLY with valid JSON (no markdown): {"isMultiPage":boolean,"pageCount":number|null,"currentPage":number|null,"nextButtonSelector":string|null}. Is this a multi-page or multi-step form? If so, how many pages/steps? What CSS selector targets the "Next" or "Continue" button?\n${snippet}`,
                        },
                    ],
                });
                const raw = message.content[0]?.type === 'text' ? message.content[0].text.trim() : '{}';
                const parsed = JSON.parse(raw);
                if (parsed.isMultiPage) {
                    return {
                        isMultiPage: true,
                        pageCount: parsed.pageCount ?? undefined,
                        currentPage: parsed.currentPage ?? undefined,
                        nextButton: parsed.nextButtonSelector ?? undefined,
                        progressIndicator: result.progressIndicator,
                    };
                }
            }
            catch {
                // Ignore Claude errors — fall through to heuristic result
            }
        }
        return result;
    }
    async navigateToNextPage(page, nextButtonSelector) {
        try {
            const beforeUrl = page.url();
            const beforeFields = await page.$$('input:visible, select:visible, textarea:visible');
            const beforeCount = beforeFields.length;
            await page.click(nextButtonSelector);
            await Promise.race([
                page.waitForNavigation({ timeout: 5000 }).catch(() => null),
                page
                    .waitForSelector('input:visible, select:visible', { timeout: 5000 })
                    .catch(() => null),
            ]);
            const afterUrl = page.url();
            const afterFields = await page.$$('input:visible, select:visible, textarea:visible');
            const afterCount = afterFields.length;
            if (afterUrl !== beforeUrl)
                return true;
            if (afterCount !== beforeCount)
                return true;
            const validationError = await page.$('[class*="error"]:visible, [class*="invalid"]:visible, [role="alert"]:visible');
            if (validationError)
                return false;
            return afterCount > 0;
        }
        catch {
            return false;
        }
    }
    async getAllPages(page) {
        const pages = [];
        let pageNumber = 1;
        const maxPages = 20;
        while (pageNumber <= maxPages) {
            const fields = await page
                .$$eval('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea', (elements) => elements
                .filter((el) => {
                const style = window.getComputedStyle(el);
                return style.display !== 'none' && style.visibility !== 'hidden';
            })
                .map((el) => {
                const input = el;
                const id = input.id ? `#${input.id}` : '';
                const name = input.name ? `[name="${input.name}"]` : '';
                const selector = id || name || el.tagName.toLowerCase();
                const labelEl = input.id
                    ? document.querySelector(`label[for="${input.id}"]`)
                    : null;
                const label = labelEl?.textContent?.trim() ??
                    input.getAttribute('placeholder') ??
                    input.name ??
                    '';
                const type = 'type' in input
                    ? input.type
                    : el.tagName.toLowerCase();
                return { selector, type, label, required: input.required };
            }))
                .catch(() => []);
            const info = await this.detectMultiPage(page);
            pages.push({
                pageNumber,
                fields,
                nextButtonSelector: info.nextButton ?? null,
            });
            if (!info.isMultiPage || !info.nextButton)
                break;
            const advanced = await this.navigateToNextPage(page, info.nextButton);
            if (!advanced)
                break;
            pageNumber++;
        }
        return pages;
    }
}
exports.MultiPageFormHandler = MultiPageFormHandler;
