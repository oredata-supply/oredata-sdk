# MinerClient Reference

Track wallet balances, claimable rewards, and ORE tokens for a specific wallet address.

## Quick Start

```typescript
import { MinerClient, createMinerClient } from '@oredata/sdk';

const miner = createMinerClient({
  apiBaseUrl: 'https://api.oredata.supply',
  authority: wallet.publicKey.toString(),
  apiKey: 'ore_...',
});

miner.on('update', (status) => {
  console.log(`SOL balance: ${status.authoritySol}`);
  console.log(`Claimable SOL: ${status.claimableSol}`);
  console.log(`Claimable ORE: ${status.totalClaimableOre}`);
});

miner.start();
```

---

## Constructor Options

```typescript
interface MinerClientOptions {
  /** API base URL */
  apiBaseUrl: string;

  /** Wallet address to track */
  authority: string;

  /** API key for authentication */
  apiKey?: string;

  /** Polling interval in milliseconds (default: 10000) */
  pollIntervalMs?: number;
}
```

---

## Events

### `update`

Fires on every successful status fetch.

```typescript
miner.on('update', (status: MinerStatus) => {
  // Wallet balances
  status.authoritySol;       // Wallet SOL balance
  status.authorityOre;       // Wallet ORE balance

  // Claimable rewards
  status.claimableSol;       // SOL rewards ready to claim
  status.pendingSol;         // SOL rewards processing

  // ORE rewards
  status.unrefinedOre;       // Unrefined ORE (10% tax on claim)
  status.refinedOre;         // Refined ORE (no tax)
  status.totalClaimableOre;  // Sum of unrefined + refined

  // Miner state
  status.needsCheckpoint;    // True if checkpoint tx needed
  status.lastActivity;       // Last activity timestamp
});
```

### `rewardsChanged`

Fires when SOL claimable amount changes.

```typescript
miner.on('rewardsChanged', (payload) => {
  payload.previous: number;  // Old value
  payload.current: number;   // New value
  payload.delta: number;     // Difference
});

// Example: Notify user of new rewards
miner.on('rewardsChanged', ({ delta }) => {
  if (delta > 0) {
    notify(`You earned ${delta} SOL!`);
  }
});
```

### `oreRewardsChanged`

Fires when ORE claimable amount changes.

```typescript
miner.on('oreRewardsChanged', (payload) => {
  payload.previous: number;
  payload.current: number;
  payload.delta: number;
});
```

### `needsCheckpoint`

Fires when the miner needs a checkpoint transaction.

```typescript
miner.on('needsCheckpoint', () => {
  console.log('Checkpoint transaction needed before claiming');
});
```

### `error`

Fires on fetch errors.

```typescript
miner.on('error', (error: Error) => {
  console.error('Miner fetch failed:', error);
});
```

---

## Methods

### `start()`

Start polling for miner status.

```typescript
miner.start();
```

### `stop()`

Stop polling.

```typescript
miner.stop();
```

### `fetch(maxRetries?): Promise<MinerStatus>`

Fetch status once (no polling).

```typescript
const status = await miner.fetch();
console.log(`Claimable: ${status.claimableSol} SOL`);
```

### `getStatus(): MinerStatus | null`

Get the last fetched status (synchronous).

```typescript
const status = miner.getStatus();
if (status) {
  console.log(`Balance: ${status.authoritySol} SOL`);
}
```

### `isPolling(): boolean`

Check if polling is active.

```typescript
if (!miner.isPolling()) {
  miner.start();
}
```

### `setAuthority(authority: string)`

Change the tracked wallet and restart polling.

```typescript
// User connected a different wallet
miner.setAuthority(newWallet.publicKey.toString());
```

---

## MinerStatus Type

```typescript
interface MinerStatus {
  // Wallet balances (SOL/ORE in wallet)
  authoritySol: number;
  authorityOre: number;
  authorityUsdc: number;

  // Claimable SOL rewards
  claimableSol: number;    // Ready to claim now
  pendingSol: number;      // Processing (wait for next round)

  // Claimable ORE rewards
  unrefinedOre: number;    // 10% tax on claim
  refinedOre: number;      // No tax
  totalClaimableOre: number;

  // Miner account state
  needsCheckpoint: boolean;
  lastActivity: string;    // ISO timestamp
  minerAccount: string | null;

  // Metadata
  authority: string;
  fetchedAt: number;
}
```

---

## Full Example: Wallet Panel

```typescript
import { createMinerClient, OredataClient } from '@oredata/sdk';

const client = new OredataClient({ apiKey: 'ore_...' });

const miner = createMinerClient({
  apiBaseUrl: 'https://api.oredata.supply',
  authority: wallet.publicKey.toString(),
  apiKey: 'ore_...',
  pollIntervalMs: 5000,
});

// Update UI on status change
miner.on('update', (status) => {
  document.getElementById('sol-balance').textContent =
    `${status.authoritySol.toFixed(4)} SOL`;

  document.getElementById('claimable').textContent =
    `${status.claimableSol.toFixed(4)} SOL`;

  document.getElementById('ore-rewards').textContent =
    `${status.totalClaimableOre.toFixed(4)} ORE`;

  // Enable/disable claim button
  const canClaim = status.claimableSol > 0 || status.totalClaimableOre > 0;
  document.getElementById('claim-btn').disabled = !canClaim;
});

// Notify on new rewards
miner.on('rewardsChanged', ({ delta }) => {
  if (delta > 0) {
    showToast(`+${delta.toFixed(4)} SOL earned!`);
  }
});

// Handle errors
miner.on('error', (error) => {
  console.warn('Miner status unavailable:', error.message);
});

miner.start();

// Cleanup on disconnect
wallet.on('disconnect', () => {
  miner.stop();
});
```

---

## Claiming Rewards

Use `MinerClient` to check balances, then `OredataClient` to build transactions:

```typescript
// Check what's claimable
const status = miner.getStatus();

// Claim SOL
if (status.claimableSol > 0) {
  const { transaction } = await client.buildClaimTransaction({
    authority: wallet.publicKey.toString(),
  });
  // Sign and relay...
}

// Claim ORE
if (status.totalClaimableOre > 0) {
  const { transaction } = await client.buildClaimOreTransaction({
    authority: wallet.publicKey.toString(),
  });
  // Sign and relay...
}
```

---

## Related

- [OredataClient](./OREDATA-CLIENT.md)
- [Transactions](./TRANSACTIONS.md)
- [React: useMinerAccount](../integrations/REACT.md#usemineraccount)
