const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const TIMEOUT_MS = 5_000;

/**
 * Performs a lightweight HEAD request against a giving portal URL.
 * Used by queue-processor before launching a full browser session to avoid
 * wasting a Playwright session on a dead portal.
 */
export async function quickHealthCheck(
  url: string,
): Promise<'active' | 'dead' | 'redirect' | 'unknown'> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'HEAD',
      redirect: 'manual',
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
    });

    const { status } = response;

    if (status >= 200 && status < 300) return 'active';
    if (status === 301 || status === 302 || status === 303 || status === 307 || status === 308)
      return 'redirect';
    // 401/403 are technically "alive" — the form exists behind auth
    if (status === 401 || status === 403) return 'active';
    return 'dead';
  } catch {
    return 'unknown';
  } finally {
    clearTimeout(timer);
  }
}
