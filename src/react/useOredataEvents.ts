/**
 * @deprecated Use Layer 1 events via `useStore()` instead. This hook is kept for backward compatibility.
 * 
 * Migration:
 * ```typescript
 * // Before
 * useOredataEvents({
 *   onWinner: ({ type, winner }) => console.log(winner),
 * });
 * 
 * // After
 * const { store } = useOredataClient();
 * useEffect(() => {
 *   if (!store) return;
 *   store.on('roundCompleted', ({ winner }) => console.log(winner.tile));
 *   return () => store.off('roundCompleted', ...);
 * }, [store]);
 * ```
 */

import { useEffect } from 'react';
import { useOredataClient } from './context.js';

export interface UseOredataEventsOptions {
  /** Called when winner is determined */
  onWinner?: (event: { type: 'optimistic' | 'final'; winner: number; roundId: string }) => void;
  /** Called when motherlode (jackpot) hits */
  onMotherlode?: (event: { amountFormatted: string; roundId: string }) => void;
  /** Called when round starts */
  onRoundStart?: (event: { roundId: string }) => void;
  /** Called when phase changes */
  onPhaseChange?: (event: { phase: string }) => void;
}

/**
 * @deprecated Use Layer 1 events via `store.on()` instead.
 */
export function useOredataEvents(options: UseOredataEventsOptions): void {
  const { client } = useOredataClient();
  const store = client?.getStore();

  useEffect(() => {
    if (!store) return;

    const handleRoundCompleted = ({ roundId, winner }: { roundId: string; winner: { tile: number; source: 'optimistic' | 'final'; motherlodeHit: boolean; motherlodeFormatted: string | null } }) => {
      if (options.onWinner) {
        options.onWinner({
          type: winner.source,
          winner: winner.tile,
          roundId,
        });
      }
      if (options.onMotherlode && winner.motherlodeHit && winner.motherlodeFormatted) {
        options.onMotherlode({
          amountFormatted: winner.motherlodeFormatted,
          roundId,
        });
      }
    };

    const handleRoundStarted = ({ roundId }: { roundId: string }) => {
      options.onRoundStart?.({ roundId });
      options.onPhaseChange?.({ phase: 'BETTING' });
    };

    const handleMiningStatusChanged = ({ status }: { status: string }) => {
      if (status === 'EXPIRED') {
        options.onPhaseChange?.({ phase: 'SPINNING' });
      }
    };

    store.on('roundCompleted', handleRoundCompleted);
    store.on('roundStarted', handleRoundStarted);
    store.on('miningStatusChanged', handleMiningStatusChanged);

    return () => {
      store.off('roundCompleted', handleRoundCompleted);
      store.off('roundStarted', handleRoundStarted);
      store.off('miningStatusChanged', handleMiningStatusChanged);
    };
  }, [store, options.onWinner, options.onMotherlode, options.onRoundStart, options.onPhaseChange]);
}

