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
        baseUrls: ['https://ore-api.gmore.fun'],
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
    baseUrls: ['https://ore-api.gmore.fun'],
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
  tiles: [1, 5, 12],
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
  baseUrls: ['https://ore-api.gmore.fun'],
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

