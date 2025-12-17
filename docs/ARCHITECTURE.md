# SDK Architecture Overview

> **Read this first!** Understanding the Layer 1 / Layer 2 distinction will save you days of debugging.

---

## The Two-Layer Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         OredataClient                                    │
│                                                                         │
│  ┌─────────────────────────────────┐  ┌─────────────────────────────┐  │
│  │     OredataStore (Layer 1)      │  │   OredataState (Layer 2)    │  │
│  │         DATA EVENTS             │  │       UI TIMING             │  │
│  │                                 │  │                             │  │
│  │  • roundStarted                 │  │  • phaseChange              │  │
│  │  • roundCompleted  ← WINNERS    │  │  • winnerReveal             │  │
│  │  • roundDataUpdated             │  │                             │  │
│  │  • miningStatusChanged          │  │  Fires AFTER delays:        │  │
│  │                                 │  │  - spinDurationMs           │  │
│  │  Fires IMMEDIATELY when         │  │  - resultDisplayMs          │  │
│  │  blockchain data arrives        │  │                             │  │
│  └─────────────────────────────────┘  └─────────────────────────────┘  │
│                                                                         │
│  Also available:                                                        │
│  ┌─────────────────────────────────┐                                    │
│  │  createMultiplexer (Wrapper)    │                                    │
│  │  ⚠️ Simplified, limited         │                                    │
│  │  Use for: SSE broadcasting      │                                    │
│  │  NOT for: Winner detection      │                                    │
│  └─────────────────────────────────┘                                    │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Layer 1: OredataStore (Data Events)

**Use for:** Game logic, state management, critical timing

**When it fires:** Immediately when blockchain data arrives

```typescript
const client = new OredataClient({ ... });
const store = client.getStore();

// ✅ Use these for game logic
store.on('roundStarted', ({ roundId, isHistorical }) => {
  if (isHistorical) return; // Skip cold load replays
  enableBetting();
  setCurrentRound(roundId);
});

store.on('roundCompleted', ({ roundId, winner, isHistorical }) => {
  if (isHistorical) return; // Skip cold load replays
  announceWinner(winner.tile);
  disableBetting();
});

store.on('roundDataUpdated', ({ data, changes }) => {
  if (changes.includes('totals')) {
    updatePotDisplay(data.totals.deployedSol);
  }
});

store.on('miningStatusChanged', ({ status }) => {
  if (status === 'EXPIRED') {
    showSpinAnimation();
  }
});
```

### Layer 1 Events Reference

| Event | When It Fires | Use For |
|-------|---------------|---------|
| `roundStarted` | New round ID detected | Enable betting UI, reset state |
| `roundCompleted` | Winner data available | Show winner, update history |
| `roundDataUpdated` | Bid data changes | Update pot, charts, tile displays |
| `miningStatusChanged` | ACTIVE → EXPIRED | Show "spinning" state |

---

## Layer 2: OredataState (UI Timing)

**Use for:** Animations, transitions, visual effects

**When it fires:** After configurable delays

```typescript
const state = client.createState({
  spinDurationMs: 4000,      // Spin animation length
  resultDisplayMs: 15000,    // How long to show winner
  maxWaitMs: 25000,          // Max wait for winner data
});

// ✅ Use these for UI animations only
state.on('phaseChange', ({ phase }) => {
  // BETTING → SPINNING → RESULT
  updatePhaseIndicator(phase);
});

state.on('winnerReveal', ({ winner, wasLate }) => {
  playWinnerAnimation(winner.tile);
});
```

### When to Use Layer 2

| ✅ Good Use | ❌ Bad Use |
|-------------|-----------|
| Spin animation timing | Enabling/disabling betting |
| Winner celebration | Tracking current round |
| Phase indicator styling | Business logic decisions |

---

## The `isHistorical` Flag

When your app connects, it receives events for rounds that already happened. The `isHistorical` flag tells you if an event is a "replay" from cold load.

```typescript
store.on('roundCompleted', ({ roundId, winner, isHistorical }) => {
  if (isHistorical) {
    // This round finished BEFORE we connected
    // Skip to prevent duplicate announcements
    return;
  }
  
  // This is a LIVE event - show animation
  playWinnerAnimation(winner.tile);
});
```

**Always check `isHistorical`** to avoid:
- Duplicate winner announcements
- Processing old rounds as new
- Confusing UI state on page load

---

## Choose Your Pattern

```
What are you building?
│
├─► Real-time game UI with winner announcements
│   └─► Use: OredataClient + store.on('roundCompleted')
│   └─► Example: See "Complete Game Example" below
│
├─► SSE streaming to multiple browser clients
│   └─► Use: createMultiplexer + expressSSE
│   └─► ⚠️ For bid data streaming only
│   └─► ⚠️ Use OredataClient on backend for winner logic
│
├─► Wallet balance / claimable rewards display
│   └─► Use: MinerClient
│
├─► Client-side bet tracking (local storage)
│   └─► Use: BidTracker
│
├─► Countdown timers
│   └─► Use: getRoundTiming() or useRoundTiming()
│
└─► Token prices (SOL/ORE in USD)
    └─► Use: store.getSolPriceUsd() / store.getOrePriceUsd()
```

---

## Complete Game Example

This is the recommended pattern for a real-time game UI:

```typescript
import { OredataClient } from '@oredata/sdk';
import { Server } from 'socket.io';

// 1. Initialize client
const client = new OredataClient({
  baseUrls: ['https://api.oredata.supply'],
  apiKey: process.env.OREDATA_API_KEY,
  pollIntervalMs: 1000,
});

const store = client.getStore();
const io = new Server(httpServer);

// 2. Layer 1 events for game logic
store.on('roundStarted', ({ roundId, isHistorical }) => {
  if (isHistorical) return;
  
  console.log(`[Game] Round ${roundId} started`);
  io.emit('phase', { phase: 'BETTING', roundId });
});

store.on('roundCompleted', ({ roundId, winner, isHistorical }) => {
  if (isHistorical) return;
  
  console.log(`[Game] Round ${roundId} winner: tile ${winner.tile}`);
  io.emit('winner', {
    roundId,
    tile: winner.tile,
    pot: winner.totalPot,
    motherlode: winner.motherlodeHit,
  });
});

store.on('roundDataUpdated', ({ data, changes }) => {
  if (changes.includes('totals')) {
    io.emit('bids', {
      pot: data.totals.deployedSol,
      miners: data.totals.uniqueMiners,
      tiles: data.perSquare.deployedSol,
    });
  }
});

store.on('miningStatusChanged', ({ status, roundId }) => {
  if (status === 'EXPIRED') {
    io.emit('phase', { phase: 'SPINNING', roundId });
  }
});

// 3. Start polling
client.start();

console.log('[Game] SDK connected, listening for events...');
```

---

## Anti-Patterns (Don't Do This)

### ❌ Parsing frames manually for winners

```typescript
// WRONG: Unreliable, complex, error-prone
multiplexer.on('snapshot', (state) => {
  const previousFrame = state.frames.find(f => f.roundId === previousRoundId);
  const winner = previousFrame?.liveData?.winner;
  if (winner) announceWinner(winner);
});
```

### ✅ Use Layer 1 events

```typescript
// RIGHT: Reliable, simple, immediate
store.on('roundCompleted', ({ winner }) => {
  announceWinner(winner.tile);
});
```

---

### ❌ Using Layer 2 for game logic

```typescript
// WRONG: Layer 2 has timing delays
state.on('phaseChange', ({ phase }) => {
  if (phase === 'BETTING') {
    enableBettingUI(); // May be delayed!
  }
});
```

### ✅ Use Layer 1 for game logic

```typescript
// RIGHT: Layer 1 fires immediately
store.on('roundStarted', () => {
  enableBettingUI(); // Instant
});
```

---

### ❌ Ignoring `isHistorical`

```typescript
// WRONG: Will replay old events on page load
store.on('roundCompleted', ({ winner }) => {
  playWinnerAnimation(winner.tile); // Plays for OLD rounds too!
});
```

### ✅ Always check `isHistorical`

```typescript
// RIGHT: Only animate live events
store.on('roundCompleted', ({ winner, isHistorical }) => {
  if (isHistorical) return;
  playWinnerAnimation(winner.tile);
});
```

---

## Event Payload Reference

### roundStarted

```typescript
interface RoundStartedPayload {
  roundId: string;           // e.g., "74185"
  previousRoundId: string | null;
  isHistorical: boolean;     // true on cold load
}
```

### roundCompleted

```typescript
interface RoundCompletedPayload {
  roundId: string;
  winner: {
    tile: number;            // 0-24
    totalPot: string;        // SOL amount
    motherlodeHit: boolean;
    source: 'optimistic' | 'final';
  };
  wasLate: boolean;          // Arrived after maxWaitMs
  arrivalMs: number;         // ms since round ended
  isHistorical: boolean;
}
```

### roundDataUpdated

```typescript
interface RoundDataUpdatedPayload {
  roundId: string;
  data: {
    perSquare: {
      counts: number[];      // 25 elements (bets per tile)
      deployedSol: number[]; // 25 elements (SOL per tile)
    };
    totals: {
      deployedSol: number;
      uniqueMiners: number;
    };
    mining: {
      status: 'ACTIVE' | 'EXPIRED' | 'UNKNOWN';
      remainingSlots: number | null;
      startSlot: number | null;
      endSlot: number | null;
    };
  };
  changes: Array<'mining' | 'totals' | 'winner'>;
}
```

### miningStatusChanged

```typescript
interface MiningStatusChangedPayload {
  roundId: string;
  status: 'ACTIVE' | 'EXPIRED' | 'UNKNOWN';
  previousStatus: 'ACTIVE' | 'EXPIRED' | 'UNKNOWN';
}
```

---

## Code Examples

Self-contained examples in the SDK's `examples/` folder:

| Example | Description |
|---------|-------------|
| [01-basic-winner-detection.ts](../examples/01-basic-winner-detection.ts) | Simple Layer 1 winner detection |
| [02-backend-game-server.ts](../examples/02-backend-game-server.ts) | Production backend with Socket.IO |
| [03-ui-timing-layer2.ts](../examples/03-ui-timing-layer2.ts) | Layer 2 for UI animations |
| [04-react-game-hook.tsx](../examples/04-react-game-hook.tsx) | React custom hook pattern |
| [05-anti-patterns.ts](../examples/05-anti-patterns.ts) | What NOT to do |

For more extensive examples, see `packages/examples/` in the monorepo.

---

## Next Steps

- [Quick Start](./QUICKSTART.md) — Get running in 5 minutes
- [OredataStore API](./STORE.md) — Full Layer 1 reference
- [React Hooks](./REACT.md) — For React applications
- [Troubleshooting](./TROUBLESHOOTING.md) — Common issues and anti-patterns

