# @oredata/sdk

Official TypeScript client for oredata.supply. Build real-time ORE games with REST API helpers, streaming state engine, wallet tracking, React hooks, and server-side multiplexer.

## Table of Contents

- [Status](#status)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [API Plans & Features](#api-plans--features)
- [Core API](#core-api)
  - [OredataClient](#oredataclient)
  - [StateClient](#stateclient)
  - [MinerClient](#minerclient)
  - [BidTracker](#bidtracker)
- [React Hooks](#react-hooks-oredatasdkreact)
- [Server Multiplexer](#server-multiplexer-oredatasdkserver)
- [Error Handling](#error-handling)
- [Deployment Patterns](#deployment-patterns)
- [Production Best Practices](#production-best-practices)
- [Troubleshooting](#troubleshooting)
- [Changelog](#changelog)

---

## Status

| Area | Status | Notes |
| --- | --- | --- |
| REST helpers (`fetchState`, `fetchBids`, `buildBid`, `buildClaim`) | ✅ | API-key auth + multi-host failover |
| State engine (`StateClient`) | ✅ | REST/SSE transport, winner detection, phase events |
| Miner client (`MinerClient`) | ✅ | Wallet balance + claimable rewards polling |
| Bid tracker (`BidTracker`) | ✅ | Client-side bid tracking with localStorage |
| Server multiplexer (`@oredata/sdk/server`) | ✅ | Single-poll → multi-broadcast for game servers |
| Error classes | ✅ | `OredataLockoutError`, `OredataRateLimitError`, etc. |
| React hooks (`@oredata/sdk/react`) | ✅ | Provider, hooks, error boundary |

---

## Installation

```bash
npm install @oredata/sdk
# or
yarn add @oredata/sdk
# or
pnpm add @oredata/sdk
```

---

## Quick Start

```ts
import { OredataClient } from '@oredata/sdk';

const client = new OredataClient({
  baseUrls: ['https://ore-api.gmore.fun'],
  apiKey: process.env.ORE_API_KEY,
});

// REST helpers
const state = await client.fetchState({ optimized: true });
const bids = await client.fetchBids();

// Real-time state engine
const stateClient = client.getStateClient();

stateClient.on('snapshot', (snapshot) => {
  console.log(`Phase: ${snapshot.phase}, Round: ${snapshot.currentRoundId}`);
});

stateClient.on('winner', ({ roundId, winner, type }) => {
  console.log(`Winner for ${roundId}: tile ${winner} (${type})`);
});

stateClient.on('phaseChange', (phase) => {
  console.log(`Phase changed to: ${phase?.phase}`);
});

await stateClient.start();
```

---

## API Plans & Features

| Plan | Rate Limits | Monthly Quota | Bid Lockout | Winner Delay | Price |
| --- | --- | --- | --- | --- | --- |
| `free` | 2/s, 5/min | Unlimited | 5s before end | 5s embargo | $0 |
| `dev` | 12/s, 600/min | 1M requests | 4s before end | 4s embargo | $9/mo |
| `pro` | 120/s, 10k/min | 50M requests | 3s before end | 3s embargo | $99/mo |
| `ultra` | 240/s, 60k/min | Unlimited | None | Instant | $499/mo |

### Rate Limits & Authentication

- **Per API key, not per IP**: All requests with the same API key share one rate limit pool
- **N browsers = 1 rate limit**: If 100 users use your game, they all share YOUR key's limit
- This is why [server-side multiplexing](#server-multiplexer-oredatasdkserver) is recommended for games

### Bid Lockout

Lower-tier plans cannot submit bids in the final seconds. The `/tx/build/bid` endpoint returns HTTP 423 during lockout.

### Winner Delay (Embargo)

| Plan | Embargo | Behavior |
|------|---------|----------|
| `free` | 5s | Winner hidden until `roundEndTime + 5s` |
| `dev` | 4s | Winner hidden until `roundEndTime + 4s` |
| `pro` | 3s | Winner hidden until `roundEndTime + 3s` |
| `ultra` | 0s | Winner revealed as soon as available |

---

## Core API

### OredataClient

Main entry point for REST API calls.

```ts
import { OredataClient } from '@oredata/sdk';

const client = new OredataClient({
  baseUrls: ['https://ore-api.gmore.fun'],
  apiKey: 'your-api-key',
  
  // Optional configuration
  timeoutMs: 10_000,
  state: {
    pollIntervalMs: 1000,
    historyLimit: 10,
    resultPhaseDurationMs: 15_000,
    winnerTiming: {
      minSpinMs: 4_000,
      maxWaitMs: 25_000,
    },
    transport: { mode: 'rest' }, // 'rest' | 'sse' | 'hybrid'
    quotaPolling: true,
  },
});

// REST methods
const state = await client.fetchState({ optimized: true, frames: 2 });
const bids = await client.fetchBids(roundId);
const bidTx = await client.buildBid({ authority, tiles: [1, 5, 7], amountSol: 0.01 });
const claimTx = await client.buildClaim({ authority });

// Get streaming client
const stateClient = client.getStateClient();
```

### StateClient

Real-time state engine with event-driven updates.

```ts
const stateClient = client.getStateClient();

// Start polling/streaming
await stateClient.start({
  frames: 4,
  sections: ['round', 'globals'],
  optimized: true,
});

// Stop when done
stateClient.stop();
```

#### StateClient Events

| Event | Description |
| --- | --- |
| `snapshot` | Full state update (REST poll or SSE diff) |
| `frame` | Single round update for incremental UI |
| `phaseChange` | Phase transition with timestamps |
| `winner` | Winner detected. Fires **twice**: `type: 'optimistic'` then `type: 'final'` |
| `roundFinalized` | Round complete with confirmed winner (safe to archive) |
| `motherlode` | 🎰 Motherlode jackpot hit! |
| `winnerTimeout` | Winner not received within `maxWaitMs` |
| `resultPhaseEnded` | Result display phase complete |
| `rateLimit` | Backoff suggestions on 429 |
| `transport` | REST/SSE connection status |
| `health` | API/RPC/game health from `/v3/health` |
| `quota` | Rate limit and billing from `/v3/quota` |
| `modeChange` | App mode changed (`'active'` ↔ `'idle'`) |
| `error` | Error during polling/connection |
| `metrics` | 5-min rolling telemetry |

#### Event Examples

```ts
// Winner event (fires twice per round)
stateClient.on('winner', ({ roundId, winner, type, mismatch }) => {
  if (type === 'optimistic') {
    startWheelAnimation(winner);
  } else if (type === 'final') {
    confirmWinner(winner);
    if (mismatch) {
      showCorrectionAnimation(); // Rare: optimistic was wrong
    }
  }
});

// Motherlode event (rare jackpot!)
stateClient.on('motherlode', ({ roundId, tile, amountFormatted }) => {
  triggerJackpotCelebration(tile, amountFormatted);
});

// Round finalized (safe to archive)
stateClient.on('roundFinalized', ({ roundId, winner, confirmed }) => {
  archiveRoundData(roundId);
});

// Rate limit handling
stateClient.on('rateLimit', ({ backoffMs, retryAfter }) => {
  console.log(`Rate limited, retry after ${retryAfter}ms`);
});
```

#### App Mode (Active/Idle)

Reduce API usage when the user isn't actively playing:

```ts
// User opens menu - stop state polling
stateClient.setMode('idle');

// User returns to game - resume
stateClient.setMode('active');

// Check current mode
const mode = stateClient.getMode(); // 'active' | 'idle'
```

| Aspect | `active` | `idle` |
|--------|----------|--------|
| State polling | 1s | ⏹ **Stopped** |
| SSE | Connected | Disconnected |
| Events | ✅ Emitted | ❌ Suppressed |
| Health polling | 5s | 5s (not billed) |
| Quota polling | 5s | 5s (not billed) |

#### Data Staleness

```ts
// Check if data is fresh (>3s old = stale)
if (stateClient.isDataStale()) {
  showStaleDataIndicator();
}

// Get exact age in ms
const ageMs = stateClient.getDataAge();
```

#### Timing Configuration

```ts
const client = new OredataClient({
  state: {
    winnerTiming: {
      minSpinMs: 4_000,   // Minimum spin animation
      maxWaitMs: 25_000,  // Max wait before timeout
    },
    resultPhaseDurationMs: 15_000, // Hold RESULT phase
  },
});
```

| Layer | What it controls |
| --- | --- |
| **Server** (plan-based) | When winner data is *sent* (0–5s after round ends) |
| **Client** (`minSpinMs`) | Minimum spin animation regardless of data arrival |
| **Client** (`resultPhaseDurationMs`) | How long to show result before new bets |

### MinerClient

Track wallet balances and claimable rewards:

```ts
import { MinerClient } from '@oredata/sdk';

const miner = new MinerClient({
  apiBaseUrl: 'https://ore-api.gmore.fun',
  apiKey: 'your-api-key',
  authority: wallet.publicKey.toBase58(),
  pollIntervalMs: 5_000, // Default: 5s
});

miner.on('update', (status) => {
  console.log(`Balance: ${status.authoritySol} SOL`);
  console.log(`Claimable: ${status.claimableSol} SOL`);
  console.log(`Claimable ORE: ${status.claimableOre}`);
});

miner.on('needsCheckpoint', ({ pendingSol }) => {
  console.log(`Pending rewards: ${pendingSol} SOL`);
});

miner.on('error', (error) => {
  console.error('Miner polling error:', error);
});

miner.start();

// Manual refresh
await miner.refresh();

// Get current status
const status = miner.getStatus();

// Stop polling
miner.stop();
```

### BidTracker

Track bids placed through your app with localStorage persistence:

```ts
import { BidTracker, createBidTracker } from '@oredata/sdk';

const tracker = createBidTracker({ 
  persist: true,           // Use localStorage
  storageKey: 'my_bids',   // Custom key
  maxRounds: 50,           // Keep last 50 rounds
});

// Track a bid after successful transaction
tracker.trackBid({
  roundId: '12345',
  tiles: [5, 10, 15],
  amountLamports: '1000000000',
  amountSol: 1.0,
  placedAt: Date.now(),
  txSignature: 'abc123...',
});

// Check if user won
const result = tracker.didIWin('12345', winningTile);
if (result.won) {
  console.log(`Won ${result.winningAmount} SOL!`);
}

// Get bids for current round
const currentBids = tracker.getBidsForRound(roundId);

// Get total bet for a round
const totalBet = tracker.getTotalBet(roundId);

// Clear bids
tracker.clearRound(roundId);
tracker.clearAll();
```

---

## React Hooks (`@oredata/sdk/react`)

Pre-built React hooks that reduce boilerplate from 45 lines to 5 lines.

### Setup

```tsx
import { OredataProvider } from '@oredata/sdk/react';

function App() {
  return (
    <OredataProvider
      config={{
        baseUrls: ['https://ore-api.gmore.fun'],
        apiKey: process.env.ORE_API_KEY,
        state: {
          winnerTiming: { minSpinMs: 4000, maxWaitMs: 25000 },
          resultPhaseDurationMs: 15000,
        },
      }}
      autoStart={true}
    >
      <Game />
    </OredataProvider>
  );
}
```

### `useOredataState()` - Main game state

```tsx
import { useOredataState } from '@oredata/sdk/react';

function Game() {
  const {
    isConnected,
    isLoading,
    phase,        // 'betting' | 'spinning' | 'result' | 'idle'
    roundId,
    pot,          // { totalSol, totalLamports }
    winner,       // { tile, type, roundId } | null
    currentFrame,
    setMode,      // ('active' | 'idle') => void
  } = useOredataState();

  if (!isConnected) return <Connecting />;
  return <GameUI phase={phase} pot={pot} winner={winner} />;
}

// Fine-grained re-renders (only re-render when phase changes)
const { phase } = useOredataState({ select: ['phase'] });
```

### `useMinerAccount()` - Wallet state

```tsx
import { useMinerAccount } from '@oredata/sdk/react';

function WalletPanel() {
  const { publicKey } = useWallet();
  
  const {
    solBalance,
    oreBalance,
    claimableSol,
    claimableOre,
    needsCheckpoint,
    isLoading,
    refresh,
  } = useMinerAccount(publicKey?.toBase58());

  return <ClaimButton amount={claimableSol} onClick={handleClaim} />;
}
```

### `useBidTracker()` - Track user's bids

```tsx
import { useBidTracker } from '@oredata/sdk/react';

function BetHistory() {
  const {
    currentBids,
    totalBet,
    trackBid,
    didIWin,
  } = useBidTracker();

  const handleBidSuccess = (tiles, amount, txSig) => {
    trackBid({
      roundId,
      tiles,
      amountLamports: (amount * 1e9).toString(),
      amountSol: amount,
      placedAt: Date.now(),
      txSignature: txSig,
    });
  };

  return <CurrentBets bids={currentBids} total={totalBet.sol} />;
}
```

### `useOredataEvents()` - Subscribe to events

```tsx
import { useOredataEvents } from '@oredata/sdk/react';

function Celebrations() {
  useOredataEvents({
    onWinner: (event) => {
      if (event.type === 'optimistic') {
        playWinnerAnimation(event.winningSquareIndex);
      }
    },
    onMotherlode: (event) => {
      triggerJackpotCelebration(event.amountFormatted);
    },
    onPhaseChange: (phase) => {
      if (phase?.phase === 'betting') resetUI();
    },
    onRoundFinalized: (event) => {
      saveToHistory(event.roundId);
    },
  });

  return <AnimationContainer />;
}
```

### `OredataErrorBoundary` - Error handling

```tsx
import { OredataProvider, OredataErrorBoundary, ConnectionError } from '@oredata/sdk/react';

function App() {
  return (
    <OredataProvider config={config}>
      <OredataErrorBoundary
        fallback={(error, reset) => (
          <div>
            <p>Error: {error.message}</p>
            <button onClick={reset}>Try Again</button>
          </div>
        )}
        onError={(error) => logToSentry(error)}
      >
        <Game />
      </OredataErrorBoundary>
    </OredataProvider>
  );
}

// Or use the built-in ConnectionError component
<OredataErrorBoundary fallback={<ConnectionError />}>
  <Game />
</OredataErrorBoundary>
```

---

## Server Multiplexer (`@oredata/sdk/server`)

For game servers: single API poll → broadcast to all connected clients.

### Why Use a Multiplexer?

Without multiplexer (Pattern A):
- 100 users × 2 req/s = 200 req/s against YOUR rate limit
- API key exposed in frontend bundle

With multiplexer (Pattern B):
- 1 server × 2 req/s = 2 req/s regardless of user count
- API key hidden on server

### Basic Usage

```ts
import express from 'express';
import { createMultiplexer, expressSSE } from '@oredata/sdk/server';

const app = express();

const multiplexer = createMultiplexer({
  apiBaseUrl: 'https://ore-api.gmore.fun',
  apiKey: process.env.OREDATA_API_KEY,
  pollInterval: 500, // 500ms polling
});

multiplexer.start();

// One-liner Express SSE endpoint
app.get('/events', expressSSE(multiplexer));

app.listen(3000);
```

### Configuration

```ts
const multiplexer = createMultiplexer({
  // Required
  apiBaseUrl: 'https://ore-api.gmore.fun',
  apiKey: process.env.OREDATA_API_KEY,
  
  // Polling
  pollInterval: 500,              // Default: 500ms
  
  // Payload transformation (reduce bandwidth)
  transform: (snapshot) => ({
    phase: snapshot.phase,
    roundId: snapshot.currentRoundId,
    pot: snapshot.currentFrame?.liveData?.pot?.totalSol,
    winner: snapshot.winner,
  }),
  
  // Client management
  maxClients: 1000,               // Default: 1000
  clientTimeout: 30_000,          // Default: 30s no activity
  
  // Backpressure
  maxBufferSize: 10,              // Default: 10 messages
  dropPolicy: 'oldest',           // 'oldest' | 'newest'
  
  // Reconnection
  maxRetries: 10,                 // Default: 10
  retryDelay: 1000,               // Default: 1s with backoff
});
```

### Server-Side Events

```ts
multiplexer.on('snapshot', (snapshot) => {
  console.log(`Round ${snapshot.currentRoundId}`);
});

multiplexer.on('phaseChange', (event) => {
  console.log(`Phase: ${event.previousPhase} → ${event.phase}`);
});

multiplexer.on('winner', (event) => {
  console.log(`Winner: tile ${event.winningSquareIndex}`);
  notifyWinners(event);
});

multiplexer.on('clientConnected', (clientId) => {
  console.log(`Client connected: ${clientId}`);
});

multiplexer.on('clientDisconnected', (clientId) => {
  console.log(`Client disconnected: ${clientId}`);
});

multiplexer.on('error', (error) => {
  console.error('Multiplexer error:', error);
});
```

### Express SSE Options

```ts
app.get('/events', expressSSE(multiplexer, {
  headers: {
    'Access-Control-Allow-Origin': '*', // CORS
  },
}));
```

### Client Message Format

Clients receive SSE events:

```
event: snapshot
data: {"phase":"betting","roundId":"12345","pot":5.5}

event: phaseChange
data: {"phase":"spinning","previousPhase":"betting"}

event: winner
data: {"roundId":"12345","tile":13,"type":"optimistic"}
```

### Browser Client

```ts
// In browser - connect to YOUR server, not ore-api
const eventSource = new EventSource('https://game.example.com/events');

eventSource.addEventListener('snapshot', (e) => {
  const data = JSON.parse(e.data);
  updateGameUI(data);
});

eventSource.addEventListener('winner', (e) => {
  const data = JSON.parse(e.data);
  showWinnerAnimation(data.tile);
});
```

---

## Error Handling

Structured errors for easy handling:

```ts
import {
  OredataLockoutError,
  OredataRateLimitError,
  OredataQuotaExceededError,
  OredataSimulationError,
  OredataNetworkError,
  OredataApiError,
} from '@oredata/sdk';

try {
  await client.buildBid({ authority, tiles, amountSol });
} catch (e) {
  if (OredataLockoutError.is(e)) {
    // Bid too close to round end (HTTP 423)
    console.log(`Locked out for ${e.lockoutSeconds}s`);
    showMessage('Betting closes soon!');
  } else if (OredataRateLimitError.is(e)) {
    // Rate limit exceeded (HTTP 429)
    await sleep(e.retryAfterMs);
  } else if (OredataQuotaExceededError.is(e)) {
    // Billing quota exhausted (HTTP 402)
    alertOpsTeam('API quota exceeded');
  } else if (OredataSimulationError.is(e)) {
    // Transaction simulation failed
    showMessage('Transaction would fail: ' + e.message);
  } else if (OredataNetworkError.is(e)) {
    // Connection failed
    showMessage('Connection error');
  }
}
```

### Error Classes

| Class | HTTP Code | Description |
|-------|-----------|-------------|
| `OredataLockoutError` | 423 | Bid too close to round end |
| `OredataRateLimitError` | 429 | Rate limit exceeded |
| `OredataQuotaExceededError` | 402 | Billing quota exhausted |
| `OredataSimulationError` | 400 | Transaction simulation failed |
| `OredataNetworkError` | - | Connection/network failure |
| `OredataApiError` | varies | Other API errors |

---

## Deployment Patterns

### Pattern A: Direct Client Polling (Simple)

Each browser uses SDK directly with your API key.

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Browser 1  │     │  Browser 2  │     │  Browser N  │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       └───────────────────┼───────────────────┘
                           │
                    All share YOUR
                    API key's rate limit
                           │
                           ▼
              ┌────────────────────────┐
              │   ore-api.gmore.fun    │
              └────────────────────────┘
```

**Pros:** Simple, no server needed  
**Cons:** Rate limit shared, API key exposed  
**Best for:** Prototypes, <10 concurrent users

### Pattern B: Server-Side Multiplexer (Recommended)

Your server polls ore-api once, broadcasts to all clients.

```
              ┌────────────────────────┐
              │   ore-api.gmore.fun    │
              └───────────┬────────────┘
                          │
                   2 req/sec (one connection)
                          │
                          ▼
              ┌────────────────────────┐
              │    Your Game Server    │
              │  - Polls every 500ms   │
              │  - Broadcasts via SSE  │
              │  - Key stays hidden    │
              └───────────┬────────────┘
                          │
                   SSE broadcast
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
   [Browser 1]       [Browser 2]       [Browser N]
```

**Pros:** Efficient rate limit usage, hidden API key, central control  
**Cons:** Requires server infrastructure  
**Best for:** Production games, >10 concurrent users

### Pattern C: Hybrid

Server broadcasts primary data; clients fallback to direct polling if SSE fails.

**Pros:** Best reliability  
**Cons:** More complex  
**Best for:** Mission-critical games

---

## Production Best Practices

### Frame Selection ⚠️

The API returns multiple frames. **Always use the last frame**:

```ts
// ✅ Correct
const current = frames[frames.length - 1];

// ❌ Wrong - finds stale frame
const current = frames.find(f => f.mining?.status === 'active');
```

> **SDK handles this:** `snapshot.currentFrame` is always correct.

### Result Phase Protection

Hold RESULT phase for 15s so users see results:

```ts
const client = new OredataClient({
  state: {
    resultPhaseDurationMs: 15_000,
  },
});
```

### Minimum Spin Duration

Enforce ≥4s spin animation even if winner arrives instantly:

```ts
const client = new OredataClient({
  state: {
    winnerTiming: {
      minSpinMs: 4_000,
    },
  },
});
```

### Phase State Machine

```
betting (active, not expired)
  ↓ mining finished
spinning (waiting for winner, ≥4s animation)
  ↓ winner arrives
result (15s display)
  ↓ protection ends
idle (1-2s gap)
  ↓ next round
betting
```

### Handling Bid Lockout

Show friendly messages, NOT upgrade prompts:

```
✅ Good: "Betting closes in 5 seconds!"
✅ Good: "Place your bets earlier next time!"

❌ Bad: "Upgrade your plan to bet later"
❌ Bad: "Your API key doesn't allow..."
```

The API key is YOURS, not the player's.

### Client-Side History

The API doesn't store per-user history. Implement client-side:

```ts
stateClient.on('winner', (event) => {
  saveRound({
    roundId: event.roundId,
    timestamp: Date.now(),
    winner: event.winningSquareIndex,
    userBids: bidTracker.getBidsForRound(event.roundId),
    userWon: bidTracker.didIWin(event.roundId, event.winningSquareIndex).won,
  });
});
```

---

## Troubleshooting

### "Rate limit exceeded" (429)

- **Cause:** Too many requests from your API key
- **Fix:** Use server-side multiplexer for production apps
- **Quick fix:** Add exponential backoff

### "Bid lockout active" (423)

- **Cause:** Bid submitted too close to round end
- **Fix:** Submit bids earlier, or upgrade plan
- **UX:** Show "Betting closes soon!" message

### Data appears stale

```ts
if (stateClient.isDataStale()) {
  // Check connection
  const status = stateClient.getTransportStatus();
  if (status.restHealthy === false) {
    showReconnecting();
  }
}
```

### SSE connection drops

SSE is experimental. Use REST as primary:

```ts
const client = new OredataClient({
  state: {
    transport: { mode: 'rest' }, // Not 'sse' or 'hybrid'
  },
});
```

### React hooks not updating

Make sure `OredataProvider` wraps your component tree:

```tsx
// ❌ Wrong
function App() {
  const { phase } = useOredataState(); // Error: no provider
  return <Game />;
}

// ✅ Correct
function App() {
  return (
    <OredataProvider config={config}>
      <Game />
    </OredataProvider>
  );
}
```

### MinerClient returns null

The miner PDA doesn't exist until the user places their first bid:

```ts
miner.on('update', (status) => {
  if (!status.exists) {
    showMessage('Place a bid to create your miner account');
  }
});
```

---

## Changelog

### v0.3.0 (Nov 2025)

- **Added:** React Hooks package (`@oredata/sdk/react`)
  - `OredataProvider`, `useOredataState`, `useMinerAccount`, `useBidTracker`, `useOredataEvents`
  - `OredataErrorBoundary` with `ConnectionError` component

### v0.2.0 (Nov 2025)

- **Added:** Server-side Multiplexer (`@oredata/sdk/server`)
- **Added:** `motherlode` event
- **Added:** `roundFinalized` event
- **Added:** MinerClient for wallet tracking
- **Added:** BidTracker for client-side bid persistence
- **Changed:** Winner event now fires twice (`optimistic` then `final`)

### v0.1.0 (Nov 2025)

- Initial release
- `OredataClient` with REST helpers
- `StateClient` with polling/SSE transport
- Error classes

---

## Examples

- `examples/node-cli` – CLI that fetches state, listens for winners
- `examples/react` – Vite dashboard with live phase/winner display

```bash
cd packages/sdk/examples/node-cli
npm install && npm start

cd packages/sdk/examples/react
npm install && npm run dev
```

---

## License

MIT
