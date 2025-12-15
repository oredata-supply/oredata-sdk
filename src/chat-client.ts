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
 * Chat send request
 */
export interface ChatSendRequest {
  /** Message text (max 500 chars) */
  text: string;
  /** Wallet-signed JWT token */
  jwt: string;
}

/**
 * Chat send response
 */
export interface ChatSendResponse {
  success: boolean;
  messageId?: number;
  authority?: string;
  error?: string;
  code?: 'not_eligible' | 'rate_limited' | 'invalid_jwt' | 'send_failed' | 'invalid_request';
  retryAfterMs?: number;
}

/**
 * Chat session request (for ore-bsm authentication)
 */
export interface ChatSessionRequest {
  /** Wallet address (base58) */
  authority: string;
  /** Base64-encoded Ed25519 signature of the auth message */
  signature: string;
  /** Timestamp used in the auth message (milliseconds) */
  timestamp: number;
}

/**
 * Chat session response
 */
export interface ChatSessionResponse {
  success: boolean;
  jwt?: string;
  expiresAt?: number;
  authority?: string;
  error?: string;
  code?: 'invalid_signature' | 'not_eligible' | 'invalid_request';
}

/**
 * Chat eligibility response
 */
export interface ChatEligibilityResponse {
  authority: string;
  eligible: boolean;
}

/**
 * Known miners stats response
 */
export interface ChatMinersStatsResponse {
  total: number;
  activeIn30Days: number;
  activeIn7Days: number;
  activeIn24Hours: number;
  cacheSize: number;
}

/**
 * Wallet signer interface (compatible with @solana/wallet-adapter)
 */
export interface ChatWalletSigner {
  /** Wallet public key */
  publicKey: { toBase58(): string } | string;
  /** Sign a message (returns Uint8Array signature) */
  signMessage(message: Uint8Array): Promise<Uint8Array>;
}

/**
 * Simple send request (uses wallet to create JWT automatically)
 */
export interface ChatSendWithWalletRequest {
  /** Message text (max 500 chars) */
  text: string;
  /** Wallet signer (must have signMessage capability) */
  wallet: ChatWalletSigner;
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

  // ─── Send Methods ───────────────────────────────────────────────────────────

  /**
   * Send a chat message using a wallet (recommended).
   *
   * This handles the full ore-bsm authentication flow automatically:
   * 1. Wallet signs ore-bsm's auth message
   * 2. API authenticates with ore-bsm to get their JWT
   * 3. Message is sent using ore-bsm's JWT
   *
   * User must have mined in the last 30 days.
   *
   * @example
   * ```typescript
   * import { ChatClient } from '@oredata/sdk';
   *
   * const chat = new ChatClient();
   *
   * // Simple! Just pass wallet and text
   * const result = await chat.send('Hello everyone!', wallet);
   *
   * if (result.success) {
   *   console.log('Message sent!');
   * } else {
   *   console.error(result.error);
   * }
   * ```
   */
  async send(text: string, wallet: ChatWalletSigner): Promise<ChatSendResponse> {
    // Create auth request (wallet signs ore-bsm's message format)
    const auth = await createChatAuth(wallet);
    
    // Get ore-bsm's JWT via our API
    const session = await this.createSession(auth);
    
    if (!session.success || !session.jwt) {
      return {
        success: false,
        error: session.error || 'Failed to create session',
        code: 'invalid_jwt',
      };
    }
    
    // Send the message with ore-bsm's JWT
    return this.sendMessage({ text, jwt: session.jwt });
  }

  /**
   * Send a chat message with a pre-created JWT from ore-bsm.
   *
   * Use this if you've already created a session via `createSession()`.
   *
   * @example
   * ```typescript
   * // Create session once (wallet signs, API gets ore-bsm JWT)
   * const auth = await createChatAuth(wallet);
   * const session = await chat.createSession(auth);
   *
   * // Reuse JWT for multiple messages
   * await chat.sendMessage({ text: 'Hello!', jwt: session.jwt! });
   * await chat.sendMessage({ text: 'Another message', jwt: session.jwt! });
   * ```
   */
  async sendMessage(request: ChatSendRequest): Promise<ChatSendResponse> {
    const url = `${this.apiBaseUrl}/chat/send`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': SDK_USER_AGENT,
        ...(this.apiKey ? { 'x-api-key': this.apiKey } : {}),
      },
      body: JSON.stringify(request),
    });

    const data = (await response.json()) as ChatSendResponse;
    return data;
  }

  /**
   * Create a chat session by authenticating with ore-bsm.
   *
   * Use `createChatAuth(wallet)` to generate the request, then call this.
   * The API will forward to ore-bsm's /auth/login endpoint to get their JWT.
   *
   * @example
   * ```typescript
   * import { createChatAuth, ChatClient } from '@oredata/sdk';
   *
   * const chat = new ChatClient();
   * const auth = await createChatAuth(wallet);
   * const session = await chat.createSession(auth);
   *
   * if (session.success) {
   *   // session.jwt is ore-bsm's JWT - use for sending messages
   *   await chat.sendMessage({ text: 'Hello!', jwt: session.jwt! });
   * }
   * ```
   */
  async createSession(request: ChatSessionRequest): Promise<ChatSessionResponse> {
    const url = `${this.apiBaseUrl}/chat/session`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': SDK_USER_AGENT,
        ...(this.apiKey ? { 'x-api-key': this.apiKey } : {}),
      },
      body: JSON.stringify(request),
    });

    const data = (await response.json()) as ChatSessionResponse;
    return data;
  }

  /**
   * Check if a wallet is eligible to chat.
   *
   * Eligibility requires mining activity in the last 30 days.
   *
   * @example
   * ```typescript
   * const result = await chat.isEligible(wallet.publicKey.toBase58());
   * if (result.eligible) {
   *   // Show chat input
   * } else {
   *   // Show "Mine to unlock chat" message
   * }
   * ```
   */
  async isEligible(authority: string): Promise<ChatEligibilityResponse> {
    const url = `${this.apiBaseUrl}/chat/eligibility?authority=${encodeURIComponent(authority)}`;

    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': SDK_USER_AGENT,
        ...(this.apiKey ? { 'x-api-key': this.apiKey } : {}),
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to check eligibility: ${response.status}`);
    }

    return (await response.json()) as ChatEligibilityResponse;
  }

  /**
   * Get known miners statistics.
   *
   * Returns counts of miners active in various time windows.
   */
  async getMinersStats(): Promise<ChatMinersStatsResponse> {
    const url = `${this.apiBaseUrl}/chat/miners/stats`;

    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': SDK_USER_AGENT,
        ...(this.apiKey ? { 'x-api-key': this.apiKey } : {}),
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch miners stats: ${response.status}`);
    }

    return (await response.json()) as ChatMinersStatsResponse;
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

// ─── JWT Helper ─────────────────────────────────────────────────────────────

/**
 * The ore-bsm authentication message format.
 */
export const ORE_BSM_AUTH_MESSAGE_PREFIX = 'Please sign this message to authenticate with ORE.\nTimestamp: ';

/**
 * Create a chat authentication request for ore-bsm.
 *
 * ore.supply uses a two-step auth:
 * 1. Sign a specific message format
 * 2. Our API forwards to ore-bsm's /auth/login to get their JWT
 *
 * @example
 * ```typescript
 * import { createChatAuth, ChatClient } from '@oredata/sdk';
 *
 * const chat = new ChatClient();
 *
 * // Create auth request (wallet will prompt for signature)
 * const auth = await createChatAuth(wallet);
 *
 * // Create session (API calls ore-bsm to get their JWT)
 * const session = await chat.createSession(auth);
 *
 * if (session.success) {
 *   // Send messages using ore-bsm's JWT
 *   await chat.sendMessage({ text: 'Hello!', jwt: session.jwt! });
 * }
 * ```
 *
 * @param wallet - Wallet with signMessage capability (e.g., from @solana/wallet-adapter)
 * @returns ChatSessionRequest ready to send to createSession()
 */
export async function createChatAuth(wallet: ChatWalletSigner): Promise<ChatSessionRequest> {
  // Get wallet address
  const authority = typeof wallet.publicKey === 'string' 
    ? wallet.publicKey 
    : wallet.publicKey.toBase58();

  // Create the exact message format ore-bsm expects
  const timestamp = Date.now();
  const message = `${ORE_BSM_AUTH_MESSAGE_PREFIX}${timestamp}`;
  const messageBytes = new TextEncoder().encode(message);

  // Get wallet signature
  const signatureBytes = await wallet.signMessage(messageBytes);

  // Base64 encode the signature (ore-bsm expects base64, not base58)
  const signature = base64Encode(String.fromCharCode(...signatureBytes));

  return {
    authority,
    signature,
    timestamp,
  };
}

/**
 * @deprecated Use `createChatAuth()` instead. ore-bsm requires their own JWT issuance.
 */
export async function createChatJwt(wallet: ChatWalletSigner): Promise<string> {
  // This function is deprecated - ore-bsm issues its own JWTs
  // Keeping for backwards compatibility but it won't work
  throw new Error(
    'createChatJwt() is deprecated. Use createChatAuth() with chat.createSession() instead. ' +
    'ore.supply requires authentication via their /auth/login endpoint.'
  );
}

/**
 * Base64 encode that works in both browser and Node.js
 * Avoids direct Buffer reference to prevent bundler issues
 */
function base64Encode(str: string): string {
  // Browser: use btoa
  if (typeof btoa === 'function') {
    return btoa(str);
  }
  // Node.js: use Buffer (dynamic to avoid bundler issues)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const BufferClass = (globalThis as { Buffer?: typeof Buffer }).Buffer;
  if (BufferClass) {
    return BufferClass.from(str).toString('base64');
  }
  // Fallback: manual base64 encoding
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  let i = 0;
  while (i < str.length) {
    const a = str.charCodeAt(i++);
    const b = i < str.length ? str.charCodeAt(i++) : 0;
    const c = i < str.length ? str.charCodeAt(i++) : 0;
    const triplet = (a << 16) | (b << 8) | c;
    result += chars[(triplet >> 18) & 0x3f];
    result += chars[(triplet >> 12) & 0x3f];
    result += i > str.length + 1 ? '=' : chars[(triplet >> 6) & 0x3f];
    result += i > str.length ? '=' : chars[triplet & 0x3f];
  }
  return result;
}
