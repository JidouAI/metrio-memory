import { eq, desc, sql, and, gt } from 'drizzle-orm';
import type { Database } from '../db';
import { memories, tenantNotes, tenantMemories, tenants, users, userProfiles } from '../db/schema';
import type { AdminMemoryRecord, AdminTenantNoteRecord, AdminTenantRecord, AdminUserRecord, AdminSearchResult, TenantMemoryRecord, EmbeddingProvider } from '../types';

export class AdminService {
  constructor(
    private db: Database,
    private embeddingProvider: EmbeddingProvider,
  ) {}

  async listTenants(): Promise<AdminTenantRecord[]> {
    return this.db
      .select({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
        settings: tenants.settings,
        createdAt: tenants.createdAt,
        updatedAt: tenants.updatedAt,
      })
      .from(tenants);
  }

  async listUsers(tenantId: string): Promise<AdminUserRecord[]> {
    return this.db
      .select({
        id: users.id,
        tenantId: users.tenantId,
        externalId: users.externalId,
        displayName: users.displayName,
        metadata: users.metadata,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .where(eq(users.tenantId, tenantId));
  }

  async searchMemories(
    tenantId: string,
    query: string,
    options?: { limit?: number; threshold?: number },
  ): Promise<AdminSearchResult[]> {
    const queryEmbedding = await this.embeddingProvider.embed(query);
    const limit = options?.limit ?? 10;
    const threshold = options?.threshold ?? 0.3;

    const similarity = sql<number>`1 - (${memories.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector)`;

    const results = await this.db
      .select({
        id: memories.id,
        userId: memories.userId,
        userExternalId: users.externalId,
        content: memories.content,
        memoryType: memories.memoryType,
        importance: memories.importance,
        similarity,
        createdAt: memories.createdAt,
      })
      .from(memories)
      .innerJoin(users, eq(memories.userId, users.id))
      .where(
        and(
          eq(users.tenantId, tenantId),
          gt(similarity, threshold),
        ),
      )
      .orderBy(desc(similarity))
      .limit(limit);

    return results.map((r) => ({
      ...r,
      similarity: Number(r.similarity),
    }));
  }

  async listUserMemories(userId: string): Promise<AdminMemoryRecord[]> {
    return this.db
      .select({
        id: memories.id,
        userId: memories.userId,
        content: memories.content,
        rawConversation: memories.rawConversation,
        memoryType: memories.memoryType,
        importance: memories.importance,
        metadata: memories.metadata,
        createdAt: memories.createdAt,
        expiresAt: memories.expiresAt,
      })
      .from(memories)
      .where(eq(memories.userId, userId));
  }

  async listTenantNotes(tenantId: string): Promise<AdminTenantNoteRecord[]> {
    return this.db
      .select({
        id: tenantNotes.id,
        tenantId: tenantNotes.tenantId,
        category: tenantNotes.category,
        title: tenantNotes.title,
        content: tenantNotes.content,
        isActive: tenantNotes.isActive,
        priority: tenantNotes.priority,
        tags: tenantNotes.tags,
        metadata: tenantNotes.metadata,
        createdAt: tenantNotes.createdAt,
        updatedAt: tenantNotes.updatedAt,
        expiresAt: tenantNotes.expiresAt,
      })
      .from(tenantNotes)
      .where(eq(tenantNotes.tenantId, tenantId));
  }

  async listTenantMemories(tenantId: string): Promise<TenantMemoryRecord[]> {
    return this.db
      .select({
        id: tenantMemories.id,
        tenantId: tenantMemories.tenantId,
        content: tenantMemories.content,
        memoryType: tenantMemories.memoryType,
        importance: tenantMemories.importance,
        sourceUserId: tenantMemories.sourceUserId,
        sourceMemoryId: tenantMemories.sourceMemoryId,
        metadata: tenantMemories.metadata,
        createdAt: tenantMemories.createdAt,
        expiresAt: tenantMemories.expiresAt,
      })
      .from(tenantMemories)
      .where(eq(tenantMemories.tenantId, tenantId));
  }

  async purgeUserMemories(userId: string): Promise<{ deletedCount: number }> {
    const result = await this.db
      .delete(memories)
      .where(eq(memories.userId, userId));
    return { deletedCount: result.rowCount ?? 0 };
  }

  async purgeUserProfile(userId: string): Promise<{ deleted: boolean }> {
    const result = await this.db
      .delete(userProfiles)
      .where(eq(userProfiles.userId, userId));
    return { deleted: (result.rowCount ?? 0) > 0 };
  }

  async purgeUserAll(userId: string): Promise<{ memoriesDeleted: number; profileDeleted: boolean }> {
    const [memoriesResult, profileResult] = await Promise.all([
      this.purgeUserMemories(userId),
      this.purgeUserProfile(userId),
    ]);
    return {
      memoriesDeleted: memoriesResult.deletedCount,
      profileDeleted: profileResult.deleted,
    };
  }

  async purgeTenantNotes(tenantId: string): Promise<{ deletedCount: number }> {
    const result = await this.db
      .delete(tenantNotes)
      .where(eq(tenantNotes.tenantId, tenantId));
    return { deletedCount: result.rowCount ?? 0 };
  }

  async purgeTenantMemories(tenantId: string): Promise<{ deletedCount: number }> {
    const result = await this.db
      .delete(tenantMemories)
      .where(eq(tenantMemories.tenantId, tenantId));
    return { deletedCount: result.rowCount ?? 0 };
  }
}
