# Error Handling Reference

The SDK uses typed errors to help you handle different failure scenarios appropriately.

## Error Types

All SDK errors extend `OredataError`:

```typescript
import {
  OredataError,
  OredataRateLimitError,
  OredataQuotaExceededError,
  OredataNetworkError,
  OredataSimulationError,
  OredataApiError,
  OredataWinnerDelayError,
  OredataHttpError,
} from '@oredata/sdk';
```

---

## OredataRateLimitError

**HTTP 429** — Too many requests.

```typescript
interface OredataRateLimitError {
  retryAfterMs: number;       // Wait this long before retrying
  limitType: 'short' | 'long' | 'ip' | 'unknown';
  helpMessage: string;        // User-friendly message
}
```

**Handling:**

```typescript
try {
  await client.fetchState();
} catch (error) {
  if (OredataRateLimitError.is(error)) {
    console.log(`Rate limited. Retry in ${error.retryAfterMs}ms`);
    await sleep(error.retryAfterMs);
    // Retry
  }
}
```

**Limit types:**
- `'short'` — Per-second limit exceeded
- `'long'` — Per-minute limit exceeded
- `'ip'` — IP-based limit (no API key)
- `'unknown'` — Other rate limit

---

## OredataQuotaExceededError

**HTTP 402** — Monthly billing quota exhausted.

```typescript
interface OredataQuotaExceededError {
  currentUsage: number;       // Requests used this month
  limit: number;              // Monthly limit
  daysUntilReset?: number;    // Days until quota resets
}
```

**Handling:**

```typescript
try {
  await client.fetchState();
} catch (error) {
  if (OredataQuotaExceededError.is(error)) {
    console.log(`Quota exceeded: ${error.currentUsage}/${error.limit}`);
    console.log(`Resets in ${error.daysUntilReset} days`);
    showUpgradePrompt();
  }
}
```

---

## OredataNetworkError

Connection or network failure.

```typescript
interface OredataNetworkError {
  cause?: Error;  // Underlying error
}
```

**Handling:**

```typescript
try {
  await client.fetchState();
} catch (error) {
  if (OredataNetworkError.is(error)) {
    console.log('Network error:', error.message);
    showOfflineIndicator();
    scheduleRetry();
  }
}
```

---

## OredataSimulationError

Transaction simulation failed.

```typescript
interface OredataSimulationError {
  simulationError: string;    // Error message from simulation
  logs?: string[];            // Transaction logs (if available)
}
```

**Handling:**

```typescript
try {
  await client.buildBidTransaction({ ... });
} catch (error) {
  if (OredataSimulationError.is(error)) {
    console.log('Simulation failed:', error.simulationError);
    if (error.logs) {
      console.log('Logs:', error.logs);
    }
    // Check inputs: insufficient balance, invalid tiles, etc.
  }
}
```

**Common causes:**
- Insufficient SOL balance
- Invalid tile numbers (must be 0-24)
- Round already ended
- Account not initialized

---

## OredataApiError

Unexpected API error (5xx, malformed response).

```typescript
interface OredataApiError {
  statusCode: number;
  responseBody?: unknown;
}
```

**Handling:**

```typescript
try {
  await client.fetchState();
} catch (error) {
  if (OredataApiError.is(error)) {
    console.log(`API error ${error.statusCode}:`, error.message);
    // Report to monitoring
    reportError(error);
  }
}
```

---

## OredataWinnerDelayError

Winner data delayed by plan restrictions (Free/Dev plans).

```typescript
interface OredataWinnerDelayError {
  revealInSeconds: number;  // Seconds until winner available
}
```

**Handling:**

```typescript
try {
  const state = await client.fetchState();
} catch (error) {
  if (OredataWinnerDelayError.is(error)) {
    console.log(`Winner reveals in ${error.revealInSeconds}s`);
    // Show countdown or upgrade prompt
  }
}
```

---

## OredataHttpError

Multi-endpoint request failure (all endpoints failed).

```typescript
interface OredataHttpError {
  attempts: RequestAttempts[];  // All failed attempts
  retryAfterMs: number | null;
}

interface RequestAttempts {
  url: string;
  error: Error;
  statusCode?: number;
}
```

**Handling:**

```typescript
try {
  await client.fetchState();
} catch (error) {
  if (OredataHttpError.is(error)) {
    console.log(`All ${error.attempts.length} endpoints failed`);
    error.attempts.forEach(a => {
      console.log(`  ${a.url}: ${a.error.message}`);
    });
  }
}
```

---

## Type Guards

Each error class has a static `.is()` method for type-safe checking:

```typescript
// Type guard pattern
if (OredataRateLimitError.is(error)) {
  // TypeScript knows error is OredataRateLimitError here
  console.log(error.retryAfterMs);
}
```

**Alternative: instanceof**

```typescript
if (error instanceof OredataRateLimitError) {
  console.log(error.retryAfterMs);
}
```

---

## parseApiError Helper

Convert API responses to typed errors:

```typescript
import { parseApiError } from '@oredata/sdk';

const response = await fetch('/v3/state');
if (!response.ok) {
  const body = await response.json();
  const error = parseApiError(response.status, body, response.headers);
  throw error; // Now it's a typed error
}
```

---

## Full Example: Robust API Call

```typescript
import {
  OredataClient,
  OredataRateLimitError,
  OredataQuotaExceededError,
  OredataNetworkError,
  OredataApiError,
} from '@oredata/sdk';

const client = new OredataClient({ apiKey: 'ore_...' });

async function fetchWithRetry(maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await client.fetchState();
    } catch (error) {
      // Rate limited: wait and retry
      if (OredataRateLimitError.is(error)) {
        if (attempt < maxRetries) {
          console.log(`Rate limited, waiting ${error.retryAfterMs}ms...`);
          await sleep(error.retryAfterMs);
          continue;
        }
      }

      // Quota exceeded: can't retry, need upgrade
      if (OredataQuotaExceededError.is(error)) {
        console.error('Monthly quota exceeded');
        showUpgradePrompt();
        throw error;
      }

      // Network error: exponential backoff
      if (OredataNetworkError.is(error)) {
        if (attempt < maxRetries) {
          const backoff = Math.pow(2, attempt) * 1000;
          console.log(`Network error, retrying in ${backoff}ms...`);
          await sleep(backoff);
          continue;
        }
      }

      // API error: log and throw
      if (OredataApiError.is(error)) {
        console.error(`API error ${error.statusCode}:`, error.message);
        reportToMonitoring(error);
      }

      throw error;
    }
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

---

## Error Recovery Patterns

### Exponential Backoff

```typescript
async function withBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 5
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (OredataNetworkError.is(error) && i < maxRetries - 1) {
        const delay = Math.min(1000 * Math.pow(2, i), 30000);
        await sleep(delay);
        continue;
      }
      throw error;
    }
  }
  throw new Error('Max retries exceeded');
}
```

### Circuit Breaker

```typescript
class CircuitBreaker {
  private failures = 0;
  private lastFailure = 0;
  private readonly threshold = 5;
  private readonly resetMs = 30000;

  async call<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit is open
    if (this.failures >= this.threshold) {
      if (Date.now() - this.lastFailure < this.resetMs) {
        throw new Error('Circuit breaker open');
      }
      this.failures = 0; // Reset
    }

    try {
      const result = await fn();
      this.failures = 0;
      return result;
    } catch (error) {
      this.failures++;
      this.lastFailure = Date.now();
      throw error;
    }
  }
}
```

---

## Related

- [OredataClient](./OREDATA-CLIENT.md)
- [Transactions](./TRANSACTIONS.md)
- [Troubleshooting](../TROUBLESHOOTING.md)
