# SDK Event Catalog

Complete reference for all events in `@oredata/sdk`.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Layer Summary: Which to Use When](#layer-summary-which-to-use-when)
3. [StateClient Events](#stateclient-events) - Base layer
4. [OredataStore Events](#oredatastore-events) - Layer 1: Data
5. [OredataState Events](#oredatastate-events) - Layer 2: UI
6. [MinerClient Events](#minerclient-events) - Mining accounts
7. [Recommended Patterns](#recommended-patterns)
8. [Troubleshooting](#troubleshooting)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         API Response                             │
│                    GET /v3/state (polling)                       │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                       StateClient                                │
│                    (Base Event Layer)                            │
│  Events: snapshot, winner, phaseChange, connectionChange, etc.  │
└───────────────────────────┬─────────────────────────────────────┘
                            │ feeds via applyApiResponse()
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      OredataStore                                │
│                    (Layer 1 - Data)                              │
│  Events: roundStarted, roundDataUpdated, roundCompleted,        │
│          miningStatusChanged                                     │
└───────────────────────────┬─────────────────────────────────────┘
                            │ subscribes to roundCompleted
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      OredataState                                │
│                    (Layer 2 - UI)                                │
│  Events: phaseChange, winnerReveal, winnerTimeout,              │
│          resultOverlayShow, resultOverlayHide                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Layer Summary: Which to Use When

| Need | Layer | Events | Reliability |
|------|-------|--------|-------------|
| **Market data updates** | OredataStore | `roundDataUpdated` | ✅ Excellent |
| **New round detection** | OredataStore | `roundStarted` | ✅ Excellent |
| **Winner detection (data)** | OredataStore | `roundCompleted` | ✅ Fixed in v0.9.1 |
| **Winner detection (base)** | StateClient | `winner` | ✅ Excellent |
| **Phase changes** | StateClient | `phaseChange` | ✅ Excellent |
| **UI animations** | OredataState | `winnerReveal`, `phaseChange` | ✅ Fixed in v0.9.1 |
| **Connection status** | StateClient | `connectionChange` | ✅ Excellent |
| **Miner account data** | MinerClient | `update` | ✅ Excellent |

### Recommended Combination

```typescript
// MARKET DATA - Use OredataStore (Layer 1)
store.on('roundDataUpdated', ({ data, changes }) => {
  if (changes.includes('totals')) {
    updateCharts(data.perSquare.deployedSol);
  }
});

// WINNER & PHASE - Use StateClient (Base layer)
stateClient.on('winner', (payload) => {
  const tile = payload.winner; // 0-24
  showWinner(tile + 1); // Display as 1-25
});

stateClient.on('phaseChange', (phase) => {
  updatePhase(phase); // BETTING, SPINNING, etc.
});
```

---

## StateClient Events

Access via: `client.getStateClient()` or `useStateClient()` hook

### `snapshot`

Fires on every poll with the complete state.

```typescript
import type { StateStoreSnapshot } from '@oredata/sdk';

stateClient.on('snapshot', (snapshot: StateStoreSnapshot) => {
  // Full state
  snapshot.currentRoundId;      // "abc123"
  snapshot.latestFinalizedRoundId;
  snapshot.frames;              // Map<roundId, RoundFrame>
  snapshot.globals;             // ORE prices, treasury, etc.
});
```

### `winner` ⭐ RECOMMENDED

Fires when winner is detected (once for optimistic, once for final).

```typescript
type WinnerEventPayload = {
  roundId: string;
  winner: number | null;        // 0-24 (null if no winner)
  type: 'optimistic' | 'final'; // Optimistic fires first
  mismatch?: boolean;           // True if final differs from optimistic
  optimisticWinner?: number;    // Previous value if mismatch
};

stateClient.on('winner', (payload) => {
  if (payload.winner !== null) {
    console.log(`Winner: tile ${payload.winner + 1}`);
  }
});
```

### `roundFinalized`

Fires once per round when final confirmation is complete.

```typescript
type RoundFinalizedPayload = {
  roundId: string;
  winner: number | null;
  confirmed: boolean;           // True if confirmed, false if timeout
  mismatch?: boolean;
};

stateClient.on('roundFinalized', (payload) => {
  console.log(`Round ${payload.roundId} finalized: ${payload.confirmed}`);
});
```

### `phaseChange` ⭐ RECOMMENDED

Fires when game phase changes.

```typescript
type PhaseMetadata = {
  phase: 'BETTING' | 'SPINNING' | 'RESULT' | 'MOTHERLODE' | 'IDLE';
  roundId: string | null;
  phaseUntil: string | null;    // ISO timestamp
  phaseReason: string | null;
};

stateClient.on('phaseChange', (phase: PhaseMetadata | null) => {
  if (phase) {
    console.log(`Phase: ${phase.phase}`);
  }
});
```

### `connectionChange`

Fires when connection state changes.

```typescript
type ConnectionState = {
  status: 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';
  error?: Error;
  lastConnected?: number;       // Timestamp
  reconnectAttempt?: number;
};

stateClient.on('connectionChange', (state: ConnectionState) => {
  console.log(`Connection: ${state.status}`);
});
```

### `transport`

Fires when transport status changes (SSE vs polling).

```typescript
type TransportStatus = {
  mode: 'sse' | 'polling' | 'hybrid';
  sseStatus: 'connecting' | 'connected' | 'disconnected' | 'error';
  pollStatus: 'active' | 'idle' | 'error';
  lastPoll: number;
  lastSseEvent: number;
};

stateClient.on('transport', (status: TransportStatus) => {
  console.log(`Transport: ${status.mode}`);
});
```

### `health`

Fires on each health check response.

```typescript
type HealthSnapshot = {
  api: { status: 'healthy' | 'degraded' | 'down' };
  rpc: { providers: Array<{ role: string; status: string }> };
  game: { status: 'active' | 'idle'; roundId: string | null };
};

stateClient.on('health', (snapshot: HealthSnapshot) => {
  console.log(`API: ${snapshot.api.status}`);
});
```

### `quota`

Fires with quota/rate limit info.

```typescript
type QuotaSnapshot = {
  plan: string;
  rateLimit: { requestsPerSecond: number; requestsPerMinute: number };
  usage: { requests: number; period: string };
};

stateClient.on('quota', (snapshot: QuotaSnapshot) => {
  console.log(`Plan: ${snapshot.plan}`);
});
```

### `rateLimit`

Fires when rate limited.

```typescript
type RateLimitEventPayload = {
  retryAfterMs: number;
  endpoint: string;
};

stateClient.on('rateLimit', (payload) => {
  console.log(`Rate limited, retry after ${payload.retryAfterMs}ms`);
});
```

### `error`

Fires on any error.

```typescript
stateClient.on('error', (error: Error) => {
  console.error('Error:', error.message);
});
```

### `motherlode`

Fires when jackpot is hit (rare).

```typescript
type MotherlodeEventPayload = {
  roundId: string;
  winningSquare: number;
  jackpotAmount: string;        // Formatted amount
  jackpotRaw: string;           // Raw lamports
};

stateClient.on('motherlode', (payload) => {
  console.log(`🎉 JACKPOT! ${payload.jackpotAmount}`);
});
```

---

## OredataStore Events

Access via: `client.getStore()` or `useStore()` hook

### `roundStarted`

Fires when a new round ID is first seen.

```typescript
type RoundStartedPayload = {
  roundId: string;
  previousRoundId: string | null;
};

store.on('roundStarted', (payload) => {
  console.log(`New round: ${payload.roundId}`);
});
```

### `roundDataUpdated` ⭐ RECOMMENDED FOR MARKET DATA

Fires on ANY data update for a round.

```typescript
type RoundDataUpdatedPayload = {
  roundId: string;
  data: RoundData;
  changes: Array<'mining' | 'totals' | 'winner'>;
};

type RoundData = {
  roundId: string;
  mining: {
    status: 'ACTIVE' | 'EXPIRED' | 'UNKNOWN';
    startSlot: number | null;
    endSlot: number | null;
    remainingSlots: number | null;
  };
  totals: {
    deployedSol: number;
    uniqueMiners: number;
  };
  perSquare: {
    counts: number[];           // Bid count per tile [25]
    deployedSol: number[];      // SOL per tile [25]
  };
  winner: WinnerData | null;
  firstSeenAt: number;
  lastUpdatedAt: number;
};

store.on('roundDataUpdated', ({ data, changes }) => {
  if (changes.includes('totals')) {
    // Market data changed - update charts!
    updateCharts(data.perSquare.deployedSol);
  }
});
```

### `roundCompleted` ⭐

Fires ONCE when winner becomes available.

> ✅ **Fixed in v0.9.1**: This event now fires reliably when winner data is found in any frame.

```typescript
type RoundCompletedPayload = {
  roundId: string;
  winner: WinnerData;
  wasLate: boolean;             // True if arrived after maxWaitMs
  arrivalMs: number;            // ms since round ended
};

type WinnerData = {
  roundId: string;
  tile: number;                 // 0-24 (add +1 for display)
  source: 'optimistic' | 'final';
  confirmedAt: number;
  arrivalMs: number;
  wasLate: boolean;
  motherlodeHit: boolean;
  motherlodeRaw: string | null;
  motherlodeFormatted: string | null;
  totalPot: string;
  winnerCount: number;
};

store.on('roundCompleted', (payload) => {
  console.log(`Round ${payload.roundId} winner: tile ${payload.winner.tile + 1}`);
});
```

### `miningStatusChanged`

Fires when mining status changes (ACTIVE → EXPIRED).

```typescript
type MiningStatusChangedPayload = {
  roundId: string;
  status: 'ACTIVE' | 'EXPIRED' | 'UNKNOWN';
  previousStatus: 'ACTIVE' | 'EXPIRED' | 'UNKNOWN';
};

store.on('miningStatusChanged', (payload) => {
  console.log(`Mining: ${payload.previousStatus} → ${payload.status}`);
});
```

---

## OredataState Events

Access via: `client.createState(config)` or `usePresenter()` hook

### `phaseChange`

Fires when DISPLAY phase changes (with timing logic applied).

```typescript
type PhaseChangePayload = {
  phase: 'BETTING' | 'SPINNING' | 'RESULT' | 'IDLE';
  previousPhase: 'BETTING' | 'SPINNING' | 'RESULT' | 'IDLE';
  roundId: string | null;
};

state.on('phaseChange', (payload) => {
  console.log(`Phase: ${payload.previousPhase} → ${payload.phase}`);
});
```

### `winnerReveal` ⭐

Fires when winner should be revealed (after spin animation).

> ✅ **Fixed in v0.9.1**: Now works reliably after `roundCompleted` fix.

```typescript
type WinnerRevealPayload = {
  roundId: string;
  winner: number;               // 0-24 (add +1 for display)
  wasLate: boolean;
  arrivalMs: number;
};

state.on('winnerReveal', (payload) => {
  const displayTile = payload.winner + 1;
  showWinner(displayTile);
});
```

### `winnerTimeout`

Fires when winner not received within maxWaitMs.

```typescript
type WinnerTimeoutPayload = {
  roundId: string;
  elapsed: number;
  reason: 'timeout' | 'round_changed';
};

state.on('winnerTimeout', (payload) => {
  console.log(`Winner timeout for ${payload.roundId}`);
});
```

### `resultOverlayShow`

Fires when result overlay should appear.

```typescript
type ResultOverlayShowPayload = {
  roundId: string;
  winner: number;               // 0-24 (add +1 for display)
};

state.on('resultOverlayShow', (payload) => {
  showOverlay(payload.winner + 1);
});
```

### `resultOverlayHide`

Fires when result overlay should hide.

```typescript
state.on('resultOverlayHide', () => {
  hideOverlay();
});
```

---

## MinerClient Events

Access via: `client.createMiner(walletAddress)` or `useMinerAccount()` hook

### `update`

Fires when miner data updates.

```typescript
type MinerStatus = {
  address: string;
  exists: boolean;
  
  // Claimable rewards
  claimableSol: number | null;
  claimableLamports: string | null;
  
  // ORE rewards
  unrefinedOre: number | null;
  refinedOre: number | null;
  authorityOre: number;
  
  // Round participation
  currentRoundId: string | null;
  lastCheckpointRoundId: string | null;
  isActive: boolean;
  
  // Timestamps
  lastUpdated: number;
};

minerClient.on('update', (status: MinerStatus) => {
  console.log(`Claimable: ${status.claimableSol} SOL`);
});
```

### `rewardsChanged`

Fires when claimable SOL rewards change.

```typescript
minerClient.on('rewardsChanged', (payload) => {
  console.log(`Rewards: ${payload.previous} → ${payload.current}`);
});
```

### `oreRewardsChanged`

Fires when ORE rewards change.

```typescript
minerClient.on('oreRewardsChanged', (payload) => {
  console.log(`Unrefined: ${payload.previousUnrefined} → ${payload.currentUnrefined}`);
  console.log(`Refined: ${payload.previousRefined} → ${payload.currentRefined}`);
});
```

### `needsCheckpoint`

Fires when miner has pending rewards to checkpoint.

```typescript
minerClient.on('needsCheckpoint', (payload) => {
  console.log(`Pending: ${payload.pendingSol} SOL`);
});
```

---

## Recommended Patterns

### Pattern 1: Hybrid Approach (Recommended)

Use OredataStore for market data + StateClient for winner/phase:

```typescript
import { OredataClient } from '@oredata/sdk';

const client = new OredataClient({ pollIntervalMs: 1000 });
const store = client.getStore();
const stateClient = client.getStateClient();

// MARKET DATA - Use Store
store.on('roundStarted', ({ roundId }) => {
  console.log(`New round: ${roundId}`);
  resetCharts();
});

store.on('roundDataUpdated', ({ data, changes }) => {
  if (changes.includes('totals')) {
    updateCharts(data.perSquare.deployedSol);
  }
});

// WINNER - Use StateClient (most reliable)
stateClient.on('winner', (payload) => {
  if (payload.winner !== null) {
    setWinner(payload.winner + 1); // Display as 1-25
  }
});

// PHASE - Use StateClient
stateClient.on('phaseChange', (phase) => {
  if (phase) setPhase(phase.phase);
});

// Start
stateClient.start();
```

### Pattern 2: React Integration

```tsx
import { 
  OredataProvider, 
  useStore, 
  useOredataState,
  useOredataEvents 
} from '@oredata/sdk/react';

function App() {
  return (
    <OredataProvider config={{ 
      baseUrls: ['https://ore-api.gmore.fun'],
      pollIntervalMs: 1000 
    }}>
      <Game />
    </OredataProvider>
  );
}

function Game() {
  // Layer 1: Raw data for charts
  const { currentRound, winnerHistory } = useStore();
  
  // Base layer: State with winner
  const { phase, winner, isConnected } = useOredataState();
  
  // Event handlers for side effects
  useOredataEvents({
    onWinner: (payload) => {
      if (payload.winner !== null) {
        playWinSound();
      }
    }
  });

  return (
    <div>
      <h1>Phase: {phase}</h1>
      <h2>Pot: {currentRound?.totals.deployedSol} SOL</h2>
      {winner && <p>Winner: Tile {winner.winner + 1}</p>}
    </div>
  );
}
```

---

## Troubleshooting

### "No market data updates during BETTING"

**Problem**: Charts only show initial data, no live updates.

**Solution**: Use `store.on('roundDataUpdated')` with changes check:

```typescript
store.on('roundDataUpdated', ({ data, changes }) => {
  if (changes.includes('totals') && data.perSquare) {
    updateCharts(data.perSquare.deployedSol);
  }
});
```

### "Winner event not firing" (Fixed in v0.9.1)

**Problem**: `store.on('roundCompleted')` never fires.

**Solution (v0.9.0 and earlier)**: Use `stateClient.on('winner')` as fallback.

**v0.9.1+**: Both work reliably now!

```typescript
// ✅ Both work in v0.9.1+
store.on('roundCompleted', ({ winner }) => {
  console.log(`Winner: tile ${winner.tile}`);
});

stateClient.on('winner', (payload) => {
  console.log(`Winner: tile ${payload.winner}`);
});
```

### "Phase changes but I need phase duration"

**Problem**: SDK provides phase changes but not durations.

**Current workaround**: Use known constants:
- BETTING: ~60 seconds
- SPINNING: ~5 seconds
- RESULT: ~10-15 seconds

**Future**: See [RFC-SDK-TIMING-COUNTDOWN.md](../../../docs/RFC-SDK-TIMING-COUNTDOWN.md) for planned timing features.

### "TypeScript error on event names"

**Problem**: `Argument of type '"update"' is not assignable...`

**Cause**: The `update` or `roundUpdate` events don't exist. Use documented events:

```typescript
// ❌ Doesn't exist
stateClient.on('update', ...);
stateClient.on('roundUpdate', ...);

// ✅ Use these instead
stateClient.on('snapshot', ...);       // Full state on each poll
store.on('roundDataUpdated', ...);     // Per-round data changes
```

### "Winner payload inconsistency"

**Problem**: Winner tile comes as different field names.

**Current payload** (standardized):

```typescript
// StateClient winner event
stateClient.on('winner', (payload) => {
  payload.winner;        // number (0-24) or null
  payload.roundId;       // string
  payload.type;          // 'optimistic' | 'final'
});

// OredataStore roundCompleted
store.on('roundCompleted', (payload) => {
  payload.winner.tile;   // number (0-24)
  payload.roundId;       // string
});

// OredataState winnerReveal
state.on('winnerReveal', (payload) => {
  payload.winner;        // number (0-24)
  payload.roundId;       // string
});
```

---

## Changelog

| Date | Change |
|------|--------|
| 2025-12-02 | v0.9.1: `roundCompleted` bug fixed, all events now reliable |
| 2025-12-02 | Initial catalog based on orepump team feedback |

