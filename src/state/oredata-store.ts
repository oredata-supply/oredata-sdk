/**
 * OredataStore - Layer 1: Pure On-Chain Data
 *
 * This class provides instant, unfiltered access to round data.
 * Events fire immediately when data arrives - no timing delays.
 *
 * For UI timing (spin animations, result display), use OredataState (Layer 2).
 *
 * @see RFC-SDK-LAYER-SEPARATION.md
 */

import { EventEmitter } from 'eventemitter3';
import type { StateV3Response } from '../types.js';
import type { RoundFrame, RoundResultSnapshot, RoundSnapshot } from './types.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Mining status derived from on-chain data
 */
export type MiningStatus = 'ACTIVE' | 'EXPIRED' | 'UNKNOWN';

/**
 * Winner data source
 */
export type WinnerSource = 'optimistic' | 'final';

/**
 * Next round info (for breather countdown)
 */
export interface NextRoundInfo {
  roundId: string;
  startSlot: number;
}

/**
 * Complete round data
 */
export interface RoundData {
  roundId: string;

  // Mining state (from chain)
  mining: {
    status: MiningStatus;
    startSlot: number | null;
    endSlot: number | null;
    remainingSlots: number | null;
  };

  // Bid totals
  totals: {
    deployedSol: number;
    uniqueMiners: number;
  };

  // Per-square data
  perSquare: {
    counts: number[];
    deployedSol: number[];
  };

  // Winner data (null until available)
  winner: WinnerData | null;

  // Timestamps
  firstSeenAt: number;
  lastUpdatedAt: number;
  completedAt: number | null;

  // Raw frame reference (for advanced use)
  _frame: RoundFrame | null;
}

/**
 * Winner data with timing diagnostics
 */
export interface WinnerData {
  roundId: string;
  tile: number; // 0-24
  source: WinnerSource;
  confirmedAt: number;

  // Timing diagnostics (from orelette.fun feedback)
  arrivalMs: number; // ms since round ended when data arrived
  wasLate: boolean; // true if arrivalMs > maxWaitMs

  // Additional details
  motherlodeHit: boolean;
  motherlodeRaw: string | null;
  motherlodeFormatted: string | null;
  totalPot: string;
  winnerCount: number;
}

/**
 * Payload for roundCompleted event
 */
export interface RoundCompletedPayload {
  roundId: string;
  winner: WinnerData; // ← NOT optional, guaranteed to exist
  wasLate: boolean;
  arrivalMs: number;
  /** True if this round completed before we connected (cold load replay) */
  isHistorical: boolean;
}

/**
 * Payload for roundStarted event
 */
export interface RoundStartedPayload {
  roundId: string;
  previousRoundId: string | null;
  /** True if this round existed before we connected (cold load) */
  isHistorical: boolean;
}

/**
 * Payload for roundDataUpdated event
 */
export interface RoundDataUpdatedPayload {
  roundId: string;
  data: RoundData;
  changes: Array<'mining' | 'totals' | 'winner'>;
}

/**
 * Payload for miningStatusChanged event
 */
export interface MiningStatusChangedPayload {
  roundId: string;
  status: MiningStatus;
  previousStatus: MiningStatus;
}

/**
 * OredataStore configuration
 */
export interface OredataStoreOptions {
  /** Number of rounds to keep in history (default: 100) */
  historyLimit?: number;
  /** Max wait time for winner - used to calculate wasLate (default: 25000) */
  maxWaitMs?: number;
}

/**
 * OredataStore events
 */
export interface OredataStoreEvents {
  /** Fires on ANY data update for a round */
  roundDataUpdated: (payload: RoundDataUpdatedPayload) => void;

  /**
   * Fires ONCE when winner becomes available (optimistic or final).
   * ALWAYS fires - never skipped, no delays.
   * NOTE: Only fires when winner data IS available.
   */
  roundCompleted: (payload: RoundCompletedPayload) => void;

  /** Fires when a new round ID is first seen */
  roundStarted: (payload: RoundStartedPayload) => void;

  /** Fires when mining status changes */
  miningStatusChanged: (payload: MiningStatusChangedPayload) => void;

  /** Standard error event */
  error: (error: Error) => void;
}

// ============================================================================
// Helpers
// ============================================================================

function deriveMiningStatus(remainingSlots: number | null): MiningStatus {
  if (remainingSlots === null) return 'UNKNOWN';
  return remainingSlots > 0 ? 'ACTIVE' : 'EXPIRED';
}

function parseNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function parseNumberArray(arr: unknown): number[] {
  if (!Array.isArray(arr)) return [];
  return arr.map(parseNumber);
}

// ============================================================================
// OredataStore Class
// ============================================================================

export class OredataStore extends EventEmitter<OredataStoreEvents> {
  private readonly historyLimit: number;
  private readonly maxWaitMs: number;

  // Round storage
  private rounds = new Map<string, RoundData>();
  private roundOrder: string[] = [];

  // Winner tracking
  private winners = new Map<string, WinnerData>();
  private emittedWinners = new Set<string>(); // roundId:source keys

  // Round timing (for wasLate calculation)
  private roundEndTimes = new Map<string, number>();

  // Current state
  private currentRoundId: string | null = null;
  private latestFinalizedRoundId: string | null = null;
  private nextRound: NextRoundInfo | null = null;
  private currentSlot: number | null = null;
  private slotDurationMs: number = 400; // Default, updated from API

  // Connection tracking (for isHistorical calculation)
  private startedAt: number | null = null;

  constructor(options: OredataStoreOptions = {}) {
    super();
    this.historyLimit = options.historyLimit ?? 100;
    this.maxWaitMs = options.maxWaitMs ?? 25_000;
  }

  /**
   * Check if the SDK was connected when a round was first seen.
   * Returns true if the round data existed before we connected (cold load).
   */
  private isRoundHistorical(roundData: RoundData): boolean {
    if (!this.startedAt) return false;
    return roundData.firstSeenAt < this.startedAt;
  }

  // ==========================================================================
  // Public API - Read Methods
  // ==========================================================================

  /**
   * Get data for a specific round
   */
  getRound(roundId: string): RoundData | null {
    return this.rounds.get(roundId) ?? null;
  }

  /**
   * Get recent rounds (most recent first)
   */
  getRounds(opts?: { limit?: number }): RoundData[] {
    const limit = opts?.limit ?? this.historyLimit;
    const result: RoundData[] = [];

    // Iterate in reverse order (most recent first)
    for (let i = this.roundOrder.length - 1; i >= 0 && result.length < limit; i--) {
      const roundId = this.roundOrder[i];
      const round = this.rounds.get(roundId);
      if (round) {
        result.push(round);
      }
    }

    return result;
  }

  /**
   * Get current active round
   */
  getCurrentRound(): RoundData | null {
    if (!this.currentRoundId) return null;
    return this.rounds.get(this.currentRoundId) ?? null;
  }

  /**
   * Get last completed round (from orelette.fun feedback)
   */
  getPreviousRound(): RoundData | null {
    // Find the most recent completed round
    for (let i = this.roundOrder.length - 1; i >= 0; i--) {
      const roundId = this.roundOrder[i];
      const round = this.rounds.get(roundId);
      if (round?.winner && roundId !== this.currentRoundId) {
        return round;
      }
    }
    return null;
  }

  /**
   * Get winner for a specific round
   */
  getWinner(roundId: string): WinnerData | null {
    return this.winners.get(roundId) ?? null;
  }

  /**
   * Get winner history (most recent first)
   */
  getWinnerHistory(limit?: number): WinnerData[] {
    const maxResults = limit ?? this.historyLimit;
    const result: WinnerData[] = [];

    // Iterate in reverse order (most recent first)
    for (let i = this.roundOrder.length - 1; i >= 0 && result.length < maxResults; i--) {
      const roundId = this.roundOrder[i];
      const winner = this.winners.get(roundId);
      if (winner) {
        result.push(winner);
      }
    }

    return result;
  }

  /**
   * Check if we have winner data for a round
   */
  hasWinner(roundId: string): boolean {
    return this.winners.has(roundId);
  }

  /**
   * Get current round ID
   */
  getCurrentRoundId(): string | null {
    return this.currentRoundId;
  }

  /**
   * Get latest finalized round ID
   */
  getLatestFinalizedRoundId(): string | null {
    return this.latestFinalizedRoundId;
  }

  /**
   * Get next round info (for breather countdown).
   * Returns null if no next round is detected yet.
   */
  getNextRound(): NextRoundInfo | null {
    return this.nextRound;
  }

  /**
   * Get current Solana slot
   */
  getCurrentSlot(): number | null {
    return this.currentSlot;
  }

  /**
   * Get actual network slot duration in milliseconds.
   * Updated from Solana performance stats, defaults to 400ms.
   */
  getSlotDurationMs(): number {
    return this.slotDurationMs;
  }

  // ==========================================================================
  // Internal - Apply API Response
  // ==========================================================================

  /**
   * Apply API response (called by StateClient on poll)
   */
  applyApiResponse(response: StateV3Response): void {
    const data = response.data;
    if (!data) return;

    const now = Date.now();

    // Track whether this is the first API response (for isHistorical calculation)
    // Rounds seen in the first response are considered "historical" (cold load)
    const isFirstResponse = !this.startedAt;
    if (isFirstResponse) {
      this.startedAt = now;
    }

    const newCurrentRoundId = data.currentRoundId ?? null;
    const newFinalizedRoundId = data.latestFinalizedRoundId ?? null;

    // Extract optimized data for timing info
    const optimized = data.optimized as Record<string, unknown> | undefined;
    
    // Update currentSlot from optimized payload
    if (optimized?.currentSlot) {
      this.currentSlot = parseNumber(optimized.currentSlot);
    }

    // Update slotDurationMs from optimized payload (actual network average)
    if (typeof optimized?.slotDurationMs === 'number' && optimized.slotDurationMs > 0) {
      this.slotDurationMs = optimized.slotDurationMs;
    }

    // Update nextRound from optimized payload
    const nextRoundData = optimized?.nextRound as { roundId?: string; startSlot?: string } | undefined;
    if (nextRoundData?.roundId && nextRoundData?.startSlot) {
      this.nextRound = {
        roundId: nextRoundData.roundId,
        startSlot: parseNumber(nextRoundData.startSlot),
      };
    } else {
      this.nextRound = null;
    }

    // Detect new round
    if (newCurrentRoundId && newCurrentRoundId !== this.currentRoundId) {
      const previousRoundId = this.currentRoundId;
      this.currentRoundId = newCurrentRoundId;

      // Record round start time
      if (!this.roundEndTimes.has(newCurrentRoundId)) {
        // New round starting - previous round just ended
        if (previousRoundId && !this.roundEndTimes.has(previousRoundId)) {
          this.roundEndTimes.set(previousRoundId, now);
        }
      }

      this.emit('roundStarted', {
        roundId: newCurrentRoundId,
        previousRoundId,
        isHistorical: isFirstResponse,
      });
    }

    this.latestFinalizedRoundId = newFinalizedRoundId;

    // Process all frames
    const frames = data.frames ?? [];
    for (const frame of frames) {
      this.processFrame(frame as RoundFrame, now, isFirstResponse);
    }

    // Also process currentFrame if present (for optimized responses)
    const currentFrame = (data as Record<string, unknown>).currentFrame;
    if (currentFrame) {
      this.processFrame(currentFrame as RoundFrame, now, isFirstResponse);
    }

    // Check for finalized winner
    if (newFinalizedRoundId) {
      this.checkForWinner(newFinalizedRoundId, now, isFirstResponse);
    }

    // Prune old rounds
    this.pruneHistory();
  }

  private processFrame(frame: RoundFrame, now: number, isFirstResponse = false): void {
    const roundId = frame.roundId;
    if (!roundId) return;

    const existingRound = this.rounds.get(roundId);
    const changes: Array<'mining' | 'totals' | 'winner'> = [];

    // Parse mining status from remainingSlots
    const liveData = frame.liveData;
    const remainingSlots = liveData?.mining?.remainingSlots
      ? parseNumber(liveData.mining.remainingSlots)
      : null;
    const newMiningStatus = deriveMiningStatus(remainingSlots);
    const previousMiningStatus = existingRound?.mining.status ?? 'UNKNOWN';

    // Detect mining status change
    if (existingRound && newMiningStatus !== previousMiningStatus && newMiningStatus !== 'UNKNOWN') {
      this.emit('miningStatusChanged', {
        roundId,
        status: newMiningStatus,
        previousStatus: previousMiningStatus,
      });

      // Record round end time when status changes to EXPIRED
      if (newMiningStatus === 'EXPIRED' && !this.roundEndTimes.has(roundId)) {
        this.roundEndTimes.set(roundId, now);
      }
    }

    // Build round data
    const roundData: RoundData = {
      roundId,
      mining: {
        status: newMiningStatus,
        startSlot: liveData?.mining?.startSlot ? parseNumber(liveData.mining.startSlot) : null,
        endSlot: liveData?.mining?.endSlot ? parseNumber(liveData.mining.endSlot) : null,
        remainingSlots,
      },
      totals: {
        deployedSol: parseNumber(liveData?.totals?.deployedSol),
        uniqueMiners: parseNumber(liveData?.uniqueMiners),
      },
      perSquare: {
        counts: parseNumberArray(liveData?.perSquare?.counts),
        deployedSol: parseNumberArray(liveData?.perSquare?.deployedSol),
      },
      winner: existingRound?.winner ?? null, // Preserve existing winner
      firstSeenAt: existingRound?.firstSeenAt ?? now,
      lastUpdatedAt: now,
      completedAt: existingRound?.completedAt ?? null,
      _frame: frame,
    };

    // Check for changes
    if (existingRound) {
      if (existingRound.mining.status !== roundData.mining.status) {
        changes.push('mining');
      }
      if (existingRound.totals.deployedSol !== roundData.totals.deployedSol) {
        changes.push('totals');
      }
    } else {
      changes.push('mining', 'totals');
    }

    // Check for winner
    const winnerData = this.extractWinner(frame, roundId, now);
    if (winnerData) {
      roundData.winner = winnerData;
      roundData.completedAt = winnerData.confirmedAt;
      changes.push('winner');

      // FIX: Emit roundCompleted immediately when winner is found (with deduplication)
      // Previously this was only called via checkForWinner() for latestFinalizedRoundId,
      // causing roundCompleted to never fire for most rounds.
      const key = `${roundId}:${winnerData.source}`;
      if (!this.emittedWinners.has(key)) {
        this.winners.set(roundId, winnerData);
        this.emittedWinners.add(key);
        this.emit('roundCompleted', {
          roundId,
          winner: winnerData,
          wasLate: winnerData.wasLate,
          arrivalMs: winnerData.arrivalMs,
          isHistorical: isFirstResponse,
        });
      }
    }

    // Store round
    if (!existingRound) {
      this.roundOrder.push(roundId);
    }
    this.rounds.set(roundId, roundData);

    // Emit update
    if (changes.length > 0) {
      this.emit('roundDataUpdated', {
        roundId,
        data: roundData,
        changes,
      });
    }
  }

  private extractWinner(frame: RoundFrame, roundId: string, now: number): WinnerData | null {
    // Check final winner first (more authoritative)
    if (frame.finalWinner?.resultAvailable) {
      return this.buildWinnerData(frame.finalWinner, roundId, 'final', now);
    }

    // Fall back to optimistic
    if (frame.optimisticWinner?.resultAvailable) {
      return this.buildWinnerData(frame.optimisticWinner, roundId, 'optimistic', now);
    }

    return null;
  }

  private buildWinnerData(
    result: RoundResultSnapshot,
    roundId: string,
    source: WinnerSource,
    now: number,
  ): WinnerData | null {
    const tile =
      result.winningSquareIndex ?? (result.winningSquare != null ? Number(result.winningSquare) : null);

    if (tile === null) return null;

    // Calculate timing
    const roundEndTime = this.roundEndTimes.get(roundId) ?? now;
    const arrivalMs = now - roundEndTime;
    const wasLate = arrivalMs > this.maxWaitMs;

    const winnerData: WinnerData = {
      roundId,
      tile,
      source,
      confirmedAt: now,
      arrivalMs,
      wasLate,
      motherlodeHit: Boolean((result as Record<string, unknown>).motherlodeHit),
      motherlodeRaw: String((result as Record<string, unknown>).motherlodeRaw ?? '') || null,
      motherlodeFormatted: String((result as Record<string, unknown>).motherlodeFormatted ?? '') || null,
      totalPot: String((result as Record<string, unknown>).totalPot ?? '0'),
      winnerCount: parseNumber((result as Record<string, unknown>).winnerCount),
    };

    return winnerData;
  }

  private checkForWinner(roundId: string, now: number, isFirstResponse = false): void {
    const round = this.rounds.get(roundId);
    if (!round?._frame) return;

    const winnerData = this.extractWinner(round._frame, roundId, now);
    if (!winnerData) return;

    // Check if already emitted
    const key = `${roundId}:${winnerData.source}`;
    if (this.emittedWinners.has(key)) return;

    // Store winner
    this.winners.set(roundId, winnerData);

    // Update round data
    round.winner = winnerData;
    round.completedAt = winnerData.confirmedAt;
    this.rounds.set(roundId, round);

    // Mark as emitted
    this.emittedWinners.add(key);

    // Emit roundCompleted - IMMEDIATELY, no delays!
    this.emit('roundCompleted', {
      roundId,
      winner: winnerData,
      wasLate: winnerData.wasLate,
      arrivalMs: winnerData.arrivalMs,
      isHistorical: isFirstResponse,
    });
  }

  private pruneHistory(): void {
    while (this.roundOrder.length > this.historyLimit) {
      const oldestId = this.roundOrder.shift();
      if (oldestId) {
        this.rounds.delete(oldestId);
        this.winners.delete(oldestId);
        this.roundEndTimes.delete(oldestId);
        // Keep emittedWinners to prevent re-emission if round somehow reappears
      }
    }
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Clear all stored data
   */
  clear(): void {
    this.rounds.clear();
    this.roundOrder = [];
    this.winners.clear();
    this.emittedWinners.clear();
    this.roundEndTimes.clear();
    this.currentRoundId = null;
    this.latestFinalizedRoundId = null;
    this.nextRound = null;
    this.currentSlot = null;
    this.slotDurationMs = 400;
    this.startedAt = null; // Reset connection tracking for isHistorical
  }
}

