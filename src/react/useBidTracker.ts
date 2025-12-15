'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useStore } from './useStore.js';
import { BidTracker } from '../bid-tracker.js';
import type { TrackedBid, WinCheckResult } from '../bid-tracker.js';
import type { UseBidTrackerOptions, UseBidTrackerReturn } from './types.js';

/**
 * useBidTracker - Hook for tracking user's bids
 *
 * Tracks bids placed by the user, persists to localStorage,
 * and provides helpers to check win status.
 *
 * @example
 * ```tsx
 * function BetHistory() {
 *   const { currentRound } = useStore();
 *   const {
 *     currentBids,
 *     totalBet,
 *     trackBid,
 *     didIWin,
 *   } = useBidTracker();
 *
 *   // Track a bid after successful transaction
 *   const handleBidSuccess = (tiles: number[], amount: number, txSig: string) => {
 *     trackBid({
 *       roundId: currentRound!.roundId,
 *       tiles,
 *       amountLamports: (amount * 1e9).toString(),
 *       amountSol: amount,
 *       placedAt: Date.now(),
 *       txSignature: txSig,
 *     });
 *   };
 *
 *   return (
 *     <div>
 *       <CurrentBets bids={currentBids} total={totalBet.sol} />
 *     </div>
 *   );
 * }
 * ```
 */
export function useBidTracker(options: UseBidTrackerOptions = {}): UseBidTrackerReturn {
  const { currentRound } = useStore();
  const roundId = currentRound?.roundId ?? null;
  
  // Create BidTracker instance (singleton per options)
  const trackerRef = useRef<BidTracker | null>(null);
  
  // Initialize tracker
  if (!trackerRef.current) {
    trackerRef.current = new BidTracker(options);
  }
  const tracker = trackerRef.current;

  // State for reactivity
  const [version, setVersion] = useState(0);
  const forceUpdate = useCallback(() => setVersion((v) => v + 1), []);

  // Get current round bids
  const currentBids = useMemo(() => {
    if (!roundId) return [];
    return tracker.getBidsForRound(roundId);
  }, [roundId, version]);

  // Get total bet for current round
  const totalBet = useMemo(() => {
    if (!roundId) return { lamports: 0n, sol: 0 };
    return tracker.getTotalBidForRound(roundId);
  }, [roundId, version]);

  // Get tiles selected in current round
  const tilesSelected = useMemo(() => {
    const tiles = new Set<number>();
    for (const bid of currentBids) {
      for (const tile of bid.tiles) {
        tiles.add(tile);
      }
    }
    return Array.from(tiles).sort((a, b) => a - b);
  }, [currentBids]);

  // Get all recent bids as a Map
  const recentBids = useMemo(() => {
    const rounds = tracker.getTrackedRounds();
    const map = new Map<string, TrackedBid[]>();
    for (const rid of rounds) {
      map.set(rid, tracker.getBidsForRound(rid));
    }
    return map;
  }, [version]);

  // Get tracked rounds
  const trackedRounds = useMemo(() => {
    return tracker.getTrackedRounds();
  }, [version]);

  // Get stats
  const stats = useMemo(() => {
    return tracker.getStats();
  }, [version]);

  // Actions
  const trackBid = useCallback((bid: TrackedBid) => {
    tracker.trackBid(bid);
    forceUpdate();
  }, [tracker, forceUpdate]);

  const clearRound = useCallback((rid: string) => {
    tracker.clearRound(rid);
    forceUpdate();
  }, [tracker, forceUpdate]);

  const clearAll = useCallback(() => {
    tracker.clearAll();
    forceUpdate();
  }, [tracker, forceUpdate]);

  const didIWin = useCallback((rid: string, winningTile: number | null): WinCheckResult => {
    return tracker.didIWin(rid, winningTile);
  }, [tracker]);

  return {
    // Current round
    currentBids,
    totalBet,
    tilesSelected,

    // History
    recentBids,
    trackedRounds,

    // Win checking
    didIWin,

    // Actions
    trackBid,
    clearRound,
    clearAll,

    // Stats
    stats,
  };
}
