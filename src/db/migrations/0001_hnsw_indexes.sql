-- HNSW indexes for vector similarity search optimization
CREATE INDEX IF NOT EXISTS tenant_notes_embedding_idx
ON tenant_notes USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS tenant_memories_embedding_idx
ON tenant_memories USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS user_profiles_summary_embedding_idx
ON user_profiles USING hnsw (summary_embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS memories_embedding_idx
ON memories USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
