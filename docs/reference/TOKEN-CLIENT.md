# TokenClient

Access ORE token data via the OreData API. No authentication required.

## Installation

```bash
npm install @oredata/sdk
```

## Quick Start

```typescript
import { TokenClient } from '@oredata/sdk';

const token = new TokenClient();

// Get current token state
const info = await token.getInfo();
console.log(`Supply: ${info.totalSupply} ORE`);
console.log(`Price: $${info.priceUsd}`);
console.log(`Market Cap: $${info.marketCapUsd}`);
```

## Features

- **No authentication required** — public endpoints
- Real-time supply from Solana RPC
- Price and market cap from CoinGecko
- Emission statistics
- Historical data support

---

## API Reference

### Constructor

```typescript
const token = new TokenClient(options?: TokenClientOptions);
```

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiBaseUrl` | `string` | `https://api.oredata.supply` | API base URL |
| `apiKey` | `string` | - | Optional API key |

---

### `getInfo()`

Get current token information.

```typescript
const info = await token.getInfo();
```

**Returns: `TokenInfo`**

```typescript
interface TokenInfo {
  totalSupply: string;      // Human-readable (e.g., "412167.79")
  totalSupplyRaw: string;   // Raw units
  decimals: number;         // 11 for ORE
  priceUsd: string | null;  // From CoinGecko
  marketCapUsd: string | null;
  mintAuthority: string | null;
  mintProgram: string;
  lastUpdated: string;      // ISO timestamp
}
```

**Example:**

```typescript
const info = await token.getInfo();
console.log(`ORE Supply: ${Number(info.totalSupply).toLocaleString()}`);
console.log(`Price: $${info.priceUsd}`);
console.log(`Market Cap: $${Number(info.marketCapUsd).toLocaleString()}`);
```

---

### `getEmissions()`

Get emission statistics.

```typescript
const emissions = await token.getEmissions();
```

**Returns: `EmissionStats`**

```typescript
interface EmissionStats {
  emissionPerRound: string;   // ORE per round (~0.2)
  roundDurationSec: number;   // Average round length
  dailyEmissionOre: string;   // ~288 ORE/day
  weeklyEmissionOre: string;  // ~2016 ORE/week
  currentRound: number | null;
  totalEmittedSinceLaunch: string;
  daysSinceLaunch: number;
  launchDate: string;         // V3 launch date
}
```

**Example:**

```typescript
const emissions = await token.getEmissions();
console.log(`${emissions.dailyEmissionOre} ORE emitted per day`);
console.log(`Current round: ${emissions.currentRound}`);
console.log(`${emissions.daysSinceLaunch} days since V3 launch`);
```

---

### `getHistory(options?)`

Get historical token data.

```typescript
const history = await token.getHistory({
  period: '7d',      // '24h' | '7d' | '30d' | 'all'
  interval: '1d',    // '1h' | '1d'
});
```

**Returns: `TokenHistoryResponse`**

```typescript
interface TokenHistoryResponse {
  period: string;
  interval: string;
  data: TokenHistoryPoint[];
  note?: string;
}

interface TokenHistoryPoint {
  timestamp: string;          // ISO timestamp
  supply: string;
  priceUsd: string | null;
  marketCapUsd: string | null;
}
```

**Example:**

```typescript
const history = await token.getHistory({ period: '7d', interval: '1d' });

for (const point of history.data) {
  console.log(`${point.timestamp}: ${point.supply} ORE @ $${point.priceUsd}`);
}
```

---

### `getStatus()`

Check token poller health.

```typescript
const status = await token.getStatus();
```

**Returns: `TokenStatus`**

```typescript
interface TokenStatus {
  enabled: boolean;
  hasSupplyData: boolean;
  hasPriceData: boolean;
  lastUpdatedSupply: string;
  lastUpdatedPrice: string;
}
```

---

### `calculateSupplyAtRound()`

Calculate historical supply mathematically (ORE emission is deterministic).

```typescript
const historicalSupply = token.calculateSupplyAtRound(
  currentSupply,    // number
  currentRound,     // number
  targetRound,      // number
  emissionPerRound  // number (default: 0.2)
);
```

**Example:**

```typescript
const info = await token.getInfo();
const emissions = await token.getEmissions();

// Calculate supply at round 50000
const supplyAtRound = token.calculateSupplyAtRound(
  parseFloat(info.totalSupply),
  emissions.currentRound!,
  50000
);
console.log(`Supply at round 50000: ${supplyAtRound} ORE`);
```

---

## Use Cases

### Dashboard Display

```typescript
import { TokenClient } from '@oredata/sdk';

const token = new TokenClient();

async function displayTokenStats() {
  const [info, emissions] = await Promise.all([
    token.getInfo(),
    token.getEmissions(),
  ]);

  return {
    supply: Number(info.totalSupply).toLocaleString(),
    price: `$${parseFloat(info.priceUsd ?? '0').toFixed(4)}`,
    marketCap: `$${Number(info.marketCapUsd).toLocaleString()}`,
    dailyEmission: `${emissions.dailyEmissionOre} ORE`,
    currentRound: emissions.currentRound,
  };
}
```

### Price Chart Data

```typescript
const history = await token.getHistory({ period: '30d', interval: '1d' });

const chartData = history.data.map(point => ({
  date: new Date(point.timestamp),
  price: parseFloat(point.priceUsd ?? '0'),
  supply: parseFloat(point.supply),
}));
```

---

## Related

- [CLIENTS.md](./CLIENTS.md) - SDK capabilities overview
- [TokenClient source](../src/token-client.ts)
