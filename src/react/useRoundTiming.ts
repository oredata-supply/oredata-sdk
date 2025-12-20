'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useStore } from './useStore.js';
import {
  getRoundTiming,
  formatDuration,
  DEFAULT_SLOT_DURATION_MS,
  DEFAULT_BREATHER_DURATION_MS,
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
 * useRoundTiming - Real-time countdown hook
 * 
 * Provides automatically updating countdown timers for:
 * - Active rounds: "42s" until round ends
 * - Breather (known): "3s" until next round starts
 * - Breather (unknown): "Next round starting soon..."
 * 
 * @example
 * ```tsx
 * function GameTimer() {
 *   const {
 *     inRound,
 *     inBreather,
 *     countdown,
 *     progress,
 *     nextRoundKnown,
 *     phaseLabel,
 *   } = useRoundTiming();
 * 
 *   return (
 *     <div>
 *       <span className={inRound ? 'text-green-500' : 'text-yellow-500'}>
 *         {phaseLabel}
 *       </span>
 *       <span>{countdown}</span>
 *       
 *       {inRound && progress !== null && (
 *         <div className="progress-bar">
 *           <div style={{ width: `${progress * 100}%` }} />
 *         </div>
 *       )}
 *       
 *       {inBreather && !nextRoundKnown && (
 *         <div className="animate-pulse">⏳</div>
 *       )}
 *     </div>
 *   );
 * }
 * ```
 * 
 * @example
 * ```tsx
 * // Custom messages
 * const { countdown } = useRoundTiming({
 *   soonMessage: 'Hang tight...',
 *   idleMessage: 'Connecting...',
 *   refreshIntervalMs: 50, // Smoother updates
 * });
 * ```
 */
export function useRoundTiming(options: UseRoundTimingOptions = {}): UseRoundTimingReturn {
  const {
    refreshIntervalMs = 100,
    slotDurationMs: slotDurationMsOverride,
    breatherDurationMs,
    soonMessage,
    idleMessage,
  } = options;

  const { currentSlot, currentRound, nextRound, slotDurationMs: storeSlotDurationMs, isReady } = useStore();
  
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
      },
      { slotDurationMs, breatherDurationMs, soonMessage, idleMessage }
    );
  }, [currentSlot, currentRound, nextRound, slotDurationMs, breatherDurationMs, soonMessage, idleMessage]);

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
export { getRoundTiming, formatDuration, DEFAULT_SLOT_DURATION_MS, DEFAULT_BREATHER_DURATION_MS };
export type { RoundTiming, RoundTimingOptions };

