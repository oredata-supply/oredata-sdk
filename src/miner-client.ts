import { EventEmitter } from 'eventemitter3';
import { SDK_USER_AGENT } from './http-client.js';

/**
 * A single bid entry for a wallet's current round bids
 */
export interface WalletBidEntry {
  /** Tile index (0-24) */
  tile: number;
  /** Bid amount in lamports (string for precision) */
  amountRaw: string;
  /** Bid amount in SOL */
  amountSol: number;
}

/**
 * Current round bids for a wallet
 */
export interface CurrentRoundBids {
  /** Round ID these bids are for */
  roundId: string;
  /** Total bid amount in lamports (string for precision) */
  totalAmountRaw: string;
  /** Total bid amount in SOL */
  totalAmountSol: number;
  /** Individual bid entries per tile */
  bids: WalletBidEntry[];
}

/**
 * Miner status response from the API
 *
 * Contains:
 * - SOL rewards (claimable after checkpoint)
 * - ORE rewards (unrefined = mining rewards, refined = staking rewards)
 * - Wallet balances (SOL, USDC, ORE tokens)
 * - Current round bids (if any)
 *
 * ORE Rewards Explained:
 * - unrefinedOre: Mining rewards from winning rounds. 10% tax on claim.
 * - refinedOre: Staking rewards earned by holding unrefined ORE. No tax.
 * - totalClaimableOre: Net claimable = unrefinedOre * 0.9 + refinedOre
 *
 * Note: Many miners choose NOT to claim ORE because holding unrefined ORE
 * earns refinedOre (compounding), and claiming triggers 10% tax.
 */
export interface MinerStatus {
  minerAddress: string;
  exists: boolean;
  needsCheckpoint: boolean;
  checkpointId: string | null;
  roundId: string | null;

  // SOL rewards (already checkpointed)
  claimableLamports: string | null;
  claimableSol: number | null;
  lastClaimSolAt: string | null;

  // SOL rewards (pending checkpoint)
  pendingClaimLamports: string | null;
  pendingClaimSol: number | null;

  // ORE rewards - unrefined (mining rewards, 10% tax on claim)
  unrefinedOreRaw: string | null;
  unrefinedOre: number | null;

  // ORE rewards - refined (staking rewards, no tax on claim)
  refinedOreRaw: string | null;
  refinedOre: number | null;

  // Total claimable ORE (unrefinedOre * 0.9 + refinedOre)
  totalClaimableOre: number | null;
  lastClaimOreAt: string | null;

  // Authority wallet balances
  authorityLamports: string;
  authoritySol: number;
  authorityUsdcRaw: string;
  authorityUsdc: number;

  // ORE token balance in wallet
  authorityOreRaw: string;
  authorityOre: number;

  // Current round bids (populated from wallet-bids-cache, may be null if no bids or cache miss)
  currentRoundBids: CurrentRoundBids | null;
}

/**
 * MinerClient events
 */
export interface MinerClientEvents {
  /** Emitted when miner data is updated */
  update: (status: MinerStatus) => void;
  /** Emitted when claimable SOL rewards change */
  rewardsChanged: (payload: { previous: number | null; current: number | null }) => void;
  /** Emitted when ORE rewards change (unrefined or refined) */
  oreRewardsChanged: (payload: {
    previousUnrefined: number | null;
    currentUnrefined: number | null;
    previousRefined: number | null;
    currentRefined: number | null;
  }) => void;
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
 *   apiBaseUrl: 'https://api.oredata.supply',
 *   apiKey: 'your-api-key',
 *   authority: wallet.publicKey.toBase58(),
 * });
 *
 * miner.on('update', (status) => {
 *   console.log(`Wallet: ${status.authoritySol} SOL, ${status.authorityOre} ORE`);
 *   console.log(`Claimable SOL: ${status.claimableSol}`);
 *   console.log(`Unrefined ORE: ${status.unrefinedOre} (10% tax on claim)`);
 *   console.log(`Refined ORE: ${status.refinedOre} (no tax)`);
 *   console.log(`Net claimable ORE: ${status.totalClaimableOre}`);
 * });
 *
 * miner.on('oreRewardsChanged', ({ currentUnrefined, currentRefined }) => {
 *   console.log(`ORE rewards updated: ${currentUnrefined} unrefined, ${currentRefined} refined`);
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
  private lastUnrefinedOre: number | null = null;
  private lastRefinedOre: number | null = null;

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
   * Includes retry logic for rate limits (429)
   */
  async fetch(maxRetries = 3): Promise<MinerStatus> {
    const url = `${this.apiBaseUrl}/v3/miner?authority=${encodeURIComponent(this.authority)}`;

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': SDK_USER_AGENT,
    };
    if (this.apiKey) {
      headers['X-Api-Key'] = this.apiKey;
    }

    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await fetch(url, { headers });

        if (response.status === 429) {
          // Rate limited - extract retry-after and wait
          const retryAfter = response.headers.get('Retry-After');
          const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 1000 * (attempt + 1);
          await this.sleep(waitMs);
          continue;
        }

        if (!response.ok) {
          throw new Error(`Failed to fetch miner status: ${response.status}`);
        }

        return (await response.json()) as MinerStatus;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        // For non-429 errors, wait a bit before retry
        if (attempt < maxRetries - 1) {
          await this.sleep(500 * (attempt + 1));
        }
      }
    }

    throw lastError ?? new Error('Failed to fetch miner status after retries');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
    this.lastUnrefinedOre = null;
    this.lastRefinedOre = null;
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
    const previousUnrefined = this.lastUnrefinedOre;
    const currentUnrefined = status.unrefinedOre;
    const previousRefined = this.lastRefinedOre;
    const currentRefined = status.refinedOre;

    // Always emit update
    this.emit('update', status);

    // Check if claimable SOL rewards changed
    if (previousClaimable !== currentClaimable) {
      this.emit('rewardsChanged', {
        previous: previousClaimable,
        current: currentClaimable,
      });
    }

    // Check if ORE rewards changed
    if (previousUnrefined !== currentUnrefined || previousRefined !== currentRefined) {
      this.emit('oreRewardsChanged', {
        previousUnrefined,
        currentUnrefined,
        previousRefined,
        currentRefined,
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
    this.lastUnrefinedOre = currentUnrefined;
    this.lastRefinedOre = currentRefined;
  }
}

/**
 * Create a MinerClient instance
 */
export function createMinerClient(options: MinerClientOptions): MinerClient {
  return new MinerClient(options);
}

