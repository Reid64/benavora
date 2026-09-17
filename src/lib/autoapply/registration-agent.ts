/* eslint-disable @typescript-eslint/no-explicit-any */
import Anthropic from '@anthropic-ai/sdk';
import crypto from 'crypto';

/** agent_runs.agent_type value for this module (AR-1.2). */
export const AGENT_TYPE = 'autoapply_registration';

// --- types -------------------------------------------------------------------

export interface RegistrationField {
  selector: string;
  fieldType: string;
}

export interface RegistrationFormDetection {
  hasRegistrationForm: boolean;
  formSelector: string | null;
  fields: {
    email?: RegistrationField;
    password?: RegistrationField;
    confirmPassword?: RegistrationField;
    name?: RegistrationField;
    organization?: RegistrationField;
    phone?: RegistrationField;
    [key: string]: RegistrationField | undefined;
  };
}

export interface RegistrationResult {
  success: boolean;
  username: string | null;
  password: string | null;
  confirmationRequired: boolean;
  preScreenshot?: Buffer;
  postScreenshot?: Buffer;
  error?: string;
}

export interface LoginFormDetection {
  hasLoginForm: boolean;
  formSelector: string | null;
  fields: {
    username?: RegistrationField;
    password?: RegistrationField;
    submitButton?: RegistrationField;
  };
}

// --- helpers -----------------------------------------------------------------

function randChar(chars: string, byte: number): string {
  return chars[byte % chars.length] ?? chars[0] ?? '';
}

function generatePassword(): string {
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const digits = '0123456789';
  const symbols = '!@#$%^&*-_=+';
  const all = upper + lower + digits + symbols;

  const bytes = crypto.randomBytes(20);

  const chars: string[] = [
    randChar(upper, bytes[0] ?? 0),
    randChar(lower, bytes[1] ?? 0),
    randChar(digits, bytes[2] ?? 0),
    randChar(symbols, bytes[3] ?? 0),
  ];

  for (let i = 4; i < 16; i++) {
    chars.push(randChar(all, bytes[i] ?? 0));
  }

  // Fisher-Yates shuffle
  const shuffleBytes = crypto.randomBytes(16);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = (shuffleBytes[i] ?? 0) % (i + 1);
    const temp = chars[i] ?? '';
    chars[i] = chars[j] ?? '';
    chars[j] = temp;
  }

  return chars.join('');
}

function extractJson(text: string): unknown {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function hasConfirmationSignal(pageContent: string): boolean {
  const lower = pageContent.toLowerCase();
  return (
    lower.includes('check your email') ||
    lower.includes('verify your email') ||
    lower.includes('confirmation link') ||
    lower.includes('activation email') ||
    lower.includes('email sent') ||
    lower.includes('confirmation email')
  );
}

// --- RegistrationAgent -------------------------------------------------------

export class RegistrationAgent {
  private readonly claude: Anthropic;

  constructor() {
    this.claude = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] });
  }

  async detectRegistrationForm(page: any): Promise<RegistrationFormDetection | null> {
    const html: string = await page.content();

    const response = await this.claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `Analyze this HTML. Does it contain a user registration/signup/create-account form?

Look for: "sign up", "register", "create account", "new user" text, AND form fields for email + password (with optional confirm-password field). A registration form has at least an email field and a password field.

Return ONLY this JSON (no explanation):
{
  "hasRegistrationForm": boolean,
  "formSelector": "CSS selector for the form element, or null",
  "fields": {
    "email": {"selector": "...", "fieldType": "email"} or null,
    "password": {"selector": "...", "fieldType": "password"} or null,
    "confirmPassword": {"selector": "...", "fieldType": "password"} or null,
    "name": {"selector": "...", "fieldType": "text"} or null,
    "organization": {"selector": "...", "fieldType": "text"} or null,
    "phone": {"selector": "...", "fieldType": "tel"} or null
  }
}

HTML (first 8000 chars):
${html.slice(0, 8000)}`,
      }],
    });

    const firstBlock = response.content[0];
    const text = firstBlock?.type === 'text' ? firstBlock.text : null;
    if (!text) return null;

    const parsed = extractJson(text) as RegistrationFormDetection | null;
    if (!parsed?.hasRegistrationForm) return null;
    return parsed;
  }

  async register(
    page: any,
    params: {
      orgName: string;
      orgEmail: string;
      orgPhone: string;
      contactName: string;
      contactEmail: string;
    },
  ): Promise<RegistrationResult> {
    const emailToUse = process.env['AUTOAPPLY_EMAIL'] ?? params.contactEmail;
    const generatedPassword = generatePassword();

    const detection = await this.detectRegistrationForm(page);
    if (!detection?.hasRegistrationForm) {
      return {
        success: false,
        username: null,
        password: null,
        confirmationRequired: false,
        error: 'no_registration_form_detected',
      };
    }

    const preScreenshot: Buffer = await page.screenshot({ fullPage: false });

    try {
      if (detection.fields.email?.selector) {
        await page.fill(detection.fields.email.selector, emailToUse);
      }

      if (detection.fields.name?.selector) {
        await page.fill(detection.fields.name.selector, params.contactName || params.orgName);
      }

      if (detection.fields.organization?.selector) {
        await page.fill(detection.fields.organization.selector, params.orgName);
      }

      if (detection.fields.phone?.selector && params.orgPhone) {
        await page.fill(detection.fields.phone.selector, params.orgPhone);
      }

      if (detection.fields.password?.selector) {
        await page.fill(detection.fields.password.selector, generatedPassword);
      }

      if (detection.fields.confirmPassword?.selector) {
        await page.fill(detection.fields.confirmPassword.selector, generatedPassword);
      }

      const submitLocator = detection.formSelector
        ? page.locator(detection.formSelector).locator('button[type="submit"], input[type="submit"]').first()
        : page.locator('button[type="submit"], input[type="submit"]').first();

      await submitLocator.click();
      await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => null);

      const postScreenshot: Buffer = await page.screenshot({ fullPage: false });
      const postContent: string = await page.content();

      return {
        success: true,
        username: emailToUse,
        password: generatedPassword,
        confirmationRequired: hasConfirmationSignal(postContent),
        preScreenshot,
        postScreenshot,
      };
    } catch (err) {
      const postScreenshot: Buffer | undefined = await (page.screenshot({ fullPage: false }) as Promise<Buffer>).catch(() => undefined);
      return {
        success: false,
        username: null,
        password: null,
        confirmationRequired: false,
        error: err instanceof Error ? err.message : String(err),
        preScreenshot,
        postScreenshot,
      };
    }
  }

  async detectLoginForm(page: any): Promise<LoginFormDetection | null> {
    const html: string = await page.content();

    const response = await this.claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: `Analyze this HTML. Does it contain a login/sign-in form for an existing user?

Look for: "sign in", "log in", "login" text AND a username/email field paired with a password field (NOT a registration form — no confirm-password, no "create account" intent).

Return ONLY this JSON (no explanation):
{
  "hasLoginForm": boolean,
  "formSelector": "CSS selector for the form element, or null",
  "fields": {
    "username": {"selector": "...", "fieldType": "email"} or null,
    "password": {"selector": "...", "fieldType": "password"} or null,
    "submitButton": {"selector": "...", "fieldType": "button"} or null
  }
}

HTML (first 6000 chars):
${html.slice(0, 6000)}`,
      }],
    });

    const firstBlock = response.content[0];
    const text = firstBlock?.type === 'text' ? firstBlock.text : null;
    if (!text) return null;

    const parsed = extractJson(text) as LoginFormDetection | null;
    if (!parsed?.hasLoginForm) return null;
    return parsed;
  }

  async login(page: any, credentials: { username: string; password: string }): Promise<boolean> {
    const detection = await this.detectLoginForm(page);
    if (!detection?.hasLoginForm) return false;

    try {
      if (detection.fields.username?.selector) {
        await page.fill(detection.fields.username.selector, credentials.username);
      }

      if (detection.fields.password?.selector) {
        await page.fill(detection.fields.password.selector, credentials.password);
      }

      if (detection.fields.submitButton?.selector) {
        await page.click(detection.fields.submitButton.selector);
      } else if (detection.formSelector) {
        await page.locator(detection.formSelector).locator('button[type="submit"], input[type="submit"]').first().click();
      } else {
        await page.locator('button[type="submit"], input[type="submit"]').first().click();
      }

      await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => null);

      // Login succeeded if no login form appears on the resulting page
      const afterDetection = await this.detectLoginForm(page);
      return !afterDetection?.hasLoginForm;
    } catch {
      return false;
    }
  }
}
