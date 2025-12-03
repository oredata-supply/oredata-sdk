# Quick Start Guide

> **Read First:** [ARCHITECTURE.md](./ARCHITECTURE.md) — Understand Layer 1 vs Layer 2 before starting.

---

## 1. Install

```bash
npm install @oredata/sdk
```

---

## 2. Basic Setup (Winner Detection)

```typescript
import { OredataClient } from '@oredata/sdk';

const client = new OredataClient({
  baseUrls: ['https://ore-api.gmore.fun'],
  apiKey: process.env.OREDATA_API_KEY, // Get at oredata.supply/register
  pollIntervalMs: 1000,
});

// Layer 1: Data events (immediate, use for game logic)
const store = client.getStore();

store.on('roundStarted', ({ roundId, isHistorical }) => {
  if (isHistorical) return; // Skip old events on page load
  console.log(`🎲 Round ${roundId} started - betting open!`);
});

store.on('roundCompleted', ({ roundId, winner, isHistorical }) => {
  if (isHistorical) return;
  console.log(`🎉 Round ${roundId} winner: Tile ${winner.tile}!`);
});

store.on('roundDataUpdated', ({ data }) => {
  console.log(`💰 Pot: ${data.totals.deployedSol} SOL`);
});

// Start polling
client.getStateClient().start();
```

**Important:** Always check `isHistorical` to avoid processing old events on page load.

---

## 3. React Integration

```tsx
import { OredataProvider, useStore } from '@oredata/sdk/react';

function App() {
  return (
    <OredataProvider config={{ 
      baseUrls: ['https://ore-api.gmore.fun'],
      apiKey: process.env.REACT_APP_OREDATA_API_KEY,
    }}>
      <Game />
    </OredataProvider>
  );
}

function Game() {
  const { currentRound, isConnected } = useStore();
  
  if (!isConnected) return <div>Connecting...</div>;
  if (!currentRound) return <div>Loading...</div>;
  
  return (
    <div>
      <h1>Round {currentRound.roundId}</h1>
      <p>Pot: {currentRound.totals.deployedSol} SOL</p>
      {currentRound.winner && (
        <p>Winner: Tile {currentRound.winner.tile}</p>
      )}
    </div>
  );
}
```

→ [Full React docs](./REACT.md)

---

## 4. API Plans

| Plan | Rate Limits | Winner Delay | Bid Lockout | Price |
|------|-------------|--------------|-------------|-------|
| **Free** | 2/s, 20/min | 5s | 5s before end | $0 |
| **Dev** | 12/s, 600/min | 4s | 4s before end | $9/mo |
| **Pro** | 120/s, 10k/min | 3s | 3s before end | $19/mo |
| **Ultra** | 240/s, 60k/min | None | None | $29/mo |

**Winner Delay:** Lower-tier plans see winner data with a delay.  
**Bid Lockout:** Cannot bid in final seconds of round.

Get your API key at [oredata.supply/register](https://oredata.supply/register)

---

## 5. Build & Send Bid

```typescript
import { Transaction } from '@solana/web3.js';

// 1. Get ready-to-sign transaction
const { transaction, blockhash, lastValidBlockHeight } = await client.buildBidTransaction({
  authority: wallet.publicKey.toString(),
  tiles: [0, 4, 11],  // 0-indexed (0-24)
  amountSol: 0.025,   // Per tile
});

// 2. Decode and sign
const tx = Transaction.from(Buffer.from(transaction, 'base64'));
const signedTx = await wallet.signTransaction(tx);

// 3. Relay through API (no RPC needed!)
const { signature } = await client.relayTransaction({
  transaction: Buffer.from(signedTx.serialize()).toString('base64'),
  blockhash,
  lastValidBlockHeight,
});
```

→ [Full transaction docs](./TRANSACTIONS.md)

---

## 6. Server Multiplexer (100+ Users)

For production games, use a backend to poll once and broadcast to all clients:

```typescript
import { OredataClient } from '@oredata/sdk';
import { Server } from 'socket.io';

const client = new OredataClient({
  baseUrls: ['https://ore-api.gmore.fun'],
  apiKey: process.env.OREDATA_API_KEY,
});

const store = client.getStore();
const io = new Server(httpServer);

store.on('roundCompleted', ({ winner, isHistorical }) => {
  if (isHistorical) return;
  io.emit('winner', { tile: winner.tile });
});

client.getStateClient().start();
```

→ [Full server docs](./SERVER.md)

---

## 7. Key Concepts

### Layer 1 vs Layer 2

| Layer | Events | Use For |
|-------|--------|---------|
| **Layer 1** (OredataStore) | `roundStarted`, `roundCompleted`, `roundDataUpdated` | Game logic |
| **Layer 2** (OredataState) | `phaseChange`, `winnerReveal` | UI animations |

**Always use Layer 1 for:**
- Enabling/disabling betting
- Detecting winners
- Business logic

→ [Full architecture docs](./ARCHITECTURE.md)

### The `isHistorical` Flag

When your app connects, it receives events for rounds that already happened.

```typescript
store.on('roundCompleted', ({ winner, isHistorical }) => {
  if (isHistorical) return; // Skip old events!
  
  playWinnerAnimation(winner.tile);
});
```

---

## 8. REST Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /v3/state` | Game state, phase, frames |
| `GET /v3/health` | Health check (not rate limited) |
| `POST /v3/tx/bid` | Build bid transaction |
| `POST /v3/tx/claim` | Build claim transaction |

→ [Full API reference](./API.md)

---

## Next Steps

- [Architecture](./ARCHITECTURE.md) — Layer 1 vs Layer 2 explained
- [OredataStore API](./STORE.md) — Full data access reference
- [Examples](../examples/) — Copy-paste code examples
- [Troubleshooting](./TROUBLESHOOTING.md) — Common issues

---

## Environment

> We only run on **mainnet-beta**. No devnet. Test with small SOL amounts.
