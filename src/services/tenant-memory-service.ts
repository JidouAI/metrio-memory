import { eq, and, desc, sql, gt, inArray } from 'drizzle-orm';
import type { Database } from '../db';
import { tenantMemories } from '../db/schema';
import type { EmbeddingProvider, AddTenantMemoryInput, PromoteFromUserInput, TenantMemoryRecord } from '../types';

export class TenantMemoryService {
  constructor(
    private db: Database,
    private embeddingProvider: EmbeddingProvider,
  ) {}

  async add(tenantId: string, input: AddTenantMemoryInput): Promise<TenantMemoryRecord> {
    const embedding = await this.embeddingProvider.embed(input.content);

    const result = await this.db
      .insert(tenantMemories)
      .values({
        tenantId,
        content: input.content,
        embedding,
        memoryType: input.type,
        importance: input.importance ?? 5,
        sourceUserId: input.sourceUserId,
        sourceMemoryId: input.sourceMemoryId,
        metadata: input.metadata ?? {},
      })
      .returning();

    return result[0];
  }

  async promoteFromUser(tenantId: string, input: PromoteFromUserInput): Promise<TenantMemoryRecord> {
    return this.add(tenantId, {
      content: input.content,
      type: input.type,
      importance: input.importance,
      sourceMemoryId: input.sourceMemoryId,
    });
  }

  async search(tenantId: string, input: { query: string; limit?: number; type?: string }) {
    const queryEmbedding = await this.embeddingProvider.embed(input.query);
    const limit = input.limit ?? 10;

    const similarity = sql<number>`1 - (${tenantMemories.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector)`;

    const conditions = [
      eq(tenantMemories.tenantId, tenantId),
      gt(similarity, 0.3),
    ];

    if (input.type) {
      conditions.push(eq(tenantMemories.memoryType, input.type));
    }

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
        similarity,
      })
      .from(tenantMemories)
      .where(and(...conditions))
      .orderBy(desc(similarity))
      .limit(limit);
  }

  async getAll(tenantId: string, types?: string[]): Promise<TenantMemoryRecord[]> {
    const conditions = [eq(tenantMemories.tenantId, tenantId)];

    if (types && types.length > 0) {
      conditions.push(inArray(tenantMemories.memoryType, types));
    }

    return this.db
      .select()
      .from(tenantMemories)
      .where(and(...conditions))
      .orderBy(desc(tenantMemories.createdAt));
  }
}
