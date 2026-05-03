# CLAUDE.md

Repository-specific guidance for Claude when working in `@metrio-ai/memory-service`.
Read this before making changes. Pair with [`README.md`](README.md) for usage and
[`docs/sync-memory.md`](docs/sync-memory.md) / [`docs/memory-prompt-guide.md`](docs/memory-prompt-guide.md)
for design context.

## Project at a glance

Multi-tenant memory SDK for AI applications. PostgreSQL + pgvector. Published to npm.

- **Runtime:** Node, TypeScript, ESM + CJS via tsup
- **DB:** PostgreSQL with `pgvector` extension, accessed via Drizzle ORM
- **Embeddings:** Pluggable provider (Gemini default, OpenAI optional)
- **LLM extraction:** Pluggable provider (Metrio Console default, custom optional)
- **Tests:** vitest (unit only, no DB integration tests yet)

## Directory map

```
src/
├── index.ts                          public exports
├── memory-service.ts                 MemoryService — primary public API
├── db/
│   ├── index.ts                      Drizzle pool/client factory
│   └── schema/                       tenants, users, memories, profiles
├── services/                         internal — DO NOT export from index
│   ├── memory-store.ts               memories table CRUD + embedding
│   ├── profile-service.ts            user_profiles upsert
│   ├── tenant-*.ts                   tenant notes / memories
│   └── admin-service.ts              admin/inspection helpers
├── providers/
│   ├── embedding/                    gemini, openai
│   └── extraction/                   metrio (LLM extraction + sync)
└── types/index.ts                    all public types

docs/
├── sync-memory.md                    syncMemory() design doc
└── memory-prompt-guide.md            how to write good memory prompts
```

## Two memory APIs (use the new one)

| Method | Status | When |
|---|---|---|
| `MemoryService.syncMemory()` | **Recommended** | All new work. Single LLM call, ADD/UPDATE/DELETE/NOOP ops, sees existing state to dedup. |
| `MemoryService.processConversation()` | Legacy (`@deprecated`) | Existing tenants on the two-prompt flow. Don't add features here. |

Default `allowedOperations` is `['ADD', 'NOOP']`. UPDATE/DELETE require explicit
opt-in per the design doc's phased rollout.

## Critical invariants — don't break these

These were established by the pre-landing review. Defending them is non-negotiable.

1. **LLM output is hostile by default.** All values from the LLM (`importance`,
   `memoryType`, `content`, `id`) flow through bounds validation in
   `metrio.ts:clampImportance` / `truncateMemoryType`. Never bypass.
2. **UPDATE/DELETE only operate on shown IDs.** `MemoryService.applyOperation`
   gates ops on `existingById.has(op.id)`. This is the IDOR defense — even
   a hallucinating LLM cannot mutate memories outside the visible window.
3. **`Promise.allSettled`, never `Promise.all`** in the operation dispatch loop.
   Per-op failure isolation is required so one bad op doesn't kill the batch
   (LINE webhooks retry on rejection → duplicates).
4. **`formatConversation` HTML-escapes user content.** Prevents `</user><assistant>...`
   role-tag injection. Don't emit raw user content into role-tagged prompts.
5. **`tenantSlug` + `userExternalId` resolve to internal `user.id`** before any
   memory query. Never pass external IDs into memory tables directly.

## Common workflows

```bash
pnpm test                 # vitest run (currently 7 tests in metrio.test.ts)
pnpm test:watch           # interactive
pnpm exec tsc --noEmit    # type check (run before claiming "done")
pnpm build                # tsup → dist/
pnpm db:generate          # generate migration after schema change
pnpm db:migrate           # apply migrations
pnpm db:studio            # Drizzle Studio GUI
```

Verification before marking work complete: **always** run `pnpm exec tsc --noEmit && pnpm test`.

## Phase 2 work outstanding (do NOT enable UPDATE/DELETE in production until done)

Tracked in [`docs/sync-memory.md`](docs/sync-memory.md) "Risks & Open Questions":

- DB transaction wrapping (memory ops + summary upsert)
- `pg_advisory_xact_lock` per `user_id` for concurrent webhook safety
- `updated_at` column on `memories` + `getRecent` ordering fix
- `null` vs `""` semantics for `updated_summary` (clear vs no-change)
- `MemoryStore.addMany()` using `embedBatch` for fan-out efficiency
- `MemoryService.syncMemory()` orchestration unit tests (needs DI refactor)

If you find yourself enabling UPDATE/DELETE in `allowedOperations` for a tenant,
verify these are landed first.

## Project conventions

- **Drizzle queries** use `eq` / `and` / `gt` from `drizzle-orm` for parameterization.
  Never string-interpolate into SQL.
- **External IDs** (`tenantSlug`, `userExternalId`) at the public API boundary;
  internal services only see resolved UUIDs.
- **Snake_case ↔ camelCase** at the LLM boundary: prompt I/O is snake_case
  (`memory_type`, `existing_summary`), TypeScript types are camelCase. The
  metrio provider does the translation; do not leak snake_case into types.
- **Don't export internal services** from `src/index.ts`. `MemoryStore`, `ProfileService`,
  etc. should be reachable only via `MemoryService`. (Currently leaking — see Phase 2.)
- **Commits** follow conventional commits style (`feat:`, `fix:`, `chore:`, `docs:`,
  optional scope like `feat(admin):`).

## Coding Guidelines

### 1. Think Before Coding

Don't assume. Don't hide confusion. Surface tradeoffs.

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

Minimum code that solves the problem. Nothing speculative.

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.
- Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

Touch only what you must. Clean up only your own mess.

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

Define success criteria. Loop until verified.

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.
