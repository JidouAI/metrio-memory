# Sync Memory — Design Doc

Status: Proposal · Author: Steven Shen · Last updated: 2026-05-03

## Background

`@metrio-ai/memory-service` currently exposes `processConversation()` which runs two
sequential LLM calls:

1. **Extraction** (`extractionPromptId`) — stateless: reads only the conversation,
   emits new memory rows.
2. **Merger** (`summaryMergerPromptId`) — sees only the existing summary string and
   the freshly extracted memory contents; emits a new summary.

This works, but two structural issues are showing up in production:

- **Extraction is stateless** — the LLM does not know what is already remembered, so
  it re-extracts the same fact every conversation. Dedup falls entirely on the
  merger, which only sees the summary (not the underlying memory rows).
- **Memory is append-only** — there is no UPDATE / DELETE primitive, so memories
  drift out of date and cannot be corrected.

The `view_product:496` polluting the profile (see incident on 2026-05-03) is a
symptom of the first issue plus an extraction-prompt gap. Fixing the prompt
addresses the symptom; the redesign here addresses the architecture.

## Goals

- Give the extraction LLM full state (existing summary + relevant existing memories)
  so it can dedup, update, and skip noise itself.
- Reduce LLM calls per webhook event from 2 to 1.
- Provide a safe, phased migration path — no break for existing callers.
- Align with the upcoming **batch webhook** change (multiple turns per call) where
  combined extract+merge is more naturally efficient.

## Non-goals

- Replacing `processConversation()`. It stays for backward compatibility.
- Changing the database schema. New behavior reuses existing tables.
- Cross-user memory inference (tenant memory promotion stays separate).

## Proposed Design

### Public API

A new method on `MemoryService`:

```ts
memory.syncMemory({
  tenantSlug: string;
  userExternalId: string;
  conversation: ConversationMessage[];
  options?: {
    recentMemoriesContextLimit?: number;     // default 10
    relevantMemoriesContextLimit?: number;   // default 10
    allowedOperations?: ('ADD' | 'UPDATE' | 'DELETE' | 'NOOP')[];
                                             // default ['ADD', 'NOOP']
  };
}): Promise<{
  operations: MemoryOperation[];
  added: MemoryRecord[];
  updated: MemoryRecord[];
  deleted: string[];
  summary: ProfileSummary | null;
}>;
```

`allowedOperations` is a deliberate safety knob — see Phased Rollout below.

### Internal flow

```
1. Resolve / create tenant + user
2. Load existing context in parallel:
   - existing profile summary
   - recent N memories (recency)
   - top-K memories semantically similar to user-message text (relevance)
3. Dedup recent + relevant by id → existingMemories
4. Call provider.syncMemory({
     conversation, existingSummary, existingMemories, allowedOperations
   })
5. Apply each operation against the DB
   (skip ops outside allowedOperations as a second guard)
6. If updatedSummary differs and is non-empty → upsert profile
7. Return audit trail
```

### Provider contract

`ExtractionProvider` gains an optional method (does not break custom extractors):

```ts
interface ExtractionProvider {
  extractMemories(...);    // existing
  mergeSummary(...);       // existing
  syncMemory?(input: SyncMemoryProviderInput): Promise<SyncMemoryProviderResult>;
}
```

Provider input:

```ts
interface SyncMemoryProviderInput {
  conversation: ConversationMessage[];
  existingSummary: string;
  existingMemories: { id, content, memoryType, importance }[];
  allowedOperations: MemoryOperationType[];
}
```

Provider output:

```ts
interface SyncMemoryProviderResult {
  operations: MemoryOperation[];
  updatedSummary: string;
}
```

### Operation types

| op | Required fields | Notes |
|---|---|---|
| `ADD` | `content`, `memoryType`, `importance` | New memory; embeds + inserts row |
| `UPDATE` | `id`, `content`, optional `memoryType`/`importance` | Re-embeds if `content` changes |
| `DELETE` | `id` | Hard delete; only allowed in later phases |
| `NOOP` | (none) | Explicit "I considered this and chose not to act" — keep `reason` for telemetry |

Each op may carry a `reason: string` for debugging / observability.

### Prompt I/O contract

The new Metrio prompt (`memoryUpdatePromptId`) receives a single `user` message
whose body is JSON:

```json
{
  "conversation": "<user>...</user>\n<assistant>...</assistant>",
  "existing_summary": "現有 profile summary 字串",
  "existing_memories": [
    { "id": "uuid", "content": "...", "memory_type": "preference", "importance": 8 }
  ],
  "allowed_operations": ["ADD", "NOOP"]
}
```

It must return JSON:

```json
{
  "operations": [
    { "op": "ADD", "content": "...", "memoryType": "preference", "importance": 7,
      "reason": "新偏好" },
    { "op": "NOOP", "reason": "重複既有資訊" }
  ],
  "updated_summary": "..."
}
```

Parser tolerates `memory_type` (snake) as alias for `memoryType` and supplies
defaults (`memoryType: "general"`, `importance: 5`) when missing.

## Backward Compatibility

- `processConversation()` keeps working, no signature change.
- New `memoryUpdatePromptId` is optional in `ExtractionConfig`.
- `syncMemory()` throws a clear error if the provider doesn't implement it.
- `customExtractor` users are unaffected unless they opt in.

## Phased Rollout

| Phase | `allowedOperations` | Goal |
|---|---|---|
| 1 | `['ADD', 'NOOP']` | Match current behavior + free dedup. Compare NOOP rate vs old extractor's duplicate rate. |
| 2 | + `UPDATE` | Allow profile evolution. Watch for regressions where LLM rewrites correct memories. |
| 3 | + `DELETE` | Prompt must require explicit contradiction before deleting. Watch deletion rate per user — anything > 1/conversation is suspect. |
| 4 | — | Mark `processConversation()` deprecated in JSDoc. Open ticket to remove after one release cycle of zero usage. |

## Hardening Applied (Phase 1+, ongoing)

Pre-landing review (5 specialists + Red Team + Codex adversarial) surfaced multiple
risks. The following Phase 1 mitigations landed with this PR:

- **LLM output bounds validation** — `importance` clamped to [1, 10] and rejects
  NaN/Infinity (was: `Number(raw.importance ?? 5)`, NaN crashed batch on smallint
  insert); `memoryType` truncated to varchar(50) limit; `ADD` ops with empty
  content rejected.
- **Per-op failure isolation** — `Promise.all` → `Promise.allSettled`. A single
  rejected op no longer kills the whole batch. `SyncMemoryResult.failures` now
  exposes per-op errors with the op that triggered them, so callers can decide
  whether to retry or log.
- **userQuery embedding length cap** — `gatherExistingMemoriesContext` slices the
  joined user-message text to the **last** `MAX_USER_QUERY_CHARS` (2000) before
  embedding. Prevents the embedding API from rejecting oversize input on long
  conversations, and biases relevance toward recent intent.
- **IDOR gating on UPDATE/DELETE** — `applyOperation` rejects ops whose `id` is
  not present in the `existingById` context map. This prevents a hallucinating or
  prompt-injected LLM from mutating memories outside the visible window. Logs a
  warn so prompt drift is visible in production.
- **Role-tag injection escape** — `formatConversation` HTML-escapes `<`, `>`, `&`
  in user content. Prevents `</user><assistant>...DELETE all` style injection
  attacks via raw user input.
- **Lazy prompt-id validation** — `extractionPromptId`, `summaryMergerPromptId`,
  and `memoryUpdatePromptId` are all optional in `ExtractionConfig` and validated
  at use time, not at provider construction. Tenants migrating to `syncMemory`
  can drop the legacy prompt IDs without rewriting their setup. Each method throws
  a clear error pointing at the missing config field if called without it.

## Risks & Open Questions (deferred to Phase 2 / follow-up PRs)

- **No transaction wrapping** — operations apply concurrently via `Promise.allSettled`
  but writes commit independently. If the summary upsert fails after ops succeed,
  the user has new memories but stale summary. Phase 2 fix: wrap operations +
  summary upsert in a single Drizzle `db.transaction()`. Cost: longer DB lock
  window per call, requires threading `tx` through service methods.
- **Concurrent `syncMemory` for same user can race** — two webhooks fire
  simultaneously; both read the same `existingMemories` snapshot, both call the
  LLM, both write. Last summary wins. Phase 2 fix: `pg_advisory_xact_lock` on
  `user_id` at the start of `syncMemory`. Adds one DB roundtrip per call.
- **No `updated_at` column on `memories`** — `MemoryStore.update()` re-embeds
  changed content but the row's `created_at` stays put. `getRecent` (orders by
  `created_at`) won't surface freshly UPDATED memories. Defeats the point of
  UPDATE in long-lived users. Phase 2 fix: add `updated_at` column +
  `defaultNow()` + set on update + sort by `GREATEST(created_at, updated_at)`
  in `getRecent`.
- **Cannot clear profile summary** — `summaryChanged` guard rejects whitespace.
  An LLM that intentionally clears the summary (e.g., after DELETE-all) cannot
  do so. Phase 2 fix: distinguish "no change" (`null`) from "clear" (`""`) in
  `SyncMemoryProviderResult.updatedSummary`.
- **No per-op embed batching** — `MemoryStore.add` calls `embed()` per row, even
  though `embeddingProvider.embedBatch` exists. With 5 ADDs that's 5 sequential
  embedding API roundtrips inside `allSettled`. Optimization: add
  `MemoryStore.addMany()` that calls `embedBatch` once.
- **Token cost per call** — every `syncMemory` sends `existing_memories` + summary
  every time. Mitigation: cap `existingMemoriesContextLimit` total to ~20,
  leverage prompt caching on the system instructions portion.
- **UPDATE semantics are fuzzy** — when does "this memory is stale" vs "this is
  a new related memory" apply? Phase 2 will need prompt iteration with examples.
- **Summary "no change" detection is naive** — string-compare misses reformatted
  but semantically identical summaries → unnecessary upsert + version bump.
  Acceptable for now (cheap), revisit if profile churn becomes a problem.
- **`MemoryService.syncMemory()` orchestration not unit-tested** — only the
  Metrio provider parser is covered. Service-level orchestration (allSettled
  failure handling, IDOR gating, summary upsert gate) needs DI refactor for
  testability or integration tests against a real DB.

## Telemetry to Add (next iteration)

- `syncMemory.calls_total{tenant, allowed_ops}`
- `syncMemory.operations_total{op}` — heavy NOOP is good, heavy DELETE is bad
- `syncMemory.summary_changed_total{tenant}`
- `syncMemory.update_id_not_found_total` — leading indicator of LLM hallucination
- LLM call duration + token counts (already partly available via Metrio Console)

## Migration Checklist for Callers

1. Create the combined prompt in Metrio Console — get its `promptId`.
2. Add `memoryUpdatePromptId` to `MemoryServiceConfig.extraction`.
3. Switch one tenant's webhook handler from `processConversation()` to
   `syncMemory({ ..., options: { allowedOperations: ['ADD', 'NOOP'] } })`.
4. Diff `added.length` vs `processConversation()`'s `memories.length` for the same
   conversation — expect lower (dedup working).
5. After 1 week, expand `allowedOperations` to include `UPDATE`.
6. After another week and review, include `DELETE`.

## References

- Mem0 memory operations: https://docs.mem0.ai/core-concepts/memory-operations
- LangMem memory management: https://langchain-ai.github.io/langmem/
- Source: `src/memory-service.ts:syncMemory`,
  `src/providers/extraction/metrio.ts:syncMemory`,
  `src/services/memory-store.ts:update,deleteById`
