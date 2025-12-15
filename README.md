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

→ [Full React docs](./docs/REACT.md)

---

## 📚 Documentation

| Guide | Description |
|-------|-------------|
| [**Quick Start**](./docs/QUICKSTART.md) | First integration in 5 minutes |
| [**OredataStore**](./docs/STORE.md) | Events, round history, winner detection |
| [**Transactions**](./docs/TRANSACTIONS.md) | Build, sign, send bids & claims |
| [**React Hooks**](./docs/REACT.md) | Provider, hooks, patterns |
| [**Server Multiplexer**](./docs/SERVER.md) | Scale to 1000+ users |
| [**API Reference**](./docs/API.md) | REST/SSE endpoints |
| [**Architecture**](./docs/ARCHITECTURE.md) | Layer 1 vs Layer 2 (advanced) |
| [**Troubleshooting**](./docs/TROUBLESHOOTING.md) | Common issues & anti-patterns |

---

## 🔑 API Keys & Pricing

| Plan | Rate Limit | Price | Best For |
|------|------------|-------|----------|
| **Free** | 2/s | $0 | Prototyping |
| **Dev** | 12/s | $9/mo | Small games |
| **Pro** | 120/s | $19/mo | Production |
| **Ultra** | 240/s | $29/mo | High-traffic |

Get your API key at [oredata.supply/register](https://oredata.supply/register)

> ⚠️ **Currently in beta** — all plans free during beta period.

---

## 💬 Support

- 🌐 [oredata.supply](https://oredata.supply) — Get API key
- 🐛 [GitHub Issues](https://github.com/oredata-supply/oredata-sdk/issues) — Report bugs
- 💬 [Discord](https://discord.gg/ore) — Community

---

## 📄 License

MIT © [oredata.supply](https://oredata.supply)
