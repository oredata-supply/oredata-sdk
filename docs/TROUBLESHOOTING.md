# Troubleshooting Guide

Common issues when integrating with the Oredata SDK and API.

---

## Transaction Builder Issues

### `/tx/build/bid` rejects `tiles`

**Error:** `tiles must be an array of unique integers between 1 and 25`

**Cause:** Invalid tile format in request.

**Common mistakes:**
- Sending a string (`"1,5,7"`) instead of array (`[1,5,7]`)
- Using zero-indexed values (`[0,4,6]` instead of `[1,5,7]`)
- Including duplicates
- Empty array

**Fix:** Ensure payload includes a JSON array of 1-indexed integers:

```json
{
  "authority": "YourWallet...",
  "tiles": [1, 5, 7],
  "amountLamports": "25000000"
}
```

---

### `Buffer is not defined` when decoding instructions

**Context:** Browser/Edge runtimes don't include Node's `Buffer` global.

**Fix:**

```typescript
import { Buffer } from 'buffer';

if (typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = Buffer;
}

// Then decode instruction data
const data = Uint8Array.from(Buffer.from(base64String, 'base64'));
```

Or use native browser APIs:

```typescript
const data = Uint8Array.from(atob(base64String), c => c.charCodeAt(0));
```

---

### Bid consumed more SOL than expected

**Symptom:** UI shows 0.025 SOL but wallet prompts for 0.0625 SOL.

**Cause:** `amountLamports` is **per tile**, not total. The on-chain program multiplies by tile count.

**Example:**
- You send: `tiles: [1,5,7]`, `amountLamports: "25000000"` (0.025 SOL)
- Actual cost: 0.025 × 3 tiles = 0.075 SOL + fees

**Fix:** Divide intended total by number of tiles:

```typescript
const totalSol = 0.075;
const tiles = [1, 5, 7];
const perTileLamports = Math.floor((totalSol * 1e9) / tiles.length);

await client.buildBidInstructions({
  authority: wallet.publicKey.toString(),
  tiles,
  amountLamports: perTileLamports.toString(),
});
```

---

### `invalid account data for instruction` (ORE program)

**Logs:** `Program ore... failed: invalid account data for instruction`

**Causes:**
1. Instructions reordered or removed from builder response
2. Miner PDA doesn't exist and deploy isn't first instruction
3. Invalid `roundId` override

**Fix:** Use builder instructions exactly as returned:

```typescript
const response = await client.buildBidInstructions({ ... });

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

## Need More Help?

- **SDK Documentation:** [README.md](../README.md)
- **API Reference:** [API.md](./API.md)
- **Examples:** [packages/examples](../../examples/)
- **Support:** https://oredata.supply/support

