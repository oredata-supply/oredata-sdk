# Oredata API Reference

> **For TypeScript users:** The `@oredata/sdk` package provides typed clients for all these endpoints. See [README.md](../README.md).

The oredata.supply API exposes HTTP and SSE endpoints for real-time ORE mining game data.

## Base URL

| Environment | Base URL |
| --- | --- |
| Production | `https://api.oredata.supply` |

## Authentication

API keys are passed via `X-Api-Key` header or `apiKey` query parameter.

```bash
# Header (recommended)
curl -H "X-Api-Key: your-key" https://api.oredata.supply/v3/state

# Query parameter
curl "https://api.oredata.supply/v3/state?apiKey=your-key"
```

Anonymous access uses IP-based rate limits (15/s, 180/min).

---

## Rate Limits

### Without API Key (IP-based)

| Limit | Value |
|-------|-------|
| Per second | 15 |
| Per minute | 180 |

### With API Key (Plan-based)

| Plan | Short (per sec) | Long (per min) | Monthly Quota |
| --- | --- | --- | --- |
| `free` | 2 | 20 | Unlimited |
| `dev` | 12 | 600 | 1M requests |
| `pro` | 120 | 10,000 | 50M requests |
| `ultra` | 240 | 60,000 | Unlimited |

**Rate limit headers:**
- `X-RateLimit-Limit-Short` / `X-RateLimit-Remaining-Short`
- `X-RateLimit-Limit-Long` / `X-RateLimit-Remaining-Long`
- `Retry-After` (on 429)

---

## Plan Features

| Plan | Bid Lockout | Winner Delay | Price |
| --- | --- | --- | --- |
| `free` | 5s before round ends | 5s after round ends | $0 |
| `dev` | 4s before round ends | 4s after round ends | $9/mo |
| `pro` | 3s before round ends | 3s after round ends | $19/mo |
| `ultra` | None | Instant | $29/mo |

**Bid Lockout**: Lower-tier plans cannot submit bids in the final seconds of the betting phase. Returns HTTP 423 during lockout.

**Winner Delay**: Lower-tier plans receive winner information with a delay after round ends.

---

## Endpoints

### Health & Monitoring

#### `GET /v3/health`

Primary readiness and observability endpoint. **Not rate limited.**

```json
{
  "timestamp": "2025-11-26T23:33:10.812Z",
  "api": { "status": "healthy", "uptimeSeconds": 86400 },
  "rpc": {
    "status": "healthy",
    "activeRole": "primary",
    "failoverActive": false
  },
  "game": {
    "status": "running",
    "currentRoundId": "66650",
    "latestFinalizedRoundId": "66649",
    "lastLiveUpdateAt": "2025-11-26T23:31:05.120Z"
  },
  "network": {
    "currentSlot": "123456789",
    "slotDurationMs": 385
  }
}
```

**Network fields:**
- `slotDurationMs` — Actual network slot duration (polled from Solana every 15s, default 400)

#### `GET /v3/quota`

Returns rate limit status and monthly billing quota for your API key. **Requires authentication.**

```json
{
  "plan": "dev",
  "rateLimits": {
    "live": {
      "short": { "limit": 12, "used": 4, "remaining": 8, "windowSeconds": 1 },
      "long": { "limit": 600, "used": 12, "remaining": 588, "windowSeconds": 60 }
    }
  },
  "billing": {
    "periodStart": "2025-11-01T00:00:00.000Z",
    "periodEnd": "2025-12-01T00:00:00.000Z",
    "daysRemaining": 15,
    "liveRequests": { "used": 150000, "limit": 1000000, "remaining": 850000 }
  }
}
```

---

### Game State

#### `GET /v3/state`

Primary polling endpoint. Returns game state with round frames.

| Query Param | Type | Default | Description |
| --- | --- | --- | --- |
| `frames` | integer | 2 | Number of round frames to return |
| `apiKey` | string | - | API key (or use header) |

**Response:**

```json
{
  "data": {
    "frames": [
      {
        "roundId": "12345",
        "liveData": {
          "mode": "betting",
          "deployedSol": "45.67",
          "tiles": [...]
        },
        "optimisticWinner": null,
        "finalWinner": { "winningSquareIndex": 7, ... }
      }
    ],
    "globals": {
      "treasury": { "totalOreRewards": "1234.56" },
      "currentSlot": "259219923",
      "solPrice": { "priceUsdRaw": "242.50" },
      "orePrice": { "priceUsdRaw": "2.15" }
    },
    "optimized": {
      "currentSlot": "259219923",
      "slotDurationMs": 385,
      "solPriceUsd": "242.50",
      "orePriceUsd": "2.15",
      "phase": "BETTING",
      "phaseUntil": "2025-12-15T17:45:30.000Z",
      "platformFeeRate": 0.015,
      "nextRound": { "roundId": "12346", "startSlot": "259221000" }
    },
    "currentRoundId": "12345",
    "latestFinalizedRoundId": "12344"
  },
  "meta": {
    "winnerRevealIn": 0
  }
}
```

**Token Prices:** Available in both `globals` (raw format) and `optimized` (parsed format):
- `optimized.solPriceUsd` — Real-time SOL price in USD (e.g., `"242.50"`)
- `optimized.orePriceUsd` — Real-time ORE price in USD (e.g., `"2.15"`)

**Timing Data:**
- `optimized.slotDurationMs` — Actual network slot duration in ms
- `optimized.nextRound` — Next round info (when detected during breather)
- `optimized.phaseUntil` — When current phase ends (ISO timestamp)

**Platform Fees (SSOT):**
- `optimized.platformFeeRate` — Current fee rate (0.0025-0.025). Display this to users before bidding.
  - 0.0025 (0.25%) when >10s remaining
  - Up to 0.025 (2.5%) in the last second
  - Same value is used by `buildBidTransaction()` — no client calculation needed

**Winner Delay:** When `meta.winnerRevealIn > 0`, winner info is temporarily hidden based on your plan.

#### `GET /v3/bids`

Returns bid data for the current or specified round.

| Query Param | Type | Default | Description |
| --- | --- | --- | --- |
| `roundId` | string | current | Specific round to fetch |

```json
{
  "roundId": "12345",
  "bids": [
    { "square": 0, "amountRaw": "1000000000", "amountSol": "1", "count": 3 }
  ],
  "uniqueMiners": 18
}
```

#### `GET /round/:roundId`

Detailed payload for a specific round, including winner breakdown.

```json
{
  "roundId": "12345",
  "liveData": { ... },
  "optimisticWinner": { ... },
  "finalWinner": { ... },
  "winnerDetails": {
    "status": "ready",
    "snapshot": {
      "winningSquareIndex": 7,
      "miners": [
        {
          "authority": "7q2...abc",
          "deployedRaw": "3000000000",
          "shareBps": 2436,
          "estSolPayoutRaw": "11100000000"
        }
      ]
    }
  }
}
```

---

### Streaming (SSE)

#### `GET /events`

Real-time Server-Sent Events stream.

```bash
curl -N -H "Accept: text/event-stream" \
  "https://api.oredata.supply/events?apiKey=your-key"
```

| Query Param | Type | Default | Description |
| --- | --- | --- | --- |
| `includeBids` | boolean | false | Include bid updates in stream |
| `apiKey` | string | - | API key for plan-based features |

**Event types:**
- `snapshot` - Initial full state on connect
- `live` - Round live data updates
- `bids` - Bid updates (if enabled)
- `optimistic` - Early winner preview
- `final` - Finalized winner
- `globals` - Treasury/price updates

```
event: round_frame
data: {"roundId":"12345","section":"live","payload":{...}}
```

---

### Solana Helpers

#### `GET /solana/blockhash`

Get latest blockhash and recommended fee.

> **Note:** Since v0.5.0, the V3 transaction endpoints (`/v3/tx/bid`, `/v3/tx/claim`)
> include blockhash in their response. You only need this endpoint for custom
> transaction assembly or advanced use cases.

```json
{
  "blockhash": "GHtXQ...",
  "lastValidBlockHeight": 259219950,
  "gmoreFeeLamports": 50000,
  "solPriceUsd": 150.12
}
```

#### `GET /solana/miner`

Read miner account data.

| Query Param | Type | Required | Description |
| --- | --- | --- | --- |
| `authority` | string | yes | Wallet public key (base58) |

```json
{
  "minerAddress": "73VY...oyc",
  "exists": true,
  "needsCheckpoint": true,
  "checkpointId": "12340",
  "roundId": "12345",
  "authorityLamports": "1200000000",
  "authoritySol": 1.2,
  "claimableLamports": "500000000",
  "claimableSol": 0.5,
  "unrefinedOre": 1.234,
  "refinedOre": 0.567
}
```

---

### Transaction Builders

#### V3 Endpoints (Recommended)

These return **ready-to-sign serialized transactions** — no manual instruction assembly needed.

**Server-side Simulation (v0.12.6+):** Transactions are pre-simulated before being returned. This reduces Phantom wallet warnings from failed transactions. Use `skipSimulation: true` to disable for lower latency.

#### `POST /v3/tx/bid`

Build a complete bid transaction, ready to sign and send.

**Request:**

```json
{
  "authority": "YourWalletPublicKey",
  "tiles": [0, 4, 11],
  "amountSol": 0.025,
  "skipSimulation": false
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `authority` | string | Yes | Wallet public key |
| `tiles` | number[] | Yes | Tile indices (0-24) |
| `amountSol` | number | Yes* | SOL per tile |
| `amountLamports` | string | Yes* | Lamports per tile (alternative to amountSol) |
| `roundId` | string | No | Explicit round ID (defaults to current) |
| `skipSimulation` | boolean | No | Skip server-side simulation (default: false) |

**Response:**

```json
{
  "transaction": "AQAAAAA...(base64 serialized transaction)",
  "blockhash": "GHtXQBsoZE...",
  "lastValidBlockHeight": 259220000,
  "platformFeeLamports": 62500,
  "solPriceUsd": 150.12,
  "metadata": {
    "roundId": "12345",
    "tiles": [0, 4, 11],
    "needsCheckpoint": false
  }
}
```

**Usage (SDK v0.5.0+):**

```typescript
const { transaction, blockhash, lastValidBlockHeight } = await client.buildBidTransaction({
  authority: wallet.publicKey.toString(),
  tiles: [0, 4, 11],  // 0-indexed (0-24)
  amountSol: 0.025,
});

const tx = Transaction.from(Buffer.from(transaction, 'base64'));
const sig = await wallet.sendTransaction(tx, connection);
await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight });
```

#### `POST /v3/tx/claim`

Build a complete SOL claim transaction. Claims SOL rewards from the miner account.

**SDK Methods:** `client.buildClaimTransaction()` or `client.buildClaimSolTransaction()`

**Request:**

```json
{
  "authority": "YourWalletPublicKey"
}
```

**Response:**

```json
{
  "transaction": "AQAAAAA...(base64 serialized transaction)",
  "blockhash": "GHtXQBsoZE...",
  "lastValidBlockHeight": 259220000,
  "platformFeeLamports": 0,
  "metadata": {
    "needsCheckpoint": true
  }
}
```

#### `POST /v3/tx/claim-ore`

Build a complete ORE token claim transaction. Claims ORE tokens (unrefined + refined) from the miner account.

**SDK Method:** `client.buildClaimOreTransaction()`

**Note:** This is different from `/v3/tx/claim` which claims SOL rewards.

**Request:**

```json
{
  "authority": "YourWalletPublicKey",
  "skipSimulation": false
}
```

**Response:**

```json
{
  "transaction": "AQAAAAA...(base64 serialized transaction)",
  "blockhash": "GHtXQBsoZE...",
  "lastValidBlockHeight": 259220000,
  "platformFeeLamports": 0,
  "metadata": {
    "needsCheckpoint": true
  }
}
```

#### Transaction Simulation Errors (HTTP 400)

If server-side simulation fails (transaction would fail on-chain), you'll receive:

```json
{
  "error": "Transaction simulation failed",
  "simulationError": {
    "InstructionError": [0, "Custom(6001)"]
  },
  "logs": [
    "Program oreV3EG... invoke [1]",
    "Program log: Error: insufficient funds",
    "Program oreV3EG... failed"
  ]
}
```

**SDK Handling:**

```typescript
import { OredataSimulationError } from '@oredata/sdk';

try {
  await client.buildBidTransaction({ ... });
} catch (e) {
  if (OredataSimulationError.is(e)) {
    console.log(`Simulation failed: ${e.simulationError}`);
    console.log(`Logs: ${e.logs?.join('\n')}`);
  }
}
```

**SDK Usage (v0.11.3+):**

```typescript
// Check ORE balance first
const status = await client.getMinerStatus(wallet.publicKey.toString());
console.log(`Claimable ORE: ${status.totalClaimableOre}`);

// Claim ORE tokens
const { transaction, blockhash, lastValidBlockHeight } = await client.buildClaimOreTransaction({
  authority: wallet.publicKey.toString(),
});
const tx = Transaction.from(Buffer.from(transaction, 'base64'));
const sig = await wallet.sendTransaction(tx, connection);
```

**HTTP 423 (Lockout) - bid only:**

```json
{
  "error": "bid_locked",
  "message": "Bidding is locked 4s before round ends",
  "lockoutSeconds": 4,
  "plan": "dev",
  "upgradeHint": "Upgrade to pro for 3s lockout"
}
```

---

#### Legacy Endpoints (Deprecated)

These return raw instructions. Use V3 endpoints above for simpler integration.

#### `POST /tx/build/bid`

Build bid transaction instructions (deprecated — use `/v3/tx/bid`).

**Request:**

```json
{
  "authority": "YourWalletPublicKey",
  "tiles": [0, 4, 11],
  "amountLamports": "25000000"
}
```

**Response:**

```json
{
  "instructions": [
    {
      "programId": "oreV3...",
      "keys": [...],
      "data": "BgAAAAD6h4sAAAAAAAEAAAA="
    }
  ],
  "platformFeeLamports": 62500,
  "platformFeeRate": 0.0025,
  "metadata": {
    "roundId": "12345",
    "tiles": [0, 4, 11],
    "needsCheckpoint": false
  }
}
```

#### `POST /tx/build/claim`

Build claim transaction instructions (deprecated — use `/v3/tx/claim`).

**Request:**

```json
{
  "authority": "YourWalletPublicKey"
}
```

**Response:**

```json
{
  "instructions": [...],
  "platformFeeLamports": 0,
  "metadata": {
    "needsCheckpoint": true,
    "checkpointRoundId": "12340",
    "claimableLamports": "500000000"
  }
}
```

---

### Plan Information

#### `GET /v3/plans`

Returns all available API plans with pricing, limits, and features. **Not rate limited.**

```json
{
  "defaultPlan": "free",
  "plans": [
    {
      "id": "free",
      "displayName": "Free",
      "monthlyPriceUsd": 0,
      "rateLimits": {
        "requestsPerSecond": 2,
        "requestsPerMinute": 20
      },
      "billing": {
        "includedLiveRequests": null,
        "includedHistoricalQueries": 300,
        "overageAllowed": false
      },
      "features": {
        "bidLockoutSeconds": 5,
        "winnerDelaySeconds": 5
      }
    }
  ],
  "registerUrl": "https://oredata.supply/register",
  "upgradeUrl": "https://oredata.supply/upgrade"
}
```

**SDK Usage:**

```typescript
const plans = await client.getPlans();
console.log(plans.plans.map(p => `${p.displayName}: $${p.monthlyPriceUsd}/mo`));
```

---

## Error Responses

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `invalid_request` | Bad request parameters |
| 404 | `not_found` | Round not in cache |
| 423 | `bid_locked` | Bid lockout period |
| 429 | `rate_limit_exceeded` | Rate limit hit |
| 402 | `quota_exceeded` | Monthly quota exhausted |

**Rate limit error example:**

```json
{
  "error": "rate_limit_exceeded",
  "message": "Too many requests",
  "details": {
    "type": "short",
    "limit": 15,
    "window": "1s",
    "source": "ip"
  },
  "help": {
    "reason": "You're making more than 15 requests per second from this IP.",
    "solutions": ["Add an API key to get higher limits"],
    "links": {
      "register": "https://oredata.supply/register"
    }
  }
}
```

---

## SDK Usage

For TypeScript projects, use the SDK instead of raw HTTP:

```typescript
import { OredataClient } from '@oredata/sdk';

const client = new OredataClient({
  baseUrls: ['https://api.oredata.supply'],
  apiKey: process.env.OREDATA_API_KEY,
});

// Typed responses, automatic retries, React hooks
const state = await client.getState();
```

See [README.md](../README.md) for full SDK documentation.

