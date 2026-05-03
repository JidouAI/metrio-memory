import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MetrioExtractionProvider } from './metrio';
import type { MemoryOperationType } from '../../types';

const chatCompletion = vi.fn();

vi.mock('metrioai-js-sdk', () => ({
  MetrioAI: class {
    chatCompletion(...args: unknown[]) {
      return chatCompletion(...args);
    }
  },
}));

const baseConfig = {
  apiKey: 'test-key',
  projectId: 'proj-1',
  extractionPromptId: 1,
  summaryMergerPromptId: 2,
};

const baseSyncInput = {
  conversation: [
    { role: 'user' as const, content: 'hi' },
    { role: 'assistant' as const, content: 'hello' },
  ],
  existingSummary: 'existing summary',
  existingMemories: [
    { id: 'mem-1', content: 'likes lemon', memoryType: 'preference', importance: 7 },
  ],
  allowedOperations: ['ADD', 'UPDATE', 'DELETE', 'NOOP'] as MemoryOperationType[],
};

describe('MetrioExtractionProvider.syncMemory', () => {
  beforeEach(() => {
    chatCompletion.mockReset();
  });

  it('throws when memoryUpdatePromptId is not configured', async () => {
    const provider = new MetrioExtractionProvider(baseConfig);
    await expect(provider.syncMemory({ ...baseSyncInput, allowedOperations: ['ADD'] })).rejects.toThrow(
      /memoryUpdatePromptId is not configured/,
    );
  });

  it('parses ADD, UPDATE, DELETE, NOOP operations and updated summary', async () => {
    chatCompletion.mockResolvedValue({
      response: JSON.stringify({
        operations: [
          { op: 'ADD', content: 'likes chocolate', memoryType: 'preference', importance: 8, reason: 'new' },
          { op: 'UPDATE', id: 'mem-1', content: 'likes lemon and lime', importance: 9 },
          { op: 'DELETE', id: 'mem-2', reason: 'stale' },
          { op: 'NOOP', reason: 'duplicate' },
        ],
        updated_summary: 'new summary',
      }),
    });

    const provider = new MetrioExtractionProvider({ ...baseConfig, memoryUpdatePromptId: 3 });
    const result = await provider.syncMemory({ ...baseSyncInput });

    expect(result.updatedSummary).toBe('new summary');
    expect(result.operations).toEqual([
      { op: 'ADD', content: 'likes chocolate', memoryType: 'preference', importance: 8, reason: 'new' },
      { op: 'UPDATE', id: 'mem-1', content: 'likes lemon and lime', memoryType: undefined, importance: 9, reason: undefined },
      { op: 'DELETE', id: 'mem-2', reason: 'stale' },
      { op: 'NOOP', reason: 'duplicate' },
    ]);
  });

  it('accepts snake_case memory_type alias', async () => {
    chatCompletion.mockResolvedValue({
      response: JSON.stringify({
        operations: [{ op: 'ADD', content: 'x', memory_type: 'fact', importance: 5 }],
        updated_summary: 's',
      }),
    });

    const provider = new MetrioExtractionProvider({ ...baseConfig, memoryUpdatePromptId: 3 });
    const result = await provider.syncMemory({ ...baseSyncInput });

    expect(result.operations[0]).toMatchObject({ op: 'ADD', memoryType: 'fact' });
  });

  it('falls back to existingSummary when updated_summary missing', async () => {
    chatCompletion.mockResolvedValue({
      response: JSON.stringify({ operations: [{ op: 'NOOP' }] }),
    });

    const provider = new MetrioExtractionProvider({ ...baseConfig, memoryUpdatePromptId: 3 });
    const result = await provider.syncMemory({ ...baseSyncInput });

    expect(result.updatedSummary).toBe('existing summary');
  });

  it('drops unknown operation types', async () => {
    chatCompletion.mockResolvedValue({
      response: JSON.stringify({
        operations: [
          { op: 'ADD', content: 'x', memoryType: 'fact', importance: 5 },
          { op: 'WHATEVER', content: 'noise' },
        ],
        updated_summary: 's',
      }),
    });

    const provider = new MetrioExtractionProvider({ ...baseConfig, memoryUpdatePromptId: 3 });
    const result = await provider.syncMemory({ ...baseSyncInput });

    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].op).toBe('ADD');
  });

  it('throws on malformed JSON response', async () => {
    chatCompletion.mockResolvedValue({ response: 'not json {' });
    const provider = new MetrioExtractionProvider({ ...baseConfig, memoryUpdatePromptId: 3 });
    await expect(provider.syncMemory({ ...baseSyncInput })).rejects.toThrow(
      /Failed to parse memory sync response/,
    );
  });

  it('sends conversation, existing state, and allowed_operations in payload', async () => {
    chatCompletion.mockResolvedValue({
      response: JSON.stringify({ operations: [], updated_summary: '' }),
    });

    const provider = new MetrioExtractionProvider({ ...baseConfig, memoryUpdatePromptId: 3 });
    await provider.syncMemory({ ...baseSyncInput, allowedOperations: ['ADD', 'NOOP'] });

    expect(chatCompletion).toHaveBeenCalledTimes(1);
    const call = chatCompletion.mock.calls[0][0];
    expect(call.promptId).toBe(3);

    const payload = JSON.parse(call.messages[0].content.text);
    expect(payload.conversation).toContain('<user>\nhi\n</user>');
    expect(payload.conversation).toContain('<assistant>\nhello\n</assistant>');
    expect(payload.existing_summary).toBe('existing summary');
    expect(payload.existing_memories).toEqual([
      { id: 'mem-1', content: 'likes lemon', memory_type: 'preference', importance: 7 },
    ]);
    expect(payload.allowed_operations).toEqual(['ADD', 'NOOP']);
  });
});

describe('MetrioExtractionProvider lazy prompt-id validation', () => {
  beforeEach(() => {
    chatCompletion.mockReset();
  });

  it('constructs without any prompt IDs', () => {
    expect(
      () => new MetrioExtractionProvider({ apiKey: 'k', projectId: 'p' }),
    ).not.toThrow();
  });

  it('throws on extractMemories when extractionPromptId is not configured', async () => {
    const provider = new MetrioExtractionProvider({ apiKey: 'k', projectId: 'p' });
    await expect(provider.extractMemories([{ role: 'user', content: 'hi' }])).rejects.toThrow(
      /extractionPromptId is not configured/,
    );
  });

  it('throws on mergeSummary when summaryMergerPromptId is not configured', async () => {
    const provider = new MetrioExtractionProvider({ apiKey: 'k', projectId: 'p' });
    await expect(provider.mergeSummary('existing', ['new'])).rejects.toThrow(
      /summaryMergerPromptId is not configured/,
    );
  });
});
