/**
 * Anti-Patterns (What NOT to Do)
 * ================================
 * 
 * This file shows common mistakes and their correct alternatives.
 * Each anti-pattern has a clear explanation of why it's wrong.
 * 
 * DO NOT copy this code - it's intentionally wrong!
 */

import { OredataClient } from '../src/index.js';

const client = new OredataClient({
  baseUrls: ['https://api.oredata.supply'],
});

const store = client.getStore();
const state = client.createState();

// ═══════════════════════════════════════════════════════════════════════════
// ANTI-PATTERN 1: Ignoring isHistorical
// ═══════════════════════════════════════════════════════════════════════════

// ❌ WRONG: Will replay old events on page load
function wrongHandleWinner_NoHistoricalCheck() {
  store.on('roundCompleted', ({ winner }) => {
    // This plays for OLD rounds on page load!
    playWinnerAnimation(winner.tile);
    incrementWinCount();
  });
}

// ✅ CORRECT: Always check isHistorical
function correctHandleWinner_WithHistoricalCheck() {
  store.on('roundCompleted', ({ winner, isHistorical }) => {
    if (isHistorical) return; // Skip old events
    
    playWinnerAnimation(winner.tile);
    incrementWinCount();
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// ANTI-PATTERN 2: Using Layer 2 for Game Logic
// ═══════════════════════════════════════════════════════════════════════════

// ❌ WRONG: Layer 2 has timing delays
function wrongEnableBetting_UsingLayer2() {
  state.on('phaseChange', ({ phase }) => {
    if (phase === 'BETTING') {
      enableBettingUI(); // May be delayed by spinDurationMs!
    }
  });
}

// ✅ CORRECT: Use Layer 1 for game logic
function correctEnableBetting_UsingLayer1() {
  store.on('roundStarted', ({ isHistorical }) => {
    if (isHistorical) return;
    enableBettingUI(); // Fires immediately!
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// ANTI-PATTERN 3: Building "Estimated Winner" Fallback
// ═══════════════════════════════════════════════════════════════════════════

// ❌ WRONG: Guessing winner from highest SOL tile
function wrongEstimateWinner() {
  store.on('roundDataUpdated', ({ data }) => {
    // Find tile with most SOL
    const tiles = data.perSquare.deployedSol;
    const maxSol = Math.max(...tiles);
    const estimatedWinner = tiles.indexOf(maxSol);
    
    // DON'T DO THIS - ORE uses RNG, not "most bets wins"!
    showEstimatedWinner(estimatedWinner);
  });
}

// ✅ CORRECT: Wait for actual winner
function correctWaitForRealWinner() {
  store.on('roundCompleted', ({ winner, isHistorical }) => {
    if (isHistorical) return;
    showRealWinner(winner.tile); // This is the actual blockchain result
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// ANTI-PATTERN 4: Comparing roundId with Number
// ═══════════════════════════════════════════════════════════════════════════

// ❌ WRONG: roundId is always a string
function wrongRoundIdComparison() {
  store.on('roundStarted', ({ roundId }) => {
    // This ALWAYS fails - string !== number
    if (roundId === 74185) {
      console.log('Special round!');
    }
  });
}

// ✅ CORRECT: Compare as strings or parse
function correctRoundIdComparison() {
  store.on('roundStarted', ({ roundId }) => {
    // Option 1: String comparison
    if (roundId === '74185') {
      console.log('Special round!');
    }
    
    // Option 2: Parse when needed
    if (parseInt(roundId) > 74000) {
      console.log('High round number!');
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// ANTI-PATTERN 5: Not Starting the Client
// ═══════════════════════════════════════════════════════════════════════════

// ❌ WRONG: Events won't fire if client isn't started
function wrongSetupWithoutStart() {
  store.on('roundStarted', ({ roundId }) => {
    console.log(`Round ${roundId} started`);
    // This never fires because we didn't start!
  });
  
  // Missing: client.getStateClient().start();
}

// ✅ CORRECT: Start the client
function correctSetupWithStart() {
  store.on('roundStarted', ({ roundId, isHistorical }) => {
    if (isHistorical) return;
    console.log(`Round ${roundId} started`);
  });
  
  client.getStateClient().start(); // Don't forget this!
}

// ═══════════════════════════════════════════════════════════════════════════
// Helper stubs (not real implementations)
// ═══════════════════════════════════════════════════════════════════════════

function playWinnerAnimation(tile: number) {}
function incrementWinCount() {}
function enableBettingUI() {}
function showEstimatedWinner(tile: number) {}
function showRealWinner(tile: number) {}

