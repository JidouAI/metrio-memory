import type { ExtractionConfig, ExtractionProvider } from '../../types';
import { MetrioExtractionProvider } from './metrio';

export function createExtractionProvider(config: ExtractionConfig): ExtractionProvider | null {
  if (config.customExtractor) {
    return config.customExtractor;
  }

  switch (config.provider) {
    case 'metrio':
      if (!config.apiKey || !config.projectId) {
        throw new Error('Metrio extraction requires apiKey and projectId. Prompt IDs (extractionPromptId, summaryMergerPromptId, memoryUpdatePromptId) are validated lazily when their respective method is called.');
      }
      return new MetrioExtractionProvider({
        apiKey: config.apiKey,
        projectId: config.projectId,
        extractionPromptId: config.extractionPromptId,
        summaryMergerPromptId: config.summaryMergerPromptId,
        memoryUpdatePromptId: config.memoryUpdatePromptId,
        baseUrl: config.baseUrl,
      });
    case 'custom':
      return null;
    default:
      throw new Error(`Unknown extraction provider: ${config.provider}`);
  }
}
