# Changelog

All notable changes to `@oredata/sdk` will be documented in this file.

## [0.9.1] - 2025-12-02

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

