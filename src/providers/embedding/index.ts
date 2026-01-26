import type { EmbeddingConfig, EmbeddingProvider } from '../../types';
import { GeminiEmbeddingProvider } from './gemini';
import { OpenAIEmbeddingProvider } from './openai';

export function createEmbeddingProvider(config: EmbeddingConfig): EmbeddingProvider {
  switch (config.provider) {
    case 'gemini':
      return new GeminiEmbeddingProvider(config.apiKey, config.model);
    case 'openai':
      return new OpenAIEmbeddingProvider(config.apiKey, config.model);
    default:
      throw new Error(`Unknown embedding provider: ${config.provider}`);
  }
}
