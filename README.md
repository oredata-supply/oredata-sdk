# @oredata/sdk

Official TypeScript client for oredata.supply. Provides REST API helpers, real-time state engine, wallet tracking, and server-side multiplexer for building ORE games.

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

## Installation

```bash
npm install @oredata/sdk
# or
yarn add @oredata/sdk
```

## Quick start

```ts
import { OredataClient } from '@oredata/sdk';

const client = new OredataClient({
  baseUrls: ['https://ore-api.gmore.fun'],
  apiKey: process.env.ORE_API_KEY,
  state: {
    // keep REST-first until SSE pauses are resolved
    transport: { mode: 'rest' },
    historyLimit: 10,
    
    // UI timing configuration
    winnerTiming: {
      minSpinMs: 4_000,   // Minimum spin animation before revealing winner
      maxWaitMs: 25_000,  // Max wait for winner before timeout
    },
    resultPhaseDurationMs: 15_000, // Hold RESULT phase for animations
  },
});

const restState = await client.fetchState({ optimized: true });
const bids = await client.fetchBids();

const stateClient = client.getStateClient();
stateClient.on('snapshot', (snapshot) => {
  console.log('frames (REST/SSE mix):', snapshot.order.length);
});
stateClient.on('frame', (frame) => {
  console.log('round frame updated', frame.roundId);
});
stateClient.on('winner', ({ roundId, winner, type }) => {
  console.log(`winner for ${roundId}: ${winner} (${type})`);
});
stateClient.on('transport', (status) => {
  console.log('transport status', status);
});

await stateClient.start({
  frames: 4,
  sections: ['round', 'globals'],
  optimized: true,
});

// Note: API keys are always appended as query parameters (no headers) to keep browser clients preflight-free.
```

### `StateClient` events

| Event | Description |
| --- | --- |
| `snapshot` | Emitted whenever the local store changes (REST poll or SSE diff) |
| `frame` | Single round update (useful for incremental UI updates) |
| `phaseChange` | Normalized phase metadata (BETTING/SPINNING/RESULT/IDLE) with timestamps |
| `winner` | Winner detected. Fires **twice**: `type: 'optimistic'` then `type: 'final'` |
| `roundFinalized` | Round complete with confirmed winner (or timeout). Safe to archive. |
| `motherlode` | 🎰 **Motherlode jackpot hit!** Includes `tile`, `amountRaw`, `amountFormatted` |
| `winnerTimeout` | Winner not received within `maxWaitMs` |
| `resultPhaseEnded` | Result display phase complete, ready for next round |
| `rateLimit` | Backoff suggestions when `/v3/state` returns 429 |
| `transport` | REST/SSE status, success timestamps, recovery status |
| `health` | API/RPC/game health status from `/v3/health` |
| `quota` | Rate limit and billing usage from `/v3/quota` |
| `modeChange` | App mode changed (`'active'` ↔ `'idle'`) |
| `error` | Error occurred during polling/connection |
| `metrics` | 5 min rolling REST/SSE telemetry |

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
  console.log(`🎰 MOTHERLODE! Tile ${tile} won ${amountFormatted}`);
});

// Round finalized (safe to archive)
stateClient.on('roundFinalized', ({ roundId, winner, confirmed }) => {
  archiveRoundData(roundId);
});
```

SSE remains opt-in. Set `state.transport.mode` to `'hybrid'` or `'sse'` once the pauses tracked in `docs/SSE_STATUS_AND_ROADMAP.md` are resolved in production.

### Winner & spin timing configuration

The SDK allows you to configure timing parameters independently of the server's plan-based winner delay:

```ts
const client = new OredataClient({
  state: {
    winnerTiming: {
      // Minimum time to show "spinning" animation before revealing winner.
      // Even if winner data arrives early, the SDK waits until this duration
      // has passed since the round started spinning.
      minSpinMs: 4_000,  // default: 4000 (4 seconds)
      
      // Maximum time to wait for winner data before emitting 'winnerTimeout'.
      // After this, the SDK gives up and emits a timeout event.
      maxWaitMs: 25_000, // default: 25000 (25 seconds)
    },
    
    // How long to hold the RESULT phase after winner is revealed.
    // This prevents the UI from immediately jumping to the next round's
    // BETTING phase, giving users time to see the result.
    resultPhaseDurationMs: 15_000, // default: 15000 (15 seconds)
  },
});
```

**Timing diagram:**

```
Round ends (mining finished)
│
├── minSpinMs ────────────────────┐
│   (minimum spin animation)      │
│                                 ▼
│   Winner data arrives ─────► waitForWinner() resolves
│                                 │
│                                 ▼
│                           'winner' event emitted
│                                 │
│                                 ▼
├── resultPhaseDurationMs ───────┐
│   (hold RESULT phase)          │
│                                ▼
│                          'resultPhaseEnded' event
│                                │
│                                ▼
└────────────────────────► Ready for next round
```

**Server vs. client delays:**

| Layer | What it controls |
| --- | --- |
| **Server** (plan-based) | When winner data is *sent* to the client (0–5s after round ends) |
| **Client** (`minSpinMs`) | Minimum spin animation regardless of when data arrives |
| **Client** (`resultPhaseDurationMs`) | How long to show result before allowing new bets |

This separation lets you tune the UX independently of your API plan tier.

### App mode (active/idle)

The SDK supports an **app mode** concept for game/app developers who need to reduce API usage when the user isn't actively playing:

```ts
const stateClient = client.getStateClient();

// User opens settings/menu - stop state polling
stateClient.setMode('idle');

// User returns to game - resume full speed
stateClient.setMode('active');

// Check current mode
const mode = stateClient.getMode(); // 'active' | 'idle'

// Listen for mode changes
stateClient.on('modeChange', (mode) => {
  console.log('App mode changed to:', mode);
});
```

**Behavior by mode:**

| Aspect | `active` | `idle` |
|--------|----------|--------|
| State polling | 1s (configurable) | ⏹ **Stopped** |
| SSE | Connected | Disconnected |
| Frame/phase/winner events | ✅ Emitted | ❌ Suppressed |
| Health polling | 5s | 5s (not billed) |
| Quota polling | 5s (not billed) | 5s (not billed) |
| Data staleness | Fresh (<3s old) | **Always stale** |

In **idle mode**, state polling is **completely stopped** to eliminate billable API usage. Health and quota continue polling for monitoring purposes, but these endpoints are **not billed**.

#### Disabling quota polling

If you don't need quota monitoring, you can disable it entirely:

```ts
const client = new OredataClient({
  state: {
    quotaPolling: false, // Disable quota/billing tracking
  },
});
```

#### Data staleness

Due to the fast-paced nature of the game (400ms slots), data is considered stale if it's more than 3 seconds old:

```ts
// Check if data is fresh
if (stateClient.isDataStale()) {
  showStaleDataIndicator();
}

// Get exact data age in milliseconds
const ageMs = stateClient.getDataAge(); // null if never updated

// The snapshot also includes staleness info
const snapshot = stateClient.getSnapshot();
console.log(snapshot.lastUpdatedAt); // ms timestamp or null
console.log(snapshot.dataAgeMs);     // ms since last update or null
console.log(snapshot.isStale);       // true if >3s old OR in idle mode
```

**Important:** In idle mode, `isDataStale()` always returns `true` since no updates are happening.

#### Recommended UI patterns

```tsx
// React example
function GameView() {
  const mode = stateClient.getMode();
  const isStale = stateClient.isDataStale();
  
  if (mode === 'idle') {
    return <PausedOverlay onResume={() => stateClient.setMode('active')} />;
  }
  
  if (isStale) {
    // Connection issues - data >3s old
    return <StaleDataWarning />;
  }
  
  return <LiveGameView />;
}
```

Transport metrics are enabled by default; configure them via `state.metrics`:

```ts
const client = new OredataClient({
  state: {
    metrics: {
      enabled: true,
      bucketSizeMs: 5_000, // REST buckets (defaults to 5s)
      historyWindowMs: 5 * 60_000, // retention window (defaults to 5 minutes)
    },
  },
});
```

### Examples

- `examples/node-cli` – CLI that fetches `/v3/state`, listens for live frames, and blocks until a winner is revealed.  
  ```bash
  cd packages/oredata-sdk/examples/node-cli
  npm install
  cp env.example .env
  npm start
  ```
- `examples/react` – Vite-powered dashboard that renders phase/transport/winner info directly in the browser (REST-first).  
  ```bash
  cd packages/oredata-sdk/examples/react
  npm install
  cp env.example .env
  npm run dev
  ```

## MinerClient

Track wallet balances and claimable rewards:

```ts
import { MinerClient } from '@oredata/sdk';

const miner = new MinerClient({
  apiBaseUrl: 'https://ore-api.gmore.fun',
  apiKey: 'your-api-key',
  authority: wallet.publicKey.toBase58(),
});

miner.on('update', (status) => {
  console.log(`Balance: ${status.authoritySol} SOL`);
  console.log(`Claimable: ${status.claimableSol} SOL`);
});

miner.on('needsCheckpoint', ({ pendingSol }) => {
  console.log(`Pending rewards: ${pendingSol} SOL`);
});

miner.start();
```

## BidTracker

Track bids placed through your app with localStorage persistence:

```ts
import { BidTracker } from '@oredata/sdk';

const tracker = new BidTracker({ persist: true });

// Track a bid
tracker.trackBid({
  roundId: '12345',
  tiles: [5, 10, 15],
  amountLamports: '1000000000',
  amountSol: 1.0,
  placedAt: Date.now(),
});

// Check if user won
const result = tracker.didIWin('12345', winningTile);
if (result.won) {
  console.log('You won!');
}
```

## Server-Side Multiplexer

For game servers: single API poll → broadcast to all connected clients.

```ts
import { createMultiplexer, expressSSE } from '@oredata/sdk/server';

const multiplexer = createMultiplexer({
  apiBaseUrl: 'https://ore-api.gmore.fun',
  apiKey: process.env.OREDATA_API_KEY,
  pollInterval: 500,
});

multiplexer.start();

// One-liner Express SSE endpoint
app.get('/events', expressSSE(multiplexer));
```

See `@oredata/sdk/server` for full multiplexer documentation.

## Error Classes

Structured errors for easy handling:

```ts
import { OredataLockoutError, OredataRateLimitError } from '@oredata/sdk';

try {
  await client.buildBidInstructions({ ... });
} catch (e) {
  if (OredataLockoutError.is(e)) {
    console.log(`Locked out for ${e.lockoutSeconds}s`);
  } else if (OredataRateLimitError.is(e)) {
    await sleep(e.retryAfterMs);
  }
}
```

Available error classes:
- `OredataLockoutError` - Bid too close to round end (HTTP 423)
- `OredataRateLimitError` - Rate limit exceeded (HTTP 429)
- `OredataSimulationError` - Transaction simulation failed
- `OredataQuotaExceededError` - Billing quota exhausted (HTTP 402)
- `OredataNetworkError` - Connection failed
- `OredataApiError` - Other API errors

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
    claimableSol,
    needsCheckpoint,
    isLoading,
    refresh,
  } = useMinerAccount(publicKey?.toBase58());

  return <ClaimButton amount={claimableSol} />;
}
```

### `useBidTracker()` - Track user's bids

```tsx
import { useBidTracker } from '@oredata/sdk/react';

function BetHistory() {
  const { currentBids, totalBet, trackBid, didIWin } = useBidTracker();

  // Track a bid after successful transaction
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
  });

  return <AnimationContainer />;
}
```

### `OredataErrorBoundary` - Error handling

```tsx
import { OredataProvider, OredataErrorBoundary } from '@oredata/sdk/react';

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
      >
        <Game />
      </OredataErrorBoundary>
    </OredataProvider>
  );
}
```

## License

MIT

