/**
 * OredataState - Layer 2: UI Presentation Logic
 *
 * This class applies timing delays and phase protection for game UX.
 * It subscribes to OredataStore events and applies configurable timing.
 *
 * For immediate data access, use OredataStore (Layer 1).
 *
 * @see RFC-SDK-LAYER-SEPARATION.md
 */

import { EventEmitter } from 'eventemitter3';
import type {
  OredataStore,
  RoundCompletedPayload,
  RoundStartedPayload,
  WinnerData,
} from './oredata-store.js';

// ============================================================================
// Types
// ============================================================================

/**
 * How to handle late winners
 */
export type LateWinnerBehavior =
  | 'emit' // Always emit, no wasLate flag in UI event
  | 'skip' // Don't emit late winners
  | 'emit-late'; // Emit with wasLate: true (DEFAULT)

/**
 * UI display phase
 */
export type DisplayPhase = 'BETTING' | 'SPINNING' | 'RESULT' | 'IDLE';

/**
 * OredataState configuration
 */
export interface OredataStateConfig {
  /** Minimum time to show "spinning" animation (default: 4000) */
  spinDurationMs?: number;

  /** How long to show result overlay (default: 15000) */
  resultDisplayMs?: number;

  /** Maximum wait for winner data (default: 25000) */
  maxWaitMs?: number;

  /** How to handle late winners (default: 'emit-late') */
  lateWinnerBehavior?: LateWinnerBehavior;

  /** Whether to auto-hide result overlay (default: true) */
  autoHideResult?: boolean;

  /** Whether to show spinning phase at all (default: true) */
  showSpinPhase?: boolean;
}

/**
 * Winner display data for UI
 * Note: tile is 0-indexed (0-24). For display, add 1 in your UI layer.
 */
export interface WinnerDisplay {
  roundId: string;
  tile: number; // 0-indexed (0-24)
  revealedAt: number;
  wasLate: boolean;
  arrivalMs?: number; // ms since round ended when data arrived
}

/**
 * Payload for phaseChange event
 */
export interface PhaseChangePayload {
  phase: DisplayPhase;
  previousPhase: DisplayPhase;
  roundId: string | null;
}

/**
 * Payload for winnerReveal event
 * Note: winner is 0-indexed (0-24). For display, add 1 in your UI layer.
 */
export interface WinnerRevealPayload {
  roundId: string;
  winner: number; // 0-indexed (0-24)
  wasLate: boolean;
  arrivalMs: number; // ms since round ended when data arrived
}

/**
 * Payload for resultOverlayShow event
 * Note: winner is 0-indexed (0-24). For display, add 1 in your UI layer.
 */
export interface ResultOverlayShowPayload {
  roundId: string;
  winner: number; // 0-indexed (0-24)
}

/**
 * Payload for winnerTimeout event
 */
export interface WinnerTimeoutPayload {
  roundId: string;
  elapsed: number;
  reason: 'timeout' | 'round_changed';
}

/**
 * OredataState events
 */
export interface OredataStateEvents {
  /** Fires when display phase changes */
  phaseChange: (payload: PhaseChangePayload) => void;

  /** Fires when winner should be revealed (after spin) */
  winnerReveal: (payload: WinnerRevealPayload) => void;

  /** Fires when winner not received within maxWaitMs */
  winnerTimeout: (payload: WinnerTimeoutPayload) => void;

  /** Fires when result overlay should show */
  resultOverlayShow: (payload: ResultOverlayShowPayload) => void;

  /** Fires when result overlay should hide */
  resultOverlayHide: () => void;

  /** Standard error event */
  error: (error: Error) => void;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_SPIN_DURATION_MS = 4_000;
const DEFAULT_RESULT_DISPLAY_MS = 15_000;
const DEFAULT_MAX_WAIT_MS = 25_000;

// ============================================================================
// OredataState Class
// ============================================================================

export class OredataState extends EventEmitter<OredataStateEvents> {
  private readonly store: OredataStore;
  private readonly config: Required<OredataStateConfig>;

  // Current state
  private currentDisplayPhase: DisplayPhase = 'IDLE';
  private displayedWinner: WinnerDisplay | null = null;
  private resultOverlayVisible = false;
  private currentRoundId: string | null = null;

  // Timers
  private spinTimer: ReturnType<typeof setTimeout> | null = null;
  private resultDisplayTimer: ReturnType<typeof setTimeout> | null = null;
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;

  // Timing tracking
  private spinStartTime: number | null = null;
  private revealedRounds = new Set<string>();

  // Bound handlers for cleanup
  private handleRoundCompleted: (payload: RoundCompletedPayload) => void;
  private handleRoundStarted: (payload: RoundStartedPayload) => void;

  constructor(store: OredataStore, config: OredataStateConfig = {}) {
    super();
    this.store = store;
    this.config = {
      spinDurationMs: config.spinDurationMs ?? DEFAULT_SPIN_DURATION_MS,
      resultDisplayMs: config.resultDisplayMs ?? DEFAULT_RESULT_DISPLAY_MS,
      maxWaitMs: config.maxWaitMs ?? DEFAULT_MAX_WAIT_MS,
      lateWinnerBehavior: config.lateWinnerBehavior ?? 'emit-late',
      autoHideResult: config.autoHideResult ?? true,
      showSpinPhase: config.showSpinPhase ?? true,
    };

    // Bind handlers
    this.handleRoundCompleted = this.onRoundCompleted.bind(this);
    this.handleRoundStarted = this.onRoundStarted.bind(this);

    // Subscribe to store events
    this.store.on('roundCompleted', this.handleRoundCompleted);
    this.store.on('roundStarted', this.handleRoundStarted);
  }

  // ==========================================================================
  // Public API - Read Methods
  // ==========================================================================

  /**
   * Get current display phase
   */
  getDisplayPhase(): DisplayPhase {
    return this.currentDisplayPhase;
  }

  /**
   * Get currently displayed winner (null if not in RESULT phase)
   */
  getDisplayedWinner(): WinnerDisplay | null {
    return this.displayedWinner;
  }

  /**
   * Check if result overlay is visible
   */
  isResultOverlayVisible(): boolean {
    return this.resultOverlayVisible;
  }

  /**
   * Get time since round ended (for UI)
   */
  getTimeSinceRoundEnd(): number | null {
    if (!this.spinStartTime) return null;
    return Date.now() - this.spinStartTime;
  }

  /**
   * Get time until result phase ends (for UI)
   */
  getTimeUntilResultEnds(): number | null {
    if (!this.resultOverlayVisible || !this.displayedWinner) return null;
    const elapsed = Date.now() - this.displayedWinner.revealedAt;
    const remaining = this.config.resultDisplayMs - elapsed;
    return Math.max(0, remaining);
  }

  // ==========================================================================
  // Public API - Control Methods
  // ==========================================================================

  /**
   * Skip spin animation (jump to result)
   */
  skipToResult(): void {
    if (this.spinTimer) {
      clearTimeout(this.spinTimer);
      this.spinTimer = null;
      // Force reveal if we have pending winner
      // Note: This would require tracking pending winner
    }
  }

  /**
   * Hide result overlay manually
   */
  dismissResult(): void {
    if (this.resultDisplayTimer) {
      clearTimeout(this.resultDisplayTimer);
      this.resultDisplayTimer = null;
    }
    this.hideResultOverlay();
  }

  // ==========================================================================
  // Event Handlers
  // ==========================================================================

  private onRoundStarted(payload: RoundStartedPayload): void {
    const { roundId, previousRoundId } = payload;

    // Clear any pending timers from previous round
    this.clearTimers();

    // Update current round
    this.currentRoundId = roundId;

    // Start spin timing
    this.spinStartTime = Date.now();

    // Start timeout timer
    this.startTimeoutTimer(roundId);

    // If not in result phase, transition to BETTING
    if (this.currentDisplayPhase !== 'RESULT') {
      this.setDisplayPhase('BETTING', roundId);
    }

    // If previous round had a winner that wasn't revealed yet, try to reveal it
    if (previousRoundId && !this.revealedRounds.has(previousRoundId)) {
      const previousWinner = this.store.getWinner(previousRoundId);
      if (previousWinner) {
        // Late winner from previous round - emit with wasLate
        this.processWinner(previousWinner, true);
      }
    }
  }

  private onRoundCompleted(payload: RoundCompletedPayload): void {
    const { roundId, winner, wasLate, arrivalMs } = payload;

    // Cancel timeout timer
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }

    // Check late winner behavior
    if (wasLate) {
      if (this.config.lateWinnerBehavior === 'skip') {
        // Skip late winners entirely
        return;
      }
    }

    // Process the winner
    this.processWinner(winner, wasLate);
  }

  private processWinner(winner: WinnerData, wasLate: boolean): void {
    const { roundId, tile, arrivalMs } = winner;

    // Prevent duplicate reveals
    if (this.revealedRounds.has(roundId)) {
      return;
    }

    // Calculate spin delay
    let spinDelay = 0;
    if (this.config.showSpinPhase && !wasLate) {
      const elapsed = this.spinStartTime ? Date.now() - this.spinStartTime : 0;
      spinDelay = Math.max(0, this.config.spinDurationMs - elapsed);
    }

    // Transition to SPINNING if there's a delay
    if (spinDelay > 0 && this.currentDisplayPhase === 'BETTING') {
      this.setDisplayPhase('SPINNING', roundId);
    }

    // Schedule winner reveal
    if (spinDelay > 0) {
      this.spinTimer = setTimeout(() => {
        this.spinTimer = null;
        this.revealWinner(roundId, tile, wasLate, arrivalMs);
      }, spinDelay);
    } else {
      // Immediate reveal for late winners
      this.revealWinner(roundId, tile, wasLate, arrivalMs);
    }
  }

  private revealWinner(roundId: string, tile: number, wasLate: boolean, arrivalMs: number): void {
    // Mark as revealed
    this.revealedRounds.add(roundId);

    // Build winner display
    const now = Date.now();
    this.displayedWinner = {
      roundId,
      tile,
      revealedAt: now,
      wasLate,
      arrivalMs,
    };

    // Emit winnerReveal
    const revealPayload: WinnerRevealPayload = {
      roundId,
      winner: tile,
      wasLate: this.config.lateWinnerBehavior === 'emit-late' ? wasLate : false,
      arrivalMs,
    };
    this.emit('winnerReveal', revealPayload);

    // Show result overlay
    this.showResultOverlay(roundId, tile);

    // Transition to RESULT
    this.setDisplayPhase('RESULT', roundId);
  }

  private showResultOverlay(roundId: string, tile: number): void {
    this.resultOverlayVisible = true;

    this.emit('resultOverlayShow', {
      roundId,
      winner: tile,
    });

    // Auto-hide after duration
    if (this.config.autoHideResult) {
      this.resultDisplayTimer = setTimeout(() => {
        this.resultDisplayTimer = null;
        this.hideResultOverlay();
      }, this.config.resultDisplayMs);
    }
  }

  private hideResultOverlay(): void {
    if (!this.resultOverlayVisible) return;

    this.resultOverlayVisible = false;
    this.displayedWinner = null;
    this.emit('resultOverlayHide');

    // Transition to next phase
    const currentRound = this.store.getCurrentRound();
    if (currentRound?.mining.status === 'ACTIVE') {
      this.setDisplayPhase('BETTING', currentRound.roundId);
    } else {
      this.setDisplayPhase('IDLE', this.currentRoundId);
    }
  }

  private setDisplayPhase(phase: DisplayPhase, roundId: string | null): void {
    if (phase === this.currentDisplayPhase) return;

    const previousPhase = this.currentDisplayPhase;
    this.currentDisplayPhase = phase;

    this.emit('phaseChange', {
      phase,
      previousPhase,
      roundId,
    });
  }

  private startTimeoutTimer(roundId: string): void {
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
    }

    this.timeoutTimer = setTimeout(() => {
      this.timeoutTimer = null;

      // Check if we got a winner while waiting
      if (this.revealedRounds.has(roundId)) {
        return;
      }

      this.emit('winnerTimeout', {
        roundId,
        elapsed: this.config.maxWaitMs,
        reason: 'timeout',
      });
    }, this.config.maxWaitMs);
  }

  private clearTimers(): void {
    if (this.spinTimer) {
      clearTimeout(this.spinTimer);
      this.spinTimer = null;
    }
    if (this.resultDisplayTimer) {
      clearTimeout(this.resultDisplayTimer);
      this.resultDisplayTimer = null;
    }
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Start listening (called automatically by constructor)
   */
  start(): void {
    // Already subscribed in constructor
  }

  /**
   * Stop listening and clean up
   */
  stop(): void {
    this.clearTimers();
    this.store.off('roundCompleted', this.handleRoundCompleted);
    this.store.off('roundStarted', this.handleRoundStarted);
    this.removeAllListeners();
  }
}

