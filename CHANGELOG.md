# Changelog

All notable changes to `@oredata/sdk` will be documented in this file.

## [0.10.0] - 2025-12-03

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

