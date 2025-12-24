'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useStore } from './useStore.js';
import {
  getRoundTiming,
  formatDuration,
  DEFAULT_SLOT_DURATION_MS,
  DEFAULT_BREATHER_DURATION_MS,
  MAX_BREATHER_DURATION_MS,
  type RoundTiming,
  type RoundTimingOptions,
} from '../timing/index.js';

/**
 * Options for useRoundTiming hook
 */
export interface UseRoundTimingOptions extends RoundTimingOptions {
  /** 
   * Refresh interval in ms for countdown updates (default: 100).
   * Set to 0 to disable auto-refresh.
   */
  refreshIntervalMs?: number;
}

/**
 * Return type for useRoundTiming hook
 */
export interface UseRoundTimingReturn extends RoundTiming {
  /** Re-calculate timing manually */
  refresh: () => void;
  
  /** Whether the store is ready */
  isReady: boolean;
}

/**
 * useRoundTiming - Real-time countdown hook with automatic updates.
 *
 * Provides accurate countdown timers and progress values for building UIs.
 * Uses slot-based timing from the blockchain for accuracy. During BETTING,
 * timing is exact. During BREATHER, timing is **estimated** until the next
 * round starts (when `nextRound.startSlot` becomes available).
 *
 * ## Key Concepts
 *
 * - **BETTING phase**: `progress` goes 0→1 (use for left→right progress bars)
 * - **BREATHER phase**: `breatherProgress` goes 1→0 (use for right→left progress bars)
 * - **Dynamic values**: Slot duration and breather duration are calculated from
 *   actual network data, not hardcoded constants
 *
 * ## Important: Estimation During Breather
 *
 * During the breather, `nextRound.startSlot` is unknown, so `breatherProgress`
 * and `nextRoundStartsInMs` are **estimated** based on typical breather duration.
 * Check `nextRoundKnown` to determine if values are exact or estimated.
 *
 * @param options.refreshIntervalMs - Update frequency in ms (default: 100)
 * @param options.soonMessage - Message when next round timing unknown (default: "Next round starting soon...")
 * @param options.idleMessage - Message when not connected (default: "Waiting for round...")
 * @param options.slotDurationMs - Override auto-detected slot duration (rarely needed)
 * @param options.breatherDurationMs - Override estimated breather duration (rarely needed)
 *
 * @returns Timing data object with the following properties:
 *
 * **BETTING Phase:**
 * - `inRound` - True during betting phase
 * - `progress` - 0→1 progress through round (use for left→right bar)
 * - `roundEndsInMs` - Milliseconds until round ends
 *
 * **BREATHER Phase:**
 * - `inBreather` - True between rounds (SPINNING/RESULT/IDLE)
 * - `breatherProgress` - 1→0 progress through breather (use for right→left bar)
 * - `nextRoundStartsInMs` - Milliseconds until next round (**estimated** if `!nextRoundKnown`)
 * - `nextRoundKnown` - True when `nextRound.startSlot` is available (false = estimated)
 * - `breatherDurationMs` - Calculated duration (dynamic from slots, falls back to ~18s)
 *
 * **Universal:**
 * - `countdown` - Human-readable countdown: "42s" or "Next round starting soon..."
 * - `phaseLabel` - 'BETTING' | 'BREATHER' | 'IDLE'
 * - `currentSlot` - Current Solana slot
 * - `refresh` - Manually trigger recalculation
 * - `isReady` - True when store is initialized
 *
 * @example
 * ```tsx
 * // Basic countdown
 * function GameTimer() {
 *   const { countdown, phaseLabel, inRound } = useRoundTiming();
 *   return <div className={inRound ? 'betting' : 'breather'}>{phaseLabel}: {countdown}</div>;
 * }
 * ```
 *
 * @example
 * ```tsx
 * // Progress bar with correct animation directions
 * function ProgressBar() {
 *   const { progress, breatherProgress, inRound, inBreather, nextRoundKnown } = useRoundTiming();
 *
 *   if (inRound && progress !== null) {
 *     // BETTING: bar fills left→right
 *     return <div style={{ width: `${progress * 100}%` }} />;
 *   }
 *
 *   if (inBreather && breatherProgress !== null) {
 *     // BREATHER: bar shrinks right→left
 *     return (
 *       <div style={{ width: `${breatherProgress * 100}%` }}>
 *         {!nextRoundKnown && <span>~</span>} {/* Estimated indicator *}
 *       </div>
 *     );
 *   }
 *
 *   return <div className="empty" />;
 * }
 * ```
 *
 * @see https://docs.oredata.supply/concepts/timing - Timing Deep Dive documentation
 */
export function useRoundTiming(options: UseRoundTimingOptions = {}): UseRoundTimingReturn {
  const {
    refreshIntervalMs = 100,
    slotDurationMs: slotDurationMsOverride,
    breatherDurationMs,
    soonMessage,
    idleMessage,
  } = options;

  const { currentSlot, currentRound, nextRound, previousRoundTiming, slotDurationMs: storeSlotDurationMs, isReady } = useStore();
  
  // Use override if provided, otherwise use actual network value from store
  const slotDurationMs = slotDurationMsOverride ?? storeSlotDurationMs;
  
  // Track last poll time for interpolation
  const lastPollRef = useRef<number>(Date.now());
  const [, forceUpdate] = useState(0);

  // Calculate timing with interpolation
  const timing = useMemo(() => {
    const now = Date.now();
    const msSinceLastPoll = now - lastPollRef.current;
    
    // Interpolate currentSlot based on time passed
    // This provides smooth countdown between API polls
    let interpolatedSlot = currentSlot;
    if (currentSlot !== null && msSinceLastPoll > 0) {
      const slotsPassed = msSinceLastPoll / slotDurationMs;
      interpolatedSlot = currentSlot + slotsPassed;
    }

    // Adjust remainingSlots for interpolation
    let adjustedRound = currentRound;
    if (currentRound && currentRound.mining.remainingSlots !== null && interpolatedSlot !== null) {
      const originalRemaining = currentRound.mining.remainingSlots;
      const slotDrift = interpolatedSlot - (currentSlot ?? interpolatedSlot);
      const adjustedRemaining = Math.max(0, originalRemaining - slotDrift);
      
      adjustedRound = {
        ...currentRound,
        mining: {
          ...currentRound.mining,
          remainingSlots: adjustedRemaining,
        },
      };
    }

    return getRoundTiming(
      {
        currentSlot: interpolatedSlot !== null ? Math.floor(interpolatedSlot) : null,
        currentRound: adjustedRound,
        nextRound,
        previousRoundTiming,
      },
      { slotDurationMs, breatherDurationMs, soonMessage, idleMessage }
    );
  }, [currentSlot, currentRound, nextRound, previousRoundTiming, slotDurationMs, breatherDurationMs, soonMessage, idleMessage]);

  // Update lastPollRef when we get new data
  useEffect(() => {
    if (currentSlot !== null) {
      lastPollRef.current = Date.now();
    }
  }, [currentSlot, currentRound?.roundId]);

  // Auto-refresh for smooth countdowns
  useEffect(() => {
    if (refreshIntervalMs <= 0) return;
    
    const interval = setInterval(() => {
      forceUpdate(n => n + 1);
    }, refreshIntervalMs);

    return () => clearInterval(interval);
  }, [refreshIntervalMs]);

  // Manual refresh function
  const refresh = () => forceUpdate(n => n + 1);

  return {
    ...timing,
    refresh,
    isReady,
  };
}

// Re-export timing utilities for convenience
export { getRoundTiming, formatDuration, DEFAULT_SLOT_DURATION_MS, DEFAULT_BREATHER_DURATION_MS, MAX_BREATHER_DURATION_MS };
export type { RoundTiming, RoundTimingOptions };

