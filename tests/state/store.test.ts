import { EventEmitter } from 'events';
import { describe, expect, it, beforeEach, vi } from 'vitest';

import { StateStore } from '../../src/state/store';
import type { RoundFrameEventPayload } from '../../src/state/types';
import type { StateV3Response } from '../../src/types';

function createEmitter() {
  const emitter = new EventEmitter();
  vi.spyOn(emitter, 'emit');
  return emitter;
}

function buildSnapshot(overrides: Partial<StateV3Response> = {}): StateV3Response {
  return {
    data: {
      frames: [
        {
          roundId: 'round-a',
          liveData: {
            observedAt: new Date().toISOString(),
            roundId: 'round-a',
            mining: { startSlot: '1', endSlot: '2', remainingSlots: '0' },
            uniqueMiners: '5',
            totals: { deployedSol: '1', vaultedSol: '0', winningsSol: '0' },
            perSquare: { counts: ['0'], deployedSol: ['0'] },
          },
          bids: null,
          optimisticWinner: null,
          finalWinner: null,
          versions: { live: 1, bids: 0, optimistic: 0, final: 0 },
        },
      ],
      globals: { currentSlot: '1', treasury: null, orePrice: null, solPrice: null },
      currentRoundId: 'round-a',
      latestFinalizedRoundId: null,
      optimized: {
        roundId: 'round-a',
        phase: 'BETTING',
        phaseSince: new Date().toISOString(),
        phaseUntil: null,
      },
    },
    meta: { sections: ['round'], optimized: true, frames: 1 },
    ...overrides,
  };
}

describe('StateStore', () => {
  let emitter: EventEmitter;

  beforeEach(() => {
    emitter = createEmitter();
  });

  it('applies snapshot and emits snapshot event', () => {
    const store = new StateStore(emitter);
    const snapshot = buildSnapshot();

    store.applySnapshot(snapshot);

    const result = store.snapshot();
    expect(result.currentRoundId).toBe('round-a');
    expect(result.frames.size).toBe(1);
    expect(emitter.emit).toHaveBeenCalledWith('snapshot', expect.any(Object));
  });

  it('merges live section diffs and rejects stale slots', () => {
    const store = new StateStore(emitter);
    store.applySnapshot(buildSnapshot());

    const payload: RoundFrameEventPayload = {
      roundId: 'round-a',
      section: 'live',
      version: 2,
      payload: {
        mode: 'diff',
        data: {
          totals: { deployedSol: '2' },
        },
        meta: { slot: 5 },
      },
    };

    store.applyRoundFrame(payload);
    expect(store.getCurrentFrame()?.liveData?.totals.deployedSol).toBe('2');

    // Apply older slot -> should be ignored
    const stalePayload: RoundFrameEventPayload = {
      ...payload,
      version: 3,
      payload: {
        mode: 'diff',
        data: {
          totals: { deployedSol: '1' },
        },
        meta: { slot: 3 },
      },
    };
    store.applyRoundFrame(stalePayload);
    expect(store.getCurrentFrame()?.liveData?.totals.deployedSol).toBe('2');
  });

  it('emits winner events with result-phase guard', async () => {
    const store = new StateStore(emitter, {
      resultPhaseDurationMs: 10,
      winnerTiming: { minSpinMs: 0, maxWaitMs: 1000 },
    });
    store.applySnapshot(buildSnapshot());

    store.applyRoundFrame({
      roundId: 'round-a',
      section: 'optimistic',
      version: 2,
      payload: {
        mode: 'full',
        data: {
          resultAvailable: true,
          winningSquareIndex: 7,
        },
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(emitter.emit).toHaveBeenCalledWith(
      'winner',
      expect.objectContaining({ roundId: 'round-a', winner: 7 }),
    );

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(emitter.emit).toHaveBeenCalledWith('resultPhaseEnded');
  });
});

