# @oredata/sdk

[![npm version](https://img.shields.io/npm/v/@oredata/sdk.svg)](https://www.npmjs.com/package/@oredata/sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

> Real-time data SDK for **ORE v3** mining bots, apps, and on-chain RNG-based games or similar implementations. Build on the always well-capitalized RNG that runs better than any well-oiled engine.

Build games on top of the ORE protocol with live state, winner detection, wallet tracking, and transaction builders.

```bash
npm install @oredata/sdk
```

---

## ⚠️ Choose Your Pattern First

> **Read [ARCHITECTURE.md](./docs/ARCHITECTURE.md) before starting!** Understanding Layer 1 vs Layer 2 will save you days of debugging.

| Building... | Use This | Events |
|-------------|----------|--------|
| 🎮 **Game with winners** | `OredataClient` + `store.on('roundCompleted')` | Layer 1 |
| 📊 **Dashboard** | `OredataClient` + `store.on('roundDataUpdated')` | Layer 1 |
| 🖥️ **SSE to browsers** | `createMultiplexer` (for streaming only) | - |
| 💰 **Wallet display** | `MinerClient` | - |
| ⏱️ **Countdown timer** | `useRoundTiming()` or `getRoundTiming()` | - |

**Layer 1** = Immediate events, use for game logic  
**Layer 2** = Delayed events, use for UI animations only

---

## 30-Second Demo

```typescript
import { OredataClient } from '@oredata/sdk';

const client = new OredataClient({
  baseUrls: ['https://ore-api.gmore.fun'],
  apiKey: process.env.OREDATA_API_KEY, // Get at oredata.supply/register
});

// Layer 1: Immediate data events
const store = client.getStore();

store.on('roundStarted', ({ roundId, isHistorical }) => {
  if (isHistorical) return; // Skip cold load replays
  console.log(`🎲 Round ${roundId} started - betting open!`);
});

store.on('roundCompleted', ({ roundId, winner, isHistorical }) => {
  if (isHistorical) return;
  console.log(`🎉 Round ${roundId} winner: Tile ${winner.tile}!`);
});

store.on('roundDataUpdated', ({ data }) => {
  console.log(`💰 Pot: ${data.totals.deployedSol} SOL`);
});

client.start();
```

**That's it.** Winners announced immediately, not when the next round starts.

---

## What Can You Build?

| Use Case | Features |
|----------|----------|
| 🎮 **Games** | Live state, phase detection, winner events, bid tracking |
| 📊 **Dashboards** | Pot tracking, historical rounds, miner analytics |
| 🤖 **Bots** | Transaction builders, auto-bidding, alert systems |
| 📱 **Mobile** | React Native compatible, works with any JS runtime |

---

## Features

- **🔄 Real-time state** — REST polling or SSE streaming
- **🏆 Winner detection** — Optimistic + final winner events
- **💰 Wallet tracking** — SOL balance, claimable rewards, ORE tokens
- **💵 Token prices** — Real-time SOL & ORE prices in USD
- **⏱️ Countdown timers** — `useRoundTiming()` with actual network timing
- **⚛️ React hooks** — `useMinerAccount`, `useBidTracker`, `useRoundTiming`
- **🖥️ Server multiplexer** — One API connection for 1000+ users
- **🛡️ Error handling** — Typed errors, auto-retry, rate limit backoff
- **📝 TypeScript** — Full types, zero `any`

---

## Plans & Pricing

| Plan | Rate Limit | Price | Best For |
|------|------------|-------|----------|
| **Free** | 2/s, 20/min | $0 | Prototypes |
| **Dev** | 12/s, 600/min | $9/mo | Small games |
| **Pro** | 120/s, 10k/min | $19/mo | Production |
| **Ultra** | 240/s, 60k/min | $29/mo | High-traffic |

Get your API key at [oredata.supply/register](https://oredata.supply/register)

> ⚠️ **BETA** — Currently free. Rate limiting applies per IP without key (15/s, 180/min).

---

## Documentation

| Guide | Description |
|-------|-------------|
| 🏗️ [**Architecture**](./docs/ARCHITECTURE.md) | **READ FIRST** — Layer 1 vs Layer 2, choose your pattern |
| 📖 [**Quick Start**](./docs/QUICKSTART.md) | First integration in 5 minutes |
| 🗄️ [**OredataStore (Layer 1)**](./docs/STORE.md) | Data access, round history, events |
| 💸 [**Transactions**](./docs/TRANSACTIONS.md) | Build, sign, send bids & claims |
| 🔌 [**API Reference**](./docs/API.md) | All REST/SSE endpoints |
| ⚛️ [**React Hooks**](./docs/REACT.md) | Provider, hooks, error boundaries |
| ⏱️ [**Timing & Countdown**](./docs/REACT.md#useroundtiming-) | Accurate countdown timers |
| 🖥️ [**Server Multiplexer**](./docs/SERVER.md) | Scale to 1000+ users |
| 🔧 [**Troubleshooting**](./docs/TROUBLESHOOTING.md) | Common issues & anti-patterns |

---

## Quick Examples

### React App

```tsx
import { OredataProvider, useStore, usePresenter } from '@oredata/sdk/react';

function App() {
  return (
    <OredataProvider config={{ baseUrls: ['https://ore-api.gmore.fun'] }}>
      <Game />
    </OredataProvider>
  );
}

function Game() {
  // Layer 1: Data
  const { currentRound, previousRound, isConnected } = useStore();
  // Layer 2: UI timing (optional)
  const { displayPhase, displayedWinner } = usePresenter();
  
  if (!isConnected) return <div>Connecting...</div>;
  
  const pot = currentRound?.totals?.deployedSol ?? 0;
  
  return (
    <div>
      <h1>{displayPhase}</h1>
      <p>{pot.toFixed(4)} SOL in pot</p>
      {displayedWinner !== null && <p>Winner: Tile {displayedWinner + 1}</p>}
    </div>
  );
}
```

→ [Full React docs](./docs/REACT.md)

### Track Wallet

```typescript
const miner = client.getMinerClient('YourWalletPubkey');

miner.on('update', (status) => {
  console.log(`Balance: ${status.authoritySol} SOL`);
  console.log(`Claimable: ${status.claimableSol} SOL`);
  console.log(`ORE Rewards: ${status.unrefinedOre} ORE`);
});

miner.start();
```

### Build & Send Bid (v0.7.0+)

```typescript
// 1. Get ready-to-sign transaction from API
const { transaction, blockhash, lastValidBlockHeight } = await client.buildBidTransaction({
  authority: wallet.publicKey.toString(),
  tiles: [0, 4, 11],  // 0-indexed (0-24)
  amountSol: 0.025,
});

// 2. Decode and sign
const tx = Transaction.from(Buffer.from(transaction, 'base64'));
const signedTx = await wallet.signTransaction(tx);

// 3. Relay through API (no direct RPC needed!)
const { signature, confirmed } = await client.relayTransaction({
  transaction: Buffer.from(signedTx.serialize()).toString('base64'),
  blockhash,
  lastValidBlockHeight,
});
```

**Zero RPC configuration needed** — the API handles everything.

### Server Multiplexer (100+ users)

```typescript
import express from 'express';
import { createMultiplexer, expressSSE } from '@oredata/sdk/server';

const app = express();
const multiplexer = createMultiplexer({
  apiBaseUrl: 'https://ore-api.gmore.fun',
  apiKey: process.env.ORE_API_KEY,
});

multiplexer.start();
app.get('/events', expressSSE(multiplexer));
app.listen(3000);
```

→ [Full multiplexer docs](./docs/SERVER.md)

---

## Error Handling

```typescript
import { OredataRateLimitError, OredataLockoutError } from '@oredata/sdk';

try {
  await client.buildBidTransaction({ ... });
} catch (e) {
  if (OredataRateLimitError.is(e)) {
    console.log(e.helpMessage); // "Rate limited. Upgrade: https://..."
    await sleep(e.retryAfterMs);
  }
  if (OredataLockoutError.is(e)) {
    console.log(`Bid locked. Wait ${e.lockoutSeconds}s or upgrade.`);
  }
}
```

---

## Packages

| Import | Use Case |
|--------|----------|
| `@oredata/sdk` | Core client, state engine, wallet tracking |
| `@oredata/sdk/react` | React hooks and provider |
| `@oredata/sdk/server` | Server-side multiplexer |

---

## Examples

25 examples organized by complexity:

```bash
# Check game phase
npx tsx examples/01-simple/01-check-phase.ts

# React dashboard
cd examples/06-react-dashboard && npm run dev
```

→ [All examples](https://github.com/oredata-supply/oredata-sdk/tree/main/examples)

---

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for version history.

**Latest: v0.12.0** — SDK cleanup: removed deprecated hooks and legacy types

---

## Links

- 🌐 [oredata.supply](https://oredata.supply) — Get API key
- 📚 [API Docs](./docs/API.md) — Endpoint reference
- 🐛 [Issues](https://github.com/oredata-supply/oredata-sdk/issues) — Report bugs
- 💬 [Discord](https://discord.gg/ore) — Community

---

## License

MIT © [oredata.supply](https://oredata.supply)
