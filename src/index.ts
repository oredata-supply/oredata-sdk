import { HttpClient } from './http-client.js';
import { StateClient, type StateEngineOptions } from './state/state-client.js';
import { TransportMetricsRecorder } from './state/metrics.js';
import {
  MinerClient,
  createMinerClient,
  type MinerClientOptions,
  type MinerClientEvents,
  type MinerStatus,
} from './miner-client.js';
import {
  BidTracker,
  createBidTracker,
  type BidTrackerOptions,
  type TrackedBid,
  type WinCheckResult,
} from './bid-tracker.js';
import {
  OredataError,
  OredataLockoutError,
  OredataRateLimitError,
  OredataSimulationError,
  OredataNetworkError,
  OredataApiError,
  OredataQuotaExceededError,
  OredataWinnerDelayError,
  parseApiError,
} from './errors.js';
import {
  OredataHttpError,
  type OredataClientOptions,
  type StateRequestOptions,
  type StateV3Response,
  type BidsResponse,
  type BuildBidRequest,
  type BuildClaimRequest,
  type BuildInstructionsResponse,
  type TransactionResponse,
  type PlansResponse,
  type PlanInfo,
} from './types.js';

const DEFAULT_BASE_URL = 'https://ore-api.gmore.fun';

function buildStatePath(options: StateRequestOptions = {}): string {
  const params = new URLSearchParams();
  if (options.frames != null) {
    params.set('frames', String(options.frames));
  }
  if (options.sections && options.sections.length > 0) {
    params.set('sections', options.sections.join(','));
  }
  if (options.includePrevious === false) {
    params.set('includePrevious', 'false');
  }
  if (options.optimized !== undefined) {
    params.set('optimized', options.optimized ? '1' : '0');
  } else {
    params.set('optimized', '1');
  }
  const query = params.toString();
  return `/v3/state${query ? `?${query}` : ''}`;
}

export class OredataClient {
  private readonly http: HttpClient;
  private readonly stateClient: StateClient;

  constructor(options: OredataClientOptions = {}) {
    const baseUrls =
      options.baseUrls && options.baseUrls.length > 0 ? options.baseUrls : [DEFAULT_BASE_URL];
    const metricsOptions = options.state?.metrics;
    const metricsEnabled = metricsOptions?.enabled ?? true;
    const metricsRecorder = metricsEnabled ? new TransportMetricsRecorder(metricsOptions) : undefined;
    this.http = new HttpClient({
      baseUrls,
      apiKey: options.apiKey,
      apiKeyParam: options.apiKeyParam ?? 'apiKey',
      timeoutMs: options.timeoutMs,
      fetchImpl: options.fetch,
      metricsCollector: metricsRecorder,
    });
    const stateOptions: StateEngineOptions = {
      pollIntervalMs: options.state?.pollIntervalMs ?? options.pollIntervalMs,
      includeBids: options.state?.includeBids ?? options.includeBids,
      historyLimit: options.state?.historyLimit,
      resultPhaseDurationMs: options.state?.resultPhaseDurationMs,
      winnerTiming: options.state?.winnerTiming,
      transport: options.state?.transport,
      healthPollIntervalMs: options.state?.healthPollIntervalMs,
    };
    this.stateClient = new StateClient(this.http, stateOptions, metricsRecorder);
  }

  /**
   * Fetches the `/v3/state` endpoint.
   */
  async fetchState(options?: StateRequestOptions): Promise<StateV3Response> {
    const path = buildStatePath(options);
    return this.http.get<StateV3Response>(path);
  }

  /**
   * Fetches `/v3/bids`, optionally filtered by roundId.
   */
  async fetchBids(roundId?: string): Promise<BidsResponse> {
    const params = new URLSearchParams();
    if (roundId) {
      params.set('roundId', roundId);
    }
    const query = params.toString();
    const path = `/v3/bids${query ? `?${query}` : ''}`;
    return this.http.get<BidsResponse>(path);
  }

  /**
   * Calls `/tx/build/bid` and returns serialized instructions.
   */
  async buildBid(request: BuildBidRequest): Promise<BuildInstructionsResponse> {
    return this.http.post<BuildInstructionsResponse>('/tx/build/bid', request);
  }

  /**
   * Calls `/tx/build/claim` for the given authority.
   * @deprecated Use buildClaimTransaction() for simpler flow
   */
  async buildClaim(request: BuildClaimRequest): Promise<BuildInstructionsResponse> {
    return this.http.post<BuildInstructionsResponse>('/tx/build/claim', request);
  }

  // ─── V3 Transaction Methods ────────────────────────────────────────────────
  // Return ready-to-sign serialized transactions

  /**
   * Build a bid transaction ready for signing.
   * Returns a base64-encoded serialized transaction.
   * 
   * @example
   * ```typescript
   * const { transaction } = await client.buildBidTransaction({
   *   authority: wallet.publicKey.toBase58(),
   *   tiles: [1, 2, 3],
   *   amountSol: 0.1,
   * });
   * 
   * // Decode, sign, and send
   * const tx = Transaction.from(Buffer.from(transaction, 'base64'));
   * const sig = await sendTransaction(tx, connection);
   * ```
   */
  async buildBidTransaction(request: BuildBidRequest): Promise<TransactionResponse> {
    return this.http.post<TransactionResponse>('/v3/tx/bid', request);
  }

  /**
   * Build a claim transaction ready for signing.
   * Returns a base64-encoded serialized transaction.
   * 
   * @example
   * ```typescript
   * const { transaction } = await client.buildClaimTransaction({
   *   authority: wallet.publicKey.toBase58(),
   * });
   * 
   * // Decode, sign, and send
   * const tx = Transaction.from(Buffer.from(transaction, 'base64'));
   * const sig = await sendTransaction(tx, connection);
   * ```
   */
  async buildClaimTransaction(request: BuildClaimRequest): Promise<TransactionResponse> {
    return this.http.post<TransactionResponse>('/v3/tx/claim', request);
  }

  /**
   * Access the streaming/polling state client (experimental).
   */
  getStateClient(): StateClient {
    return this.stateClient;
  }

  /**
   * Fetch available API plans with pricing and limits.
   * This is the SSOT for plan information - cached after first call.
   */
  async getPlans(): Promise<PlansResponse> {
    return this.http.getPlans();
  }

  /**
   * Fetch latest blockhash from the API.
   *
   * @deprecated Since v0.5.0, use `buildBidTransaction()` or `buildClaimTransaction()`
   * which include the blockhash in their response. Only use this if you need
   * blockhash separately (e.g., custom transaction assembly).
   */
  async getBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
    return this.http.getBlockhash();
  }
}

export type {
  OredataClientOptions,
  StateRequestOptions,
  StateV3Response,
  BidsResponse,
  BuildBidRequest,
  BuildClaimRequest,
  BuildInstructionsResponse,
  TransactionResponse,
  PlansResponse,
  PlanInfo,
};
export { OredataHttpError };

// MinerClient exports
export { MinerClient, createMinerClient };
export type { MinerClientOptions, MinerClientEvents, MinerStatus };

// BidTracker exports
export { BidTracker, createBidTracker };
export type { BidTrackerOptions, TrackedBid, WinCheckResult };

// Error classes
export {
  OredataError,
  OredataLockoutError,
  OredataRateLimitError,
  OredataSimulationError,
  OredataNetworkError,
  OredataApiError,
  OredataQuotaExceededError,
  OredataWinnerDelayError,
  parseApiError,
};

export type {
  StateClientEvents,
  TransportStatus,
  AppMode,
  WinnerEventPayload,
  RoundFinalizedPayload,
  MotherlodeEventPayload,
} from './state/state-client.js';
export type { StateStoreSnapshot } from './state/types.js';
export type {
  TransportMetricsSnapshot,
  MetricsOptions,
  RestMetricsSnapshot,
  SseMetricsSnapshot,
  PhaseMetadata,
  HttpRequestMetricsEvent,
  HealthSnapshot,
  SdkErrorRecord,
  ConnectionStatus,
  ConnectionState,
  QuotaBucketStatus,
  QuotaResponse,
  QuotaSnapshot,
  QuotaWarningEvent,
  BillingUsage,
  BillingResponse,
  BillingSnapshot,
  BillingWarningEvent,
  ForecastWindow,
  UsageForecast,
  ClientEndpointMetrics,
} from './types.js';

