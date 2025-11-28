import { EventEmitter } from 'eventemitter3';
import type { StateStoreSnapshot } from '../state/types.js';
import type { MultiplexerOptions, HealthEvent } from './types.js';

interface PollerEvents {
  data: (snapshot: StateStoreSnapshot) => void;
  health: (health: HealthEvent) => void;
  error: (error: Error) => void;
  maxRetriesReached: () => void;
}

/**
 * Polls ore-api for state updates
 */
export class Poller extends EventEmitter<PollerEvents> {
  private interval: NodeJS.Timeout | null = null;
  private healthInterval: NodeJS.Timeout | null = null;
  private readonly apiBaseUrl: string;
  private readonly apiKey: string;
  private readonly pollInterval: number;
  private readonly healthPollInterval: number;
  private readonly healthBroadcast: boolean;
  private readonly maxRetries: number;
  private readonly baseRetryDelay: number;

  private retryCount = 0;
  private pollCount = 0;
  private lastPollAt: number | null = null;
  private isPolling = false;
  private errors = 0;

  constructor(options: MultiplexerOptions) {
    super();
    this.apiBaseUrl = options.apiBaseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.apiKey = options.apiKey;
    this.pollInterval = options.pollInterval ?? 500;
    this.healthPollInterval = options.healthInterval ?? 5000;
    this.healthBroadcast = options.healthBroadcast ?? false;
    this.maxRetries = options.maxRetries ?? 10;
    this.baseRetryDelay = options.retryDelay ?? 1000;
  }

  /**
   * Start polling
   */
  start(): void {
    if (this.isPolling) return;
    this.isPolling = true;

    // Initial poll
    this.poll();

    // Set up interval
    this.interval = setInterval(() => this.poll(), this.pollInterval);

    // Set up health polling if enabled
    if (this.healthBroadcast) {
      this.healthInterval = setInterval(() => this.pollHealth(), this.healthPollInterval);
    }
  }

  /**
   * Stop polling
   */
  stop(): void {
    this.isPolling = false;

    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    if (this.healthInterval) {
      clearInterval(this.healthInterval);
      this.healthInterval = null;
    }
  }

  /**
   * Perform a single poll
   */
  private async poll(): Promise<void> {
    if (!this.isPolling) return;

    try {
      const response = await fetch(`${this.apiBaseUrl}/v3/state`, {
        headers: {
          'X-Api-Key': this.apiKey,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as StateStoreSnapshot;

      // Reset retry count on success
      this.retryCount = 0;
      this.pollCount++;
      this.lastPollAt = Date.now();

      this.emit('data', data);
    } catch (error) {
      this.errors++;
      this.retryCount++;
      this.emit('error', error instanceof Error ? error : new Error(String(error)));

      if (this.retryCount >= this.maxRetries) {
        this.emit('maxRetriesReached');
        // Continue trying but with exponential backoff
        await this.backoff();
      }
    }
  }

  /**
   * Poll health endpoint
   */
  private async pollHealth(): Promise<void> {
    if (!this.isPolling || !this.healthBroadcast) return;

    try {
      const response = await fetch(`${this.apiBaseUrl}/v3/health`, {
        headers: {
          'X-Api-Key': this.apiKey,
          Accept: 'application/json',
        },
      });

      const data = await response.json();

      const healthEvent: HealthEvent = {
        api: response.ok ? 'healthy' : 'degraded',
        rpc: data?.rpc?.status === 'healthy' ? 'healthy' : 'degraded',
        timestamp: Date.now(),
      };

      this.emit('health', healthEvent);
    } catch {
      const healthEvent: HealthEvent = {
        api: 'down',
        rpc: 'down',
        timestamp: Date.now(),
      };
      this.emit('health', healthEvent);
    }
  }

  /**
   * Exponential backoff delay
   */
  private async backoff(): Promise<void> {
    const delay = Math.min(this.baseRetryDelay * Math.pow(2, this.retryCount - 1), 30000);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  /**
   * Get poll statistics
   */
  getStats(): { pollCount: number; lastPollAt: number | null; isPolling: boolean; errors: number } {
    return {
      pollCount: this.pollCount,
      lastPollAt: this.lastPollAt,
      isPolling: this.isPolling,
      errors: this.errors,
    };
  }
}

