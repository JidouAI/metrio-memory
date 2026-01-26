import type { ExtractionConfig, ExtractionProvider } from '../../types';
import { MetrioExtractionProvider } from './metrio';

export function createExtractionProvider(config: ExtractionConfig): ExtractionProvider | null {
  if (config.customExtractor) {
    return config.customExtractor;
  }

  switch (config.provider) {
    case 'metrio':
      if (!config.apiKey || !config.projectId || !config.extractionPromptId || !config.summaryMergerPromptId) {
        throw new Error('Metrio extraction requires apiKey, projectId, extractionPromptId, and summaryMergerPromptId');
      }
      return new MetrioExtractionProvider({
        apiKey: config.apiKey,
        projectId: config.projectId,
        extractionPromptId: config.extractionPromptId,
        summaryMergerPromptId: config.summaryMergerPromptId,
        baseUrl: config.baseUrl,
      });
    case 'custom':
      return null;
    default:
      throw new Error(`Unknown extraction provider: ${config.provider}`);
  }
}
