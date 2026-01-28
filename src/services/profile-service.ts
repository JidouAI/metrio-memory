import { eq, sql } from 'drizzle-orm';
import type { Database } from '../db';
import { userProfiles } from '../db/schema';
import type { EmbeddingProvider, ProfileSummary } from '../types';

export class ProfileService {
  constructor(
    private db: Database,
    private embeddingProvider: EmbeddingProvider,
  ) {}

  async get(userId: string): Promise<ProfileSummary | null> {
    const result = await this.db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .limit(1);
    return result[0] ?? null;
  }

  async upsert(userId: string, summary: string): Promise<ProfileSummary> {
    const embedding = await this.embeddingProvider.embed(summary);

    const result = await this.db
      .insert(userProfiles)
      .values({ userId, summary, summaryEmbedding: embedding })
      .onConflictDoUpdate({
        target: userProfiles.userId,
        set: {
          summary,
          summaryEmbedding: embedding,
          version: sql`${userProfiles.version} + 1`,
          updatedAt: new Date(),
        },
      })
      .returning();

    return result[0];
  }

  async delete(userId: string): Promise<{ deleted: boolean }> {
    const result = await this.db
      .delete(userProfiles)
      .where(eq(userProfiles.userId, userId));
    return { deleted: (result.rowCount ?? 0) > 0 };
  }
}
