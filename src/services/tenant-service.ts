import { eq } from 'drizzle-orm';
import type { Database } from '../db';
import { tenants } from '../db/schema';

export class TenantService {
  constructor(private db: Database) {}

  async getBySlug(slug: string) {
    const result = await this.db
      .select()
      .from(tenants)
      .where(eq(tenants.slug, slug))
      .limit(1);
    return result[0] ?? null;
  }

  async getOrCreate(slug: string, name?: string) {
    const existing = await this.getBySlug(slug);
    if (existing) return existing;

    await this.db
      .insert(tenants)
      .values({ slug, name: name ?? slug })
      .onConflictDoNothing({ target: tenants.slug });

    return (await this.getBySlug(slug))!;
  }
}
