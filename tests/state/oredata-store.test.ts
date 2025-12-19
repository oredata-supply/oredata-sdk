import { describe, expect, it, beforeEach, vi } from 'vitest';
import { OredataStore } from '../../src/state/oredata-store';
import type { StateV3Response } from '../../src/types';

function buildSnapshot(overrides: Partial<StateV3Response> = {}): StateV3Response {
  return {
    data: {
      frames: [
        {
          roundId: 'round-123',
          liveData: {
            observedAt: new Date().toISOString(),
            roundId: 'round-123',
            mining: { startSlot: '1000', endSlot: '1100', remainingSlots: '50' },
            uniqueMiners: '10',
            totals: { deployedSol: '5.5', vaultedSol: '0', winningsSol: '0' },
            perSquare: { counts: Array(25).fill('0'), deployedSol: Array(25).fill('0') },
          },
          bids: null,
          optimisticWinner: null,
          finalWinner: null,
          versions: { live: 1, bids: 0, optimistic: 0, final: 0 },
        },
      ],
      globals: { currentSlot: '1050', treasury: null, orePrice: null, solPrice: null },
      currentRoundId: 'round-123',
      latestFinalizedRoundId: null,
      optimized: {
        roundId: 'round-123',
        phase: 'BETTING',
        phaseSince: new Date().toISOString(),
        phaseUntil: null,
      },
    },
    meta: { sections: ['round'], optimized: true, frames: 1 },
    ...overrides,
  };
}

function buildSnapshotWithWinner(
  roundId: string,
  winningTile: number,
  overrides: Partial<StateV3Response> = {}
): StateV3Response {
  const base = buildSnapshot(overrides);
  return {
    ...base,
    data: {
      ...base.data,
      currentRoundId: roundId,
      latestFinalizedRoundId: roundId,
      frames: [
        {
          roundId,
          liveData: {
            observedAt: new Date().toISOString(),
            roundId,
            mining: { startSlot: '1000', endSlot: '1100', remainingSlots: '0' },
            uniqueMiners: '10',
            totals: { deployedSol: '5.5', vaultedSol: '0', winningsSol: '0' },
            perSquare: { counts: Array(25).fill('0'), deployedSol: Array(25).fill('0') },
          },
          bids: null,
          optimisticWinner: {
            resultAvailable: true,
            winningSquareIndex: winningTile,
            motherlode: false,
          },
          finalWinner: null,
          versions: { live: 1, bids: 0, optimistic: 1, final: 0 },
        },
      ],
    },
  };
}

describe('OredataStore', () => {
  let store: OredataStore;

  beforeEach(() => {
    store = new OredataStore();
  });

  describe('applyApiResponse', () => {
    it('stores round data from snapshot', () => {
      const snapshot = buildSnapshot();
      store.applyApiResponse(snapshot);

      expect(store.getCurrentRoundId()).toBe('round-123');
      const round = store.getRound('round-123');
      expect(round).not.toBeNull();
      expect(round?.mining.status).toBe('ACTIVE');
      expect(round?.totals.deployedSol).toBe(5.5);
    });

    it('emits roundStarted when new round is seen', () => {
      const handler = vi.fn();
      store.on('roundStarted', handler);

      store.applyApiResponse(buildSnapshot());

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          roundId: 'round-123',
          previousRoundId: null,
        })
      );
    });

    it('emits roundStarted with previousRoundId when switching rounds', () => {
      const handler = vi.fn();

      // First round
      store.applyApiResponse(buildSnapshot());
      store.on('roundStarted', handler);

      // Second round
      const snapshot2 = buildSnapshot();
      snapshot2.data.currentRoundId = 'round-456';
      snapshot2.data.frames[0].roundId = 'round-456';
      snapshot2.data.frames[0].liveData!.roundId = 'round-456';
      store.applyApiResponse(snapshot2);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          roundId: 'round-456',
          previousRoundId: 'round-123',
        })
      );
    });
  });

  describe('roundCompleted event', () => {
    it('emits roundCompleted when winner data becomes available', () => {
      const handler = vi.fn();
      store.on('roundCompleted', handler);

      store.applyApiResponse(buildSnapshotWithWinner('round-123', 7));

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          roundId: 'round-123',
          winner: expect.objectContaining({
            tile: 7,
            source: 'optimistic',
          }),
        })
      );
    });

    it('sets wasLate:false when winner arrives within maxWaitMs', () => {
      const handler = vi.fn();
      store.on('roundCompleted', handler);

      store.applyApiResponse(buildSnapshotWithWinner('round-123', 7));

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          wasLate: false,
          arrivalMs: expect.any(Number),
        })
      );
    });

    it('does not emit duplicate roundCompleted for same round', () => {
      const handler = vi.fn();
      store.on('roundCompleted', handler);

      const snapshot = buildSnapshotWithWinner('round-123', 7);
      store.applyApiResponse(snapshot);
      store.applyApiResponse(snapshot); // Apply again

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('miningStatusChanged event', () => {
    it('emits miningStatusChanged when mining expires', () => {
      const handler = vi.fn();

      // First: active mining
      store.applyApiResponse(buildSnapshot());
      store.on('miningStatusChanged', handler);

      // Then: expired mining
      const expiredSnapshot = buildSnapshot();
      expiredSnapshot.data.frames[0].liveData!.mining.remainingSlots = '0';
      store.applyApiResponse(expiredSnapshot);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          roundId: 'round-123',
          status: 'EXPIRED',
          previousStatus: 'ACTIVE',
        })
      );
    });
  });

  describe('getRound / getCurrentRound / getPreviousRound', () => {
    it('returns null for unknown round', () => {
      expect(store.getRound('unknown')).toBeNull();
    });

    it('returns current round', () => {
      store.applyApiResponse(buildSnapshot());
      const round = store.getCurrentRound();
      expect(round?.roundId).toBe('round-123');
    });

    it('returns previous round after round transition', () => {
      // First round with winner
      store.applyApiResponse(buildSnapshotWithWinner('round-1', 5));

      // Second round
      const snapshot2 = buildSnapshot();
      snapshot2.data.currentRoundId = 'round-2';
      snapshot2.data.frames[0].roundId = 'round-2';
      snapshot2.data.frames[0].liveData!.roundId = 'round-2';
      snapshot2.data.latestFinalizedRoundId = 'round-1';
      store.applyApiResponse(snapshot2);

      const previous = store.getPreviousRound();
      expect(previous?.roundId).toBe('round-1');
      expect(previous?.winner?.tile).toBe(5);
    });
  });

  describe('getWinner / hasWinner / getWinnerHistory', () => {
    it('returns null for round without winner', () => {
      store.applyApiResponse(buildSnapshot());
      expect(store.getWinner('round-123')).toBeNull();
      expect(store.hasWinner('round-123')).toBe(false);
    });

    it('returns winner data for completed round', () => {
      store.applyApiResponse(buildSnapshotWithWinner('round-123', 12));

      const winner = store.getWinner('round-123');
      expect(winner).not.toBeNull();
      expect(winner?.tile).toBe(12);
      expect(store.hasWinner('round-123')).toBe(true);
    });

    it('builds winner history across multiple rounds', () => {
      // Round 1
      store.applyApiResponse(buildSnapshotWithWinner('round-1', 5));

      // Round 2
      const snapshot2 = buildSnapshotWithWinner('round-2', 10);
      snapshot2.data.latestFinalizedRoundId = 'round-2';
      store.applyApiResponse(snapshot2);

      // Round 3
      const snapshot3 = buildSnapshotWithWinner('round-3', 15);
      snapshot3.data.latestFinalizedRoundId = 'round-3';
      store.applyApiResponse(snapshot3);

      const history = store.getWinnerHistory(10);
      expect(history.length).toBe(3);
      // Most recent first
      expect(history[0].roundId).toBe('round-3');
      expect(history[0].tile).toBe(15);
      expect(history[1].roundId).toBe('round-2');
      expect(history[2].roundId).toBe('round-1');
    });

    it('respects limit in getWinnerHistory', () => {
      // Create 5 rounds with winners
      for (let i = 1; i <= 5; i++) {
        const snapshot = buildSnapshotWithWinner(`round-${i}`, i);
        snapshot.data.latestFinalizedRoundId = `round-${i}`;
        store.applyApiResponse(snapshot);
      }

      const history = store.getWinnerHistory(3);
      expect(history.length).toBe(3);
    });
  });

  describe('getRounds', () => {
    it('returns recent rounds', () => {
      store.applyApiResponse(buildSnapshot());

      const rounds = store.getRounds();
      expect(rounds.length).toBe(1);
      expect(rounds[0].roundId).toBe('round-123');
    });

    it('respects limit option', () => {
      // Create multiple rounds
      for (let i = 1; i <= 10; i++) {
        const snapshot = buildSnapshot();
        snapshot.data.currentRoundId = `round-${i}`;
        snapshot.data.frames[0].roundId = `round-${i}`;
        snapshot.data.frames[0].liveData!.roundId = `round-${i}`;
        store.applyApiResponse(snapshot);
      }

      const rounds = store.getRounds({ limit: 5 });
      expect(rounds.length).toBe(5);
    });
  });
});

