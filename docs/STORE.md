# OredataStore (Layer 1) API

> **Pure data layer** — Provides immediate, unfiltered access to on-chain facts.

The `OredataStore` is the foundation of the SDK. It receives API data, parses it, and emits events immediately. No delays, no UI timing — just facts.

## Quick Start

```typescript
import { OredataClient } from '@oredata/sdk';

const client = new OredataClient({ baseUrls: ['https://ore-api.gmore.fun'] });
const store = client.getStore();

// Events fire immediately when data arrives
store.on('roundStarted', ({ roundId }) => console.log(`Round ${roundId} started`));
store.on('roundCompleted', ({ winner }) => console.log(`Winner: tile ${winner.tile}`));

client.start();
```

---

## Events

### `roundStarted`

Fires when a new round ID is first detected.

```typescript
store.on('roundStarted', (payload) => {
  payload.roundId: string;        // e.g. "74006"
  payload.previousRoundId: string | null;
  payload.isHistorical: boolean;  // v0.9.5+
});
```

**`isHistorical` explained:**
- `true` = This round existed when we connected (cold load / page refresh)
- `false` = This round started while we were connected (live)

### `roundCompleted`

Fires when winner data becomes available for a round.

```typescript
store.on('roundCompleted', (payload) => {
  payload.roundId: string;
  payload.winner: WinnerData;
  payload.wasLate: boolean;       // Arrived after maxWaitMs
  payload.arrivalMs: number;      // ms since round ended
  payload.isHistorical: boolean;  // v0.9.5+
});
```

### `roundDataUpdated`

Fires when round data changes (bids, mining status).

```typescript
store.on('roundDataUpdated', (payload) => {
  payload.roundId: string;
  payload.data: RoundData;
  payload.changes: Array<'mining' | 'totals' | 'winner'>;
});
```

### `miningStatusChanged`

Fires when a round's mining status changes.

```typescript
store.on('miningStatusChanged', (payload) => {
  payload.roundId: string;
  payload.status: 'ACTIVE' | 'EXPIRED' | 'UNKNOWN';
  payload.previousStatus: 'ACTIVE' | 'EXPIRED' | 'UNKNOWN';
});
```

---

## Data Access Methods

### Current Round

```typescript
// Get current round ID
const roundId = store.getCurrentRoundId(); // "74006"

// Get current round data
const round = store.getCurrentRound(); // RoundData | null

// Get current slot
const slot = store.getCurrentSlot(); // 259219923
```

### Round History

```typescript
// Get the previous (last completed) round
const prevRound = store.getPreviousRound(); // RoundData | null

// Get recent rounds (most recent first)
const history = store.getRecentRounds(5); // RoundData[]

// Get a specific round by ID
const round = store.getRound("74005"); // RoundData | null

// Get winner for a specific round
const winner = store.getWinner("74005"); // WinnerData | null
```

### Timing Data

```typescript
// Get next round info (if detected during breather)
const nextRound = store.getNextRound(); // { roundId, startSlot } | null

// Get actual network slot duration
const slotMs = store.getSlotDurationMs(); // 385 (ms, fetched from network)
```

### Token Prices

```typescript
// Get real-time SOL price in USD
const solPrice = store.getSolPriceUsd(); // 242.50 | null

// Get real-time ORE price in USD
const orePrice = store.getOrePriceUsd(); // 2.15 | null

// Example: Display pot value in USD
const round = store.getCurrentRound();
if (round && solPrice) {
  const potUsd = round.totalBidsSol * solPrice;
  console.log(`Pot: ${round.totalBidsSol} SOL ($${potUsd.toFixed(2)})`);
}

// Example: Show ORE rewards in USD
const unrefinedOre = 1.234;
if (orePrice) {
  console.log(`Rewards: ${unrefinedOre} ORE ($${(unrefinedOre * orePrice).toFixed(2)})`);
}
```

---

## Use Cases

### Cold Load Detection

Distinguish between rounds you witnessed live vs. rounds that existed before you connected.

```typescript
store.on('roundCompleted', ({ roundId, winner, isHistorical }) => {
  if (isHistorical) {
    // Page was just loaded - winner already known
    // Skip pending UI, go straight to showing winner
    updateUI({ phase: 'RESULT', winner });
  } else {
    // Live event - show animation
    playWinnerAnimation(winner);
  }
});
```

### Check If Winner Already Known

Before showing "waiting for winner" UI:

```typescript
const prevRound = store.getPreviousRound();
if (prevRound?.winner) {
  // Winner already exists - don't show pending state
  showWinner(prevRound.winner);
} else {
  // Winner not yet known - show pending state
  showPending();
}
```

### History Display

```typescript
function RecentWinners() {
  const rounds = store.getRecentRounds(10);
  
  return (
    <ul>
      {rounds
        .filter(r => r.winner)
        .map(r => (
          <li key={r.roundId}>
            Round {r.roundId}: Tile {r.winner!.tile}
          </li>
        ))}
    </ul>
  );
}
```

---

## Type Reference

### RoundData

```typescript
interface RoundData {
  roundId: string;  // Always string!
  
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
    counts: number[];      // 25 elements (0-24)
    deployedSol: number[]; // 25 elements (0-24)
  };
  
  winner: WinnerData | null;
  
  firstSeenAt: number;     // Timestamp when we first saw this round
  lastUpdatedAt: number;
  completedAt: number | null;
}
```

### WinnerData

```typescript
interface WinnerData {
  roundId: string;
  tile: number;           // 0-24 (0-indexed!)
  source: 'optimistic' | 'final';
  confirmedAt: number;
  arrivalMs: number;
  wasLate: boolean;
  motherlodeHit: boolean;
  totalPot: string;       // SOL as string
  winnerCount: number;
}
```

---

## Important: roundId is String

The `roundId` field is always a `string` in the SDK (matching the JSON API response).

```typescript
// ⚠️ WRONG - silent failure
if (payload.roundId === 74006) { ... }  // string vs number = always false

// ✅ CORRECT - string comparison
if (payload.roundId === "74006") { ... }

// ✅ CORRECT - parse when needed
const numericId = parseInt(payload.roundId, 10);
if (numericId > 74000) { ... }
```

**Why string?** The API returns JSON, where numbers are strings. Converting would add overhead and risk precision loss for large round IDs.

---

## Layer 1 vs Layer 2

| Aspect | OredataStore (Layer 1) | OredataState (Layer 2) |
|--------|------------------------|------------------------|
| Purpose | Pure data facts | UI presentation timing |
| Delays | None - immediate | Configurable (spin, result display) |
| Events | `roundStarted`, `roundCompleted` | `phaseChange`, `winnerReveal` |
| Use | Game logic, bots, analytics | UI animations, overlays |

**Recommendation:** Use Layer 1 for core logic, Layer 2 for UI timing.

```typescript
// Layer 1: When can user bet?
store.on('roundStarted', () => setBettingEnabled(true));
store.on('miningStatusChanged', ({ status }) => {
  if (status === 'EXPIRED') setBettingEnabled(false);
});

// Layer 2: UI animations
state.on('winnerReveal', ({ winner }) => playAnimation(winner));
```

