// Stub — full implementation built in Phase 3B (Form Fill + Submit Engine).
// Uses a stored form_template and org Knowledge Base to fill and submit a
// corporate giving form via Playwright, returning confirmation data.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Page } from 'playwright';
import type { StealthBrowser } from './stealth-browser.js';

export interface FillOptions {
  page: Page;
  template: Record<string, unknown>;
  organizationId: string;
  funderId: string;
}

export interface FillResult {
  confirmationNumber: string | null;
  requestDescription: string | null;
  confirmationScreenshot: Buffer | null;
}

export class FormFillerAgent {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly browser: StealthBrowser,
  ) {
    void this.supabase;
    void this.browser;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async fillAndSubmit(_options: FillOptions): Promise<FillResult> {
    throw new Error('FormFillerAgent not yet implemented — Phase 3B pending');
  }
}
