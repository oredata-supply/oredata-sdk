# Oredata API Reference

> **For TypeScript users:** The `@oredata/sdk` package provides typed clients for all these endpoints. See [README.md](../README.md).

The oredata.supply API exposes HTTP and SSE endpoints for real-time ORE mining game data.

## Base URL

| Environment | Base URL |
| --- | --- |
| Production | `https://ore-api.gmore.fun` |

## Authentication

API keys are passed via `X-Api-Key` header or `apiKey` query parameter.

```bash
# Header (recommended)
curl -H "X-Api-Key: your-key" https://ore-api.gmore.fun/v3/state

# Query parameter
curl "https://ore-api.gmore.fun/v3/state?apiKey=your-key"
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
  }
}
```

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
      "currentSlot": "259219923"
    },
    "currentRoundId": "12345",
    "latestFinalizedRoundId": "12344"
  },
  "meta": {
    "winnerRevealIn": 0
  }
}
```

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
  "https://ore-api.gmore.fun/events?apiKey=your-key"
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

#### `POST /tx/build/bid`

Build bid transaction instructions.

**Request:**

```json
{
  "authority": "YourWalletPublicKey",
  "tiles": [1, 5, 12],
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
    "tiles": [1, 5, 12],
    "needsCheckpoint": false
  }
}
```

**HTTP 423 (Lockout):**

```json
{
  "error": "bid_locked",
  "message": "Bidding is locked 4s before round ends",
  "lockoutSeconds": 4,
  "plan": "dev",
  "upgradeHint": "Upgrade to pro for 3s lockout"
}
```

#### `POST /tx/build/claim`

Build claim transaction instructions.

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
  baseUrls: ['https://ore-api.gmore.fun'],
  apiKey: process.env.OREDATA_API_KEY,
});

// Typed responses, automatic retries, React hooks
const state = await client.getState();
```

See [README.md](../README.md) for full SDK documentation.

