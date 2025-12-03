import EventEmitter from 'eventemitter3';

import type { HttpClient } from '../http-client.js';
import type {
  PhaseMetadata,
  StateRequestOptions,
  StateV3Response,
  TransportMetricsSnapshot,
  HealthSnapshot,
  SdkErrorRecord,
  ConnectionStatus,
  ConnectionState,
  QuotaResponse,
  QuotaSnapshot,
  QuotaWarningEvent,
  BillingResponse,
  BillingSnapshot,
  BillingWarningEvent,
} from '../types.js';
import { OredataHttpError } from '../types.js';
import { StateStore } from './store.js';
import { SseSubscriber, type SSEStatus } from './sse-subscriber.js';
import { TransportMetricsRecorder } from './metrics.js';
import type {
  RoundFrame,
  RoundFrameEventPayload,
  StateStoreOptions,
  StateStoreSnapshot,
} from './types.js';

type SnapshotSource = 'rest' | 'sse';

/**
 * App mode controls SDK behavior based on user context.
 * - 'active': User is actively playing/watching. Full-speed polling, all events emitted.
 * - 'idle': User is in menu/settings. Reduced polling, round events suppressed.
 */
export type AppMode = 'active' | 'idle';

/** Polling intervals by app mode (0 = stopped) */
const MODE_INTERVALS = {
  active: {
    state: 1_000,    // 1s state polling
    health: 15_000,  // 15s health polling (reduced from 5s)
    quota: 5_000,    // 5s quota polling (not billed)
  },
  idle: {
    state: 0,        // Stopped - no state polling in idle mode
    health: 5_000,   // 5s health polling (keep alive, not billed)
    quota: 5_000,    // 5s quota polling (not billed)
  },
};

/** Data is considered stale if older than 3 seconds (matches game dynamics) */
const STALE_THRESHOLD_MS = 3_000;

export interface TransportStatus {
  lastSnapshotAt: number | null;
  lastSnapshotSource: SnapshotSource | null;
  restPollingActive: boolean;
  lastRestSuccessAt: number | null;
  lastRestError: string | null;
  restBackoffMs: number | null;
  sseStatus: 'disabled' | 'idle' | 'online' | 'recovering';
}

export interface RateLimitEventPayload {
  backoffMs: number;
  retryAfter: string | null;
}

export interface TransportConfig {
  mode?: 'rest' | 'sse' | 'hybrid';
  sseReconnectDelayMs?: number;
}

export interface StateEngineOptions {
  pollIntervalMs?: number;
  includeBids?: boolean;
  historyLimit?: number;
  resultPhaseDurationMs?: number;
  winnerTiming?: {
    minSpinMs?: number;
    maxWaitMs?: number;
  };
  transport?: TransportConfig;
  healthPollIntervalMs?: number;
  /** 
   * Enable quota/billing monitoring. Defaults to false to reduce requests.
   * Set to true if you need quota tracking (e.g., billing dashboards).
   * Note: Quota endpoints are not billed.
   */
  quotaPolling?: boolean;
}

export type WinnerEventPayload = {
  roundId: string;
  winner: number | null;
  type: 'optimistic' | 'final';
  /** True if final winner differs from optimistic (rare) */
  mismatch?: boolean;
  /** The optimistic winner tile if mismatch occurred */
  optimisticWinner?: number;
};

export type RoundFinalizedPayload = {
  roundId: string;
  winner: number | null;
  /** True if final winner confirmed, false if timed out */
  confirmed: boolean;
  /** True if final differs from optimistic */
  mismatch?: boolean;
};

export type MotherlodeEventPayload = {
  roundId: string;
  /** Winning tile that hit the motherlode */
  tile: number;
  /** Jackpot amount in raw lamports */
  amountRaw: string;
  /** Jackpot amount formatted (e.g., "1.5 SOL") */
  amountFormatted: string;
};

export type StateClientEvents = {
  snapshot: (snapshot: StateStoreSnapshot) => void;
  frame: (frame: RoundFrame) => void;
  phaseChange: (phase: PhaseMetadata | null) => void;
  /** Fires twice per round: once for optimistic, once for final */
  winner: (payload: WinnerEventPayload) => void;
  /** Fires when round is fully complete with final winner (or timeout) */
  roundFinalized: (payload: RoundFinalizedPayload) => void;
  /** Fires when motherlode jackpot is hit (rare!) */
  motherlode: (payload: MotherlodeEventPayload) => void;
  winnerTimeout: (payload: { roundId: string; reason: string }) => void;
  resultPhaseEnded: () => void;
  rateLimit: (payload: RateLimitEventPayload) => void;
  transport: (status: TransportStatus) => void;
  error: (error: Error) => void;
  metrics: (metrics: TransportMetricsSnapshot) => void;
  health: (snapshot: HealthSnapshot) => void;
  networkError: (snapshot: HealthSnapshot) => void;
  recovered: (snapshot: HealthSnapshot) => void;
  rpcStatus: (provider: HealthSnapshot['rpc']['providers'][number]) => void;
  gameState: (game: HealthSnapshot['game']) => void;
  errorHistory: (records: SdkErrorRecord[]) => void;
  connectionChange: (state: ConnectionState) => void;
  quota: (snapshot: QuotaSnapshot) => void;
  quotaWarning: (warning: QuotaWarningEvent) => void;
  billing: (snapshot: BillingSnapshot) => void;
  billingWarning: (warning: BillingWarningEvent) => void;
  modeChange: (mode: AppMode) => void;
};

const DEFAULT_POLL_BACKOFF = {
  initial: 1_000,
  max: 5_000, // Keep short for fast recovery to live data
};

const HEALTH_POLL_INTERVALS = {
  normal: 15_000,  // Reduced from 5s - state poll already confirms connectivity
  recovery: 3_000, // Poll faster when trying to detect recovery
};

const QUOTA_POLL_INTERVAL_MS = 15_000; // Poll quota every 15s
const QUOTA_APPROACHING_THRESHOLD = 90; // Warn when 90% of rate limit used

const BILLING_APPROACHING_THRESHOLD = 80; // Warn when 80% of billing limit used
const BILLING_PERIOD_WARNING_DAYS = 3; // Warn when 3 days remaining in period

export class StateClient extends EventEmitter<StateClientEvents> {
  private readonly http: HttpClient;
  private readonly store: StateStore;
  private readonly pollIntervalMs: number;
  private readonly includeBids: boolean;
  private readonly transportConfig: TransportConfig;
  private readonly metricsRecorder?: TransportMetricsRecorder;
  private readonly healthPollIntervalMs: number;
  private readonly quotaPollingEnabled: boolean;

  private pollTimer: NodeJS.Timeout | null = null;
  private pollFailureCount = 0;
  private healthTimer: NodeJS.Timeout | null = null;
  private sse: SseSubscriber | null = null;
  private transportStatus: TransportStatus = {
    lastSnapshotAt: null,
    lastSnapshotSource: null,
    restPollingActive: true,
    lastRestSuccessAt: null,
    lastRestError: null,
    restBackoffMs: null,
    sseStatus: 'disabled',
  };
  private lastHealthSnapshot: HealthSnapshot | null = null;
  private lastHealthIssue = false;
  private providerStatusMap = new Map<string, { status: string; websocketStatus: string }>();
  private recentErrors: SdkErrorRecord[] = [];

  // Connection status tracking
  private connectionStatus: ConnectionStatus = 'connecting';
  private lastHealthSuccessAt: number | null = null;
  private healthPollFailureCount = 0;
  private lastHealthError: string | null = null;
  private static readonly UNREACHABLE_THRESHOLD = 2; // failures before marking unreachable

  // For recovery-triggered immediate polling
  private lastPollOptions: StateRequestOptions | undefined;

  // Quota tracking (rate limits + billing)
  private quotaTimer: NodeJS.Timeout | null = null;
  private lastQuotaSnapshot: QuotaSnapshot | null = null;
  private lastBillingSnapshot: BillingSnapshot | null = null;

  // App mode (active = full speed, idle = reduced polling)
  private appMode: AppMode = 'active';

  constructor(
    http: HttpClient,
    options: StateEngineOptions = {},
    metricsRecorder?: TransportMetricsRecorder,
  ) {
    super();
    this.http = http;
    const storeOptions: StateStoreOptions = {
      historyLimit: options.historyLimit,
      resultPhaseDurationMs: options.resultPhaseDurationMs,
      winnerTiming: options.winnerTiming,
    };
    this.store = new StateStore(this, storeOptions);
    this.pollIntervalMs = Math.max(500, options.pollIntervalMs ?? 1000);
    this.includeBids = Boolean(options.includeBids);
    this.transportConfig = options.transport ?? { mode: 'rest' };
    this.healthPollIntervalMs = Math.max(5_000, options.healthPollIntervalMs ?? 15_000);
    this.quotaPollingEnabled = options.quotaPolling === true; // Disabled by default (saves requests)
    this.metricsRecorder = metricsRecorder;
    if (this.metricsRecorder) {
      this.metricsRecorder.setOnUpdate(() => this.emitMetrics());
    }
    if (this.transportConfig.mode === 'sse' || this.transportConfig.mode === 'hybrid') {
      this.transportStatus.sseStatus = 'idle';
    }
  }

  async start(options?: StateRequestOptions): Promise<void> {
    await this.startPolling(options);
    if (this.shouldStartSse()) {
      this.startSse();
    }
    void this.startHealthPolling();
    void this.startQuotaPolling();
    // Billing is now included in /v3/quota response, no separate polling needed
  }

  stop(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.transportStatus = {
      ...this.transportStatus,
      restPollingActive: false,
    };
    if (this.sse) {
      this.sse.stop();
      this.sse = null;
      this.transportStatus = {
        ...this.transportStatus,
        sseStatus: 'idle',
      };
    }
    if (this.healthTimer) {
      clearTimeout(this.healthTimer);
      this.healthTimer = null;
    }
    if (this.quotaTimer) {
      clearTimeout(this.quotaTimer);
      this.quotaTimer = null;
    }
    this.emit('transport', { ...this.transportStatus });
  }

  getSnapshot(): StateStoreSnapshot {
    return this.store.snapshot();
  }

  getCurrentFrame(): RoundFrame | null {
    return this.store.getCurrentFrame();
  }

  getFrames(limit?: number): RoundFrame[] {
    return this.store.getFrames(limit);
  }

  getPreviousRound(): RoundFrame | null {
    return this.store.getPreviousRound();
  }

  isResultPhaseActive(): boolean {
    return this.store.isResultPhaseActive();
  }

  waitForWinner(roundId: string): Promise<number | null> {
    return this.store.waitForWinner(roundId);
  }

  getTransportStatus(): TransportStatus {
    return { ...this.transportStatus };
  }

  getMetricsSnapshot(): TransportMetricsSnapshot | null {
    return this.metricsRecorder ? this.metricsRecorder.getSnapshot() : null;
  }

  getHealthSnapshot(): HealthSnapshot | null {
    return this.lastHealthSnapshot ? { ...this.lastHealthSnapshot } : null;
  }

  getRecentErrors(): SdkErrorRecord[] {
    return [...this.recentErrors];
  }

  getConnectionState(): ConnectionState {
    return {
      status: this.connectionStatus,
      lastSuccessAt: this.lastHealthSuccessAt,
      failureCount: this.healthPollFailureCount,
      lastError: this.lastHealthError,
    };
  }

  getQuotaSnapshot(): QuotaSnapshot | null {
    return this.lastQuotaSnapshot ? { ...this.lastQuotaSnapshot } : null;
  }

  getBillingSnapshot(): BillingSnapshot | null {
    return this.lastBillingSnapshot ? { ...this.lastBillingSnapshot } : null;
  }

  /**
   * Get the current app mode.
   */
  getMode(): AppMode {
    return this.appMode;
  }

  /**
   * Get the age of the latest data in milliseconds.
   * Returns null if no data has been received yet.
   */
  getDataAge(): number | null {
    if (this.transportStatus.lastSnapshotAt === null) {
      return null;
    }
    return Date.now() - this.transportStatus.lastSnapshotAt;
  }

  /**
   * Check if data is stale (>3s old or in idle mode).
   * In a fast-paced game, data older than 3s is already outdated.
   * In idle mode, data is always considered stale since polling is stopped.
   */
  isDataStale(): boolean {
    if (this.appMode === 'idle') {
      return true; // No updates in idle mode = stale by definition
    }
    const age = this.getDataAge();
    if (age === null) {
      return true; // No data yet
    }
    return age > STALE_THRESHOLD_MS;
  }

  /**
   * Set the app mode. Controls polling frequency and event emission.
   * - 'active': Full-speed polling, all events emitted. Use when user is playing/watching.
   * - 'idle': State polling stopped, health/quota continue. Use for menus/settings.
   */
  setMode(mode: AppMode): void {
    if (mode === this.appMode) {
      return;
    }
    const previousMode = this.appMode;
    this.appMode = mode;
    this.emit('modeChange', mode);

    // Restart polling with new intervals
    if (this.pollTimer || this.healthTimer || this.quotaTimer) {
      this.restartPollingWithNewIntervals(previousMode);
    }

    // Handle SSE based on mode
    if (mode === 'idle' && this.sse) {
      // Disconnect SSE in idle mode to save resources
      this.sse.stop();
      this.sse = null;
      this.transportStatus = {
        ...this.transportStatus,
        sseStatus: 'idle',
      };
      this.emit('transport', { ...this.transportStatus });
    } else if (mode === 'active' && this.shouldStartSse() && !this.sse) {
      // Reconnect SSE when returning to active mode
      this.startSse();
    }
  }

  /**
   * Restart all polling timers with intervals appropriate for the current mode.
   */
  private restartPollingWithNewIntervals(previousMode: AppMode): void {
    // Track whether state was polling or explicitly started before
    const wasStateActive = this.pollTimer !== null || 
                           (previousMode === 'idle' && this.appMode === 'active');
    const wasHealthPolling = this.healthTimer !== null;
    const wasQuotaPolling = this.quotaTimer !== null;

    // Stop current timers
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.healthTimer) {
      clearTimeout(this.healthTimer);
      this.healthTimer = null;
    }
    if (this.quotaTimer) {
      clearTimeout(this.quotaTimer);
      this.quotaTimer = null;
    }

    // Restart state polling if switching to active mode
    // or if it was already polling
    if (wasStateActive || this.appMode === 'active') {
      void this.startPolling(this.lastPollOptions);
    }

    // Always restart health and quota polling
    if (wasHealthPolling) {
      void this.startHealthPolling();
    }
    if (wasQuotaPolling) {
      void this.startQuotaPolling();
    }
  }

  /**
   * Check if round-related events should be emitted based on current mode.
   * In idle mode, we suppress frame/phase/winner events to reduce UI churn.
   */
  shouldEmitRoundEvents(): boolean {
    return this.appMode === 'active';
  }

  /**
   * Get the current state poll interval.
   * Returns 0 if polling should be stopped (idle mode).
   */
  private getStatePollInterval(): number {
    const modeInterval = MODE_INTERVALS[this.appMode].state;
    // In idle mode, state polling is stopped (0)
    if (modeInterval === 0) {
      return 0;
    }
    // Use configured interval for active mode
    return this.appMode === 'active' ? this.pollIntervalMs : modeInterval;
  }

  private async startPolling(options?: StateRequestOptions): Promise<void> {
    if (this.pollTimer) {
      return;
    }
    this.lastPollOptions = options;

    // In idle mode, state polling is stopped
    const currentInterval = this.getStatePollInterval();
    if (currentInterval === 0) {
      this.transportStatus = {
        ...this.transportStatus,
        restPollingActive: false,
      };
      this.emit('transport', { ...this.transportStatus });
      return;
    }

    const poll = async (): Promise<void> => {
      // Re-check interval in case mode changed
      const interval = this.getStatePollInterval();
      if (interval === 0) {
        // Mode changed to idle, stop polling
        this.pollTimer = null;
        this.transportStatus = {
          ...this.transportStatus,
          restPollingActive: false,
        };
        this.emit('transport', { ...this.transportStatus });
        return;
      }

      try {
        const state = await this.http.get<StateV3Response>(this.buildStatePath(options));
        this.pollFailureCount = 0;
        this.store.applySnapshot(state);
        const now = Date.now();
        this.transportStatus = {
          ...this.transportStatus,
          lastSnapshotAt: now,
          lastSnapshotSource: 'rest',
          lastRestSuccessAt: now,
          lastRestError: null,
          restBackoffMs: interval,
          restPollingActive: true,
        };
        this.emit('transport', { ...this.transportStatus });
        this.emitMetrics();
      } catch (error) {
        this.pollFailureCount += 1;
        const err = error instanceof Error ? error : new Error(String(error));
        const delay = Math.min(
          DEFAULT_POLL_BACKOFF.initial * 2 ** (this.pollFailureCount - 1),
          DEFAULT_POLL_BACKOFF.max,
        );
        this.recordSdkError(err, 'rest');
        // Use server's Retry-After if available, otherwise use calculated backoff
        const is429 = err.message.includes('429');
        const serverRetryAfterMs =
          err instanceof OredataHttpError ? err.retryAfterMs : null;
        const effectiveDelay = is429 && serverRetryAfterMs ? serverRetryAfterMs : delay;

        this.transportStatus = {
          ...this.transportStatus,
          lastRestError: err.message,
          restBackoffMs: effectiveDelay,
        };
        this.emit('transport', { ...this.transportStatus });
        if (is429) {
          this.emit('rateLimit', {
            backoffMs: effectiveDelay,
            retryAfter: serverRetryAfterMs ? `${serverRetryAfterMs / 1000}s` : null,
          });
        }
        this.emit('error', err);
        this.pollTimer = setTimeout(poll, effectiveDelay);
        return;
      }
      this.pollTimer = setTimeout(poll, interval);
    };
    await poll();
  }

  private shouldStartSse(): boolean {
    const mode = this.transportConfig.mode ?? 'rest';
    if (mode === 'rest') {
      return false;
    }
    if (typeof window === 'undefined' || typeof window.EventSource === 'undefined') {
      return false;
    }
    return true;
  }

  private startSse(): void {
    if (this.sse) {
      return;
    }
    const subscriber = new SseSubscriber({
      baseUrls: this.http.getBaseUrls(),
      includeBids: this.includeBids,
      apiKey: this.http.getApiKey() ?? null,
      apiKeyParam: this.http.getApiKeyParam(),
      reconnectDelayMs: this.transportConfig.sseReconnectDelayMs,
    });
    subscriber.on('round_frame', (payload: RoundFrameEventPayload) => {
      this.store.applyRoundFrame(payload);
      this.transportStatus = {
        ...this.transportStatus,
        lastSnapshotAt: Date.now(),
        lastSnapshotSource: 'sse',
      };
      this.emit('transport', { ...this.transportStatus });
      this.metricsRecorder?.recordSseEvent();
    });
    subscriber.on('status', (status: SSEStatus) => {
      this.transportStatus = {
        ...this.transportStatus,
        sseStatus: status.mode,
      };
      this.emit('transport', { ...this.transportStatus });
      this.metricsRecorder?.recordSseStatus(status.mode);
    });
    subscriber.on('error', (error: Error) => {
      const err = error instanceof Error ? error : new Error(String(error));
      this.recordSdkError(err, 'sse');
      this.emit('error', err);
    });
    subscriber.start();
    this.sse = subscriber;
  }

  private async startHealthPolling(): Promise<void> {
    if (this.healthTimer) {
      return;
    }
    const poll = async (): Promise<void> => {
      const wasUnreachable = this.connectionStatus === 'unreachable';
      const now = Date.now();
      
      // Skip health request if state poll recently succeeded (within 5s)
      // State success already proves API connectivity
      const stateRecentlySucceeded = 
        this.transportStatus.lastRestSuccessAt !== null &&
        (now - this.transportStatus.lastRestSuccessAt) < 5_000;
      
      if (stateRecentlySucceeded && this.connectionStatus !== 'unreachable') {
        // State poll proves connectivity - update status without extra request
        if (this.connectionStatus !== 'connected') {
          this.connectionStatus = 'connected';
          this.emitConnectionChange();
        }
        // Reset health tracking since we're inferring health from state
        this.healthPollFailureCount = 0;
        this.lastHealthSuccessAt = now;
        this.lastHealthError = null;
      } else {
        // Actually fetch health - either recovering or state poll hasn't run recently
        try {
          const snapshot = await this.http.get<HealthSnapshot>('/v3/health');
          // Success - reset failure tracking
          this.healthPollFailureCount = 0;
          this.lastHealthSuccessAt = Date.now();
          this.lastHealthError = null;

          // Update connection status if we were not connected
          if (this.connectionStatus !== 'connected') {
            this.connectionStatus = 'connected';
            this.emitConnectionChange();

            // RECOVERY: Trigger immediate data fetch to get fresh data ASAP
            if (wasUnreachable) {
              this.triggerImmediatePoll();
              this.triggerSseReconnect();
            }
          }

          this.handleHealthSnapshot(snapshot);
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          this.healthPollFailureCount += 1;
          this.lastHealthError = err.message;

          this.recordSdkError(err, 'health');
          this.emit('error', err);

          // Check if we should mark as unreachable
          if (
            this.healthPollFailureCount >= StateClient.UNREACHABLE_THRESHOLD &&
            this.connectionStatus !== 'unreachable'
          ) {
            this.connectionStatus = 'unreachable';
            this.emitConnectionChange();
            // Emit synthetic health snapshot with API down
            this.emitSyntheticApiDownSnapshot();
          }
        }
      }
      
      // Schedule next poll
      // Use faster polling interval when trying to detect recovery
      // Also respect app mode for normal polling
      let interval: number;
      if (this.connectionStatus === 'unreachable') {
        interval = HEALTH_POLL_INTERVALS.recovery;
      } else {
        interval = MODE_INTERVALS[this.appMode].health;
      }

      this.healthTimer = setTimeout(() => {
        void poll();
      }, interval);
    };
    await poll();
  }

  /**
   * Immediately trigger a REST poll, resetting any backoff.
   * Called when health detects recovery from unreachable state.
   */
  private triggerImmediatePoll(): void {
    // Clear any pending poll timer (which may be on a long backoff)
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    // Reset failure count so next poll uses normal interval
    this.pollFailureCount = 0;
    // Restart polling immediately with stored options
    void this.startPolling(this.lastPollOptions);
  }

  /**
   * Restart SSE connection on recovery.
   * Called when health detects recovery from unreachable state.
   */
  private triggerSseReconnect(): void {
    if (!this.shouldStartSse()) {
      return;
    }
    // Stop existing SSE if any (may be stuck in retry loop)
    if (this.sse) {
      this.sse.stop();
      this.sse = null;
    }
    // Start fresh SSE connection
    this.startSse();
  }

  /**
   * Start polling for quota information.
   * Only polls if an API key is configured.
   */
  private async startQuotaPolling(): Promise<void> {
    if (!this.quotaPollingEnabled) {
      return;
    }
    if (this.quotaTimer) {
      return;
    }

    const poll = async (): Promise<void> => {
      try {
        const response = await this.http.getQuota();
        if (response) {
          this.processQuotaResponse(response);
        }
      } catch (error) {
        // Quota fetch failures are non-critical, just log
        const err = error instanceof Error ? error : new Error(String(error));
        this.emit('error', err);
      } finally {
        const interval = MODE_INTERVALS[this.appMode].quota;
        this.quotaTimer = setTimeout(() => {
          void poll();
        }, interval);
      }
    };

    await poll();
  }

  /**
   * Process quota response and emit events.
   */
  private processQuotaResponse(response: QuotaResponse): void {
    const now = Date.now();

    // Build enriched snapshot
    const snapshot: QuotaSnapshot = {
      ...response,
      timestamp: now,
    };

    this.lastQuotaSnapshot = snapshot;

    // Emit quota update
    this.emit('quota', snapshot);

    // Check for rate limit warnings
    this.checkQuotaWarnings(snapshot);

    // Process billing if present
    if (response.billing) {
      this.processBillingFromQuota(response.billing, response.plan);
    }
  }

  /** Track if we've warned about rate limits this session */
  private quotaWarned90 = false;
  private quotaWarnedLimit = false;

  /**
   * Check rate limit quota status and emit warnings if needed.
   */
  private checkQuotaWarnings(snapshot: QuotaSnapshot): void {
    const remaining = snapshot.rateLimits.live.long.remaining;
    const limit = snapshot.rateLimits.live.long.limit;
    const usedPercent = ((limit - remaining) / limit) * 100;
    const plan = snapshot.plan ?? 'free';

    // Warning: Approaching rate limit (>90% used in window)
    if (usedPercent >= QUOTA_APPROACHING_THRESHOLD && remaining > 0) {
      // Console warning (once per session)
      if (!this.quotaWarned90) {
        this.quotaWarned90 = true;
        console.warn(
          `⚠️  [@oredata/sdk] ${Math.round(usedPercent)}% of rate limit used (${remaining} remaining)\n` +
          `   Plan: ${plan} | Upgrade: https://oredata.supply/upgrade`
        );
      }
      
      this.emit('quotaWarning', {
        type: 'approaching_limit',
        currentRate: 0,
        sustainableRate: limit / snapshot.rateLimits.live.long.windowSeconds,
        utilizationPercent: usedPercent,
        remaining,
        message: `${Math.round(usedPercent)}% of rate limit used, ${remaining} requests remaining`,
      });
    }

    // Warning: Rate limit reached
    if (remaining === 0) {
      // Console warning (once per session)
      if (!this.quotaWarnedLimit) {
        this.quotaWarnedLimit = true;
        console.warn(
          `⚠️  [@oredata/sdk] Rate limit reached! Requests will be throttled.\n` +
          `   Plan: ${plan} | Upgrade: https://oredata.supply/upgrade`
        );
      }
      
      this.emit('quotaWarning', {
        type: 'limit_reached',
        currentRate: 0,
        sustainableRate: limit / snapshot.rateLimits.live.long.windowSeconds,
        utilizationPercent: 100,
        remaining: 0,
        message: 'Rate limit reached, requests may be throttled',
      });
    }

    // Reset warnings when usage drops back below threshold
    if (usedPercent < QUOTA_APPROACHING_THRESHOLD - 10) {
      this.quotaWarned90 = false;
      this.quotaWarnedLimit = false;
    }
  }

  /**
   * Process billing data from quota response.
   */
  private processBillingFromQuota(billing: BillingResponse, plan: string): void {
    const now = Date.now();

    const snapshot: BillingSnapshot = {
      ...billing,
      plan,
      timestamp: now,
    };

    this.lastBillingSnapshot = snapshot;

    // Emit billing update
    this.emit('billing', snapshot);

    // Check for billing warnings
    this.checkBillingWarningsFromQuota(snapshot);
  }

  /** Track if we've warned about billing this session */
  private billingWarned80 = false;
  private billingWarnedLimit = false;

  /**
   * Check billing status and emit warnings if needed.
   */
  private checkBillingWarningsFromQuota(snapshot: BillingSnapshot): void {
    const { liveRequests, historicalQueries, daysRemaining, forecast, plan } = snapshot;

    // Warning: Live requests approaching limit
    if (
      liveRequests.limit !== null &&
      liveRequests.percentUsed !== null &&
      liveRequests.percentUsed >= BILLING_APPROACHING_THRESHOLD
    ) {
      // Console warning (once per session)
      if (!this.billingWarned80) {
        this.billingWarned80 = true;
        console.warn(
          `⚠️  [@oredata/sdk] ${Math.round(liveRequests.percentUsed)}% of monthly quota used\n` +
          `   Plan: ${plan} | Used: ${liveRequests.used.toLocaleString()}/${liveRequests.limit.toLocaleString()}\n` +
          `   ${daysRemaining} days remaining | Upgrade: https://oredata.supply/upgrade`
        );
      }
      
      this.emit('billingWarning', {
        type: 'approaching_limit',
        category: 'live',
        message: `${Math.round(liveRequests.percentUsed)}% of monthly live request limit used`,
        usage: {
          used: liveRequests.used,
          limit: liveRequests.limit,
          remaining: liveRequests.remaining,
        },
        forecastStatus: forecast?.status,
      });
    }

    // Warning: Historical queries approaching limit
    if (
      historicalQueries.limit !== null &&
      historicalQueries.percentUsed !== null &&
      historicalQueries.percentUsed >= BILLING_APPROACHING_THRESHOLD
    ) {
      this.emit('billingWarning', {
        type: 'approaching_limit',
        category: 'historical',
        message: `${Math.round(historicalQueries.percentUsed)}% of monthly historical query limit used`,
        usage: {
          used: historicalQueries.used,
          limit: historicalQueries.limit,
          remaining: historicalQueries.remaining,
        },
      });
    }

    // Warning: Billing period ending soon
    if (daysRemaining <= BILLING_PERIOD_WARNING_DAYS) {
      this.emit('billingWarning', {
        type: 'period_ending',
        category: 'period',
        message: `Billing period ends in ${Math.round(daysRemaining)} day${daysRemaining === 1 ? '' : 's'}`,
      });
    }

    // Note: High consumption warnings based on forecast are shown in the UI
    // but not as toast notifications (too noisy during normal usage)
  }

  private emitConnectionChange(): void {
    this.emit('connectionChange', this.getConnectionState());
  }

  private emitSyntheticApiDownSnapshot(): void {
    // When API is unreachable, we don't know the actual RPC/Game status
    // Set them to 'unknown' rather than assuming they're down
    const syntheticSnapshot: HealthSnapshot = {
      timestamp: new Date().toISOString(),
      api: { status: 'down', uptimeSeconds: 0 },
      rpc: {
        status: 'unknown' as const,
        activeRole: this.lastHealthSnapshot?.rpc?.activeRole ?? 'primary',
        failoverActive: this.lastHealthSnapshot?.rpc?.failoverActive ?? false,
        lastSwitchAt: this.lastHealthSnapshot?.rpc?.lastSwitchAt ?? null,
        providers: this.lastHealthSnapshot?.rpc?.providers ?? [],
      },
      game: {
        status: 'unknown' as const,
        currentRoundId: this.lastHealthSnapshot?.game?.currentRoundId ?? null,
        latestFinalizedRoundId: this.lastHealthSnapshot?.game?.latestFinalizedRoundId ?? null,
        lastLiveUpdateAt: this.lastHealthSnapshot?.game?.lastLiveUpdateAt ?? null,
        stalledSince: this.lastHealthSnapshot?.game?.stalledSince ?? null,
        liveAgeMs: this.lastHealthSnapshot?.game?.liveAgeMs ?? null,
        currentSlot: this.lastHealthSnapshot?.game?.currentSlot ?? null,
      },
    };
    // Update internal state and emit
    this.lastHealthSnapshot = syntheticSnapshot;
    this.emit('health', syntheticSnapshot);
    this.emit('networkError', syntheticSnapshot);
  }

  private buildStatePath(options?: StateRequestOptions): string {
    const params = new URLSearchParams();
    if (options?.frames != null) {
      params.set('frames', String(options.frames));
    }
    if (options?.sections && options.sections.length > 0) {
      params.set('sections', options.sections.join(','));
    }
    if (options?.includePrevious === false) {
      params.set('includePrevious', 'false');
    }
    params.set('optimized', options?.optimized === false ? '0' : '1');
    if (this.includeBids) {
      const sections = params.get('sections');
      if (!sections || !sections.includes('bids')) {
        params.set('sections', sections ? `${sections},bids` : 'bids');
      }
    }
    const query = params.toString();
    return `/v3/state${query ? `?${query}` : ''}`;
  }

  private handleHealthSnapshot(snapshot: HealthSnapshot): void {
    const previous = this.lastHealthSnapshot;
    this.lastHealthSnapshot = snapshot;
    this.emit('health', snapshot);

    const hasIssue = this.hasHealthIssue(snapshot);
    if (hasIssue) {
      this.emit('networkError', snapshot);
    } else if (this.lastHealthIssue) {
      this.emit('recovered', snapshot);
    }
    this.lastHealthIssue = hasIssue;

    if (!previous || previous.game.status !== snapshot.game.status) {
      this.emit('gameState', snapshot.game);
    }

    const seenKeys = new Set<string>();
    snapshot.rpc.providers.forEach((provider) => {
      const key = `${provider.role}:${provider.httpUrl}`;
      seenKeys.add(key);
      const last = this.providerStatusMap.get(key);
      if (
        !last ||
        last.status !== provider.status ||
        last.websocketStatus !== provider.websocketStatus
      ) {
        this.providerStatusMap.set(key, {
          status: provider.status,
          websocketStatus: provider.websocketStatus,
        });
        this.emit('rpcStatus', provider);
      }
    });
    for (const key of this.providerStatusMap.keys()) {
      if (!seenKeys.has(key)) {
        this.providerStatusMap.delete(key);
      }
    }
  }

  private hasHealthIssue(snapshot: HealthSnapshot): boolean {
    if (!snapshot) {
      return false;
    }
    const apiIssue = snapshot.api.status !== 'healthy';
    const rpcIssue = snapshot.rpc.status !== 'healthy';
    const gameIssue = snapshot.game.status !== 'running';
    return apiIssue || rpcIssue || gameIssue;
  }

  private recordSdkError(error: Error, source: SdkErrorRecord['source']): void {
    const attempts =
      error instanceof OredataHttpError
        ? error.attempts.map((attempt) => ({
            baseUrl: attempt.baseUrl,
            error:
              attempt.error instanceof Error
                ? attempt.error.message
                : String(attempt.error ?? ''),
          }))
        : undefined;
    const record: SdkErrorRecord = {
      message: error.message,
      source,
      timestamp: Date.now(),
      attempts,
    };
    this.recentErrors = [record, ...this.recentErrors].slice(0, 3);
    this.emit('errorHistory', [...this.recentErrors]);
  }
  private emitMetrics(): void {
    if (!this.metricsRecorder) {
      return;
    }
    this.emit('metrics', this.metricsRecorder.getSnapshot());
  }
}

