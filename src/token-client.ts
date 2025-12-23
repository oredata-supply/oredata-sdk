/**
 * TokenClient - Access ORE token data via OreData API
 *
 * This client provides access to ORE token supply, price, and emission data.
 *
 * Features:
 * - Real-time token supply from Solana RPC
 * - Price and market cap from CoinGecko
 * - Emission statistics
 * - Historical data (when available)
 *
 * @example
 * ```typescript
 * import { TokenClient } from '@oredata/sdk';
 *
 * const token = new TokenClient({
 *   apiBaseUrl: 'https://api.oredata.supply',
 * });
 *
 * // Get current token state
 * const info = await token.getInfo();
 * console.log(`ORE Supply: ${info.totalSupply}`);
 * console.log(`Price: $${info.priceUsd}`);
 * console.log(`Market Cap: $${info.marketCapUsd}`);
 *
 * // Get emission statistics
 * const emissions = await token.getEmissions();
 * console.log(`Daily emission: ${emissions.dailyEmissionOre} ORE`);
 * console.log(`Current round: ${emissions.currentRound}`);
 * ```
 */

import { SDK_USER_AGENT } from './http-client.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Current token state
 */
export interface TokenInfo {
  /** Human-readable total supply (e.g., "412167.79") */
  totalSupply: string;
  /** Raw total supply in smallest units */
  totalSupplyRaw: string;
  /** Token decimals (11 for ORE) */
  decimals: number;
  /** Current price in USD (from CoinGecko) */
  priceUsd: string | null;
  /** Market cap in USD */
  marketCapUsd: string | null;
  /** Current mint authority (ore-mint program PDA) */
  mintAuthority: string | null;
  /** Mint program address */
  mintProgram: string;
  /** Last update timestamp */
  lastUpdated: string;
}

/**
 * Emission statistics
 */
export interface EmissionStats {
  /** ORE emitted per round (e.g., "0.2") */
  emissionPerRound: string;
  /** Average round duration in seconds */
  roundDurationSec: number;
  /** Daily ORE emission (e.g., "288") */
  dailyEmissionOre: string;
  /** Weekly ORE emission (e.g., "2016") */
  weeklyEmissionOre: string;
  /** Current round ID */
  currentRound: number | null;
  /** Total ORE emitted since V3 launch */
  totalEmittedSinceLaunch: string;
  /** Days since V3 launch */
  daysSinceLaunch: number;
  /** V3 launch date (ISO string) */
  launchDate: string;
}

/**
 * Historical token data point
 */
export interface TokenHistoryPoint {
  /** Timestamp (ISO string) */
  timestamp: string;
  /** Total supply at this time */
  supply: string;
  /** Price in USD at this time */
  priceUsd: string | null;
  /** Market cap in USD at this time */
  marketCapUsd: string | null;
}

/**
 * Token history response
 */
export interface TokenHistoryResponse {
  /** Period requested */
  period: string;
  /** Interval requested */
  interval: string;
  /** Historical data points */
  data: TokenHistoryPoint[];
  /** Note about data availability */
  note?: string;
}

/**
 * Token poller status
 */
export interface TokenStatus {
  /** Whether token poller is enabled */
  enabled: boolean;
  /** Whether supply data is available */
  hasSupplyData: boolean;
  /** Whether price data is available */
  hasPriceData: boolean;
  /** Last supply update timestamp */
  lastUpdatedSupply: string;
  /** Last price update timestamp */
  lastUpdatedPrice: string;
}

/**
 * TokenClient options
 */
export interface TokenClientOptions {
  /** API base URL (default: https://api.oredata.supply) */
  apiBaseUrl?: string;
  /** API key for authentication (optional) */
  apiKey?: string;
}

// ─── TokenClient ─────────────────────────────────────────────────────────────

const DEFAULT_API_BASE_URL = 'https://api.oredata.supply';

/**
 * TokenClient - ORE token data access via OreData API
 *
 * Provides methods to fetch current token state, emission statistics,
 * and historical data.
 */
export class TokenClient {
  private readonly apiBaseUrl: string;
  private readonly apiKey?: string;

  constructor(options: TokenClientOptions = {}) {
    this.apiBaseUrl = (options.apiBaseUrl ?? DEFAULT_API_BASE_URL).replace(/\/$/, '');
    this.apiKey = options.apiKey;
  }

  /**
   * Get current token information
   *
   * Returns supply, price, market cap, and mint authority details.
   *
   * @example
   * ```typescript
   * const info = await token.getInfo();
   * console.log(`Supply: ${Number(info.totalSupply).toLocaleString()} ORE`);
   * console.log(`Price: $${info.priceUsd}`);
   * ```
   */
  async getInfo(): Promise<TokenInfo> {
    const url = `${this.apiBaseUrl}/ore/token`;

    const response = await fetch(url, {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch token info: ${response.status}`);
    }

    return (await response.json()) as TokenInfo;
  }

  /**
   * Get emission statistics
   *
   * Returns emission rate, current round, and total emitted since launch.
   *
   * @example
   * ```typescript
   * const emissions = await token.getEmissions();
   * console.log(`${emissions.dailyEmissionOre} ORE/day`);
   * console.log(`Round ${emissions.currentRound}`);
   * console.log(`${emissions.daysSinceLaunch} days since V3 launch`);
   * ```
   */
  async getEmissions(): Promise<EmissionStats> {
    const url = `${this.apiBaseUrl}/ore/token/emissions`;

    const response = await fetch(url, {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch emissions: ${response.status}`);
    }

    return (await response.json()) as EmissionStats;
  }

  /**
   * Get historical token data
   *
   * @param options.period - Time period: '24h', '7d', '30d', or 'all'
   * @param options.interval - Data interval: '1h' or '1d'
   *
   * @example
   * ```typescript
   * const history = await token.getHistory({ period: '7d', interval: '1d' });
   * for (const point of history.data) {
   *   console.log(`${point.timestamp}: ${point.supply} ORE @ $${point.priceUsd}`);
   * }
   * ```
   */
  async getHistory(
    options: { period?: '24h' | '7d' | '30d' | 'all'; interval?: '1h' | '1d' } = {},
  ): Promise<TokenHistoryResponse> {
    const params = new URLSearchParams();
    if (options.period) {
      params.set('period', options.period);
    }
    if (options.interval) {
      params.set('interval', options.interval);
    }

    const query = params.toString();
    const url = `${this.apiBaseUrl}/ore/token/history${query ? `?${query}` : ''}`;

    const response = await fetch(url, {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch token history: ${response.status}`);
    }

    return (await response.json()) as TokenHistoryResponse;
  }

  /**
   * Get token poller status
   *
   * Check if the API's token data poller is healthy.
   *
   * @example
   * ```typescript
   * const status = await token.getStatus();
   * if (!status.enabled) {
   *   console.warn('Token data not available');
   * }
   * ```
   */
  async getStatus(): Promise<TokenStatus> {
    const url = `${this.apiBaseUrl}/ore/token/status`;

    const response = await fetch(url, {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch token status: ${response.status}`);
    }

    return (await response.json()) as TokenStatus;
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Calculate supply at a historical round
   *
   * Since ORE emission is deterministic (~0.2 ORE per round),
   * we can calculate historical supply mathematically.
   *
   * @param currentSupply - Current total supply
   * @param currentRound - Current round ID
   * @param targetRound - Target historical round ID
   * @param emissionPerRound - ORE emitted per round (default: 0.2)
   *
   * @example
   * ```typescript
   * const info = await token.getInfo();
   * const emissions = await token.getEmissions();
   *
   * // Calculate supply at round 50000
   * const historicalSupply = token.calculateSupplyAtRound(
   *   parseFloat(info.totalSupply),
   *   emissions.currentRound!,
   *   50000
   * );
   * ```
   */
  calculateSupplyAtRound(
    currentSupply: number,
    currentRound: number,
    targetRound: number,
    emissionPerRound = 0.2,
  ): number {
    const roundsDiff = currentRound - targetRound;
    return currentSupply - roundsDiff * emissionPerRound;
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': SDK_USER_AGENT,
    };
    if (this.apiKey) {
      headers['x-api-key'] = this.apiKey;
    }
    return headers;
  }
}
