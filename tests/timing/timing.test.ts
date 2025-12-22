import { describe, it, expect } from 'vitest';
import {
  getRoundTiming,
  formatDuration,
  slotsRemaining,
  slotsToMs,
  msToSlots,
  DEFAULT_SLOT_DURATION_MS,
} from '../../src/timing/index.js';
import type { RoundData, NextRoundInfo } from '../../src/state/oredata-store.js';

describe('timing utilities', () => {
  describe('formatDuration', () => {
    it('formats seconds under a minute', () => {
      expect(formatDuration(5000)).toBe('5s');
      expect(formatDuration(45000)).toBe('45s');
      expect(formatDuration(500)).toBe('1s'); // rounds up
    });

    it('formats minutes and seconds', () => {
      expect(formatDuration(60000)).toBe('1:00');
      expect(formatDuration(65000)).toBe('1:05');
      expect(formatDuration(125000)).toBe('2:05');
    });

    it('formats hours', () => {
      expect(formatDuration(3600000)).toBe('1:00:00');
      expect(formatDuration(3661000)).toBe('1:01:01');
    });

    it('handles zero and negative', () => {
      expect(formatDuration(0)).toBe('0s');
      expect(formatDuration(-1000)).toBe('0s');
    });
  });

  describe('slot utilities', () => {
    it('calculates slots remaining', () => {
      expect(slotsRemaining(100, 150)).toBe(50);
      expect(slotsRemaining(150, 100)).toBe(0); // past target
    });

    it('converts slots to ms', () => {
      expect(slotsToMs(10)).toBe(4000); // 10 * 400ms
      expect(slotsToMs(10, 500)).toBe(5000); // custom duration
    });

    it('converts ms to slots', () => {
      expect(msToSlots(4000)).toBe(10); // 4000 / 400ms
      expect(msToSlots(4100)).toBe(11); // rounds up
    });

    it('has correct default slot duration', () => {
      expect(DEFAULT_SLOT_DURATION_MS).toBe(400);
    });
  });

  describe('getRoundTiming', () => {
    const createRoundData = (overrides: Partial<RoundData> = {}): RoundData => ({
      roundId: '1000',
      mining: {
        status: 'ACTIVE',
        startSlot: 1000,
        endSlot: 1150,
        remainingSlots: 50,
      },
      totals: { deployedSol: 100, uniqueMiners: 10 },
      perSquare: { counts: [], deployedSol: [] },
      winner: null,
      firstSeenAt: Date.now(),
      lastUpdatedAt: Date.now(),
      completedAt: null,
      _frame: null,
      ...overrides,
    });

    it('returns idle state when no data', () => {
      const timing = getRoundTiming({
        currentSlot: null,
        currentRound: null,
        nextRound: null,
      });

      expect(timing.inRound).toBe(false);
      expect(timing.inBreather).toBe(false);
      expect(timing.phaseLabel).toBe('IDLE');
      expect(timing.countdown).toBe('Waiting for round...');
    });

    it('returns round timing when in active round', () => {
      const timing = getRoundTiming({
        currentSlot: 1100,
        currentRound: createRoundData(),
        nextRound: null,
      });

      expect(timing.inRound).toBe(true);
      expect(timing.inBreather).toBe(false);
      expect(timing.phaseLabel).toBe('BETTING');
      expect(timing.roundEndsInMs).toBe(50 * 400); // 50 slots * 400ms
      expect(timing.countdown).toBe('20s');
      expect(timing.progress).toBeCloseTo(0.67, 1); // 100/150 slots elapsed
    });

    it('returns breather with unknown next round', () => {
      const timing = getRoundTiming({
        currentSlot: 1160,
        currentRound: createRoundData({
          mining: {
            status: 'EXPIRED',
            startSlot: 1000,
            endSlot: 1150,
            remainingSlots: 0,
          },
        }),
        nextRound: null,
      });

      expect(timing.inRound).toBe(false);
      expect(timing.inBreather).toBe(true);
      expect(timing.phaseLabel).toBe('BREATHER');
      expect(timing.nextRoundKnown).toBe(false);
      expect(timing.countdown).toBe('Next round starting soon...');
    });

    it('returns breather with known next round', () => {
      const nextRound: NextRoundInfo = {
        roundId: '1001',
        startSlot: 1170,
      };

      const timing = getRoundTiming({
        currentSlot: 1160,
        currentRound: createRoundData({
          mining: {
            status: 'EXPIRED',
            startSlot: 1000,
            endSlot: 1150,
            remainingSlots: 0,
          },
        }),
        nextRound,
      });

      expect(timing.inRound).toBe(false);
      expect(timing.inBreather).toBe(true);
      expect(timing.nextRoundKnown).toBe(true);
      expect(timing.nextRoundStartsInMs).toBe(10 * 400); // 10 slots * 400ms
      expect(timing.countdown).toBe('4s');
    });

    it('uses custom messages', () => {
      const timing = getRoundTiming(
        {
          currentSlot: 1160,
          currentRound: createRoundData({
            mining: { status: 'EXPIRED', startSlot: 1000, endSlot: 1150, remainingSlots: 0 },
          }),
          nextRound: null,
        },
        { soonMessage: 'Hang tight...' }
      );

      expect(timing.countdown).toBe('Hang tight...');
    });

    it('uses custom slot duration', () => {
      const timing = getRoundTiming(
        {
          currentSlot: 1100,
          currentRound: createRoundData(),
          nextRound: null,
        },
        { slotDurationMs: 500 }
      );

      expect(timing.roundEndsInMs).toBe(50 * 500); // 50 slots * 500ms
    });
  });
});

