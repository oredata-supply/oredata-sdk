# Transaction Guide

> **For:** Third-party integrations (orepump, orelette, bots)  
> **SDK Version:** 0.8.0+  
> **Last Updated:** December 2025

Complete guide for building, signing, and sending ORE transactions.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [The Complete Flow](#the-complete-flow)
3. [Building Transactions](#building-transactions)
4. [Signing Transactions](#signing-transactions)
5. [Sending Transactions](#sending-transactions)
6. [Error Handling](#error-handling)
7. [Browser vs Node.js](#browser-vs-nodejs)
8. [Common Patterns](#common-patterns)
9. [Troubleshooting](#troubleshooting)

---

## Quick Start

**The simplest bid flow (browser with wallet adapter):**

```typescript
import { OredataClient } from '@oredata/sdk';
import { useWallet } from '@solana/wallet-adapter-react';
import { Transaction } from '@solana/web3.js';

const client = new OredataClient({
  baseUrls: ['https://api.oredata.supply'],
});

// In your component
const { publicKey, signTransaction } = useWallet();

async function placeBid(tiles: number[], amountSol: number) {
  // 1. Build transaction (API does the heavy lifting)
  const { transaction, blockhash, lastValidBlockHeight } = await client.buildBidTransaction({
    authority: publicKey.toString(),
    tiles,        // e.g., [0, 4, 11] - which tiles to bet on (0-indexed)
    amountSol,    // e.g., 0.025 - SOL per tile
  });

  // 2. Decode and sign
  const tx = Transaction.from(Buffer.from(transaction, 'base64'));
  const signedTx = await signTransaction(tx);

  // 3. Send via relay (recommended - no RPC needed!)
  const { signature, confirmed } = await client.relayTransaction({
    transaction: Buffer.from(signedTx.serialize()).toString('base64'),
    blockhash,
    lastValidBlockHeight,
  });

  console.log(`✅ Bid confirmed: ${signature}`);
}
```

That's it! **3 steps**: Build → Sign → Relay.

---

## The Complete Flow

### What Happens Under the Hood

```
┌────────────────────────────────────────────────────────────────────┐
│  Your App                                                           │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  1. Call buildBidTransaction()                                │  │
│  └──────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────────┐
│  Oredata API                                                        │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  POST /v3/tx/bid                                              │  │
│  │  • Checks rate limits                                         │  │
│  │  • Checks bid lockout (can't bid in final 5/4/3s by plan)    │  │
│  │  • Checks if miner needs checkpoint                           │  │
│  │  • Builds bid instructions                                    │  │
│  │  • Adds platform fee (0.25% of bet)                          │  │
│  │  • Gets fresh blockhash (cached, instant)                     │  │
│  │  • ⭐ Simulates transaction (catches errors before user)      │  │
│  │  • Serializes transaction (ready to sign)                     │  │
│  │  Returns: { transaction, blockhash, lastValidBlockHeight }    │  │
│  └──────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────────┐
│  Your App                                                           │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  2. Decode transaction (base64 → Transaction object)         │  │
│  │  3. Sign with wallet adapter                                  │  │
│  │  4. Encode signed transaction (serialize → base64)           │  │
│  └──────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────────┐
│  Oredata API (Relay)                                                │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  POST /solana/relay                                           │  │
│  │  • Deserializes transaction                                   │  │
│  │  • Broadcasts to Solana via our RPC                          │  │
│  │  • Confirms transaction                                       │  │
│  │  Returns: { signature, confirmed }                            │  │
│  └──────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────────┐
│  Solana                                                             │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  Transaction processed on-chain                               │  │
│  │  • SOL transferred from wallet to treasury                   │  │
│  │  • Bid recorded in ORE program                               │  │
│  └──────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

---

## Building Transactions

### Bid Transaction

```typescript
const response = await client.buildBidTransaction({
  authority: wallet.publicKey.toString(),  // Your wallet address
  tiles: [0, 4, 11],                        // Tiles to bet on (0-24, 0-indexed)
  amountSol: 0.025,                         // SOL per tile (total = 0.075)
});

// Response structure
interface BidTransactionResponse {
  transaction: string;           // Base64 encoded, ready to sign
  blockhash: string;             // Recent blockhash
  lastValidBlockHeight: number;  // Expiry block
  platformFeeLamports: number;   // Our fee (0.25% of bet)
  metadata: {
    roundId: string;             // Current round
    tiles: number[];             // Tiles in this bet
    needsCheckpoint: boolean;    // If true, checkpoint is included
  };
}
```

### Transaction Simulation (v0.12.6+)

Transactions are **pre-simulated server-side** before being returned. This:
- Catches errors before users see them in their wallet
- Reduces Phantom "risky transaction" warnings
- Returns detailed error logs if simulation fails

### Instruction Ordering (v0.12.7+)

Bid transactions are structured to minimize wallet security warnings:

```
1. Checkpoint (if needed)      — Settle previous round
2. Deploy (bid)                — Main ORE program interaction
3. Platform fee transfer       — API relay fee (0.25%)
```

**Why this order matters:**

Leading with the ORE program instruction establishes transaction legitimacy 
before the fee transfer. Wallets like Phantom use heuristics to detect 
"drainer" patterns — starting a transaction with "send SOL to unknown address" 
can trigger warnings. By placing the fee transfer last (after legitimate 
program interaction), we reduce false-positive security alerts.

> **Note:** If you're building transactions client-side, follow this same 
> instruction order to avoid wallet warnings.

**Skip Simulation (Power Users):**

For lower latency (~50-100ms saved), you can skip simulation:

```typescript
const response = await client.buildBidTransaction({
  authority: wallet.publicKey.toString(),
  tiles: [0, 4, 11],
  amountSol: 0.025,
  skipSimulation: true,  // Not recommended - may cause wallet warnings
});
```

**Handle Simulation Errors:**

```typescript
import { OredataSimulationError } from '@oredata/sdk';

try {
  await client.buildBidTransaction({ ... });
} catch (e) {
  if (OredataSimulationError.is(e)) {
    console.log(`Transaction would fail: ${e.simulationError}`);
    console.log(`Logs: ${e.logs?.join('\n')}`);
    showToast('Transaction failed validation. Please try again.');
  }
}
```

### Claim SOL Transaction

Claims SOL rewards from your miner account.

> **Note:** You can use either `buildClaimTransaction()` or `buildClaimSolTransaction()` — they are identical.
> The `buildClaimSolTransaction()` alias exists for discoverability.

```typescript
const response = await client.buildClaimSolTransaction({
  authority: wallet.publicKey.toString(),
});

// Or equivalently:
const response = await client.buildClaimTransaction({
  authority: wallet.publicKey.toString(),
});

// Response structure
interface ClaimTransactionResponse {
  transaction: string;
  blockhash: string;
  lastValidBlockHeight: number;
  platformFeeLamports: number;   // Always 0 for claims
  metadata: {
    needsCheckpoint: boolean;    // If true, checkpoint is included
  };
}
```

### Claim ORE Transaction

Claims ORE token rewards from your miner account. This is different from claiming SOL.

**ORE Rewards:**
- `unrefinedOre` — Mining rewards (10% tax on claim)
- `refinedOre` — Staking rewards (no tax)
- `totalClaimableOre` — Net claimable after tax

```typescript
const response = await client.buildClaimOreTransaction({
  authority: wallet.publicKey.toString(),
});

// Response structure (same as SOL claim)
interface ClaimOreTransactionResponse {
  transaction: string;
  blockhash: string;
  lastValidBlockHeight: number;
  platformFeeLamports: number;   // Always 0 for claims
  metadata: {
    needsCheckpoint: boolean;    // If true, checkpoint is included
  };
}
```

**Example: Check ORE balance before claiming**

```typescript
const status = await client.getMinerStatus(wallet.publicKey.toString());

console.log(`Unrefined ORE: ${status.unrefinedOre} (10% tax on claim)`);
console.log(`Refined ORE: ${status.refinedOre} (no tax)`);
console.log(`Total claimable: ${status.totalClaimableOre}`);

if (status.totalClaimableOre > 0) {
  const { transaction } = await client.buildClaimOreTransaction({
    authority: wallet.publicKey.toString(),
  });
  // ... sign and send
}
```

### What Gets Included Automatically

| Concern | Handled By |
|---------|------------|
| Miner PDA creation | API (if first bid) |
| Checkpoint instruction | API (if needed) |
| Platform fee transfer | API (0.25% for bids, 0% for claims) |
| Fresh blockhash | API (cached, instant) |
| Correct program accounts | API |

---

## Signing Transactions

### Browser (Wallet Adapter)

```typescript
import { Transaction } from '@solana/web3.js';
import { useWallet } from '@solana/wallet-adapter-react';

const { signTransaction } = useWallet();

// Decode the transaction
const tx = Transaction.from(Buffer.from(response.transaction, 'base64'));

// Sign it
const signedTx = await signTransaction(tx);

// Encode for sending
const signedBase64 = Buffer.from(signedTx.serialize()).toString('base64');
```

### Node.js (Keypair)

```typescript
import { Transaction, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

// Load your keypair
const secretKey = bs58.decode(process.env.WALLET_SECRET_KEY);
const keypair = Keypair.fromSecretKey(secretKey);

// Decode the transaction
const tx = Transaction.from(Buffer.from(response.transaction, 'base64'));

// Sign it
tx.sign(keypair);

// Encode for sending
const signedBase64 = Buffer.from(tx.serialize()).toString('base64');
```

### Important: Don't Modify the Transaction

The API builds a complete transaction. **Don't add instructions** — it may break:

```typescript
// ❌ DON'T DO THIS
tx.add(someOtherInstruction);

// ✅ Use the transaction as-is
const signedTx = await signTransaction(tx);
```

---

## Sending Transactions

### Option 1: Relay (Recommended)

Use our API to broadcast. **No RPC connection needed in your app!**

```typescript
const { signature, confirmed } = await client.relayTransaction({
  transaction: signedBase64,
  blockhash,
  lastValidBlockHeight,
  skipPreflight: false,  // Optional, default false
});

if (confirmed) {
  console.log('✅ Transaction confirmed:', signature);
} else {
  console.log('📤 Transaction sent (confirming...):', signature);
}
```

**Benefits:**
- No need for your own RPC
- Uses our high-quality RPC infrastructure
- Handles confirmation for you
- Works in browsers with strict CSP

### Option 2: Direct RPC (Traditional)

Send via your own RPC connection:

```typescript
import { Connection } from '@solana/web3.js';

const connection = new Connection('https://your-rpc.com');

// If using wallet adapter
const signature = await sendTransaction(signedTx, connection);

// Or manually
const signature = await connection.sendRawTransaction(signedTx.serialize());

// Wait for confirmation
await connection.confirmTransaction({
  signature,
  blockhash,
  lastValidBlockHeight,
});
```

**When to use Direct RPC:**
- You have a premium RPC subscription
- Need custom transaction options
- Running backend infrastructure

---

## Error Handling

### Bid Lockout (HTTP 423)

Lower-tier plans can't bid in the final seconds of a round:

```typescript
import { OredataLockoutError } from '@oredata/sdk';

try {
  const response = await client.buildBidTransaction({ ... });
} catch (error) {
  if (error instanceof OredataLockoutError) {
    console.log(`❌ Bidding locked: ${error.message}`);
    console.log(`   Lockout: ${error.lockoutSeconds}s before round ends`);
    console.log(`   Upgrade: ${error.upgradeHint}`);
    
    // Show user-friendly message
    showToast('Bidding closed! Wait for next round.');
  }
}
```

**Lockout by plan:**

| Plan | Lockout |
|------|---------|
| free | 5 seconds |
| dev | 4 seconds |
| pro | 3 seconds |
| ultra | None |

### Rate Limit (HTTP 429)

```typescript
import { OredataRateLimitError } from '@oredata/sdk';

try {
  const response = await client.buildBidTransaction({ ... });
} catch (error) {
  if (error instanceof OredataRateLimitError) {
    console.log(`❌ Rate limited: ${error.message}`);
    console.log(`   Retry after: ${error.retryAfter}ms`);
    
    // Wait and retry
    await sleep(error.retryAfter);
    // ... retry
  }
}
```

### Simulation Failure (HTTP 400)

**Since v0.12.6:** Transactions are simulated server-side during `buildBidTransaction()` / `buildClaimTransaction()`. If simulation fails, you get an error immediately — before the user sees the transaction in their wallet.

```typescript
import { OredataSimulationError } from '@oredata/sdk';

try {
  const response = await client.buildBidTransaction({ ... });
} catch (error) {
  if (error instanceof OredataSimulationError) {
    console.log(`❌ Transaction would fail: ${error.message}`);
    console.log(`   Error: ${error.simulationError}`);
    console.log(`   Logs: ${error.logs?.join('\n')}`);
    
    // Common causes:
    // - Insufficient SOL balance
    // - Round already ended
    // - Miner account issue
  }
}
```

> **Tip:** You can skip simulation with `skipSimulation: true` for lower latency, but errors will then surface when the user tries to sign or submit the transaction.

### Complete Error Handler

```typescript
import {
  OredataLockoutError,
  OredataRateLimitError,
  OredataSimulationError,
  OredataHttpError,
  OredataNetworkError,
} from '@oredata/sdk';

async function safeBid(tiles: number[], amountSol: number) {
  try {
    const response = await client.buildBidTransaction({
      authority: wallet.publicKey.toString(),
      tiles,
      amountSol,
    });
    
    const tx = Transaction.from(Buffer.from(response.transaction, 'base64'));
    const signedTx = await signTransaction(tx);
    
    const result = await client.relayTransaction({
      transaction: Buffer.from(signedTx.serialize()).toString('base64'),
      blockhash: response.blockhash,
      lastValidBlockHeight: response.lastValidBlockHeight,
    });
    
    return { success: true, signature: result.signature };
    
  } catch (error) {
    if (error instanceof OredataLockoutError) {
      return { success: false, error: 'Bidding closed', retryable: false };
    }
    
    if (error instanceof OredataRateLimitError) {
      return { 
        success: false, 
        error: 'Too many requests', 
        retryable: true,
        retryAfterMs: error.retryAfter,
      };
    }
    
    if (error instanceof OredataSimulationError) {
      return { success: false, error: error.message, retryable: false };
    }
    
    if (error instanceof OredataNetworkError) {
      return { success: false, error: 'Network error', retryable: true };
    }
    
    // Unknown error
    console.error('Unexpected error:', error);
    return { success: false, error: 'Something went wrong', retryable: false };
  }
}
```

---

## Browser vs Node.js

### Browser (React/Next.js)

```typescript
// Install
npm install @oredata/sdk @solana/wallet-adapter-react @solana/web3.js

// You may need Buffer polyfill for Vite:
// npm install vite-plugin-node-polyfills
```

```tsx
import { OredataClient } from '@oredata/sdk';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { Transaction } from '@solana/web3.js';

function BetButton() {
  const { publicKey, signTransaction } = useWallet();
  const client = useMemo(() => new OredataClient({
    baseUrls: ['https://api.oredata.supply'],
  }), []);

  const handleBet = async () => {
    // Build
    const response = await client.buildBidTransaction({
      authority: publicKey.toString(),
      tiles: [7],
      amountSol: 0.01,
    });

    // Sign
    const tx = Transaction.from(Buffer.from(response.transaction, 'base64'));
    const signed = await signTransaction(tx);

    // Relay
    await client.relayTransaction({
      transaction: Buffer.from(signed.serialize()).toString('base64'),
      blockhash: response.blockhash,
      lastValidBlockHeight: response.lastValidBlockHeight,
    });
  };

  return <button onClick={handleBet}>Bet 0.01 SOL</button>;
}
```

### Node.js (Bot/Backend)

```typescript
// Install
npm install @oredata/sdk @solana/web3.js bs58

// For ESM, add to package.json: "type": "module"
```

```typescript
import { OredataClient } from '@oredata/sdk';
import { Transaction, Keypair, Connection } from '@solana/web3.js';
import bs58 from 'bs58';

const client = new OredataClient({
  baseUrls: ['https://api.oredata.supply'],
  apiKey: process.env.OREDATA_API_KEY,
});

// Load wallet from environment
const keypair = Keypair.fromSecretKey(
  bs58.decode(process.env.WALLET_SECRET_KEY)
);

async function placeBid(tiles: number[], amountSol: number) {
  // Build
  const response = await client.buildBidTransaction({
    authority: keypair.publicKey.toString(),
    tiles,
    amountSol,
  });

  // Sign
  const tx = Transaction.from(Buffer.from(response.transaction, 'base64'));
  tx.sign(keypair);

  // Relay (or use your own RPC)
  const result = await client.relayTransaction({
    transaction: Buffer.from(tx.serialize()).toString('base64'),
    blockhash: response.blockhash,
    lastValidBlockHeight: response.lastValidBlockHeight,
  });

  console.log('Bid confirmed:', result.signature);
}

// Run
placeBid([1, 5, 12], 0.025);
```

---

## Common Patterns

### Bet on Cheapest Tiles

```typescript
async function betOnCheapestTiles(numTiles: number, totalBudget: number) {
  // Get current state
  const state = await client.getState();
  const perSquare = state.data.frames[0]?.liveData?.perSquare?.deployedSol || [];
  
  // Find cheapest tiles (least SOL deployed)
  const tileValues = perSquare.map((sol, i) => ({ tile: i + 1, sol: parseFloat(sol) }));
  tileValues.sort((a, b) => a.sol - b.sol);
  const cheapest = tileValues.slice(0, numTiles).map(t => t.tile);
  
  // Bet
  const amountPerTile = totalBudget / numTiles;
  await client.buildBidTransaction({
    authority: wallet.publicKey.toString(),
    tiles: cheapest,
    amountSol: amountPerTile,
  });
  // ... sign and send
}
```

### Retry with Backoff

```typescript
async function bidWithRetry(tiles: number[], amountSol: number, maxRetries = 3) {
  let lastError;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await client.buildBidTransaction({
        authority: wallet.publicKey.toString(),
        tiles,
        amountSol,
      });
      
      // ... sign and send
      return { success: true };
      
    } catch (error) {
      lastError = error;
      
      if (error instanceof OredataRateLimitError) {
        console.log(`Rate limited, waiting ${error.retryAfter}ms...`);
        await sleep(error.retryAfter);
        continue;
      }
      
      if (error instanceof OredataNetworkError) {
        const backoff = Math.pow(2, attempt) * 1000;
        console.log(`Network error, retrying in ${backoff}ms...`);
        await sleep(backoff);
        continue;
      }
      
      // Non-retryable error
      throw error;
    }
  }
  
  throw lastError;
}
```

### Check Balance Before Betting

```typescript
async function safeBet(tiles: number[], amountSol: number) {
  // Check miner status
  const miner = await client.getMinerStatus(wallet.publicKey.toString());
  
  const totalCost = amountSol * tiles.length;
  const balance = miner.authoritySol;
  
  if (balance < totalCost + 0.01) { // Keep 0.01 for fees
    throw new Error(`Insufficient balance: ${balance} SOL, need ${totalCost} SOL`);
  }
  
  // Proceed with bet
  // ...
}
```

---

## Troubleshooting

### "Transaction simulation failed"

**Cause:** Transaction would fail on-chain.

**Check:**
1. Sufficient SOL balance?
2. Round still active (not expired)?
3. Valid tile numbers (0-24)?

```typescript
// Get current round status
const state = await client.getState();
const phase = state.data.optimized?.phase;
console.log('Current phase:', phase); // Should be 'BETTING'
```

### "Bidding is locked"

**Cause:** You're trying to bid too close to round end.

**Fix:** Wait for next round or upgrade plan.

```typescript
// Listen for new round
store.on('roundStarted', ({ roundId }) => {
  console.log('New round, betting enabled!');
  enableBettingUI();
});
```

### "Buffer is not defined" (Browser)

**Cause:** Missing Node.js Buffer polyfill.

**Fix for Vite:**

```typescript
// vite.config.ts
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  plugins: [
    nodePolyfills({
      include: ['buffer'],
      globals: { Buffer: true },
    }),
  ],
});
```

### "Transaction expired"

**Cause:** Took too long between build and send.

**Fix:** Transactions are valid for ~60 seconds. Speed up your flow:

```typescript
// Build, sign, and send quickly
const response = await client.buildBidTransaction({ ... });
const tx = Transaction.from(Buffer.from(response.transaction, 'base64'));
const signed = await signTransaction(tx);  // User interaction here
await client.relayTransaction({ ... });     // Send immediately after sign
```

### Network Timeout

**Cause:** Slow network or API issues.

**Fix:** Adjust timeout and retry:

```typescript
const client = new OredataClient({
  baseUrls: ['https://api.oredata.supply'],
  timeoutMs: 5000, // 5 seconds (default is 3)
});
```

---

## API Reference

### SDK Methods

| Method | Description |
|--------|-------------|
| `client.buildBidTransaction(opts)` | Build bid transaction |
| `client.buildClaimTransaction(opts)` | Build SOL claim transaction |
| `client.buildClaimSolTransaction(opts)` | Build SOL claim transaction (alias) |
| `client.buildClaimOreTransaction(opts)` | Build ORE token claim transaction |
| `client.relayTransaction(opts)` | Broadcast signed transaction |
| `client.getMinerStatus(authority)` | Get wallet balance/status |
| `client.getState()` | Get current game state |

### Error Classes

| Class | HTTP Code | Meaning |
|-------|-----------|---------|
| `OredataLockoutError` | 423 | Bid lockout period |
| `OredataRateLimitError` | 429 | Rate limit exceeded |
| `OredataQuotaExceededError` | 402 | Monthly quota exhausted |
| `OredataSimulationError` | 400 | Transaction would fail |
| `OredataNetworkError` | - | Network/connection error |
| `OredataHttpError` | various | Other API errors |

---

**Questions?** Check [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) or reach out to the oredata team.

