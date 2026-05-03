import { MetrioAI } from 'metrioai-js-sdk';
import type {
  ConversationMessage,
  ExtractedMemory,
  ExtractionProvider,
  ExtractionResult,
  MemoryOperation,
  SyncMemoryProviderInput,
  SyncMemoryProviderResult,
} from '../../types';

export class MetrioExtractionProvider implements ExtractionProvider {
  private client: MetrioAI;
  private projectId: string;
  private extractionPromptId: number;
  private summaryMergerPromptId: number;
  private memoryUpdatePromptId?: number;

  constructor(config: {
    apiKey: string;
    projectId: string;
    extractionPromptId: number;
    summaryMergerPromptId: number;
    memoryUpdatePromptId?: number;
    baseUrl?: string;
  }) {
    this.client = new MetrioAI({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
    });
    this.projectId = config.projectId;
    this.extractionPromptId = config.extractionPromptId;
    this.summaryMergerPromptId = config.summaryMergerPromptId;
    this.memoryUpdatePromptId = config.memoryUpdatePromptId;
  }

  async extractMemories(conversation: ConversationMessage[]): Promise<ExtractionResult> {
    const response = await this.client.chatCompletion({
      projectId: this.projectId,
      promptId: this.extractionPromptId,
      messages: [
        {
          role: 'user',
          content: { type: 'text', text: formatConversation(conversation) },
        },
      ],
    });

    try {
      const parsed = JSON.parse(response.response);
      return {
        memories: Array.isArray(parsed.memories)
          ? parsed.memories.map(normalizeExtractedMemory)
          : [],
      };
    } catch (error) {
      console.error('[MetrioExtractionProvider] Failed to parse extraction response:', {
        error: error instanceof Error ? error.message : error,
        response: truncateForLog(response.response),
      });
      throw new Error(
        `Failed to parse memory extraction response: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async syncMemory(input: SyncMemoryProviderInput): Promise<SyncMemoryProviderResult> {
    if (!this.memoryUpdatePromptId) {
      throw new Error(
        'memoryUpdatePromptId is not configured. Set it in extraction config to use syncMemory.',
      );
    }

    const payload = {
      conversation: formatConversation(input.conversation),
      existing_summary: input.existingSummary,
      existing_memories: input.existingMemories.map((m) => ({
        id: m.id,
        content: m.content,
        memory_type: m.memoryType,
        importance: m.importance,
      })),
      allowed_operations: input.allowedOperations,
    };

    const response = await this.client.chatCompletion({
      projectId: this.projectId,
      promptId: this.memoryUpdatePromptId,
      messages: [
        {
          role: 'user',
          content: { type: 'text', text: JSON.stringify(payload) },
        },
      ],
    });

    try {
      const parsed = JSON.parse(response.response);
      return {
        operations: Array.isArray(parsed.operations)
          ? parsed.operations
              .map(normalizeOperation)
              .filter((op: MemoryOperation | null): op is MemoryOperation => op !== null)
          : [],
        updatedSummary: typeof parsed.updated_summary === 'string'
          ? parsed.updated_summary
          : input.existingSummary,
      };
    } catch (error) {
      console.error('[MetrioExtractionProvider] Failed to parse syncMemory response:', {
        error: error instanceof Error ? error.message : error,
        response: truncateForLog(response.response),
      });
      throw new Error(
        `Failed to parse memory sync response: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  async mergeSummary(existingSummary: string, newMemories: string[]): Promise<string> {
    const response = await this.client.chatCompletion({
      projectId: this.projectId,
      promptId: this.summaryMergerPromptId,
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: JSON.stringify({
              existing_summary: existingSummary,
              new_memories: newMemories,
            }),
          },
        },
      ],
    });

    const raw = response.response;
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null) {
        return parsed.new_memories ? parsed.new_memories.join('\n') : parsed.existing_summary || parsed.summary || parsed.merged_summary || raw;
      }
    } catch {
      // Not JSON — expected behavior, return as-is
    }
    return raw;
  }
}

const MAX_MEMORY_TYPE_LENGTH = 50;
const MIN_IMPORTANCE = 1;
const MAX_IMPORTANCE = 10;
const DEFAULT_IMPORTANCE = 5;

function formatConversation(conversation: ConversationMessage[]): string {
  return conversation
    .map((m) => `<${m.role}>\n${escapeForRoleTag(m.content)}\n</${m.role}>`)
    .join('\n');
}

function escapeForRoleTag(content: string): string {
  return content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function truncateForLog(value: unknown, max = 500): string {
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  return str.length <= max ? str : `${str.slice(0, max)}…[truncated ${str.length - max} chars]`;
}

function clampImportance(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_IMPORTANCE;
  return Math.max(MIN_IMPORTANCE, Math.min(MAX_IMPORTANCE, Math.round(n)));
}

function truncateMemoryType(raw: unknown): string {
  const s = raw == null ? 'general' : String(raw);
  return s.slice(0, MAX_MEMORY_TYPE_LENGTH);
}

function normalizeExtractedMemory(raw: Record<string, unknown>): ExtractedMemory {
  return {
    content: String(raw.content ?? ''),
    memoryType: truncateMemoryType(raw.memoryType ?? raw.memory_type ?? 'general'),
    importance: clampImportance(raw.importance ?? DEFAULT_IMPORTANCE),
  };
}

function optionalString(raw: unknown): string | undefined {
  return raw == null ? undefined : String(raw);
}

function normalizeOperation(raw: Record<string, unknown>): MemoryOperation | null {
  const op = String(raw.op ?? '').toUpperCase();
  const reason = optionalString(raw.reason);
  switch (op) {
    case 'ADD':
      return { op: 'ADD', ...normalizeExtractedMemory(raw), reason };
    case 'UPDATE':
      return {
        op: 'UPDATE',
        id: String(raw.id ?? ''),
        content: optionalString(raw.content),
        memoryType: raw.memoryType != null || raw.memory_type != null
          ? truncateMemoryType(raw.memoryType ?? raw.memory_type)
          : undefined,
        importance: raw.importance != null ? clampImportance(raw.importance) : undefined,
        reason,
      };
    case 'DELETE':
      return { op: 'DELETE', id: String(raw.id ?? ''), reason };
    case 'NOOP':
      return { op: 'NOOP', reason };
    default:
      console.warn('[MetrioExtractionProvider] Dropping unknown memory op:', { op, raw });
      return null;
  }
}
