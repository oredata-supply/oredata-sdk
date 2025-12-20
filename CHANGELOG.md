# Changelog

All notable changes to `@oredata/sdk` will be documented in this file.

## [Unreleased]

### Added

- **`breatherProgress` in `useRoundTiming` and `getRoundTiming`** — Progress value (1→0) for breather phase animations

  Previously, `progress` was `null` during the breather phase, requiring manual calculation. Now `breatherProgress` is calculated automatically:

  ```tsx
  const { progress, breatherProgress, inRound, inBreather } = useRoundTiming();

  // During active round: use progress (0→1, left→right)
  // During breather: use breatherProgress (1→0, right→left)
  if (inRound && progress !== null) {
    dotPosition = progress * 100;  // 0% → 100%
  } else if (inBreather && breatherProgress !== null) {
    dotPosition = breatherProgress * 100;  // 100% → 0%
  }
  ```

- **`breatherDurationMs` option** — Configure estimated breather duration (default: 18000ms)

  ```tsx
  const timing = useRoundTiming({
    breatherDurationMs: 15000,  // Override if you know typical breather is shorter
  });
  ```

- **`DEFAULT_BREATHER_DURATION_MS` constant** — Exported for use in custom timing calculations

### Removed

- **`OredataLockoutError` class removed** — The bid lockout feature was never shipped; surge pricing (dynamic fees in final 15s of rounds) is used instead. If you were importing `OredataLockoutError`, remove those imports. The HTTP 423 status code is no longer returned by bid endpoints.

### Changed

- `metadata.checkpointIncluded` remains the source of truth for checkpoint inclusion; legacy `metadata.needsCheckpoint` is retained for compatibility in transaction builder responses.
- `PlanInfo.features.bidLockoutSeconds` removed from plan responses. Use surge pricing for time-based fee scaling.

## [0.12.43] - 2025-12-19

### Added

- **Programmatic self-serve (beta)** — new HTTP client helpers:
  - `client.http.registerWithWallet({ walletAddress, message, signature })` → `POST /api/v1/register`
  - `client.http.listKeys()` → `GET /api/v1/keys`
  - `client.http.createKey(name?)` → `POST /api/v1/keys`
  - `client.http.revokeKey(id)` → `DELETE /api/v1/keys?id=<id>`
- Exported types: `RegisterRequest/Response`, `ListKeysResponse`, `CreateKeyResponse`, `ApiKeySummary`.

### Changed

- Bumped SDK version to `0.12.43` (User-Agent + package.json) for registry release.

## [0.12.41] - 2025-12-15

### Added

- **Extended Bid Distribution Percentiles** — Smart bid presets with 6 metrics:
  
  ```typescript
  bidDistributionGlobal: {
    p50Lamports: string;   // Top 50% — beat half of miners
    p80Lamports: string;   // Top 20% — competitive bid
    p90Lamports: string;   // Top 10% — strong bid
    p95Lamports: string;   // Top 5% — very competitive
    p99Lamports: string;   // Top 1% — whale territory
    avgLamports: string;   // Average bid per tile
    sampleSize: number;
    source: 'estimate' | 'live' | 'mixed';
  }
  ```

- **Per-tile distribution endpoint** — `GET /v3/rounds/:roundId/bid-distribution/tiles` returns live percentiles per tile with `tileDeployedLamports` and `otherTilesDeployedLamports` helpers.

**Use case:** Smart bid buttons showing "top50% | top20% | top10% | top5% | top1%"

---

## [0.12.39] - 2025-12-15

### Added

- **`platformFeeMinUsd` in API responses** — Minimum fee in USD (currently $0.01)
  
  All bid responses and state endpoints now include `platformFeeMinUsd: 0.01`. This ensures sustainable transaction fees regardless of bid size.

- **`phaseDurations` in state responses** — Expected phase timing for progress animations
  
  ```typescript
  optimized: {
    phaseDurations: {
      spinningMs: 15000,  // Expected winner reveal time (~10-20s, varies)
      resultMs: 8000,     // Time showing winner
      breatherMs: 5000,   // Gap between rounds
    }
  }
  ```
  
  **Usage for progress bars:**
  ```typescript
  function getPhaseProgress(phase, phaseSince, phaseDurations) {
    const elapsed = Date.now() - new Date(phaseSince).getTime();
    
    switch (phase) {
      case 'BETTING': 
        // Use phaseUntil for exact timing
        return elapsed / totalDuration;
      case 'SPINNING':
        // Estimate only - winner arrival is unpredictable!
        return Math.min(0.95, elapsed / phaseDurations.spinningMs);
      case 'RESULT':
        return Math.min(1, elapsed / phaseDurations.resultMs);
    }
  }
  ```

### Changed

- **Dynamic minimum fee** — Minimum fee now calculated from SOL price to ensure $0.01 USD minimum per transaction. Previously was fixed at 1000 lamports (~$0.00023).

---

## [0.12.37] - 2025-12-15

### Added

- **`getPlatformFeeRate()` method on OredataStore** — Get current surge pricing rate without SSE
  
  ```typescript
  const store = client.getStore();
  
  // Get current fee rate (updated each poll)
  const feeRate = store.getPlatformFeeRate(); // 0.0025 - 0.03
  
  // Display to users
  if (feeRate !== null) {
    console.log(`Current fee: ${(feeRate * 100).toFixed(2)}%`);
  }
  ```

- **`platformFeeRate` in `roundDataUpdated` event** — React to fee changes in real-time
  
  ```typescript
  store.on('roundDataUpdated', ({ platformFeeRate }) => {
    if (platformFeeRate !== null) {
      updateFeeDisplay(platformFeeRate);
    }
  });
  ```

This enables surge pricing display without requiring SSE — works with regular polling.

---

## [0.12.34] - 2025-12-15

### Changed

- **bm: sustainable platform fees** — Platform fees now scale dynamically during the last 15 seconds of each round:
  - Base rate: 0.25% (unchanged for bids >15s before round end)
  - Surge rate: 0.50% → 3.00% (discrete 2.5-second steps in final 15s)
  - `platformFeeRate` now available in:
    - `POST /v3/tx/bid` response (actual rate charged)
    - `GET /v3/state` optimized response (SSOT for display)
    - SSE `round_frame` events (real-time updates)
  - This ensures fair compensation for time-critical bid relay during peak demand

---

## [0.12.33] - 2025-12-15

### Added

- **Chat History Persistence** — Messages are now permanently stored in the database. No more empty chat on page load!

- **`fetchHistory()` with pagination** — New method with full pagination support

  ```typescript
  const chat = new ChatClient();

  // Initial load
  const { messages, hasMore, oldestTimestamp } = await chat.fetchHistory({ limit: 50 });

  // Load older messages (infinite scroll)
  if (hasMore) {
    const older = await chat.fetchHistory({ limit: 50, before: oldestTimestamp });
  }

  // Load newer messages (after reconnect)
  const newer = await chat.fetchHistory({ after: lastKnownTimestamp });

  // Filter by wallet
  const myMessages = await chat.fetchHistory({ authority: wallet.publicKey.toBase58() });
  ```

- **New types**: `FetchHistoryOptions`, enhanced `ChatHistoryResponse` with `hasMore`, `oldestTimestamp`, `newestTimestamp`

### Deprecated

- `getHistory()` — Use `fetchHistory()` instead for pagination support

---

## [0.12.32] - 2025-12-14

### Added

- **Session caching (client + server)** — JWT is cached both locally and on the API server. Users sign once per 24 hours, even across page refreshes or different devices!

  ```typescript
  const chat = new ChatClient();
  
  // First call: wallet prompts for signature
  await chat.send('Hello!', wallet);
  
  // Subsequent calls: uses cached JWT, no signature needed!
  await chat.send('Another message', wallet);
  
  // Even after page refresh, API has the cached session!
  // No re-signing needed until session expires (24 hours)
  ```

- **`getSession(authority)`** — Check if API has a cached session (no signature needed)
- **`clearSession(authority)`** — Clear cached session for a wallet (forces re-auth)
- **`clearAllSessions()`** — Clear all cached sessions

### Flow

1. Check local cache → if valid, use it
2. Check API cache (`GET /chat/session/:authority`) → if valid, use it  
3. Only if both miss, ask wallet to sign

---

## [0.12.31] - 2025-12-14

### Fixed

- **Browser build compatibility** — Removed direct `Buffer` reference that caused Vite/Rollup build failures in browser apps

---

## [0.12.30] - 2025-12-14

### Fixed

- **Chat now works with ore.supply!** — Discovered ore-bsm requires a two-step auth flow

  ore.supply's backend (`ore-bsm`) issues its own JWTs via `/auth/login`. We now:
  1. Have wallet sign ore-bsm's specific auth message format
  2. Call ore-bsm's `/auth/login` to get their JWT
  3. Use their JWT for sending messages

### Added

- **`createChatAuth(wallet)` helper** — Creates auth request for ore-bsm

  ```typescript
  import { createChatAuth, ChatClient } from '@oredata/sdk';

  const chat = new ChatClient();

  // Create auth request (wallet signs ore-bsm's message)
  const auth = await createChatAuth(wallet);

  // Get ore-bsm's JWT via our API
  const session = await chat.createSession(auth);

  // Send messages
  await chat.sendMessage({ text: 'Hello!', jwt: session.jwt! });
  ```

- **`chat.send(text, wallet)` simplified method** — Handles full auth flow automatically

  ```typescript
  // Super simple! Handles ore-bsm auth automatically
  const result = await chat.send('Hello everyone!', wallet);
  ```

- **`ORE_BSM_AUTH_MESSAGE_PREFIX`** — The message prefix ore-bsm expects

### Changed

- **`ChatSessionRequest`** now uses `{ authority, signature, timestamp }` format
- `createSession()` now calls ore-bsm's `/auth/login` under the hood
- `createChatJwt()` is **deprecated** (ore-bsm issues its own JWTs)

---

## [0.12.27] - 2025-12-14

### Fixed

- **Chat JWT signature format** — Attempted fix for JWT signatures (superseded by 0.12.28)

---

## [0.12.26] - 2025-12-14

### Added

- **Chat Send Support in `ChatClient`** — Send messages to the ore.supply community chat

  **Features:**
  - **Unified ecosystem chat** — Messages appear on ore.supply, gmore.fun, orepump.fun
  - **Eligibility check** — Must have mined in the last 30 days
  - **Rate limiting** — 3 messages per 5 seconds

- **New ChatClient methods:**
  - `sendMessage(request)` — Send a chat message
  - `createSession(request)` — Create a JWT session (deprecated in 0.12.27)
  - `isEligible(authority)` — Check if wallet can chat
  - `getMinersStats()` — Get known miners statistics

- **New types exported:**
  - `ChatSendRequest`, `ChatSendResponse`
  - `ChatSessionRequest`, `ChatSessionResponse`
  - `ChatEligibilityResponse`, `ChatMinersStatsResponse`

---

## [0.12.25] - 2025-12-14

### Added

- **`currentRoundBids` in MinerStatus** — The miner endpoint now returns wallet's active bids for the current round

  ```typescript
  const miner = new MinerClient({
    apiBaseUrl: 'https://api.oredata.supply',
    authority: wallet.publicKey.toString(),
  });

  miner.on('update', (status) => {
    if (status.currentRoundBids) {
      console.log(`Active bids in round ${status.currentRoundBids.roundId}:`);
      console.log(`  Total: ${status.currentRoundBids.totalAmountSol} SOL`);
      for (const bid of status.currentRoundBids.bids) {
        console.log(`  Tile ${bid.tile}: ${bid.amountSol} SOL`);
      }
    }
  });
  ```

  This enables:
  - Display active bids placed on any ORE interface (ore.supply, orepump.fun, etc.)
  - Calculate potential winnings before round ends
  - Show bid badges on tiles the user has bet on

- **New types exported:** `CurrentRoundBids`, `WalletBidEntry`

---

## [0.12.24] - 2025-12-14

### Fixed

- **`getMotherlodeOre()` now works correctly** — Fixed wiring bug where `OredataClient` wasn't forwarding `motherlodeFormatted` from globals to the store. Thanks to ORE Pump team for the detailed bug report!

---

## [0.12.23] - 2025-12-14

### Added

- **`getMotherlodeOre()` method** — Access the current Motherlode jackpot balance

  The Motherlode is a rare 1-in-625 jackpot. You can now display the current jackpot size in your UI:

  ```typescript
  const store = client.getStore();

  // Get current jackpot size
  const motherlode = store.getMotherlodeOre();
  console.log(`Motherlode: ${motherlode?.toLocaleString() ?? '...'} ORE`);

  // Build a prize pool widget
  const round = store.getCurrentRound();
  const solPrice = store.getSolPriceUsd();
  const orePrice = store.getOrePriceUsd();

  const widget = {
    roundPotSol: round?.totals.deployedSol ?? 0,
    roundPotUsd: (round?.totals.deployedSol ?? 0) * (solPrice ?? 0),
    motherlodeOre: motherlode ?? 0,
    motherlodeUsd: (motherlode ?? 0) * (orePrice ?? 0),
  };
  ```

  This value updates on each API poll alongside `getSolPriceUsd()` and `getOrePriceUsd()`.

---

## [0.12.16] - 2025-12-06

### Added

- **TokenClient** — Access ORE token data via OreData API

  ```typescript
  import { TokenClient } from '@oredata/sdk';

  const token = new TokenClient();

  // Get current token state
  const info = await token.getInfo();
  console.log(`Supply: ${info.totalSupply} ORE`);
  console.log(`Price: $${info.priceUsd}`);
  console.log(`Market Cap: $${info.marketCapUsd}`);

  // Get emission statistics
  const emissions = await token.getEmissions();
  console.log(`${emissions.dailyEmissionOre} ORE/day`);
  console.log(`Round ${emissions.currentRound}`);
  ```

- **Token API endpoints:**
  - `GET /ore/token` — Current supply, price, market cap
  - `GET /ore/token/emissions` — Emission rate, current round, launch stats
  - `GET /ore/token/history` — Historical data (period: 24h/7d/30d/all)
  - `GET /ore/token/status` — Poller health check

---

## [0.12.14] - 2025-12-06

### Fixed

- **Server-side winner data issue resolved** — Fixed an API bug where winner delay masking was incorrectly applied to all historical rounds instead of only the just-finished round. SDK consumers now correctly receive `resultAvailable: true` for completed rounds immediately. No client-side changes required.

---

## [0.12.12] - 2025-12-05

### Added

- **ChatClient** — Subscribe to ore.supply community chat via OreData API

  ```typescript
  import { ChatClient } from '@oredata/sdk';

  const chat = new ChatClient({
    apiBaseUrl: 'https://api.oredata.supply',
  });

  chat.on('message', (msg) => {
    console.log(`${msg.username}: ${msg.text}`);
  });

  chat.connect(); // SSE with chat enabled
  ```

- **Chat REST endpoints:**
  - `GET /chat/history` — Fetch recent messages (limit, since params)
  - `GET /chat/status` — Check chat relay status

- **SSE chat support** — Add `?includeChat=true` to `/events` endpoint

### Chat Features

- Real-time messages via SSE (opt-in)
- Message history for backfill
- Auto-reconnect with exponential backoff
- Event-based API: `message`, `history`, `connected`, `disconnected`, `error`

### Notes

- Chat is **opt-in** — clients must explicitly request it
- Messages relayed from ore.supply (attribution in docs)
- See [CHAT.md](../../docs/CHAT.md) for full documentation

---

## [0.12.11] - 2025-12-05

### Changed

- **Default API endpoint changed to `api.oredata.supply`** — The SDK now uses `https://api.oredata.supply` as the default base URL instead of `https://ore-api.gmore.fun`. The old endpoint will continue to work via redirect, but clients should update their configurations.

### Infrastructure

- API migrated from DigitalOcean App Platform to Droplet for better control and performance
- On-chain fee collection program deployed to mainnet (`BKjyjWwLCmc8m9FiwNYGbiSwpJs7g1qS1e34Q6MyPFe5`)

### Migration Notes

If you're explicitly setting `baseUrls`, update to use the new endpoint:

```typescript
// Before
const client = new OredataClient({
  baseUrls: ['https://ore-api.gmore.fun'],
});

// After
const client = new OredataClient({
  baseUrls: ['https://api.oredata.supply'],
});
```

---

## [0.12.7] - 2025-12-05

### Changed

- **Optimized instruction ordering for wallet compatibility** — Bid transactions now place the deploy (bid) instruction BEFORE the platform fee transfer. This reduces Phantom/Blowfish "drainer" detection heuristics that can trigger security warnings.

### Transaction Structure

**Previous order:**
```
1. Checkpoint (if needed)
2. Platform fee transfer  ← Triggered "send SOL to unknown address" warnings
3. Deploy (bid)
```

**New order:**
```
1. Checkpoint (if needed)
2. Deploy (bid)           ← Main program interaction establishes legitimacy
3. Platform fee transfer  ← Now follows legitimate program use
```

### Why This Matters

Wallet security scanners like Blowfish (used by Phantom) analyze instruction order to detect malicious patterns. Leading with a SOL transfer to an unknown address can trigger "This dApp could be malicious" warnings, even for legitimate transactions. By placing the ORE program instruction first, we establish the transaction's legitimacy before the fee transfer.

> **For clients building transactions client-side:** Follow this same instruction order to minimize wallet warnings. See [TRANSACTIONS.md](./docs/TRANSACTIONS.md#instruction-ordering-v0127) for details.

---

## [0.12.6] - 2025-12-05

### Added

- **Server-side transaction simulation** — Transactions are now pre-simulated before being returned to clients. This reduces Phantom wallet warnings caused by failed transactions.

- **`skipSimulation` option** for transaction builders:
  - `buildBidTransaction({ ..., skipSimulation: true })`
  - `buildClaimTransaction({ ..., skipSimulation: true })`
  - `buildClaimOreTransaction({ ..., skipSimulation: true })`
  
  Default is `false` (simulation enabled). Set to `true` for ~50-100ms lower latency, but Phantom may show warnings if the transaction would fail.

### Error Handling

The SDK already had `OredataSimulationError` — it's now actively used:

```typescript
import { OredataSimulationError } from '@oredata/sdk';

try {
  await client.buildBidTransaction({
    authority: wallet.publicKey.toString(),
    tiles: [1, 2, 3],
    amountSol: 0.1,
  });
} catch (e) {
  if (OredataSimulationError.is(e)) {
    // Transaction would fail on-chain
    console.log(`Simulation failed: ${e.simulationError}`);
    console.log(`Logs: ${e.logs?.join('\n')}`);
    showToast('Transaction would fail. Please try again.');
  }
}
```

### Why This Matters

Per [Phantom's documentation](https://docs.phantom.com/developer-powertools/domain-and-transaction-warnings):
> "Before submitting the transaction for signing, simulate the transaction with sigVerify: false using your RPC node to ensure they will not fail onchain. Failed transactions could trigger simulation warnings."

This update follows that best practice, reducing the "This transaction may be risky" warnings users see in Phantom.

---

## [0.12.5] - 2025-12-04

### Added

- **Convenience methods on OredataClient** for common operations:
  - `client.pause()` — Pause polling (sets mode to 'idle'). Use when tab is hidden.
  - `client.resume()` — Resume polling (sets mode to 'active'). Use when tab becomes visible.
  - `client.isPollingHealthy()` — Returns true if data was received within last 3 seconds.
  - `client.getLastPollTimestamp()` — Returns Date of last successful poll (or null).
  - `client.getMode()` — Returns current mode ('active' or 'idle').

- **Enhanced `connectionChange` event** with recovery diagnostics:
  - `previousStatus` — Previous connection status before the change.
  - `downtimeMs` — Milliseconds spent in 'unreachable' state before recovery.

- **`updatedAt` timestamp in `roundDataUpdated` event payload** for data freshness tracking.

### Example: Tab Visibility Handling

```typescript
// Pause/resume polling on tab visibility change
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    client.pause();  // Save battery, reduce API calls
  } else {
    client.resume(); // Immediately fetch fresh data
  }
});
```

### Example: Connection Recovery Detection

```typescript
client.on('connectionChange', ({ status, previousStatus, downtimeMs }) => {
  if (status === 'connected' && previousStatus === 'unreachable') {
    console.log(`Connection restored after ${downtimeMs}ms downtime`);
    refreshUI();
  }
});
```

---

## [0.12.0] - 2025-12-03

### ⚠️ BREAKING CHANGES — Final Cleanup

This release completes the v0.11.0 deprecation cycle by removing all deprecated APIs.

#### Removed React Hooks (Final)

| Hook | Replacement |
|------|-------------|
| `useOredataState()` | Use `useStore()` for data, `usePresenter()` for UI timing |
| `useOredataEvents()` | Use Layer 1 events via `store.on('roundCompleted', ...)` |

These hooks were re-added in v0.11.4 for backward compatibility but are now permanently removed.

#### Removed from OredataClient

| Method | Replacement |
|--------|-------------|
| `getStateClient()` | Use `client.start()` and `client.stop()` for polling |

#### Removed from UseMinerAccountReturn

Legacy type aliases removed (use the new names):
- `solBalance` → `authoritySol`
- `oreBalance` → `authorityOre`
- `usdcBalance` → `authorityUsdc`
- `pendingSol` → `pendingClaimSol`
- `claimableOre` → `totalClaimableOre`

#### Removed Types

| Type | Notes |
|------|-------|
| `BuildInstructionsResponse` | Legacy response format from old `buildBid()` |
| `SerializedInstruction` | Only used in legacy format |
| `RoundFrameKeyMeta` | Only used in legacy format |
| `StateStoreSnapshot` | Use `RoundData` |
| `RoundFrame` | Use `RoundData` |
| `AppMode` | Internal |

### Updated

- **All browser examples** now use modern patterns (`useStore`, `usePresenter`, `store.on()`)
- **README.md** updated with modern React example
- **TROUBLESHOOTING.md** updated to remove deprecated API references
- **JSDoc examples** fixed to use `buildBidTransaction()` instead of non-existent `buildBidInstructions()`

### Migration Guide

If you're on v0.11.x, see [the v0.11.0 changelog](#0110---2025-12-03) for migration patterns.

**Quick migration:**

```tsx
// OLD (v0.11.x with deprecated hooks)
import { useOredataState, useOredataEvents } from '@oredata/sdk/react';
const { phase, winner } = useOredataState();
useOredataEvents({ onWinner: (e) => ... });

// NEW (v0.12.0)
import { useStore, usePresenter, useOredataClient } from '@oredata/sdk/react';
const { currentRound, previousRound } = useStore();
const { displayPhase, displayedWinner } = usePresenter();

// For events:
const { client } = useOredataClient();
useEffect(() => {
  const store = client.getStore();
  return store.on('roundCompleted', ({ winner, isHistorical }) => {
    if (!isHistorical) handleWinner(winner);
  });
}, [client]);
```

---

## [0.11.4] - 2025-12-03

### Added

- **Re-exported legacy types** for backward compatibility with developer tools:
  - `StateStoreSnapshot` - Internal snapshot type
  - `RoundFrame` - Frame type for round data
  - `AppMode` - 'active' | 'idle' mode type
  - `getStateClient()` - Restored with deprecation notice

These are marked internal/deprecated and should not be used in new code.
Use `OredataStore` and `RoundData` for new integrations.

---

## [0.11.3] - 2025-12-03

### Added

- **`buildClaimOreTransaction()`** - Claim ORE token rewards from your miner account
  ```typescript
  // Claim ORE tokens (different from SOL rewards)
  const { transaction } = await client.buildClaimOreTransaction({
    authority: wallet.publicKey.toBase58(),
  });
  
  // Sign and relay
  const tx = Transaction.from(Buffer.from(transaction, 'base64'));
  const signedTx = await signTransaction(tx);
  const { signature } = await client.relayTransaction({
    transaction: Buffer.from(signedTx.serialize()).toString('base64'),
  });
  ```
  
  **Note:** ORE claims have a 10% tax on unrefined ORE. Refined ORE has no tax.
  See `MinerStatus.unrefinedOre` and `MinerStatus.refinedOre` for balances.

---

## [0.11.2] - 2025-12-03

### Fixed

- **Token prices now work** - Fixed bug where `getSolPriceUsd()` and `getOrePriceUsd()` always returned `null`. The `OredataClient` was not forwarding the `globals` data (containing prices) from `StateClient` to `OredataStore`. Now correctly extracts and passes price data on each poll.

### Added (v0.11.1)

- **Token price getters** - Get real-time SOL and ORE prices in USD
  ```typescript
  const store = client.getStore();
  
  // Get current prices (updated on each poll)
  const solPrice = store.getSolPriceUsd();  // e.g., 242.50
  const orePrice = store.getOrePriceUsd();  // e.g., 2.15
  
  // Display pot value in USD
  const potSol = round.totalBidsSol;
  const potUsd = solPrice ? potSol * solPrice : null;
  console.log(`Pot: ${potSol} SOL ($${potUsd?.toFixed(2) ?? '...'})`)
  ```

---

## [0.11.0] - 2025-12-03

### ⚠️ BREAKING CHANGES

This release removes deprecated APIs to clean up the SDK surface.

#### Removed from OredataClient

| Method | Replacement |
|--------|-------------|
| `getStateClient()` | Use `client.start()` and `client.stop()` for polling control |
| `buildBid()` | Use `buildBidTransaction()` |
| `buildClaim()` | Use `buildClaimTransaction()` |
| `getBlockhash()` | Blockhash is included in transaction responses |

#### Removed React Hooks

| Hook | Replacement |
|------|-------------|
| `useOredataState()` | Use `useStore()` + `usePresenter()` |
| `useOredataEvents()` | Use Layer 1 events via `useStore()` |

#### Removed Type Exports

| Export | Replacement |
|--------|-------------|
| `AppMode` | Internal |
| `WinnerEventPayload` | Use `RoundCompletedPayload` |
| `RoundFinalizedPayload` | Use `RoundCompletedPayload` |
| `MotherlodeEventPayload` | Internal |
| `StateStoreSnapshot` | Use `RoundData` |
| `StateClientEvents` | Internal |

#### Removed Docs

| File | Reason |
|------|--------|
| `docs/EVENT_CATALOG.md` | Superseded by `ARCHITECTURE.md` |

### Added

- **`client.start()` and `client.stop()`** - Direct polling control on OredataClient
  ```typescript
  // Before (v0.9.x)
  client.getStateClient().start();
  client.getStateClient().stop();
  
  // After (v0.10.0)
  client.start();
  client.stop();
  ```

### Migration Guide

Most users on v0.9.7+ with Layer 1/2 patterns need NO CHANGES.

If you're using deprecated patterns:

1. **Polling control:**
   ```typescript
   // Old
   client.getStateClient().start();
   // New
   client.start();
   ```

2. **React hooks:**
   ```tsx
   // Old
   const { phase, winner } = useOredataState();
   
   // New
   const { currentRound } = useStore();
   const { displayPhase, displayedWinner } = usePresenter();
   ```

3. **Winner events:**
   ```typescript
   // Old
   stateClient.on('winner', (event) => { ... });
   
   // New
   store.on('roundCompleted', ({ winner, isHistorical }) => {
     if (!isHistorical) { ... }
   });
   ```

## [0.9.7] - 2025-12-03

### Added

- **`client.start()` and `client.stop()`** - Direct polling control
  - Prepare for v0.10.0 removal of `getStateClient()`
  - Same functionality, cleaner API

## [0.9.6] - 2025-12-03

### Fixed
- **`createMultiplexer` now detects winners from previous rounds** 🐛
  - Previously, `ServerStateStore` only checked the current frame for winners
  - When round changed (e.g., 74169 → 74170), winner data for 74169 was in its frame
  - But the store only checked frame 74170, so the winner was never detected
  - Now checks ALL frames in the snapshot for winner data
  - `multiplexer.on('winner', ...)` now fires correctly!

**Before (broken):**
```
Round 74169 ends → currentRoundId = 74170
Winner data in frame 74169
ServerStateStore checks frame 74170 only
→ Winner never detected ❌
```

**After (fixed):**
```
Round 74169 ends → currentRoundId = 74170
Winner data in frame 74169
ServerStateStore checks ALL frames (74169, 74170)
→ Winner detected immediately ✅
```

### Added
- **Unit tests for `ServerStateStore`** 🧪
  - Tests for winner detection in current frame
  - Tests for winner detection in previous frame after round change
  - Tests for duplicate prevention
  - Tests for round/phase change detection

## [0.9.5] - 2025-12-03

### Added
- **`isHistorical` flag on round events** 🕐
  - `roundStarted` and `roundCompleted` events now include `isHistorical: boolean`
  - `true` = Round data existed before we connected (cold load / page refresh)
  - `false` = Round event happened while we were connected (live session)
  - Enables proper "cold load vs live session" detection

**Usage:**
```typescript
store.on('roundStarted', ({ roundId, isHistorical }) => {
  if (isHistorical) {
    // User just opened the page - round was already in progress
    console.log(`Joined round ${roundId} in progress`);
  } else {
    // User was connected when new round started
    console.log(`New round ${roundId} started!`);
  }
});

store.on('roundCompleted', ({ roundId, winner, isHistorical }) => {
  if (isHistorical) {
    // Winner from a round that finished before we connected
    // Skip pending states - go straight to showing winner
    setWinner(winner);
  } else {
    // Live winner event - show animation
    playWinnerAnimation(winner);
  }
});
```

### Documentation
- **Added round history API documentation** 📚
  - `getPreviousRound()` - Get the last completed round with winner
  - `getRecentRounds(n)` - Get last N rounds (most recent first)
  - `getRound(roundId)` - Get specific round by ID
  - `getWinner(roundId)` - Get winner for specific round
  - Use cases documented: cold load detection, history display, win verification

- **Clarified `roundId` type convention** 📝
  - `roundId` is always a `string` in the SDK (matches JSON API)
  - Use string comparison or `parseInt()` when needed
  - Added examples to avoid subtle bugs with `===` comparison

## [0.9.4] - 2025-12-03

### Fixed
- **`phaseChange(BETTING)` now fires reliably when a new round starts** 🐛
  - Previously, if the phase was already BETTING (e.g., after a timeout), the event wouldn't fire for the new round
  - Now tracks phase+roundId together, so BETTING for round N and BETTING for round N+1 are distinct events
  
- **Phase transitions to SPINNING when round ends** 🎰
  - Previously, phase only changed to SPINNING when winner data arrived
  - If winner timed out, phase stayed BETTING, causing the bug above
  - Now subscribes to `miningStatusChanged` and transitions to SPINNING when round ends (status: ACTIVE → EXPIRED)

### Technical Details
The issue was:
1. Round N ends, no winner arrives → phase stays BETTING
2. Round N+1 starts → `setDisplayPhase('BETTING', N+1)` is called
3. Guard `if (phase === currentDisplayPhase) return` blocked because already BETTING
4. No `phaseChange` event fired

Fixed by:
1. Tracking `lastEmittedPhaseRound` = `"BETTING:73927"` instead of just phase
2. Subscribing to `miningStatusChanged` to transition BETTING → SPINNING when round ends

### Recommendation for Clients
For game UI that needs to know when a new round starts:

```typescript
// RECOMMENDED: Use Layer 1 for facts (always reliable)
store.on('roundStarted', ({ roundId }) => {
  setBettingEnabled(true);
  setCurrentRound(roundId);
});

// Layer 2 for UI timing (animations, overlays)
state.on('winnerReveal', ({ roundId, winner }) => {
  showWinnerAnimation(winner);
});
```

## [0.9.3] - 2025-12-03

### Added
- **Timing data for countdowns** ⏱️
  - API now exposes `nextRound` with `startSlot` for breather countdown
  - `OredataStore.getNextRound()` - returns `{ roundId, startSlot }` when detected
  - `OredataStore.getCurrentSlot()` - returns current Solana slot
  - `useStore()` hook now returns `currentSlot` and `nextRound`
  - Export `NextRoundInfo` type

- **Timing helper functions** 🧮
  - `getRoundTiming()` - Pure function for calculating round/breather timing
  - `formatDuration()` - Format ms as "42s", "1:05", "1:01:01"
  - `slotsRemaining()`, `slotsToMs()`, `msToSlots()` - Slot math utilities
  - `DEFAULT_SLOT_DURATION_MS` (400ms) constant

- **`useRoundTiming()` React hook** ⚛️
  - Auto-updating countdown with interpolation between API polls
  - Returns `inRound`, `inBreather`, `countdown`, `progress`, `nextRoundKnown`
  - Configurable refresh interval, custom messages

### Usage

**Pure function (for any environment):**
```typescript
import { getRoundTiming } from '@oredata/sdk';

const timing = getRoundTiming({
  currentSlot: store.getCurrentSlot(),
  currentRound: store.getCurrentRound(),
  nextRound: store.getNextRound(),
});

console.log(timing.countdown); // "42s" or "Next round starting soon..."
```

**React hook:**
```tsx
import { useRoundTiming } from '@oredata/sdk/react';

function GameTimer() {
  const { countdown, inRound, progress, nextRoundKnown } = useRoundTiming();

  return (
    <div>
      <span>{countdown}</span>
      {inRound && <ProgressBar value={progress} />}
      {!nextRoundKnown && <span className="animate-pulse">⏳</span>}
    </div>
  );
}
```

### API Changes
- `/v3/state` response now includes `optimized.nextRound` when:
  - Previous round just finished (status: finished/expired)
  - New round detected (has valid startSlot)
- `/v3/state` now includes `optimized.slotDurationMs` - actual network slot duration
- `/v3/state` globals includes `slotDurationMs` for REST clients
- `/v3/health` includes `network.slotDurationMs` for lightweight access

### How It Works
- API polls Solana's `getRecentPerformanceSamples` every 15s
- Calculates average slot duration from last 10 samples
- Falls back to 400ms if unavailable
- `useRoundTiming()` automatically uses the real value

## [0.9.2] - 2025-12-02

### Fixed
- **`roundCompleted` event now fires reliably** 🐛
  - Previously, `store.on('roundCompleted')` never fired because winner detection in `processFrame()` 
    didn't emit the event - it only stored the data
  - The event was only emitted via `checkForWinner()` which was only called for `latestFinalizedRoundId`
  - Now winner events fire immediately when winner data is found in any frame
  - This fixes `OredataState.winnerReveal` timing out

### Added
- **`EVENT_CATALOG.md`** - Complete reference for all SDK events
  - StateClient, OredataStore, OredataState, and MinerClient events
  - TypeScript types and example payloads
  - Recommended patterns and troubleshooting

## [0.9.0] - 2025-12-02

### Added
- Event catalog documentation
- orepump team integration support

### Changed
- Version bump to align with ongoing development

## [0.8.2] - 2025-12-02

### Breaking Changes
- **Tile numbering standardized to 0-24** (was 1-25 for API input)
  - API `/v3/tx/bid` now expects `tiles: [0, 4, 11]` (0-indexed)
  - Removed `displayTile` from `WinnerDisplay`
  - Removed `displayWinner` from `WinnerRevealPayload` and `ResultOverlayShowPayload`
  - For display, add 1 in your UI layer: `winner.tile + 1`

### Why This Change
- Consistency: Arrays, on-chain program, and events all use 0-24
- Avoids off-by-one errors when accessing `perSquare.counts[tile]`
- Simpler mental model for programmers

### Migration
```typescript
// Before (0.8.1)
state.on('winnerReveal', ({ displayWinner }) => {
  showWinner(displayWinner); // Already 1-indexed
});

// After (0.8.2)
state.on('winnerReveal', ({ winner }) => {
  showWinner(winner + 1); // Add 1 for display
});

// Before (0.8.1)
client.buildBidTransaction({ tiles: [1, 5, 12] }); // 1-indexed

// After (0.8.2)
client.buildBidTransaction({ tiles: [0, 4, 11] }); // 0-indexed
```

## [0.8.1] - 2025-12-02

### Added
- **`TRANSACTIONS.md`** - Complete guide for building, signing, and sending transactions
  - Browser (wallet adapter) and Node.js (keypair) examples
  - Error handling for lockout, rate limits, simulation failures
  - Common patterns: cheapest tiles, retry with backoff

### Changed
- Updated `OREPUMP_SDK_DATA_MOCKUP.md` with related docs section

## [0.8.0] - 2025-12-01

### Added
- **Data/Presentation Layer Separation** (RFC v2.1)
  - **`OredataStore`** (Layer 1) - Pure on-chain data with instant events
    - `roundCompleted`, `roundStarted`, `miningStatusChanged`, `roundDataUpdated` events
    - `getRound()`, `getCurrentRound()`, `getPreviousRound()` - Round data access
    - `getWinner()`, `hasWinner()`, `getWinnerHistory()` - Winner tracking
    - `wasLate` and `arrivalMs` fields for winner timing diagnostics
  - **`OredataState`** (Layer 2) - UI presentation logic with timing
    - `spinDurationMs`, `resultDisplayMs`, `maxWaitMs` config
    - `lateWinnerBehavior`: `'emit'` | `'skip'` | `'emit-late'`
    - `phaseChange`, `winnerReveal`, `winnerTimeout`, `resultOverlayShow/Hide` events
    - `getDisplayPhase()`, `getDisplayedWinner()`, `isResultOverlayVisible()`
    - `skipToResult()`, `dismissResult()` - UI control methods
- **New OredataClient methods**
  - `client.getStore()` - Access Layer 1 (OredataStore)
  - `client.createState(config)` - Create Layer 2 (OredataState)
- **React Hooks**
  - `useStore()` - Hook for OredataStore with React state bindings
  - `usePresenter()` - Hook for OredataState with timing and phase

### Why This Matters
- **Bots/Dashboards**: Use `OredataStore` for immediate data (no spin delays)
- **Game UIs**: Use `OredataState` for timed reveals and animations
- **Dropped Winners Fixed**: Winners always emit, even if new round started
- **Late Winners Handled**: Configurable behavior for delayed winner data

### Migration
Existing `useOredataState` and `StateClient` continue to work unchanged.
New `useStore`/`usePresenter` provide more control when needed.

See `docs/RFC-SDK-LAYER-SEPARATION.md` for full details.

## [0.7.1] - 2025-11-30

### Fixed
- **Winner events now always fire** - Finalized round winner is emitted even if new round has started
- **Winner state preserved** - Don't auto-clear winner on round change (let UI control visibility)
- **Reduced polling overhead** - Health poll interval increased to 15s, skip when state is healthy
- **Removed debug logging** - Clean console output in production

### Changed
- Default HTTP timeout reduced from 10s to 3s (faster feedback on slow connections)
- Quota polling disabled by default in browser (reduces unnecessary requests)

## [0.7.0] - 2025-11-29

### Added
- **`relayTransaction()`** - Relay signed transactions through the Oredata API
  - Eliminates need for direct Solana RPC in browser apps
  - API uses high-quality RPC for broadcast and confirmation
  - Optional confirmation with timeout handling

### Changed
- `08-react-game-app` example now uses relay (no `ConnectionProvider` needed for RPC)

## [0.6.1] - 2025-11-29

### Deprecated
- **`getBlockhash()`** - Use `buildBidTransaction()` / `buildClaimTransaction()` instead
  - V3 endpoints return blockhash with the transaction
  - Only use `getBlockhash()` for custom transaction assembly

### Changed
- Backend now proactively polls blockhash (instant TX building, no RPC wait)
- Updated `04-auto-bid-cheapest.ts` example to use V3 flow

## [0.6.0] - 2025-11-29

### Changed
- Documentation updates for V3 transaction endpoints

## [0.5.1] - 2025-11-29

### Fixed
- SDK release pipeline sync (internal)

## [0.5.0] - 2025-11-29

### Added
- **V3 Transaction Methods** - Ready-to-sign transactions from API
  - `buildBidTransaction()` - Returns base64 serialized transaction
  - `buildClaimTransaction()` - Returns base64 serialized transaction
  - No more manual instruction assembly needed!
- **`getBlockhash()`** - Fetch blockhash from API for RPC consistency
- **`getPlans()`** - Fetch available plans (SSOT for pricing)
- **`TransactionResponse` type** - New response format with `transaction`, `blockhash`, `lastValidBlockHeight`

### Changed
- `buildBid()` and `buildClaim()` now marked as deprecated (still work)
- `OredataHttpError.summary` - Human-friendly error messages
- `OredataHttpError.rootCause` - Underlying error detail

### Example
```typescript
// Before (0.4.x) - 15+ lines of manual assembly
const response = await client.buildBid({ ... });
const { blockhash } = await client.getBlockhash();
const tx = new Transaction();
// ... manual instruction conversion ...

// After (0.5.0) - 2 lines
const { transaction } = await client.buildBidTransaction({ authority, tiles, amountSol });
const tx = Transaction.from(Buffer.from(transaction, 'base64'));
```

## [0.4.0] - 2025-11-29

### Added
- **ORE Rewards Tracking** in `MinerStatus`
  - `unrefinedOre` - Mining rewards (10% tax on claim)
  - `refinedOre` - Staking rewards (no tax)
  - `totalClaimableOre` - Net claimable after tax estimate
  - `authorityOre` - ORE tokens in wallet
- **`oreRewardsChanged` event** in MinerClient
- **SDK User-Agent header** (`@oredata/sdk/0.4.0`) for analytics
- **Automatic 429 retry** with exponential backoff in MinerClient
- **Enhanced error classes** with `helpMessage`, `upgradeUrl` getters
- **Console warnings** when approaching rate limits or quotas

### Fixed
- Winner events now fire correctly in REST polling mode
- `phaseChange` events fire only on actual phase transitions

### Updated
- React hook `useMinerAccount` with ORE reward fields

## [0.3.0] - 2025-11-28

### Added
- **React Hooks package** (`@oredata/sdk/react`)
  - `OredataProvider` - Context provider
  - `useOredataState` - Game state hook
  - `useMinerAccount` - Wallet tracking hook
  - `useBidTracker` - Bid tracking hook
  - `useOredataEvents` - Event subscription hook
  - `OredataErrorBoundary` - Error boundary component

## [0.2.0] - 2025-11-27

### Added
- **Server-side Multiplexer** (`@oredata/sdk/server`)
  - `createMultiplexer` - Polling multiplexer
  - `expressSSE` - Express SSE middleware
  - `StateStore` - Server-side state management
- **`motherlode` event** - Jackpot detection
- **`roundFinalized` event** - Round completion
- **MinerClient** - Wallet/miner account tracking
- **BidTracker** - Client-side bid persistence

### Changed
- Winner event now fires twice (`optimistic` then `final`)

## [0.1.0] - 2025-11-26

### Added
- Initial release
- `OredataClient` - Main SDK client
- `StateClient` - Game state polling with REST/SSE
- Error classes for typed error handling
- TypeScript types for all API responses
