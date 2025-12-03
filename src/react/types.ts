/**
 * React hooks types for @oredata/sdk
 */

import type { OredataClientOptions, StateRequestOptions } from '../types.js';
import type { MinerStatus } from '../miner-client.js';
import type { TrackedBid, WinCheckResult, BidTrackerOptions } from '../bid-tracker.js';

/**
 * Configuration for OredataProvider
 */
export interface OredataProviderConfig extends OredataClientOptions {
  /**
   * State request options (frames, sections, etc.)
   */
  stateOptions?: StateRequestOptions;
  /**
   * Auto-start the StateClient on mount (default: true)
   */
  autoStart?: boolean;
}

/**
 * Props for OredataProvider component
 */
export interface OredataProviderProps {
  config: OredataProviderConfig;
  children: React.ReactNode;
}

/**
 * Context value provided by OredataProvider
 */
export interface OredataContextValue {
  /**
   * The underlying OredataClient instance
   */
  client: import('../index.js').OredataClient | null;
  /**
   * Whether the client is initialized
   */
  isInitialized: boolean;
  /**
   * Error during initialization (if any)
   */
  initError: Error | null;
}

/**
 * Options for useMinerAccount hook
 */
export interface UseMinerAccountOptions {
  /**
   * Polling interval in ms (default: 5000)
   */
  pollInterval?: number;
  /**
   * Auto-start polling when authority is provided (default: true)
   */
  autoStart?: boolean;
}

/**
 * Return type for useMinerAccount hook
 */
export interface UseMinerAccountReturn {
  // Wallet balances
  authoritySol: number | null;
  authorityOre: number | null;
  authorityUsdc: number | null;
  /** @deprecated Use authoritySol instead */
  solBalance: number | null;
  /** @deprecated Use authorityOre instead */
  oreBalance: number | null;
  /** @deprecated Use authorityUsdc instead */
  usdcBalance: number | null;

  // SOL rewards
  claimableSol: number | null;
  pendingClaimSol: number | null;
  /** @deprecated Use pendingClaimSol instead */
  pendingSol: number | null;

  // ORE rewards
  /** Unrefined ORE - mining rewards (10% tax on claim) */
  unrefinedOre: number | null;
  /** Refined ORE - staking rewards (no tax) */
  refinedOre: number | null;
  /** Net claimable ORE = unrefinedOre * 0.9 + refinedOre */
  totalClaimableOre: number | null;
  /** @deprecated Use totalClaimableOre instead */
  claimableOre: number | null;

  // Status
  isLoading: boolean;
  error: Error | null;
  needsCheckpoint: boolean;
  exists: boolean;

  // Full status object
  status: MinerStatus | null;

  // Actions
  refresh: () => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;
  isPolling: boolean;
}

/**
 * Options for useBidTracker hook
 */
export interface UseBidTrackerOptions extends BidTrackerOptions {
  // Inherits persist, storageKey, maxRounds, maxAge from BidTrackerOptions
}

/**
 * Return type for useBidTracker hook
 */
export interface UseBidTrackerReturn {
  // Current round bids
  currentBids: TrackedBid[];
  totalBet: { lamports: bigint; sol: number };
  tilesSelected: number[];

  // History
  recentBids: Map<string, TrackedBid[]>;
  trackedRounds: string[];

  // Win checking
  didIWin: (roundId: string, winningTile: number | null) => WinCheckResult;

  // Actions
  trackBid: (bid: TrackedBid) => void;
  clearRound: (roundId: string) => void;
  clearAll: () => void;

  // Stats
  stats: { roundCount: number; totalBids: number };
}

/**
 * Props for OredataErrorBoundary component
 */
export interface OredataErrorBoundaryProps {
  children: React.ReactNode;
  fallback: React.ReactNode | ((error: Error, reset: () => void) => React.ReactNode);
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

/**
 * State for OredataErrorBoundary
 */
export interface OredataErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}
