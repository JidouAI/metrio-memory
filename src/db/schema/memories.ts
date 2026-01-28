import { pgTable, uuid, varchar, text, smallint, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { vector } from 'drizzle-orm/pg-core';
import { users } from './users';

// 記憶表
export const memories = pgTable('memories', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  content: text('content').notNull(),
  rawConversation: jsonb('raw_conversation'),
  embedding: vector('embedding', { dimensions: 3072 }),
  memoryType: varchar('memory_type', { length: 50 }).notNull(),
  importance: smallint('importance').default(5),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
}, (table) => [
  index('memories_user_id_idx').on(table.userId),
  index('memories_type_idx').on(table.memoryType),
  index('memories_created_at_idx').on(table.createdAt),
]);
