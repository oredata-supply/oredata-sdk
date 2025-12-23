# @oredata/sdk

[![npm version](https://img.shields.io/npm/v/@oredata/sdk.svg)](https://www.npmjs.com/package/@oredata/sdk)
[![TypeScript](https://img.shields.io/badge/TypeScript-100%25-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

**Real-time SDK for ORE v3** — Build games, bots, and dashboards on top of Solana's most active on-chain RNG.

```bash
npm install @oredata/sdk
```

---

## ✨ Features

| | |
|---|---|
| 🎮 **Live Game State** | Round data, pot size, per-tile bets — updated every second |
| 🏆 **Winner Events** | Know who won instantly, not when the next round starts |
| 💰 **Wallet Tracking** | SOL balance, claimable rewards, ORE tokens |
| 💵 **Token Prices** | Real-time SOL & ORE in USD |
| 📊 **Token Data** | ORE supply, market cap, emission stats |
| ⏱️ **Countdown Timers** | Accurate countdowns using actual Solana slot times |
| 🔧 **Transaction Builders** | Place bids & claim rewards — no RPC setup needed |
| 💬 **Community Chat** | Send & receive ore.supply chat (unified ecosystem) |
| 🤖 **Bot Self-Service** | Register, manage keys, projects, T&C — all via wallet |
| ⚛️ **React Hooks** | Provider, hooks, auto-updates |
| 🖥️ **Server Multiplexer** | One API connection → 1000+ browser clients |
| 📝 **Full TypeScript** | Zero `any`, complete types |

---

## 🚀 Quick Start

### 1. Connect

```typescript
import { OredataClient } from '@oredata/sdk';

const client = new OredataClient({
  baseUrls: ['https://api.oredata.supply'],
  apiKey: process.env.OREDATA_API_KEY,  // Optional: get at oredata.supply
});

client.start();
```

### 2. Get Game State

```typescript
const store = client.getStore();

// Current round data
const round = store.getCurrentRound();
console.log(`Round ${round.roundId}: ${round.totals.deployedSol} SOL in pot`);

// Previous round winner
const prev = store.getPreviousRound();
if (prev?.winner) {
  console.log(`Last winner: Tile ${prev.winner.tile + 1}`);
}
```

### 3. Listen for Events

```typescript
// New round started
store.on('roundStarted', ({ roundId }) => {
  console.log(`🎲 Round ${roundId} - betting open!`);
});

// Winner announced
store.on('roundCompleted', ({ roundId, winner }) => {
  console.log(`🎉 Round ${roundId} winner: Tile ${winner.tile + 1}`);
});

// Pot updated
store.on('roundDataUpdated', ({ data }) => {
  console.log(`💰 Pot: ${data.totals.deployedSol} SOL`);
});
```

### Consent (new)

```typescript
import { ConsentClient, buildConsentMessage } from '@oredata/sdk';

const http = new OredataClient({ apiKey: process.env.OREDATA_API_KEY });
const consent = new ConsentClient({ http });

const terms = await consent.getTerms();
const status = await consent.getStatus(walletAddress);
if (status.status !== 'accepted') {
  const msg = buildConsentMessage({
    projectName: terms.project?.name,
    projectDomainOrSlug: terms.project?.domain ?? terms.project?.slug,
    walletAddress,
    version: terms.version,
  });
  const signature = await signMessage(new TextEncoder().encode(msg.message));
  await consent.accept({ walletAddress, signature: bs58.encode(signature), termsVersion: terms.version });
}
```

---

## 📦 What's Included

```
@oredata/sdk          → Core client, events, wallet tracking
@oredata/sdk/react    → React hooks & provider
@oredata/sdk/server   → Server-side multiplexer for SSE
```

---

## 🎯 Common Patterns

### Get Current Pot Size

```typescript
const round = store.getCurrentRound();
const pot = round?.totals.deployedSol ?? 0;
```

### Check If Round Is Active

```typescript
const round = store.getCurrentRound();
const isActive = round?.mining.status === 'active';
```

### Get Token Prices

```typescript
const solPrice = store.getSolPriceUsd();  // e.g., 242.50
const orePrice = store.getOrePriceUsd();  // e.g., 2.15
```

### Detect Winner

```typescript
store.on('roundCompleted', ({ winner, isHistorical }) => {
  if (isHistorical) return;  // Skip page-load replays
  showWinner(winner.tile + 1);  // 0-indexed → display
});
```

### Handle Tab Visibility (Pause/Resume)

```typescript
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    client.pause();  // Saves battery, reduces API calls
  } else {
    client.resume(); // Immediately fetches fresh data
  }
});
```

### Track Connection Health

```typescript
// Check if polling is healthy
if (!client.isPollingHealthy()) {
  showStaleDataWarning();
}

// Or listen for recovery
store.on('connectionChange', ({ status, previousStatus, downtimeMs }) => {
  if (status === 'connected' && previousStatus === 'unreachable') {
    console.log(`Reconnected after ${downtimeMs}ms`);
    refreshUI();
  }
});
```

### Place a Bid

```typescript
const { transaction } = await client.buildBidTransaction({
  authority: wallet.publicKey.toString(),
  tiles: [0, 4, 11],  // 0-indexed
  amountSol: 0.025,
});

const tx = Transaction.from(Buffer.from(transaction, 'base64'));
await wallet.signAndSendTransaction(tx);
```

### Claim Rewards

Two types of rewards can be claimed:

| Reward Type | SDK Method | What It Claims |
|-------------|------------|----------------|
| **SOL** | `buildClaimTransaction()` or `buildClaimSolTransaction()` | SOL winnings from the pot |
| **ORE** | `buildClaimOreTransaction()` | ORE token rewards (10% tax on unrefined) |

```typescript
// Check claimable amounts (via MinerClient)
const status = miner.getStatus();
console.log(`Claimable SOL: ${status.claimableSol}`);
console.log(`Claimable ORE: ${status.totalClaimableOre}`);

// Claim SOL rewards
const { transaction } = await client.buildClaimSolTransaction({
  authority: wallet.publicKey.toString(),
});

// Claim ORE tokens
const { transaction: oreTx } = await client.buildClaimOreTransaction({
  authority: wallet.publicKey.toString(),
});
```

### Track Wallet Balance

```typescript
import { MinerClient } from '@oredata/sdk';

const miner = new MinerClient({
  apiBaseUrl: 'https://api.oredata.supply',
  authority: wallet.publicKey.toString(),
});

miner.on('update', (status) => {
  console.log(`SOL: ${status.authoritySol}`);
  console.log(`Claimable: ${status.claimableSol}`);
  console.log(`ORE: ${status.unrefinedOre}`);
});

miner.start();
```

### Get Token Data

```typescript
import { TokenClient } from '@oredata/sdk';

const token = new TokenClient();

// Current supply & price
const info = await token.getInfo();
console.log(`Supply: ${Number(info.totalSupply).toLocaleString()} ORE`);
console.log(`Price: $${info.priceUsd}`);
console.log(`Market Cap: $${info.marketCapUsd}`);

// Emission statistics
const emissions = await token.getEmissions();
console.log(`${emissions.dailyEmissionOre} ORE/day`);
console.log(`Round ${emissions.currentRound}`);
console.log(`${emissions.daysSinceLaunch} days since V3 launch`);
```

### Send & Receive Chat

```typescript
import { ChatClient } from '@oredata/sdk';

const chat = new ChatClient();

// 1. Fetch history on startup (no more empty chat!)
const { messages, hasMore } = await chat.fetchHistory({ limit: 50 });
messages.forEach(msg => console.log(`${msg.username}: ${msg.text}`));

// 2. Connect to live stream
chat.on('message', (msg) => {
  console.log(`${msg.username}: ${msg.text}`);
});
chat.connect();

// 3. Send a message (unified ore.supply ecosystem!)
const result = await chat.send('Hello from my app!', wallet);
if (result.success) {
  console.log('Message sent to ore.supply chat!');
}
```

**Features:**
- **Permanent history** — Messages stored in database, fetch on page load
- **Pagination** — `before`/`after` params for infinite scroll
- **Session caching** — Sign once per 24 hours, even across refreshes

---

## ⚛️ React

```tsx
import { OredataProvider, useStore } from '@oredata/sdk/react';

function App() {
  return (
    <OredataProvider config={{ baseUrls: ['https://api.oredata.supply'] }}>
      <Game />
    </OredataProvider>
  );
}

function Game() {
  const { currentRound, isReady } = useStore();
  
  if (!isReady) return <div>Connecting...</div>;
  
  return <div>Pot: {currentRound?.totals.deployedSol} SOL</div>;
}
```

### Available Hooks

| Hook | Purpose |
|------|---------|
| `useStore()` | Round data, winners, connection status |
| `usePresenter()` | UI timing (phase transitions, animations) |
| `useRoundTiming()` | Countdown timer with progress |
| `useMinerAccount(pubkey)` | Wallet balance & rewards |
| `useBidTracker()` | Track bids placed this session |

→ [Full React docs](./docs/integrations/REACT.md)

---

## 🤖 Bot Self-Service

Bots can fully self-service via wallet authentication:

```typescript
import { SelfServiceClient } from '@oredata/sdk';

const client = new SelfServiceClient();

// 1. Register with wallet signature
const { nonce } = await client.auth.getNonce();
const message = client.auth.buildSignInMessage(walletAddress, nonce);
const signature = await signMessage(message);  // Your signing logic
await client.auth.register({ wallet: walletAddress, message, signature });

// 2. Manage API keys
const { keys } = await client.keys.list();
const newKey = await client.keys.create({ label: 'Production' });

// 3. Create projects for T&C
const { project } = await client.projects.create({
  name: 'My Bot',
  slug: 'my-bot',
});

// 4. Set up Terms of Service
const { terms } = await client.projects.createTerms(project.id, {
  version: '1.0.0',
  title: 'Terms of Service',
  bodyMd: '# Terms\n\nBy using this bot...',
});
await client.projects.activateTerms(terms.id);

// 5. Assign API key to project
await client.keys.assign(newKey.id, project.id);

// 6. View consents for compliance
const { consents } = await client.projects.listConsents(project.id);
```

→ [Full Self-Service docs](./docs/reference/SELF-SERVICE.md)

---

## 📚 Documentation

**Start Here:**
- [**Documentation Index**](./docs/README.md) — Quick navigation to all docs
- [**Core Concepts**](./docs/01-CORE-CONCEPTS.md) — Layer 1 vs Layer 2, isHistorical flag

**Reference (complete API docs):**

| Client | Description |
|--------|-------------|
| [OredataClient](./docs/reference/OREDATA-CLIENT.md) | Main client: state, transactions, polling |
| [OredataStore](./docs/reference/STORE.md) | Layer 1: immediate data events |
| [OredataState](./docs/reference/STATE.md) | Layer 2: UI timing events |
| [MinerClient](./docs/reference/MINER-CLIENT.md) | Wallet balance & rewards |
| [TokenClient](./docs/reference/TOKEN-CLIENT.md) | ORE token data |
| [ChatClient](./docs/reference/CHAT-CLIENT.md) | ore.supply community chat |
| [SelfServiceClient](./docs/reference/SELF-SERVICE.md) | Bot registration, keys, T&C |
| [Transactions](./docs/reference/TRANSACTIONS.md) | Building bids & claims |
| [Errors](./docs/reference/ERRORS.md) | Error types & handling |

**Integrations:**

| Framework | Docs |
|-----------|------|
| [React](./docs/integrations/REACT.md) | Hooks & provider |
| [Server](./docs/integrations/SERVER.md) | Multiplexer for 1000+ users |

**More:**
- [API Reference](./docs/API.md) — REST/SSE endpoints
- [Architecture](./docs/ARCHITECTURE.md) — Deep dive
- [Troubleshooting](./docs/TROUBLESHOOTING.md) — Common issues

**Tutorials & Recipes:** [oredata.supply/cookbook](https://oredata.supply/cookbook)

---

## 🔑 API Keys & Pricing

| Plan | Rate Limit | Price | Best For |
|------|------------|-------|----------|
| **Free** | 2/s | $0 | Prototyping |
| **Dev** | 12/s | $9/mo | Small games |
| **Pro** | 120/s | $19/mo | Production |
| **Ultra** | 240/s | $29/mo | High-traffic |

Get your API key:
- UI: [oredata.supply/register](https://oredata.supply/register)
- API (beta, programmatic): `POST https://api.oredata.supply/api/v1/register` (wallet-sign)

> ⚠️ **Beta** — rate limits enforced; billing/fee revenue in progress.

---

## 💬 Support

- 🌐 [oredata.supply](https://oredata.supply) — Get API key
- 🐛 [GitHub Issues](https://github.com/oredata-supply/oredata-sdk/issues) — Report bugs
- 💬 [ORE Discord](https://discord.com/invite/4TQfshAAsT) — Community

---

## 📄 License

MIT © [oredata.supply](https://oredata.supply)
