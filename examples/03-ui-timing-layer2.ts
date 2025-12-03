/**
 * UI Timing with Layer 2 (OredataState)
 * ======================================
 * 
 * This example shows how to use Layer 2 for UI animations.
 * Layer 2 adds configurable timing delays for spin animations
 * and result display periods.
 * 
 * ⚠️ IMPORTANT: Use Layer 1 for game LOGIC, Layer 2 for ANIMATIONS only.
 * 
 * Run: npx tsx examples/03-ui-timing-layer2.ts
 */

import { OredataClient, type OredataState, type DisplayPhase } from '../src/index.js';

const client = new OredataClient({
  baseUrls: ['https://ore-api.gmore.fun'],
  apiKey: process.env.OREDATA_API_KEY,
  pollIntervalMs: 1000,
});

const store = client.getStore();

// ─────────────────────────────────────────────────────────────────────────────
// Layer 2: OredataState for UI Timing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create Layer 2 state with custom timing
 * 
 * @param spinDurationMs - Minimum time to show spin animation
 * @param resultDisplayMs - How long to show result overlay
 * @param maxWaitMs - Max wait for winner before timeout
 * @param lateWinnerBehavior - How to handle late winners
 */
const state = client.createState({
  spinDurationMs: 4000,           // 4 second spin animation
  resultDisplayMs: 15000,         // 15 seconds to show winner
  maxWaitMs: 25000,               // 25 second timeout
  lateWinnerBehavior: 'emit-late', // Still emit late winners
});

// ─────────────────────────────────────────────────────────────────────────────
// Layer 1: Use for game logic (enabling/disabling betting)
// ─────────────────────────────────────────────────────────────────────────────

store.on('roundStarted', ({ roundId, isHistorical }) => {
  if (isHistorical) return;
  
  // Game logic: Enable betting immediately
  console.log(`\n[Layer 1] Round ${roundId} - BETTING ENABLED`);
  // enableBettingUI();
});

store.on('miningStatusChanged', ({ roundId, status }) => {
  if (status === 'EXPIRED') {
    // Game logic: Disable betting immediately
    console.log(`[Layer 1] Round ${roundId} - BETTING DISABLED`);
    // disableBettingUI();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Layer 2: Use for UI animations (spin, reveal, overlays)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * phaseChange - fires for UI phase transitions
 * 
 * These are DELAYED based on your timing config.
 * Use for UI transitions, NOT for game logic.
 * 
 * Phases: BETTING → SPINNING → RESULT → BETTING
 */
state.on('phaseChange', ({ phase, roundId }) => {
  console.log(`[Layer 2] Phase: ${phase} (round ${roundId})`);
  
  switch (phase) {
    case 'BETTING':
      // updatePhaseIndicator('Place your bets!');
      break;
    case 'SPINNING':
      // startSpinAnimation();
      break;
    case 'RESULT':
      // showResultOverlay();
      break;
  }
});

/**
 * winnerReveal - fires when it's time to show winner
 * 
 * This is called AFTER spinDurationMs delay.
 * Use to stop the wheel on the winning tile.
 * 
 * @param roundId - The round ID
 * @param winner - The winning tile (0-24)
 * @param wasLate - true if winner arrived after maxWaitMs
 * @param arrivalMs - ms since round ended when winner arrived
 */
state.on('winnerReveal', ({ roundId, winner, wasLate, arrivalMs }) => {
  console.log(`[Layer 2] 🎉 REVEAL: Tile ${winner} wins!`);
  
  if (wasLate) {
    console.log('   ⚡ Quick reveal (winner was late)');
    // skipToWinner(winner);
  } else {
    console.log(`   🎰 Stop wheel on tile ${winner}`);
    // stopWheelOnTile(winner);
  }
});

/**
 * resultOverlayShow - fires when result overlay should appear
 */
state.on('resultOverlayShow', ({ roundId, winner }) => {
  console.log(`[Layer 2] Show result overlay for round ${roundId}`);
  // showResultOverlay(winner);
});

/**
 * resultOverlayHide - fires when result overlay should hide
 * (after resultDisplayMs)
 */
state.on('resultOverlayHide', ({ roundId }) => {
  console.log(`[Layer 2] Hide result overlay for round ${roundId}`);
  // hideResultOverlay();
});

/**
 * winnerTimeout - fires if winner doesn't arrive within maxWaitMs
 */
state.on('winnerTimeout', ({ roundId, reason }) => {
  console.log(`[Layer 2] ⚠️ Winner timeout for round ${roundId}: ${reason}`);
  // showTimeoutMessage();
});

// ─────────────────────────────────────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────────────────────────────────────

console.log('Starting with Layer 1 + Layer 2...');
console.log('- Layer 1: Game logic (betting enabled/disabled)');
console.log('- Layer 2: UI timing (spin animation, reveals)');
console.log('\nPress Ctrl+C to stop\n');

client.getStateClient().start();

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  state.stop();
  client.getStateClient().stop();
  process.exit(0);
});

