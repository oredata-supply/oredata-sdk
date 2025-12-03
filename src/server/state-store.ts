import type { GamePhase } from '../types.js';
import type { StateStoreSnapshot, RoundFrame } from '../state/types.js';
import type { WinnerEvent } from './types.js';

export interface StateChanges {
  phaseChanged: boolean;
  previousPhase: GamePhase | null;
  winnerDetected: boolean;
  winner: WinnerEvent | null;
  roundChanged: boolean;
  previousRoundId: string | null;
}

/**
 * Server-side state store for tracking changes between polls
 */
export class ServerStateStore {
  private currentSnapshot: StateStoreSnapshot | null = null;
  private lastPhase: GamePhase | null = null;
  private lastRoundId: string | null = null;
  private revealedRounds = new Set<string>();

  /**
   * Check a frame for winner data and return WinnerEvent if found (and not already revealed)
   */
  private checkFrameForWinner(frame: RoundFrame, roundId: string): WinnerEvent | null {
    // Check for optimistic winner first
    const optimisticWinner = frame.optimisticWinner;
    if (
      optimisticWinner?.resultAvailable &&
      optimisticWinner.winningSquareIndex !== undefined &&
      optimisticWinner.winningSquareIndex !== null &&
      !this.revealedRounds.has(`${roundId}:optimistic`)
    ) {
      this.revealedRounds.add(`${roundId}:optimistic`);
      return {
        roundId,
        tile: optimisticWinner.winningSquareIndex,
        type: 'optimistic',
        timestamp: Date.now(),
      };
    }

    // Check for final winner
    const finalWinner = frame.finalWinner;
    if (
      finalWinner?.resultAvailable &&
      finalWinner.winningSquareIndex !== undefined &&
      finalWinner.winningSquareIndex !== null &&
      !this.revealedRounds.has(`${roundId}:final`)
    ) {
      // Check for mismatch with optimistic
      const optimisticKey = `${roundId}:optimistic`;
      const hadOptimistic = this.revealedRounds.has(optimisticKey);
      
      // We can't know the exact optimistic value after the fact, 
      // but we can detect if final differs by checking if optimistic was revealed
      // For full mismatch detection, we'd need to store the optimistic value
      
      this.revealedRounds.add(`${roundId}:final`);
      return {
        roundId,
        tile: finalWinner.winningSquareIndex,
        type: 'final',
        timestamp: Date.now(),
      };
    }

    return null;
  }

  /**
   * Update the store with new snapshot and detect changes
   */
  update(snapshot: StateStoreSnapshot): StateChanges {
    const changes: StateChanges = {
      phaseChanged: false,
      previousPhase: null,
      winnerDetected: false,
      winner: null,
      roundChanged: false,
      previousRoundId: null,
    };

    const currentRoundId = snapshot.currentRoundId ?? '';
    const currentPhase = snapshot.phase?.phase ?? null;

    // Detect round change
    if (this.lastRoundId && currentRoundId !== this.lastRoundId) {
      changes.roundChanged = true;
      changes.previousRoundId = this.lastRoundId;
    }

    // Detect phase change
    if (this.lastPhase && currentPhase && currentPhase !== this.lastPhase) {
      changes.phaseChanged = true;
      changes.previousPhase = this.lastPhase;
    }

    // FIX: Check ALL frames for winner data, not just current frame
    // This ensures we detect winners from previous rounds that may have
    // arrived after the round changed (e.g., round 74169's winner arriving
    // after currentRoundId changed to 74170)
    for (const [roundId, frame] of snapshot.frames) {
      const winner = this.checkFrameForWinner(frame, roundId);
      if (winner) {
        // Only report one winner per update (prefer most recent / highest roundId)
        if (!changes.winner || roundId > changes.winner.roundId) {
          changes.winnerDetected = true;
          changes.winner = winner;
        }
      }
    }

    // Update tracking
    this.lastPhase = currentPhase;
    this.lastRoundId = currentRoundId || null;
    this.currentSnapshot = snapshot;

    // Cleanup old revealed rounds (keep last 100)
    if (this.revealedRounds.size > 200) {
      const entries = Array.from(this.revealedRounds);
      entries.slice(0, 100).forEach((e) => this.revealedRounds.delete(e));
    }

    return changes;
  }

  /**
   * Get the latest snapshot
   */
  getLatest(): StateStoreSnapshot | null {
    return this.currentSnapshot;
  }

  /**
   * Get current round ID
   */
  getCurrentRoundId(): string | null {
    return this.lastRoundId;
  }

  /**
   * Get current phase
   */
  getCurrentPhase(): GamePhase | null {
    return this.lastPhase;
  }

  /**
   * Reset the store
   */
  reset(): void {
    this.currentSnapshot = null;
    this.lastPhase = null;
    this.lastRoundId = null;
    this.revealedRounds.clear();
  }
}

