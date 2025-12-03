import { EventEmitter } from 'eventemitter3';
import type { Response } from 'express';
import type { StateStoreSnapshot } from '../state/types.js';
import { Poller } from './poller.js';
import { Broadcaster } from './broadcaster.js';
import { ServerStateStore } from './state-store.js';
import type {
  MultiplexerOptions,
  MultiplexerStats,
  MultiplexerEvents,
  PhaseChangeEvent,
  WinnerEvent,
  HealthEvent,
} from './types.js';

/**
 * Server-side multiplexer for broadcasting ore-api state to multiple clients
 *
 * Pattern B: Single poll → multi-broadcast
 *
 * @example
 * ```typescript
 * import { createMultiplexer, expressSSE } from '@oredata/sdk/server';
 *
 * const multiplexer = createMultiplexer({
 *   apiBaseUrl: 'https://ore-api.gmore.fun',
 *   apiKey: process.env.OREDATA_API_KEY,
 * });
 *
 * multiplexer.start();
 *
 * app.get('/events', expressSSE(multiplexer));
 * ```
 */
export class Multiplexer extends EventEmitter<MultiplexerEvents> {
  private poller: Poller;
  private broadcaster: Broadcaster;
  private stateStore: ServerStateStore;
  private transform: (snapshot: StateStoreSnapshot) => unknown;
  private pingInterval: NodeJS.Timeout | null = null;
  private started = false;

  constructor(private options: MultiplexerOptions) {
    super();

    // Default transform is identity (send everything)
    this.transform = options.transform ?? ((s) => s);

    // Initialize components
    this.poller = new Poller(options);
    this.broadcaster = new Broadcaster(options);
    this.stateStore = new ServerStateStore();

    // Wire up poller events
    this.poller.on('data', (snapshot) => this.handleSnapshot(snapshot));
    this.poller.on('health', (health) => this.handleHealth(health));
    this.poller.on('error', (error) => this.emit('error', error));
    this.poller.on('maxRetriesReached', () => {
      this.emit('error', new Error('Max retries reached, continuing with backoff'));
    });

    // Wire up broadcaster events
    this.broadcaster.on('clientConnected', (id) => this.emit('clientConnected', id));
    this.broadcaster.on('clientDisconnected', (id) => this.emit('clientDisconnected', id));
  }

  /**
   * Handle incoming snapshot from poller
   */
  private handleSnapshot(snapshot: StateStoreSnapshot): void {
    // Detect changes
    const changes = this.stateStore.update(snapshot);

    // Transform for broadcast
    const transformed = this.transform(snapshot);

    // Broadcast snapshot to all clients
    this.broadcaster.broadcast('snapshot', transformed);

    // Emit phase change if detected
    if (changes.phaseChanged && changes.previousPhase && snapshot.phase) {
      const phaseEvent: PhaseChangeEvent = {
        phase: snapshot.phase.phase,
        previousPhase: changes.previousPhase,
        roundId: snapshot.currentRoundId ?? '',
        timestamp: Date.now(),
      };
      this.broadcaster.broadcast('phaseChange', phaseEvent);
      this.emit('phaseChange', phaseEvent);
    }

    // Emit winner if detected
    if (changes.winnerDetected && changes.winner) {
      this.broadcaster.broadcast('winner', changes.winner);
      this.emit('winner', changes.winner);
    }

    // Emit snapshot event for server-side handling
    this.emit('snapshot', transformed);
  }

  /**
   * Handle health update
   */
  private handleHealth(health: HealthEvent): void {
    if (this.options.healthBroadcast) {
      this.broadcaster.broadcast('health', health);
    }
    this.emit('health', health);
  }

  /**
   * Start the multiplexer
   */
  start(): void {
    if (this.started) return;
    this.started = true;

    this.poller.start();

    // Set up keep-alive pings every 15 seconds
    this.pingInterval = setInterval(() => {
      this.broadcaster.ping();
    }, 15000);
  }

  /**
   * Stop the multiplexer
   */
  stop(): void {
    if (!this.started) return;
    this.started = false;

    this.poller.stop();
    this.broadcaster.stop();

    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    this.stateStore.reset();
  }

  /**
   * Add a client connection
   * Sends current state immediately
   */
  addClient(res: Response): string {
    // Get current state for immediate send
    const currentSnapshot = this.stateStore.getLatest();
    const initialState = currentSnapshot ? this.transform(currentSnapshot) : undefined;

    return this.broadcaster.addClient(res, initialState);
  }

  /**
   * Remove a client by response object
   */
  removeClient(res: Response): void {
    this.broadcaster.removeClientByResponse(res);
  }

  /**
   * Get multiplexer statistics
   */
  getStats(): MultiplexerStats {
    const pollerStats = this.poller.getStats();

    return {
      clientCount: this.broadcaster.getClientCount(),
      pollCount: pollerStats.pollCount,
      lastPollAt: pollerStats.lastPollAt,
      currentRoundId: this.stateStore.getCurrentRoundId(),
      currentPhase: this.stateStore.getCurrentPhase(),
      isPolling: pollerStats.isPolling,
      errors: pollerStats.errors,
    };
  }

  /**
   * Get number of connected clients
   */
  getClientCount(): number {
    return this.broadcaster.getClientCount();
  }

  /**
   * Check if multiplexer is running
   */
  isRunning(): boolean {
    return this.started;
  }
}

/**
 * Create a new multiplexer instance
 */
export function createMultiplexer(options: MultiplexerOptions): Multiplexer {
  return new Multiplexer(options);
}

