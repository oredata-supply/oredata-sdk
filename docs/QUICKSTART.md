# oredata.supply Integration Quick Start

> **Full Documentation:** [README.md](../README.md)

This is a quick-start guide for game developers integrating with oredata.supply. For comprehensive documentation including React hooks, server multiplexer, and advanced configuration, see the full SDK documentation.

---

## 1. Install

```bash
npm install @oredata/sdk
```

---

## 2. Quick Start

```ts
import { OredataClient } from '@oredata/sdk';

const client = new OredataClient({
  baseUrls: ['https://ore-api.gmore.fun'],
  apiKey: 'your-api-key', // Get one at https://oredata.supply/register
});

const stateClient = client.getStateClient();

stateClient.on('snapshot', (snapshot) => {
  console.log(`Phase: ${snapshot.phase}, Round: ${snapshot.currentRoundId}`);
});

stateClient.on('winner', (event) => {
  console.log(`Winner on tile ${event.winningSquareIndex}!`);
});

stateClient.start();
```

---

## 3. API Plans

| Plan | Rate Limits | Monthly Quota | Bid Lockout | Winner Delay | Price |
| --- | --- | --- | --- | --- | --- |
| `free` | 2/s, 20/min | Unlimited | 5s before end | 5s embargo | $0 |
| `dev` | 12/s, 600/min | 1M requests | 4s before end | 4s embargo | $9/mo |
| `pro` | 120/s, 10k/min | 50M requests | 3s before end | 3s embargo | $19/mo |
| `ultra` | 240/s, 60k/min | Unlimited | None | Instant | $29/mo |

**Important:** Rate limits are per API key, not per user. 100 users sharing your key = 100× pressure on YOUR limit.

→ Use [server-side multiplexer](../README.md#server-multiplexer-oredatasdkserver) for production games.

---

## 4. Deployment Patterns

### Pattern A: Direct Polling (Simple)

Each browser polls directly. Best for prototypes, <10 users.

### Pattern B: Server Multiplexer (Recommended)

Your server polls once, broadcasts to all clients.

```ts
import { createMultiplexer, expressSSE } from '@oredata/sdk/server';

const multiplexer = createMultiplexer({
  apiBaseUrl: 'https://ore-api.gmore.fun',
  apiKey: process.env.OREDATA_API_KEY,
});

multiplexer.start();
app.get('/events', expressSSE(multiplexer));
```

→ [Full multiplexer docs](../README.md#server-multiplexer-oredatasdkserver)

---

## 5. React Quick Start

```tsx
import { OredataProvider, useOredataState } from '@oredata/sdk/react';

function App() {
  return (
    <OredataProvider config={{ baseUrls: ['https://ore-api.gmore.fun'], apiKey }}>
      <Game />
    </OredataProvider>
  );
}

function Game() {
  const { phase, winner, pot, isConnected } = useOredataState();
  if (!isConnected) return <Loading />;
  return <GameUI phase={phase} pot={pot} winner={winner} />;
}
```

→ [Full React hooks docs](../README.md#react-hooks-oredatasdkreact)

---

## 6. Build & Send Bid (v0.5.0+)

```typescript
import { Transaction } from '@solana/web3.js';

// 1. Get ready-to-sign transaction from API
const { transaction, blockhash, lastValidBlockHeight } = await client.buildBidTransaction({
  authority: wallet.publicKey.toString(),
  tiles: [0, 4, 11],  // 0-indexed (0-24)
  amountSol: 0.025, // Per tile
});

// 2. Decode and send
const tx = Transaction.from(Buffer.from(transaction, 'base64'));
const sig = await wallet.sendTransaction(tx, connection);

// 3. Confirm
await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight });
```

No manual instruction assembly needed — the API returns a complete transaction.

---

## 7. REST Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /v3/state` | Game state, phase, frames |
| `GET /v3/bids` | Bid data for round |
| `GET /v3/health` | Health check (free) |
| `GET /v3/quota` | Usage/billing (free) |
| `GET /v3/plans` | Plan pricing & features (free) |
| `POST /v3/tx/bid` | Build bid transaction (ready-to-sign) |
| `POST /v3/tx/claim` | Build claim transaction (ready-to-sign) |

→ [Full API Reference](./API.md)

---

## 8. Key Tips

1. **Use the last frame:** `frames[frames.length - 1]` (SDK handles this)
2. **Hold RESULT phase:** 15s so users see results
3. **Minimum spin time:** 4s even if winner arrives early
4. **Handle lockouts gracefully:** Show "Betting closes soon!", not "Upgrade your plan"
5. **Track bids client-side:** Use `BidTracker` for win detection

---

## Need More?

- **Full SDK docs:** [README.md](../README.md)
- **API reference:** [API.md](./API.md)
- **Troubleshooting:** [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
- **Examples:** [packages/examples](../../examples/)

---

## Environment

> We only run on **mainnet-beta**. No devnet or sandbox. Test with small SOL amounts.

