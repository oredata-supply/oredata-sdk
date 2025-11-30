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
  private lastOptimisticWinner: number | null = null;
  private lastFinalWinner: number | null = null;
  private revealedRounds = new Set<string>();

  /**
   * Get the current frame from a snapshot
   */
  private getCurrentFrame(snapshot: StateStoreSnapshot): RoundFrame | null {
    if (!snapshot.currentRoundId) return null;
    return snapshot.frames.get(snapshot.currentRoundId) ?? null;
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
      // Reset winner tracking for new round
      this.lastOptimisticWinner = null;
      this.lastFinalWinner = null;
    }

    // Detect phase change
    if (this.lastPhase && currentPhase && currentPhase !== this.lastPhase) {
      changes.phaseChanged = true;
      changes.previousPhase = this.lastPhase;
    }

    // Detect winner (optimistic)
    const currentFrame = this.getCurrentFrame(snapshot);
    if (currentFrame && currentRoundId) {
      const optimisticWinner = currentFrame.optimisticWinner;
      if (
        optimisticWinner?.resultAvailable &&
        optimisticWinner.winningSquareIndex !== undefined &&
        optimisticWinner.winningSquareIndex !== null &&
        this.lastOptimisticWinner === null &&
        !this.revealedRounds.has(`${currentRoundId}:optimistic`)
      ) {
        changes.winnerDetected = true;
        changes.winner = {
          roundId: currentRoundId,
          tile: optimisticWinner.winningSquareIndex,
          type: 'optimistic',
          timestamp: Date.now(),
        };
        this.lastOptimisticWinner = optimisticWinner.winningSquareIndex;
        this.revealedRounds.add(`${currentRoundId}:optimistic`);
      }

      // Detect final winner
      const finalWinner = currentFrame.finalWinner;
      if (
        finalWinner?.resultAvailable &&
        finalWinner.winningSquareIndex !== undefined &&
        finalWinner.winningSquareIndex !== null &&
        this.lastFinalWinner === null &&
        !this.revealedRounds.has(`${currentRoundId}:final`)
      ) {
        const mismatch =
          this.lastOptimisticWinner !== null &&
          this.lastOptimisticWinner !== finalWinner.winningSquareIndex;

        changes.winnerDetected = true;
        changes.winner = {
          roundId: currentRoundId,
          tile: finalWinner.winningSquareIndex,
          type: 'final',
          timestamp: Date.now(),
          mismatch,
          optimisticTile: mismatch ? this.lastOptimisticWinner ?? undefined : undefined,
        };
        this.lastFinalWinner = finalWinner.winningSquareIndex;
        this.revealedRounds.add(`${currentRoundId}:final`);
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
    this.lastOptimisticWinner = null;
    this.lastFinalWinner = null;
    this.revealedRounds.clear();
  }
}

