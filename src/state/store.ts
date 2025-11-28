import type EventEmitter from 'eventemitter3';

import type {
  RoundFrame,
  RoundFrameEventPayload,
  RoundFrameGlobals,
  RoundFrameUpdateEnvelope,
  RoundPhasePayload,
  RoundResultSnapshot,
  RoundSnapshot,
  StateStoreOptions,
  StateStoreSnapshot,
} from './types.js';
import type { GamePhase, PhaseMetadata, StateV3Response } from '../types.js';

const DEFAULT_HISTORY_LIMIT = 10;
const DEFAULT_RESULT_DURATION_MS = 15_000;
const DEFAULT_WINNER_TIMING = {
  minSpinMs: 4_000,
  maxWaitMs: 25_000,
};
const WINNER_POLL_INTERVAL_MS = 100;

const DEFAULT_GLOBALS: RoundFrameGlobals = {
  treasury: null,
  currentSlot: null,
  orePrice: null,
  solPrice: null,
};

function asGamePhase(value: string | undefined): GamePhase {
  if (value === 'BETTING' || value === 'SPINNING' || value === 'RESULT' || value === 'IDLE') {
    return value;
  }
  return 'BETTING';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function parseEnvelope(payload: unknown): RoundFrameUpdateEnvelope {
  if (typeof payload === 'string') {
    try {
      return JSON.parse(payload) as RoundFrameUpdateEnvelope;
    } catch {
      return {};
    }
  }
  if (isPlainObject(payload)) {
    return payload as RoundFrameUpdateEnvelope;
  }
  return {};
}

function mergeSectionData<T>(
  previous: T | null,
  incoming: unknown,
  mode: 'full' | 'diff',
): T | null {
  if (mode === 'full') {
    return (incoming as T) ?? null;
  }
  if (incoming == null) {
    return (incoming as T) ?? null;
  }
  if (previous == null) {
    return (incoming as T) ?? null;
  }
  if (!isPlainObject(previous) || !isPlainObject(incoming)) {
    return (incoming as T) ?? null;
  }
  const result: Record<string, unknown> = { ...(previous as Record<string, unknown>) };
  for (const [key, value] of Object.entries(incoming)) {
    if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = mergeSectionData(result[key] as Record<string, unknown>, value, 'diff');
    } else {
      result[key] = value;
    }
  }
  return result as T;
}

function hasSolRegression(prev: RoundSnapshot | null, next: RoundSnapshot | null): boolean {
  if (!prev || !next) {
    return false;
  }
  const prevSol = Number.parseFloat(prev.totals?.deployedSol ?? '0');
  const nextSol = Number.parseFloat(next.totals?.deployedSol ?? '0');
  return nextSol < prevSol;
}

function shouldSkipLiveUpdate(
  frame: RoundFrame,
  metaSlot: number | null,
  nextSnapshot: RoundSnapshot | null,
): boolean {
  if (!nextSnapshot) {
    return false;
  }
  if (metaSlot !== null && frame.liveSlot !== null) {
    if (metaSlot < frame.liveSlot) {
      return true;
    }
    if (metaSlot === frame.liveSlot && hasSolRegression(frame.liveData, nextSnapshot)) {
      return true;
    }
  }
  if (metaSlot === null && hasSolRegression(frame.liveData, nextSnapshot)) {
    return true;
  }
  return false;
}

function resolveWinnerDetails(
  frame: RoundFrame,
): { type: 'optimistic' | 'final'; winner: number | null } | null {
  if (frame.finalWinner?.resultAvailable) {
    const winner =
      frame.finalWinner.winningSquareIndex ??
      (frame.finalWinner.winningSquare != null
        ? Number(frame.finalWinner.winningSquare)
        : null);
    return { type: 'final', winner: winner ?? null };
  }
  if (frame.optimisticWinner?.resultAvailable) {
    const winner =
      frame.optimisticWinner.winningSquareIndex ??
      (frame.optimisticWinner.winningSquare != null
        ? Number(frame.optimisticWinner.winningSquare)
        : null);
    return { type: 'optimistic', winner: winner ?? null };
  }
  return null;
}

function coerceRoundFrame(raw: unknown): RoundFrame | null {
  if (!isPlainObject(raw) || typeof raw.roundId !== 'string') {
    return null;
  }
  const versionsCandidate = raw.versions;
  const versions = isPlainObject(versionsCandidate)
    ? {
        live: toNumber(versionsCandidate.live),
        bids: toNumber(versionsCandidate.bids),
        optimistic: toNumber(versionsCandidate.optimistic),
        final: toNumber(versionsCandidate.final),
      }
    : { live: 0, bids: 0, optimistic: 0, final: 0 };
  const liveSlot =
    typeof raw.liveSlot === 'number'
      ? raw.liveSlot
      : typeof raw.liveSlot === 'string'
        ? Number(raw.liveSlot)
        : null;
  return {
    roundId: raw.roundId,
    liveData: (raw.liveData as RoundSnapshot) ?? null,
    liveSlot: Number.isFinite(liveSlot) ? (liveSlot as number) : null,
    bids: (raw.bids as RoundFrame['bids']) ?? null,
    optimisticWinner: (raw.optimisticWinner as RoundResultSnapshot) ?? null,
    finalWinner: (raw.finalWinner as RoundResultSnapshot) ?? null,
    versions,
    updatedAt: Date.now(),
  };
}

/** Interface for emitters that support app mode */
interface ModeAwareEmitter extends EventEmitter {
  shouldEmitRoundEvents?: () => boolean;
  getMode?: () => 'active' | 'idle';
}

/** Data is considered stale if older than 3 seconds */
const STALE_THRESHOLD_MS = 3_000;

export class StateStore {
  private readonly historyLimit: number;
  private readonly resultPhaseDurationMs: number;
  private readonly winnerTiming: { minSpinMs: number; maxWaitMs: number };

  private frames = new Map<string, RoundFrame>();
  private order: string[] = [];
  private globals: RoundFrameGlobals = DEFAULT_GLOBALS;
  private currentRoundId: string | null = null;
  private latestFinalizedRoundId: string | null = null;
  private phase: PhaseMetadata | null = null;
  private resultPhaseActive = false;
  private resultPhaseTimer: NodeJS.Timeout | null = null;
  /** Tracks which winner types have been revealed per round: "roundId:optimistic" or "roundId:final" */
  private revealedWinners = new Set<string>();
  /** Stores optimistic winner tile for mismatch detection */
  private optimisticWinners = new Map<string, number>();
  private roundStartTimestamps = new Map<string, number>();
  private pendingWinnerTimers = new Map<string, NodeJS.Timeout>();
  private lastUpdatedAt: number | null = null;

  constructor(private readonly emitter: ModeAwareEmitter, options: StateStoreOptions = {}) {
    this.historyLimit = Math.max(2, options.historyLimit ?? DEFAULT_HISTORY_LIMIT);
    this.resultPhaseDurationMs = options.resultPhaseDurationMs ?? DEFAULT_RESULT_DURATION_MS;
    this.winnerTiming = {
      minSpinMs: options.winnerTiming?.minSpinMs ?? DEFAULT_WINNER_TIMING.minSpinMs,
      maxWaitMs: options.winnerTiming?.maxWaitMs ?? DEFAULT_WINNER_TIMING.maxWaitMs,
    };
  }

  /**
   * Check if round-related events (frame, phase, winner) should be emitted.
   * Returns false when the app is in idle mode.
   */
  private shouldEmitRoundEvents(): boolean {
    return this.emitter.shouldEmitRoundEvents?.() ?? true;
  }

  applySnapshot(snapshot: StateV3Response): void {
    this.frames.clear();
    this.order = [];
    (snapshot.data.frames ?? []).forEach((frame: unknown) => {
      const normalized = coerceRoundFrame(frame);
      if (normalized) {
        this.frames.set(normalized.roundId, normalized);
        this.order.push(normalized.roundId);
      }
    });
    this.enforceHistoryLimit();
    this.globals = snapshot.data.globals
      ? ({ ...DEFAULT_GLOBALS, ...snapshot.data.globals } as RoundFrameGlobals)
      : DEFAULT_GLOBALS;
    this.currentRoundId = snapshot.data.currentRoundId ?? this.getLatestRoundId();
    this.latestFinalizedRoundId = snapshot.data.latestFinalizedRoundId ?? null;
    if (this.currentRoundId) {
      this.roundStartTimestamps.set(this.currentRoundId, Date.now());
    }
    this.lastUpdatedAt = Date.now();
    this.applyPhase(snapshot.data.optimized ?? null);
    this.emitter.emit('snapshot', this.snapshot());
  }

  applyRoundFrame(payload: RoundFrameEventPayload): void {
    if (payload.section === 'snapshot' && typeof payload.payload === 'object') {
      this.applySnapshot(payload.payload as StateV3Response);
      return;
    }
    if (payload.phase) {
      this.applyPhase(payload.phase);
    }
    const envelope = parseEnvelope(payload.payload);
    const pointers = envelope.pointers ?? {};
    this.updatePointers(pointers);
    if (payload.section === 'globals') {
      this.applyGlobalsUpdate(envelope);
      this.emitter.emit('snapshot', this.snapshot());
      return;
    }
    if (!payload.roundId) {
      return;
    }
    const frame = this.ensureFrame(payload.roundId);
    this.recordRoundOrder(payload.roundId);
    this.applySectionUpdate(frame, payload.section, envelope, payload.version);
    if (envelope.globals) {
      const mergedGlobals = mergeSectionData<RoundFrameGlobals>(this.globals, envelope.globals, 'diff');
      this.globals = mergedGlobals ?? this.globals;
    }
    frame.updatedAt = Date.now();
    this.lastUpdatedAt = Date.now();
    this.tryEmitWinner(frame.roundId);
    if (this.shouldEmitRoundEvents()) {
      this.emitter.emit('frame', { ...frame });
    }
    this.emitter.emit('snapshot', this.snapshot());
  }

  snapshot(): StateStoreSnapshot {
    const now = Date.now();
    const dataAgeMs = this.lastUpdatedAt !== null ? now - this.lastUpdatedAt : null;
    const mode = this.emitter.getMode?.() ?? 'active';
    // Data is stale if: never updated, >3s old, or in idle mode (no updates expected)
    const isStale = mode === 'idle' || this.lastUpdatedAt === null || dataAgeMs! > STALE_THRESHOLD_MS;

    return {
      frames: new Map(this.frames),
      order: [...this.order],
      globals: { ...this.globals },
      currentRoundId: this.currentRoundId,
      latestFinalizedRoundId: this.latestFinalizedRoundId,
      phase: this.phase,
      lastUpdatedAt: this.lastUpdatedAt,
      dataAgeMs,
      isStale,
    };
  }

  getCurrentFrame(): RoundFrame | null {
    const latestId = this.getLatestRoundId();
    if (!latestId) {
      return null;
    }
    return this.frames.get(latestId) ?? null;
  }

  getFrames(limit?: number): RoundFrame[] {
    const slice = limit ? this.order.slice(-limit) : this.order;
    return slice.map((roundId) => this.frames.get(roundId)).filter(Boolean) as RoundFrame[];
  }

  getPreviousRound(): RoundFrame | null {
    if (this.latestFinalizedRoundId) {
      return this.frames.get(this.latestFinalizedRoundId) ?? null;
    }
    if (this.order.length < 2) {
      return null;
    }
    const prevId = this.order[this.order.length - 2];
    return this.frames.get(prevId) ?? null;
  }

  isResultPhaseActive(): boolean {
    return this.resultPhaseActive;
  }

  async waitForWinner(roundId: string): Promise<number | null> {
    const resolved = this.getWinnerIndex(roundId);
    if (resolved !== null) {
      return resolved;
    }
    const startedAt = Date.now();
    return new Promise((resolve) => {
      const interval = setInterval(() => {
        const winnerIndex = this.getWinnerIndex(roundId);
        if (winnerIndex !== null) {
          clearInterval(interval);
          resolve(winnerIndex);
          return;
        }
        if (this.currentRoundId !== roundId) {
          clearInterval(interval);
          if (this.shouldEmitRoundEvents()) {
            this.emitter.emit('winnerTimeout', { roundId, reason: 'round_changed' });
            // Emit roundFinalized with last known winner (if any)
            const lastKnownWinner = this.optimisticWinners.get(roundId) ?? null;
            this.emitter.emit('roundFinalized', {
              roundId,
              winner: lastKnownWinner,
              confirmed: false,
            });
          }
          this.optimisticWinners.delete(roundId);
          resolve(null);
          return;
        }
        if (Date.now() - startedAt >= this.winnerTiming.maxWaitMs) {
          clearInterval(interval);
          if (this.shouldEmitRoundEvents()) {
            this.emitter.emit('winnerTimeout', { roundId, reason: 'timeout' });
            // Emit roundFinalized with last known winner (if any)
            const lastKnownWinner = this.optimisticWinners.get(roundId) ?? null;
            this.emitter.emit('roundFinalized', {
              roundId,
              winner: lastKnownWinner,
              confirmed: false,
            });
          }
          this.optimisticWinners.delete(roundId);
          resolve(null);
        }
      }, WINNER_POLL_INTERVAL_MS);
    });
  }

  private applyGlobalsUpdate(envelope: RoundFrameUpdateEnvelope): void {
    const source = envelope.globals ?? envelope.data;
    const merged = mergeSectionData<RoundFrameGlobals>(this.globals, source, envelope.mode ?? 'full');
    this.globals = merged ?? this.globals;
  }

  private applyPhase(metadata: RoundPhasePayload | null): void {
    if (!metadata?.phase) {
      this.phase = null;
      return;
    }
    const nextPhase: PhaseMetadata = {
      phase: asGamePhase(metadata.phase),
      phaseSince: metadata.phaseSince ?? null,
      phaseUntil: metadata.phaseUntil ?? null,
    };
    const changed =
      !this.phase ||
      this.phase.phase !== nextPhase.phase ||
      this.phase.phaseSince !== nextPhase.phaseSince ||
      this.phase.phaseUntil !== nextPhase.phaseUntil;
    this.phase = nextPhase;
    if (changed && this.shouldEmitRoundEvents()) {
      this.emitter.emit('phaseChange', nextPhase);
    }
  }

  private updatePointers(pointers: { currentRoundId?: string | null; latestFinalizedRoundId?: string | null }): void {
    if (typeof pointers.currentRoundId !== 'undefined') {
      if (pointers.currentRoundId && pointers.currentRoundId !== this.currentRoundId) {
        this.roundStartTimestamps.set(pointers.currentRoundId, Date.now());
      }
      this.currentRoundId = pointers.currentRoundId ?? this.currentRoundId;
    }
    if (typeof pointers.latestFinalizedRoundId !== 'undefined') {
      this.latestFinalizedRoundId = pointers.latestFinalizedRoundId ?? null;
    }
  }

  private ensureFrame(roundId: string): RoundFrame {
    const existing = this.frames.get(roundId);
    if (existing) {
      return existing;
    }
    const frame: RoundFrame = {
      roundId,
      liveData: null,
      liveSlot: null,
      bids: null,
      optimisticWinner: null,
      finalWinner: null,
      versions: { live: 0, bids: 0, optimistic: 0, final: 0 },
      updatedAt: Date.now(),
    };
    this.frames.set(roundId, frame);
    return frame;
  }

  private recordRoundOrder(roundId: string): void {
    this.order = this.order.filter((id) => id !== roundId);
    this.order.push(roundId);
    this.enforceHistoryLimit();
  }

  private enforceHistoryLimit(): void {
    while (this.order.length > this.historyLimit) {
      const removed = this.order.shift();
      if (removed) {
        this.frames.delete(removed);
        this.revealedWinners.delete(`${removed}:optimistic`);
        this.revealedWinners.delete(`${removed}:final`);
        this.optimisticWinners.delete(removed);
        const timer = this.pendingWinnerTimers.get(removed);
        if (timer) {
          clearTimeout(timer);
          this.pendingWinnerTimers.delete(removed);
        }
        this.roundStartTimestamps.delete(removed);
      }
    }
  }

  private applySectionUpdate(
    frame: RoundFrame,
    section: string,
    envelope: RoundFrameUpdateEnvelope,
    version: number,
  ): void {
    const mode = envelope.mode ?? 'full';
    const metaSlot =
      typeof envelope.meta?.slot === 'number'
        ? envelope.meta.slot
        : typeof envelope.meta?.slot === 'string'
          ? Number(envelope.meta.slot)
          : null;
    if (section === 'live') {
      if (metaSlot !== null) {
        frame.liveSlot = metaSlot;
      }
      const nextSnapshot = mergeSectionData<RoundSnapshot>(frame.liveData, envelope.data, mode);
      if (shouldSkipLiveUpdate(frame, metaSlot, nextSnapshot)) {
        return;
      }
      frame.liveData = nextSnapshot;
      frame.versions.live = version;
      return;
    }
    if (section === 'bids') {
      frame.bids = mergeSectionData(frame.bids, envelope.data, mode);
      frame.versions.bids = version;
      return;
    }
    if (section === 'optimistic') {
      frame.optimisticWinner = mergeSectionData(frame.optimisticWinner, envelope.data, mode);
      frame.versions.optimistic = version;
      return;
    }
    if (section === 'final') {
      frame.finalWinner = mergeSectionData(frame.finalWinner, envelope.data, mode);
      frame.versions.final = version;
    }
  }

  private tryEmitWinner(roundId: string): void {
    // Skip if final winner already revealed (round is complete)
    if (this.revealedWinners.has(`${roundId}:final`)) {
      return;
    }
    const frame = this.frames.get(roundId);
    if (!frame) {
      return;
    }
    const winnerDetails = resolveWinnerDetails(frame);
    if (!winnerDetails) {
      return;
    }
    
    // For optimistic, apply minSpinMs delay
    // For final (when optimistic already shown), emit immediately
    const optimisticRevealed = this.revealedWinners.has(`${roundId}:optimistic`);
    
    if (optimisticRevealed && winnerDetails.type === 'final') {
      // Final winner available after optimistic - emit immediately
      this.emitWinner(roundId);
      return;
    }
    
    // First winner (optimistic) - apply spin delay
    const startedAt = this.roundStartTimestamps.get(roundId) ?? Date.now();
    const elapsed = Date.now() - startedAt;
    const delay = Math.max(0, this.winnerTiming.minSpinMs - elapsed);
    if (delay <= 0) {
      this.emitWinner(roundId);
      return;
    }
    if (this.pendingWinnerTimers.has(roundId)) {
      return;
    }
    const timer = setTimeout(() => {
      this.pendingWinnerTimers.delete(roundId);
      this.emitWinner(roundId);
    }, delay);
    this.pendingWinnerTimers.set(roundId, timer);
  }

  private emitWinner(roundId: string): void {
    const frame = this.frames.get(roundId);
    if (!frame) {
      return;
    }

    // Check for optimistic winner first
    if (frame.optimisticWinner?.resultAvailable) {
      const optimisticKey = `${roundId}:optimistic`;
      if (!this.revealedWinners.has(optimisticKey)) {
        const winner =
          frame.optimisticWinner.winningSquareIndex ??
          (frame.optimisticWinner.winningSquare != null
            ? Number(frame.optimisticWinner.winningSquare)
            : null);
        
        this.revealedWinners.add(optimisticKey);
        if (winner !== null) {
          this.optimisticWinners.set(roundId, winner);
        }
        this.enterResultPhase();
        
        if (this.shouldEmitRoundEvents()) {
          this.emitter.emit('winner', {
            roundId,
            winner,
            type: 'optimistic',
          });
        }
      }
    }

    // Check for final winner (fires second, with mismatch detection)
    if (frame.finalWinner?.resultAvailable) {
      const finalKey = `${roundId}:final`;
      if (!this.revealedWinners.has(finalKey)) {
        const winner =
          frame.finalWinner.winningSquareIndex ??
          (frame.finalWinner.winningSquare != null
            ? Number(frame.finalWinner.winningSquare)
            : null);
        
        // Detect mismatch
        const optimisticWinner = this.optimisticWinners.get(roundId);
        const mismatch = optimisticWinner !== undefined && optimisticWinner !== winner;
        
        this.revealedWinners.add(finalKey);
        
        if (this.shouldEmitRoundEvents()) {
          this.emitter.emit('winner', {
            roundId,
            winner,
            type: 'final',
            mismatch: mismatch || undefined,
            optimisticWinner: mismatch ? optimisticWinner : undefined,
          });
          
          // Check for motherlode hit
          const motherlodeHit = (frame.finalWinner as Record<string, unknown>)?.motherlodeHit;
          if (motherlodeHit && winner !== null) {
            const motherlodeRaw = String((frame.finalWinner as Record<string, unknown>)?.motherlodeRaw ?? '0');
            const motherlodeFormatted = String((frame.finalWinner as Record<string, unknown>)?.motherlodeFormatted ?? '');
            
            this.emitter.emit('motherlode', {
              roundId,
              tile: winner,
              amountRaw: motherlodeRaw,
              amountFormatted: motherlodeFormatted,
            });
          }
          
          // Emit roundFinalized after final winner
          this.emitter.emit('roundFinalized', {
            roundId,
            winner,
            confirmed: true,
            mismatch: mismatch || undefined,
          });
        }
        
        // Cleanup tracking for this round
        this.optimisticWinners.delete(roundId);
      }
    }
  }

  private enterResultPhase(): void {
    this.resultPhaseActive = true;
    if (this.resultPhaseTimer) {
      clearTimeout(this.resultPhaseTimer);
    }
    this.resultPhaseTimer = setTimeout(() => {
      this.resultPhaseActive = false;
      this.resultPhaseTimer = null;
      this.emitter.emit('resultPhaseEnded');
    }, this.resultPhaseDurationMs);
  }

  private getLatestRoundId(): string | null {
    if (this.currentRoundId) {
      return this.currentRoundId;
    }
    if (this.order.length === 0) {
      return null;
    }
    return this.order[this.order.length - 1];
  }

  private getWinnerIndex(roundId: string): number | null {
    const frame = this.frames.get(roundId);
    if (!frame) {
      return null;
    }
    const winner = resolveWinnerDetails(frame);
    return winner?.winner ?? null;
  }
}

