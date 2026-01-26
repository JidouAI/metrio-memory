import { pgTable, uuid, varchar, text, boolean, smallint, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { vector } from 'drizzle-orm/pg-core';

// 租戶表
export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 100 }).unique().notNull(),
  settings: jsonb('settings').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// 租戶筆記表
export const tenantNotes = pgTable('tenant_notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  category: varchar('category', { length: 100 }).notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  content: text('content').notNull(),
  embedding: vector('embedding', { dimensions: 768 }),
  isActive: boolean('is_active').default(true),
  priority: smallint('priority').default(5),
  tags: text('tags').array().default([]),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
}, (table) => [
  index('tenant_notes_tenant_id_idx').on(table.tenantId),
  index('tenant_notes_category_idx').on(table.category),
]);

// 租戶記憶表
export const tenantMemories = pgTable('tenant_memories', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  content: text('content').notNull(),
  embedding: vector('embedding', { dimensions: 768 }),
  memoryType: varchar('memory_type', { length: 50 }).notNull(),
  importance: smallint('importance').default(5),
  sourceUserId: uuid('source_user_id'),
  sourceMemoryId: uuid('source_memory_id'),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
}, (table) => [
  index('tenant_memories_tenant_id_idx').on(table.tenantId),
  index('tenant_memories_type_idx').on(table.memoryType),
]);
