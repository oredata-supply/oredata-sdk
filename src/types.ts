export type GamePhase = 'BETTING' | 'SPINNING' | 'RESULT' | 'IDLE';

export interface PhaseMetadata {
  phase: GamePhase;
  phaseSince: string | null;
  phaseUntil: string | null;
}

export interface RoundFrameKeyMeta {
  pubkey: string;
  isSigner: boolean;
  isWritable: boolean;
}

export interface SerializedInstruction {
  programId: string;
  keys: RoundFrameKeyMeta[];
  data: string;
}

export interface BuildBidRequest {
  authority: string;
  tiles: number[];
  amountLamports?: string | number;
  amountSol?: number;
  roundId?: string;
}

export interface BuildClaimRequest {
  authority: string;
}

export interface BuilderMetadata {
  authority: string;
  roundId: string | null;
  tiles?: number[];
  amountLamports?: string;
  minerAccountExists?: boolean;
  needsCheckpoint?: boolean;
  checkpointRoundId?: string | null;
}

export interface BuildInstructionsResponse {
  instructions: SerializedInstruction[];
  recommendedFeeLamports: number;
  solPriceUsd: number | null;
  blockhashEndpoint: string;
  metadata: BuilderMetadata;
}

/** V3 transaction response - ready-to-sign serialized transaction */
export interface TransactionResponse {
  /** Base64-encoded serialized transaction, ready for signing */
  transaction: string;
  /** Blockhash used in the transaction */
  blockhash: string;
  /** Block height after which the transaction is no longer valid */
  lastValidBlockHeight: number;
  /** Platform fee in lamports (0 for claims) */
  platformFeeLamports: number;
  /** Current SOL price in USD */
  solPriceUsd: number | null;
  /** Transaction metadata */
  metadata: {
    authority: string;
    roundId?: string;
    tiles?: number[];
    amountLamports?: string;
    needsCheckpoint: boolean;
  };
}

/** Request to relay a signed transaction */
export interface RelayTransactionRequest {
  /** Base64-encoded signed transaction */
  transaction: string;
  /** Blockhash used in the transaction (for confirmation) */
  blockhash?: string;
  /** Last valid block height (for confirmation) */
  lastValidBlockHeight?: number;
  /** Skip preflight simulation (faster, less safe) */
  skipPreflight?: boolean;
}

/** Response from transaction relay */
export interface RelayTransactionResponse {
  /** Transaction signature */
  signature: string;
  /** Whether the transaction was confirmed (within timeout) */
  confirmed: boolean;
}

export interface StateRequestOptions {
  frames?: number;
  sections?: Array<'round' | 'globals' | 'bids' | 'perSquare' | 'analytics'>;
  includePrevious?: boolean;
  optimized?: boolean;
}

export interface StateV3Response {
  data: {
    frames?: unknown[];
    globals?: Record<string, unknown>;
    currentRoundId: string | null;
    latestFinalizedRoundId: string | null;
    optimized?: {
      roundId: string | null;
      phase?: GamePhase;
      phaseSince?: string | null;
      phaseUntil?: string | null;
      [key: string]: unknown;
    };
  };
  meta: {
    sections: string[];
    optimized: boolean;
    frames: number;
  };
}

export interface BidsResponse {
  roundId: string;
  collectedAt: string;
  uniqueMiners: number;
  bids: Array<{
    square: number;
    amountRaw: string;
    amountSol: string;
    count: number;
  }>;
}

export interface MetricsOptions {
  enabled?: boolean;
  bucketSizeMs?: number;
  historyWindowMs?: number;
}

export interface MetricsBucket {
  bucketStart: number;
  requestCount: number;
  totalDurationMs: number;
  totalBytes: number;
}

export interface RestMetricsSnapshot {
  bucketSizeMs: number;
  buckets: MetricsBucket[];
  events: HttpRequestMetricsEvent[];
}

export interface SseMetricsSnapshot {
  status: 'disabled' | 'idle' | 'online' | 'recovering';
  events: number;
  reconnects: number;
  lastEventAt: number | null;
  lastStatusChangeAt: number | null;
}

/** Per-endpoint metrics tracked by the SDK (client-side round-trip) */
export interface ClientEndpointMetrics {
  endpoint: string;
  requestCount: number;
  successCount: number;
  errorCount: number;
  latency: {
    avg: number;
    p95: number;
    max: number;
  };
  timeoutCount: number;  // requests that took >= 10s
}

export interface TransportMetricsSnapshot {
  rest: RestMetricsSnapshot;
  sse: SseMetricsSnapshot;
  /** Per-endpoint breakdown (client-side round-trip metrics) */
  endpoints: ClientEndpointMetrics[];
  windowMs: number;
  updatedAt: number;
}

export interface OredataClientOptions {
  baseUrls?: string[];
  apiKey?: string;
  apiKeyParam?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  pollIntervalMs?: number;
  includeBids?: boolean;
  state?: {
    pollIntervalMs?: number;
    includeBids?: boolean;
    historyLimit?: number;
    resultPhaseDurationMs?: number;
    winnerTiming?: {
      minSpinMs?: number;
      maxWaitMs?: number;
    };
    transport?: {
      mode?: 'rest' | 'sse' | 'hybrid';
      sseReconnectDelayMs?: number;
    };
    metrics?: MetricsOptions;
    healthPollIntervalMs?: number;
    /** Enable quota/billing monitoring. Defaults to true. Set to false to disable. */
    quotaPolling?: boolean;
  };
}

export interface HttpClientOptions {
  baseUrls: string[];
  apiKeyParam?: string;
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  metricsCollector?: HttpMetricsCollector;
}

export interface RequestAttempts {
  baseUrl: string;
  error: unknown;
}

export class OredataHttpError extends Error {
  public attempts: RequestAttempts[];
  public retryAfterMs: number | null;

  constructor(message: string, attempts: RequestAttempts[], retryAfterMs?: number | null) {
    super(message);
    this.name = 'OredataHttpError';
    this.attempts = attempts;
    this.retryAfterMs = retryAfterMs ?? null;
  }

  /**
   * Get a human-friendly error summary.
   */
  get summary(): string {
    if (this.attempts.length === 0) {
      return 'No API endpoints configured';
    }

    // Check for common error patterns
    const firstError = this.attempts[0]?.error;
    const errorStr = String(firstError);

    if (errorStr.includes('ECONNREFUSED') || errorStr.includes('ENOTFOUND')) {
      return 'Cannot connect to API server (is it running?)';
    }
    if (errorStr.includes('ETIMEDOUT') || errorStr.includes('timeout')) {
      return 'API request timed out';
    }
    if (errorStr.includes('429')) {
      return 'Rate limited - too many requests';
    }
    if (errorStr.includes('401') || errorStr.includes('403')) {
      return 'Authentication failed - check your API key';
    }
    if (errorStr.includes('404')) {
      return 'API endpoint not found (check API version)';
    }
    if (errorStr.includes('500') || errorStr.includes('502') || errorStr.includes('503')) {
      return 'API server error - try again later';
    }
    if (errorStr.includes('fetch')) {
      return 'Network error - check your internet connection';
    }

    // Extract status code if present
    const statusMatch = errorStr.match(/(\d{3})/);
    if (statusMatch) {
      return `API returned status ${statusMatch[1]}`;
    }

    return 'Could not reach API';
  }

  /**
   * Get the underlying error message from the first attempt.
   */
  get rootCause(): string {
    const firstError = this.attempts[0]?.error;
    if (firstError instanceof Error) {
      return firstError.message;
    }
    return String(firstError ?? 'Unknown error');
  }
}

export interface HttpRequestMetricsEvent {
  method: string;
  path: string;
  durationMs: number;
  bytes: number;
  timestamp: number;
  ok: boolean;
}

export interface HttpMetricsCollector {
  recordRest(event: HttpRequestMetricsEvent): void;
}

export type ApiHealthStatus = 'healthy' | 'degraded' | 'down';

export interface ApiHealthSnapshot {
  status: ApiHealthStatus;
  uptimeSeconds: number;
}

export type RpcOverallStatus = 'healthy' | 'degraded' | 'down' | 'unknown';
export type RpcProviderHealthStatus = 'unknown' | 'healthy' | 'unhealthy';
export type RpcWebsocketStatus = 'unknown' | 'connected' | 'disconnected' | 'not-configured';

export interface RpcProviderHealthSnapshot {
  role: 'primary' | 'secondary';
  label: string;
  httpUrl: string;
  wsUrl: string | null;
  status: RpcProviderHealthStatus;
  websocketStatus: RpcWebsocketStatus;
  consecutiveFailures: number;
  lastLatencyMs: number | null;
  lastCheckedAt: string | null;
  lastHealthyAt: string | null;
  lastError: string | null;
}

export interface RpcHealthSnapshot {
  status: RpcOverallStatus;
  activeRole: 'primary' | 'secondary';
  failoverActive: boolean;
  lastSwitchAt: string | null;
  providers: RpcProviderHealthSnapshot[];
}

export type GameHealthStatus = 'running' | 'stalled' | 'paused' | 'unknown';

export interface GameHealthSnapshot {
  status: GameHealthStatus;
  currentRoundId: string | null;
  latestFinalizedRoundId: string | null;
  lastLiveUpdateAt: string | null;
  stalledSince: string | null;
  liveAgeMs: number | null;
  currentSlot: string | null;
}

export interface HealthSnapshot {
  timestamp: string;
  api: ApiHealthSnapshot;
  rpc: RpcHealthSnapshot;
  game: GameHealthSnapshot;
}

export interface SdkErrorRecord {
  message: string;
  source: 'rest' | 'health' | 'sse';
  timestamp: number;
  attempts?: Array<{ baseUrl: string; error: string }>;
}

// Connection status for tracking API reachability
export type ConnectionStatus = 'connecting' | 'connected' | 'unreachable';

export interface ConnectionState {
  status: ConnectionStatus;
  lastSuccessAt: number | null;
  failureCount: number;
  lastError: string | null;
}

// =============================================================================
// QUOTA TYPES
// =============================================================================

/** Status of a single quota bucket */
export interface QuotaBucketStatus {
  limit: number;
  used: number;
  remaining: number;
  windowSeconds: number;
  resetsInSeconds: number;
}

/** Raw quota response from API */
export interface QuotaResponse {
  plan: string;
  rateLimits: {
    live: {
      short: QuotaBucketStatus | null;
      long: QuotaBucketStatus;
    };
    historical: QuotaBucketStatus | null;
  };
  billing: BillingResponse | null;
}

/** Enriched quota snapshot with rate calculations */
export interface QuotaSnapshot extends QuotaResponse {
  /** Timestamp when this snapshot was taken */
  timestamp: number;
}

/** Warning event when quota consumption is concerning */
export interface QuotaWarningEvent {
  type: 'high_consumption' | 'approaching_limit' | 'limit_reached';
  currentRate: number;
  sustainableRate: number;
  utilizationPercent: number;
  remaining: number;
  message: string;
}

// =============================================================================
// FORECAST TYPES (Usage Prediction)
// =============================================================================

/** Forecast status for a single time window */
export interface ForecastWindow {
  /** Total requests in this window */
  requests: number;
  /** Rate in requests per hour */
  ratePerHour: number;
  /** Days until limit hit at this rate (null if unlimited) */
  daysToLimit: number | null;
  /** Status based on sustainable rate comparison */
  status: 'ok' | 'warning' | 'critical';
}

/** Usage forecast with multiple time windows */
export interface UsageForecast {
  /** Time until period ends */
  periodEndsIn: {
    days: number;
    hours: number;
  };
  /** Sustainable rate to last through period */
  sustainableRate: {
    perHour: number;
    perDay: number;
  };
  /** Rates by time window */
  windows: {
    '1h': ForecastWindow;
    '24h': ForecastWindow;
    '7d': ForecastWindow;
  };
  /** Overall status (worst of any window) */
  status: 'ok' | 'warning' | 'critical';
  /** Human-readable status message */
  message: string;
  /** Trend direction based on rate comparison */
  trend: 'increasing' | 'stable' | 'decreasing';
}

// =============================================================================
// BILLING TYPES (Monthly/Billing Period Quotas)
// =============================================================================

/** Usage status for a billing category */
export interface BillingUsage {
  /** Requests used in current billing period */
  used: number;
  /** Monthly limit (null = unlimited) */
  limit: number | null;
  /** Remaining requests in period (null if unlimited) */
  remaining: number | null;
  /** Percent used (null if unlimited) */
  percentUsed: number | null;
}

/** Raw billing response from /v3/quota API (billing section) */
export interface BillingResponse {
  /** ISO timestamp when billing period started */
  periodStart: string;
  /** ISO timestamp when billing period ends */
  periodEnd: string;
  /** Days remaining in current billing period */
  daysRemaining: number;
  /** Live requests usage */
  liveRequests: BillingUsage;
  /** Historical queries usage */
  historicalQueries: BillingUsage;
  /** Overage info (optional, for pro+ plans) */
  overage?: {
    allowed: boolean;
    liveCount: number;
    historicalCount: number;
    chargesUsd: number;
  };
  /** Usage forecast (optional, requires Valkey metering) */
  forecast?: UsageForecast;
}

/** Enriched billing snapshot with derived metrics */
export interface BillingSnapshot extends BillingResponse {
  /** Timestamp when this snapshot was taken */
  timestamp: number;
  /** Plan ID */
  plan: string;
}

/** Warning event for billing-related issues */
export interface BillingWarningEvent {
  type:
    | 'high_consumption'
    | 'approaching_limit'
    | 'limit_reached'
    | 'overage_started'
    | 'period_ending';
  category: 'live' | 'historical' | 'period';
  message: string;
  /** Current usage details */
  usage?: {
    used: number;
    limit: number | null;
    remaining: number | null;
  };
  /** Forecast status if available */
  forecastStatus?: 'ok' | 'warning' | 'critical';
}

// ─── Plan Types (SSOT from API) ─────────────────────────────────────────────

/** Public plan information from API */
export interface PlanInfo {
  id: string;
  displayName: string;
  monthlyPriceUsd: number;
  rateLimits: {
    requestsPerSecond: number;
    requestsPerMinute: number;
  };
  billing: {
    includedLiveRequests: number | null; // null = unlimited
    includedHistoricalQueries: number | null;
    overageAllowed: boolean;
    overageRatePerRequest?: number;
  };
  features: {
    bidLockoutSeconds: number;
    winnerDelaySeconds: number;
  };
}

/** Response from /v3/plans endpoint */
export interface PlansResponse {
  defaultPlan: string;
  plans: PlanInfo[];
  registerUrl: string;
  upgradeUrl: string;
}

