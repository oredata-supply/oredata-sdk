import { HttpClient } from './http-client.js';
import { StateClient, type StateEngineOptions, type AppMode } from './state/state-client.js';
import { TransportMetricsRecorder } from './state/metrics.js';
import type { StateStoreSnapshot, RoundFrame } from './state/types.js';
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
  type BuildClaimOreRequest,
  type TransactionResponse,
  type PlansResponse,
  type PlanInfo,
  type RelayTransactionRequest,
  type RelayTransactionResponse,
} from './types.js';

// Layer 1 & 2: Data/Presentation separation (RFC v2.1)
import {
  OredataStore,
  type OredataStoreOptions,
  type OredataStoreEvents,
  type RoundData,
  type WinnerData,
  type NextRoundInfo,
  type RoundCompletedPayload,
  type RoundStartedPayload,
  type RoundDataUpdatedPayload,
  type MiningStatusChangedPayload,
} from './state/oredata-store.js';
import {
  OredataState,
  type OredataStateConfig,
  type OredataStateEvents,
  type LateWinnerBehavior,
  type DisplayPhase,
  type WinnerDisplay,
  type PhaseChangePayload,
  type WinnerRevealPayload,
  type ResultOverlayShowPayload,
  type WinnerTimeoutPayload,
} from './state/oredata-state.js';
import {
  getRoundTiming,
  formatDuration,
  slotsRemaining,
  slotsToMs,
  msToSlots,
  DEFAULT_SLOT_DURATION_MS,
  type RoundTiming,
  type RoundTimingOptions,
} from './timing/index.js';

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
  private readonly store: OredataStore;
  private readonly storeOptions: OredataStoreOptions;

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

    // Layer 1: OredataStore (RFC v2.1)
    this.storeOptions = {
      historyLimit: options.state?.historyLimit ?? 100,
      maxWaitMs: options.state?.winnerTiming?.maxWaitMs ?? 25_000,
    };
    this.store = new OredataStore(this.storeOptions);

    // Wire StateClient snapshots to OredataStore
    this.stateClient.on('snapshot', (snapshot) => {
      // Convert StateStoreSnapshot to the format OredataStore expects
      // Extract prices from globals and pass them in optimized format
      const globals = snapshot.globals ?? {};
      const solPriceRaw = (globals.solPrice as Record<string, unknown>)?.priceUsdRaw;
      const orePriceRaw = (globals.orePrice as Record<string, unknown>)?.priceUsdRaw;
      
      this.store.applyApiResponse({
        data: {
          currentRoundId: snapshot.currentRoundId ?? null,
          latestFinalizedRoundId: snapshot.latestFinalizedRoundId ?? null,
          frames: Array.from(snapshot.frames.values()),
          globals: globals,
          optimized: {
            currentSlot: globals.currentSlot ?? null,
            solPriceUsd: typeof solPriceRaw === 'string' ? solPriceRaw : null,
            orePriceUsd: typeof orePriceRaw === 'string' ? orePriceRaw : null,
          },
        },
      } as unknown as StateV3Response);
    });
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
   * Build an ORE token claim transaction ready for signing.
   * Claims ORE token rewards (unrefined + refined) from your miner account.
   * Returns a base64-encoded serialized transaction.
   * 
   * Note: This is different from buildClaimTransaction() which claims SOL rewards.
   * ORE rewards have a 10% tax on unrefined ORE, refined ORE has no tax.
   * 
   * @example
   * ```typescript
   * const { transaction } = await client.buildClaimOreTransaction({
   *   authority: wallet.publicKey.toBase58(),
   * });
   * 
   * // Decode, sign, and send
   * const tx = Transaction.from(Buffer.from(transaction, 'base64'));
   * const sig = await sendTransaction(tx, connection);
   * ```
   */
  async buildClaimOreTransaction(request: BuildClaimOreRequest): Promise<TransactionResponse> {
    return this.http.post<TransactionResponse>('/v3/tx/claim-ore', request);
  }

  /**
   * Start polling the API for game state updates.
   * Data will be emitted through OredataStore events.
   * 
   * @example
   * ```typescript
   * const client = new OredataClient({ ... });
   * const store = client.getStore();
   * 
   * store.on('roundStarted', ({ roundId }) => console.log(`Round ${roundId}`));
   * 
   * client.start(); // Begin polling
   * // ... later
   * client.stop();  // Stop polling
   * ```
   */
  start(): void {
    this.stateClient.start();
  }

  /**
   * Stop polling the API.
   */
  stop(): void {
    this.stateClient.stop();
  }

  // ─── Layer 1 & 2: Data/Presentation Separation (RFC v2.1) ─────────────────

  /**
   * Get the OredataStore (Layer 1) for direct data access.
   *
   * OredataStore provides:
   * - Instant events when data arrives (no timing delays)
   * - Round data storage and history
   * - Winner tracking with wasLate + arrivalMs diagnostics
   *
   * Use this for:
   * - Bots and analytics (need immediate data)
   * - Dashboards (display raw data)
   * - Any non-UI use case
   *
   * @example
   * ```typescript
   * const store = client.getStore();
   *
   * // Immediate winner notification (no spin delay!)
   * store.on('roundCompleted', ({ roundId, winner, wasLate, arrivalMs }) => {
   *   console.log(`Round ${roundId} winner: tile ${winner.tile}`);
   *   console.log(`Arrived after ${arrivalMs}ms, wasLate: ${wasLate}`);
   * });
   *
   * // Access data directly
   * const current = store.getCurrentRound();
   * const previous = store.getPreviousRound();
   * const history = store.getWinnerHistory(50);
   * ```
   */
  getStore(): OredataStore {
    return this.store;
  }

  /**
   * Create an OredataState instance (Layer 2) for UI timing.
   *
   * OredataState provides:
   * - Configurable timing delays (spin, result display)
   * - Late winner handling (emit, skip, or emit-late)
   * - Phase change events for UI transitions
   * - Result overlay show/hide events
   *
   * Use this for:
   * - Game UIs with animations
   * - Apps that need spin/result timing
   * - Any UI that shows winner reveals
   *
   * @example
   * ```typescript
   * const state = client.createState({
   *   spinDurationMs: 4000,      // Minimum spin animation
   *   resultDisplayMs: 15000,    // How long to show result
   *   lateWinnerBehavior: 'emit-late',  // Handle late winners
   * });
   *
   * // Winner revealed after spin animation
   * state.on('winnerReveal', ({ winner, wasLate }) => {
   *   const displayTile = winner + 1; // 0-indexed → 1-indexed for display
   *   if (wasLate) {
   *     showQuickReveal(displayTile);  // Skip spin
   *   } else {
   *     stopWheelOnTile(displayTile);  // Normal reveal
   *   }
   * });
   *
   * // Phase changes for UI transitions
   * state.on('phaseChange', ({ phase }) => {
   *   updateUI(phase);  // 'BETTING' | 'SPINNING' | 'RESULT' | 'IDLE'
   * });
   *
   * // Clean up when done
   * state.stop();
   * ```
   */
  createState(config?: OredataStateConfig): OredataState {
    return new OredataState(this.store, config);
  }

  // getStateClient() removed in v0.12.0
  // Use client.start() and client.stop() for polling control

  /**
   * Fetch available API plans with pricing and limits.
   * This is the SSOT for plan information - cached after first call.
   */
  async getPlans(): Promise<PlansResponse> {
    return this.http.getPlans();
  }

  /**
   * Relay a signed transaction through the Oredata API.
   * 
   * This eliminates the need for a direct Solana RPC connection in the browser.
   * The API uses its own high-quality RPC to broadcast and optionally confirm.
   * 
   * @example
   * ```typescript
   * // 1. Build transaction (includes blockhash)
   * const { transaction, blockhash, lastValidBlockHeight } = await client.buildBidTransaction({
   *   authority: wallet.publicKey.toBase58(),
   *   tiles: [1, 5, 12],
   *   amountSol: 0.025,
   * });
   * 
   * // 2. Decode and sign
   * const tx = Transaction.from(Buffer.from(transaction, 'base64'));
   * tx.sign(wallet); // or use wallet adapter
   * 
   * // 3. Relay through API (no direct RPC needed!)
   * const { signature, confirmed } = await client.relayTransaction({
   *   transaction: tx.serialize().toString('base64'),
   *   blockhash,
   *   lastValidBlockHeight,
   * });
   * ```
   */
  async relayTransaction(request: RelayTransactionRequest): Promise<RelayTransactionResponse> {
    return this.http.post<RelayTransactionResponse>('/solana/relay', request);
  }
}

export type {
  OredataClientOptions,
  StateRequestOptions,
  StateV3Response,
  BidsResponse,
  BuildBidRequest,
  BuildClaimRequest,
  BuildClaimOreRequest,
  TransactionResponse,
  PlansResponse,
  PlanInfo,
  RelayTransactionRequest,
  RelayTransactionResponse,
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

// Layer 1: OredataStore (RFC v2.1)
export { OredataStore };
export type {
  OredataStoreOptions,
  OredataStoreEvents,
  RoundData,
  WinnerData,
  NextRoundInfo,
  RoundCompletedPayload,
  RoundStartedPayload,
  RoundDataUpdatedPayload,
  MiningStatusChangedPayload,
};

// Layer 2: OredataState (RFC v2.1)
export { OredataState };
export type {
  OredataStateConfig,
  OredataStateEvents,
  LateWinnerBehavior,
  DisplayPhase,
  WinnerDisplay,
  PhaseChangePayload,
  WinnerRevealPayload,
  ResultOverlayShowPayload,
  WinnerTimeoutPayload,
};

// Transport status for connection monitoring
export type { TransportStatus } from './state/state-client.js';

// Legacy types removed in v0.12.0
// Migration: StateStoreSnapshot → RoundData
// Migration: RoundFrame → RoundData
// Migration: AppMode → not needed (use store.getCurrentRound())

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

// Timing utilities
export {
  getRoundTiming,
  formatDuration,
  slotsRemaining,
  slotsToMs,
  msToSlots,
  DEFAULT_SLOT_DURATION_MS,
};
export type { RoundTiming, RoundTimingOptions };

