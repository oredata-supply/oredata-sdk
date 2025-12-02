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
 *   useOredataState,
 *   useMinerAccount,
 *   useBidTracker,
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
 *   const { phase, winner, pot, isConnected } = useOredataState();
 *   const { solBalance, claimableSol } = useMinerAccount(wallet.publicKey);
 *   const { currentBids, trackBid } = useBidTracker();
 *
 *   if (!isConnected) return <Connecting />;
 *   return <GameUI phase={phase} winner={winner} pot={pot} />;
 * }
 * ```
 *
 * @packageDocumentation
 */

// Context and Provider
export { OredataProvider, useOredataClient, OredataContext } from './context.js';

// Main Hooks
export { useOredataState } from './useOredataState.js';
export { useMinerAccount } from './useMinerAccount.js';
export { useBidTracker } from './useBidTracker.js';
export { useOredataEvents } from './useOredataEvents.js';

// Layer 1 & 2 Hooks (RFC v2.1)
export { useStore } from './useStore.js';
export { usePresenter } from './usePresenter.js';

// Components
export { OredataErrorBoundary, ConnectionError } from './OredataErrorBoundary.js';

// Types
export type {
  // Provider types
  OredataProviderConfig,
  OredataProviderProps,
  OredataContextValue,
  
  // State hook types
  UseOredataStateOptions,
  UseOredataStateReturn,
  StateSelector,
  PotTotals,
  
  // Miner hook types
  UseMinerAccountOptions,
  UseMinerAccountReturn,
  
  // Bid tracker types
  UseBidTrackerOptions,
  UseBidTrackerReturn,
  
  // Events types
  OredataEventHandlers,
  
  // Error boundary types
  OredataErrorBoundaryProps,
  OredataErrorBoundaryState,
} from './types.js';

// Layer 1 & 2 hook types
export type {
  UseStoreOptions,
  UseStoreReturn,
} from './useStore.js';

export type {
  UsePresenterOptions,
  UsePresenterReturn,
} from './usePresenter.js';

// Re-export commonly used types from main SDK for convenience
export type {
  AppMode,
  WinnerEventPayload,
  RoundFinalizedPayload,
  MotherlodeEventPayload,
  TransportStatus,
} from '../state/state-client.js';

export type {
  RoundFrame,
  StateStoreSnapshot,
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

