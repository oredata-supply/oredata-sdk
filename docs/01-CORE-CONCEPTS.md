# Core Concepts

Understanding these concepts is essential for building with the SDK.

---

## Layer 1 vs Layer 2 Architecture

The SDK separates **data** from **presentation** into two layers:

### Layer 1: OredataStore (Data)

**Purpose:** Fires events immediately when blockchain data arrives.

**Use for:**
- Game logic (enable/disable betting)
- Winner detection
- Business decisions
- Bots and automation

**Events:**
- `roundStarted` — New round begins
- `roundCompleted` — Winner determined
- `roundDataUpdated` — Pot size or bids changed
- `miningStatusChanged` — Mining phase transition

```typescript
const store = client.getStore();

store.on('roundCompleted', ({ winner, isHistorical }) => {
  if (isHistorical) return;

  // Immediately disable betting
  disableBetting();

  // Check if user won
  if (userBetOnTile(winner.tile)) {
    showWinNotification();
  }
});
```

### Layer 2: OredataState (Presentation)

**Purpose:** Fires events after configurable delays for animations.

**Use for:**
- Spin animations
- Winner reveal effects
- Phase transitions
- Result overlays

**Events:**
- `phaseChange` — Visual phase transition
- `winnerReveal` — Time to show winner
- `resultOverlayShow/Hide` — Overlay timing

```typescript
const state = client.createState({
  spinDurationMs: 4000,   // Spin for 4 seconds
  resultDisplayMs: 15000, // Show result for 15 seconds
});

state.on('winnerReveal', ({ winner }) => {
  // This fires AFTER the spin animation completes
  highlightWinningTile(winner.tile);
});
```

### When to Use Which

| Scenario | Layer |
|----------|-------|
| Disable bet button when round ends | Layer 1 |
| Animate a spinning wheel | Layer 2 |
| Record winner in database | Layer 1 |
| Show confetti on win | Layer 2 |
| Calculate user P&L | Layer 1 |
| Display countdown timer | Layer 1 (via `useRoundTiming`) |

### Anti-Pattern: Using Layer 2 for Logic

```typescript
// BAD: Using Layer 2 for game logic
state.on('winnerReveal', ({ winner }) => {
  disableBetting(); // Too late! Betting should be disabled earlier
});

// GOOD: Use Layer 1 for logic, Layer 2 for visuals
store.on('roundCompleted', () => disableBetting());
state.on('winnerReveal', ({ winner }) => playAnimation());
```

---

## The `isHistorical` Flag

When your app connects (or reconnects), the SDK replays recent events so you can reconstruct state.

**Problem:** Without checking `isHistorical`, you'd play win animations for old rounds.

**Solution:** Always check the flag:

```typescript
store.on('roundCompleted', ({ winner, isHistorical }) => {
  if (isHistorical) {
    // Silently update state without effects
    updateWinnerDisplay(winner.tile);
    return;
  }

  // Fresh event — play effects
  playWinnerAnimation(winner.tile);
  playSound('winner');
});
```

### When `isHistorical` is `true`

- Page load / initial connection
- Reconnection after disconnect
- Hot module reload (dev mode)

### When `isHistorical` is `false`

- Live events happening now

---

## Polling vs SSE vs Hybrid

The SDK supports three transport modes:

### REST Polling (Default)

```typescript
const client = new OredataClient({
  pollIntervalMs: 1000, // Fetch every second
});
```

**Pros:** Works everywhere, simple
**Cons:** Higher latency, more requests

### SSE (Server-Sent Events)

```typescript
const client = new OredataClient({
  state: {
    transport: 'sse',
  },
});
```

**Pros:** Lower latency, real-time
**Cons:** Connection management, browser limits

### Hybrid (Recommended for Production)

```typescript
const client = new OredataClient({
  state: {
    transport: 'hybrid', // SSE primary, REST fallback
  },
});
```

**Pros:** Best of both — real-time with automatic fallback

---

## Round Lifecycle

A round goes through these phases:

```
BETTING → SPINNING → RESULT → (breather) → BETTING
```

### Phase: BETTING

- Users can place bids
- Pot is accumulating
- Countdown timer running

### Phase: SPINNING

- No new bids accepted
- Mining in progress
- Winner being determined

### Phase: RESULT

- Winner announced
- Result display period
- Rewards claimable

### Phase Transitions

```typescript
store.on('miningStatusChanged', ({ status }) => {
  switch (status) {
    case 'active':
      // Mining started, round is live
      break;
    case 'finalizing':
      // Winner found, waiting for confirmation
      break;
    case 'idle':
      // Between rounds
      break;
  }
});
```

---

## Slot-Based Timing

Solana uses "slots" instead of timestamps. The SDK handles conversion:

```typescript
import { useRoundTiming } from '@oredata/sdk/react';

const { countdown, progress, inRound, inBreather } = useRoundTiming();

// countdown: "42s" or "Next round starting soon..."
// progress: 0-1 during betting (for progress bars)
// inRound: true during betting phase
// inBreather: true between rounds
```

### Why Slots Matter

- Solana slots are ~400ms average (but varies with network load)
- The SDK fetches actual network slot duration from the API
- All timing calculations use real network values, not hardcoded constants

---

## Timing Deep Dive

Understanding timing is critical for building accurate progress bars and countdowns.

### The Two-Phase Model

Timing in ORE follows a simple two-phase model:

```
┌──────────────────────┐  ┌────────────────────┐  ┌──────────────────────┐
│     BETTING          │  │      BREATHER      │  │      BETTING         │
│                      │  │                    │  │                      │
│  progress: 0 → 1     │  │ breatherProgress:  │  │  progress: 0 → 1     │
│  ████████░░░░░░      │  │     1 → 0          │  │  ████████░░░░░░      │
│  (fills →)           │  │ ░░░░░░████████     │  │  (fills →)           │
│                      │  │     (shrinks ←)    │  │                      │
└──────────────────────┘  └────────────────────┘  └──────────────────────┘
         │                         │                        │
         ▼                         ▼                        ▼
  round.startSlot ────────► round.endSlot          nextRound.startSlot
```

1. **BETTING (inRound=true)**: From `startSlot` to `endSlot` of the current round
2. **BREATHER (inBreather=true)**: From `endSlot` of old round to `startSlot` of new round

> **Note:** UI phases like SPINNING, RESULT, IDLE are **presentation layers** (Layer 2) on top of the breather period. They don't affect timing calculations.

### Progress Bar Directions

The SDK provides two progress values for different animation needs:

| Phase | Value | Direction | Use For |
|-------|-------|-----------|---------|
| BETTING | `progress` | 0 → 1 | Progress bar fills LEFT → RIGHT |
| BREATHER | `breatherProgress` | 1 → 0 | Progress bar shrinks RIGHT → LEFT |

```typescript
function ProgressBar() {
  const { progress, breatherProgress, inRound, inBreather } = useRoundTiming();

  if (inRound && progress !== null) {
    // BETTING: bar fills left→right
    return <div className="bar" style={{ width: `${progress * 100}%` }} />;
  }

  if (inBreather && breatherProgress !== null) {
    // BREATHER: bar shrinks right→left
    return <div className="bar" style={{ width: `${breatherProgress * 100}%` }} />;
  }

  return <div className="bar empty" />;
}
```

### Dynamic vs Fallback Values

The SDK uses **dynamic values from the network** with fallbacks for edge cases:

| Value | Primary Source | Fallback | When Fallback Used |
|-------|----------------|----------|-------------------|
| `slotDurationMs` | API response (actual network average) | 400ms | Before first API response |
| `breatherDurationMs` | Calculated from slot delta | 18000ms | When `nextRound.startSlot` unknown |

**Important:** These are NOT hardcoded constants. The SDK calculates exact values when slot data is available:

```typescript
// SDK internal calculation (simplified)
if (previousRound.endSlot && nextRound.startSlot) {
  breatherDurationMs = (nextRound.startSlot - previousRound.endSlot) * slotDurationMs;
}
```

### Data Availability Timeline (Critical!)

This is the most important concept for accurate timing:

```
Timeline:  ───────────────────────────────────────────────────────►
           │ Round N BETTING │ BREATHER │ Round N+1 BETTING │
           │                 │          │                   │
Available: │ currentRound    │ previous │ currentRound      │
           │ .startSlot ✅   │ Round    │ .startSlot ✅     │
           │ .endSlot ✅     │ .endSlot │ .endSlot ✅       │
           │                 │    ✅    │                   │
           │                 │          │                   │
           │                 │ nextRound│ ✅ Both slots     │
           │                 │ .start   │    now known!     │
           │                 │   ❌     │                   │
           │                 │ UNKNOWN! │                   │
```

**Key Insight:** During the breather, you have `previousRound.endSlot` but NOT `nextRound.startSlot`. This means `breatherProgress` and `nextRoundStartsInMs` are **estimated** using the fallback breather duration.

```typescript
const { breatherProgress, nextRoundKnown } = useRoundTiming();

if (inBreather && !nextRoundKnown) {
  // Values are estimated! Show indicator to user
  return <span className="animate-pulse">~{countdown}</span>;
}
```

Once the new round starts, the SDK has both slots and can calculate the exact duration. The UI will "snap" to the correct state—this is expected behavior.

### Why Timing May Be Slightly Off During Breather

Because `nextRound.startSlot` is unknown during the breather:

1. SDK estimates based on `breatherDurationMs` (typically ~18s)
2. Actual breather may be slightly shorter or longer
3. When new round starts, UI updates to correct state

This is unavoidable without predictive data from the blockchain. The estimation is typically accurate within 1-2 seconds.

---

## Error Handling Philosophy

The SDK uses typed errors for different scenarios:

| Error Type | Meaning | Recovery |
|------------|---------|----------|
| `OredataRateLimitError` | Too many requests | Wait `retryAfterMs` |
| `OredataQuotaExceededError` | Monthly limit hit | Upgrade plan |
| `OredataNetworkError` | Connection failed | Retry with backoff |
| `OredataSimulationError` | Transaction failed | Check inputs |
| `OredataApiError` | Server error | Check status |

```typescript
import { OredataRateLimitError } from '@oredata/sdk';

try {
  await client.buildBidTransaction({ ... });
} catch (error) {
  if (OredataRateLimitError.is(error)) {
    await sleep(error.retryAfterMs);
    // Retry
  }
}
```

---

## Next Steps

- [OredataClient Reference](./reference/OREDATA-CLIENT.md)
- [OredataStore Reference](./reference/STORE.md)
- [React Integration](./integrations/REACT.md)
- [Troubleshooting](./TROUBLESHOOTING.md)
