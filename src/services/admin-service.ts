import { eq } from 'drizzle-orm';
import type { Database } from '../db';
import { memories, tenantNotes, tenantMemories } from '../db/schema';
import type { AdminMemoryRecord, AdminTenantNoteRecord, TenantMemoryRecord } from '../types';

export class AdminService {
  constructor(private db: Database) {}

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
