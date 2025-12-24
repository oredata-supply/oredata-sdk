# OredataState (Layer 2) Reference

> **UI timing layer** — Provides delayed, presentation-friendly events for animations.

The `OredataState` sits on top of `OredataStore` and adds configurable delays for UI transitions. Use it for spin animations, winner reveals, and result overlays.

## Quick Start

```typescript
import { OredataClient } from '@oredata/sdk';

const client = new OredataClient({ baseUrls: ['https://api.oredata.supply'] });

const state = client.createState({
  spinDurationMs: 4000,    // Spin for 4 seconds
  resultDisplayMs: 15000,  // Show result for 15 seconds
});

state.on('winnerReveal', ({ winner }) => {
  highlightTile(winner.tile);
});

client.start();
```

---

## Configuration

```typescript
interface OredataStateConfig {
  /** Minimum spin animation duration (default: 4000ms) */
  spinDurationMs?: number;

  /** Result overlay display time (default: 15000ms) */
  resultDisplayMs?: number;

  /** Maximum wait for winner data (default: 25000ms) */
  maxWaitMs?: number;

  /** Auto-hide result overlay (default: true) */
  autoHideResult?: boolean;

  /** Show spinning phase (default: true) */
  showSpinPhase?: boolean;

  /**
   * Late winner behavior (default: 'emit-late')
   * - 'emit': Emit event even if late
   * - 'skip': Skip if winner arrives too late
   * - 'emit-late': Emit with wasLate flag
   */
  lateWinnerBehavior?: 'emit' | 'skip' | 'emit-late';
}
```

---

## Events

### `phaseChange`

Fires when the visual phase changes.

```typescript
state.on('phaseChange', (payload) => {
  payload.phase: 'BETTING' | 'SPINNING' | 'RESULT' | 'IDLE';
  payload.previousPhase: string;
  payload.roundId: string;
});

// Example: Update UI based on phase
state.on('phaseChange', ({ phase }) => {
  switch (phase) {
    case 'BETTING':
      showBettingUI();
      break;
    case 'SPINNING':
      showSpinAnimation();
      break;
    case 'RESULT':
      showResultOverlay();
      break;
    case 'IDLE':
      showBreatherScreen();
      break;
  }
});
```

### `winnerReveal`

Fires when it's time to reveal the winner (after spin animation).

```typescript
state.on('winnerReveal', (payload) => {
  payload.roundId: string;
  payload.winner: WinnerData;
  payload.wasLate: boolean;    // True if winner arrived after spin
  payload.arrivalMs: number;   // ms since round ended
});

// Example: Reveal winner with animation
state.on('winnerReveal', ({ winner, wasLate }) => {
  highlightTile(winner.tile);
  if (wasLate) {
    console.log('Winner arrived late, skipping spin');
  }
});
```

### `winnerTimeout`

Fires when winner data doesn't arrive within `maxWaitMs`.

```typescript
state.on('winnerTimeout', (payload) => {
  payload.roundId: string;
  payload.waitedMs: number;
});

// Example: Show error state
state.on('winnerTimeout', ({ roundId }) => {
  showError(`Winner for round ${roundId} not received`);
});
```

### `resultOverlayShow`

Fires when the result overlay should appear.

```typescript
state.on('resultOverlayShow', (payload) => {
  payload.roundId: string;
  payload.winner: WinnerData;
  payload.displayMs: number;  // How long to show
});
```

### `resultOverlayHide`

Fires when the result overlay should disappear.

```typescript
state.on('resultOverlayHide', (payload) => {
  payload.roundId: string;
});
```

### `error`

Fires on internal errors.

```typescript
state.on('error', (error) => {
  console.error('State error:', error);
});
```

---

## Methods

### `stop()`

Stop the state manager and clean up timers.

```typescript
// Cleanup on unmount
useEffect(() => {
  return () => state.stop();
}, []);
```

---

## Layer 1 vs Layer 2

| Aspect | OredataStore (Layer 1) | OredataState (Layer 2) |
|--------|------------------------|------------------------|
| Purpose | Pure data facts | UI presentation timing |
| Delays | None - immediate | Configurable |
| Events | `roundStarted`, `roundCompleted` | `phaseChange`, `winnerReveal` |
| Use | Game logic, bots | UI animations |

### Anti-Pattern: Using Layer 2 for Game Logic

```typescript
// BAD: Disabling bets too late
state.on('winnerReveal', () => {
  setBettingEnabled(false); // Wrong! Users might bet during spin
});

// GOOD: Use Layer 1 for logic
store.on('roundCompleted', () => {
  setBettingEnabled(false); // Immediately disable
});

// Layer 2 for visuals only
state.on('winnerReveal', ({ winner }) => {
  playWinnerAnimation(winner.tile);
});
```

---

## Late Winner Behavior

Winners can arrive late due to network issues. Configure how to handle:

### `'emit'` - Always emit

```typescript
const state = client.createState({
  lateWinnerBehavior: 'emit',
});

// Event fires even if 30 seconds late
```

### `'skip'` - Skip late winners

```typescript
const state = client.createState({
  lateWinnerBehavior: 'skip',
});

// No event if winner arrives after maxWaitMs
```

### `'emit-late'` - Emit with flag (default)

```typescript
const state = client.createState({
  lateWinnerBehavior: 'emit-late',
});

state.on('winnerReveal', ({ winner, wasLate }) => {
  if (wasLate) {
    // Skip spin, show winner immediately
    showWinnerInstantly(winner.tile);
  } else {
    // Normal flow with spin
    playSpinThenReveal(winner.tile);
  }
});
```

---

## Full Example: Game UI

```typescript
import { OredataClient } from '@oredata/sdk';

const client = new OredataClient({
  baseUrls: ['https://api.oredata.supply'],
  apiKey: 'ore_...',
});

const store = client.getStore();
const state = client.createState({
  spinDurationMs: 4000,
  resultDisplayMs: 10000,
});

// Layer 1: Game logic
store.on('roundStarted', () => {
  enableBetting();
});

store.on('roundCompleted', () => {
  disableBetting();
});

// Layer 2: UI animations
state.on('phaseChange', ({ phase }) => {
  updatePhaseIndicator(phase);
});

state.on('winnerReveal', ({ winner }) => {
  highlightWinningTile(winner.tile);
  if (userBetOnTile(winner.tile)) {
    playConfetti();
  }
});

state.on('resultOverlayHide', () => {
  resetBoard();
});

client.start();
```

---

## Related

- [OredataStore (Layer 1)](./STORE.md)
- [OredataClient](./OREDATA-CLIENT.md)
- [React Hooks](../integrations/REACT.md)
