/**
 * Self-Service Client for Bots
 *
 * Provides programmatic access to the Oredata API for bots and scripts.
 * Uses wallet-based authentication (Sign In With Solana).
 *
 * Usage:
 * ```typescript
 * import { SelfServiceClient } from '@oredata/sdk';
 *
 * const client = new SelfServiceClient({
 *   baseUrl: 'https://api.oredata.supply',
 * });
 *
 * // Register or login with wallet
 * const { nonce } = await client.auth.getNonce();
 * const message = client.auth.buildSignInMessage(walletAddress, nonce);
 * const signature = await signMessage(message); // Your wallet signing logic
 *
 * await client.auth.login({ wallet: walletAddress, message, signature });
 *
 * // Now use authenticated methods
 * const keys = await client.keys.list();
 * const usage = await client.usage.get();
 * ```
 */

const DEFAULT_BASE_URL = 'https://api.oredata.supply';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SelfServiceClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
}

export interface SelfServiceApiKey {
  id: string;
  prefix: string;
  planId: string;
  label: string | null;
  isActive: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  feeWalletAddress: string | null;
}

export interface SelfServiceApiKeyWithSecret extends SelfServiceApiKey {
  key: string;
}

export interface SelfServiceUser {
  id: string;
  walletAddress: string | null;
  email: string | null;
  displayName: string | null;
  planId: string;
  createdAt: string;
  feeWalletAddress: string | null;
  feeDiscountPassToUser: boolean;
}

export interface SelfServiceUsage {
  totalLiveRequests: number;
  totalHistoricalQueries: number;
  liveLimit: number | null;
  historicalLimit: number | null;
  livePercentUsed: number | null;
  historicalPercentUsed: number | null;
  daysRemaining: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  planId: string;
  keys: Array<{
    keyId: string;
    keyPrefix: string;
    label: string | null;
    liveRequestsUsed: number;
    historicalQueriesUsed: number;
    liveLimit: number | null;
    historicalLimit: number | null;
    livePercentUsed: number | null;
    historicalPercentUsed: number | null;
  }>;
}

export interface SelfServiceUsageHistory {
  date: string;
  liveRequests: number;
  historicalQueries: number;
}

/**
 * Hourly usage snapshot data point.
 * Used for time-series charts showing API usage over time.
 */
export interface SelfServiceUsageSnapshot {
  /** ISO timestamp of the hour (e.g., "2025-12-22T14:00:00.000Z") */
  hour: string;
  /** Number of live requests in this hour */
  liveRequests: number;
  /** Number of historical queries in this hour */
  historicalQueries: number;
}

export interface SelfServicePlan {
  id: string;
  name: string;
  priceUsdcMonthly: number;
  limits: {
    liveRequestsPerSecond: number;
    liveRequestsPerMinute: number;
    historicalQueriesPerMinute: number;
    monthlyLiveRequests: number | null;
    monthlyHistoricalQueries: number | null;
  };
  overageAllowed: boolean;
  overageRate: number | null;
}

export interface SelfServiceSubscription {
  id: string;
  planId: string;
  billingPeriod: string;
  amountUsdc: number;
  txSignature: string | null;
  payerWallet: string;
  startsAt: string;
  endsAt: string;
  status: string;
  createdAt: string;
}

export interface SelfServiceSession {
  userId: string;
  walletAddress: string | null;
  email: string | null;
  planId: string;
  expiresAt: string;
}

export interface SelfServiceProject {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  logoUrl: string | null;
  createdAt: string;
}

export interface SelfServiceProjectWithStats extends SelfServiceProject {
  activeTerms: {
    version: string;
    title: string;
    activatedAt: string | null;
  } | null;
  stats: {
    consentsCount: number;
    apiKeysCount: number;
  };
}

export interface SelfServiceTerms {
  id: string;
  version: string;
  title: string;
  bodyMd: string;
  changelog: string | null;
  isActive: boolean;
  activatedAt: string | null;
  createdAt: string;
}

export interface SelfServiceConsent {
  id: string;
  walletAddress: string;
  version: string;
  acceptedAt: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface SelfServicePagination {
  page: number;
  limit: number;
  total: number;
}

export class SelfServiceError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'SelfServiceError';
  }
}

// ─── Client ───────────────────────────────────────────────────────────────────

export class SelfServiceClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private sessionToken: string | null = null;

  constructor(options: SelfServiceClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.fetchImpl = options.fetch ?? fetch;
  }

  /**
   * Set the session token for authenticated requests.
   * Call this after login/register to enable authenticated API calls.
   */
  setSession(token: string): void {
    this.sessionToken = token;
  }

  /**
   * Clear the session token (logout).
   */
  clearSession(): void {
    this.sessionToken = null;
  }

  /**
   * Check if a session is set.
   */
  hasSession(): boolean {
    return this.sessionToken !== null;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    requiresAuth = true
  ): Promise<T> {
    if (requiresAuth && !this.sessionToken) {
      throw new SelfServiceError('No session token. Call login() or register() first.', 401, 'no_session');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.sessionToken) {
      headers['Authorization'] = `Bearer ${this.sessionToken}`;
    }

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new SelfServiceError(
        errorData.message ?? `Request failed with ${response.status}`,
        response.status,
        errorData.error
      );
    }

    return response.json();
  }

  // ─── Auth ─────────────────────────────────────────────────────────────────────

  auth = {
    /**
     * Get a nonce for signing.
     * This is the first step in the wallet auth flow.
     */
    getNonce: async (): Promise<{ nonce: string }> => {
      return this.request<{ nonce: string }>('POST', '/portal/auth/nonce', undefined, false);
    },

    /**
     * Build a Sign In With Solana message.
     * Use this message for wallet signing.
     */
    buildSignInMessage: (walletAddress: string, nonce: string): string => {
      return `oredata.supply wants you to sign in with your Solana account:\n${walletAddress}\n\nSign in to oredata.supply\n\nNonce: ${nonce}`;
    },

    /**
     * Register a new account with wallet.
     * Returns session token on success.
     */
    register: async (params: {
      wallet: string;
      message: string;
      signature: string;
    }): Promise<{
      sessionToken: string;
      user: SelfServiceUser;
      apiKey: SelfServiceApiKeyWithSecret;
    }> => {
      const result = await this.request<{
        sessionToken: string;
        user: SelfServiceUser;
        apiKey: SelfServiceApiKeyWithSecret;
      }>('POST', '/portal/auth/register', {
        walletAddress: params.wallet,
        message: params.message,
        signature: params.signature,
      }, false);

      this.sessionToken = result.sessionToken;
      return result;
    },

    /**
     * Login with wallet.
     * Returns session token on success.
     */
    login: async (params: {
      wallet: string;
      message: string;
      signature: string;
    }): Promise<{
      sessionToken: string;
      user: SelfServiceUser;
    }> => {
      const result = await this.request<{
        sessionToken: string;
        user: SelfServiceUser;
      }>('POST', '/portal/auth/login', {
        walletAddress: params.wallet,
        message: params.message,
        signature: params.signature,
      }, false);

      this.sessionToken = result.sessionToken;
      return result;
    },

    /**
     * Logout (invalidate session).
     */
    logout: async (): Promise<{ success: boolean }> => {
      const result = await this.request<{ success: boolean }>('POST', '/portal/auth/logout');
      this.sessionToken = null;
      return result;
    },

    /**
     * Get current session info.
     */
    getSession: async (): Promise<{ session: SelfServiceSession }> => {
      return this.request<{ session: SelfServiceSession }>('GET', '/portal/auth/session');
    },
  };

  // ─── Keys ─────────────────────────────────────────────────────────────────────

  keys = {
    /**
     * List all API keys for the authenticated user.
     */
    list: async (): Promise<{ keys: SelfServiceApiKey[] }> => {
      return this.request<{ keys: SelfServiceApiKey[] }>('GET', '/portal/keys');
    },

    /**
     * Get a single API key with full decrypted value.
     * Rate limited: 10/hour per user.
     */
    get: async (keyId: string): Promise<SelfServiceApiKeyWithSecret> => {
      return this.request<SelfServiceApiKeyWithSecret>('GET', `/portal/keys/${keyId}`);
    },

    /**
     * Create a new API key.
     */
    create: async (options?: {
      label?: string;
      feeWalletAddress?: string;
    }): Promise<SelfServiceApiKeyWithSecret> => {
      return this.request<SelfServiceApiKeyWithSecret>('POST', '/portal/keys', options ?? {});
    },

    /**
     * Update an API key.
     */
    update: async (
      keyId: string,
      updates: { label?: string; feeWalletAddress?: string | null }
    ): Promise<{ success: boolean }> => {
      return this.request<{ success: boolean }>('PATCH', `/portal/keys/${keyId}`, updates);
    },

    /**
     * Revoke an API key.
     */
    revoke: async (keyId: string): Promise<{ success: boolean }> => {
      return this.request<{ success: boolean }>('DELETE', `/portal/keys/${keyId}`);
    },

    /**
     * Rotate an API key.
     * Creates new key, old key gets 24h grace period.
     */
    rotate: async (keyId: string): Promise<{
      newKey: SelfServiceApiKeyWithSecret;
      deprecatedKeyId: string;
      gracePeriodEnds: string;
    }> => {
      return this.request('POST', `/portal/keys/${keyId}/rotate`);
    },

    /**
     * Assign an API key to a project.
     * Enables consent tracking for the key.
     */
    assign: async (keyId: string, projectId: string): Promise<{ success: boolean }> => {
      return this.request<{ success: boolean }>('POST', `/portal/keys/${keyId}/assign`, { projectId });
    },
  };

  // ─── User ─────────────────────────────────────────────────────────────────────

  user = {
    /**
     * Get user profile.
     */
    get: async (): Promise<{ user: SelfServiceUser }> => {
      return this.request<{ user: SelfServiceUser }>('GET', '/portal/user');
    },

    /**
     * Update user profile.
     */
    update: async (updates: {
      displayName?: string;
      feeWalletAddress?: string | null;
      feeDiscountPassToUser?: boolean;
    }): Promise<{ user: SelfServiceUser }> => {
      return this.request<{ user: SelfServiceUser }>('PATCH', '/portal/user', updates);
    },

    /**
     * Delete user account.
     */
    delete: async (): Promise<{ success: boolean }> => {
      const result = await this.request<{ success: boolean }>('DELETE', '/portal/user');
      this.sessionToken = null;
      return result;
    },
  };

  // ─── Usage ────────────────────────────────────────────────────────────────────

  usage = {
    /**
     * Get current usage stats.
     */
    get: async (): Promise<{ usage: SelfServiceUsage }> => {
      return this.request<{ usage: SelfServiceUsage }>('GET', '/portal/usage');
    },

    /**
     * Get usage history.
     */
    getHistory: async (options?: { days?: number }): Promise<{
      history: SelfServiceUsageHistory[];
    }> => {
      const params = new URLSearchParams();
      if (options?.days) {
        params.set('days', String(options.days));
      }
      const query = params.toString();
      return this.request<{ history: SelfServiceUsageHistory[] }>(
        'GET',
        `/portal/usage/history${query ? `?${query}` : ''}`
      );
    },

    /**
     * Get hourly usage snapshots for time-series charts.
     * @param options.hours - Number of hours to fetch (default 168 = 7 days, max 720 = 30 days)
     * @returns Array of hourly snapshots sorted chronologically
     */
    getSnapshots: async (options?: { hours?: number }): Promise<{
      snapshots: SelfServiceUsageSnapshot[];
    }> => {
      const params = new URLSearchParams();
      if (options?.hours) {
        params.set('hours', String(options.hours));
      }
      const query = params.toString();
      return this.request<{ snapshots: SelfServiceUsageSnapshot[] }>(
        'GET',
        `/portal/usage/snapshots${query ? `?${query}` : ''}`
      );
    },
  };

  // ─── Billing ──────────────────────────────────────────────────────────────────

  billing = {
    /**
     * Get current billing info.
     */
    get: async (): Promise<{
      currentPlan: SelfServicePlan | null;
      subscription: SelfServiceSubscription | null;
    }> => {
      return this.request('GET', '/portal/billing');
    },

    /**
     * Get available plans.
     */
    getPlans: async (): Promise<{ plans: SelfServicePlan[] }> => {
      return this.request<{ plans: SelfServicePlan[] }>('GET', '/portal/billing/plans');
    },

    /**
     * Subscribe to a plan.
     * Returns payment info if payment required, or subscription if free.
     */
    subscribe: async (options: {
      planId: string;
      billingPeriod: 'monthly' | '3mo' | '6mo' | '12mo';
      payerWallet: string;
    }): Promise<
      | { success: true; subscription: SelfServiceSubscription }
      | {
          paymentRequired: true;
          payment: {
            planId: string;
            billingPeriod: string;
            amountUsdc: number;
            months: number;
            treasuryWallet: string;
            payerWallet: string;
            usdcMint: string;
          };
        }
    > => {
      return this.request('POST', '/portal/billing/subscribe', options);
    },

    /**
     * Confirm subscription after payment.
     */
    confirm: async (options: {
      planId: string;
      billingPeriod: string;
      txSignature: string;
      payerWallet: string;
    }): Promise<{ success: boolean; subscription: SelfServiceSubscription }> => {
      return this.request('POST', '/portal/billing/confirm', options);
    },
  };

  // ─── Projects ───────────────────────────────────────────────────────────────────

  projects = {
    /**
     * List all projects for the authenticated user.
     */
    list: async (): Promise<{ projects: SelfServiceProject[] }> => {
      return this.request<{ projects: SelfServiceProject[] }>('GET', '/portal/projects');
    },

    /**
     * Create a new project.
     */
    create: async (options: {
      name: string;
      slug: string;
      domain?: string;
      logoUrl?: string;
    }): Promise<{ project: SelfServiceProject }> => {
      return this.request<{ project: SelfServiceProject }>('POST', '/portal/projects', options);
    },

    /**
     * Get a project with stats.
     */
    get: async (projectId: string): Promise<{ project: SelfServiceProjectWithStats }> => {
      return this.request<{ project: SelfServiceProjectWithStats }>('GET', `/portal/projects/${projectId}`);
    },

    /**
     * Update a project.
     */
    update: async (
      projectId: string,
      updates: { name?: string; domain?: string | null; logoUrl?: string | null }
    ): Promise<{ project: SelfServiceProject }> => {
      return this.request<{ project: SelfServiceProject }>('PATCH', `/portal/projects/${projectId}`, updates);
    },

    /**
     * Delete a project.
     * Will fail if project has consent records (for compliance).
     */
    delete: async (projectId: string): Promise<{ success: boolean }> => {
      return this.request<{ success: boolean }>('DELETE', `/portal/projects/${projectId}`);
    },

    /**
     * List terms versions for a project.
     */
    listTerms: async (projectId: string): Promise<{ versions: SelfServiceTerms[] }> => {
      return this.request<{ versions: SelfServiceTerms[] }>('GET', `/portal/projects/${projectId}/terms`);
    },

    /**
     * Create a new terms version.
     */
    createTerms: async (
      projectId: string,
      options: {
        version: string;
        title: string;
        bodyMd: string;
        changelog?: string;
      }
    ): Promise<{ terms: SelfServiceTerms }> => {
      return this.request<{ terms: SelfServiceTerms }>('POST', `/portal/projects/${projectId}/terms`, options);
    },

    /**
     * Activate a terms version.
     * Deactivates all other versions for the project.
     */
    activateTerms: async (termsId: string): Promise<{ success: boolean }> => {
      return this.request<{ success: boolean }>('POST', `/portal/terms/${termsId}/activate`);
    },

    /**
     * List consents for a project.
     */
    listConsents: async (
      projectId: string,
      options?: {
        page?: number;
        limit?: number;
        wallet?: string;
        version?: string;
      }
    ): Promise<{
      consents: SelfServiceConsent[];
      pagination: SelfServicePagination;
    }> => {
      const params = new URLSearchParams();
      if (options?.page) params.set('page', String(options.page));
      if (options?.limit) params.set('limit', String(options.limit));
      if (options?.wallet) params.set('wallet', options.wallet);
      if (options?.version) params.set('version', options.version);
      const query = params.toString();
      return this.request<{
        consents: SelfServiceConsent[];
        pagination: SelfServicePagination;
      }>('GET', `/portal/projects/${projectId}/consents${query ? `?${query}` : ''}`);
    },

    /**
     * Export consents as CSV.
     * Returns the raw CSV string.
     */
    exportConsents: async (projectId: string): Promise<string> => {
      const response = await this.fetchImpl(`${this.baseUrl}/portal/projects/${projectId}/consents/export`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.sessionToken}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new SelfServiceError(
          errorData.message ?? `Request failed with ${response.status}`,
          response.status,
          errorData.error
        );
      }

      return response.text();
    },

    /**
     * Get hourly usage snapshots for a project's API keys.
     * @param projectId - The project ID
     * @param options.hours - Number of hours to fetch (default 168 = 7 days, max 720 = 30 days)
     * @returns Array of hourly snapshots sorted chronologically
     */
    getUsageSnapshots: async (
      projectId: string,
      options?: { hours?: number }
    ): Promise<{ snapshots: SelfServiceUsageSnapshot[] }> => {
      const params = new URLSearchParams();
      if (options?.hours) {
        params.set('hours', String(options.hours));
      }
      const query = params.toString();
      return this.request<{ snapshots: SelfServiceUsageSnapshot[] }>(
        'GET',
        `/portal/projects/${projectId}/usage/snapshots${query ? `?${query}` : ''}`
      );
    },
  };
}
