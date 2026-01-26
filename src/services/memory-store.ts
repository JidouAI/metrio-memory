import { eq, desc, sql, and, gt } from 'drizzle-orm';
import type { Database } from '../db';
import { memories } from '../db/schema';
import type { EmbeddingProvider, MemoryRecord, SearchResult, ConversationMessage } from '../types';

export class MemoryStore {
  constructor(
    private db: Database,
    private embeddingProvider: EmbeddingProvider,
  ) {}

  async add(input: {
    userId: string;
    content: string;
    memoryType: string;
    importance?: number;
    metadata?: Record<string, unknown>;
    rawConversation?: ConversationMessage[];
  }): Promise<MemoryRecord> {
    const embedding = await this.embeddingProvider.embed(input.content);

    const result = await this.db
      .insert(memories)
      .values({
        userId: input.userId,
        content: input.content,
        embedding,
        memoryType: input.memoryType,
        importance: input.importance ?? 5,
        metadata: input.metadata ?? {},
        rawConversation: input.rawConversation,
      })
      .returning();

    return result[0];
  }

  async search(input: {
    userId: string;
    query: string;
    limit?: number;
    threshold?: number;
  }): Promise<SearchResult[]> {
    const queryEmbedding = await this.embeddingProvider.embed(input.query);
    const limit = input.limit ?? 10;
    const threshold = input.threshold ?? 0.3;

    const similarity = sql<number>`1 - (${memories.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector)`;

    const results = await this.db
      .select({
        id: memories.id,
        content: memories.content,
        memoryType: memories.memoryType,
        importance: memories.importance,
        similarity,
        createdAt: memories.createdAt,
      })
      .from(memories)
      .where(
        and(
          eq(memories.userId, input.userId),
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

  async getRecent(userId: string, limit = 10): Promise<MemoryRecord[]> {
    return this.db
      .select()
      .from(memories)
      .where(eq(memories.userId, userId))
      .orderBy(desc(memories.createdAt))
      .limit(limit);
  }
}
