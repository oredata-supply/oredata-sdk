/**
 * Server-side multiplexer for @oredata/sdk
 *
 * Pattern B: Single poll → multi-broadcast
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
 * app.get('/events', expressSSE(multiplexer));
 * ```
 *
 * @packageDocumentation
 */

// Main exports
export { Multiplexer, createMultiplexer } from './multiplexer.js';
export { expressSSE } from './express-sse.js';

// Types
export type {
  MultiplexerOptions,
  MultiplexerStats,
  MultiplexerEvents,
  ExpressSSEOptions,
  PhaseChangeEvent,
  WinnerEvent,
  HealthEvent,
  ClientConnection,
} from './types.js';

// Internal classes (for advanced usage)
export { Broadcaster } from './broadcaster.js';
export { Poller } from './poller.js';
export { ServerStateStore } from './state-store.js';

