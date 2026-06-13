// ChallengeDetector — Phase 3 browser automation (BEHAVIORAL_CONTRACTS §18).
//
// Scans the current Playwright page for CAPTCHA, MFA/2FA, account-creation, and
// login-required patterns. All detection runs inside page.evaluate() so it works
// across any page origin. Returns a ChallengeResult with enough context for the
// operator to act. Never throws — any scan failure returns type "none".
//
// Philosophy: NEVER attempt to solve challenges automatically. Pause and defer to
// the human operator (BEHAVIORAL_CONTRACTS §18).

import type { Page } from "playwright";

import type { ChallengeResult, ChallengeType } from "@/types/automation";

const CAPTCHA_PHRASES = [
  "verify you are human",
  "i'm not a robot",
  "i am not a robot",
  "prove you're human",
  "complete the captcha",
  "security check",
  "please verify you",
];

const MFA_PHRASES = [
  "two-factor",
  "two factor",
  "authentication code",
  "authenticator code",
  "verification code",
  "enter the code sent",
  "check your phone",
  "sent to your phone",
  "6-digit code",
  "one-time password",
  "one-time code",
  " otp ",
  "sms code",
  "text message code",
];

const ACCOUNT_CREATION_PHRASES = [
  "create account",
  "create an account",
  "sign up for",
  "register for",
  "join now",
  "create your account",
];

const LOGIN_PHRASES = [
  "sign in to",
  "log in to",
  "login to your",
  "please log in",
  "please sign in",
];

interface PageScan {
  hasCaptchaIframe: boolean;
  hasHcaptchaIframe: boolean;
  hasTurnstileIframe: boolean;
  hasRecaptchaWidget: boolean;
  hasHcaptchaWidget: boolean;
  hasImageChallengeGrid: boolean;
  hasMfaInput: boolean;
  hasPasswordField: boolean;
  hasConfirmPasswordField: boolean;
  hasEmailOrUsernameField: boolean;
  bodyText: string;
}

export class ChallengeDetector {
  /**
   * Scan the current page for challenge patterns and classify the result.
   * Always returns a ChallengeResult — type "none" when nothing is found.
   */
  async detect(page: Page): Promise<ChallengeResult> {
    let scan: PageScan;
    try {
      scan = await page.evaluate((): PageScan => {
        const iframes = Array.from(document.querySelectorAll("iframe"));
        const inputs = Array.from(document.querySelectorAll("input"));
        const passwordInputs = inputs.filter((i) => i.type === "password");
        const bodyText = (document.body?.innerText ?? "")
          .toLowerCase()
          .slice(0, 3000);

        return {
          hasCaptchaIframe: iframes.some(
            (f) =>
              f.src.includes("recaptcha") ||
              f.src.includes("google.com/recaptcha"),
          ),
          hasHcaptchaIframe: iframes.some((f) => f.src.includes("hcaptcha")),
          hasTurnstileIframe: iframes.some(
            (f) =>
              f.src.includes("challenges.cloudflare") ||
              f.src.includes("turnstile"),
          ),
          hasRecaptchaWidget: !!document.querySelector(
            ".g-recaptcha, [data-sitekey], .recaptcha-checkbox",
          ),
          hasHcaptchaWidget: !!document.querySelector(
            ".h-captcha, [data-hcaptcha-widget-id]",
          ),
          hasImageChallengeGrid: !!document.querySelector(
            ".rc-imageselect-table, [class*='challenge-image'], [id*='challenge-stage']",
          ),
          hasMfaInput: inputs.some(
            (i) =>
              (i.type === "text" ||
                i.type === "number" ||
                i.type === "tel") &&
              Number(i.maxLength) >= 4 &&
              Number(i.maxLength) <= 8,
          ),
          hasPasswordField: passwordInputs.length > 0,
          hasConfirmPasswordField: passwordInputs.length >= 2,
          hasEmailOrUsernameField: inputs.some(
            (i) =>
              i.type === "email" ||
              (i.name ?? "").toLowerCase().includes("email") ||
              (i.name ?? "").toLowerCase().includes("username") ||
              (i.id ?? "").toLowerCase().includes("email") ||
              (i.id ?? "").toLowerCase().includes("username"),
          ),
          bodyText,
        };
      });
    } catch {
      return noChallenge();
    }

    return classify(scan);
  }
}

function classify(scan: PageScan): ChallengeResult {
  const t = scan.bodyText;

  // 1. CAPTCHA — explicit widget or phrase match.
  const hasCaptchaWidget =
    scan.hasCaptchaIframe ||
    scan.hasHcaptchaIframe ||
    scan.hasTurnstileIframe ||
    scan.hasRecaptchaWidget ||
    scan.hasHcaptchaWidget ||
    scan.hasImageChallengeGrid;

  if (hasCaptchaWidget || anyPhrase(t, CAPTCHA_PHRASES)) {
    return challenge(
      "captcha",
      "A CAPTCHA challenge was detected. Please solve it manually in your " +
        "browser, then click “Resume After Manual Completion” to continue.",
    );
  }

  // 2. MFA / 2FA — short numeric input or phrase match.
  if (scan.hasMfaInput || anyPhrase(t, MFA_PHRASES)) {
    return challenge(
      "mfa",
      "A multi-factor authentication prompt was detected. Enter your " +
        "verification code in your browser, then click “Resume After Manual " +
        "Completion” to continue.",
    );
  }

  // 3. Account creation required — registration form with password field.
  if (
    anyPhrase(t, ACCOUNT_CREATION_PHRASES) &&
    scan.hasPasswordField &&
    (scan.hasConfirmPasswordField || scan.hasEmailOrUsernameField)
  ) {
    return challenge(
      "account_creation",
      "This portal requires creating an account. Please register manually in " +
        "your browser, then click “Resume After Manual Completion” to continue.",
    );
  }

  // 4. Login required — login form without account-creation signals.
  if (
    anyPhrase(t, LOGIN_PHRASES) &&
    scan.hasPasswordField &&
    scan.hasEmailOrUsernameField
  ) {
    return challenge(
      "login_required",
      "A login prompt was detected. Please sign in manually in your browser, " +
        "then click “Resume After Manual Completion” to continue.",
    );
  }

  return noChallenge();
}

function anyPhrase(text: string, phrases: string[]): boolean {
  return phrases.some((p) => text.includes(p));
}

function challenge(type: ChallengeType, instructions: string): ChallengeResult {
  return { detected: true, type, screenshot: "", instructions };
}

function noChallenge(): ChallengeResult {
  return { detected: false, type: "none", screenshot: "", instructions: "" };
}
