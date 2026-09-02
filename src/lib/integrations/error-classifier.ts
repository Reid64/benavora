// Classifies errors raised by external integration calls (SAM.gov, etc.) so
// callers can decide whether to retry or give up without re-deriving the
// same HTTP-status/error-code checks at every call site.

export enum IntegrationErrorType {
  RATE_LIMIT = "rate_limit",
  NETWORK = "network",
  PARSING = "parsing",
  API_KEY = "api_key_invalid",
  MALFORMED_RESPONSE = "malformed_response",
  TRANSIENT = "transient",
}

export function classifyError(error: any): {
  type: IntegrationErrorType;
  recoverable: boolean;
  recommendedAction: string;
} {
  if (error.response?.status === 429) {
    return {
      type: IntegrationErrorType.RATE_LIMIT,
      recoverable: true,
      recommendedAction: "retry_with_backoff",
    };
  }

  if (error.code === "ECONNREFUSED" || error.code === "ENOTFOUND") {
    return {
      type: IntegrationErrorType.NETWORK,
      recoverable: true,
      recommendedAction: "retry_with_exponential_backoff",
    };
  }

  if (error.response?.status === 401) {
    return {
      type: IntegrationErrorType.API_KEY,
      recoverable: false,
      recommendedAction: "verify_api_key",
    };
  }

  if (error.response?.status >= 500) {
    return {
      type: IntegrationErrorType.TRANSIENT,
      recoverable: true,
      recommendedAction: "retry_later",
    };
  }

  return {
    type: IntegrationErrorType.PARSING,
    recoverable: false,
    recommendedAction: "log_and_skip",
  };
}

// No dedicated structured logger exists in this codebase yet — this is a
// minimal console-based stand-in so integration call sites have somewhere to
// report classified errors; swap the body out if/when a real logger lands.
export function logEvent(type: string, data: Record<string, unknown> = {}): void {
  console.warn(`[integration] ${type}`, data);
}
