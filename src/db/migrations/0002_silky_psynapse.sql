-- Drop HNSW indexes first (HNSW max 2000 dimensions, incompatible with 3072)
DROP INDEX IF EXISTS tenant_notes_embedding_idx;--> statement-breakpoint
DROP INDEX IF EXISTS tenant_memories_embedding_idx;--> statement-breakpoint
DROP INDEX IF EXISTS user_profiles_summary_embedding_idx;--> statement-breakpoint
DROP INDEX IF EXISTS memories_embedding_idx;--> statement-breakpoint
-- Alter vector columns from 768 to 3072 dimensions
ALTER TABLE "tenant_memories" ALTER COLUMN "embedding" SET DATA TYPE vector(3072);--> statement-breakpoint
ALTER TABLE "tenant_notes" ALTER COLUMN "embedding" SET DATA TYPE vector(3072);--> statement-breakpoint
ALTER TABLE "user_profiles" ALTER COLUMN "summary_embedding" SET DATA TYPE vector(3072);--> statement-breakpoint
ALTER TABLE "memories" ALTER COLUMN "embedding" SET DATA TYPE vector(3072);