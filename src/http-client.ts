import {
  OredataHttpError,
  type HttpClientOptions,
  type HttpRequestMetricsEvent,
  type QuotaResponse,
  type BillingResponse,
  type PlansResponse,
  type RequestAttempts,
} from './types.js';

const DEFAULT_TIMEOUT_MS = 3_000;
const textEncoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

// SDK version for User-Agent tracking
export const SDK_VERSION = '0.10.0';
export const SDK_USER_AGENT = `@oredata/sdk/${SDK_VERSION}`;

export class HttpClient {
  private readonly baseUrls: string[];
  private readonly apiKey?: string;
  private readonly apiKeyParam: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly metricsCollector?: HttpClientOptions['metricsCollector'];

  constructor(options: HttpClientOptions) {
    if (!options.baseUrls || options.baseUrls.length === 0) {
      throw new Error('HttpClient requires at least one base URL');
    }
    this.baseUrls = options.baseUrls.map((url: string) => url.replace(/\/$/, ''));
    this.apiKey = options.apiKey?.trim() || undefined;
    this.apiKeyParam = options.apiKeyParam ?? 'apiKey';
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const fetchCandidate = options.fetchImpl ?? globalThis.fetch;
    if (!fetchCandidate) {
      throw new Error('Global fetch is not available. Provide a fetch implementation.');
    }
    this.fetchImpl = fetchCandidate.bind(globalThis);
    this.metricsCollector = options.metricsCollector;
  }

  public async get<T>(path: string, init?: RequestInit): Promise<T> {
    return this.request<T>(path, { ...init, method: 'GET' });
  }

  public async post<T>(path: string, body: unknown, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers ?? {});
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    return this.request<T>(path, {
      ...init,
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  }

  /**
   * Fetch current quota status for the configured API key.
   * Returns null if no API key is configured.
   */
  public async getQuota(): Promise<QuotaResponse | null> {
    if (!this.apiKey) {
      return null;
    }
    return this.get<QuotaResponse>('/v3/quota');
  }

  /**
   * Fetch billing information for the configured API key.
   * Returns null if no API key is configured.
   */
  public async getBilling(): Promise<BillingResponse | null> {
    if (!this.apiKey) {
      return null;
    }
    return this.get<BillingResponse>('/v3/billing');
  }

  /**
   * Fetch available API plans with pricing and limits.
   * This is the SSOT for plan information - no API key required.
   */
  public async getPlans(): Promise<PlansResponse> {
    return this.get<PlansResponse>('/v3/plans');
  }

  /**
   * Fetch latest blockhash from the API's RPC.
   * Use this to ensure blockhash consistency with transaction building.
   */
  public async getBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
    return this.get<{ blockhash: string; lastValidBlockHeight: number }>('/solana/blockhash');
  }

  private buildUrl(baseUrl: string, path: string): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    let url = `${baseUrl}${normalizedPath}`;
    if (this.apiKey) {
      const delimiter = url.includes('?') ? '&' : '?';
      url = `${url}${delimiter}${this.apiKeyParam}=${encodeURIComponent(this.apiKey)}`;
    }
    return url;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const attempts: RequestAttempts[] = [];
    let lastRetryAfterMs: number | null = null;

    for (const baseUrl of this.baseUrls) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      const start = this.now();
      try {
        // Merge headers with User-Agent for SDK tracking
        const headers = new Headers(init?.headers ?? {});
        headers.set('User-Agent', SDK_USER_AGENT);
        
        const response = await this.fetchImpl(this.buildUrl(baseUrl, path), {
          ...init,
          headers,
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!response.ok) {
          // Extract Retry-After header for 429 responses
          if (response.status === 429) {
            const retryAfter = response.headers.get('Retry-After');
            if (retryAfter) {
              const seconds = parseInt(retryAfter, 10);
              if (!Number.isNaN(seconds)) {
                lastRetryAfterMs = seconds * 1000;
              }
            }
          }
          const errorText = await response.text().catch(() => '');
          throw new Error(
            `Request failed with ${response.status} ${response.statusText}${
              errorText ? `: ${errorText}` : ''
            }`,
          );
        }
        const data = (await response.json()) as T;
        this.recordMetrics({
          method: init?.method ?? 'GET',
          path,
          durationMs: this.now() - start,
          bytes: this.estimateBytes(response, data),
          timestamp: Date.now(),
          ok: true,
        });
        return data;
      } catch (error) {
        clearTimeout(timeout);
        this.recordMetrics({
          method: init?.method ?? 'GET',
          path,
          durationMs: this.now() - start,
          bytes: 0,
          timestamp: Date.now(),
          ok: false,
        });
        attempts.push({ baseUrl, error });
      }
    }
    throw new OredataHttpError('All API base URLs failed', attempts, lastRetryAfterMs);
  }

  public getBaseUrls(): string[] {
    return [...this.baseUrls];
  }

  public getApiKey(): string | undefined {
    return this.apiKey;
  }

  public getApiKeyParam(): string {
    return this.apiKeyParam;
  }

  private now(): number {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
    return Date.now();
  }

  private estimateBytes(response: Response, data: unknown): number {
    const headerBytes = Number(response.headers.get('content-length'));
    if (Number.isFinite(headerBytes) && headerBytes > 0) {
      return headerBytes;
    }
    try {
      if (typeof data === 'string') {
        return textEncoder ? textEncoder.encode(data).length : data.length;
      }
      const serialized = JSON.stringify(data);
      return textEncoder ? textEncoder.encode(serialized).length : serialized.length;
    } catch {
      return 0;
    }
  }

  private recordMetrics(event: HttpRequestMetricsEvent): void {
    if (!this.metricsCollector) {
      return;
    }
    this.metricsCollector.recordRest(event);
  }
}

