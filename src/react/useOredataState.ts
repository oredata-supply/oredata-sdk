/**
 * @deprecated Use `useStore()` instead. This hook is kept for backward compatibility.
 * 
 * Migration:
 * ```typescript
 * // Before
 * const { phase, roundId, winner } = useOredataState();
 * 
 * // After
 * const { currentRound, isConnected } = useStore();
 * const roundId = currentRound?.roundId;
 * const winner = currentRound?.winner;
 * ```
 */

import { useEffect, useState, useMemo } from 'react';
import { useOredataClient } from './context.js';
import type { RoundData } from '../state/oredata-store.js';

export interface UseOredataStateOptions {
  /** @deprecated No longer used */
  select?: string[];
}

export interface UseOredataStateReturn {
  /** Current phase - use Layer 1 events instead */
  phase: { phase: string } | null;
  /** Current round ID */
  roundId: string | null;
  /** Current pot info */
  pot: { totalSol: number } | null;
  /** Winner info */
  winner: { winner: number; roundId: string } | null;
  /** Current frame (raw data) */
  currentFrame: unknown;
  /** Is connected */
  isConnected: boolean;
  /** Is loading */
  isLoading: boolean;
}

/**
 * @deprecated Use `useStore()` instead.
 */
export function useOredataState(_options?: UseOredataStateOptions): UseOredataStateReturn {
  const { client, isInitialized } = useOredataClient();
  const store = client?.getStore();
  const [currentRound, setCurrentRound] = useState<RoundData | null>(null);
  const [phase, setPhase] = useState<string>('IDLE');

  useEffect(() => {
    if (!store) return;

    const updateState = () => {
      const round = store.getCurrentRound();
      setCurrentRound(round);
      
      // Derive phase from round state
      if (round?.mining?.status === 'ACTIVE') {
        setPhase('BETTING');
      } else if (round?.mining?.status === 'EXPIRED' && !round?.winner) {
        setPhase('SPINNING');
      } else if (round?.winner) {
        setPhase('RESULT');
      } else {
        setPhase('IDLE');
      }
    };

    // Initial state
    updateState();

    // Subscribe to updates
    store.on('roundDataUpdated', updateState);
    store.on('roundStarted', updateState);
    store.on('roundCompleted', updateState);
    store.on('miningStatusChanged', updateState);

    return () => {
      store.off('roundDataUpdated', updateState);
      store.off('roundStarted', updateState);
      store.off('roundCompleted', updateState);
      store.off('miningStatusChanged', updateState);
    };
  }, [store]);

  const isConnected = isInitialized && !!client;

  return useMemo(() => ({
    phase: { phase },
    roundId: currentRound?.roundId ?? null,
    pot: currentRound?.totals ? { totalSol: currentRound.totals.deployedSol } : null,
    winner: currentRound?.winner 
      ? { winner: currentRound.winner.tile, roundId: currentRound.roundId }
      : null,
    currentFrame: currentRound,
    isConnected,
    isLoading: !isConnected,
  }), [phase, currentRound, isConnected]);
}

