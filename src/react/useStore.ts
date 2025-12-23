'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useOredataClient } from './context.js';
import type {
  OredataStore,
  RoundData,
  WinnerData,
  NextRoundInfo,
  PreviousRoundTiming,
  RoundCompletedPayload,
  RoundStartedPayload,
  MiningStatusChangedPayload,
} from '../state/oredata-store.js';

/**
 * Options for useStore hook
 */
export interface UseStoreOptions {
  /** Max history to retrieve (default: 50) */
  historyLimit?: number;
}

/**
 * Return type for useStore hook
 */
export interface UseStoreReturn {
  // Store instance
  store: OredataStore | null;

  // Current state
  currentRound: RoundData | null;
  previousRound: RoundData | null;
  currentRoundId: string | null;

  // Timing data (for countdowns)
  currentSlot: number | null;
  slotDurationMs: number;
  nextRound: NextRoundInfo | null;
  previousRoundTiming: PreviousRoundTiming | null;

  // Winner data
  currentWinner: WinnerData | null;
  winnerHistory: WinnerData[];

  // Methods
  getRound: (roundId: string) => RoundData | null;
  getWinner: (roundId: string) => WinnerData | null;
  hasWinner: (roundId: string) => boolean;

  // Status
  isReady: boolean;
}

/**
 * useStore - Hook for OredataStore (Layer 1)
 *
 * Provides direct access to round data with instant events.
 * Use this for:
 * - Bots and analytics (need immediate data)
 * - Dashboards (display raw data)
 * - Any non-UI use case
 *
 * For UI timing (animations, reveals), use usePresenter() instead.
 *
 * @example
 * ```tsx
 * function Dashboard() {
 *   const {
 *     currentRound,
 *     previousRound,
 *     winnerHistory,
 *     currentWinner,
 *   } = useStore();
 *
 *   return (
 *     <div>
 *       <h2>Current Round: {currentRound?.roundId}</h2>
 *       <p>Pot: {currentRound?.totals.deployedSol} SOL</p>
 *       
 *       {currentWinner && (
 *         <div>
 *           Winner: Tile {currentWinner.tile + 1}
 *           {currentWinner.wasLate && ' (late)'}
 *         </div>
 *       )}
 *       
 *       <h3>Recent Winners</h3>
 *       <ul>
 *         {winnerHistory.map(w => (
 *           <li key={w.roundId}>
 *             Round {w.roundId}: Tile {w.tile + 1}
 *             ({w.arrivalMs}ms)
 *           </li>
 *         ))}
 *       </ul>
 *     </div>
 *   );
 * }
 * ```
 */
export function useStore(options: UseStoreOptions = {}): UseStoreReturn {
  const { client, isInitialized } = useOredataClient();
  const { historyLimit = 50 } = options;

  // Store instance
  const store = useMemo(() => {
    if (!client) return null;
    return client.getStore();
  }, [client]);

  // State
  const [currentRound, setCurrentRound] = useState<RoundData | null>(null);
  const [previousRound, setPreviousRound] = useState<RoundData | null>(null);
  const [currentRoundId, setCurrentRoundId] = useState<string | null>(null);
  const [currentSlot, setCurrentSlot] = useState<number | null>(null);
  const [slotDurationMs, setSlotDurationMs] = useState<number>(400);
  const [nextRound, setNextRound] = useState<NextRoundInfo | null>(null);
  const [previousRoundTiming, setPreviousRoundTiming] = useState<PreviousRoundTiming | null>(null);
  const [currentWinner, setCurrentWinner] = useState<WinnerData | null>(null);
  const [winnerHistory, setWinnerHistory] = useState<WinnerData[]>([]);

  // Update state from store
  const updateFromStore = useCallback(() => {
    if (!store) return;

    setCurrentRound(store.getCurrentRound());
    setPreviousRound(store.getPreviousRound());
    setCurrentRoundId(store.getCurrentRoundId());
    setCurrentSlot(store.getCurrentSlot());
    setSlotDurationMs(store.getSlotDurationMs());
    setNextRound(store.getNextRound());
    setPreviousRoundTiming(store.getPreviousRoundTiming());
    setWinnerHistory(store.getWinnerHistory(historyLimit));

    // Get winner for current or previous round
    const currentId = store.getCurrentRoundId();
    const finalizedId = store.getLatestFinalizedRoundId();
    const winnerId = finalizedId || currentId;
    if (winnerId) {
      setCurrentWinner(store.getWinner(winnerId));
    }
  }, [store, historyLimit]);

  // Subscribe to store events
  useEffect(() => {
    if (!store) return;

    // Initial state
    updateFromStore();

    // Event handlers
    const onRoundStarted = (payload: RoundStartedPayload) => {
      setCurrentRoundId(payload.roundId);
      updateFromStore();
    };

    const onRoundCompleted = (payload: RoundCompletedPayload) => {
      setCurrentWinner(payload.winner);
      updateFromStore();
    };

    const onMiningStatusChanged = (payload: MiningStatusChangedPayload) => {
      updateFromStore();
    };

    const onRoundDataUpdated = () => {
      updateFromStore();
    };

    // Subscribe
    store.on('roundStarted', onRoundStarted);
    store.on('roundCompleted', onRoundCompleted);
    store.on('miningStatusChanged', onMiningStatusChanged);
    store.on('roundDataUpdated', onRoundDataUpdated);

    return () => {
      store.off('roundStarted', onRoundStarted);
      store.off('roundCompleted', onRoundCompleted);
      store.off('miningStatusChanged', onMiningStatusChanged);
      store.off('roundDataUpdated', onRoundDataUpdated);
    };
  }, [store, updateFromStore]);

  // Methods
  const getRound = useCallback(
    (roundId: string) => store?.getRound(roundId) ?? null,
    [store]
  );

  const getWinner = useCallback(
    (roundId: string) => store?.getWinner(roundId) ?? null,
    [store]
  );

  const hasWinner = useCallback(
    (roundId: string) => store?.hasWinner(roundId) ?? false,
    [store]
  );

  return {
    store,
    currentRound,
    previousRound,
    currentRoundId,
    currentSlot,
    slotDurationMs,
    nextRound,
    previousRoundTiming,
    currentWinner,
    winnerHistory,
    getRound,
    getWinner,
    hasWinner,
    isReady: isInitialized && store !== null,
  };
}

