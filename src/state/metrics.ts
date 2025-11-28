import type {
  HttpRequestMetricsEvent,
  MetricsOptions,
  MetricsBucket,
  TransportMetricsSnapshot,
  ClientEndpointMetrics,
} from '../types.js';

const DEFAULT_BUCKET_MS = 5_000;
const DEFAULT_HISTORY_WINDOW_MS = 5 * 60_000;
const TIMEOUT_THRESHOLD_MS = 10_000;

type RestBucketInternal = {
  bucketStart: number;
  requestCount: number;
  totalDurationMs: number;
  totalBytes: number;
};

/** Per-endpoint tracking data */
type EndpointData = {
  latencies: number[];
  successCount: number;
  errorCount: number;
  timeoutCount: number;
};

export class TransportMetricsRecorder {
  private readonly bucketSizeMs: number;
  private readonly historyWindowMs: number;
  private onUpdate?: () => void;

  private restBuckets = new Map<number, RestBucketInternal>();
  private restEvents: HttpRequestMetricsEvent[] = [];
  private endpointData = new Map<string, EndpointData>();
  private sse = {
    status: 'disabled' as TransportMetricsSnapshot['sse']['status'],
    events: 0,
    reconnects: 0,
    lastEventAt: null as number | null,
    lastStatusChangeAt: null as number | null,
  };

  constructor(options: MetricsOptions = {}, onUpdate?: () => void) {
    this.bucketSizeMs = Math.max(1, options.bucketSizeMs ?? DEFAULT_BUCKET_MS);
    this.historyWindowMs = Math.max(this.bucketSizeMs, options.historyWindowMs ?? DEFAULT_HISTORY_WINDOW_MS);
    this.onUpdate = onUpdate;
  }

  setOnUpdate(callback?: () => void): void {
    this.onUpdate = callback;
  }

  recordRest(event: HttpRequestMetricsEvent): void {
    const bucketStart =
      Math.floor(event.timestamp / this.bucketSizeMs) * this.bucketSizeMs;
    const existing = this.restBuckets.get(bucketStart) ?? {
      bucketStart,
      requestCount: 0,
      totalDurationMs: 0,
      totalBytes: 0,
    };
    existing.requestCount += 1;
    existing.totalDurationMs += event.durationMs;
    existing.totalBytes += event.bytes;
    this.restBuckets.set(bucketStart, existing);
    this.pruneBuckets(event.timestamp);
    this.restEvents.push(event);
    this.pruneEvents(event.timestamp);
    
    // Track per-endpoint metrics
    this.recordEndpointMetrics(event);
    
    this.notify();
  }

  private recordEndpointMetrics(event: HttpRequestMetricsEvent): void {
    // Normalize path (remove query params)
    const endpoint = event.path.split('?')[0];
    
    const existing = this.endpointData.get(endpoint) ?? {
      latencies: [],
      successCount: 0,
      errorCount: 0,
      timeoutCount: 0,
    };

    // Track latency (limit to 1000 samples to prevent memory bloat)
    if (existing.latencies.length < 1000) {
      existing.latencies.push(event.durationMs);
    }

    // Track success/error
    if (event.ok) {
      existing.successCount += 1;
    } else {
      existing.errorCount += 1;
    }

    // Track timeouts
    if (event.durationMs >= TIMEOUT_THRESHOLD_MS) {
      existing.timeoutCount += 1;
    }

    this.endpointData.set(endpoint, existing);
  }

  recordSseEvent(timestamp: number = Date.now()): void {
    this.sse.events += 1;
    this.sse.lastEventAt = timestamp;
    this.notify();
  }

  recordSseReconnect(): void {
    this.sse.reconnects += 1;
    this.notify();
  }

  recordSseStatus(
    status: TransportMetricsSnapshot['sse']['status'],
    timestamp: number = Date.now(),
  ): void {
    if (this.sse.status !== status) {
      this.sse.status = status;
      this.sse.lastStatusChangeAt = timestamp;
      if (status === 'recovering') {
        this.recordSseReconnect();
        return;
      }
      this.notify();
    }
  }

  getSnapshot(): TransportMetricsSnapshot {
    const buckets: MetricsBucket[] = Array.from(this.restBuckets.values()).sort(
      (a, b) => a.bucketStart - b.bucketStart,
    );
    const now = Date.now();
    return {
      rest: {
        bucketSizeMs: this.bucketSizeMs,
        buckets,
        events: [...this.restEvents],
      },
      sse: { ...this.sse },
      endpoints: this.getEndpointMetrics(),
      windowMs: this.historyWindowMs,
      updatedAt: now,
    };
  }

  private getEndpointMetrics(): ClientEndpointMetrics[] {
    const metrics: ClientEndpointMetrics[] = [];

    for (const [endpoint, data] of this.endpointData) {
      const requestCount = data.successCount + data.errorCount;
      if (requestCount === 0) continue;

      const latencies = [...data.latencies].sort((a, b) => a - b);
      const avgLatency = latencies.length > 0
        ? latencies.reduce((sum, l) => sum + l, 0) / latencies.length
        : 0;
      const p95Index = Math.floor(latencies.length * 0.95);
      const p95Latency = latencies.length > 0
        ? latencies[p95Index] || latencies[latencies.length - 1]
        : 0;
      const maxLatency = latencies.length > 0
        ? latencies[latencies.length - 1]
        : 0;

      metrics.push({
        endpoint,
        requestCount,
        successCount: data.successCount,
        errorCount: data.errorCount,
        latency: {
          avg: Math.round(avgLatency),
          p95: Math.round(p95Latency),
          max: Math.round(maxLatency),
        },
        timeoutCount: data.timeoutCount,
      });
    }

    // Sort by request count (descending)
    return metrics.sort((a, b) => b.requestCount - a.requestCount);
  }

  private pruneBuckets(referenceTimestamp: number): void {
    const cutoff = referenceTimestamp - this.historyWindowMs;
    for (const key of this.restBuckets.keys()) {
      if (key < cutoff) {
        this.restBuckets.delete(key);
      }
    }
  }

  private pruneEvents(referenceTimestamp: number): void {
    const cutoff = referenceTimestamp - this.historyWindowMs;
    while (this.restEvents.length && this.restEvents[0].timestamp < cutoff) {
      this.restEvents.shift();
    }
  }

  private notify(): void {
    if (this.onUpdate) {
      this.onUpdate();
    }
  }
}

