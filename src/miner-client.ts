import { EventEmitter } from 'eventemitter3';

/**
 * Miner status response from the API
 */
export interface MinerStatus {
  minerAddress: string;
  exists: boolean;
  needsCheckpoint: boolean;
  checkpointId: string | null;
  roundId: string | null;
  claimableLamports: string | null;
  claimableSol: number | null;
  lastClaimSolAt: string | null;
  pendingClaimLamports: string | null;
  pendingClaimSol: number | null;
  authorityLamports: string;
  authoritySol: number;
  authorityUsdcRaw: string;
  authorityUsdc: number;
}

/**
 * MinerClient events
 */
export interface MinerClientEvents {
  /** Emitted when miner data is updated */
  update: (status: MinerStatus) => void;
  /** Emitted when claimable rewards change */
  rewardsChanged: (payload: { previous: number | null; current: number | null }) => void;
  /** Emitted when miner needs checkpoint (has pending rewards) */
  needsCheckpoint: (payload: { pendingSol: number | null }) => void;
  /** Emitted on error */
  error: (error: Error) => void;
}

/**
 * MinerClient options
 */
export interface MinerClientOptions {
  /** API base URL */
  apiBaseUrl: string;
  /** API key for authentication */
  apiKey?: string;
  /** Wallet authority public key */
  authority: string;
  /** Polling interval in ms (default: 5000) */
  pollInterval?: number;
  /** Auto-start polling (default: false) */
  autoStart?: boolean;
}

const DEFAULT_POLL_INTERVAL = 5000;

/**
 * MinerClient - Polls miner status for a specific wallet
 *
 * Designed for checking claimable rewards, balance, and checkpoint status.
 * Separate from StateClient to avoid conflating game state with wallet state.
 *
 * @example
 * ```typescript
 * import { MinerClient } from '@oredata/sdk';
 *
 * const miner = new MinerClient({
 *   apiBaseUrl: 'https://ore-api.gmore.fun',
 *   apiKey: 'your-api-key',
 *   authority: wallet.publicKey.toBase58(),
 * });
 *
 * miner.on('update', (status) => {
 *   console.log(`Claimable: ${status.claimableSol} SOL`);
 * });
 *
 * miner.on('needsCheckpoint', ({ pendingSol }) => {
 *   console.log(`Pending rewards: ${pendingSol} SOL - claim available!`);
 * });
 *
 * miner.start();
 * ```
 */
export class MinerClient extends EventEmitter<MinerClientEvents> {
  private readonly apiBaseUrl: string;
  private readonly apiKey?: string;
  private authority: string;
  private readonly pollInterval: number;

  private polling = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private lastStatus: MinerStatus | null = null;
  private lastClaimableSol: number | null = null;

  constructor(options: MinerClientOptions) {
    super();
    this.apiBaseUrl = options.apiBaseUrl.replace(/\/$/, '');
    this.apiKey = options.apiKey;
    this.authority = options.authority;
    this.pollInterval = options.pollInterval ?? DEFAULT_POLL_INTERVAL;

    if (options.autoStart) {
      this.start();
    }
  }

  /**
   * Start polling for miner status
   */
  start(): void {
    if (this.polling) return;
    this.polling = true;

    // Initial fetch
    this.poll();

    // Start polling interval
    this.pollTimer = setInterval(() => this.poll(), this.pollInterval);
  }

  /**
   * Stop polling
   */
  stop(): void {
    this.polling = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Fetch miner status once (without starting polling)
   */
  async fetch(): Promise<MinerStatus> {
    const url = `${this.apiBaseUrl}/v3/miner?authority=${encodeURIComponent(this.authority)}`;

    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (this.apiKey) {
      headers['X-Api-Key'] = this.apiKey;
    }

    const response = await fetch(url, { headers });

    if (!response.ok) {
      throw new Error(`Failed to fetch miner status: ${response.status}`);
    }

    return (await response.json()) as MinerStatus;
  }

  /**
   * Get the last fetched status (or null if never fetched)
   */
  getStatus(): MinerStatus | null {
    return this.lastStatus;
  }

  /**
   * Check if polling is active
   */
  isPolling(): boolean {
    return this.polling;
  }

  /**
   * Change the wallet authority (stops and restarts polling if active)
   */
  setAuthority(authority: string): void {
    const wasPolling = this.polling;
    this.stop();
    this.authority = authority;
    this.lastStatus = null;
    this.lastClaimableSol = null;
    if (wasPolling) {
      this.start();
    }
  }

  private async poll(): Promise<void> {
    try {
      const status = await this.fetch();
      this.processStatus(status);
    } catch (error) {
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
    }
  }

  private processStatus(status: MinerStatus): void {
    const previousClaimable = this.lastClaimableSol;
    const currentClaimable = status.claimableSol;

    // Always emit update
    this.emit('update', status);

    // Check if claimable rewards changed
    if (previousClaimable !== currentClaimable) {
      this.emit('rewardsChanged', {
        previous: previousClaimable,
        current: currentClaimable,
      });
    }

    // Check if needs checkpoint (has pending rewards to claim)
    if (status.needsCheckpoint && status.pendingClaimSol !== null && status.pendingClaimSol > 0) {
      // Only emit if this is new or pending amount changed
      const previousPending = this.lastStatus?.pendingClaimSol;
      if (previousPending !== status.pendingClaimSol) {
        this.emit('needsCheckpoint', { pendingSol: status.pendingClaimSol });
      }
    }

    this.lastStatus = status;
    this.lastClaimableSol = currentClaimable;
  }
}

/**
 * Create a MinerClient instance
 */
export function createMinerClient(options: MinerClientOptions): MinerClient {
  return new MinerClient(options);
}

