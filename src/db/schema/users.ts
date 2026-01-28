import { pgTable, uuid, varchar, text, smallint, timestamp, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { vector } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

// 使用者表
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  externalId: varchar('external_id', { length: 255 }).notNull(),
  displayName: varchar('display_name', { length: 255 }),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex('users_tenant_external_idx').on(table.tenantId, table.externalId),
  index('users_tenant_id_idx').on(table.tenantId),
]);

// 用戶檔案表
export const userProfiles = pgTable('user_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull().unique(),
  summary: text('summary').default(''),
  summaryEmbedding: vector('summary_embedding', { dimensions: 3072 }),
  version: smallint('version').default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('user_profiles_user_id_idx').on(table.userId),
]);
