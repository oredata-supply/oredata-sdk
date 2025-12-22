# OredataStore (Layer 1) API

> **Pure data layer** — Provides immediate, unfiltered access to on-chain facts.

The `OredataStore` is the foundation of the SDK. It receives API data, parses it, and emits events immediately. No delays, no UI timing — just facts.

## Quick Start

```typescript
import { OredataClient } from '@oredata/sdk';

const client = new OredataClient({ baseUrls: ['https://api.oredata.supply'] });
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
  payload.updatedAt: number;         // v0.12.1+ - timestamp when update was received
  payload.platformFeeRate: number | null;  // v0.12.37+ - current surge pricing rate
});

// Track data freshness:
store.on('roundDataUpdated', ({ updatedAt }) => {
  const ageMs = Date.now() - updatedAt;
  if (ageMs > 5000) showStaleWarning();
});

// React to fee changes:
store.on('roundDataUpdated', ({ platformFeeRate }) => {
  if (platformFeeRate !== null) {
    const percent = (platformFeeRate * 100).toFixed(2);
    feeIndicator.textContent = `Fee: ${percent}%`;
  }
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

### Platform Fee Rate (Surge Pricing)

```typescript
// Get current platform fee rate (updated each poll)
const feeRate = store.getPlatformFeeRate(); // 0.0025 - 0.03 | null

if (feeRate !== null) {
  const percent = (feeRate * 100).toFixed(2);
  console.log(`Current platform fee: ${percent}%`);
}

// Fee schedule (as of Dec 2025):
// >15s remaining:    0.25% (base)
// 15s - 12.5s:       0.50%
// 12.5s - 10s:       1.00%
// 10s - 7.5s:        1.50%
// 7.5s - 5s:         2.00%
// 5s - 2.5s:         2.50%
// ≤2.5s remaining:   3.00% (max)
```

This is the **Single Source of Truth** (SSOT) for fee display. Use this instead of calculating fees client-side from timing — the API computes it based on slot timing at query time.

**Minimum fee:** $0.01 USD per transaction (available as `platformFeeMinUsd` in API responses).

### Phase Durations (Progress Animations)

The API provides expected phase durations for smooth progress bar animations:

```typescript
// Available in GET /v3/state optimized response
optimized: {
  phase: 'SPINNING',
  phaseSince: '2025-12-15T20:30:00.000Z',
  phaseDurations: {
    spinningMs: 15000,  // ~15s avg for winner reveal (varies!)
    resultMs: 8000,     // Time showing winner
    breatherMs: 5000,   // Gap between rounds
  }
}
```

**Usage for progress bars:**

```typescript
function getPhaseProgress(optimized: OptimizedState): number {
  const { phase, phaseSince, phaseUntil, phaseDurations } = optimized;
  if (!phaseSince) return 0;
  
  const elapsed = Date.now() - new Date(phaseSince).getTime();
  
  switch (phase) {
    case 'BETTING':
      // Use exact timing from phaseUntil
      if (!phaseUntil) return 0;
      const total = new Date(phaseUntil).getTime() - new Date(phaseSince).getTime();
      return Math.min(1, elapsed / total);
      
    case 'SPINNING':
      // Estimate only - winner arrival is unpredictable!
      // Consider showing indeterminate progress or "Revealing..."
      return Math.min(0.95, elapsed / phaseDurations.spinningMs);
      
    case 'RESULT':
      return Math.min(1, elapsed / phaseDurations.resultMs);
      
    case 'IDLE':
      // Breather between rounds
      return Math.min(1, elapsed / phaseDurations.breatherMs);
  }
}
```

**Important:** SPINNING phase duration is **unpredictable** (depends on entropy oracle). The provided `spinningMs` is an estimate for UI purposes only.

### Smart Bid Presets (Bid Distribution)

The API provides bid size percentiles for smart bid buttons:

```typescript
const round = store.getCurrentRound();
const dist = round?.bidDistributionGlobal;

if (dist) {
  // Build smart bid presets
  const presets = [
    { label: 'Top 50%', lamports: BigInt(dist.p50Lamports) },
    { label: 'Top 20%', lamports: BigInt(dist.p80Lamports) },
    { label: 'Top 10%', lamports: BigInt(dist.p90Lamports) },
    { label: 'Top 5%',  lamports: BigInt(dist.p95Lamports) },
    { label: 'Top 1%',  lamports: BigInt(dist.p99Lamports) },
    { label: 'Average', lamports: BigInt(dist.avgLamports) },
  ];
  
  // Show buttons
  presets.forEach(p => {
    const sol = Number(p.lamports) / 1e9;
    console.log(`${p.label}: ${sol.toFixed(4)} SOL`);
  });
}
```

**Data sources:**
- `source: 'live'` — Current round has enough samples
- `source: 'estimate'` — Uses historical average from last 10 rounds
- `source: 'mixed'` — Some percentiles from live, some from estimate

**Per-tile data:** Use `GET /v3/rounds/:roundId/bid-distribution/tiles` for tile-specific percentiles with `tileDeployedLamports` and `otherTilesDeployedLamports` for payout calculations.

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

  /**
   * Global pooled per-tile bid distribution percentiles (lamports).
   * Computed by the API from per-wallet per-tile non-zero samples and surfaced
   * via `/v3/state` in `frames[].liveData.bidDistributionGlobal`.
   */
  bidDistributionGlobal?: {
    updatedAt: number;
    sampleSize: number;
    source: 'estimate' | 'live' | 'mixed';
    estimateRoundsUsed: number;
    p50Lamports: string;   // Top 50% — beat half of miners
    p80Lamports: string;   // Top 20% — competitive bid
    p90Lamports: string;   // Top 10% — strong bid
    p95Lamports: string;   // Top 5% — very competitive
    p99Lamports: string;   // Top 1% — whale territory
    avgLamports: string;   // Average bid per tile
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
