import { and, eq } from 'drizzle-orm';
import type { Database } from '../db';
import { users } from '../db/schema';

export class UserService {
  constructor(private db: Database) {}

  async getByExternalId(tenantId: string, externalId: string) {
    const result = await this.db
      .select()
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.externalId, externalId)))
      .limit(1);
    return result[0] ?? null;
  }

  async getOrCreate(tenantId: string, externalId: string) {
    const existing = await this.getByExternalId(tenantId, externalId);
    if (existing) return existing;

    await this.db
      .insert(users)
      .values({ tenantId, externalId })
      .onConflictDoNothing({ target: [users.tenantId, users.externalId] });

    return (await this.getByExternalId(tenantId, externalId))!;
  }
}
