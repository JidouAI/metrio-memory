// --- Config ---

export interface EmbeddingConfig {
  provider: 'gemini' | 'openai';
  apiKey: string;
  model?: string;
}

export interface ExtractionConfig {
  provider: 'metrio' | 'custom';
  apiKey?: string;
  projectId?: string;
  extractionPromptId?: number;
  summaryMergerPromptId?: number;
  baseUrl?: string;
  customExtractor?: ExtractionProvider;
}

export interface MemoryServiceConfig {
  databaseUrl: string;
  embedding: EmbeddingConfig;
  extraction?: ExtractionConfig;
}

// --- Providers ---

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

export interface ExtractionResult {
  memories: ExtractedMemory[];
}

export interface ExtractedMemory {
  content: string;
  memoryType: string;
  importance: number;
}

export interface ExtractionProvider {
  extractMemories(conversation: ConversationMessage[]): Promise<ExtractionResult>;
  mergeSummary(existingSummary: string, newMemories: string[]): Promise<string>;
}

// --- Conversation ---

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// --- Context ---

export interface GetContextOptions {
  recentLimit?: number;
  includeOrgNotes?: boolean;
  orgNoteCategories?: string[];
  includeOrgMemories?: boolean;
  orgMemoryTypes?: string[];
}

export interface ContextResult {
  profile: ProfileSummary | null;
  recentMemories: MemoryRecord[];
  orgNotes: TenantNoteRecord[];
  orgMemories: TenantMemoryRecord[];
  formatted: string;
}

// --- Process Conversation ---

export interface ProcessConversationInput {
  tenantSlug: string;
  userExternalId: string;
  conversation: ConversationMessage[];
}

// --- Search ---

export interface SearchInput {
  tenantSlug: string;
  userExternalId: string;
  query: string;
  limit?: number;
  threshold?: number;
}

export interface SearchResult {
  id: string;
  content: string;
  memoryType: string;
  importance: number | null;
  similarity: number;
  createdAt: Date | null;
}

// --- Memory ---

export interface AddMemoryInput {
  tenantSlug: string;
  userExternalId: string;
  content: string;
  memoryType: string;
  importance?: number;
  metadata?: Record<string, unknown>;
  rawConversation?: ConversationMessage[];
}

export interface MemoryRecord {
  id: string;
  userId: string;
  content: string;
  memoryType: string;
  importance: number | null;
  metadata: unknown;
  createdAt: Date | null;
  expiresAt: Date | null;
}

// --- Profile ---

export interface ProfileSummary {
  id: string;
  userId: string;
  summary: string | null;
  version: number | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface UpdateProfileSummaryInput {
  tenantSlug: string;
  userExternalId: string;
  summary: string;
}

// --- Tenant Notes ---

export interface AddTenantNoteInput {
  category: string;
  title: string;
  content: string;
  tags?: string[];
  priority?: number;
  metadata?: Record<string, unknown>;
  expiresAt?: Date;
}

export interface SearchTenantNotesInput {
  query: string;
  limit?: number;
  category?: string;
}

export interface TenantNoteRecord {
  id: string;
  tenantId: string;
  category: string;
  title: string;
  content: string;
  isActive: boolean | null;
  priority: number | null;
  tags: string[] | null;
  metadata: unknown;
  createdAt: Date | null;
  updatedAt: Date | null;
  expiresAt: Date | null;
}

// --- Tenant Memories ---

export interface AddTenantMemoryInput {
  content: string;
  type: string;
  importance?: number;
  sourceUserId?: string;
  sourceMemoryId?: string;
  metadata?: Record<string, unknown>;
}

export interface PromoteFromUserInput {
  sourceMemoryId: string;
  content: string;
  type: string;
  importance?: number;
}

export interface TenantMemoryRecord {
  id: string;
  tenantId: string;
  content: string;
  memoryType: string;
  importance: number | null;
  sourceUserId: string | null;
  sourceMemoryId: string | null;
  metadata: unknown;
  createdAt: Date | null;
  expiresAt: Date | null;
}

// --- Admin ---

export interface AdminMemoryRecord {
  id: string;
  userId: string;
  content: string;
  rawConversation: unknown;
  memoryType: string;
  importance: number | null;
  metadata: unknown;
  createdAt: Date | null;
  expiresAt: Date | null;
}

export interface AdminTenantNoteRecord {
  id: string;
  tenantId: string;
  category: string;
  title: string;
  content: string;
  isActive: boolean | null;
  priority: number | null;
  tags: string[] | null;
  metadata: unknown;
  createdAt: Date | null;
  updatedAt: Date | null;
  expiresAt: Date | null;
}
