import { MetrioAI } from 'metrioai-js-sdk';
import type { ConversationMessage, ExtractionProvider, ExtractionResult } from '../../types';

export class MetrioExtractionProvider implements ExtractionProvider {
  private client: MetrioAI;
  private projectId: string;
  private extractionPromptId: number;
  private summaryMergerPromptId: number;

  constructor(config: {
    apiKey: string;
    projectId: string;
    extractionPromptId: number;
    summaryMergerPromptId: number;
    baseUrl?: string;
  }) {
    this.client = new MetrioAI({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
    });
    this.projectId = config.projectId;
    this.extractionPromptId = config.extractionPromptId;
    this.summaryMergerPromptId = config.summaryMergerPromptId;
  }

  async extractMemories(conversation: ConversationMessage[]): Promise<ExtractionResult> {
    const conversationText = conversation
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n');

    const response = await this.client.chatCompletion({
      projectId: this.projectId,
      promptId: this.extractionPromptId,
      messages: [
        {
          role: 'user',
          content: { type: 'text', text: conversationText },
        },
      ],
    });

    try {
      const parsed = JSON.parse(response.response);
      return {
        memories: Array.isArray(parsed.memories)
          ? parsed.memories.map((m: Record<string, unknown>) => ({
              content: String(m.content ?? ''),
              memoryType: String(m.memoryType ?? m.memory_type ?? 'general'),
              importance: Number(m.importance ?? 5),
            }))
          : [],
      };
    } catch (error) {
      console.error('[MetrioExtractionProvider] Failed to parse extraction response:', {
        error: error instanceof Error ? error.message : error,
        response: response.response,
      });
      throw new Error(
        `Failed to parse memory extraction response: ${error instanceof Error ? error.message : 'Unknown error'}`
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

    return response.response;
  }
}
