import type { Response } from 'express';
import type { GamePhase } from '../types.js';
import type { StateStoreSnapshot } from '../state/types.js';

/**
 * Configuration options for the multiplexer
 */
export interface MultiplexerOptions {
  // Required
  apiBaseUrl: string;
  apiKey: string;

  // Polling
  pollInterval?: number; // Default: 500ms

  // Transformation (reduce payload size)
  transform?: (snapshot: StateStoreSnapshot) => unknown;

  // Client management
  maxClients?: number; // Default: 1000
  clientTimeout?: number; // Default: 30000ms (no activity)

  // Backpressure
  maxBufferSize?: number; // Default: 10 messages per client
  dropPolicy?: 'oldest' | 'newest'; // Default: 'oldest'

  // Health (optional - most games don't need)
  healthBroadcast?: boolean; // Default: false
  healthInterval?: number; // Default: 5000ms (if enabled)

  // Reconnection (to ore-api)
  maxRetries?: number; // Default: 10
  retryDelay?: number; // Default: 1000ms (with exponential backoff)
}

/**
 * Express SSE middleware options
 */
export interface ExpressSSEOptions {
  headers?: Record<string, string>;
}

/**
 * Client connection state
 */
export interface ClientConnection {
  id: string;
  response: Response;
  connectedAt: number;
  lastActivityAt: number;
}

/**
 * Multiplexer statistics
 */
export interface MultiplexerStats {
  clientCount: number;
  pollCount: number;
  lastPollAt: number | null;
  currentRoundId: string | null;
  currentPhase: GamePhase | null;
  isPolling: boolean;
  errors: number;
}

/**
 * Phase change event
 */
export interface PhaseChangeEvent {
  phase: GamePhase;
  previousPhase: GamePhase;
  roundId: string;
  timestamp: number;
}

/**
 * Winner event
 */
export interface WinnerEvent {
  roundId: string;
  tile: number;
  type: 'optimistic' | 'final';
  timestamp: number;
  mismatch?: boolean;
  optimisticTile?: number;
}

/**
 * Health event
 */
export interface HealthEvent {
  api: 'healthy' | 'degraded' | 'down';
  rpc: 'healthy' | 'degraded' | 'down';
  timestamp: number;
}

/**
 * Multiplexer event types
 */
export interface MultiplexerEvents {
  snapshot: (snapshot: unknown) => void;
  phaseChange: (event: PhaseChangeEvent) => void;
  winner: (event: WinnerEvent) => void;
  health: (event: HealthEvent) => void;
  error: (error: Error) => void;
  clientConnected: (clientId: string) => void;
  clientDisconnected: (clientId: string) => void;
}

