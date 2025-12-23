# OredataClient Reference

The main client for interacting with the oredata.supply API. Provides game state, transaction building, and polling management.

## Quick Start

```typescript
import { OredataClient } from '@oredata/sdk';

const client = new OredataClient({
  baseUrls: ['https://api.oredata.supply'],
  apiKey: process.env.OREDATA_API_KEY,
});

client.start();
```

---

## Constructor Options

```typescript
interface OredataClientOptions {
  /** API endpoints (primary + fallbacks) */
  baseUrls: string[];

  /** API key (from dashboard or programmatic registration) */
  apiKey?: string;

  /** Polling interval in milliseconds (default: 1000) */
  pollIntervalMs?: number;

  /** Request timeout in milliseconds (default: 10000) */
  timeoutMs?: number;

  /** Include bid data in state responses (default: true) */
  includeBids?: boolean;

  /** State engine configuration */
  state?: {
    /** Transport mode: 'rest' | 'sse' | 'hybrid' (default: 'rest') */
    transport?: 'rest' | 'sse' | 'hybrid';

    /** Enable health check polling (default: true) */
    healthCheck?: boolean;

    /** Metrics collection (default: enabled) */
    metrics?: boolean;
  };
}
```

### Example: Full Configuration

```typescript
const client = new OredataClient({
  baseUrls: [
    'https://api.oredata.supply',
    'https://api-backup.oredata.supply', // Fallback
  ],
  apiKey: 'ore_abc123...',
  pollIntervalMs: 500,        // Faster polling
  timeoutMs: 5000,            // Shorter timeout
  includeBids: true,
  state: {
    transport: 'hybrid',      // SSE with REST fallback
    healthCheck: true,
    metrics: true,
  },
});
```

---

## Polling Control

### `start()`

Start polling for state updates.

```typescript
client.start();
```

### `stop()`

Stop polling completely.

```typescript
client.stop();
```

### `pause()`

Pause polling (sets mode to idle). Useful for tab visibility.

```typescript
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    client.pause();
  } else {
    client.resume();
  }
});
```

### `resume()`

Resume polling from pause.

```typescript
client.resume();
```

---

## State Access

### `getStore(): OredataStore`

Get the Layer 1 data store for immediate events.

```typescript
const store = client.getStore();

store.on('roundCompleted', ({ winner }) => {
  console.log(`Winner: Tile ${winner.tile}`);
});
```

See: [STORE.md](./STORE.md)

### `createState(config?): OredataState`

Create a Layer 2 state for UI timing.

```typescript
const state = client.createState({
  spinDurationMs: 4000,
  resultDisplayMs: 15000,
});

state.on('winnerReveal', ({ winner }) => {
  highlightTile(winner.tile);
});
```

See: [STATE.md](./STATE.md)

### `getStateClient(): StateClient`

Get the internal StateClient (advanced use only).

```typescript
const stateClient = client.getStateClient();
stateClient.setMode('idle');
```

---

## Health Monitoring

### `isPollingHealthy(): boolean`

Check if polling is current (data is fresh).

```typescript
if (!client.isPollingHealthy()) {
  showStaleDataWarning();
}
```

### `getLastPollTimestamp(): Date | null`

Get the timestamp of the last successful poll.

```typescript
const lastPoll = client.getLastPollTimestamp();
const ageMs = Date.now() - lastPoll.getTime();
console.log(`Data is ${ageMs}ms old`);
```

### `getMode(): 'active' | 'idle'`

Get current polling mode.

```typescript
const mode = client.getMode();
console.log(`Currently in ${mode} mode`);
```

---

## Data Fetching

### `fetchState(options?): Promise<StateV3Response>`

Fetch current game state (one-shot, no polling).

```typescript
const state = await client.fetchState();
console.log(`Current round: ${state.data.currentRoundId}`);

// With options
const optimized = await client.fetchState({
  optimized: true,
  sections: ['round', 'globals'],
});
```

**Options:**

```typescript
interface StateRequestOptions {
  /** Number of frames to include */
  frames?: number;

  /** Sections to include */
  sections?: ('round' | 'globals' | 'bids' | 'perSquare' | 'analytics')[];

  /** Include previous round */
  includePrevious?: boolean;

  /** Use optimized response format */
  optimized?: boolean;
}
```

### `fetchBids(roundId?): Promise<BidsResponse>`

Fetch bid distribution for a round.

```typescript
const bids = await client.fetchBids('74006');
console.log(`Total bids: ${bids.totalCount}`);
```

### `getPlans(): Promise<PlansResponse>`

Fetch available API plans with pricing.

```typescript
const { plans } = await client.getPlans();
plans.forEach(p => {
  console.log(`${p.name}: $${p.priceUsdcMonthly}/mo`);
});
```

---

## Transaction Building

All transaction methods return a ready-to-sign base64-encoded transaction.

### `buildBidTransaction(request): Promise<TransactionResponse>`

Build a bid transaction.

```typescript
const { transaction, blockhash, lastValidBlockHeight } = await client.buildBidTransaction({
  authority: wallet.publicKey.toString(),
  tiles: [0, 4, 12],        // Tiles to bid on (0-24)
  amountSol: 0.025,         // SOL per tile
  // OR amountLamports: '25000000',
  roundId: '74006',         // Optional: specific round
  skipSimulation: false,    // Optional: skip tx simulation
});

// Sign and relay
const tx = Transaction.from(Buffer.from(transaction, 'base64'));
const signed = await wallet.signTransaction(tx);
```

### `buildClaimTransaction(request): Promise<TransactionResponse>`

Build a SOL claim transaction.

```typescript
const { transaction, blockhash, lastValidBlockHeight } = await client.buildClaimTransaction({
  authority: wallet.publicKey.toString(),
});
```

### `buildClaimSolTransaction(request): Promise<TransactionResponse>`

Alias for `buildClaimTransaction()`.

### `buildClaimOreTransaction(request): Promise<TransactionResponse>`

Build an ORE token claim transaction.

```typescript
const { transaction, blockhash, lastValidBlockHeight } = await client.buildClaimOreTransaction({
  authority: wallet.publicKey.toString(),
});
```

**Note:** ORE claims have a 10% tax on unrefined ORE.

---

## Transaction Relay

### `relayTransaction(request): Promise<RelayTransactionResponse>`

Send a signed transaction through the API (no RPC needed).

```typescript
const signed = await wallet.signTransaction(tx);

const { signature, status } = await client.relayTransaction({
  transaction: Buffer.from(signed.serialize()).toString('base64'),
  blockhash,
  lastValidBlockHeight,
});

console.log(`Transaction: ${signature}`);
```

---

## Full Example: Place a Bid

```typescript
import { OredataClient } from '@oredata/sdk';
import { Transaction } from '@solana/web3.js';

const client = new OredataClient({
  baseUrls: ['https://api.oredata.supply'],
  apiKey: 'ore_...',
});

async function placeBid(wallet, tiles: number[], amountSol: number) {
  // 1. Build transaction
  const { transaction, blockhash, lastValidBlockHeight } = await client.buildBidTransaction({
    authority: wallet.publicKey.toString(),
    tiles,
    amountSol,
  });

  // 2. Decode and sign
  const tx = Transaction.from(Buffer.from(transaction, 'base64'));
  const signed = await wallet.signTransaction(tx);

  // 3. Relay through API
  const { signature } = await client.relayTransaction({
    transaction: Buffer.from(signed.serialize()).toString('base64'),
    blockhash,
    lastValidBlockHeight,
  });

  return signature;
}
```

---

## HTTP Client Access

For direct API access:

```typescript
// Access underlying HTTP client
const http = client.http;

// Custom requests
const response = await http.get('/v3/health');
```

---

## Related

- [OredataStore (Layer 1)](./STORE.md)
- [OredataState (Layer 2)](./STATE.md)
- [Transactions](./TRANSACTIONS.md)
- [Errors](./ERRORS.md)
