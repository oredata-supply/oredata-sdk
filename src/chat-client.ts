/**
 * ChatClient - Subscribe to ore.supply chat messages via OreData API
 *
 * This client provides access to the ore.supply community chat,
 * relayed through the OreData API for convenience and reliability.
 *
 * Features:
 * - Real-time chat via SSE (with automatic reconnect)
 * - REST endpoint for message history
 * - Event-based API for easy integration
 *
 * @example
 * ```typescript
 * import { ChatClient } from '@oredata/sdk';
 *
 * const chat = new ChatClient({
 *   apiBaseUrl: 'https://api.oredata.supply',
 * });
 *
 * chat.on('message', (msg) => {
 *   console.log(`${msg.username}: ${msg.text}`);
 * });
 *
 * chat.on('history', (messages) => {
 *   console.log(`Loaded ${messages.length} historical messages`);
 * });
 *
 * // Connect to SSE stream (includes chat)
 * chat.connect();
 *
 * // Or fetch history via REST
 * const history = await chat.getHistory({ limit: 50 });
 * ```
 */

import { EventEmitter } from 'eventemitter3';
import { SDK_USER_AGENT } from './http-client.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Chat message from ore.supply community chat
 */
export interface ChatMessage {
  /** Unique message ID */
  id: number;
  /** Wallet address of sender */
  authority: string;
  /** Display username */
  username: string;
  /** Message content */
  text: string;
  /** Unix timestamp (seconds) */
  ts: number;
  /** Profile photo URL (nullable) */
  profilePhotoUrl: string | null;
  /** User role (nullable) */
  role: string | null;
  /** When we received the message (ms since epoch) */
  receivedAt: number;
}

/**
 * Chat history response from REST endpoint
 */
export interface ChatHistoryResponse {
  enabled: boolean;
  messages: ChatMessage[];
  lastId: number | null;
  count: number;
}

/**
 * Chat status response
 */
export interface ChatStatusResponse {
  enabled: boolean;
  running: boolean;
  connected: boolean;
  sseSubscribers: number;
  bufferSize: number;
  messageCount: number;
  lastMessageId: number | null;
}

/**
 * ChatClient events
 */
export interface ChatClientEvents {
  /** New chat message received */
  message: (message: ChatMessage) => void;
  /** Historical messages loaded (initial connection or REST fetch) */
  history: (messages: ChatMessage[]) => void;
  /** Connected to SSE stream */
  connected: () => void;
  /** Disconnected from SSE stream */
  disconnected: () => void;
  /** Error occurred */
  error: (error: Error) => void;
}

/**
 * ChatClient options
 */
export interface ChatClientOptions {
  /** API base URL (default: https://api.oredata.supply) */
  apiBaseUrl?: string;
  /** API key for authentication (optional) */
  apiKey?: string;
  /** Auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean;
  /** Reconnect delay in ms (default: 5000) */
  reconnectDelayMs?: number;
}

// ─── ChatClient ──────────────────────────────────────────────────────────────

const DEFAULT_API_BASE_URL = 'https://api.oredata.supply';
const DEFAULT_RECONNECT_DELAY_MS = 5000;

/**
 * ChatClient - Real-time chat subscription via OreData API
 *
 * Connects to the SSE stream with `includeChat=true` to receive
 * chat messages alongside game state updates.
 */
export class ChatClient extends EventEmitter<ChatClientEvents> {
  private readonly apiBaseUrl: string;
  private readonly apiKey?: string;
  private readonly autoReconnect: boolean;
  private readonly reconnectDelayMs: number;

  private eventSource: EventSource | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isConnecting = false;
  private intentionalDisconnect = false;
  private lastMessageId: number | null = null;

  constructor(options: ChatClientOptions = {}) {
    super();
    this.apiBaseUrl = (options.apiBaseUrl ?? DEFAULT_API_BASE_URL).replace(/\/$/, '');
    this.apiKey = options.apiKey;
    this.autoReconnect = options.autoReconnect ?? true;
    this.reconnectDelayMs = options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
  }

  /**
   * Connect to SSE stream with chat enabled
   */
  connect(): void {
    if (this.eventSource || this.isConnecting) {
      return;
    }

    this.isConnecting = true;
    this.intentionalDisconnect = false;

    const params = new URLSearchParams({
      includeChat: 'true',
    });
    if (this.apiKey) {
      params.set('apiKey', this.apiKey);
    }

    const url = `${this.apiBaseUrl}/events?${params.toString()}`;

    try {
      this.eventSource = new EventSource(url);

      this.eventSource.onopen = () => {
        this.isConnecting = false;
        this.emit('connected');
      };

      this.eventSource.onerror = () => {
        this.handleDisconnect();
      };

      // Listen for chat events
      this.eventSource.addEventListener('chat', (event: MessageEvent) => {
        this.handleChatEvent(event.data);
      });

      // Ignore other events (heartbeat, round_frame) - they're handled elsewhere
    } catch (error) {
      this.isConnecting = false;
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
      this.scheduleReconnect();
    }
  }

  /**
   * Disconnect from SSE stream
   */
  disconnect(): void {
    this.intentionalDisconnect = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    this.isConnecting = false;
  }

  /**
   * Check if connected
   */
  get connected(): boolean {
    return this.eventSource !== null && this.eventSource.readyState === EventSource.OPEN;
  }

  /**
   * Get the last received message ID
   */
  getLastMessageId(): number | null {
    return this.lastMessageId;
  }

  /**
   * Fetch chat history via REST endpoint
   */
  async getHistory(options: { limit?: number; since?: number } = {}): Promise<ChatMessage[]> {
    const params = new URLSearchParams();
    if (options.limit) {
      params.set('limit', String(options.limit));
    }
    if (options.since) {
      params.set('since', String(options.since));
    }

    const url = `${this.apiBaseUrl}/chat/history?${params.toString()}`;

    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': SDK_USER_AGENT,
        ...(this.apiKey ? { 'x-api-key': this.apiKey } : {}),
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch chat history: ${response.status}`);
    }

    const data = (await response.json()) as ChatHistoryResponse;
    return data.messages;
  }

  /**
   * Get chat relay status
   */
  async getStatus(): Promise<ChatStatusResponse> {
    const url = `${this.apiBaseUrl}/chat/status`;

    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': SDK_USER_AGENT,
        ...(this.apiKey ? { 'x-api-key': this.apiKey } : {}),
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch chat status: ${response.status}`);
    }

    return (await response.json()) as ChatStatusResponse;
  }

  // ─── Private ─────────────────────────────────────────────────────────────────

  private handleChatEvent(data: string): void {
    try {
      const parsed = JSON.parse(data);

      // Check if this is a history event (initial load)
      if (parsed.type === 'history' && Array.isArray(parsed.messages)) {
        const messages = parsed.messages as ChatMessage[];
        if (messages.length > 0) {
          this.lastMessageId = messages[messages.length - 1].id;
        }
        this.emit('history', messages);
        return;
      }

      // Single message
      const message = parsed as ChatMessage;
      if (message.id && message.text) {
        this.lastMessageId = message.id;
        this.emit('message', message);
      }
    } catch {
      // Ignore parse errors
    }
  }

  private handleDisconnect(): void {
    const wasConnected = this.eventSource !== null;

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    this.isConnecting = false;

    if (wasConnected) {
      this.emit('disconnected');
    }

    if (!this.intentionalDisconnect && this.autoReconnect) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.intentionalDisconnect) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelayMs);
  }
}
