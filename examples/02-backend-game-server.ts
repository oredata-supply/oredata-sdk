/**
 * Backend Game Server
 * ====================
 * 
 * Complete example of a game backend that:
 * - Polls oredata API once (not per-user)
 * - Broadcasts to all connected clients via Socket.IO
 * - Uses Layer 1 events for reliable winner detection
 * 
 * This is the recommended pattern for production games.
 * 
 * Run: npx tsx examples/02-backend-game-server.ts
 */

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { OredataClient } from '../src/index.js';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' },
});

// ─────────────────────────────────────────────────────────────────────────────
// SDK Setup
// ─────────────────────────────────────────────────────────────────────────────

const client = new OredataClient({
  baseUrls: ['https://ore-api.gmore.fun'],
  apiKey: process.env.OREDATA_API_KEY, // Required for production
  pollIntervalMs: 1000,
});

const store = client.getStore();

// ─────────────────────────────────────────────────────────────────────────────
// Layer 1 Event Handlers (Game Logic)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * When a new round starts, broadcast to all clients.
 * This enables betting UI immediately.
 */
store.on('roundStarted', ({ roundId, isHistorical }) => {
  if (isHistorical) return; // Don't broadcast historical events
  
  console.log(`[Game] Round ${roundId} started`);
  
  io.emit('game:roundStarted', {
    roundId,
    phase: 'BETTING',
    timestamp: Date.now(),
  });
});

/**
 * When winner is determined, broadcast immediately.
 * Clients should show winner animation now - this is 10-15s before next round.
 */
store.on('roundCompleted', ({ roundId, winner, isHistorical }) => {
  if (isHistorical) return;
  
  console.log(`[Game] Round ${roundId} winner: tile ${winner.tile}`);
  
  io.emit('game:winner', {
    roundId,
    tile: winner.tile,
    pot: winner.totalPot,
    motherlode: winner.motherlodeHit,
    timestamp: Date.now(),
  });
});

/**
 * When bid data updates, broadcast pot changes.
 * Clients use this for live pot displays and tile charts.
 */
store.on('roundDataUpdated', ({ roundId, data, changes }) => {
  if (!changes.includes('totals')) return;
  
  io.emit('game:bidsUpdate', {
    roundId,
    pot: data.totals.deployedSol,
    miners: data.totals.uniqueMiners,
    tiles: data.perSquare.deployedSol,
    tileCounts: data.perSquare.counts,
    timestamp: Date.now(),
  });
});

/**
 * When mining status changes, broadcast phase change.
 * EXPIRED = betting closed, show "spinning" state.
 */
store.on('miningStatusChanged', ({ roundId, status }) => {
  if (status === 'EXPIRED') {
    console.log(`[Game] Round ${roundId} betting closed`);
    
    io.emit('game:phaseChange', {
      roundId,
      phase: 'SPINNING',
      timestamp: Date.now(),
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Socket.IO Connection Handler
// ─────────────────────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);
  
  // Send current state to new client
  const currentRound = store.getCurrentRound();
  if (currentRound) {
    socket.emit('game:snapshot', {
      roundId: currentRound.roundId,
      phase: currentRound.mining.status === 'ACTIVE' ? 'BETTING' : 'SPINNING',
      pot: currentRound.totals.deployedSol,
      tiles: currentRound.perSquare.deployedSol,
      winner: currentRound.winner ? {
        tile: currentRound.winner.tile,
        pot: currentRound.winner.totalPot,
      } : null,
      timestamp: Date.now(),
    });
  }
  
  socket.on('disconnect', () => {
    console.log(`[Socket] Client disconnected: ${socket.id}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REST Endpoints
// ─────────────────────────────────────────────────────────────────────────────

app.get('/api/state', (req, res) => {
  const currentRound = store.getCurrentRound();
  const previousRound = store.getPreviousRound();
  
  res.json({
    currentRound: currentRound ? {
      roundId: currentRound.roundId,
      phase: currentRound.mining.status === 'ACTIVE' ? 'BETTING' : 'SPINNING',
      pot: currentRound.totals.deployedSol,
      tiles: currentRound.perSquare.deployedSol,
    } : null,
    previousWinner: previousRound?.winner ? {
      roundId: previousRound.roundId,
      tile: previousRound.winner.tile,
    } : null,
  });
});

app.get('/api/history', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 10;
  const rounds = store.getRecentRounds(limit);
  
  res.json({
    rounds: rounds
      .filter(r => r.winner)
      .map(r => ({
        roundId: r.roundId,
        winner: r.winner!.tile,
        pot: r.winner!.totalPot,
        motherlode: r.winner!.motherlodeHit,
      })),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Start Server
// ─────────────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;

client.getStateClient().start();

httpServer.listen(PORT, () => {
  console.log(`\n🎮 Game server running on http://localhost:${PORT}`);
  console.log('   WebSocket: ws://localhost:' + PORT);
  console.log('   REST API: http://localhost:' + PORT + '/api/state');
  console.log('\nPress Ctrl+C to stop\n');
});

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  client.getStateClient().stop();
  httpServer.close();
  process.exit(0);
});

