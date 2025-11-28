'use client';

import { useEffect, useRef } from 'react';
import { useStateClient } from './context.js';
import type { OredataEventHandlers } from './types.js';
import type { StateStoreSnapshot } from '../state/types.js';
import type {
  AppMode,
  TransportStatus,
  WinnerEventPayload,
  RoundFinalizedPayload,
  MotherlodeEventPayload,
} from '../state/state-client.js';
import type { PhaseMetadata, HealthSnapshot } from '../types.js';

/**
 * useOredataEvents - Hook for subscribing to specific events
 *
 * Use this hook when you need to react to specific events without
 * re-rendering on every state change.
 *
 * @example
 * ```tsx
 * function WinnerCelebration() {
 *   useOredataEvents({
 *     onWinner: (event) => {
 *       if (event.type === 'optimistic') {
 *         playWinnerAnimation(event.winningSquareIndex);
 *       }
 *     },
 *     onPhaseChange: (event) => {
 *       if (event?.phase === 'betting') {
 *         resetUI();
 *       }
 *     },
 *     onMotherlode: (event) => {
 *       triggerMotherlodeCelebration(event.amountFormatted);
 *     },
 *   });
 *
 *   return <AnimationContainer />;
 * }
 * ```
 *
 * @example Error handling
 * ```tsx
 * function ErrorMonitor() {
 *   useOredataEvents({
 *     onError: (error) => {
 *       logToSentry(error);
 *       showToast('Connection issue detected');
 *     },
 *     onHealth: (health) => {
 *       if (health.api.status !== 'healthy') {
 *         showMaintenanceBanner();
 *       }
 *     },
 *   });
 *
 *   return null;
 * }
 * ```
 */
export function useOredataEvents(handlers: OredataEventHandlers): void {
  const { stateClient } = useStateClient();
  
  // Use refs to avoid re-subscribing on handler changes
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!stateClient) return;

    // Wrapper functions that read from ref
    const onSnapshot = (snapshot: StateStoreSnapshot) => {
      handlersRef.current.onSnapshot?.(snapshot);
    };

    const onPhaseChange = (phase: PhaseMetadata | null) => {
      handlersRef.current.onPhaseChange?.(phase);
    };

    const onWinner = (event: WinnerEventPayload) => {
      handlersRef.current.onWinner?.(event);
    };

    const onRoundFinalized = (event: RoundFinalizedPayload) => {
      handlersRef.current.onRoundFinalized?.(event);
    };

    const onMotherlode = (event: MotherlodeEventPayload) => {
      handlersRef.current.onMotherlode?.(event);
    };

    const onTransport = (status: TransportStatus) => {
      handlersRef.current.onTransport?.(status);
    };

    const onError = (error: Error) => {
      handlersRef.current.onError?.(error);
    };

    const onHealth = (snapshot: HealthSnapshot) => {
      handlersRef.current.onHealth?.(snapshot);
    };

    const onModeChange = (mode: AppMode) => {
      handlersRef.current.onModeChange?.(mode);
    };

    // Subscribe to events (only if handler provided)
    if (handlers.onSnapshot) {
      stateClient.on('snapshot', onSnapshot);
    }
    if (handlers.onPhaseChange) {
      stateClient.on('phaseChange', onPhaseChange);
    }
    if (handlers.onWinner) {
      stateClient.on('winner', onWinner);
    }
    if (handlers.onRoundFinalized) {
      stateClient.on('roundFinalized', onRoundFinalized);
    }
    if (handlers.onMotherlode) {
      stateClient.on('motherlode', onMotherlode);
    }
    if (handlers.onTransport) {
      stateClient.on('transport', onTransport);
    }
    if (handlers.onError) {
      stateClient.on('error', onError);
    }
    if (handlers.onHealth) {
      stateClient.on('health', onHealth);
    }
    if (handlers.onModeChange) {
      stateClient.on('modeChange', onModeChange);
    }

    // Cleanup
    return () => {
      stateClient.off('snapshot', onSnapshot);
      stateClient.off('phaseChange', onPhaseChange);
      stateClient.off('winner', onWinner);
      stateClient.off('roundFinalized', onRoundFinalized);
      stateClient.off('motherlode', onMotherlode);
      stateClient.off('transport', onTransport);
      stateClient.off('error', onError);
      stateClient.off('health', onHealth);
      stateClient.off('modeChange', onModeChange);
    };
  }, [stateClient, 
      // Only re-subscribe if handler presence changes
      !!handlers.onSnapshot,
      !!handlers.onPhaseChange,
      !!handlers.onWinner,
      !!handlers.onRoundFinalized,
      !!handlers.onMotherlode,
      !!handlers.onTransport,
      !!handlers.onError,
      !!handlers.onHealth,
      !!handlers.onModeChange,
  ]);
}

