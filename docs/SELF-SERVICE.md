# Self-Service SDK for Bots

The `SelfServiceClient` enables bots and scripts to programmatically:
- Register and authenticate with wallet signatures
- Create and manage API keys
- Create projects and set up Terms & Conditions
- Track user consents for compliance

## Quick Start

```typescript
import { SelfServiceClient } from '@oredata/sdk';

const client = new SelfServiceClient({
  baseUrl: 'https://api.oredata.supply',  // Default
});

// 1. Get nonce for signing
const { nonce } = await client.auth.getNonce();

// 2. Build message and sign with your wallet
const message = client.auth.buildSignInMessage(walletAddress, nonce);
const signature = await signMessage(message);  // Your wallet signing logic

// 3. Register (or login if already registered)
await client.auth.register({ wallet: walletAddress, message, signature });

// Now you're authenticated! Use any method below.
```

---

## Authentication

### Getting a Nonce

```typescript
const { nonce } = await client.auth.getNonce();
// Returns: { nonce: 'abc123...' }
```

### Building the Sign-In Message

```typescript
const message = client.auth.buildSignInMessage(walletAddress, nonce);
// Returns: "oredata.supply wants you to sign in with your Solana account:\n<wallet>\n\nSign in to oredata.supply\n\nNonce: <nonce>"
```

### Register (New User)

```typescript
const result = await client.auth.register({
  wallet: walletAddress,
  message: message,
  signature: signatureBase58,
});
// Returns: { sessionToken, user, apiKey }
```

**Note:** Registration automatically creates your first API key.

### Login (Existing User)

```typescript
const result = await client.auth.login({
  wallet: walletAddress,
  message: message,
  signature: signatureBase58,
});
// Returns: { sessionToken, user }
```

### Session Management

```typescript
// Check current session
const { session } = await client.auth.getSession();

// Logout
await client.auth.logout();

// Manual session control
client.setSession(token);   // Set token manually
client.clearSession();      // Clear token
client.hasSession();        // Check if token exists
```

---

## API Keys

### List All Keys

```typescript
const { keys } = await client.keys.list();
// Returns: { keys: SelfServiceApiKey[] }
```

### Create a Key

```typescript
const key = await client.keys.create({
  label: 'Production Bot',      // Optional
  feeWalletAddress: '...',      // Optional: for fee sharing
});
// Returns: SelfServiceApiKeyWithSecret (includes full key value)
```

### Get Key (with secret)

```typescript
const key = await client.keys.get(keyId);
// Returns: SelfServiceApiKeyWithSecret
// Note: Rate limited to 10/hour
```

### Update Key

```typescript
await client.keys.update(keyId, {
  label: 'New Label',
  feeWalletAddress: null,  // Remove fee wallet
});
```

### Revoke Key

```typescript
await client.keys.revoke(keyId);
```

### Rotate Key

```typescript
const { newKey, deprecatedKeyId, gracePeriodEnds } = await client.keys.rotate(keyId);
// Old key works for 24 more hours
```

### Assign Key to Project

```typescript
await client.keys.assign(keyId, projectId);
// Enables consent tracking for this key
```

---

## Projects

Projects organize your T&C and consent tracking.

### List Projects

```typescript
const { projects } = await client.projects.list();
// Returns: { projects: SelfServiceProject[] }
```

### Create Project

```typescript
const { project } = await client.projects.create({
  name: 'My Bot',
  slug: 'my-bot',           // Lowercase, alphanumeric + hyphens
  domain: 'mybot.app',      // Optional
  logoUrl: 'https://...',   // Optional
});
```

### Get Project (with stats)

```typescript
const { project } = await client.projects.get(projectId);
// Returns: SelfServiceProjectWithStats
// Includes: activeTerms, stats.consentsCount, stats.apiKeysCount
```

### Update Project

```typescript
await client.projects.update(projectId, {
  name: 'New Name',
  domain: 'newdomain.app',
});
```

### Delete Project

```typescript
await client.projects.delete(projectId);
// Note: Fails if project has consent records (for compliance)
```

---

## Terms & Conditions

### List Terms Versions

```typescript
const { versions } = await client.projects.listTerms(projectId);
// Returns: { versions: SelfServiceTerms[] }
```

### Create Terms Version

```typescript
const { terms } = await client.projects.createTerms(projectId, {
  version: '1.0.0',          // Semver format: X.Y or X.Y.Z
  title: 'Terms of Service',
  bodyMd: '# Terms\n\nBy using this bot, you agree to...',
  changelog: 'Initial version',  // Optional
});
```

### Activate Terms

```typescript
await client.projects.activateTerms(termsId);
// Deactivates all other versions for this project
```

**Note:** Only one version can be active at a time. Creating terms doesn't activate them automatically.

---

## Consents

### List Consents

```typescript
const { consents, pagination } = await client.projects.listConsents(projectId, {
  page: 1,           // Default: 1
  limit: 50,         // Default: 50, max: 100
  wallet: 'abc',     // Optional: filter by wallet (partial match)
  version: '1.0.0',  // Optional: filter by terms version
});
// Returns: { consents: SelfServiceConsent[], pagination: SelfServicePagination }
```

### Export Consents (CSV)

```typescript
const csv = await client.projects.exportConsents(projectId);
// Returns raw CSV string
// Columns: wallet_address, accepted_at, version, ip_address, user_agent
// Note: IP addresses are obfuscated for privacy
```

---

## User Profile

### Get User

```typescript
const { user } = await client.user.get();
// Returns: { user: SelfServiceUser }
```

### Update User

```typescript
await client.user.update({
  displayName: 'My Bot',
  feeWalletAddress: '...',     // For fee sharing
  feeDiscountPassToUser: true, // Pass discount to end users
});
```

### Delete Account

```typescript
await client.user.delete();
// Revokes all keys and deletes account
// Session is automatically cleared
```

---

## Usage & Billing

### Get Usage

```typescript
const { usage } = await client.usage.get();
// Returns: SelfServiceUsage with:
// - totalLiveRequests, totalHistoricalQueries
// - liveLimit, historicalLimit
// - livePercentUsed, historicalPercentUsed
// - per-key breakdown
```

### Get Usage History

```typescript
const { history } = await client.usage.getHistory({ days: 30 });
// Returns: { history: SelfServiceUsageHistory[] }
// Each entry: { date, liveRequests, historicalQueries }
```

### Get Usage Snapshots

Get hourly usage data for time-series charts:

```typescript
// Account-level snapshots (all keys)
const { snapshots } = await client.usage.getSnapshots({ hours: 168 }); // 7 days

// Project-level snapshots (keys assigned to project)
const { snapshots } = await client.projects.getUsageSnapshots(projectId, { hours: 168 });
```

Each snapshot contains:
- `hour` — ISO timestamp (hourly granularity)
- `liveRequests` — Number of live API requests
- `historicalQueries` — Number of historical data queries

**Limits:**
- Default: 168 hours (7 days)
- Maximum: 720 hours (30 days)
- Minimum: 1 hour

**Use Cases:**
- Build usage dashboards with charts
- Monitor API consumption trends
- Detect usage anomalies
- Bill customers based on usage

### Get Billing

```typescript
const { currentPlan, subscription } = await client.billing.get();
```

### Get Plans

```typescript
const { plans } = await client.billing.getPlans();
// Returns available plans with pricing and limits
```

### Subscribe

```typescript
const result = await client.billing.subscribe({
  planId: 'pro',
  billingPeriod: 'monthly',  // 'monthly' | '3mo' | '6mo' | '12mo'
  payerWallet: walletAddress,
});

if ('paymentRequired' in result) {
  // Payment needed - build and sign USDC transfer
  const { payment } = result;
  // payment: { amountUsdc, treasuryWallet, usdcMint, ... }
} else {
  // Free plan or already active
  const { subscription } = result;
}
```

### Confirm Payment

```typescript
await client.billing.confirm({
  planId: 'pro',
  billingPeriod: 'monthly',
  txSignature: 'abc123...',
  payerWallet: walletAddress,
});
```

---

## Types

```typescript
interface SelfServiceProject {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  logoUrl: string | null;
  createdAt: string;
}

interface SelfServiceProjectWithStats extends SelfServiceProject {
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

interface SelfServiceTerms {
  id: string;
  version: string;
  title: string;
  bodyMd: string;
  changelog: string | null;
  isActive: boolean;
  activatedAt: string | null;
  createdAt: string;
}

interface SelfServiceConsent {
  id: string;
  walletAddress: string;
  version: string;
  acceptedAt: string;
  ipAddress: string | null;  // Obfuscated for privacy
  userAgent: string | null;
}

interface SelfServicePagination {
  page: number;
  limit: number;
  total: number;
}
```

---

## Error Handling

```typescript
import { SelfServiceError } from '@oredata/sdk';

try {
  await client.projects.delete(projectId);
} catch (e) {
  if (e instanceof SelfServiceError) {
    console.log(`Error: ${e.message}`);
    console.log(`Status: ${e.status}`);
    console.log(`Code: ${e.code}`);  // e.g., 'has_consents', 'project_not_found'
  }
}
```

Common error codes:
- `no_session` - Not authenticated
- `project_not_found` - Project doesn't exist or you don't own it
- `slug_exists` - Project slug already taken
- `has_consents` - Can't delete project with consent records
- `version_exists` - Terms version already exists
- `already_assigned` - Key already assigned to a project

---

## Full Example: Bot with T&C

```typescript
import { SelfServiceClient } from '@oredata/sdk';

async function setupBot(wallet, signMessage) {
  const client = new SelfServiceClient();

  // 1. Authenticate
  const { nonce } = await client.auth.getNonce();
  const message = client.auth.buildSignInMessage(wallet.publicKey.toBase58(), nonce);
  const sig = await signMessage(new TextEncoder().encode(message));
  const signature = base58.encode(sig);

  const { user, apiKey } = await client.auth.register({
    wallet: wallet.publicKey.toBase58(),
    message,
    signature,
  });

  console.log(`Registered! API Key: ${apiKey.key}`);

  // 2. Create project
  const { project } = await client.projects.create({
    name: 'My Trading Bot',
    slug: 'my-trading-bot',
    domain: 'mytradingbot.app',
  });

  // 3. Create and activate terms
  const { terms } = await client.projects.createTerms(project.id, {
    version: '1.0.0',
    title: 'Terms of Service',
    bodyMd: `
# Terms of Service

By using My Trading Bot, you agree to:

1. **Risk Disclosure**: Trading involves risk of loss.
2. **No Guarantees**: Past performance does not guarantee future results.
3. **Data Usage**: We collect wallet addresses for service operation.

Last updated: ${new Date().toISOString().split('T')[0]}
    `.trim(),
  });

  await client.projects.activateTerms(terms.id);

  // 4. Assign API key to project
  await client.keys.assign(apiKey.id, project.id);

  console.log('Bot setup complete!');
  console.log(`Project: ${project.name} (${project.slug})`);
  console.log(`Terms: v${terms.version} - ${terms.title}`);

  // Your users will consent via /v3/consent/* endpoints
  // Check consents for compliance:
  const { consents, pagination } = await client.projects.listConsents(project.id);
  console.log(`Total consents: ${pagination.total}`);

  return { client, project, apiKey };
}
```
