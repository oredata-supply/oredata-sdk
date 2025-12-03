# SDK Event Catalog

> ⚠️ **DEPRECATED** — This document has been superseded by more focused docs:
>
> - **[ARCHITECTURE.md](./ARCHITECTURE.md)** — Layer 1 vs Layer 2, choose your pattern, event overview
> - **[STORE.md](./STORE.md)** — OredataStore (Layer 1) complete reference
> - **[TROUBLESHOOTING.md](./TROUBLESHOOTING.md)** — Common issues and anti-patterns
>
> This file is kept for reference but may contain outdated information.

---

## Quick Reference

### Layer 1: OredataStore (Use for game logic)

```typescript
const store = client.getStore();

store.on('roundStarted', ({ roundId, isHistorical }) => { ... });
store.on('roundCompleted', ({ roundId, winner, isHistorical }) => { ... });
store.on('roundDataUpdated', ({ roundId, data, changes }) => { ... });
store.on('miningStatusChanged', ({ roundId, status }) => { ... });
```

### Layer 2: OredataState (Use for UI animations)

```typescript
const state = client.createState({ spinDurationMs: 4000 });

state.on('phaseChange', ({ phase, roundId }) => { ... });
state.on('winnerReveal', ({ roundId, winner, wasLate }) => { ... });
state.on('winnerTimeout', ({ roundId, reason }) => { ... });
```

### MinerClient (Wallet tracking)

```typescript
const miner = client.getMinerClient('YourWalletPubkey');

miner.on('update', (status) => { ... });
miner.on('rewardsChanged', (payload) => { ... });
miner.on('oreRewardsChanged', (payload) => { ... });
miner.on('needsCheckpoint', (payload) => { ... });
```

---

## MinerClient Events Reference

> This section is kept as MinerClient isn't covered in other docs yet.

### `update`

Fires when miner data updates.

```typescript
interface MinerStatus {
  address: string;
  exists: boolean;
  
  // Claimable rewards
  claimableSol: number | null;
  claimableLamports: string | null;
  
  // ORE rewards
  unrefinedOre: number | null;
  refinedOre: number | null;
  authorityOre: number;
  
  // Round participation
  currentRoundId: string | null;
  lastCheckpointRoundId: string | null;
  isActive: boolean;
  
  // Timestamps
  lastUpdated: number;
}

miner.on('update', (status: MinerStatus) => {
  console.log(`Claimable: ${status.claimableSol} SOL`);
  console.log(`Unrefined ORE: ${status.unrefinedOre}`);
});
```

### `rewardsChanged`

Fires when claimable SOL rewards change.

```typescript
miner.on('rewardsChanged', ({ previous, current }) => {
  console.log(`SOL rewards: ${previous} → ${current}`);
});
```

### `oreRewardsChanged`

Fires when ORE rewards change.

```typescript
miner.on('oreRewardsChanged', ({ 
  previousUnrefined, currentUnrefined,
  previousRefined, currentRefined 
}) => {
  console.log(`Unrefined: ${previousUnrefined} → ${currentUnrefined}`);
  console.log(`Refined: ${previousRefined} → ${currentRefined}`);
});
```

### `needsCheckpoint`

Fires when miner has pending rewards that need checkpointing.

```typescript
miner.on('needsCheckpoint', ({ pendingSol }) => {
  console.log(`Pending rewards: ${pendingSol} SOL`);
  // Consider calling buildClaimTransaction()
});
```

---

## See Also

- [ARCHITECTURE.md](./ARCHITECTURE.md) — Start here
- [STORE.md](./STORE.md) — OredataStore Layer 1 reference
- [REACT.md](./REACT.md) — React hooks
