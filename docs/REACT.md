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

Real-time countdown hook with actual network slot duration:

```tsx
import { useRoundTiming } from '@oredata/sdk/react';

function GameTimer() {
  const {
    countdown,      // "42s" or "Next round starting soon..."
    inRound,        // true during betting phase
    inBreather,     // true between rounds
    progress,       // 0-1 for progress bars
    nextRoundKnown, // true when nextRound data available
    phaseLabel,     // 'BETTING' | 'BREATHER' | 'IDLE'
  } = useRoundTiming();

  return (
    <div className={inRound ? 'betting' : 'breather'}>
      <span>{phaseLabel}</span>
      <span>{countdown}</span>
      {inRound && progress !== null && (
        <div className="progress-bar">
          <div style={{ width: `${progress * 100}%` }} />
        </div>
      )}
      {inBreather && !nextRoundKnown && (
        <span className="animate-pulse">⏳</span>
      )}
    </div>
  );
}
```

**Options:**

```tsx
const timing = useRoundTiming({
  refreshIntervalMs: 100,  // How often to update (default: 100)
  soonMessage: 'Hang tight...', // Custom "soon" message
  idleMessage: 'Connecting...', // Custom idle message
  slotDurationMs: 400, // Override auto-detected slot duration
});
```

**Return values:**

| Property | Type | Description |
|----------|------|-------------|
| `inRound` | boolean | True during betting phase |
| `inBreather` | boolean | True between rounds |
| `roundEndsInMs` | number \| null | Countdown during round |
| `nextRoundStartsInMs` | number \| null | Countdown during late breather |
| `nextRoundKnown` | boolean | True when nextRound data available |
| `progress` | number \| null | 0-1 for progress bars |
| `countdown` | string | Human-readable ("42s" or "Next round soon...") |
| `phaseLabel` | string | 'BETTING' \| 'BREATHER' \| 'IDLE' |
| `currentSlot` | number \| null | Current Solana slot |
| `refresh` | () => void | Manually trigger recalculation |
| `isReady` | boolean | True when store is initialized |

**Features:**
- Uses actual network slot duration (not hardcoded 400ms)
- Interpolates between API polls for smooth countdown
- Auto-refreshes every 100ms by default

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

