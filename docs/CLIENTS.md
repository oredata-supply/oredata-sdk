# SDK Capabilities Reference

The `@oredata/sdk` provides specialized clients for different capabilities. Mix and match based on what you need.

## Quick Reference

| Client | Purpose | Auth Required |
|--------|---------|---------------|
| [`OredataClient`](#oredataclient) | Game state, bids, transactions | API Key |
| [`SelfServiceClient`](#selfserviceclient) | Account management, T&C, projects | Wallet signature |
| [`MinerClient`](#minerclient) | Wallet balance tracking, rewards | API Key |
| [`TokenClient`](#tokenclient) | ORE token data (supply, price) | None |
| [`ChatClient`](#chatclient) | ore.supply chat integration | API Key + wallet |

---

## 1. Getting an API Key

| Method | When to Use | How |
|--------|-------------|-----|
| Dashboard | One-time setup, human developer | [oredata.supply/dashboard](https://oredata.supply/dashboard) |
| Programmatic | Automated registration, bot startup | [`SelfServiceClient.auth.register()`](#programmatic-registration) |

### Programmatic Registration

```typescript
import { SelfServiceClient } from '@oredata/sdk';
import { Keypair } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

const keypair = Keypair.fromSecretKey(bs58.decode(process.env.WALLET_SECRET_KEY));

const selfService = new SelfServiceClient({ baseUrl: 'https://api.oredata.supply' });

// 1. Get nonce
const { nonce } = await selfService.auth.getNonce();

// 2. Build and sign message
const message = selfService.auth.buildSignInMessage(keypair.publicKey.toBase58(), nonce);
const signature = nacl.sign.detached(Buffer.from(message), keypair.secretKey);

// 3. Register (creates account + returns first API key)
const { apiKey } = await selfService.auth.register({
  wallet: keypair.publicKey.toBase58(),
  message,
  signature: bs58.encode(signature),
});

console.log('API Key:', apiKey.key);
```

---

## 2. Reading Game Data

| Method | When to Use | Client/Import |
|--------|-------------|---------------|
| React hooks | Building React UI | `OredataProvider` + `useStore` + `usePresenter` |
| Event-driven | Node.js bots, servers | `OredataClient` + `store.on()` events |
| REST polling | Simple scripts, cron jobs | Direct HTTP to `/v3/state` |

### React Hooks

```typescript
import { OredataProvider, useStore, usePresenter, useRoundTiming } from '@oredata/sdk/react';

function App() {
  return (
    <OredataProvider config={{
      baseUrls: ['https://api.oredata.supply'],
      apiKey: process.env.REACT_APP_OREDATA_API_KEY,
    }}>
      <GameUI />
    </OredataProvider>
  );
}

function GameUI() {
  // Layer 1: Data state
  const { currentRound, isConnected, currentSlot } = useStore();

  // Layer 2: UI presentation
  const { displayPhase, winner, winnerVisible } = usePresenter();

  // Countdown timer
  const { countdown, progress, inRound } = useRoundTiming();

  if (!isConnected) return <div>Connecting...</div>;

  return (
    <div>
      <p>Round: {currentRound?.roundId}</p>
      <p>Phase: {displayPhase}</p>
      <p>Time: {countdown}s</p>
    </div>
  );
}
```

### Event-Driven (Node.js)

```typescript
import { OredataClient } from '@oredata/sdk';

const client = new OredataClient({
  baseUrls: ['https://api.oredata.supply'],
  apiKey: 'ore_...',
});

const store = client.getStore();

// Round lifecycle events
store.on('roundStarted', ({ roundId }) => {
  console.log(`New round: ${roundId}`);
});

store.on('roundCompleted', ({ roundId, winner, wasLate, arrivalMs }) => {
  console.log(`Winner: Tile ${winner.tile + 1}`);
});

store.on('roundDataUpdated', ({ roundId, pot, bids }) => {
  console.log(`Pot: ${pot.totalSol} SOL`);
});

client.start();
```

### REST Polling

```typescript
const response = await fetch('https://api.oredata.supply/v3/state', {
  headers: { 'X-Api-Key': 'ore_...' }
});
const { data } = await response.json();
console.log('Current round:', data.currentRoundId);
```

---

## 3. Placing Bids

| Method | When to Use | Signing |
|--------|-------------|---------|
| Wallet adapter | Human clicks "Bid" button | `useWallet()` + `wallet.signTransaction()` |
| Keypair | Automated bidding | `Keypair.fromSecretKey()` + `tx.sign()` |

Both use `client.buildBidTransaction()` → sign → `client.relayTransaction()`.

### With Wallet Adapter (Browser)

```typescript
import { OredataClient } from '@oredata/sdk';
import { useWallet } from '@solana/wallet-adapter-react';
import { Transaction } from '@solana/web3.js';

const { publicKey, signTransaction } = useWallet();
const client = new OredataClient({ apiKey: 'ore_...' });

const placeBid = async (tiles: number[]) => {
  const { transaction, blockhash, lastValidBlockHeight } = await client.buildBidTransaction({
    authority: publicKey.toBase58(),
    tiles,
    amountSol: 0.025,
  });

  const tx = Transaction.from(Buffer.from(transaction, 'base64'));
  const signed = await signTransaction(tx);

  const { signature } = await client.relayTransaction({
    transaction: Buffer.from(signed.serialize()).toString('base64'),
    blockhash,
    lastValidBlockHeight,
  });

  console.log('Bid placed:', signature);
};
```

### With Keypair (Automated)

```typescript
import { OredataClient } from '@oredata/sdk';
import { Keypair, Transaction } from '@solana/web3.js';

const keypair = Keypair.fromSecretKey(bs58.decode(process.env.WALLET_SECRET_KEY));
const client = new OredataClient({ apiKey: 'ore_...' });

const { transaction, blockhash, lastValidBlockHeight } = await client.buildBidTransaction({
  authority: keypair.publicKey.toBase58(),
  tiles: [0, 4, 12],
  amountSol: 0.025,
});

const tx = Transaction.from(Buffer.from(transaction, 'base64'));
tx.sign(keypair);

const { signature } = await client.relayTransaction({
  transaction: Buffer.from(tx.serialize()).toString('base64'),
  blockhash,
  lastValidBlockHeight,
});
```

---

## 4. Claiming Rewards

```typescript
// Check claimable via REST
const res = await fetch(`https://api.oredata.supply/v3/miner?authority=${wallet}`, {
  headers: { 'X-Api-Key': 'ore_...' }
});
const { data } = await res.json();

// Claim SOL rewards
if (data.claimableSol > 0) {
  const { transaction, blockhash, lastValidBlockHeight } = await client.buildClaimTransaction({
    authority: wallet,
  });
  // Sign and relay...
}

// Claim ORE rewards (separate transaction)
if (data.totalClaimableOre > 0) {
  const { transaction, blockhash, lastValidBlockHeight } = await client.buildClaimOreTransaction({
    authority: wallet,
  });
  // Sign and relay...
}
```

---

## 5. Multi-User Platforms

If you're building a platform that serves multiple users and need T&C compliance:

| Capability | Client Method |
|------------|---------------|
| Create projects | `SelfServiceClient.projects.create()` |
| Manage T&C versions | `SelfServiceClient.terms.create()` |
| Track user consent | `SelfServiceClient.consent.record()` |
| Server-side multiplexing | `createMultiplexer()` + `expressSSE()` |

### Project & T&C Management

```typescript
import { SelfServiceClient } from '@oredata/sdk';

// After login...
const client = new SelfServiceClient({ baseUrl: 'https://api.oredata.supply' });

// Create a project
const { project } = await client.projects.create({
  name: 'My Platform',
  domain: 'myplatform.com',
});

// Create T&C version
const { terms } = await client.terms.create(project.id, {
  version: '1.0.0',
  contentHash: 'sha256:...',
  effectiveAt: new Date().toISOString(),
});

// Record user consent
await client.consent.record(project.id, {
  userWallet: 'ABC123...',
  termsId: terms.id,
});
```

### Server-Side Multiplexing

```typescript
import { createMultiplexer, expressSSE } from '@oredata/sdk/server';
import express from 'express';

const app = express();
const multiplexer = createMultiplexer({
  baseUrls: ['https://api.oredata.supply'],
  apiKey: process.env.OREDATA_API_KEY,
});

// One connection to Oredata, many SSE connections to your clients
app.get('/events', expressSSE(multiplexer));

multiplexer.start();
app.listen(3000);
```

---

## Client Reference

### OredataClient

Main client for game data and transactions.

```typescript
import { OredataClient } from '@oredata/sdk';

const client = new OredataClient({
  baseUrls: ['https://api.oredata.supply'],
  apiKey: 'ore_...',
});

// Start real-time updates
client.start();

// Get Layer 1 store (data events)
const store = client.getStore();

// Get Layer 2 state (UI timing)
const state = client.createState({ spinDurationMs: 4000 });

// Transaction methods
await client.buildBidTransaction({ ... });
await client.buildClaimTransaction({ ... });
await client.buildClaimOreTransaction({ ... });
await client.relayTransaction({ ... });
```

### SelfServiceClient

Account management, API keys, projects, and T&C.

```typescript
import { SelfServiceClient } from '@oredata/sdk';

const client = new SelfServiceClient({ baseUrl: 'https://api.oredata.supply' });

// Authentication
await client.auth.getNonce();
await client.auth.login({ wallet, message, signature });
await client.auth.register({ wallet, message, signature }); // Creates account + first key

// API Keys
await client.keys.list();
await client.keys.create({ label: 'Production' });
await client.keys.revoke(keyId);

// Usage
await client.usage.get();
await client.usage.getSnapshots(); // Hourly data for charts

// Projects (for platforms)
await client.projects.list();
await client.projects.create({ name, domain });

// Terms & Consent
await client.terms.list(projectId);
await client.terms.create(projectId, { version, contentHash });
await client.consent.record(projectId, { userWallet, termsId });
```

### MinerClient

Track wallet balances and rewards.

```typescript
import { MinerClient, createMinerClient } from '@oredata/sdk';

const miner = createMinerClient({
  apiBaseUrl: 'https://api.oredata.supply',
  authority: wallet.publicKey.toBase58(),
  apiKey: 'ore_...',
  pollIntervalMs: 10000,
});

miner.on('update', (status) => {
  console.log('SOL claimable:', status.claimableSol);
  console.log('ORE claimable:', status.totalClaimableOre);
  console.log('Wallet balance:', status.authoritySol, 'SOL');
});

miner.on('rewardsChanged', ({ previous, current }) => {
  console.log(`Rewards changed: ${previous} → ${current} SOL`);
});

miner.start();
```

### TokenClient

ORE token data (no auth required).

```typescript
import { TokenClient } from '@oredata/sdk';

const token = new TokenClient();

// Current token state
const info = await token.getInfo();
console.log(`Supply: ${info.totalSupply} ORE`);
console.log(`Price: $${info.priceUsd}`);
console.log(`Market Cap: $${info.marketCapUsd}`);

// Emission statistics
const emissions = await token.getEmissions();
console.log(`${emissions.dailyEmissionOre} ORE/day`);
console.log(`Round ${emissions.currentRound}`);

// Historical data
const history = await token.getHistory({ period: '7d', interval: '1d' });
```

### ChatClient

ore.supply community chat.

```typescript
import { ChatClient } from '@oredata/sdk';

const chat = new ChatClient({ apiKey: 'ore_...' });

// Real-time messages via SSE
chat.on('message', (msg) => {
  console.log(`${msg.username}: ${msg.text}`);
});
chat.connect();

// Send a message (requires wallet)
const result = await chat.send('Hello everyone!', wallet);

// Fetch history
const { messages, hasMore } = await chat.fetchHistory({ limit: 50 });

// Check eligibility (must have mined in last 30 days)
const { eligible } = await chat.isEligible(wallet.publicKey.toBase58());
```

---

## Mix & Match Examples

**Bot builds React app for humans:**
```
- Bot uses SelfServiceClient to register → gets API key
- Bot deploys React app using OredataProvider with that API key
- Humans use wallet adapter to sign their own bids
```

**Dashboard monitors multiple accounts:**
```
- Human gets API key from dashboard
- Uses OredataClient in Node.js for game state
- Uses MinerClient to poll each tracked wallet's rewards
```

**Platform with T&C compliance:**
```
- Platform uses SelfServiceClient for T&C management
- Serves React UI to users via createMultiplexer
- Each user signs with their own wallet adapter
```

---

## Import Paths

```typescript
// Main entry (browser + Node.js)
import {
  OredataClient,
  SelfServiceClient,
  MinerClient,
  TokenClient,
  ChatClient
} from '@oredata/sdk';

// React hooks
import {
  OredataProvider,
  useStore,
  usePresenter,
  useRoundTiming,
  useMinerAccount,
  useBidTracker,
} from '@oredata/sdk/react';

// Server utilities
import {
  createMultiplexer,
  expressSSE
} from '@oredata/sdk/server';
```

---

## Related Documentation

- [QUICKSTART.md](./QUICKSTART.md) - Get started in 5 minutes
- [REACT.md](./REACT.md) - React hooks deep dive
- [TRANSACTIONS.md](./TRANSACTIONS.md) - Bid and claim transaction details
- [SELF-SERVICE.md](./SELF-SERVICE.md) - Bot registration and key management
- [SERVER.md](./SERVER.md) - Server-side multiplexing
- [STORE.md](./STORE.md) - OredataStore (Layer 1) reference
