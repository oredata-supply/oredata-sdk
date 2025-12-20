/**
 * SDK Timing Utilities
 * 
 * Provides countdown calculations for round and breather phases.
 * Uses slot math with 400ms default slot duration.
 * 
 * @see RFC-SDK-TIMING-LEAN-RESPONSE.md
 */

import type { RoundData, NextRoundInfo } from '../state/oredata-store.js';

// ============================================================================
// Constants
// ============================================================================

/** Default Solana slot duration in milliseconds */
export const DEFAULT_SLOT_DURATION_MS = 400;

/** Default estimated breather duration in milliseconds (~15-20s between rounds) */
export const DEFAULT_BREATHER_DURATION_MS = 18000;

// ============================================================================
// Types
// ============================================================================

/**
 * Round timing information for UI display
 */
export interface RoundTiming {
  /** Currently in active betting round */
  inRound: boolean;
  
  /** Currently in breather (between rounds) */
  inBreather: boolean;
  
  /** Milliseconds until round ends (null if not in round) */
  roundEndsInMs: number | null;
  
  /** Milliseconds until next round starts (null if unknown) */
  nextRoundStartsInMs: number | null;
  
  /** True when nextRound data is available (for UI logic) */
  nextRoundKnown: boolean;
  
  /** Progress through current round (0-1, null if not in round) */
  progress: number | null;

  /**
   * Progress through breather phase (1→0, null if not in breather or unknown).
   * Calculated from nextRoundStartsInMs / estimated breather duration.
   * Use for animations that move right→left during breather.
   */
  breatherProgress: number | null;

  /** Current Solana slot */
  currentSlot: number | null;
  
  /** Human-readable countdown string */
  countdown: string;
  
  /** Phase label for display */
  phaseLabel: 'BETTING' | 'BREATHER' | 'IDLE';
}

/**
 * Options for getRoundTiming
 */
export interface RoundTimingOptions {
  /** Slot duration in ms (default: 400) */
  slotDurationMs?: number;

  /** Estimated breather duration in ms (default: 18000). Used to calculate breatherProgress. */
  breatherDurationMs?: number;

  /** Custom "soon" message (default: "Next round starting soon...") */
  soonMessage?: string;

  /** Custom idle message (default: "Waiting for round...") */
  idleMessage?: string;
}

// ============================================================================
// Pure Functions
// ============================================================================

/**
 * Calculate round timing from store data.
 * 
 * This is a pure function - no side effects, deterministic output.
 * 
 * @example
 * ```typescript
 * const timing = getRoundTiming({
 *   currentSlot: store.getCurrentSlot(),
 *   currentRound: store.getCurrentRound(),
 *   nextRound: store.getNextRound(),
 * });
 * 
 * if (timing.inRound) {
 *   console.log(`Round ends in ${timing.countdown}`);
 * } else if (timing.nextRoundKnown) {
 *   console.log(`Next round in ${timing.countdown}`);
 * } else {
 *   console.log(timing.countdown); // "Next round starting soon..."
 * }
 * ```
 */
export function getRoundTiming(
  data: {
    currentSlot: number | null;
    currentRound: RoundData | null;
    nextRound: NextRoundInfo | null;
  },
  options: RoundTimingOptions = {}
): RoundTiming {
  const {
    slotDurationMs = DEFAULT_SLOT_DURATION_MS,
    breatherDurationMs = DEFAULT_BREATHER_DURATION_MS,
    soonMessage = 'Next round starting soon...',
    idleMessage = 'Waiting for round...',
  } = options;

  const { currentSlot, currentRound, nextRound } = data;

  // No data yet - idle state
  if (currentSlot === null || currentRound === null) {
    return {
      inRound: false,
      inBreather: false,
      roundEndsInMs: null,
      nextRoundStartsInMs: null,
      nextRoundKnown: false,
      progress: null,
      breatherProgress: null,
      currentSlot: null,
      countdown: idleMessage,
      phaseLabel: 'IDLE',
    };
  }

  const { mining } = currentRound;
  const remainingSlots = mining.remainingSlots ?? 0;

  // In active round (has remaining slots)
  if (remainingSlots > 0) {
    const roundEndsInMs = remainingSlots * slotDurationMs;
    
    // Calculate progress (0 = just started, 1 = about to end)
    let progress: number | null = null;
    if (mining.startSlot !== null && mining.endSlot !== null) {
      const totalSlots = mining.endSlot - mining.startSlot;
      const elapsed = currentSlot - mining.startSlot;
      progress = Math.min(1, Math.max(0, elapsed / totalSlots));
    }

    return {
      inRound: true,
      inBreather: false,
      roundEndsInMs,
      nextRoundStartsInMs: null,
      nextRoundKnown: false,
      progress,
      breatherProgress: null,
      currentSlot,
      countdown: formatDuration(roundEndsInMs),
      phaseLabel: 'BETTING',
    };
  }

  // In breather (no remaining slots)
  const nextRoundKnown = nextRound !== null;
  let nextRoundStartsInMs: number | null = null;

  if (nextRound && currentSlot) {
    const slotsUntilNext = nextRound.startSlot - currentSlot;
    if (slotsUntilNext > 0) {
      nextRoundStartsInMs = slotsUntilNext * slotDurationMs;
    }
  }

  const countdown = nextRoundKnown && nextRoundStartsInMs !== null
    ? formatDuration(nextRoundStartsInMs)
    : soonMessage;

  // Calculate breather progress (1→0 as we wait for next round)
  // Used for animations that move right→left during breather
  let breatherProgress: number | null = null;
  if (nextRoundStartsInMs !== null && nextRoundStartsInMs > 0) {
    breatherProgress = Math.min(1, nextRoundStartsInMs / breatherDurationMs);
  }

  return {
    inRound: false,
    inBreather: true,
    roundEndsInMs: null,
    nextRoundStartsInMs,
    nextRoundKnown,
    progress: null,
    breatherProgress,
    currentSlot,
    countdown,
    phaseLabel: 'BREATHER',
  };
}

/**
 * Format milliseconds as human-readable duration.
 * 
 * @example
 * formatDuration(5400) // "5s"
 * formatDuration(65000) // "1:05"
 * formatDuration(3661000) // "1:01:01"
 */
export function formatDuration(ms: number): string {
  if (ms < 0) return '0s';
  
  const totalSeconds = Math.ceil(ms / 1000);
  
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  
  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  }
  
  return `${minutes}:${pad(seconds)}`;
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

/**
 * Calculate slots remaining from current slot to target slot.
 */
export function slotsRemaining(currentSlot: number, targetSlot: number): number {
  return Math.max(0, targetSlot - currentSlot);
}

/**
 * Convert slots to milliseconds.
 */
export function slotsToMs(slots: number, slotDurationMs = DEFAULT_SLOT_DURATION_MS): number {
  return slots * slotDurationMs;
}

/**
 * Convert milliseconds to slots.
 */
export function msToSlots(ms: number, slotDurationMs = DEFAULT_SLOT_DURATION_MS): number {
  return Math.ceil(ms / slotDurationMs);
}

