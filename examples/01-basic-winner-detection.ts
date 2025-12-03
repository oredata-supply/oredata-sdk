/**
 * Basic Winner Detection
 * ======================
 * 
 * This example shows the CORRECT pattern for detecting winners.
 * Winners are announced immediately when determined - typically
 * 10-15 seconds BEFORE the next round starts.
 * 
 * Run: npx tsx examples/01-basic-winner-detection.ts
 */

import { OredataClient } from '../src/index.js';

// Create client with your API key
const client = new OredataClient({
  baseUrls: ['https://ore-api.gmore.fun'],
  apiKey: process.env.OREDATA_API_KEY, // Optional but recommended
  pollIntervalMs: 1000,
});

// Get Layer 1 store - this is where data events happen
const store = client.getStore();

/**
 * roundStarted - fires when a new round begins
 * 
 * @param roundId - The new round ID (string, e.g., "74185")
 * @param previousRoundId - The previous round ID (null on first connection)
 * @param isHistorical - true if this round existed before we connected
 */
store.on('roundStarted', ({ roundId, previousRoundId, isHistorical }) => {
  // IMPORTANT: Skip historical events to avoid processing old rounds
  if (isHistorical) {
    console.log(`[Skip] Round ${roundId} was already in progress when we connected`);
    return;
  }
  
  console.log(`\n🎲 Round ${roundId} started!`);
  console.log('   Betting is now open');
  if (previousRoundId) {
    console.log(`   Previous round was ${previousRoundId}`);
  }
});

/**
 * roundCompleted - fires when winner is determined
 * 
 * This is the KEY event for winner detection!
 * It fires IMMEDIATELY when winner data arrives from the blockchain.
 * 
 * @param roundId - The round ID that completed
 * @param winner - Winner details (tile, pot, motherlode info)
 * @param wasLate - true if winner arrived after maxWaitMs
 * @param arrivalMs - milliseconds after round ended when winner arrived
 * @param isHistorical - true if this round completed before we connected
 */
store.on('roundCompleted', ({ roundId, winner, wasLate, arrivalMs, isHistorical }) => {
  // IMPORTANT: Skip historical events
  if (isHistorical) {
    console.log(`[Skip] Round ${roundId} winner already known: tile ${winner.tile}`);
    return;
  }
  
  console.log(`\n🎉 Round ${roundId} WINNER: Tile ${winner.tile}!`);
  console.log(`   Total pot: ${winner.totalPot}`);
  console.log(`   Motherlode hit: ${winner.motherlodeHit ? 'YES! 💎' : 'No'}`);
  console.log(`   Winner arrived ${arrivalMs}ms after round ended`);
  if (wasLate) {
    console.log('   ⚠️ Winner was late (arrived after timeout)');
  }
});

/**
 * roundDataUpdated - fires when bid data changes
 * 
 * Use this to update pot displays, tile charts, etc.
 * 
 * @param roundId - The round ID being updated
 * @param data - Full round data including perSquare and totals
 * @param changes - Array of what changed: 'mining', 'totals', 'winner'
 */
store.on('roundDataUpdated', ({ roundId, data, changes }) => {
  if (changes.includes('totals')) {
    console.log(`💰 Round ${roundId} pot: ${data.totals.deployedSol.toFixed(4)} SOL`);
    console.log(`   Unique miners: ${data.totals.uniqueMiners}`);
  }
});

/**
 * miningStatusChanged - fires when round mining status changes
 * 
 * ACTIVE → EXPIRED means betting just closed.
 * Use this to show "spinning" state.
 * 
 * @param roundId - The round ID
 * @param status - New status: 'ACTIVE' | 'EXPIRED' | 'UNKNOWN'
 * @param previousStatus - Previous status
 */
store.on('miningStatusChanged', ({ roundId, status, previousStatus }) => {
  if (status === 'EXPIRED' && previousStatus === 'ACTIVE') {
    console.log(`\n⏳ Round ${roundId} betting closed - determining winner...`);
  }
});

// Start polling
console.log('Starting winner detection...');
console.log('Press Ctrl+C to stop\n');

client.getStateClient().start();

// Handle shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  client.getStateClient().stop();
  process.exit(0);
});

