/**
 * Oredata SDK Error Classes
 *
 * Structured errors for easy handling in game/app code.
 */

/**
 * Base class for all Oredata errors
 */
export class OredataError extends Error {
  /** HTTP status code (if from API) */
  readonly statusCode?: number;
  /** Error code for programmatic handling */
  readonly code: string;
  /** Original error (if wrapped) */
  readonly cause?: Error;

  constructor(message: string, code: string, statusCode?: number, cause?: Error) {
    super(message);
    this.name = 'OredataError';
    this.code = code;
    this.statusCode = statusCode;
    this.cause = cause;

    // Maintains proper stack trace in V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /** Check if error is a specific type */
  static is(error: unknown): error is OredataError {
    return error instanceof OredataError;
  }
}

/**
 * Bid lockout error - bid submitted too close to round end
 *
 * HTTP 423 from /tx/build/bid
 *
 * @example
 * ```typescript
 * try {
 *   await client.buildBidInstructions({ ... });
 * } catch (e) {
 *   if (OredataLockoutError.is(e)) {
 *     console.log(`Locked out! Wait ${e.lockoutSeconds}s or upgrade to ${e.upgradeHint}`);
 *   }
 * }
 * ```
 */
export class OredataLockoutError extends OredataError {
  /** Seconds until bidding phase ends */
  readonly lockoutSeconds: number;
  /** When the phase ends (ISO timestamp) */
  readonly phaseEndsAt: string;
  /** Current plan */
  readonly plan: string;
  /** Suggested upgrade */
  readonly upgradeHint?: string;

  constructor(
    message: string,
    lockoutSeconds: number,
    phaseEndsAt: string,
    plan: string,
    upgradeHint?: string
  ) {
    super(message, 'LOCKOUT', 423);
    this.name = 'OredataLockoutError';
    this.lockoutSeconds = lockoutSeconds;
    this.phaseEndsAt = phaseEndsAt;
    this.plan = plan;
    this.upgradeHint = upgradeHint;
  }

  static is(error: unknown): error is OredataLockoutError {
    return error instanceof OredataLockoutError;
  }

  /**
   * Create from API response
   */
  static fromResponse(body: {
    error?: string;
    lockoutSeconds?: number;
    phaseEndsAt?: string;
    plan?: string;
    upgradeHint?: string;
  }): OredataLockoutError {
    return new OredataLockoutError(
      body.error ?? 'Bid lockout - too close to round end',
      body.lockoutSeconds ?? 0,
      body.phaseEndsAt ?? '',
      body.plan ?? 'unknown',
      body.upgradeHint
    );
  }
}

/**
 * Rate limit error - too many requests
 *
 * HTTP 429
 *
 * @example
 * ```typescript
 * try {
 *   await client.getState();
 * } catch (e) {
 *   if (OredataRateLimitError.is(e)) {
 *     await sleep(e.retryAfterMs);
 *     // retry
 *   }
 * }
 * ```
 */
export class OredataRateLimitError extends OredataError {
  /** Milliseconds to wait before retrying */
  readonly retryAfterMs: number;
  /** Which limit was hit */
  readonly limitType: 'short' | 'long' | 'ip' | 'unknown';

  constructor(message: string, retryAfterMs: number, limitType: 'short' | 'long' | 'ip' | 'unknown' = 'unknown') {
    super(message, 'RATE_LIMIT', 429);
    this.name = 'OredataRateLimitError';
    this.retryAfterMs = retryAfterMs;
    this.limitType = limitType;
  }

  static is(error: unknown): error is OredataRateLimitError {
    return error instanceof OredataRateLimitError;
  }

  /**
   * Create from API response
   */
  static fromResponse(
    body: { error?: string; retryAfter?: number },
    headers?: { 'retry-after'?: string }
  ): OredataRateLimitError {
    const retryAfterHeader = headers?.['retry-after'];
    const retryAfterMs = body.retryAfter
      ? body.retryAfter * 1000
      : retryAfterHeader
        ? parseInt(retryAfterHeader, 10) * 1000
        : 1000;

    return new OredataRateLimitError(
      body.error ?? 'Rate limit exceeded',
      retryAfterMs,
      'unknown'
    );
  }
}

/**
 * Simulation error - transaction simulation failed
 *
 * @example
 * ```typescript
 * try {
 *   await client.buildBidInstructions({ ... });
 * } catch (e) {
 *   if (OredataSimulationError.is(e)) {
 *     console.log(`Simulation failed: ${e.simulationError}`);
 *     console.log(`Logs: ${e.logs?.join('\n')}`);
 *   }
 * }
 * ```
 */
export class OredataSimulationError extends OredataError {
  /** Simulation error message */
  readonly simulationError: string;
  /** Simulation logs (if available) */
  readonly logs?: string[];

  constructor(message: string, simulationError: string, logs?: string[]) {
    super(message, 'SIMULATION_FAILED', 400);
    this.name = 'OredataSimulationError';
    this.simulationError = simulationError;
    this.logs = logs;
  }

  static is(error: unknown): error is OredataSimulationError {
    return error instanceof OredataSimulationError;
  }

  /**
   * Create from API response
   */
  static fromResponse(body: {
    error?: string;
    simulationError?: string;
    logs?: string[];
  }): OredataSimulationError {
    return new OredataSimulationError(
      body.error ?? 'Transaction simulation failed',
      body.simulationError ?? 'Unknown simulation error',
      body.logs
    );
  }
}

/**
 * Network error - failed to connect to API
 */
export class OredataNetworkError extends OredataError {
  constructor(message: string, cause?: Error) {
    super(message, 'NETWORK_ERROR', undefined, cause);
    this.name = 'OredataNetworkError';
  }

  static is(error: unknown): error is OredataNetworkError {
    return error instanceof OredataNetworkError;
  }
}

/**
 * API error - unexpected error from API
 */
export class OredataApiError extends OredataError {
  /** Response body (if available) */
  readonly responseBody?: unknown;

  constructor(message: string, statusCode: number, responseBody?: unknown) {
    super(message, 'API_ERROR', statusCode);
    this.name = 'OredataApiError';
    this.responseBody = responseBody;
  }

  static is(error: unknown): error is OredataApiError {
    return error instanceof OredataApiError;
  }
}

/**
 * Quota exceeded error - billing quota exhausted
 *
 * HTTP 402
 */
export class OredataQuotaExceededError extends OredataError {
  /** Current usage */
  readonly currentUsage: number;
  /** Limit */
  readonly limit: number;
  /** Days until reset */
  readonly daysUntilReset?: number;

  constructor(message: string, currentUsage: number, limit: number, daysUntilReset?: number) {
    super(message, 'QUOTA_EXCEEDED', 402);
    this.name = 'OredataQuotaExceededError';
    this.currentUsage = currentUsage;
    this.limit = limit;
    this.daysUntilReset = daysUntilReset;
  }

  static is(error: unknown): error is OredataQuotaExceededError {
    return error instanceof OredataQuotaExceededError;
  }
}

/**
 * Winner delay error - winner info not yet available due to plan restrictions
 */
export class OredataWinnerDelayError extends OredataError {
  /** Seconds until winner is revealed */
  readonly revealInSeconds: number;

  constructor(message: string, revealInSeconds: number) {
    super(message, 'WINNER_DELAYED', 200); // Not an error status, just delayed
    this.name = 'OredataWinnerDelayError';
    this.revealInSeconds = revealInSeconds;
  }

  static is(error: unknown): error is OredataWinnerDelayError {
    return error instanceof OredataWinnerDelayError;
  }
}

/**
 * Parse error response and return appropriate error class
 */
export function parseApiError(
  statusCode: number,
  body: unknown,
  headers?: Record<string, string>
): OredataError {
  const errorBody = body as Record<string, unknown> ?? {};
  const message = (errorBody.error as string) ?? `API error: ${statusCode}`;

  switch (statusCode) {
    case 423:
      return OredataLockoutError.fromResponse(errorBody as Parameters<typeof OredataLockoutError.fromResponse>[0]);

    case 429:
      return OredataRateLimitError.fromResponse(
        errorBody as Parameters<typeof OredataRateLimitError.fromResponse>[0],
        headers as Parameters<typeof OredataRateLimitError.fromResponse>[1]
      );

    case 402:
      return new OredataQuotaExceededError(
        message,
        (errorBody.currentUsage as number) ?? 0,
        (errorBody.limit as number) ?? 0,
        errorBody.daysUntilReset as number | undefined
      );

    case 400:
      if (errorBody.simulationError) {
        return OredataSimulationError.fromResponse(
          errorBody as Parameters<typeof OredataSimulationError.fromResponse>[0]
        );
      }
      return new OredataApiError(message, statusCode, body);

    default:
      return new OredataApiError(message, statusCode, body);
  }
}

