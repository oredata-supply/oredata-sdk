/**
 * React Game Hook
 * ================
 * 
 * This example shows how to use the SDK with React hooks.
 * It demonstrates the correct pattern for React game UIs.
 * 
 * Copy this file to your React project and adapt as needed.
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  OredataClient,
  OredataStore,
  OredataState,
  type RoundData,
  type WinnerData,
  type DisplayPhase,
} from '../src/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface GameState {
  isConnected: boolean;
  roundId: string | null;
  phase: DisplayPhase;
  pot: number;
  tiles: number[];
  winner: WinnerData | null;
  isHistorical: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom Hook
// ─────────────────────────────────────────────────────────────────────────────

/**
 * useOredataGame - Complete game state management hook
 * 
 * This hook:
 * - Manages SDK client lifecycle
 * - Provides game state with proper typing
 * - Handles Layer 1 events for game logic
 * - Handles Layer 2 events for UI timing
 * 
 * @param apiKey - Your oredata API key
 * @returns Game state and control functions
 */
export function useOredataGame(apiKey?: string) {
  const [client] = useState(() => new OredataClient({
    baseUrls: ['https://ore-api.gmore.fun'],
    apiKey,
    pollIntervalMs: 1000,
  }));
  
  const [state, setState] = useState<GameState>({
    isConnected: false,
    roundId: null,
    phase: 'BETTING',
    pot: 0,
    tiles: Array(25).fill(0),
    winner: null,
    isHistorical: false,
  });

  useEffect(() => {
    const store = client.getStore();
    const uiState = client.createState({
      spinDurationMs: 4000,
      resultDisplayMs: 15000,
      lateWinnerBehavior: 'emit-late',
    });

    // ─── Layer 1: Game Logic ─────────────────────────────────────────────────
    
    store.on('roundStarted', ({ roundId, isHistorical }) => {
      setState(prev => ({
        ...prev,
        roundId,
        isHistorical,
        // Only update phase from Layer 1 if not historical
        ...(isHistorical ? {} : { phase: 'BETTING' as const, winner: null }),
      }));
    });

    store.on('roundDataUpdated', ({ data }) => {
      setState(prev => ({
        ...prev,
        pot: data.totals.deployedSol,
        tiles: data.perSquare.deployedSol,
      }));
    });

    store.on('roundCompleted', ({ winner, isHistorical }) => {
      // Store winner data immediately, but let Layer 2 control reveal timing
      if (!isHistorical) {
        // Winner is available - Layer 2 will handle the reveal
      }
    });

    // ─── Layer 2: UI Timing ──────────────────────────────────────────────────
    
    uiState.on('phaseChange', ({ phase }) => {
      setState(prev => ({ ...prev, phase }));
    });

    uiState.on('winnerReveal', ({ winner }) => {
      const currentRound = store.getCurrentRound();
      if (currentRound?.winner) {
        setState(prev => ({ ...prev, winner: currentRound.winner }));
      }
    });

    // ─── Start ───────────────────────────────────────────────────────────────
    
    const stateClient = client.getStateClient();
    
    stateClient.on('connected', () => {
      setState(prev => ({ ...prev, isConnected: true }));
    });
    
    stateClient.on('disconnected', () => {
      setState(prev => ({ ...prev, isConnected: false }));
    });

    stateClient.start();

    return () => {
      uiState.stop();
      stateClient.stop();
    };
  }, [client]);

  return {
    ...state,
    client,
    store: client.getStore(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Example Component
// ─────────────────────────────────────────────────────────────────────────────

export function GameBoard() {
  const { isConnected, roundId, phase, pot, tiles, winner } = useOredataGame(
    process.env.REACT_APP_OREDATA_API_KEY
  );

  if (!isConnected) {
    return <div className="connecting">Connecting to game...</div>;
  }

  return (
    <div className="game-board">
      <header>
        <h1>Round {roundId}</h1>
        <span className={`phase phase-${phase.toLowerCase()}`}>{phase}</span>
      </header>

      <div className="pot">
        <span>Total Pot</span>
        <strong>{pot.toFixed(4)} SOL</strong>
      </div>

      <div className="tiles">
        {tiles.map((sol, index) => (
          <div
            key={index}
            className={`tile ${winner?.tile === index ? 'winner' : ''}`}
          >
            <span className="tile-number">{index}</span>
            <span className="tile-sol">{sol.toFixed(4)}</span>
          </div>
        ))}
      </div>

      {winner && phase === 'RESULT' && (
        <div className="winner-overlay">
          <h2>🎉 Winner!</h2>
          <p>Tile {winner.tile}</p>
          <p>Pot: {winner.totalPot}</p>
          {winner.motherlodeHit && <p>💎 Motherlode!</p>}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Usage in App
// ─────────────────────────────────────────────────────────────────────────────

/*
import { GameBoard } from './04-react-game-hook';

function App() {
  return (
    <div className="app">
      <GameBoard />
    </div>
  );
}
*/

