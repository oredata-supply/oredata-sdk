# Server Multiplexer (`@oredata/sdk/server`)

Server-side multiplexer for games with many concurrent users. Your server polls the API once and broadcasts to all connected clients.

## Why Use This?

| Pattern | API Calls | Best For |
|---------|-----------|----------|
| Direct polling | N users × 2/sec = 200 calls/sec | Prototypes, <10 users |
| **Multiplexer** | 1 poll/sec, broadcast to N | Production, 100+ users |

```
Without multiplexer:          With multiplexer:
                              
[Browser 1] ──┐               [ore-api] 
[Browser 2] ──┼──▶ [ore-api]       │
[Browser N] ──┘                    ▼ (1 req/sec)
                              [Your Server]
N requests/sec                     │
                              ┌────┴────┐
                              ▼         ▼
                          [Browser 1] [Browser N]
                              
                          SSE broadcast to all
```

---

## Quick Start

```typescript
import express from 'express';
import { createMultiplexer, expressSSE } from '@oredata/sdk/server';

const app = express();

// Create multiplexer (polls API, stores state)
const multiplexer = createMultiplexer({
  apiBaseUrl: 'https://ore-api.gmore.fun',
  apiKey: process.env.ORE_API_KEY,
  pollIntervalMs: 1000,
});

// Start polling
multiplexer.start();

// SSE endpoint for clients
app.get('/events', expressSSE(multiplexer));

// Optional: REST endpoint for initial state
app.get('/state', (req, res) => {
  const state = multiplexer.getState();
  res.json(state);
});

app.listen(3000);
```

---

## Client-Side Connection

```typescript
// Browser connects to YOUR server, not ore-api
const eventSource = new EventSource('https://your-game.com/events');

eventSource.addEventListener('snapshot', (e) => {
  const data = JSON.parse(e.data);
  console.log('Full state:', data);
});

eventSource.addEventListener('update', (e) => {
  const data = JSON.parse(e.data);
  console.log('State update:', data);
});

eventSource.addEventListener('winner', (e) => {
  const data = JSON.parse(e.data);
  console.log('Winner!', data);
});
```

Or use the SDK with SSE mode pointing to your server:

```typescript
import { OredataClient } from '@oredata/sdk';

const client = new OredataClient({
  baseUrls: ['https://your-game.com'], // Your server, not ore-api
});

const stateClient = client.getStateClient({
  transport: { mode: 'sse', endpoint: '/events' },
});
```

---

## API Reference

### `createMultiplexer(options)`

```typescript
const multiplexer = createMultiplexer({
  // Required
  apiBaseUrl: 'https://ore-api.gmore.fun',
  apiKey: process.env.ORE_API_KEY,
  
  // Optional
  pollIntervalMs: 1000,        // How often to poll (default: 1000)
  includeBids: true,           // Fetch bid data (default: true)
  
  // Advanced
  onError: (error) => {},      // Error handler
  onStateChange: (state) => {},// State change callback
});
```

### Methods

```typescript
// Lifecycle
multiplexer.start();           // Start polling
multiplexer.stop();            // Stop polling

// State access
multiplexer.getState();        // Current state snapshot
multiplexer.isHealthy();       // API connection status

// Events
multiplexer.on('snapshot', (state) => {});
multiplexer.on('update', (delta) => {});
multiplexer.on('winner', (winner) => {});
multiplexer.on('error', (error) => {});
```

### `expressSSE(multiplexer)`

Express middleware for SSE:

```typescript
app.get('/events', expressSSE(multiplexer, {
  // Optional
  heartbeatMs: 30000,          // Keepalive interval
  headers: {                   // Custom headers
    'X-Custom': 'value',
  },
}));
```

---

## With React Frontend

### Server (Express)

```typescript
import express from 'express';
import cors from 'cors';
import { createMultiplexer, expressSSE } from '@oredata/sdk/server';

const app = express();
app.use(cors());

const multiplexer = createMultiplexer({
  apiBaseUrl: 'https://ore-api.gmore.fun',
  apiKey: process.env.ORE_API_KEY,
});

multiplexer.start();
app.get('/events', expressSSE(multiplexer));
app.get('/api/state', (req, res) => res.json(multiplexer.getState()));

app.listen(4000);
```

### Client (React)

```tsx
import { OredataProvider } from '@oredata/sdk/react';

function App() {
  return (
    <OredataProvider 
      config={{
        baseUrls: ['http://localhost:4000'], // Your server
      }}
      stateConfig={{
        transport: { mode: 'sse', endpoint: '/events' },
      }}
    >
      <Game />
    </OredataProvider>
  );
}
```

---

## Production Setup

### With PM2

```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'ore-multiplexer',
    script: './server.js',
    instances: 1,  // Single instance (one API connection)
    env: {
      ORE_API_KEY: 'your-key',
    },
  }],
};
```

### With Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
CMD ["node", "server.js"]
```

### Health Check

```typescript
app.get('/health', (req, res) => {
  const healthy = multiplexer.isHealthy();
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    lastUpdate: multiplexer.getState()?.timestamp,
  });
});
```

---

## Scaling

### Single Server (Recommended for <1000 users)

```
[ore-api] ──▶ [Your Server] ──SSE──▶ [1000 browsers]
                   │
                   └── Single process, ~50MB RAM
```

### Multiple Servers (1000+ users)

```
[ore-api] ──▶ [Poller Service] ──Redis──▶ [SSE Server 1]
                                     └──▶ [SSE Server 2]
                                     └──▶ [SSE Server N]
```

For Redis pub/sub distribution, see our [advanced examples](https://github.com/oredata-supply/oredata-sdk/tree/main/examples).

---

## See Also

- [Main SDK Docs](../README.md)
- [React Hooks](./REACT.md)
- [API Reference](./API.md)

