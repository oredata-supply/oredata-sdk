# ChatClient

Access the ore.supply community chat via the OreData API.

## Installation

```bash
npm install @oredata/sdk
```

## Quick Start

```typescript
import { ChatClient } from '@oredata/sdk';

const chat = new ChatClient({ apiKey: 'ore_...' });

// Listen for messages
chat.on('message', (msg) => {
  console.log(`${msg.username}: ${msg.text}`);
});

// Connect to real-time stream
chat.connect();
```

## Features

- **Real-time messages** via SSE with automatic reconnect
- **Message history** via REST endpoint with pagination
- **Send messages** (requires wallet signature)
- **Eligibility checks** (must have mined in last 30 days)

---

## API Reference

### Constructor

```typescript
const chat = new ChatClient(options?: ChatClientOptions);
```

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiBaseUrl` | `string` | `https://api.oredata.supply` | API base URL |
| `apiKey` | `string` | - | API key (optional for reading) |
| `autoReconnect` | `boolean` | `true` | Auto-reconnect on disconnect |
| `reconnectDelayMs` | `number` | `5000` | Reconnect delay |

---

### Events

```typescript
interface ChatClientEvents {
  message: (message: ChatMessage) => void;
  history: (messages: ChatMessage[]) => void;
  connected: () => void;
  disconnected: () => void;
  error: (error: Error) => void;
}
```

**ChatMessage:**

```typescript
interface ChatMessage {
  id: number;
  authority: string;       // Sender's wallet
  username: string;
  text: string;
  ts: number;              // Unix timestamp (seconds)
  profilePhotoUrl: string | null;
  role: string | null;
  receivedAt: number;      // When we received it (ms)
}
```

---

### Real-Time Connection

#### `connect()`

Connect to the SSE stream.

```typescript
chat.connect();

// Events will fire:
chat.on('connected', () => console.log('Connected!'));
chat.on('message', (msg) => console.log(msg.text));
chat.on('history', (msgs) => console.log(`Loaded ${msgs.length} messages`));
```

#### `disconnect()`

Disconnect from the stream.

```typescript
chat.disconnect();
```

#### `connected`

Check connection status.

```typescript
if (chat.connected) {
  console.log('Currently connected');
}
```

---

### Message History

#### `fetchHistory(options?)`

Fetch chat history with pagination.

```typescript
const { messages, hasMore } = await chat.fetchHistory({
  limit: 50,              // Max messages (default: 50, max: 200)
  before: 1703123456,     // Get messages before this timestamp
  after: 1703123456,      // Get messages after this timestamp
  since: 12345,           // Get messages with id > since
  authority: 'ABC123...', // Filter by wallet
});
```

**Returns: `ChatHistoryResponse`**

```typescript
interface ChatHistoryResponse {
  enabled: boolean;
  messages: ChatMessage[];
  hasMore?: boolean;
  oldestTimestamp?: number;
  newestTimestamp?: number;
  lastId: number | null;
  count: number;
}
```

**Pagination Example:**

```typescript
// Initial load
const { messages, hasMore, oldestTimestamp } = await chat.fetchHistory({ limit: 50 });

// Load older messages (infinite scroll)
if (hasMore) {
  const older = await chat.fetchHistory({
    limit: 50,
    before: oldestTimestamp,
  });
}
```

---

### Sending Messages

#### `send(text, wallet)`

Send a message using a wallet. Handles authentication automatically.

```typescript
const result = await chat.send('Hello everyone!', wallet);

if (result.success) {
  console.log('Message sent!');
} else {
  console.error(result.error);
  // Possible codes: 'not_eligible', 'rate_limited', 'invalid_jwt', 'send_failed'
}
```

**Wallet Interface:**

```typescript
interface ChatWalletSigner {
  publicKey: { toBase58(): string } | string;
  signMessage(message: Uint8Array): Promise<Uint8Array>;
}
```

Works with `@solana/wallet-adapter-react`:

```typescript
import { useWallet } from '@solana/wallet-adapter-react';

const { publicKey, signMessage } = useWallet();
const wallet = { publicKey, signMessage };

await chat.send('Hello!', wallet);
```

#### `sendMessage(request)`

Send with a pre-created JWT (advanced).

```typescript
const result = await chat.sendMessage({
  text: 'Hello!',
  jwt: 'ore-bsm-jwt-here',
});
```

---

### Authentication

ore.supply chat requires authentication via ore-bsm. The `send()` method handles this automatically, but you can also manage sessions manually.

#### `createSession(request)`

Create a chat session by authenticating with ore-bsm.

```typescript
import { createChatAuth, ChatClient } from '@oredata/sdk';

const chat = new ChatClient();

// Create auth request (wallet signs)
const auth = await createChatAuth(wallet);

// Create session (API authenticates with ore-bsm)
const session = await chat.createSession(auth);

if (session.success) {
  // session.jwt is ore-bsm's JWT
  await chat.sendMessage({ text: 'Hello!', jwt: session.jwt! });
}
```

#### `getSession(authority)`

Check for cached session (no signature required).

```typescript
const session = await chat.getSession(wallet.publicKey.toBase58());

if (session.success && session.jwt) {
  // Reuse cached JWT
} else {
  // Need to create new session
}
```

#### `clearSession(authority)` / `clearAllSessions()`

Clear cached sessions.

```typescript
chat.clearSession('ABC123...');
chat.clearAllSessions();
```

---

### Eligibility

#### `isEligible(authority)`

Check if a wallet can chat (requires mining in last 30 days).

```typescript
const { eligible } = await chat.isEligible(wallet.publicKey.toBase58());

if (eligible) {
  // Show chat input
} else {
  // Show "Mine to unlock chat" message
}
```

---

### Status

#### `getStatus()`

Get chat relay status.

```typescript
const status = await chat.getStatus();
console.log(`Connected: ${status.connected}`);
console.log(`Message count: ${status.messageCount}`);
console.log(`SSE subscribers: ${status.sseSubscribers}`);
```

#### `getMinersStats()`

Get known miners statistics.

```typescript
const stats = await chat.getMinersStats();
console.log(`Total miners: ${stats.total}`);
console.log(`Active in 24h: ${stats.activeIn24Hours}`);
```

---

## Use Cases

### Chat Widget

```typescript
import { ChatClient } from '@oredata/sdk';
import { useState, useEffect } from 'react';

function ChatWidget() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const chat = useMemo(() => new ChatClient({ apiKey }), []);

  useEffect(() => {
    // Load history first
    chat.fetchHistory({ limit: 50 }).then(({ messages }) => {
      setMessages(messages);
    });

    // Then subscribe to new messages
    chat.on('message', (msg) => {
      setMessages(prev => [...prev, msg]);
    });

    chat.connect();

    return () => chat.disconnect();
  }, []);

  return (
    <div>
      {messages.map(msg => (
        <div key={msg.id}>
          <strong>{msg.username}:</strong> {msg.text}
        </div>
      ))}
    </div>
  );
}
```

### Bot Integration

```typescript
import { ChatClient } from '@oredata/sdk';

const chat = new ChatClient({ apiKey: 'ore_...' });

// Monitor for mentions
chat.on('message', async (msg) => {
  if (msg.text.includes('@mybot')) {
    // Respond (requires wallet)
    await chat.send(`Hi ${msg.username}!`, botWallet);
  }
});

chat.connect();
```

---

## Related

- [CLIENTS.md](./CLIENTS.md) - SDK capabilities overview
- [ChatClient source](../src/chat-client.ts)
