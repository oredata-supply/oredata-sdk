'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useOredataClient } from './context.js';
import type {
  OredataState,
  OredataStateConfig,
  DisplayPhase,
  WinnerDisplay,
  PhaseChangePayload,
  WinnerRevealPayload,
  WinnerTimeoutPayload,
} from '../state/oredata-state.js';

/**
 * Options for usePresenter hook
 */
export interface UsePresenterOptions extends OredataStateConfig {
  /** Auto-start on mount (default: true) */
  autoStart?: boolean;
}

/**
 * Return type for usePresenter hook
 */
export interface UsePresenterReturn {
  // Presenter instance
  presenter: OredataState | null;

  // Display state
  displayPhase: DisplayPhase;
  displayedWinner: WinnerDisplay | null;
  isResultOverlayVisible: boolean;

  // Timing info
  timeSinceRoundEnd: number | null;
  timeUntilResultEnds: number | null;

  // Control methods
  skipToResult: () => void;
  dismissResult: () => void;

  // Status
  isReady: boolean;
}

/**
 * usePresenter - Hook for OredataState (Layer 2)
 *
 * Provides UI timing and presentation logic.
 * Use this for:
 * - Game UIs with animations
 * - Apps that need spin/result timing
 * - Any UI that shows winner reveals
 *
 * For immediate data access, use useStore() instead.
 *
 * @example
 * ```tsx
 * function GameBoard() {
 *   const {
 *     displayPhase,
 *     displayedWinner,
 *     isResultOverlayVisible,
 *     dismissResult,
 *   } = usePresenter({
 *     spinDurationMs: 4000,
 *     resultDisplayMs: 15000,
 *     lateWinnerBehavior: 'emit-late',
 *   });
 *
 *   return (
 *     <div>
 *       <Phase>{displayPhase}</Phase>
 *       
 *       {displayPhase === 'SPINNING' && <SpinAnimation />}
 *       
 *       {isResultOverlayVisible && displayedWinner && (
 *         <ResultOverlay
 *           winner={displayedWinner.displayTile}
 *           wasLate={displayedWinner.wasLate}
 *           onDismiss={dismissResult}
 *         />
 *       )}
 *     </div>
 *   );
 * }
 * ```
 */
export function usePresenter(options: UsePresenterOptions = {}): UsePresenterReturn {
  const { client, isInitialized } = useOredataClient();
  const { autoStart = true, ...stateConfig } = options;

  // Stable config reference
  const configRef = useRef(stateConfig);
  configRef.current = stateConfig;

  // Presenter instance - create once per client
  const presenter = useMemo(() => {
    if (!client) return null;
    return client.createState(configRef.current);
  }, [client]);

  // State
  const [displayPhase, setDisplayPhase] = useState<DisplayPhase>('IDLE');
  const [displayedWinner, setDisplayedWinner] = useState<WinnerDisplay | null>(null);
  const [isResultOverlayVisible, setIsResultOverlayVisible] = useState(false);
  const [timeSinceRoundEnd, setTimeSinceRoundEnd] = useState<number | null>(null);
  const [timeUntilResultEnds, setTimeUntilResultEnds] = useState<number | null>(null);

  // Update timing values periodically
  useEffect(() => {
    if (!presenter) return;

    const updateTiming = () => {
      setTimeSinceRoundEnd(presenter.getTimeSinceRoundEnd());
      setTimeUntilResultEnds(presenter.getTimeUntilResultEnds());
    };

    // Update every 100ms for smooth countdown
    const interval = setInterval(updateTiming, 100);
    updateTiming();

    return () => clearInterval(interval);
  }, [presenter]);

  // Subscribe to presenter events
  useEffect(() => {
    if (!presenter) return;

    const onPhaseChange = (payload: PhaseChangePayload) => {
      setDisplayPhase(payload.phase);
    };

    const onWinnerReveal = (payload: WinnerRevealPayload) => {
      setDisplayedWinner({
        roundId: payload.roundId,
        tile: payload.winner,
        displayTile: payload.displayWinner,
        revealedAt: Date.now(),
        wasLate: payload.wasLate,
        arrivalMs: payload.arrivalMs,
      });
    };

    const onResultOverlayShow = () => {
      setIsResultOverlayVisible(true);
    };

    const onResultOverlayHide = () => {
      setIsResultOverlayVisible(false);
      setDisplayedWinner(null);
    };

    const onWinnerTimeout = (payload: WinnerTimeoutPayload) => {
      console.warn(`[usePresenter] Winner timeout for round ${payload.roundId}: ${payload.reason}`);
    };

    // Subscribe
    presenter.on('phaseChange', onPhaseChange);
    presenter.on('winnerReveal', onWinnerReveal);
    presenter.on('resultOverlayShow', onResultOverlayShow);
    presenter.on('resultOverlayHide', onResultOverlayHide);
    presenter.on('winnerTimeout', onWinnerTimeout);

    // Cleanup
    return () => {
      presenter.off('phaseChange', onPhaseChange);
      presenter.off('winnerReveal', onWinnerReveal);
      presenter.off('resultOverlayShow', onResultOverlayShow);
      presenter.off('resultOverlayHide', onResultOverlayHide);
      presenter.off('winnerTimeout', onWinnerTimeout);
      presenter.stop();
    };
  }, [presenter]);

  // Control methods
  const skipToResult = useCallback(() => {
    presenter?.skipToResult();
  }, [presenter]);

  const dismissResult = useCallback(() => {
    presenter?.dismissResult();
  }, [presenter]);

  return {
    presenter,
    displayPhase,
    displayedWinner,
    isResultOverlayVisible,
    timeSinceRoundEnd,
    timeUntilResultEnds,
    skipToResult,
    dismissResult,
    isReady: isInitialized && presenter !== null,
  };
}

