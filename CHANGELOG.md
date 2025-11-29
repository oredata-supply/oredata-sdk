# Changelog

All notable changes to `@oredata/sdk` will be documented in this file.

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

