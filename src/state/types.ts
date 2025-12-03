import type { GamePhase, PhaseMetadata } from '../types.js';

export interface RoundTotals {
  deployedSol: string;
  vaultedSol: string;
  winningsSol: string;
}

export interface RoundPerSquare {
  counts: string[];
  deployedSol: string[];
}

export interface RoundMiningWindow {
  startSlot: string;
  endSlot: string | null;
  remainingSlots: string | null;
  status?: string;
}

export interface RoundSnapshot {
  observedAt: string;
  roundId: string;
  mining: RoundMiningWindow;
  uniqueMiners: string | null;
  totals: RoundTotals;
  perSquare: RoundPerSquare;
}

export interface BidsSnapshot {
  roundId?: string | null;
  bids?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface RoundResultSnapshot {
  resultAvailable?: boolean;
  winningSquareIndex?: number | null;
  winningSquare?: number | null;
  roundId?: string | null;
  [key: string]: unknown;
}

export interface RoundFrameGlobals {
  treasury: Record<string, unknown> | null;
  currentSlot: string | null;
  orePrice: Record<string, unknown> | null;
  solPrice: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface RoundFrameVersions {
  live: number;
  bids: number;
  optimistic: number;
  final: number;
}

export interface RoundFrame {
  roundId: string;
  liveData: RoundSnapshot | null;
  liveSlot: number | null;
  bids: BidsSnapshot | null;
  optimisticWinner: RoundResultSnapshot | null;
  finalWinner: RoundResultSnapshot | null;
  versions: RoundFrameVersions;
  updatedAt: number;
}

export interface StateStoreSnapshot {
  frames: Map<string, RoundFrame>;
  order: string[];
  globals: RoundFrameGlobals;
  currentRoundId: string | null;
  latestFinalizedRoundId: string | null;
  phase: PhaseMetadata | null;
  /** Timestamp of last snapshot update (ms since epoch) */
  lastUpdatedAt: number | null;
  /** Age of data in milliseconds (null if never updated) */
  dataAgeMs: number | null;
  /** True if data is stale (>3s old or in idle mode) */
  isStale: boolean;
}

export interface SnapshotPointers {
  currentRoundId?: string | null;
  latestFinalizedRoundId?: string | null;
}

export interface RoundFrameMeta {
  slot?: number | string | null;
  observedAt?: number | string | null;
  appliedAt?: number | null;
  emitStartedAt?: number | null;
}

export interface RoundFrameUpdateEnvelope<T = unknown> {
  mode?: 'full' | 'diff';
  data?: T | null;
  globals?: RoundFrameGlobals;
  pointers?: SnapshotPointers;
  meta?: RoundFrameMeta;
}

export type RoundFrameSection = 'snapshot' | 'live' | 'bids' | 'optimistic' | 'final' | 'globals';

export interface RoundPhasePayload {
  phase?: GamePhase;
  phaseSince?: string | null;
  phaseUntil?: string | null;
  roundId?: string | null;
  [key: string]: unknown;
}

export interface RoundFrameEventPayload<T = unknown> {
  roundId: string | null;
  section: RoundFrameSection;
  version: number;
  payload: T;
  phase?: RoundPhasePayload;
}

export interface StateStoreOptions {
  historyLimit?: number;
  resultPhaseDurationMs?: number;
  winnerTiming?: {
    minSpinMs?: number;
    maxWaitMs?: number;
  };
}

