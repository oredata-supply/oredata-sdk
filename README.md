# @oredata/sdk

[![npm version](https://img.shields.io/npm/v/@oredata/sdk.svg)](https://www.npmjs.com/package/@oredata/sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

> Real-time data SDK for **ORE Mining** games on Solana.

Build games on top of the ORE protocol with live state, winner detection, wallet tracking, and transaction builders.

```bash
npm install @oredata/sdk
```

---

## 30-Second Demo

```typescript
import { OredataClient } from '@oredata/sdk';

const client = new OredataClient({
  baseUrls: ['https://ore-api.gmore.fun'],
});

// Get live game state
const stateClient = client.getStateClient();

stateClient.on('snapshot', (state) => {
  console.log(`Round ${state.currentRoundId}: ${state.pot} SOL in pot`);
});

stateClient.on('winner', ({ winner }) => {
  console.log(`🎉 Tile ${winner} wins!`);
});

stateClient.start();
```

**That's it.** You're now receiving real-time game updates.

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
- **⚛️ React hooks** — `useOredataState`, `useMinerAccount`, `useBidTracker`
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
| 📖 [**Quick Start**](./docs/QUICKSTART.md) | First integration in 5 minutes |
| 🔌 [**API Reference**](./docs/API.md) | All REST/SSE endpoints |
| ⚛️ [**React Hooks**](./docs/REACT.md) | Provider, hooks, error boundaries |
| 🖥️ [**Server Multiplexer**](./docs/SERVER.md) | Scale to 1000+ users |
| 🔧 [**Troubleshooting**](./docs/TROUBLESHOOTING.md) | Common issues & fixes |

---

## Quick Examples

### React App

```tsx
import { OredataProvider, useOredataState } from '@oredata/sdk/react';

function App() {
  return (
    <OredataProvider config={{ baseUrls: ['https://ore-api.gmore.fun'] }}>
      <Game />
    </OredataProvider>
  );
}

function Game() {
  const { phase, pot, winner, isConnected } = useOredataState();
  
  if (!isConnected) return <div>Connecting...</div>;
  
  return (
    <div>
      <h1>{phase}</h1>
      <p>{pot} SOL in pot</p>
      {winner && <p>Winner: Tile {winner}</p>}
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
  tiles: [1, 5, 12],
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
  await client.buildBidInstructions({ ... });
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

**Latest: v0.7.0** — Transaction relay (no RPC needed!), V3 transactions, `getPlans()`

---

## Links

- 🌐 [oredata.supply](https://oredata.supply) — Get API key
- 📚 [API Docs](./docs/API.md) — Endpoint reference
- 🐛 [Issues](https://github.com/oredata-supply/oredata-sdk/issues) — Report bugs
- 💬 [Discord](https://discord.gg/ore) — Community

---

## License

MIT © [oredata.supply](https://oredata.supply)
