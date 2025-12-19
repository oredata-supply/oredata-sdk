# SDK Examples

These examples demonstrate correct SDK usage patterns. They're designed to be self-contained and heavily documented.

> **For more extensive examples**, see the `packages/examples/` folder in the monorepo, which contains runnable projects organized by complexity.

---

## Quick Start

```bash
# From sdk folder
cd examples
npx tsx 01-basic-winner-detection.ts
```

---

## Examples Overview

| File | Description | Key Concepts |
|------|-------------|--------------|
| [01-basic-winner-detection.ts](./01-basic-winner-detection.ts) | Simple winner detection | Layer 1 events, `isHistorical` |
| [02-backend-game-server.ts](./02-backend-game-server.ts) | Production game backend | Socket.IO, REST API, event handlers |
| [03-ui-timing-layer2.ts](./03-ui-timing-layer2.ts) | UI animations with timing | Layer 2, spin/reveal timing |
| [04-react-game-hook.tsx](./04-react-game-hook.tsx) | React hook pattern | Custom hook, state management |
| [05-anti-patterns.ts](./05-anti-patterns.ts) | What NOT to do | Common mistakes and fixes |

---

## Key Concepts

### Layer 1 vs Layer 2

```
Layer 1 (OredataStore)          Layer 2 (OredataState)
──────────────────────          ─────────────────────
- roundStarted                  - phaseChange
- roundCompleted  ← WINNERS     - winnerReveal
- roundDataUpdated              - resultOverlayShow/Hide
- miningStatusChanged           

Fires: IMMEDIATELY              Fires: AFTER timing delays
Use for: Game logic             Use for: UI animations
```

### Always Check `isHistorical`

```typescript
store.on('roundCompleted', ({ winner, isHistorical }) => {
  if (isHistorical) return; // Skip old events on page load
  
  announceWinner(winner.tile);
});
```

### Start the Client!

```typescript
const client = new OredataClient({ ... });
const store = client.getStore();

store.on('roundCompleted', ...);
store.on('roundStarted', ...);

// Don't forget this!
client.getStateClient().start();
```

---

## Environment Variables

```bash
# Optional but recommended for production
export OREDATA_API_KEY=your-api-key
```

Without an API key, you'll use the free tier with:
- 5 second winner delay
- 5 second bid lockout before round ends
- Lower rate limits

---

## More Resources

- [Architecture Overview](../docs/ARCHITECTURE.md) — Layer 1 vs Layer 2 explained
- [OredataStore API](../docs/STORE.md) — Full Layer 1 reference
- [Troubleshooting](../docs/TROUBLESHOOTING.md) — Common issues and anti-patterns

