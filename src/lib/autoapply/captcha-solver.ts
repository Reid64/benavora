import { Solver } from '@2captcha/captcha-solver';

export interface CaptchaDetection {
  type: 'recaptcha_v2' | 'recaptcha_v3' | 'hcaptcha' | 'turnstile' | null;
  siteKey: string | null;
  pageUrl: string;
}

export class CaptchaSolver {
  private solver: Solver | null = null;

  private getSolver(): Solver | null {
    if (this.solver !== null) return this.solver;
    const apiKey = process.env['TWOCAPTCHA_API_KEY'];
    if (!apiKey) return null;
    this.solver = new Solver(apiKey);
    return this.solver;
  }

  async detectCaptcha(page: any): Promise<CaptchaDetection | null> {
    const pageUrl: string = page.url() as string;

    try {
      const result: { type: 'recaptcha_v2' | 'hcaptcha' | 'turnstile'; siteKey: string | null } | null =
        await page.evaluate(() => {
          // reCAPTCHA v2 detection
          const recaptchaIframe = document.querySelector('iframe[src*="recaptcha"]');
          const gRecaptchaDiv = document.querySelector('.g-recaptcha, #recaptcha');

          if (recaptchaIframe !== null || gRecaptchaDiv !== null) {
            let siteKey: string | null = null;

            if (gRecaptchaDiv !== null) {
              siteKey = gRecaptchaDiv.getAttribute('data-sitekey');
            }

            if (siteKey === null && recaptchaIframe !== null) {
              const src = recaptchaIframe.getAttribute('src') ?? '';
              const match = src.match(/[?&]k=([^&]+)/);
              if (match !== null) siteKey = match[1] ?? null;
            }

            return { type: 'recaptcha_v2' as const, siteKey };
          }

          // hCaptcha detection
          const hcaptchaIframe = document.querySelector('iframe[src*="hcaptcha"]');
          const hCaptchaDiv = document.querySelector('.h-captcha');

          if (hcaptchaIframe !== null || hCaptchaDiv !== null) {
            let siteKey: string | null = null;

            if (hCaptchaDiv !== null) {
              siteKey = hCaptchaDiv.getAttribute('data-sitekey');
            }

            if (siteKey === null && hcaptchaIframe !== null) {
              const src = hcaptchaIframe.getAttribute('src') ?? '';
              const match = src.match(/[?&]sitekey=([^&]+)/);
              if (match !== null) siteKey = match[1] ?? null;
            }

            return { type: 'hcaptcha' as const, siteKey };
          }

          // Cloudflare Turnstile detection
          const turnstileDiv = document.querySelector('.cf-turnstile');
          const turnstileIframe = document.querySelector('iframe[src*="challenges.cloudflare.com"]');

          if (turnstileDiv !== null || turnstileIframe !== null) {
            let siteKey: string | null = null;

            if (turnstileDiv !== null) {
              siteKey = turnstileDiv.getAttribute('data-sitekey');
            }

            if (siteKey === null && turnstileIframe !== null) {
              const src = turnstileIframe.getAttribute('src') ?? '';
              const match = src.match(/[?&]sitekey=([^&]+)/);
              if (match !== null) siteKey = match[1] ?? null;
            }

            return { type: 'turnstile' as const, siteKey };
          }

          return null;
        });

      if (result === null) return null;

      return { type: result.type, siteKey: result.siteKey, pageUrl };
    } catch {
      return null;
    }
  }

  async solveCaptcha(detection: CaptchaDetection, _page: any): Promise<string | null> {
    if (detection.type === null || detection.siteKey === null) return null;

    const solver = this.getSolver();
    if (solver === null) return null;

    const { type, siteKey, pageUrl } = detection;

    try {
      let answer: { data: string };

      switch (type) {
        case 'recaptcha_v2':
          answer = await solver.recaptcha({ pageurl: pageUrl, googlekey: siteKey });
          break;
        case 'recaptcha_v3':
          answer = await solver.recaptcha({ pageurl: pageUrl, googlekey: siteKey, version: 'v3', action: 'submit' });
          break;
        case 'hcaptcha':
          answer = await solver.hcaptcha({ pageurl: pageUrl, sitekey: siteKey });
          break;
        case 'turnstile':
          answer = await solver.cloudflareTurnstile({ pageurl: pageUrl, sitekey: siteKey });
          break;
        default:
          return null;
      }

      return answer.data;
    } catch {
      return null;
    }
  }

  async injectSolution(page: any, detection: CaptchaDetection, token: string): Promise<void> {
    const { type } = detection;

    if (type === 'recaptcha_v2' || type === 'recaptcha_v3') {
      await page.evaluate((t: string) => {
        // Set all g-recaptcha-response textarea elements
        document.querySelectorAll('[id^="g-recaptcha-response"]').forEach((el) => {
          (el as HTMLTextAreaElement).value = t;
        });

        // Invoke the grecaptcha callback if available
        try {
          const cfg = (window as any).___grecaptcha_cfg;
          if (cfg !== undefined && cfg.clients !== undefined) {
            Object.values(cfg.clients as Record<string, unknown>).forEach((client) => {
              const walkAndCall = (obj: unknown, depth: number): void => {
                if (depth > 3 || obj === null || typeof obj !== 'object') return;
                const rec = obj as Record<string, unknown>;
                if (typeof rec['callback'] === 'function') {
                  (rec['callback'] as (token: string) => void)(t);
                  return;
                }
                Object.values(rec).forEach((val) => walkAndCall(val, depth + 1));
              };
              walkAndCall(client, 0);
            });
          }
        } catch {
          // Callback invocation failed — textarea value is set, form submit may still work
        }
      }, token);
    } else if (type === 'hcaptcha') {
      await page.evaluate((t: string) => {
        document.querySelectorAll('[name="h-captcha-response"]').forEach((el) => {
          (el as HTMLTextAreaElement).value = t;
        });
      }, token);
    } else if (type === 'turnstile') {
      await page.evaluate((t: string) => {
        document.querySelectorAll('[name="cf-turnstile-response"], input[name*="turnstile"]').forEach((el) => {
          (el as HTMLInputElement).value = t;
        });
      }, token);
    }
  }
}
