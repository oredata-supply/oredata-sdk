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
import { getRoundTiming, slotsToMs } from '@oredata/sdk';

const timing = getRoundTiming({
  currentSlot: 123456789,
  roundEndSlot: 123456889,
});

console.log(timing.remainingMs);    // Milliseconds until round ends
console.log(timing.remainingSlots); // Slots until round ends
console.log(timing.progress);       // 0-1 progress through round
```

### Why Slots Matter

- Solana slots are ~400ms each
- Network congestion can slow slots
- SDK compensates for variable slot times

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
