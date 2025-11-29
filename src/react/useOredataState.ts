'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useStateClient } from './context.js';
import type {
  UseOredataStateOptions,
  UseOredataStateReturn,
  PotTotals,
} from './types.js';
import type { StateStoreSnapshot, RoundFrame, RoundFrameGlobals } from '../state/types.js';
import type {
  AppMode,
  TransportStatus,
  WinnerEventPayload,
  StateClientEvents,
} from '../state/state-client.js';
import type { PhaseMetadata, HealthSnapshot, QuotaSnapshot, BillingSnapshot, ConnectionState } from '../types.js';

/**
 * Extract pot totals from current frame
 */
function extractPot(frame: RoundFrame | null): PotTotals | null {
  if (!frame?.liveData?.totals) return null;
  
  const deployedSol = frame.liveData.totals.deployedSol;
  const lamports = deployedSol ? BigInt(Math.floor(parseFloat(deployedSol) * 1e9)).toString() : '0';
  
  return {
    totalSol: parseFloat(deployedSol ?? '0'),
    totalLamports: lamports,
  };
}

/**
 * useOredataState - Main hook for game state
 *
 * Provides reactive access to game state, phase, winner info, and more.
 * Automatically updates when state changes.
 *
 * @example
 * ```tsx
 * function Game() {
 *   const {
 *     isConnected,
 *     phase,
 *     roundId,
 *     pot,
 *     winner,
 *     setMode,
 *   } = useOredataState();
 *
 *   if (!isConnected) return <Connecting />;
 *
 *   return (
 *     <div>
 *       <PhaseIndicator phase={phase} />
 *       <PotDisplay pot={pot} />
 *       {winner && <WinnerAnimation tile={winner.winningSquareIndex} />}
 *     </div>
 *   );
 * }
 * ```
 *
 * @example Fine-grained re-renders
 * ```tsx
 * // Only re-render when phase changes
 * const { phase } = useOredataState({ select: ['phase'] });
 * ```
 */
export function useOredataState(options: UseOredataStateOptions = {}): UseOredataStateReturn {
  const { stateClient, isInitialized, error: initError } = useStateClient();
  const { select } = options;

  // Core state
  const [snapshot, setSnapshot] = useState<StateStoreSnapshot | null>(null);
  const [winner, setWinner] = useState<WinnerEventPayload | null>(null);
  const [transport, setTransport] = useState<TransportStatus | null>(null);
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState | null>(null);
  const [quota, setQuota] = useState<QuotaSnapshot | null>(null);
  const [billing, setBilling] = useState<BillingSnapshot | null>(null);
  const [mode, setModeState] = useState<AppMode>('active');
  const [error, setError] = useState<Error | null>(initError);
  const [isLoading, setIsLoading] = useState(true);

  // Track which selectors are used for optimization
  const selectSet = useMemo(() => new Set(select ?? []), [select?.join(',')]);
  const shouldUpdate = useCallback(
    (field: string) => selectSet.size === 0 || selectSet.has(field as any),
    [selectSet]
  );

  // Subscribe to state client events
  useEffect(() => {
    if (!stateClient) {
      setIsLoading(!isInitialized);
      return;
    }

    // Get initial state
    const initialSnapshot = stateClient.getSnapshot();
    if (initialSnapshot) {
      setSnapshot(initialSnapshot);
      setIsLoading(false);
    }

    const initialTransport = stateClient.getTransportStatus();
    setTransport(initialTransport);

    const initialHealth = stateClient.getHealthSnapshot();
    if (initialHealth) setHealth(initialHealth);

    const initialConnection = stateClient.getConnectionState();
    setConnectionState(initialConnection);

    const initialQuota = stateClient.getQuotaSnapshot();
    if (initialQuota) setQuota(initialQuota);

    const initialBilling = stateClient.getBillingSnapshot();
    if (initialBilling) setBilling(initialBilling);

    setModeState(stateClient.getMode());

    // Event handlers
    const onSnapshot = (snap: StateStoreSnapshot) => {
      if (shouldUpdate('snapshot') || shouldUpdate('phase') || shouldUpdate('roundId') || 
          shouldUpdate('pot') || shouldUpdate('frames') || shouldUpdate('globals')) {
        setSnapshot(snap);
        setIsLoading(false);
      }
    };

    const onWinner = (event: WinnerEventPayload) => {
      if (shouldUpdate('winner')) {
        setWinner(event);
      }
    };

    const onTransport = (status: TransportStatus) => {
      if (shouldUpdate('transport') || shouldUpdate('isConnected')) {
        setTransport(status);
      }
    };

    const onHealth = (snap: HealthSnapshot) => {
      setHealth(snap);
    };

    const onConnectionChange = (state: ConnectionState) => {
      if (shouldUpdate('isConnected')) {
        setConnectionState(state);
      }
    };

    const onQuota = (snap: QuotaSnapshot) => {
      setQuota(snap);
    };

    const onBilling = (snap: BillingSnapshot) => {
      setBilling(snap);
    };

    const onModeChange = (newMode: AppMode) => {
      setModeState(newMode);
    };

    const onError = (err: Error) => {
      setError(err);
    };

    // Subscribe to events
    stateClient.on('snapshot', onSnapshot);
    stateClient.on('winner', onWinner);
    stateClient.on('transport', onTransport);
    stateClient.on('health', onHealth);
    stateClient.on('connectionChange', onConnectionChange);
    stateClient.on('quota', onQuota);
    stateClient.on('billing', onBilling);
    stateClient.on('modeChange', onModeChange);
    stateClient.on('error', onError);

    // Cleanup
    return () => {
      stateClient.off('snapshot', onSnapshot);
      stateClient.off('winner', onWinner);
      stateClient.off('transport', onTransport);
      stateClient.off('health', onHealth);
      stateClient.off('connectionChange', onConnectionChange);
      stateClient.off('quota', onQuota);
      stateClient.off('billing', onBilling);
      stateClient.off('modeChange', onModeChange);
      stateClient.off('error', onError);
    };
  }, [stateClient, isInitialized, shouldUpdate]);

  // Update error from init
  useEffect(() => {
    if (initError) {
      setError(initError);
    }
  }, [initError]);

  // Derived state
  const currentFrame = useMemo(() => {
    if (!snapshot?.currentRoundId) return null;
    return snapshot.frames.get(snapshot.currentRoundId) ?? null;
  }, [snapshot?.currentRoundId, snapshot?.frames]);

  const frames = useMemo(() => {
    if (!snapshot) return [];
    return Array.from(snapshot.frames.values());
  }, [snapshot?.frames]);

  const pot = useMemo(() => extractPot(currentFrame), [currentFrame]);

  const isConnected = useMemo(() => {
    return connectionState?.status === 'connected';
  }, [connectionState?.status]);

  const isWinnerRevealed = useMemo(() => {
    return winner !== null && winner.type === 'final';
  }, [winner]);

  const isDataStale = useMemo(() => {
    return snapshot?.isStale ?? true;
  }, [snapshot?.isStale]);

  const dataAge = useMemo(() => {
    return snapshot?.dataAgeMs ?? null;
  }, [snapshot?.dataAgeMs]);

  // Actions
  const setMode = useCallback((newMode: AppMode) => {
    if (stateClient) {
      stateClient.setMode(newMode);
    }
  }, [stateClient]);

  const refresh = useCallback(async () => {
    if (!stateClient) return;
    // Force a refresh by getting fresh state
    // The StateClient doesn't have a direct refresh method,
    // so we toggle mode to trigger an immediate poll
    const currentMode = stateClient.getMode();
    if (currentMode === 'idle') {
      stateClient.setMode('active');
    }
  }, [stateClient]);

  return {
    // Connection status
    isConnected,
    isLoading,
    error,

    // Current state
    phase: snapshot?.phase ?? null,
    roundId: snapshot?.currentRoundId ?? null,
    pot,

    // Winner info
    winner,
    isWinnerRevealed,

    // Round data
    frames,
    currentFrame,

    // Globals
    globals: snapshot?.globals ?? null,

    // Full snapshot
    snapshot,

    // Transport info
    transport,

    // Health & Connection
    health,
    connectionState,

    // Quota & Billing
    quota,
    billing,

    // Data freshness
    isDataStale,
    dataAge,

    // Current mode
    mode,

    // Actions
    setMode,
    refresh,
  };
}

