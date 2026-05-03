# @metrio-ai/memory-service

Multi-tenant Memory Service SDK for AI applications. Provides user memory management, semantic search, and automatic memory extraction via pgvector.

## Installation

```bash
pnpm add @metrio-ai/memory-service
```

## Environment Variables

```bash
# Required
DATABASE_URL=postgresql://user:pass@host:5432/db
GOOGLE_AI_API_KEY=your-gemini-api-key

# Optional (if using Metrio extraction)
METRIO_API_KEY=your-metrio-api-key
```

## Quick Start

```typescript
import { MemoryService } from '@metrio-ai/memory-service';

const memory = new MemoryService({
  databaseUrl: process.env.DATABASE_URL!,
  embedding: {
    provider: 'gemini',
    apiKey: process.env.GOOGLE_AI_API_KEY!
  },
  extraction: {
    provider: 'metrio',
    apiKey: process.env.METRIO_API_KEY!,
    projectId: 'your-project-id',
    extractionPromptId: 1,
    summaryMergerPromptId: 2
  }
});

// Get context before a conversation
const context = await memory.getContext('dog-lab', 'LINE_USER_ID');

// Process conversation and auto-extract memories
await memory.processConversation({
  tenantSlug: 'dog-lab',
  userExternalId: 'LINE_USER_ID',
  conversation: [
    { role: 'user', content: 'I want to sign up my dog for a class' },
    { role: 'assistant', content: 'Sure! How old is your dog?' }
  ]
});

// Semantic search
const results = await memory.search({
  tenantSlug: 'dog-lab',
  userExternalId: 'LINE_USER_ID',
  query: 'order shipping'
});

// Close connection when done
await memory.close();
```

## API

### Core Methods

| Method | Description |
|---|---|
| `getContext(tenant, userId, options?)` | Load context before a conversation (profile, recent memories, org notes/memories) |
| `syncMemory(input)` | **Recommended.** Single-prompt extract + merge with ADD/UPDATE/DELETE/NOOP operations. Sees existing state to dedup. |
| `processConversation(input)` | Legacy two-prompt flow. Extract memories then merge profile. |
| `search(input)` | Semantic search user memories |
| `getRecentMemories(tenant, userId, options?)` | Get recent memories by recency |
| `addMemory(input)` | Directly add a memory |
| `updateProfileSummary(input)` | Update user profile summary |
| `getProfileSummary(tenant, userId)` | Get user profile summary |
| `close()` | Close the database connection pool |

### Sync Memory (recommended)

Single LLM call that sees the user's existing summary plus the most relevant
existing memories, then emits explicit operations. Reduces duplicate memories
and lets the model correct stale ones.

```typescript
const result = await memory.syncMemory({
  tenantSlug: 'dog-lab',
  userExternalId: 'LINE_USER_ID',
  conversation: [
    { role: 'user', content: '我想幫狗狗報名訓練課' },
    { role: 'assistant', content: '好的！您的狗狗幾歲？' },
    { role: 'user', content: '3 歲，柴犬' },
  ],
  options: {
    allowedOperations: ['ADD', 'NOOP'],   // start conservative; widen later
    recentMemoriesContextLimit: 10,
    relevantMemoriesContextLimit: 10,
  },
});

// result.operations  → audit trail of what the LLM decided
// result.added       → MemoryRecord[] inserted
// result.updated     → MemoryRecord[] modified
// result.deleted     → string[] of deleted memory ids
// result.failures    → SyncMemoryFailure[] ops that threw (allSettled isolates per-op failure)
// result.summary     → ProfileSummary | null (updated only if summary actually changed)
```

Requires `memoryUpdatePromptId` in the extraction config — see
[`docs/sync-memory.md`](docs/sync-memory.md) for the prompt I/O contract,
phased rollout plan, and design rationale.

For prompt-author guidance (how to actually write a good memory prompt — taxonomy,
worked examples, common pitfalls, quality rubric, copy-pasteable starter template)
see [`docs/memory-prompt-guide.md`](docs/memory-prompt-guide.md).

### Context

```typescript
const context = await memory.getContext('dog-lab', 'LINE_USER_ID', {
  recentLimit: 3,
  includeOrgNotes: true,
  orgNoteCategories: ['product', 'policy'],
  includeOrgMemories: true,
  orgMemoryTypes: ['learned', 'pattern']
});

// context.formatted contains:
// 【組織資訊】 - org notes
// 【組織知識】 - org memories
// 【客戶檔案】 - user profile summary
// 【最近互動】 - recent memories
```

### Tenant Notes

Store organization-level information (products, policies, FAQs):

```typescript
await memory.tenants.notes.add('dog-lab', {
  category: 'product',
  title: 'Basic Obedience Course',
  content: 'Price: NT$ 8,000 (8 sessions)...',
  tags: ['course', 'pricing']
});

await memory.tenants.notes.search('dog-lab', { query: 'course pricing' });
await memory.tenants.notes.getByCategory('dog-lab', 'product');
```

Categories: `product`, `policy`, `faq`, `announcement`, `custom`

### Tenant Memories

Store organization knowledge learned from conversations:

```typescript
await memory.tenants.memories.add('dog-lab', {
  content: 'Shiba Inu training requires more patience',
  type: 'learned',
  importance: 7
});

await memory.tenants.memories.promoteFromUser('dog-lab', {
  sourceMemoryId: 'user-memory-id',
  content: 'Saturday afternoon classes are most popular',
  type: 'pattern'
});
```

Types: `learned`, `feedback`, `pattern`, `exception`

### Admin API

Manage and inspect data via `memory.admin.*`:

```typescript
// List all tenants
const tenants = await memory.admin.listTenants();

// List users under a tenant (with pagination, includes profile summary)
const users = await memory.admin.listUsers('dog-lab');
// Returns: { data: AdminUserRecord[], pagination: { page, limit, total, totalPages } }
// AdminUserRecord includes: id, tenantId, externalId, displayName, metadata, createdAt, updatedAt, summary

// List users with pagination options
const paginatedUsers = await memory.admin.listUsers('dog-lab', { limit: 20, page: 2 });

// List users sorted by most recent memory activity
const activeUsers = await memory.admin.listUsers('dog-lab', { orderByLastUpdated: 'desc', limit: 10, page: 1 });

// Semantic search across all users in a tenant
const results = await memory.admin.searchMemories('dog-lab', 'dog training', {
  limit: 10,
  threshold: 0.3
});
// → AdminSearchResult[] includes userId, userExternalId, content, similarity

// List user memories (includes rawConversation)
const memories = await memory.admin.listUserMemories('dog-lab', 'LINE_USER_ID');

// List org notes and memories
const notes = await memory.admin.listTenantNotes('dog-lab');
const orgMemories = await memory.admin.listTenantMemories('dog-lab');

// Purge (irreversible hard delete)
await memory.admin.purgeUserMemories('dog-lab', 'LINE_USER_ID');  // memories only
await memory.admin.purgeUserProfile('dog-lab', 'LINE_USER_ID');   // profile only
await memory.admin.purgeUserAll('dog-lab', 'LINE_USER_ID');       // memories + profile
await memory.admin.purgeTenantNotes('dog-lab');
await memory.admin.purgeTenantMemories('dog-lab');

// Delete user (cascades to memories and profile)
await memory.admin.deleteUser('dog-lab', 'LINE_USER_ID');
```

### `context.formatted` vs `getProfileSummary()`

`getContext()` returns a `ContextResult` with a pre-built `formatted` string combining all four sections (org notes, org memories, user profile, recent memories) — designed to be injected directly into an LLM system prompt.

`getProfileSummary()` returns only the user's profile summary (the 【客戶檔案】 portion), useful for displaying or editing in a dashboard.

## Configuration

```typescript
interface MemoryServiceConfig {
  databaseUrl: string;

  embedding: {
    provider: 'gemini' | 'openai';
    apiKey: string;
    model?: string; // default: gemini-embedding-001 (gemini), text-embedding-3-large (openai)
  };

  extraction?: {
    provider: 'metrio' | 'custom';
    apiKey?: string;
    projectId?: string;
    extractionPromptId?: number;     // legacy processConversation
    summaryMergerPromptId?: number;  // legacy processConversation
    memoryUpdatePromptId?: number;   // syncMemory (recommended)
    baseUrl?: string;
    customExtractor?: ExtractionProvider;
  };
}
```

## Database Setup

This SDK uses PostgreSQL with pgvector. Run migrations to set up the schema:

```bash
# Set DATABASE_URL in .env
cp .env.example .env

# Run migrations
pnpm db:migrate
```

### Tables

| Table | Description |
|---|---|
| `tenants` | Multi-tenant isolation |
| `tenant_notes` | Organization notes (products, policies, FAQs) |
| `tenant_memories` | Organization knowledge from conversations |
| `users` | Users scoped to tenants via external ID |
| `user_profiles` | User profile summaries with embeddings |
| `memories` | User conversation memories with embeddings |

## Development

```bash
pnpm install
pnpm build          # Build with tsup
pnpm test           # Run tests with vitest
pnpm db:generate    # Generate new migration after schema changes
pnpm db:migrate     # Apply migrations
pnpm db:studio      # Open Drizzle Studio GUI
```

## License

ISC
