import type { Page } from 'playwright';

export class AdvancedFieldHandler {
  async fillSelect(page: Page, selector: string, value: string): Promise<boolean> {
    try {
      const options = await page.evaluate((sel: string) => {
        const el = document.querySelector(sel) as HTMLSelectElement | null;
        if (!el) return [];
        return Array.from(el.options).map((o) => ({ value: o.value, text: o.text }));
      }, selector);

      const exact = options.find(
        (o) => o.value === value || o.text.toLowerCase() === value.toLowerCase(),
      );

      if (exact) {
        await page.selectOption(selector, exact.value);
        return true;
      }

      const lower = value.toLowerCase();
      const closest = options.reduce(
        (best, o) => {
          const score = this.similarity(o.text.toLowerCase(), lower);
          return score > best.score ? { option: o, score } : best;
        },
        { option: options[0], score: 0 },
      );

      if (closest.option && closest.score > 0.4) {
        await page.selectOption(selector, closest.option.value);
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  async fillCheckbox(page: Page, selector: string, shouldCheck: boolean): Promise<void> {
    const isChecked = await page.isChecked(selector).catch(() => false);
    if (isChecked !== shouldCheck) {
      await page.click(selector);
    }
  }

  async fillRadio(page: Page, name: string, value: string): Promise<void> {
    const selector = `input[type="radio"][name="${name}"][value="${value}"]`;
    const fallback = `input[type="radio"][name="${name}"]`;

    const found = await page.$(selector);
    if (found) {
      await page.click(selector);
      return;
    }

    const radios = await page.$$(fallback);
    for (const radio of radios) {
      const label = await radio.evaluate((el) => {
        const id = el.id;
        if (id) {
          const lbl = document.querySelector(`label[for="${id}"]`);
          return lbl?.textContent?.trim() ?? null;
        }
        return el.closest('label')?.textContent?.trim() ?? null;
      });
      if (label?.toLowerCase().includes(value.toLowerCase())) {
        await radio.click();
        return;
      }
    }
  }

  async fillDatePicker(page: Page, selector: string, date: string): Promise<boolean> {
    try {
      await page.fill(selector, date);
      await page.keyboard.press('Tab');

      const confirmedValue = await page.$eval(
        selector,
        (el) => (el as HTMLInputElement).value,
      ).catch(() => '');

      if (confirmedValue && confirmedValue !== '') return true;

      await page.click(selector);
      await page.waitForTimeout(500);

      const dateObj = new Date(date);
      if (isNaN(dateObj.getTime())) return false;

      const daySelector = `[class*="flatpickr-day"], [class*="pika-button"], [class*="ui-datepicker-calendar"] td a`;
      const day = dateObj.getDate().toString();

      const dayEl = await page.$$eval(
        daySelector,
        (els, d) => {
          const match = els.find((e) => e.textContent?.trim() === d);
          return match ? true : false;
        },
        day,
      ).catch(() => false);

      if (dayEl) {
        await page.locator(daySelector).filter({ hasText: new RegExp(`^${day}$`) }).first().click();
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  async fillFileUpload(page: Page, selector: string, filePath: string): Promise<boolean> {
    try {
      const inputHandle = await page.$(selector);
      if (inputHandle) {
        await inputHandle.setInputFiles(filePath);
        return true;
      }

      const hiddenInput = await page.$(`${selector} input[type="file"]`);
      if (hiddenInput) {
        await hiddenInput.setInputFiles(filePath);
        return true;
      }

      const dropzone = await page.$('[class*="dropzone"], [class*="drop-zone"], [class*="upload"]');
      if (dropzone) {
        const fileInput = await dropzone.$('input[type="file"]');
        if (fileInput) {
          await fileInput.setInputFiles(filePath);
          return true;
        }
      }

      return false;
    } catch {
      return false;
    }
  }

  async handleConditionalFields(page: Page): Promise<void> {
    await page.waitForTimeout(1000);
    await page.waitForLoadState('domcontentloaded').catch(() => null);
  }

  async acceptTerms(page: Page): Promise<boolean> {
    const selectors = [
      'input[name*="terms"]',
      'input[name*="agree"]',
      'input[id*="terms"]',
      'input[id*="agree"]',
      'input[name*="accept"]',
      'input[id*="accept"]',
    ];

    for (const sel of selectors) {
      const el = await page.$(sel);
      if (el) {
        const checked = await page.isChecked(sel).catch(() => false);
        if (!checked) await page.click(sel);
        return true;
      }
    }

    const labels = await page.$$('label');
    for (const label of labels) {
      const text = await label.textContent().catch(() => '');
      const lower = (text ?? '').toLowerCase();
      if (
        lower.includes('i agree') ||
        lower.includes('i accept') ||
        lower.includes('terms and conditions') ||
        lower.includes('terms of service')
      ) {
        const checkbox = await label.$('input[type="checkbox"]');
        if (checkbox) {
          const checked = await checkbox.isChecked().catch(() => false);
          if (!checked) await checkbox.click();
          return true;
        }
        await label.click();
        return true;
      }
    }

    return false;
  }

  async handleSessionTimeout(page: Page): Promise<boolean> {
    const bodyText = await page.evaluate(() => document.body.innerText.toLowerCase());

    const timeoutPhrases = [
      'session expired',
      'session has expired',
      'timed out',
      'your session',
      'please log in again',
      'please sign in again',
    ];

    for (const phrase of timeoutPhrases) {
      if (bodyText.includes(phrase)) return false;
    }

    const currentUrl = page.url();
    if (currentUrl.includes('/login') || currentUrl.includes('/signin') || currentUrl.includes('/auth')) {
      return false;
    }

    return true;
  }

  private similarity(a: string, b: string): number {
    if (a === b) return 1;
    if (a.length === 0 || b.length === 0) return 0;
    if (a.includes(b) || b.includes(a)) return 0.8;

    const longer = a.length > b.length ? a : b;
    const shorter = a.length > b.length ? b : a;
    const longerLen = longer.length;

    let matches = 0;
    for (let i = 0; i < shorter.length; i++) {
      if (longer.includes(shorter[i] ?? '')) matches++;
    }

    return (2.0 * matches) / (longerLen + shorter.length);
  }
}
