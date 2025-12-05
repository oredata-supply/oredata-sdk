import { describe, it, expect, beforeEach } from 'vitest';
import { ServerStateStore } from '../../src/server/state-store.js';
import type { StateStoreSnapshot, RoundFrame } from '../../src/state/types.js';

function createFrame(roundId: string, options: {
  optimisticWinner?: number | null;
  finalWinner?: number | null;
} = {}): RoundFrame {
  return {
    roundId,
    liveData: {
      roundId,
      mode: 'betting',
      deployedSol: '1.0',
      uniqueMiners: 10,
      perSquare: {
        counts: Array(25).fill(1),
        deployedSol: Array(25).fill('0.04'),
      },
      mining: {
        startSlot: '100',
        endSlot: '200',
        remainingSlots: '50',
      },
      tiles: [],
    },
    optimisticWinner: options.optimisticWinner !== undefined ? {
      resultAvailable: options.optimisticWinner !== null,
      winningSquareIndex: options.optimisticWinner ?? undefined,
    } : undefined,
    finalWinner: options.finalWinner !== undefined ? {
      resultAvailable: options.finalWinner !== null,
      winningSquareIndex: options.finalWinner ?? undefined,
    } : undefined,
  } as RoundFrame;
}

function createSnapshot(currentRoundId: string, frames: RoundFrame[]): StateStoreSnapshot {
  const framesMap = new Map<string, RoundFrame>();
  for (const frame of frames) {
    framesMap.set(frame.roundId, frame);
  }
  
  return {
    currentRoundId,
    frames: framesMap,
    phase: { phase: 'betting', remainingSlots: 50 },
  } as StateStoreSnapshot;
}

describe('ServerStateStore', () => {
  let store: ServerStateStore;

  beforeEach(() => {
    store = new ServerStateStore();
  });

  describe('winner detection', () => {
    it('detects winner in current frame', () => {
      const frame = createFrame('74169', { optimisticWinner: 7 });
      const snapshot = createSnapshot('74169', [frame]);

      const changes = store.update(snapshot);

      expect(changes.winnerDetected).toBe(true);
      expect(changes.winner).toEqual({
        roundId: '74169',
        tile: 7,
        type: 'optimistic',
        timestamp: expect.any(Number),
      });
    });

    it('detects winner in previous frame after round change', () => {
      // First update: round 74169 with no winner yet
      const frame1 = createFrame('74169', {});
      const snapshot1 = createSnapshot('74169', [frame1]);
      store.update(snapshot1);

      // Second update: round changed to 74170, but winner for 74169 is now available
      const frame2_current = createFrame('74170', {});
      const frame2_previous = createFrame('74169', { finalWinner: 18 });
      const snapshot2 = createSnapshot('74170', [frame2_previous, frame2_current]);

      const changes = store.update(snapshot2);

      // Should detect winner in the previous frame!
      expect(changes.winnerDetected).toBe(true);
      expect(changes.winner).toEqual({
        roundId: '74169',
        tile: 18,
        type: 'final',
        timestamp: expect.any(Number),
      });
      expect(changes.roundChanged).toBe(true);
      expect(changes.previousRoundId).toBe('74169');
    });

    it('does not emit duplicate winner for same round', () => {
      const frame = createFrame('74169', { optimisticWinner: 7 });
      const snapshot = createSnapshot('74169', [frame]);

      const changes1 = store.update(snapshot);
      expect(changes1.winnerDetected).toBe(true);

      // Same snapshot again
      const changes2 = store.update(snapshot);
      expect(changes2.winnerDetected).toBe(false);
      expect(changes2.winner).toBeNull();
    });

    it('emits both optimistic and final winner for same round', () => {
      // First: optimistic winner
      const frame1 = createFrame('74169', { optimisticWinner: 7 });
      const snapshot1 = createSnapshot('74169', [frame1]);
      
      const changes1 = store.update(snapshot1);
      expect(changes1.winnerDetected).toBe(true);
      expect(changes1.winner?.type).toBe('optimistic');
      expect(changes1.winner?.tile).toBe(7);

      // Second: final winner (same tile)
      const frame2 = createFrame('74169', { optimisticWinner: 7, finalWinner: 7 });
      const snapshot2 = createSnapshot('74169', [frame2]);

      const changes2 = store.update(snapshot2);
      expect(changes2.winnerDetected).toBe(true);
      expect(changes2.winner?.type).toBe('final');
      expect(changes2.winner?.tile).toBe(7);
    });

    it('prefers higher roundId when multiple winners available', () => {
      // Both rounds have winners
      const frame1 = createFrame('74168', { finalWinner: 5 });
      const frame2 = createFrame('74169', { finalWinner: 18 });
      const snapshot = createSnapshot('74169', [frame1, frame2]);

      const changes = store.update(snapshot);

      // Should prefer 74169 (higher roundId)
      expect(changes.winnerDetected).toBe(true);
      expect(changes.winner?.roundId).toBe('74169');
      expect(changes.winner?.tile).toBe(18);
    });
  });

  describe('round change detection', () => {
    it('detects round change', () => {
      const frame1 = createFrame('74169', {});
      const snapshot1 = createSnapshot('74169', [frame1]);
      store.update(snapshot1);

      const frame2 = createFrame('74170', {});
      const snapshot2 = createSnapshot('74170', [frame2]);
      const changes = store.update(snapshot2);

      expect(changes.roundChanged).toBe(true);
      expect(changes.previousRoundId).toBe('74169');
    });
  });

  describe('phase change detection', () => {
    it('detects phase change', () => {
      const frame1 = createFrame('74169', {});
      const snapshot1: StateStoreSnapshot = {
        ...createSnapshot('74169', [frame1]),
        phase: { phase: 'betting', remainingSlots: 50 },
      };
      store.update(snapshot1);

      const snapshot2: StateStoreSnapshot = {
        ...createSnapshot('74169', [frame1]),
        phase: { phase: 'spinning', remainingSlots: 0 },
      };
      const changes = store.update(snapshot2);

      expect(changes.phaseChanged).toBe(true);
      expect(changes.previousPhase).toBe('betting');
    });
  });
});

