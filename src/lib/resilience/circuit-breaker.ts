/**
 * Standard circuit breaker (Closed -> Open -> Half-Open) for wrapping calls
 * to flaky dependencies (agent execution, external APIs) so a persistent
 * failure doesn't keep piling up latency/cost on every caller.
 *
 * Differences from a naive port of the pattern:
 * - A failure while HALF_OPEN reopens the circuit immediately instead of
 *   requiring `failureThreshold` more failures. HALF_OPEN exists to test
 *   recovery with a small number of probes; treating it like CLOSED lets a
 *   single flapping probe take `failureThreshold` more real requests down
 *   with it before the breaker responds.
 * - HALF_OPEN admits at most `successThreshold` concurrent probes. Without a
 *   cap, every caller in flight when the timeout elapses passes straight
 *   through simultaneously and hammers a dependency that may still be down.
 * - `execute` takes an optional fallback so callers can degrade gracefully
 *   (serve a cached result, skip the agent, return the previous dossier)
 *   instead of receiving a thrown "circuit open" error.
 */
export enum CircuitState {
  CLOSED = "closed",
  OPEN = "open",
  HALF_OPEN = "half_open",
}

export class CircuitOpenError extends Error {
  constructor(name: string) {
    super(`Circuit breaker "${name}" is OPEN. Service unavailable.`);
    this.name = "CircuitOpenError";
  }
}

export interface CircuitBreakerOptions {
  /** Consecutive failures in CLOSED state before the circuit trips to OPEN. */
  failureThreshold?: number;
  /** Consecutive successful probes in HALF_OPEN state before closing again. */
  successThreshold?: number;
  /** Milliseconds to wait after tripping OPEN before allowing a probe. */
  timeout?: number;
  /** Identifies this breaker in thrown errors and stats. */
  name?: string;
}

export interface CircuitBreakerStats {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureTime: number | null;
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime: number | null = null;
  private halfOpenProbesInFlight = 0;

  private readonly failureThreshold: number;
  private readonly successThreshold: number;
  private readonly timeout: number;
  private readonly name: string;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.successThreshold = options.successThreshold ?? 2;
    this.timeout = options.timeout ?? 60000;
    this.name = options.name ?? "circuit-breaker";
  }

  /**
   * Runs `fn` through the breaker. If the circuit is OPEN (and the recovery
   * timeout hasn't elapsed) or HALF_OPEN with no probe slots free, `fallback`
   * is invoked instead when provided; otherwise a CircuitOpenError is thrown.
   */
  async execute<T>(fn: () => Promise<T>, fallback?: () => Promise<T> | T): Promise<T> {
    this.evaluateRecoveryTimeout();

    if (this.state === CircuitState.OPEN) {
      return this.degrade(fallback);
    }

    if (this.state === CircuitState.HALF_OPEN) {
      if (this.halfOpenProbesInFlight >= this.successThreshold) {
        return this.degrade(fallback);
      }
      this.halfOpenProbesInFlight++;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    } finally {
      if (this.state === CircuitState.HALF_OPEN || this.halfOpenProbesInFlight > 0) {
        this.halfOpenProbesInFlight = Math.max(0, this.halfOpenProbesInFlight - 1);
      }
    }
  }

  getState(): CircuitState {
    this.evaluateRecoveryTimeout();
    return this.state;
  }

  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
    };
  }

  /** Forces the circuit back to CLOSED, e.g. after an operator confirms recovery. */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.halfOpenProbesInFlight = 0;
    this.lastFailureTime = null;
  }

  private evaluateRecoveryTimeout(): void {
    if (this.state !== CircuitState.OPEN || this.lastFailureTime === null) return;
    if (Date.now() - this.lastFailureTime > this.timeout) {
      this.state = CircuitState.HALF_OPEN;
      this.successCount = 0;
      this.halfOpenProbesInFlight = 0;
    }
  }

  private onSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.successThreshold) {
        this.state = CircuitState.CLOSED;
        this.failureCount = 0;
        this.successCount = 0;
      }
      return;
    }
    this.failureCount = 0;
  }

  private onFailure(): void {
    this.lastFailureTime = Date.now();

    if (this.state === CircuitState.HALF_OPEN) {
      // A single failed probe means the dependency hasn't recovered.
      this.state = CircuitState.OPEN;
      this.successCount = 0;
      return;
    }

    this.failureCount++;
    if (this.failureCount >= this.failureThreshold) {
      this.state = CircuitState.OPEN;
    }
  }

  private async degrade<T>(fallback?: () => Promise<T> | T): Promise<T> {
    if (!fallback) {
      throw new CircuitOpenError(this.name);
    }
    return fallback();
  }
}
