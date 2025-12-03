/**
 * @oredata/sdk/react - React hooks for the oredata SDK
 *
 * Provides React hooks and components for building ORE games
 * with minimal boilerplate.
 *
 * @example
 * ```tsx
 * import {
 *   OredataProvider,
 *   useStore,
 *   usePresenter,
 *   useMinerAccount,
 *   useBidTracker,
 *   useRoundTiming,
 * } from '@oredata/sdk/react';
 *
 * function App() {
 *   return (
 *     <OredataProvider
 *       config={{
 *         baseUrls: ['https://ore-api.gmore.fun'],
 *         apiKey: process.env.ORE_API_KEY,
 *       }}
 *     >
 *       <Game />
 *     </OredataProvider>
 *   );
 * }
 *
 * function Game() {
 *   // Layer 1: Data (for game logic)
 *   const { currentRound, isConnected } = useStore();
 *   
 *   // Layer 2: Timing (for UI animations)
 *   const { displayPhase, displayedWinner } = usePresenter();
 *   
 *   // Countdown timer
 *   const { countdown, inRound } = useRoundTiming();
 *   
 *   // Wallet tracking
 *   const { solBalance, claimableSol } = useMinerAccount(wallet.publicKey);
 *   
 *   // Bid tracking
 *   const { currentBids, trackBid } = useBidTracker();
 *
 *   if (!isConnected) return <Connecting />;
 *   return <GameUI phase={displayPhase} winner={displayedWinner} countdown={countdown} />;
 * }
 * ```
 *
 * @packageDocumentation
 */

// Context and Provider
export { OredataProvider, useOredataClient, OredataContext } from './context.js';

// Layer 1: Data hooks (RFC v2.1)
export { useStore } from './useStore.js';

// Layer 2: Presentation hooks (RFC v2.1)
export { usePresenter } from './usePresenter.js';

// Legacy hooks removed in v0.12.0
// Migration: useOredataState() → useStore() + usePresenter()
// Migration: useOredataEvents() → store.on('roundCompleted', ...)

// Timing Hook
export {
  useRoundTiming,
  getRoundTiming,
  formatDuration,
  DEFAULT_SLOT_DURATION_MS,
} from './useRoundTiming.js';

// Utility Hooks
export { useMinerAccount } from './useMinerAccount.js';
export { useBidTracker } from './useBidTracker.js';

// Components
export { OredataErrorBoundary, ConnectionError } from './OredataErrorBoundary.js';

// Types - Provider
export type {
  OredataProviderConfig,
  OredataProviderProps,
  OredataContextValue,
  
  // Miner hook types
  UseMinerAccountOptions,
  UseMinerAccountReturn,
  
  // Bid tracker types
  UseBidTrackerOptions,
  UseBidTrackerReturn,
  
  // Error boundary types
  OredataErrorBoundaryProps,
  OredataErrorBoundaryState,
} from './types.js';

// Layer 1 hook types
export type {
  UseStoreOptions,
  UseStoreReturn,
} from './useStore.js';

// Layer 2 hook types
export type {
  UsePresenterOptions,
  UsePresenterReturn,
} from './usePresenter.js';

// Timing hook types
export type {
  UseRoundTimingOptions,
  UseRoundTimingReturn,
  RoundTiming,
  RoundTimingOptions,
} from './useRoundTiming.js';

// Re-export commonly used types from main SDK for convenience
export type {
  TransportStatus,
} from '../state/state-client.js';

export type {
  RoundFrame,
} from '../state/types.js';

export type {
  PhaseMetadata,
  HealthSnapshot,
  QuotaSnapshot,
  BillingSnapshot,
  ConnectionState,
} from '../types.js';

export type {
  MinerStatus,
} from '../miner-client.js';

export type {
  TrackedBid,
  WinCheckResult,
} from '../bid-tracker.js';

// Layer 1: OredataStore types
export type {
  RoundData,
  WinnerData,
  RoundCompletedPayload,
  RoundStartedPayload,
  MiningStatusChangedPayload,
  RoundDataUpdatedPayload,
  OredataStoreEvents,
  MiningStatus,
  WinnerSource,
} from '../state/oredata-store.js';

export { OredataStore } from '../state/oredata-store.js';

// Layer 2: OredataState types
export type {
  OredataStateConfig,
  DisplayPhase,
  WinnerDisplay,
  PhaseChangePayload,
  WinnerRevealPayload,
  WinnerTimeoutPayload,
  ResultOverlayShowPayload,
  OredataStateEvents,
} from '../state/oredata-state.js';

export { OredataState } from '../state/oredata-state.js';
