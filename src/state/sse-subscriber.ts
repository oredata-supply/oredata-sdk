import EventEmitter from 'eventemitter3';

import type { RoundFrameEventPayload } from './types.js';

export interface SSEStatus {
  mode: 'idle' | 'online' | 'recovering';
  attempt: number;
  lastConnectedAt: number | null;
}

interface SSEOptions {
  baseUrls: string[];
  includeBids?: boolean;
  apiKey?: string | null;
  apiKeyParam?: string;
  reconnectDelayMs?: number;
}

export declare interface SseSubscriber {
  on(event: 'round_frame', listener: (payload: RoundFrameEventPayload) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'status', listener: (status: SSEStatus) => void): this;
}

export class SseSubscriber extends EventEmitter {
  private readonly baseUrls: string[];
  private readonly includeBids: boolean;
  private readonly apiKey: string | null;
  private readonly apiKeyParam: string;
  private readonly reconnectDelayMs: number;

  private currentSource: EventSource | null = null;
  private attempt = 0;
  private lastConnectedAt: number | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(options: SSEOptions) {
    super();
    if (!options.baseUrls || options.baseUrls.length === 0) {
      throw new Error('SseSubscriber requires at least one base URL');
    }
    this.baseUrls = options.baseUrls.map((u) => u.replace(/\/$/, ''));
    this.includeBids = Boolean(options.includeBids);
    this.apiKey = options.apiKey ?? null;
    this.apiKeyParam = options.apiKeyParam ?? 'apiKey';
    this.reconnectDelayMs = options.reconnectDelayMs ?? 2_000;
  }

  start(): void {
    if (typeof window === 'undefined' || typeof window.EventSource === 'undefined') {
      this.emit('error', new Error('EventSource is not available in this environment'));
      return;
    }
    if (this.currentSource) {
      return;
    }
    this.connectToNextBase(0);
  }

  stop(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.currentSource) {
      this.currentSource.close();
      this.currentSource = null;
    }
    this.attempt = 0;
    this.lastConnectedAt = null;
    this.emit('status', { mode: 'idle', attempt: 0, lastConnectedAt: null });
  }

  private buildUrl(baseUrl: string): string {
    const params = new URLSearchParams();
    if (this.includeBids) {
      params.set('includeBids', '1');
    }
    if (this.apiKey) {
      params.set(this.apiKeyParam, this.apiKey);
    }
    const query = params.toString();
    return `${baseUrl}/events${query ? `?${query}` : ''}`;
  }

  private connectToNextBase(startIndex: number): void {
    for (let i = 0; i < this.baseUrls.length; i += 1) {
      const index = (startIndex + i) % this.baseUrls.length;
      const baseUrl = this.baseUrls[index];
      try {
        this.openEventSource(baseUrl, index);
        return;
      } catch (error) {
        this.emit('error', error as Error);
      }
    }
    this.scheduleReconnect(startIndex);
  }

  private openEventSource(baseUrl: string, baseIndex: number): void {
    const url = this.buildUrl(baseUrl);
    this.attempt += 1;
    this.emit('status', { mode: 'recovering', attempt: this.attempt, lastConnectedAt: this.lastConnectedAt });

    const source = new window.EventSource(url);
    source.onopen = () => {
      this.currentSource = source;
      this.attempt = 0;
      this.lastConnectedAt = Date.now();
      this.emit('status', { mode: 'online', attempt: 0, lastConnectedAt: this.lastConnectedAt });
    };
    source.onerror = () => {
      if (this.currentSource === source) {
        this.currentSource.close();
        this.currentSource = null;
      }
      this.scheduleReconnect(baseIndex + 1);
    };
    source.addEventListener('round_frame', (event) => {
      try {
        const parsed = JSON.parse((event as MessageEvent<string>).data) as RoundFrameEventPayload;
        this.emit('round_frame', parsed);
      } catch (error) {
        this.emit('error', error as Error);
      }
    });
  }

  private scheduleReconnect(startIndex: number): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectToNextBase(startIndex);
    }, this.reconnectDelayMs);
  }
}

