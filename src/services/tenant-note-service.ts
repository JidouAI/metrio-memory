import { eq, and, desc, sql, gt } from 'drizzle-orm';
import type { Database } from '../db';
import { tenantNotes } from '../db/schema';
import type { EmbeddingProvider, AddTenantNoteInput, TenantNoteRecord } from '../types';

export class TenantNoteService {
  constructor(
    private db: Database,
    private embeddingProvider: EmbeddingProvider,
  ) {}

  async add(tenantId: string, input: AddTenantNoteInput): Promise<TenantNoteRecord> {
    const embedding = await this.embeddingProvider.embed(input.content);

    const result = await this.db
      .insert(tenantNotes)
      .values({
        tenantId,
        category: input.category,
        title: input.title,
        content: input.content,
        embedding,
        tags: input.tags ?? [],
        priority: input.priority ?? 5,
        metadata: input.metadata ?? {},
        expiresAt: input.expiresAt,
      })
      .returning();

    return result[0];
  }

  async search(tenantId: string, input: { query: string; limit?: number; category?: string }) {
    const queryEmbedding = await this.embeddingProvider.embed(input.query);
    const limit = input.limit ?? 10;

    const similarity = sql<number>`1 - (${tenantNotes.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector)`;

    const conditions = [
      eq(tenantNotes.tenantId, tenantId),
      eq(tenantNotes.isActive, true),
      gt(similarity, 0.3),
    ];

    if (input.category) {
      conditions.push(eq(tenantNotes.category, input.category));
    }

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
        similarity,
      })
      .from(tenantNotes)
      .where(and(...conditions))
      .orderBy(desc(similarity))
      .limit(limit);
  }

  async getByCategory(tenantId: string, category: string): Promise<TenantNoteRecord[]> {
    return this.db
      .select()
      .from(tenantNotes)
      .where(
        and(
          eq(tenantNotes.tenantId, tenantId),
          eq(tenantNotes.category, category),
          eq(tenantNotes.isActive, true),
        ),
      )
      .orderBy(desc(tenantNotes.priority));
  }

  async getAll(tenantId: string): Promise<TenantNoteRecord[]> {
    return this.db
      .select()
      .from(tenantNotes)
      .where(
        and(
          eq(tenantNotes.tenantId, tenantId),
          eq(tenantNotes.isActive, true),
        ),
      )
      .orderBy(desc(tenantNotes.priority));
  }
}
