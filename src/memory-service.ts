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
} from './types';

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
    listUserMemories: (slug: string, userExternalId: string) => Promise<AdminMemoryRecord[]>;
    listTenantNotes: (slug: string) => Promise<AdminTenantNoteRecord[]>;
    listTenantMemories: (slug: string) => Promise<TenantMemoryRecord[]>;
    purgeUserMemories: (slug: string, userExternalId: string) => Promise<{ deletedCount: number }>;
    purgeTenantNotes: (slug: string) => Promise<{ deletedCount: number }>;
    purgeTenantMemories: (slug: string) => Promise<{ deletedCount: number }>;
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
    this.adminService = new AdminService(db);

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
