# @oredata/sdk Documentation

> **Real-time SDK for ORE v3** — Build games, bots, and dashboards on Solana's most active on-chain RNG.

## Quick Navigation

| I want to... | Go to |
|--------------|-------|
| Get started in 5 minutes | [Installation & Setup](#installation) |
| Understand the architecture | [Core Concepts](./01-CORE-CONCEPTS.md) |
| Look up a specific client | [Reference Documentation](#reference) |
| See working examples | [Examples](../../examples/) or [oredata.supply/examples](https://oredata.supply/examples) |
| Troubleshoot an issue | [Troubleshooting](./TROUBLESHOOTING.md) |

---

## Installation

```bash
npm install @oredata/sdk
```

### Get an API Key

| Method | When to Use |
|--------|-------------|
| [Web Dashboard](https://oredata.supply/register) | One-time setup for humans |
| [Programmatic](./reference/SELF-SERVICE.md) | Automated bots and scripts |

### Hello World

```typescript
import { OredataClient } from '@oredata/sdk';

const client = new OredataClient({
  baseUrls: ['https://api.oredata.supply'],
  apiKey: process.env.OREDATA_API_KEY,
});

const store = client.getStore();

store.on('roundCompleted', ({ winner, isHistorical }) => {
  if (isHistorical) return; // Skip replays on connect
  console.log(`Winner: Tile ${winner.tile + 1}`);
});

client.start();
```

---

## Core Concepts

Before diving into the API reference, understand these key concepts:

### Layer 1 vs Layer 2

| Layer | Purpose | Events | Use For |
|-------|---------|--------|---------|
| **Layer 1** (`OredataStore`) | Raw data | `roundStarted`, `roundCompleted`, `roundDataUpdated` | Game logic, enabling/disabling bets |
| **Layer 2** (`OredataState`) | UI timing | `phaseChange`, `winnerReveal` | Animations, transitions |

**Rule:** Use Layer 1 for business logic. Layer 2 is only for visual effects.

### The `isHistorical` Flag

When you connect, the SDK replays recent events. Always check this flag:

```typescript
store.on('roundCompleted', ({ winner, isHistorical }) => {
  if (isHistorical) return; // Don't animate old winners
  playWinnerAnimation(winner.tile);
});
```

Learn more: [Core Concepts](./01-CORE-CONCEPTS.md)

---

## Reference

Detailed API documentation for each client:

### Main Clients

| Client | Purpose | Docs |
|--------|---------|------|
| `OredataClient` | Game state, transactions, polling | [reference/OREDATA-CLIENT.md](./reference/OREDATA-CLIENT.md) |
| `OredataStore` | Layer 1 data events | [reference/STORE.md](./reference/STORE.md) |
| `OredataState` | Layer 2 UI timing | [reference/STATE.md](./reference/STATE.md) |

### Specialized Clients

| Client | Purpose | Docs |
|--------|---------|------|
| `MinerClient` | Wallet balance & rewards | [reference/MINER-CLIENT.md](./reference/MINER-CLIENT.md) |
| `TokenClient` | ORE token data (no auth) | [reference/TOKEN-CLIENT.md](./reference/TOKEN-CLIENT.md) |
| `ChatClient` | ore.supply community chat | [reference/CHAT-CLIENT.md](./reference/CHAT-CLIENT.md) |
| `ConsentClient` | Terms & conditions | [reference/CONSENT-CLIENT.md](./reference/CONSENT-CLIENT.md) |
| `SelfServiceClient` | Bot registration & keys | [reference/SELF-SERVICE.md](./reference/SELF-SERVICE.md) |

### Transactions & Errors

| Topic | Docs |
|-------|------|
| Building & relaying transactions | [reference/TRANSACTIONS.md](./reference/TRANSACTIONS.md) |
| Error types & handling | [reference/ERRORS.md](./reference/ERRORS.md) |

### Framework Integrations

| Framework | Docs |
|-----------|------|
| React hooks & provider | [integrations/REACT.md](./integrations/REACT.md) |
| Server-side multiplexer | [integrations/SERVER.md](./integrations/SERVER.md) |

---

## Import Paths

```typescript
// Main SDK (browser + Node.js)
import {
  OredataClient,
  SelfServiceClient,
  MinerClient,
  TokenClient,
  ChatClient,
  ConsentClient,
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
  expressSSE,
} from '@oredata/sdk/server';
```

---

## API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /v3/state` | Game state, phase, frames |
| `GET /v3/health` | Health check (no rate limit) |
| `POST /v3/tx/bid` | Build bid transaction |
| `POST /v3/tx/claim` | Build claim transaction |
| `POST /v3/tx/relay` | Relay signed transaction |

Full reference: [API.md](./API.md)

---

## Pricing

| Plan | Rate Limit | Price |
|------|------------|-------|
| Free | 2/s | $0 |
| Dev | 12/s | $9/mo |
| Pro | 120/s | $19/mo |
| Ultra | 240/s | $29/mo |

---

## More Resources

- **Tutorials & Recipes:** [oredata.supply/examples](https://oredata.supply/examples)
- **Runnable Examples:** [`packages/examples/`](../../examples/)
- **Troubleshooting:** [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
- **Architecture Deep Dive:** [ARCHITECTURE.md](./ARCHITECTURE.md)
- **Changelog:** [CHANGELOG.md](../CHANGELOG.md)

---

## Environment

> **Mainnet-beta only.** No devnet. Test with small SOL amounts.
