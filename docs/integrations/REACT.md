# React Hooks (`@oredata/sdk/react`)

React bindings for the Oredata SDK with hooks, context provider, and error boundaries.

## Installation

```bash
npm install @oredata/sdk react react-dom
```

## Quick Start

```tsx
import { OredataProvider, useOredataState } from '@oredata/sdk/react';

function App() {
  return (
    <OredataProvider 
      config={{ 
        baseUrls: ['https://api.oredata.supply'],
        apiKey: process.env.REACT_APP_ORE_API_KEY 
      }}
    >
      <Game />
    </OredataProvider>
  );
}

function Game() {
  const { phase, pot, winner, isConnected } = useOredataState();
  
  if (!isConnected) return <div>Connecting...</div>;
  
  return (
    <div>
      <p>Phase: {phase}</p>
      <p>Pot: {pot} SOL</p>
      {winner && <p>Winner: Tile {winner}</p>}
    </div>
  );
}
```

---

## Provider

### `OredataProvider`

Wrap your app with the provider to enable hooks:

```tsx
<OredataProvider 
  config={{
    baseUrls: ['https://api.oredata.supply'],
    apiKey: 'your-key',
  }}
  stateConfig={{
    pollIntervalMs: 1000,
    transport: { mode: 'rest' },
  }}
>
  {children}
</OredataProvider>
```

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `config` | `OredataClientConfig` | Yes | API configuration |
| `stateConfig` | `StateClientConfig` | No | Polling/transport options |
| `minerAuthority` | `string` | No | Wallet pubkey for `useMinerAccount` |

---

## Hooks

### `useOredataState()`

Access game state reactively:

```tsx
const {
  // Game state
  phase,              // 'BETTING' | 'SPINNING' | 'RESULT'
  currentRoundId,
  pot,                // Total SOL in pot
  tiles,              // Array of tile data
  
  // Winner info
  winner,             // Winning tile index (null during betting)
  winnerType,         // 'optimistic' | 'final'
  motherlode,         // Jackpot info if hit
  
  // Connection
  isConnected,
  isStale,
  error,
  
  // Timing
  phaseSince,
  phaseUntil,
  secondsRemaining,
  
  // Full snapshots
  latestSnapshot,
  latestFrame,
} = useOredataState();
```

### `useMinerAccount()`

Track wallet balance and rewards:

```tsx
// Set authority in provider or pass directly
const {
  // Existence
  exists,             // Has miner account
  needsCheckpoint,    // Needs checkpoint before claim
  
  // SOL
  authoritySol,       // Wallet SOL balance
  claimableSol,       // Claimable rewards
  
  // ORE
  unrefinedOre,       // Mining rewards (10% tax on claim)
  refinedOre,         // Staking rewards (no tax)
  totalClaimableOre,  // Total after tax
  authorityOre,       // ORE tokens in wallet
  
  // Status
  loading,
  error,
  lastUpdate,
} = useMinerAccount('YourWalletPubkey');
```

### `useBidTracker()`

Track user bids with localStorage persistence:

```tsx
const {
  // Bids
  bids,                 // All tracked bids
  currentRoundBids,     // Bids for current round
  
  // Actions
  trackBid,             // Add a bid
  clearRoundBids,       // Clear bids for a round
  
  // Win detection
  hasPendingWin,        // User won but hasn't seen it
  markWinSeen,          // Mark win as seen
} = useBidTracker(currentRoundId, winner);

// Track a bid
trackBid({
  roundId: '12345',
  tiles: [0, 4, 11],  // 0-indexed (0-24)
  amountLamports: '25000000',
  signature: 'tx-sig...',
});
```

### `useOredataEvents()`

Subscribe to specific events:

```tsx
useOredataEvents({
  onWinner: ({ roundId, winner, type }) => {
    playWinAnimation(winner);
  },
  onMotherlode: ({ oreAmount }) => {
    showJackpotAlert(oreAmount);
  },
  onPhaseChange: (phase) => {
    updateUI(phase);
  },
});
```

### `useRoundTiming()` ⏱️

Real-time countdown hook with actual network slot duration. This is the recommended way to build progress bars and countdowns.

```tsx
import { useRoundTiming } from '@oredata/sdk/react';

function GameTimer() {
  const {
    // BETTING phase values
    progress,          // 0→1 during BETTING (use for LEFT→RIGHT bar)
    inRound,           // true during BETTING phase
    roundEndsInMs,     // ms until BETTING ends

    // BREATHER phase values
    breatherProgress,  // 1→0 during BREATHER (use for RIGHT→LEFT bar)
    inBreather,        // true during SPINNING/RESULT/IDLE
    nextRoundStartsInMs, // ms until next BETTING (estimated if !nextRoundKnown)
    nextRoundKnown,    // false = nextRoundStartsInMs is estimated
    breatherDurationMs, // Dynamic (from slots) or fallback (18s)

    // Universal
    countdown,         // Human-readable: "42s" or "Starting soon..."
    phaseLabel,        // 'BETTING' | 'BREATHER' | 'IDLE'
    currentSlot,       // Current Solana slot
    isReady,           // Connection established
  } = useRoundTiming();

  return (
    <div className={inRound ? 'betting' : 'breather'}>
      <span>{phaseLabel}</span>
      <span>{countdown}</span>

      {/* BETTING: progress bar fills left→right */}
      {inRound && progress !== null && (
        <div className="progress-bar">
          <div style={{ width: `${progress * 100}%` }} />
        </div>
      )}

      {/* BREATHER: progress bar shrinks right→left */}
      {inBreather && breatherProgress !== null && (
        <div className="progress-bar breather">
          <div style={{ width: `${breatherProgress * 100}%` }} />
        </div>
      )}

      {/* Show estimation indicator when timing is approximate */}
      {inBreather && !nextRoundKnown && (
        <span className="animate-pulse" title="Estimated">~</span>
      )}
    </div>
  );
}
```

> **Important:** During the breather, `breatherProgress` and `nextRoundStartsInMs` are **estimated** because `nextRound.startSlot` is unknown until the next round starts. Check `nextRoundKnown` to determine if values are exact or estimated. See [Timing Deep Dive](../01-CORE-CONCEPTS.md#timing-deep-dive) for details.

**Options:**

```tsx
const timing = useRoundTiming({
  refreshIntervalMs: 100,  // How often to update (default: 100)
  soonMessage: 'Hang tight...', // Custom "soon" message
  idleMessage: 'Connecting...', // Custom idle message
  // These overrides are rarely needed—SDK uses real network values:
  slotDurationMs: 400, // Override auto-detected slot duration
  breatherDurationMs: 18000, // Override estimated breather duration
});
```

**Return values:**

| Property | Type | Phase | Description |
|----------|------|-------|-------------|
| **BETTING Phase** ||||
| `inRound` | boolean | — | True during betting phase |
| `progress` | number \| null | BETTING | 0→1 progress (use for left→right bar) |
| `roundEndsInMs` | number \| null | BETTING | Countdown in ms until round ends |
| **BREATHER Phase** ||||
| `inBreather` | boolean | — | True between rounds (SPINNING/RESULT/IDLE) |
| `breatherProgress` | number \| null | BREATHER | 1→0 progress (use for right→left bar) |
| `nextRoundStartsInMs` | number \| null | BREATHER | Countdown in ms until next round (**estimated** if `!nextRoundKnown`) |
| `nextRoundKnown` | boolean | BREATHER | True when `nextRound.startSlot` available (false = values are estimated) |
| `breatherDurationMs` | number | BREATHER | Calculated duration (dynamic from slots, falls back to ~18s) |
| **Universal** ||||
| `countdown` | string | Both | Human-readable: "42s" or "Next round soon..." |
| `phaseLabel` | string | Both | 'BETTING' \| 'BREATHER' \| 'IDLE' |
| `currentSlot` | number \| null | Both | Current Solana slot |
| `refresh` | () => void | Both | Manually trigger recalculation |
| `isReady` | boolean | Both | True when store is initialized |

**Key features:**
- Uses **actual network slot duration** from the API (not hardcoded 400ms)
- **Interpolates** between API polls for smooth countdown without flickering
- **Calculates exact breather duration** from slot data when available
- Auto-refreshes every 100ms by default

**Recipe: Animated Progress Fuse**

```tsx
// Complete example with correct animation directions
import { useRoundTiming } from '@oredata/sdk/react';

export function FuseProgressBar() {
  const {
    progress,
    breatherProgress,
    inRound,
    inBreather,
    nextRoundKnown,
  } = useRoundTiming({ refreshIntervalMs: 100 });

  // Determine which progress value to use
  const displayProgress = inRound
    ? (progress ?? 0)
    : (breatherProgress ?? 0);

  // Color based on phase
  const barColor = inRound ? 'bg-green-500' : 'bg-amber-500';

  // Show estimation indicator during breather when we're guessing
  const isEstimated = inBreather && !nextRoundKnown;

  return (
    <div className="relative w-full h-2 bg-gray-800 rounded">
      <div
        className={`absolute inset-y-0 left-0 ${barColor} rounded transition-all`}
        style={{ width: `${displayProgress * 100}%` }}
      />
      {isEstimated && (
        <div className="absolute right-1 top-0 text-xs text-gray-400">~</div>
      )}
    </div>
  );
}
```

---

## Error Boundary

Wrap components to catch SDK errors:

```tsx
import { OredataErrorBoundary, ConnectionError } from '@oredata/sdk/react';

function App() {
  return (
    <OredataErrorBoundary
      fallback={<ConnectionError />}
      onError={(error) => console.error(error)}
    >
      <Game />
    </OredataErrorBoundary>
  );
}
```

### Custom Error UI

```tsx
<OredataErrorBoundary
  fallback={({ error, retry }) => (
    <div>
      <p>Connection lost: {error.message}</p>
      <button onClick={retry}>Retry</button>
    </div>
  )}
>
  <Game />
</OredataErrorBoundary>
```

---

## Full Example

```tsx
import {
  OredataProvider,
  OredataErrorBoundary,
  useOredataState,
  useMinerAccount,
  useBidTracker,
} from '@oredata/sdk/react';

const config = {
  baseUrls: ['https://api.oredata.supply'],
  apiKey: process.env.REACT_APP_ORE_API_KEY,
};

export default function App() {
  return (
    <OredataProvider config={config} minerAuthority={walletPubkey}>
      <OredataErrorBoundary>
        <GameBoard />
      </OredataErrorBoundary>
    </OredataProvider>
  );
}

function GameBoard() {
  const { phase, pot, winner, tiles, isConnected } = useOredataState();
  const { claimableSol, unrefinedOre } = useMinerAccount();
  const { currentRoundBids, hasPendingWin } = useBidTracker();

  if (!isConnected) {
    return <LoadingSpinner />;
  }

  return (
    <div>
      <Header phase={phase} pot={pot} />
      <TileGrid tiles={tiles} myBids={currentRoundBids} />
      {winner && <WinnerOverlay tile={winner} isMyWin={hasPendingWin} />}
      <Wallet claimable={claimableSol} ore={unrefinedOre} />
    </div>
  );
}
```

---

## TypeScript Types

All hooks are fully typed:

```tsx
import type {
  UseOredataStateReturn,
  UseMinerAccountReturn,
  UseBidTrackerReturn,
} from '@oredata/sdk/react';
```

---

## See Also

- [Main SDK Docs](../README.md)
- [Server Multiplexer](./SERVER.md) - For production with many users
- [Troubleshooting](./TROUBLESHOOTING.md)

