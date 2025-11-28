/**
 * React hooks types for @oredata/sdk
 */

import type { OredataClientOptions, StateRequestOptions } from '../types.js';
import type { StateStoreSnapshot, RoundFrame, RoundFrameGlobals } from '../state/types.js';
import type {
  AppMode,
  TransportStatus,
  WinnerEventPayload,
  RoundFinalizedPayload,
  MotherlodeEventPayload,
} from '../state/state-client.js';
import type { MinerStatus } from '../miner-client.js';
import type { TrackedBid, WinCheckResult, BidTrackerOptions } from '../bid-tracker.js';
import type { PhaseMetadata, HealthSnapshot, QuotaSnapshot, BillingSnapshot, ConnectionState } from '../types.js';

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
 * Pot totals
 */
export interface PotTotals {
  /** Total SOL in pot */
  totalSol: number;
  /** Total lamports in pot (string for precision) */
  totalLamports: string;
}

/**
 * Selector for fine-grained re-renders
 */
export type StateSelector = 
  | 'phase'
  | 'roundId'
  | 'pot'
  | 'winner'
  | 'frames'
  | 'globals'
  | 'transport'
  | 'isConnected'
  | 'isLoading';

/**
 * Options for useOredataState hook
 */
export interface UseOredataStateOptions {
  /**
   * Select specific state slices to reduce re-renders
   * If not provided, all state changes trigger re-render
   */
  select?: StateSelector[];
}

/**
 * Return type for useOredataState hook
 */
export interface UseOredataStateReturn {
  // Connection status
  isConnected: boolean;
  isLoading: boolean;
  error: Error | null;

  // Current state
  phase: PhaseMetadata | null;
  roundId: string | null;
  pot: PotTotals | null;

  // Winner info
  winner: WinnerEventPayload | null;
  isWinnerRevealed: boolean;

  // Round data
  frames: RoundFrame[];
  currentFrame: RoundFrame | null;

  // Globals (prices, treasury, etc.)
  globals: RoundFrameGlobals | null;

  // Full snapshot
  snapshot: StateStoreSnapshot | null;

  // Transport info
  transport: TransportStatus | null;

  // Health & Connection
  health: HealthSnapshot | null;
  connectionState: ConnectionState | null;

  // Quota & Billing
  quota: QuotaSnapshot | null;
  billing: BillingSnapshot | null;

  // Data freshness
  isDataStale: boolean;
  dataAge: number | null;

  // Current app mode
  mode: AppMode;

  // Actions
  setMode: (mode: AppMode) => void;
  refresh: () => Promise<void>;
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
  // Balances
  solBalance: number | null;
  oreBalance: number | null;
  usdcBalance: number | null;
  claimableSol: number | null;
  claimableOre: number | null;
  pendingSol: number | null;

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
 * Event handlers for useOredataEvents hook
 */
export interface OredataEventHandlers {
  onSnapshot?: (snapshot: StateStoreSnapshot) => void;
  onPhaseChange?: (phase: PhaseMetadata | null) => void;
  onWinner?: (event: WinnerEventPayload) => void;
  onRoundFinalized?: (event: RoundFinalizedPayload) => void;
  onMotherlode?: (event: MotherlodeEventPayload) => void;
  onTransport?: (status: TransportStatus) => void;
  onError?: (error: Error) => void;
  onHealth?: (snapshot: HealthSnapshot) => void;
  onModeChange?: (mode: AppMode) => void;
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

