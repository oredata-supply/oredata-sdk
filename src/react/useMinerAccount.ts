'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useOredataClient } from './context.js';
import { MinerClient } from '../miner-client.js';
import type { MinerStatus } from '../miner-client.js';
import type { UseMinerAccountOptions, UseMinerAccountReturn } from './types.js';

/**
 * useMinerAccount - Hook for wallet state
 *
 * Provides reactive access to miner account status including balances,
 * claimable rewards, and checkpoint status.
 *
 * @param authority - Wallet public key (base58 string)
 * @param options - Optional configuration
 *
 * @example
 * ```tsx
 * function WalletPanel() {
 *   const { publicKey } = useWallet(); // From wallet adapter
 *
 *   const {
 *     solBalance,
 *     claimableSol,
 *     needsCheckpoint,
 *     isLoading,
 *     refresh,
 *   } = useMinerAccount(publicKey?.toBase58());
 *
 *   if (!publicKey) return <ConnectWallet />;
 *   if (isLoading) return <Loading />;
 *
 *   return (
 *     <div>
 *       <Balance label="SOL" value={solBalance} />
 *       {claimableSol > 0 && (
 *         <ClaimButton amount={claimableSol} />
 *       )}
 *     </div>
 *   );
 * }
 * ```
 */
export function useMinerAccount(
  authority: string | null | undefined,
  options: UseMinerAccountOptions = {}
): UseMinerAccountReturn {
  const { client, isInitialized } = useOredataClient();
  const { pollInterval = 5000, autoStart = true } = options;

  // State
  const [status, setStatus] = useState<MinerStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isPolling, setIsPolling] = useState(false);

  // Refs
  const minerClientRef = useRef<MinerClient | null>(null);

  // Create/update miner client when authority changes
  useEffect(() => {
    // Clean up previous client
    if (minerClientRef.current) {
      minerClientRef.current.stop();
      minerClientRef.current.removeAllListeners();
      minerClientRef.current = null;
    }

    // Skip if no authority or client
    if (!authority || !client || !isInitialized) {
      setStatus(null);
      setIsLoading(false);
      setIsPolling(false);
      return;
    }

    // Get API config from main client
    // We need to extract baseUrl and apiKey from the OredataClient
    // Since OredataClient doesn't expose these directly, we'll use a workaround
    const apiBaseUrl = 'https://ore-api.gmore.fun'; // Default, could be made configurable

    const minerClient = new MinerClient({
      apiBaseUrl,
      apiKey: undefined, // Would need to be passed through config
      authority,
      pollInterval,
      autoStart: false, // We'll control this
    });

    minerClientRef.current = minerClient;

    // Set up event handlers
    minerClient.on('update', (newStatus) => {
      setStatus(newStatus);
      setIsLoading(false);
      setError(null);
    });

    minerClient.on('error', (err) => {
      setError(err);
      setIsLoading(false);
    });

    // Auto-start if configured
    if (autoStart) {
      setIsLoading(true);
      minerClient.start();
      setIsPolling(true);
    }

    // Cleanup
    return () => {
      minerClient.stop();
      minerClient.removeAllListeners();
    };
  }, [authority, client, isInitialized, pollInterval, autoStart]);

  // Actions
  const refresh = useCallback(async () => {
    if (!minerClientRef.current) return;
    setIsLoading(true);
    try {
      const newStatus = await minerClientRef.current.fetch();
      setStatus(newStatus);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const startPolling = useCallback(() => {
    if (minerClientRef.current && !isPolling) {
      minerClientRef.current.start();
      setIsPolling(true);
    }
  }, [isPolling]);

  const stopPolling = useCallback(() => {
    if (minerClientRef.current && isPolling) {
      minerClientRef.current.stop();
      setIsPolling(false);
    }
  }, [isPolling]);

  // Derived values
  const solBalance = status?.authoritySol ?? null;
  const oreBalance = null; // ORE balance would need separate token account lookup
  const usdcBalance = status?.authorityUsdc ?? null;
  const claimableSol = status?.claimableSol ?? null;
  const claimableOre = null; // ORE rewards separate
  const pendingSol = status?.pendingClaimSol ?? null;
  const needsCheckpoint = status?.needsCheckpoint ?? false;
  const exists = status?.exists ?? false;

  return {
    // Balances
    solBalance,
    oreBalance,
    usdcBalance,
    claimableSol,
    claimableOre,
    pendingSol,

    // Status
    isLoading,
    error,
    needsCheckpoint,
    exists,

    // Full status
    status,

    // Actions
    refresh,
    startPolling,
    stopPolling,
    isPolling,
  };
}

