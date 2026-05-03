import { createDb } from './db';
import type { Pool } from 'pg';
import { createEmbeddingProvider } from './providers/embedding';
import { createExtractionProvider } from './providers/extraction';
import { TenantService } from './services/tenant-service';
import { UserService } from './services/user-service';
import { ProfileService } from './services/profile-service';
import { MemoryStore } from './services/memory-store';
import { TenantNoteService } from './services/tenant-note-service';
import { TenantMemoryService } from './services/tenant-memory-service';
import { AdminService } from './services/admin-service';
import type {
  MemoryServiceConfig,
  EmbeddingProvider,
  ExtractionProvider,
  GetContextOptions,
  ContextResult,
  ConversationMessage,
  ProcessConversationInput,
  SearchInput,
  SearchResult,
  AddMemoryInput,
  UpdateProfileSummaryInput,
  ProfileSummary,
  MemoryRecord,
  AddTenantNoteInput,
  SearchTenantNotesInput,
  TenantNoteRecord,
  AddTenantMemoryInput,
  PromoteFromUserInput,
  TenantMemoryRecord,
  AdminMemoryRecord,
  AdminTenantNoteRecord,
  AdminTenantRecord,
  AdminUserRecord,
  AdminSearchResult,
  PaginatedResult,
  SyncMemoryInput,
  SyncMemoryResult,
  SyncMemoryFailure,
  ExistingMemoryContext,
  MemoryOperation,
  MemoryOperationType,
} from './types';

const DEFAULT_RECENT_MEMORIES_LIMIT = 10;
const DEFAULT_RELEVANT_MEMORIES_LIMIT = 10;
const DEFAULT_RELEVANT_SEARCH_THRESHOLD = 0.5;
const DEFAULT_ALLOWED_OPERATIONS: MemoryOperationType[] = ['ADD', 'NOOP'];
const MAX_USER_QUERY_CHARS = 2000;

export class MemoryService {
  private pool: Pool;
  private embeddingProvider: EmbeddingProvider;
  private extractionProvider: ExtractionProvider | null;
  private tenantService: TenantService;
  private userService: UserService;
  private profileService: ProfileService;
  private memoryStore: MemoryStore;
  private tenantNoteService: TenantNoteService;
  private tenantMemoryService: TenantMemoryService;
  private adminService: AdminService;

  public readonly tenants: {
    notes: {
      add: (slug: string, input: AddTenantNoteInput) => Promise<TenantNoteRecord>;
      search: (slug: string, input: SearchTenantNotesInput) => Promise<(TenantNoteRecord & { similarity: number })[]>;
      getByCategory: (slug: string, category: string) => Promise<TenantNoteRecord[]>;
    };
    memories: {
      add: (slug: string, input: AddTenantMemoryInput) => Promise<TenantMemoryRecord>;
      promoteFromUser: (slug: string, input: PromoteFromUserInput) => Promise<TenantMemoryRecord>;
      search: (slug: string, input: { query: string; limit?: number; type?: string }) => Promise<(TenantMemoryRecord & { similarity: number })[]>;
    };
  };

  public readonly admin: {
    listTenants: () => Promise<AdminTenantRecord[]>;
    listUsers: (slug: string, options?: { orderByLastUpdated?: 'asc' | 'desc'; limit?: number; page?: number }) => Promise<PaginatedResult<AdminUserRecord>>;
    searchMemories: (slug: string, query: string, options?: { limit?: number; threshold?: number }) => Promise<AdminSearchResult[]>;
    listUserMemories: (slug: string, userExternalId: string) => Promise<AdminMemoryRecord[]>;
    listTenantNotes: (slug: string) => Promise<AdminTenantNoteRecord[]>;
    listTenantMemories: (slug: string) => Promise<TenantMemoryRecord[]>;
    purgeUserMemories: (slug: string, userExternalId: string) => Promise<{ deletedCount: number }>;
    purgeUserProfile: (slug: string, userExternalId: string) => Promise<{ deleted: boolean }>;
    purgeUserAll: (slug: string, userExternalId: string) => Promise<{ memoriesDeleted: number; profileDeleted: boolean }>;
    purgeTenantNotes: (slug: string) => Promise<{ deletedCount: number }>;
    purgeTenantMemories: (slug: string) => Promise<{ deletedCount: number }>;
    deleteUser: (slug: string, userExternalId: string) => Promise<{ deleted: boolean }>;
  };

  constructor(config: MemoryServiceConfig) {
    const { db, pool } = createDb(config.databaseUrl);
    this.pool = pool;
    this.embeddingProvider = createEmbeddingProvider(config.embedding);
    this.extractionProvider = config.extraction
      ? createExtractionProvider(config.extraction)
      : null;

    this.tenantService = new TenantService(db);
    this.userService = new UserService(db);
    this.profileService = new ProfileService(db, this.embeddingProvider);
    this.memoryStore = new MemoryStore(db, this.embeddingProvider);
    this.tenantNoteService = new TenantNoteService(db, this.embeddingProvider);
    this.tenantMemoryService = new TenantMemoryService(db, this.embeddingProvider);
    this.adminService = new AdminService(db, this.embeddingProvider);

    this.tenants = {
      notes: {
        add: async (slug, input) => {
          const tenant = await this.tenantService.getOrCreate(slug);
          return this.tenantNoteService.add(tenant.id, input);
        },
        search: async (slug, input) => {
          const tenant = await this.tenantService.getOrCreate(slug);
          return this.tenantNoteService.search(tenant.id, input);
        },
        getByCategory: async (slug, category) => {
          const tenant = await this.tenantService.getOrCreate(slug);
          return this.tenantNoteService.getByCategory(tenant.id, category);
        },
      },
      memories: {
        add: async (slug, input) => {
          const tenant = await this.tenantService.getOrCreate(slug);
          return this.tenantMemoryService.add(tenant.id, input);
        },
        promoteFromUser: async (slug, input) => {
          const tenant = await this.tenantService.getOrCreate(slug);
          return this.tenantMemoryService.promoteFromUser(tenant.id, input);
        },
        search: async (slug, input) => {
          const tenant = await this.tenantService.getOrCreate(slug);
          return this.tenantMemoryService.search(tenant.id, input);
        },
      },
    };

    this.admin = {
      listTenants: async () => {
        return this.adminService.listTenants();
      },
      listUsers: async (slug, options) => {
        const tenant = await this.tenantService.getBySlug(slug);
        if (!tenant) {
          return {
            data: [],
            pagination: { page: options?.page ?? 1, limit: options?.limit ?? 20, total: 0, totalPages: 0 },
          };
        }
        return this.adminService.listUsers(tenant.id, options);
      },
      searchMemories: async (slug, query, options) => {
        const tenant = await this.tenantService.getBySlug(slug);
        if (!tenant) return [];
        return this.adminService.searchMemories(tenant.id, query, options);
      },
      listUserMemories: async (slug, userExternalId) => {
        const resolved = await this.findExisting(slug, userExternalId);
        if (!resolved) return [];
        return this.adminService.listUserMemories(resolved.user.id);
      },
      listTenantNotes: async (slug) => {
        const tenant = await this.tenantService.getBySlug(slug);
        if (!tenant) return [];
        return this.adminService.listTenantNotes(tenant.id);
      },
      listTenantMemories: async (slug) => {
        const tenant = await this.tenantService.getBySlug(slug);
        if (!tenant) return [];
        return this.adminService.listTenantMemories(tenant.id);
      },
      purgeUserMemories: async (slug, userExternalId) => {
        const resolved = await this.findExisting(slug, userExternalId);
        if (!resolved) return { deletedCount: 0 };
        return this.adminService.purgeUserMemories(resolved.user.id);
      },
      purgeUserProfile: async (slug, userExternalId) => {
        const resolved = await this.findExisting(slug, userExternalId);
        if (!resolved) return { deleted: false };
        return this.adminService.purgeUserProfile(resolved.user.id);
      },
      purgeUserAll: async (slug, userExternalId) => {
        const resolved = await this.findExisting(slug, userExternalId);
        if (!resolved) return { memoriesDeleted: 0, profileDeleted: false };
        return this.adminService.purgeUserAll(resolved.user.id);
      },
      purgeTenantNotes: async (slug) => {
        const tenant = await this.tenantService.getBySlug(slug);
        if (!tenant) return { deletedCount: 0 };
        return this.adminService.purgeTenantNotes(tenant.id);
      },
      purgeTenantMemories: async (slug) => {
        const tenant = await this.tenantService.getBySlug(slug);
        if (!tenant) return { deletedCount: 0 };
        return this.adminService.purgeTenantMemories(tenant.id);
      },
      deleteUser: async (slug, userExternalId) => {
        const resolved = await this.findExisting(slug, userExternalId);
        if (!resolved) return { deleted: false };
        return this.adminService.deleteUser(resolved.user.id);
      },
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async getContext(
    tenantSlug: string,
    userExternalId: string,
    options?: GetContextOptions,
  ): Promise<ContextResult> {
    const { tenant, user } = await this.resolveOrCreate(tenantSlug, userExternalId);

    const [profile, recentMemories, orgNotes, orgMemories] = await Promise.all([
      this.profileService.get(user.id),
      this.memoryStore.getRecent(user.id, options?.recentLimit ?? 3),
      options?.includeOrgNotes
        ? this.tenantNoteService.getAll(tenant.id).then((notes) =>
            options.orgNoteCategories
              ? notes.filter((n) => options.orgNoteCategories!.includes(n.category))
              : notes,
          )
        : Promise.resolve([]),
      options?.includeOrgMemories
        ? this.tenantMemoryService.getAll(tenant.id, options.orgMemoryTypes)
        : Promise.resolve([]),
    ]);

    const formatted = this.formatContext(profile, recentMemories, orgNotes, orgMemories);
    return { profile, recentMemories, orgNotes, orgMemories, formatted };
  }

  /** @deprecated Use {@link MemoryService.syncMemory} instead. Legacy two-prompt flow kept for backward compatibility. */
  async processConversation(input: ProcessConversationInput): Promise<{
    memories: MemoryRecord[];
    profileUpdated: boolean;
  }> {
    if (!this.extractionProvider) {
      throw new Error('Extraction provider is required for processConversation');
    }

    const { user } = await this.resolveOrCreate(input.tenantSlug, input.userExternalId);
    const extracted = await this.extractionProvider.extractMemories(input.conversation);

    const savedMemories: MemoryRecord[] = [];
    for (const mem of extracted.memories) {
      const saved = await this.memoryStore.add({
        userId: user.id,
        content: mem.content,
        memoryType: mem.memoryType,
        importance: mem.importance,
        rawConversation: input.conversation,
      });
      savedMemories.push(saved);
    }

    let profileUpdated = false;
    if (savedMemories.length > 0) {
      const existingProfile = await this.profileService.get(user.id);
      const newSummary = await this.extractionProvider.mergeSummary(
        existingProfile?.summary ?? '',
        savedMemories.map((m) => m.content),
      );
      await this.profileService.upsert(user.id, newSummary);
      profileUpdated = true;
    }

    return { memories: savedMemories, profileUpdated };
  }

  async syncMemory(input: SyncMemoryInput): Promise<SyncMemoryResult> {
    if (!this.extractionProvider) {
      throw new Error('Extraction provider is required for syncMemory');
    }
    if (!this.extractionProvider.syncMemory) {
      throw new Error(
        'Configured extraction provider does not implement syncMemory. Set memoryUpdatePromptId for the metrio provider, or implement syncMemory on your custom extractor.',
      );
    }

    const allowedOperations: MemoryOperationType[] =
      input.options?.allowedOperations ?? DEFAULT_ALLOWED_OPERATIONS;
    const recentLimit = input.options?.recentMemoriesContextLimit ?? DEFAULT_RECENT_MEMORIES_LIMIT;
    const relevantLimit = input.options?.relevantMemoriesContextLimit ?? DEFAULT_RELEVANT_MEMORIES_LIMIT;

    const { user } = await this.resolveOrCreate(input.tenantSlug, input.userExternalId);

    const [existingProfile, existingMemories] = await Promise.all([
      this.profileService.get(user.id),
      this.gatherExistingMemoriesContext(user.id, input.conversation, recentLimit, relevantLimit),
    ]);

    const result = await this.extractionProvider.syncMemory({
      conversation: input.conversation,
      existingSummary: existingProfile?.summary ?? '',
      existingMemories,
      allowedOperations,
    });

    const existingById = new Map(existingMemories.map((m) => [m.id, m]));

    type OpOutcome =
      | { kind: 'add'; record: MemoryRecord }
      | { kind: 'update'; record: MemoryRecord }
      | { kind: 'delete'; id: string }
      | null;

    const settled = await Promise.allSettled<OpOutcome>(
      result.operations.map((op) => this.applyOperation(op, user.id, allowedOperations, existingById, input.conversation)),
    );

    const added: MemoryRecord[] = [];
    const updated: MemoryRecord[] = [];
    const deleted: string[] = [];
    const failures: SyncMemoryFailure[] = [];
    settled.forEach((s, i) => {
      if (s.status === 'rejected') {
        failures.push({
          op: result.operations[i],
          error: s.reason instanceof Error ? s.reason.message : String(s.reason),
        });
        return;
      }
      const r = s.value;
      if (!r) return;
      if (r.kind === 'add') added.push(r.record);
      else if (r.kind === 'update') updated.push(r.record);
      else deleted.push(r.id);
    });

    const summaryChanged =
      result.updatedSummary.trim().length > 0 &&
      result.updatedSummary !== (existingProfile?.summary ?? '');
    const summary = summaryChanged
      ? await this.profileService.upsert(user.id, result.updatedSummary)
      : existingProfile;

    return { operations: result.operations, added, updated, deleted, failures, summary };
  }

  private async applyOperation(
    op: MemoryOperation,
    userId: string,
    allowedOperations: MemoryOperationType[],
    existingById: Map<string, ExistingMemoryContext>,
    conversation: ConversationMessage[],
  ): Promise<
    | { kind: 'add'; record: MemoryRecord }
    | { kind: 'update'; record: MemoryRecord }
    | { kind: 'delete'; id: string }
    | null
  > {
    if (!allowedOperations.includes(op.op)) return null;

    switch (op.op) {
      case 'ADD': {
        if (!op.content.trim()) return null;
        const record = await this.memoryStore.add({
          userId,
          content: op.content,
          memoryType: op.memoryType,
          importance: op.importance,
          rawConversation: conversation,
        });
        return { kind: 'add', record };
      }
      case 'UPDATE': {
        if (!existingById.has(op.id)) {
          console.warn('[MemoryService.syncMemory] Dropping UPDATE for id not in context:', op.id);
          return null;
        }
        const existing = existingById.get(op.id);
        const contentChanged = op.content !== undefined && existing?.content !== op.content;
        const record = await this.memoryStore.update({
          id: op.id,
          userId,
          content: contentChanged ? op.content : undefined,
          memoryType: op.memoryType,
          importance: op.importance,
        });
        return record ? { kind: 'update', record } : null;
      }
      case 'DELETE': {
        if (!existingById.has(op.id)) {
          console.warn('[MemoryService.syncMemory] Dropping DELETE for id not in context:', op.id);
          return null;
        }
        const ok = await this.memoryStore.deleteById({ id: op.id, userId });
        return ok ? { kind: 'delete', id: op.id } : null;
      }
      case 'NOOP':
        return null;
    }
  }

  async search(input: SearchInput): Promise<SearchResult[]> {
    const resolved = await this.findExisting(input.tenantSlug, input.userExternalId);
    if (!resolved) return [];

    return this.memoryStore.search({
      userId: resolved.user.id,
      query: input.query,
      limit: input.limit,
      threshold: input.threshold,
    });
  }

  async getRecentMemories(
    tenantSlug: string,
    userExternalId: string,
    options?: { limit?: number },
  ): Promise<MemoryRecord[]> {
    const resolved = await this.findExisting(tenantSlug, userExternalId);
    if (!resolved) return [];

    return this.memoryStore.getRecent(resolved.user.id, options?.limit ?? 10);
  }

  async addMemory(input: AddMemoryInput): Promise<MemoryRecord> {
    const { user } = await this.resolveOrCreate(input.tenantSlug, input.userExternalId);

    return this.memoryStore.add({
      userId: user.id,
      content: input.content,
      memoryType: input.memoryType,
      importance: input.importance,
      metadata: input.metadata,
      rawConversation: input.rawConversation,
    });
  }

  async updateProfileSummary(input: UpdateProfileSummaryInput): Promise<ProfileSummary> {
    const { user } = await this.resolveOrCreate(input.tenantSlug, input.userExternalId);
    return this.profileService.upsert(user.id, input.summary);
  }

  async getProfileSummary(
    tenantSlug: string,
    userExternalId: string,
  ): Promise<ProfileSummary | null> {
    const resolved = await this.findExisting(tenantSlug, userExternalId);
    if (!resolved) return null;

    return this.profileService.get(resolved.user.id);
  }

  // --- Private helpers ---

  private async gatherExistingMemoriesContext(
    userId: string,
    conversation: ConversationMessage[],
    recentLimit: number,
    relevantLimit: number,
  ): Promise<ExistingMemoryContext[]> {
    const userQuery = conversation
      .filter((m) => m.role === 'user')
      .map((m) => m.content)
      .join('\n')
      .trim()
      .slice(-MAX_USER_QUERY_CHARS);

    const [recent, relevant] = await Promise.all([
      recentLimit > 0 ? this.memoryStore.getRecent(userId, recentLimit) : Promise.resolve([]),
      relevantLimit > 0 && userQuery.length > 0
        ? this.memoryStore.search({
            userId,
            query: userQuery,
            limit: relevantLimit,
            threshold: DEFAULT_RELEVANT_SEARCH_THRESHOLD,
          })
        : Promise.resolve([]),
    ]);

    const project = (m: ExistingMemoryContext): ExistingMemoryContext => ({
      id: m.id,
      content: m.content,
      memoryType: m.memoryType,
      importance: m.importance,
    });

    const byId = new Map<string, ExistingMemoryContext>();
    for (const m of [...recent, ...relevant]) {
      if (!byId.has(m.id)) byId.set(m.id, project(m));
    }
    return Array.from(byId.values());
  }

  private async resolveOrCreate(tenantSlug: string, userExternalId: string) {
    const tenant = await this.tenantService.getOrCreate(tenantSlug);
    const user = await this.userService.getOrCreate(tenant.id, userExternalId);
    return { tenant, user };
  }

  private async findExisting(tenantSlug: string, userExternalId: string) {
    const tenant = await this.tenantService.getBySlug(tenantSlug);
    if (!tenant) return null;
    const user = await this.userService.getByExternalId(tenant.id, userExternalId);
    if (!user) return null;
    return { tenant, user };
  }

  private formatContext(
    profile: ProfileSummary | null,
    recentMemories: MemoryRecord[],
    orgNotes: TenantNoteRecord[],
    orgMemories: TenantMemoryRecord[],
  ): string {
    const sections: string[] = [];

    if (orgNotes.length > 0) {
      const notesText = orgNotes.map((n) => `- [${n.category}] ${n.title}: ${n.content}`).join('\n');
      sections.push(`【組織資訊】\n${notesText}`);
    }

    if (orgMemories.length > 0) {
      const memoriesText = orgMemories.map((m) => `- [${m.memoryType}] ${m.content}`).join('\n');
      sections.push(`【組織知識】\n${memoriesText}`);
    }

    if (profile?.summary) {
      sections.push(`【客戶檔案】\n${profile.summary}`);
    }

    if (recentMemories.length > 0) {
      const recentText = recentMemories.map((m) => `- [${m.memoryType}] ${m.content}`).join('\n');
      sections.push(`【最近互動】\n${recentText}`);
    }

    return sections.join('\n\n');
  }
}
