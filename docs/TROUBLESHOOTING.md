# Troubleshooting Guide

Common issues when integrating with the Oredata SDK and API.

---

## Transaction Builder Issues

### V3 Transaction Methods (Recommended)

As of SDK v0.5.0, use the simplified transaction builders:

```typescript
// Build ready-to-sign transaction
const { transaction, blockhash, lastValidBlockHeight } = await client.buildBidTransaction({
  authority: wallet.publicKey.toString(),
  tiles: [0, 4, 6],  // 0-indexed (0-24)
  amountSol: 0.025, // Per tile
});

// Decode and send
const tx = Transaction.from(Buffer.from(transaction, 'base64'));
const sig = await wallet.sendTransaction(tx, connection);
await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight });
```

This eliminates manual instruction assembly and Buffer handling issues.

---

### `/tx/build/bid` rejects `tiles` (Legacy)

**Error:** `tiles must be an array of unique integers between 1 and 25`

**Cause:** Invalid tile format in request.

**Common mistakes:**
- Sending a string (`"1,5,7"`) instead of array (`[1,5,7]`)
- Using zero-indexed values (`[0,4,6]` instead of `[1,5,7]`)
- Including duplicates
- Empty array

**Fix:** Use the V3 endpoint or ensure payload includes a JSON array:

```typescript
// V3 (recommended)
await client.buildBidTransaction({
  authority: wallet.publicKey.toString(),
  tiles: [0, 4, 6],  // 0-indexed (0-24)
  amountSol: 0.025,
});

// Legacy
await client.buildBid({
  authority: wallet.publicKey.toString(),
  tiles: [0, 4, 6],  // 0-indexed (0-24)
  amountLamports: "25000000",
});
```

---

### `Buffer is not defined` in browser

**Context:** Browser/Edge runtimes don't include Node's `Buffer` global.

**Fix for V3 methods:** Use `vite-plugin-node-polyfills` or similar:

```typescript
// vite.config.ts
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  plugins: [nodePolyfills({ buffer: true })],
});
```

**Manual polyfill:**

```typescript
import { Buffer } from 'buffer';

if (typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = Buffer;
}

const tx = Transaction.from(Buffer.from(transaction, 'base64'));
```

---

### Bid consumed more SOL than expected

**Symptom:** UI shows 0.025 SOL but wallet prompts for 0.0625 SOL.

**Cause:** `amountSol` (or `amountLamports`) is **per tile**, not total. The on-chain program multiplies by tile count.

**Example:**
- You send: `tiles: [0,4,6]`, `amountSol: 0.025`
- Actual cost: 0.025 × 3 tiles = 0.075 SOL + platform fees

**Fix:** Divide intended total by number of tiles:

```typescript
const totalSol = 0.075;
const tiles = [1, 5, 7];
const perTileSol = totalSol / tiles.length;

await client.buildBidTransaction({
  authority: wallet.publicKey.toString(),
  tiles,
  amountSol: perTileSol,
});
```

---

### `invalid account data for instruction` (ORE program)

**Logs:** `Program ore... failed: invalid account data for instruction`

**Causes:**
1. Instructions reordered or removed from builder response
2. Miner PDA doesn't exist and deploy isn't first instruction
3. Invalid `roundId` override

**Fix (V3 - recommended):** Use `buildBidTransaction()` which handles everything:

```typescript
const { transaction } = await client.buildBidTransaction({
  authority: wallet.publicKey.toString(),
  tiles: [0, 4, 6],  // 0-indexed (0-24)
  amountSol: 0.025,
});

const tx = Transaction.from(Buffer.from(transaction, 'base64'));
// Transaction is already correctly ordered
```

**Fix (Legacy):** Use builder instructions exactly as returned:

```typescript
const response = await client.buildBid({ ... });

// DON'T modify the instructions array
const tx = new Transaction();
for (const ix of response.instructions) {
  tx.add(deserializeInstruction(ix));
}
```

If `metadata.needsCheckpoint` is `true`, the checkpoint instruction is already included in the correct order.

---

## Rate Limiting

### Getting 429 errors

**Check which limit you're hitting:**

```typescript
import { OredataRateLimitError } from '@oredata/sdk';

try {
  await client.getState();
} catch (e) {
  if (OredataRateLimitError.is(e)) {
    console.log('Limit type:', e.limitType);   // 'short' | 'long' | 'ip'
    console.log('Source:', e.source);          // 'ip' | 'key'
    console.log('Retry in:', e.retryAfterMs);
    console.log('Help:', e.helpMessage);
  }
}
```

**Common causes:**

| Symptom | Cause | Solution |
|---------|-------|----------|
| `source: "ip"` | No API key, hitting IP limits | [Get API key](https://oredata.supply/register) |
| `limitType: "short"` | Too many requests per second | Reduce polling frequency |
| `limitType: "long"` | Too many requests per minute | Upgrade plan or reduce load |
| Multiple browsers hitting limits | All share one API key | Use [server multiplexer](../README.md#server-multiplexer-oredatasdkserver) |

---

### SDK auto-retry

The SDK automatically retries on 429 with exponential backoff:

```typescript
const client = new OredataClient({
  baseUrls: ['https://ore-api.gmore.fun'],
  apiKey: process.env.OREDATA_API_KEY,
  // Built-in retry with backoff
});
```

For manual retry:

```typescript
import { OredataRateLimitError } from '@oredata/sdk';

async function fetchWithRetry() {
  try {
    return await client.getState();
  } catch (e) {
    if (OredataRateLimitError.is(e)) {
      await sleep(e.retryAfterMs);
      return await client.getState(); // Retry once
    }
    throw e;
  }
}
```

---

## Connection Issues

### SSE connection drops frequently

**Possible causes:**
1. Network instability
2. Proxy/firewall timeout
3. Server capacity limits

**Mitigation:**

```typescript
const stateClient = client.getStateClient();

stateClient.on('connectionChange', (state) => {
  if (state.status === 'disconnected') {
    console.log('Reconnecting...');
    // SDK auto-reconnects with backoff
  }
});
```

---

### All API URLs failed

**Error:** `OredataHttpError: All API base URLs failed`

**Causes:**
1. Network connectivity issue
2. All API endpoints down (rare)
3. Firewall blocking requests

**Debug:**

```bash
# Test connectivity
curl -v https://ore-api.gmore.fun/v3/health
```

**In SDK:**

```typescript
const client = new OredataClient({
  baseUrls: [
    'https://ore-api.gmore.fun',
    // Add backup URL if available
  ],
});
```

---

## Bid Lockout (HTTP 423)

**Error:** `bid_locked` - Cannot bid in final seconds of round.

| Plan | Lockout Period |
|------|----------------|
| `free` | Last 5 seconds |
| `dev` | Last 4 seconds |
| `pro` | Last 3 seconds |
| `ultra` | No lockout |

**Handle gracefully:**

```typescript
import { OredataLockoutError } from '@oredata/sdk';

try {
  await client.buildBidInstructions({ ... });
} catch (e) {
  if (OredataLockoutError.is(e)) {
    // Show user-friendly message
    showToast(`Betting closes in ${e.lockoutSeconds}s. Try next round!`);
    // Don't show "upgrade your plan" - bad UX
  }
}
```

---

## Winner Delay

**Symptom:** Winner info is `null` right after round ends.

**Cause:** Your plan has winner delay (embargo period).

| Plan | Delay |
|------|-------|
| `free` | 5 seconds |
| `dev` | 4 seconds |
| `pro` | 3 seconds |
| `ultra` | Instant |

**Check delay status:**

```typescript
const state = await client.getState();

if (state.meta.winnerRevealIn > 0) {
  // Winner still hidden
  showSpinner(`Revealing winner in ${state.meta.winnerRevealIn}s...`);
}
```

---

## React Hook Issues

### `useOredataState` returns stale data

**Cause:** Provider not at top level or multiple providers.

**Fix:** Ensure single `OredataProvider` wraps your app:

```tsx
// app/layout.tsx or _app.tsx
export default function App({ children }) {
  return (
    <OredataProvider config={{ baseUrls: [...], apiKey }}>
      {children}
    </OredataProvider>
  );
}
```

### Hook not updating

**Cause:** Component not subscribed to the right events.

**Debug:**

```typescript
const { phase, isConnected, error } = useOredataState();

useEffect(() => {
  console.log('State changed:', { phase, isConnected, error });
}, [phase, isConnected, error]);
```

---

## Anti-Patterns (Don't Do This)

These patterns cause subtle bugs that are hard to debug. Avoid them!

### ❌ Using `createMultiplexer` for winner detection

```typescript
// WRONG: Winner events are unreliable with multiplexer
const multiplexer = createMultiplexer({ ... });

multiplexer.on('winner', (event) => {
  // This may never fire, or fire late!
  announceWinner(event.tile);
});
```

**Why it's wrong:** The multiplexer's internal state store had a bug (fixed in v0.9.6) where it only checked the current frame for winners. If you're on an older version, or want reliable winner detection, use `OredataClient`.

**Fix:**

```typescript
// RIGHT: Use Layer 1 events
const client = new OredataClient({ ... });
const store = client.getStore();

store.on('roundCompleted', ({ winner }) => {
  announceWinner(winner.tile); // Always fires reliably
});
```

---

### ❌ Parsing frames manually for winners

```typescript
// WRONG: Complex, fragile, error-prone
multiplexer.on('snapshot', (state) => {
  const frames = Array.from(state.frames.values());
  const previousFrame = frames.find(f => f.roundId === previousRoundId);
  const winner = previousFrame?.liveData?.winner 
    ?? previousFrame?.finalWinner?.winningSquareIndex;
  if (winner !== undefined) {
    announceWinner(winner);
  }
});
```

**Why it's wrong:** 
- Frame structure is internal and may change
- Winner data location varies (`optimisticWinner`, `finalWinner`)
- You're duplicating logic the SDK already handles

**Fix:**

```typescript
// RIGHT: Let the SDK handle it
store.on('roundCompleted', ({ winner }) => {
  announceWinner(winner.tile);
});
```

---

### ❌ Using Layer 2 for game logic

```typescript
// WRONG: Layer 2 events have timing delays
state.on('phaseChange', ({ phase }) => {
  if (phase === 'BETTING') {
    enableBettingUI(); // May be delayed by spinDurationMs!
  }
});
```

**Why it's wrong:** Layer 2 (`OredataState`) adds configurable delays for UI animations. Using it for game logic means your betting UI might enable late.

**Fix:**

```typescript
// RIGHT: Use Layer 1 for game logic
store.on('roundStarted', () => {
  enableBettingUI(); // Fires immediately
});
```

---

### ❌ Ignoring `isHistorical` flag

```typescript
// WRONG: Will process old events on page load
store.on('roundCompleted', ({ winner }) => {
  playWinnerAnimation(winner.tile);
  incrementWinCounter();
});
```

**Why it's wrong:** When your app connects, it receives events for rounds that already happened. Without checking `isHistorical`, you'll:
- Play animations for old rounds
- Double-count statistics
- Show confusing UI state

**Fix:**

```typescript
// RIGHT: Check isHistorical
store.on('roundCompleted', ({ winner, isHistorical }) => {
  if (isHistorical) return; // Skip old events
  
  playWinnerAnimation(winner.tile);
  incrementWinCounter();
});
```

---

### ❌ Building "estimated winner" fallback

```typescript
// WRONG: Guessing winner from highest SOL tile
multiplexer.on('snapshot', (state) => {
  if (!winner) {
    const tiles = state.perSquare?.deployedSol ?? [];
    const highestIndex = tiles.indexOf(Math.max(...tiles));
    announceEstimatedWinner(highestIndex);
  }
});
```

**Why it's wrong:**
- The tile with most SOL is NOT guaranteed to win
- ORE uses on-chain RNG, not "most bets wins"
- This gives users wrong information

**Fix:**

```typescript
// RIGHT: Wait for actual winner data
store.on('roundCompleted', ({ winner }) => {
  announceWinner(winner.tile); // Real winner from blockchain
});
```

---

## Common Bugs

### roundId comparison fails silently

**Bug:**
```typescript
// This ALWAYS fails - comparing string to number
if (payload.roundId === 74006) { ... }
```

**Why:** `roundId` is always a `string` in the SDK (matches JSON API). JavaScript's `===` does type checking, so `"74006" === 74006` is `false`.

**Fix:**
```typescript
// Option 1: Compare as strings
if (payload.roundId === "74006") { ... }

// Option 2: Parse when needed
const numericId = parseInt(payload.roundId, 10);
if (numericId > 74000) { ... }

// Option 3: Loose equality (not recommended)
if (payload.roundId == 74006) { ... }
```

See [STORE.md](./STORE.md#important-roundid-is-string) for details.

---

### "Waiting for winner" shown on page load

**Bug:** User loads page, sees "Waiting for winner..." even though winner is already known.

**Cause:** `roundCompleted` event fires for a round that finished before we connected. Without context, your UI treats it as a live event.

**Fix (SDK v0.9.5+):** Check `isHistorical`:

```typescript
store.on('roundCompleted', ({ winner, isHistorical }) => {
  if (isHistorical) {
    // Cold load - winner already existed
    setWinner(winner); // Skip pending state
  } else {
    // Live event
    showPending();
    setTimeout(() => setWinner(winner), REVEAL_DELAY);
  }
});
```

**Alternative:** Check if winner is already known:

```typescript
const prevRound = store.getPreviousRound();
if (prevRound?.winner) {
  // Winner already exists - skip pending state
  setWinner(prevRound.winner);
}
```

See [STORE.md](./STORE.md#cold-load-detection) for details.

---

## Need More Help?

- **Architecture Overview:** [ARCHITECTURE.md](./ARCHITECTURE.md) — Layer 1 vs Layer 2, choose your pattern
- **SDK Documentation:** [README.md](../README.md)
- **Layer 1 API:** [STORE.md](./STORE.md)
- **API Reference:** [API.md](./API.md)
- **Examples:** [packages/examples](../../examples/)
- **Support:** https://oredata.supply/support

