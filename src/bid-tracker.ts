/**
 * Client-side bid tracking for oredata SDK
 *
 * Tracks bids placed through the SDK, persists to localStorage (optional),
 * and provides helpers to check win status.
 */

/**
 * A tracked bid
 */
export interface TrackedBid {
  /** Round ID */
  roundId: string;
  /** Tiles that were bid on (0-24) */
  tiles: number[];
  /** Amount in lamports */
  amountLamports: string;
  /** Amount in SOL */
  amountSol: number;
  /** Timestamp when bid was placed */
  placedAt: number;
  /** Transaction signature (if available) */
  txSignature?: string;
}

/**
 * Win check result
 */
export interface WinCheckResult {
  /** Whether user won this round */
  won: boolean;
  /** The winning tile (if round has a winner) */
  winningTile: number | null;
  /** Whether user bid on the winning tile */
  bidOnWinner: boolean;
  /** User's bids for this round */
  bids: TrackedBid[];
}

/**
 * BidTracker options
 */
export interface BidTrackerOptions {
  /** Enable localStorage persistence (default: true in browser, false in Node) */
  persist?: boolean;
  /** localStorage key prefix (default: 'oredata:bids') */
  storageKey?: string;
  /** Max rounds to keep in history (default: 50) */
  maxRounds?: number;
  /** Auto-cleanup rounds older than this (ms, default: 24 hours) */
  maxAge?: number;
}

const DEFAULT_STORAGE_KEY = 'oredata:bids';
const DEFAULT_MAX_ROUNDS = 50;
const DEFAULT_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Detect if we're in a browser environment with localStorage
 */
function hasLocalStorage(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  } catch {
    return false;
  }
}

/**
 * BidTracker - Client-side bid tracking
 *
 * @example
 * ```typescript
 * import { BidTracker } from '@oredata/sdk';
 *
 * const tracker = new BidTracker();
 *
 * // Track a bid when placed
 * tracker.trackBid({
 *   roundId: '12345',
 *   tiles: [5, 10, 15],
 *   amountLamports: '1000000000',
 *   amountSol: 1.0,
 *   placedAt: Date.now(),
 *   txSignature: 'abc123...',
 * });
 *
 * // Check if user won after round ends
 * const result = tracker.didIWin('12345', 10);
 * if (result.won) {
 *   console.log('You won!');
 * }
 * ```
 */
export class BidTracker {
  private readonly persist: boolean;
  private readonly storageKey: string;
  private readonly maxRounds: number;
  private readonly maxAge: number;

  /** In-memory bid storage: roundId -> bids */
  private bids = new Map<string, TrackedBid[]>();

  constructor(options: BidTrackerOptions = {}) {
    this.persist = options.persist ?? hasLocalStorage();
    this.storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
    this.maxRounds = options.maxRounds ?? DEFAULT_MAX_ROUNDS;
    this.maxAge = options.maxAge ?? DEFAULT_MAX_AGE;

    // Load from localStorage if available
    if (this.persist) {
      this.loadFromStorage();
    }
  }

  /**
   * Track a bid
   */
  trackBid(bid: TrackedBid): void {
    const existing = this.bids.get(bid.roundId) ?? [];
    existing.push(bid);
    this.bids.set(bid.roundId, existing);

    // Cleanup old rounds
    this.cleanup();

    // Persist
    if (this.persist) {
      this.saveToStorage();
    }
  }

  /**
   * Get all bids for a round
   */
  getBidsForRound(roundId: string): TrackedBid[] {
    return this.bids.get(roundId) ?? [];
  }

  /**
   * Get all tracked rounds
   */
  getTrackedRounds(): string[] {
    return Array.from(this.bids.keys());
  }

  /**
   * Check if user won a round
   *
   * @param roundId - Round ID to check
   * @param winningTile - The winning tile (from round result)
   */
  didIWin(roundId: string, winningTile: number | null): WinCheckResult {
    const bids = this.getBidsForRound(roundId);

    if (winningTile === null) {
      return {
        won: false,
        winningTile: null,
        bidOnWinner: false,
        bids,
      };
    }

    // Check if any bid includes the winning tile
    const bidOnWinner = bids.some((bid) => bid.tiles.includes(winningTile));

    return {
      won: bidOnWinner,
      winningTile,
      bidOnWinner,
      bids,
    };
  }

  /**
   * Get total amount bid in a round
   */
  getTotalBidForRound(roundId: string): { lamports: bigint; sol: number } {
    const bids = this.getBidsForRound(roundId);
    let lamports = 0n;
    let sol = 0;

    for (const bid of bids) {
      lamports += BigInt(bid.amountLamports);
      sol += bid.amountSol;
    }

    return { lamports, sol };
  }

  /**
   * Clear bids for a specific round
   */
  clearRound(roundId: string): void {
    this.bids.delete(roundId);
    if (this.persist) {
      this.saveToStorage();
    }
  }

  /**
   * Clear all tracked bids
   */
  clearAll(): void {
    this.bids.clear();
    if (this.persist) {
      this.saveToStorage();
    }
  }

  /**
   * Get statistics
   */
  getStats(): { roundCount: number; totalBids: number } {
    let totalBids = 0;
    for (const bids of this.bids.values()) {
      totalBids += bids.length;
    }
    return {
      roundCount: this.bids.size,
      totalBids,
    };
  }

  /**
   * Cleanup old rounds based on maxRounds and maxAge
   */
  private cleanup(): void {
    const now = Date.now();
    const rounds = Array.from(this.bids.entries());

    // Remove rounds older than maxAge
    for (const [roundId, bids] of rounds) {
      const oldestBid = bids[0];
      if (oldestBid && now - oldestBid.placedAt > this.maxAge) {
        this.bids.delete(roundId);
      }
    }

    // Remove oldest rounds if exceeding maxRounds
    if (this.bids.size > this.maxRounds) {
      const sortedRounds = Array.from(this.bids.entries())
        .map(([roundId, bids]) => ({
          roundId,
          oldestBid: bids[0]?.placedAt ?? 0,
        }))
        .sort((a, b) => a.oldestBid - b.oldestBid);

      const toRemove = sortedRounds.slice(0, sortedRounds.length - this.maxRounds);
      for (const { roundId } of toRemove) {
        this.bids.delete(roundId);
      }
    }
  }

  /**
   * Load bids from localStorage
   */
  private loadFromStorage(): void {
    if (!hasLocalStorage()) return;

    try {
      const raw = window.localStorage.getItem(this.storageKey);
      if (!raw) return;

      const data = JSON.parse(raw) as Record<string, TrackedBid[]>;
      for (const [roundId, bids] of Object.entries(data)) {
        this.bids.set(roundId, bids);
      }

      // Cleanup after loading
      this.cleanup();
    } catch (error) {
      console.warn('[BidTracker] Failed to load from localStorage:', error);
    }
  }

  /**
   * Save bids to localStorage
   */
  private saveToStorage(): void {
    if (!hasLocalStorage()) return;

    try {
      const data: Record<string, TrackedBid[]> = {};
      for (const [roundId, bids] of this.bids) {
        data[roundId] = bids;
      }
      window.localStorage.setItem(this.storageKey, JSON.stringify(data));
    } catch (error) {
      console.warn('[BidTracker] Failed to save to localStorage:', error);
    }
  }
}

/**
 * Create a BidTracker instance
 */
export function createBidTracker(options?: BidTrackerOptions): BidTracker {
  return new BidTracker(options);
}

