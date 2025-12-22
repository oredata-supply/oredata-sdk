import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { Multiplexer } from './multiplexer.js';
import type { ExpressSSEOptions } from './types.js';

/**
 * Express middleware for SSE connections to the multiplexer
 *
 * Sets up SSE headers, registers client, and handles cleanup on disconnect.
 * Sends current state immediately on connect.
 *
 * @example
 * ```typescript
 * import { createMultiplexer, expressSSE } from '@oredata/sdk/server';
 *
 * const multiplexer = createMultiplexer({
 *   apiBaseUrl: 'https://api.oredata.supply',
 *   apiKey: process.env.OREDATA_API_KEY,
 * });
 *
 * multiplexer.start();
 *
 * // One-liner SSE endpoint
 * app.get('/events', expressSSE(multiplexer));
 *
 * // With options
 * app.get('/events', expressSSE(multiplexer, {
 *   headers: {
 *     'Access-Control-Allow-Origin': '*',
 *   },
 * }));
 * ```
 */
export function expressSSE(multiplexer: Multiplexer, options?: ExpressSSEOptions): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

    // Apply custom headers (e.g., CORS)
    if (options?.headers) {
      for (const [key, value] of Object.entries(options.headers)) {
        res.setHeader(key, value);
      }
    }

    // Disable response timeout
    req.setTimeout(0);
    res.setTimeout(0);

    // Flush headers immediately
    res.flushHeaders();

    // Add client to multiplexer (sends initial state)
    try {
      multiplexer.addClient(res);
    } catch (error) {
      // Max clients reached or other error
      res.status(503).json({
        error: 'Service temporarily unavailable',
        message: error instanceof Error ? error.message : 'Too many connections',
      });
      return;
    }

    // Handle client disconnect
    req.on('close', () => {
      multiplexer.removeClient(res);
    });

    req.on('error', () => {
      multiplexer.removeClient(res);
    });

    // Keep connection open (don't call next() or res.end())
  };
}

