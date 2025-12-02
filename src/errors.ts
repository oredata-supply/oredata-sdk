/**
 * Oredata SDK Error Classes
 *
 * Structured errors for easy handling in game/app code.
 */

/** URLs for user guidance */
const OREDATA_URLS = {
  register: 'https://oredata.supply/register',
  upgrade: 'https://oredata.supply/upgrade',
  dashboard: 'https://oredata.supply/dashboard',
  docs: 'https://oredata.supply/docs/rate-limits',
  multiplexer: 'https://oredata.supply/docs/multiplexer',
} as const;

/** Help information from API response */
export interface ErrorHelp {
  reason?: string;
  solutions?: string[];
  links?: Record<string, string>;
}

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
  /** Help information from API */
  readonly help?: ErrorHelp;

  constructor(message: string, code: string, statusCode?: number, cause?: Error, help?: ErrorHelp) {
    super(message);
    this.name = 'OredataError';
    this.code = code;
    this.statusCode = statusCode;
    this.cause = cause;
    this.help = help;

    // Maintains proper stack trace in V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /** Get a user-friendly help message */
  get helpMessage(): string {
    if (this.help?.reason) {
      const solutions = this.help.solutions?.slice(0, 2).join('. ') ?? '';
      return `${this.help.reason}${solutions ? ` ${solutions}.` : ''}`;
    }
    return this.message;
  }

  /** Get the upgrade URL */
  get upgradeUrl(): string {
    return this.help?.links?.upgrade ?? OREDATA_URLS.upgrade;
  }

  /** Get the register URL */
  get registerUrl(): string {
    return this.help?.links?.register ?? OREDATA_URLS.register;
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
 *     console.log(e.helpMessage);
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
  /** Request limit */
  readonly limit?: number;
  /** Time window */
  readonly window?: string;
  /** Source of limit (ip or key) */
  readonly source?: 'ip' | 'key';
  /** Plan (if key-based) */
  readonly plan?: string;

  constructor(
    message: string, 
    retryAfterMs: number, 
    limitType: 'short' | 'long' | 'ip' | 'unknown' = 'unknown',
    details?: { limit?: number; window?: string; source?: 'ip' | 'key'; plan?: string },
    help?: ErrorHelp
  ) {
    super(message, 'RATE_LIMIT', 429, undefined, help);
    this.name = 'OredataRateLimitError';
    this.retryAfterMs = retryAfterMs;
    this.limitType = limitType;
    this.limit = details?.limit;
    this.window = details?.window;
    this.source = details?.source;
    this.plan = details?.plan;
  }

  /** Get a user-friendly help message */
  override get helpMessage(): string {
    if (this.help?.reason) {
      return super.helpMessage;
    }
    // Fallback message
    if (this.source === 'ip') {
      return `Rate limited (${this.limit ?? '?'}/${this.window ?? 's'} per IP). ` +
        `Add an API key: ${this.registerUrl}`;
    }
    return `Rate limited (${this.limit ?? '?'}/${this.window ?? 's'}). ` +
      `Upgrade your plan: ${this.upgradeUrl}`;
  }

  static is(error: unknown): error is OredataRateLimitError {
    return error instanceof OredataRateLimitError;
  }

  /**
   * Create from API response
   */
  static fromResponse(
    body: { 
      error?: string; 
      message?: string;
      retryAfter?: number;
      details?: {
        type?: 'short' | 'long';
        limit?: number;
        window?: string;
        source?: 'ip' | 'key';
        plan?: string;
        retryAfterMs?: number;
      };
      help?: ErrorHelp;
    },
    headers?: { 'retry-after'?: string }
  ): OredataRateLimitError {
    const retryAfterHeader = headers?.['retry-after'];
    const retryAfterMs = body.details?.retryAfterMs
      ?? (body.retryAfter ? body.retryAfter * 1000 : null)
      ?? (retryAfterHeader ? parseInt(retryAfterHeader, 10) * 1000 : 1000);

    const limitType = body.details?.type ?? 
      (body.details?.source === 'ip' ? 'ip' : 'unknown');

    return new OredataRateLimitError(
      body.message ?? body.error ?? 'Rate limit exceeded',
      retryAfterMs,
      limitType,
      {
        limit: body.details?.limit,
        window: body.details?.window,
        source: body.details?.source,
        plan: body.details?.plan,
      },
      body.help
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
 *
 * @example
 * ```typescript
 * try {
 *   await client.getState();
 * } catch (e) {
 *   if (OredataQuotaExceededError.is(e)) {
 *     console.log(e.helpMessage);
 *     showUpgradePrompt(e.upgradeUrl);
 *   }
 * }
 * ```
 */
export class OredataQuotaExceededError extends OredataError {
  /** Current usage */
  readonly currentUsage: number;
  /** Limit */
  readonly limit: number;
  /** Current plan */
  readonly plan?: string;
  /** When quota resets */
  readonly periodEndsAt?: Date;
  /** Days until reset */
  readonly daysUntilReset?: number;

  constructor(
    message: string, 
    currentUsage: number, 
    limit: number, 
    plan?: string,
    periodEndsAt?: Date,
    help?: ErrorHelp
  ) {
    super(message, 'QUOTA_EXCEEDED', 402, undefined, help);
    this.name = 'OredataQuotaExceededError';
    this.currentUsage = currentUsage;
    this.limit = limit;
    this.plan = plan;
    this.periodEndsAt = periodEndsAt;
    if (periodEndsAt) {
      this.daysUntilReset = Math.ceil((periodEndsAt.getTime() - Date.now()) / 86400000);
    }
  }

  /** Get a user-friendly help message */
  override get helpMessage(): string {
    if (this.help?.reason) {
      return super.helpMessage;
    }
    const planStr = this.plan ? ` (${this.plan} plan)` : '';
    const daysStr = this.daysUntilReset ? ` Resets in ${this.daysUntilReset} days.` : '';
    return `Monthly quota exhausted${planStr}: ${this.limit.toLocaleString()} requests.${daysStr} ` +
      `Upgrade: ${this.upgradeUrl}`;
  }

  static is(error: unknown): error is OredataQuotaExceededError {
    return error instanceof OredataQuotaExceededError;
  }

  /**
   * Create from API response
   */
  static fromResponse(body: {
    error?: string;
    message?: string;
    details?: {
      used?: number;
      limit?: number;
      plan?: string;
      periodEndsAt?: string;
    };
    help?: ErrorHelp;
  }): OredataQuotaExceededError {
    const periodEndsAt = body.details?.periodEndsAt 
      ? new Date(body.details.periodEndsAt) 
      : undefined;
    
    return new OredataQuotaExceededError(
      body.message ?? body.error ?? 'Monthly quota exhausted',
      body.details?.used ?? 0,
      body.details?.limit ?? 0,
      body.details?.plan,
      periodEndsAt,
      body.help
    );
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
  const message = (errorBody.message as string) ?? (errorBody.error as string) ?? `API error: ${statusCode}`;

  switch (statusCode) {
    case 423:
      return OredataLockoutError.fromResponse(errorBody as Parameters<typeof OredataLockoutError.fromResponse>[0]);

    case 429:
      return OredataRateLimitError.fromResponse(
        errorBody as Parameters<typeof OredataRateLimitError.fromResponse>[0],
        headers as Parameters<typeof OredataRateLimitError.fromResponse>[1]
      );

    case 402:
      return OredataQuotaExceededError.fromResponse(
        errorBody as Parameters<typeof OredataQuotaExceededError.fromResponse>[0]
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

