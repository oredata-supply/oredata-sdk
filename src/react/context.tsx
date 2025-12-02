'use client';

import React, { createContext, useContext, useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { OredataClient } from '../index.js';
import type { OredataProviderProps, OredataContextValue, OredataProviderConfig } from './types.js';

/**
 * React Context for Oredata SDK
 */
const OredataContext = createContext<OredataContextValue | null>(null);

/**
 * OredataProvider - Context provider for SDK configuration
 *
 * Wrap your app or component tree with this provider to enable
 * the oredata React hooks.
 *
 * @example
 * ```tsx
 * import { OredataProvider } from '@oredata/sdk/react';
 *
 * function App() {
 *   return (
 *     <OredataProvider
 *       config={{
 *         baseUrls: ['https://ore-api.gmore.fun'],
 *         apiKey: process.env.ORE_API_KEY,
 *         state: {
 *           winnerTiming: { minSpinMs: 4000, maxWaitMs: 25000 },
 *           resultPhaseDurationMs: 15000,
 *         },
 *       }}
 *     >
 *       <Game />
 *     </OredataProvider>
 *   );
 * }
 * ```
 */
export function OredataProvider({ config, children }: OredataProviderProps): React.ReactElement {
  const [client, setClient] = useState<OredataClient | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [initError, setInitError] = useState<Error | null>(null);

  // Ref to track if we should auto-start
  const shouldAutoStart = config.autoStart !== false;
  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => {
    // Skip initialization on server
    if (typeof window === 'undefined') {
      return;
    }

    try {
      // Create the client with provided config
      const newClient = new OredataClient({
        baseUrls: config.baseUrls,
        apiKey: config.apiKey,
        apiKeyParam: config.apiKeyParam,
        timeoutMs: config.timeoutMs,
        fetch: config.fetch,
        pollIntervalMs: config.pollIntervalMs,
        includeBids: config.includeBids,
        state: config.state,
      });

      setClient(newClient);
      setIsInitialized(true);
      setInitError(null);

      // Auto-start the state client if configured
      if (shouldAutoStart) {
        const stateClient = newClient.getStateClient();
        stateClient.start(configRef.current.stateOptions).catch((err) => {
          console.error('[OredataProvider] Failed to start StateClient:', err);
          setInitError(err instanceof Error ? err : new Error(String(err)));
        });
      }

      // Cleanup on unmount
      return () => {
        const stateClient = newClient.getStateClient();
        stateClient.stop();
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error('[OredataProvider] Failed to initialize client:', err);
      setInitError(err);
      setIsInitialized(true); // Mark as initialized even on error
    }
  }, [
    // Only re-create client if critical config changes
    config.apiKey,
    JSON.stringify(config.baseUrls),
    shouldAutoStart,
  ]);

  const contextValue = useMemo<OredataContextValue>(
    () => ({
      client,
      isInitialized,
      initError,
    }),
    [client, isInitialized, initError]
  );

  return (
    <OredataContext.Provider value={contextValue}>
      {children}
    </OredataContext.Provider>
  );
}

/**
 * Hook to access the raw OredataClient instance
 *
 * Use this for advanced use cases where you need direct access
 * to the underlying client.
 *
 * @example
 * ```tsx
 * function AdvancedComponent() {
 *   const { client, isInitialized, error } = useOredataClient();
 *
 *   if (!isInitialized) return <Loading />;
 *   if (error) return <Error error={error} />;
 *   if (!client) return null;
 *
 *   // Direct client access
 *   const state = await client.fetchState();
 * }
 * ```
 */
export function useOredataClient(): OredataContextValue {
  const context = useContext(OredataContext);

  if (context === null) {
    throw new Error(
      'useOredataClient must be used within an OredataProvider. ' +
        'Wrap your component tree with <OredataProvider config={...}>.'
    );
  }

  return context;
}

/**
 * Internal hook to get the StateClient with error handling
 */
export function useStateClient() {
  const { client, isInitialized, initError } = useOredataClient();

  const stateClient = useMemo(() => {
    if (!client) return null;
    return client.getStateClient();
  }, [client]);

  return {
    stateClient,
    isInitialized,
    error: initError,
  };
}

export { OredataContext };

