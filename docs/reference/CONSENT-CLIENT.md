# ConsentClient Reference

Handle Terms & Conditions acceptance for your application's users.

## Quick Start

```typescript
import { OredataClient, ConsentClient, buildConsentMessage } from '@oredata/sdk';
import bs58 from 'bs58';

const http = new OredataClient({ apiKey: process.env.OREDATA_API_KEY });
const consent = new ConsentClient({ http });

// 1. Fetch terms
const terms = await consent.getTerms();

// 2. Check user status
const status = await consent.getStatus(walletAddress);

// 3. If not accepted, get signature
if (status.status !== 'accepted') {
  const msg = buildConsentMessage({
    projectName: terms.project?.name,
    projectDomainOrSlug: terms.project?.domain ?? terms.project?.slug,
    walletAddress,
    version: terms.version,
  });

  const signature = await wallet.signMessage(new TextEncoder().encode(msg.message));

  await consent.accept({
    walletAddress,
    signature: bs58.encode(signature),
    termsVersion: terms.version,
  });
}
```

---

## Constructor

```typescript
import { ConsentClient } from '@oredata/sdk';

const consent = new ConsentClient({
  http: oredataClient, // OredataClient instance with API key
});
```

---

## Methods

### `getTerms(): Promise<ConsentTermsResponse>`

Fetch the current terms of service.

```typescript
const terms = await consent.getTerms();

console.log(terms.version);    // "1.0.0"
console.log(terms.title);      // "Terms of Service"
console.log(terms.bodyMd);     // Markdown content
console.log(terms.project);    // { name, domain, slug, logoUrl }
```

### `getStatus(walletAddress): Promise<ConsentStatusResponse>`

Check if a wallet has accepted the current terms.

```typescript
const status = await consent.getStatus('ABC123...');

console.log(status.status);      // 'accepted' | 'pending' | 'outdated'
console.log(status.acceptedAt);  // ISO timestamp or null
console.log(status.version);     // Accepted version or null
```

**Status meanings:**
- `'accepted'` — User accepted current version
- `'pending'` — User has not accepted any version
- `'outdated'` — User accepted an old version, needs re-consent

### `buildMessage(params): ConsentMessageResult`

Build the message for the user to sign.

```typescript
const msg = consent.buildMessage({
  walletAddress: 'ABC123...',
  version: '1.0.0',
  terms: 'Optional terms text override',
});

console.log(msg.message);    // Full message to sign
console.log(msg.nonce);      // Unique nonce
console.log(msg.issuedAt);   // ISO timestamp
console.log(msg.expiresAt);  // Expiration (5 min)
```

### `accept(input): Promise<ConsentAcceptResponse>`

Submit a signed acceptance.

```typescript
const result = await consent.accept({
  walletAddress: 'ABC123...',
  signature: 'base58-encoded-signature',
  termsVersion: '1.0.0',
  nonce: msg.nonce,          // From buildMessage
  issuedAt: msg.issuedAt,    // From buildMessage
  expiresAt: msg.expiresAt,  // From buildMessage
});

console.log(result.success);     // true
console.log(result.acceptedAt);  // ISO timestamp
```

---

## Helper: buildConsentMessage

Standalone function to build the consent message:

```typescript
import { buildConsentMessage } from '@oredata/sdk';

const msg = buildConsentMessage({
  projectName: 'My Game',
  projectDomainOrSlug: 'mygame.app',
  walletAddress: 'ABC123...',
  version: '1.0.0',
});

// msg.message is ready to sign
```

---

## Full Example: Consent Gate

```typescript
import {
  OredataClient,
  ConsentClient,
  buildConsentMessage,
} from '@oredata/sdk';
import bs58 from 'bs58';

async function ensureConsent(wallet) {
  const http = new OredataClient({ apiKey: process.env.OREDATA_API_KEY });
  const consent = new ConsentClient({ http });

  const walletAddress = wallet.publicKey.toString();

  // 1. Fetch terms
  const terms = await consent.getTerms();

  // 2. Check status
  const status = await consent.getStatus(walletAddress);

  if (status.status === 'accepted') {
    return true; // Already consented
  }

  // 3. Show terms to user and get signature
  const userAgreed = await showTermsDialog(terms.title, terms.bodyMd);
  if (!userAgreed) {
    return false; // User declined
  }

  // 4. Build and sign message
  const msg = buildConsentMessage({
    projectName: terms.project?.name,
    projectDomainOrSlug: terms.project?.domain ?? terms.project?.slug,
    walletAddress,
    version: terms.version,
  });

  const signature = await wallet.signMessage(
    new TextEncoder().encode(msg.message)
  );

  // 5. Submit consent
  await consent.accept({
    walletAddress,
    signature: bs58.encode(signature),
    termsVersion: terms.version,
    nonce: msg.nonce,
    issuedAt: msg.issuedAt,
    expiresAt: msg.expiresAt,
  });

  return true;
}
```

---

## React: ConsentGate Component

```tsx
import { ConsentGate } from '@oredata/sdk/react';

function App() {
  return (
    <OredataProvider config={{ apiKey: '...' }}>
      <WalletProvider>
        <ConsentGate
          onAccepted={() => console.log('User accepted terms')}
          onDeclined={() => console.log('User declined')}
        >
          <GameContent />
        </ConsentGate>
      </WalletProvider>
    </OredataProvider>
  );
}
```

---

## For Platform Operators

If you're building a platform with your own T&C, use `SelfServiceClient` to:
1. Create a project
2. Create terms versions
3. Activate terms
4. Track user consents

See: [Self-Service Reference](./SELF-SERVICE.md)

---

## Related

- [Self-Service (Project T&C)](./SELF-SERVICE.md)
- [OredataClient](./OREDATA-CLIENT.md)
