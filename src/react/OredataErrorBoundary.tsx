'use client';

import React, { Component, type ReactNode, type ErrorInfo } from 'react';
import type { OredataErrorBoundaryProps, OredataErrorBoundaryState } from './types.js';

/**
 * OredataErrorBoundary - Error boundary for Oredata components
 *
 * Catches errors in the component tree and displays a fallback UI.
 * Integrates with the SDK error system for consistent error handling.
 *
 * @example
 * ```tsx
 * import { OredataProvider, OredataErrorBoundary } from '@oredata/sdk/react';
 *
 * function App() {
 *   return (
 *     <OredataProvider config={config}>
 *       <OredataErrorBoundary
 *         fallback={<ConnectionError />}
 *         onError={(error) => logToSentry(error)}
 *       >
 *         <Game />
 *       </OredataErrorBoundary>
 *     </OredataProvider>
 *   );
 * }
 * ```
 *
 * @example With reset capability
 * ```tsx
 * <OredataErrorBoundary
 *   fallback={(error, reset) => (
 *     <div>
 *       <p>Something went wrong: {error.message}</p>
 *       <button onClick={reset}>Try Again</button>
 *     </div>
 *   )}
 * >
 *   <Game />
 * </OredataErrorBoundary>
 * ```
 */
export class OredataErrorBoundary extends Component<
  OredataErrorBoundaryProps,
  OredataErrorBoundaryState
> {
  constructor(props: OredataErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(error: Error): OredataErrorBoundaryState {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log error details
    console.error('[OredataErrorBoundary] Caught error:', error);
    console.error('[OredataErrorBoundary] Component stack:', errorInfo.componentStack);

    // Call optional onError handler
    this.props.onError?.(error, errorInfo);
  }

  /**
   * Reset the error boundary state
   */
  reset = (): void => {
    this.setState({
      hasError: false,
      error: null,
    });
  };

  render(): ReactNode {
    const { hasError, error } = this.state;
    const { children, fallback } = this.props;

    if (hasError && error) {
      // Render fallback UI
      if (typeof fallback === 'function') {
        return fallback(error, this.reset);
      }
      return fallback;
    }

    return children;
  }
}

/**
 * ConnectionError - Default fallback component
 *
 * A simple error display component that can be used as the
 * fallback for OredataErrorBoundary.
 */
export function ConnectionError({
  error,
  onRetry,
}: {
  error?: Error;
  onRetry?: () => void;
}): React.ReactElement {
  return (
    <div
      style={{
        padding: '20px',
        textAlign: 'center',
        backgroundColor: '#1a1a2e',
        borderRadius: '8px',
        border: '1px solid #e94560',
        color: '#fff',
      }}
    >
      <h3 style={{ color: '#e94560', marginBottom: '10px' }}>Connection Error</h3>
      <p style={{ color: '#a0a0a0', marginBottom: '15px' }}>
        {error?.message ?? 'Failed to connect to the ORE network'}
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          style={{
            padding: '10px 20px',
            backgroundColor: '#e94560',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px',
          }}
        >
          Try Again
        </button>
      )}
    </div>
  );
}

