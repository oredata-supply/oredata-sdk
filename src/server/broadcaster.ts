import { EventEmitter } from 'eventemitter3';
import type { Response } from 'express';
import type { ClientConnection, MultiplexerOptions } from './types.js';

function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

interface BroadcasterEvents {
  clientConnected: (clientId: string) => void;
  clientDisconnected: (clientId: string) => void;
}

/**
 * Manages SSE client connections and message broadcasting
 */
export class Broadcaster extends EventEmitter<BroadcasterEvents> {
  private clients = new Map<string, ClientConnection>();
  private responseToId = new Map<Response, string>();
  private readonly maxClients: number;
  private readonly maxBufferSize: number;
  private readonly dropPolicy: 'oldest' | 'newest';
  private readonly clientTimeout: number;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(options: MultiplexerOptions) {
    super();
    this.maxClients = options.maxClients ?? 1000;
    this.maxBufferSize = options.maxBufferSize ?? 10;
    this.dropPolicy = options.dropPolicy ?? 'oldest';
    this.clientTimeout = options.clientTimeout ?? 30000;

    // Start cleanup interval
    this.cleanupInterval = setInterval(() => this.cleanupStaleClients(), 10000);
  }

  /**
   * Add a new client connection
   */
  addClient(res: Response, initialState?: unknown): string {
    // Check max clients
    if (this.clients.size >= this.maxClients) {
      throw new Error(`Max clients (${this.maxClients}) reached`);
    }

    const clientId = generateId();
    const now = Date.now();

    const client: ClientConnection = {
      id: clientId,
      response: res,
      connectedAt: now,
      lastActivityAt: now,
    };

    this.clients.set(clientId, client);
    this.responseToId.set(res, clientId);

    // Send initial state immediately if available
    if (initialState !== undefined) {
      this.sendToClient(client, 'snapshot', initialState);
    }

    this.emit('clientConnected', clientId);
    return clientId;
  }

  /**
   * Remove a client by ID
   */
  removeClient(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      this.responseToId.delete(client.response);
      this.clients.delete(clientId);
      this.emit('clientDisconnected', clientId);
    }
  }

  /**
   * Remove a client by response object
   */
  removeClientByResponse(res: Response): void {
    const clientId = this.responseToId.get(res);
    if (clientId) {
      this.removeClient(clientId);
    }
  }

  /**
   * Send a message to a specific client
   */
  private sendToClient(client: ClientConnection, event: string, data: unknown): boolean {
    try {
      const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      client.response.write(message);
      client.lastActivityAt = Date.now();
      return true;
    } catch {
      // Client likely disconnected
      this.removeClient(client.id);
      return false;
    }
  }

  /**
   * Broadcast a message to all connected clients
   */
  broadcast(event: string, data: unknown): number {
    let successCount = 0;
    const failedClients: string[] = [];

    for (const [id, client] of this.clients) {
      try {
        const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        client.response.write(message);
        client.lastActivityAt = Date.now();
        successCount++;
      } catch {
        // Client disconnected
        failedClients.push(id);
      }
    }

    // Clean up failed clients
    for (const id of failedClients) {
      this.removeClient(id);
    }

    return successCount;
  }

  /**
   * Send a keep-alive ping to all clients
   */
  ping(): void {
    const comment = `: ping ${Date.now()}\n\n`;
    const failedClients: string[] = [];

    for (const [id, client] of this.clients) {
      try {
        client.response.write(comment);
      } catch {
        failedClients.push(id);
      }
    }

    for (const id of failedClients) {
      this.removeClient(id);
    }
  }

  /**
   * Clean up stale clients (no activity for clientTimeout)
   */
  private cleanupStaleClients(): void {
    const now = Date.now();
    const staleClients: string[] = [];

    for (const [id, client] of this.clients) {
      if (now - client.lastActivityAt > this.clientTimeout) {
        staleClients.push(id);
      }
    }

    for (const id of staleClients) {
      this.removeClient(id);
    }
  }

  /**
   * Get number of connected clients
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Close all client connections
   */
  closeAll(): void {
    for (const [id, client] of this.clients) {
      try {
        client.response.end();
      } catch {
        // Ignore errors during cleanup
      }
    }
    this.clients.clear();
    this.responseToId.clear();
  }

  /**
   * Stop the broadcaster and cleanup
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.closeAll();
  }
}

