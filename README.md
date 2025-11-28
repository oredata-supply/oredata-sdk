# @oredata/sdk

Early alpha of the official oredata.supply TypeScript client. The package wraps the `/v3` REST API, the instruction-builder endpoints, and now ships with a production-style state engine so partners can mirror the wheel logic without rewriting our backend.

## Status

| Area | Status | Notes |
| --- | --- | --- |
| REST helpers (`fetchState`, `fetchBids`, `buildBid`, `buildClaim`) | ✅ | Handles API-key query params + multi-host failover. |
| State engine (`StateClient`) | ✅ (alpha) | Hybrid REST/SSE transport, winner detection, phase events, rate-limit telemetry. |
| Transaction convenience helpers (`TransactionBuilder`, `RelayClient`) | 🚧 | Planned follow-up milestone. |
| React hooks/examples | 🚧 | Will land once the SDK surface stabilizes. |

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

- `snapshot` – emitted whenever the local store changes (REST poll or SSE diff).
- `frame` – single round update (useful for incremental UI updates).
- `phaseChange` – normalized phase metadata (BETTING/SPINNING/RESULT/IDLE) including server timestamps.
- `winner` / `winnerTimeout` / `resultPhaseEnded` – mirrors orelette.fun’s timing rules (≥4 s spin, 15 s result guard, 25 s timeout).
- `rateLimit` – exposes exponential backoff suggestions when `/v3/state` returns 429.
- `transport` – reports whether REST polling or SSE is active, last success timestamps, and SSE recovery status.
- `metrics` – 5 min rolling REST/SSE telemetry (5 s REST buckets + raw HTTP events + SSE status).

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

See `src/index.ts` for the full API surface. This SDK continues to evolve under Milestone 4 (SDK alpha) of the oredata.supply roadmap. Please report bugs in the repo so we can tighten the API before publishing a public npm tag.

