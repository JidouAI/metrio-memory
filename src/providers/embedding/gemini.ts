import type { EmbeddingProvider } from '../../types';
import { validateEmbedding } from './validate';

const DEFAULT_MODEL = 'gemini-embedding-001';
const BATCH_SIZE = 100;
const MODEL_PATTERN = /^[a-zA-Z0-9._-]+$/;

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model?: string) {
    this.apiKey = apiKey;
    this.model = model ?? DEFAULT_MODEL;

    if (!MODEL_PATTERN.test(this.model)) {
      throw new Error('Invalid model name');
    }
  }

  async embed(text: string): Promise<number[]> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:embedContent?key=${this.apiKey}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `models/${this.model}`,
        content: { parts: [{ text }] },
      }),
    });

    if (!res.ok) {
      throw new Error(`Gemini embedding failed with status ${res.status}`);
    }

    const data = await res.json();
    return validateEmbedding(data.embedding.values);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:batchEmbedContents?key=${this.apiKey}`;

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: batch.map((text) => ({
            model: `models/${this.model}`,
            content: { parts: [{ text }] },
          })),
        }),
      });

      if (!res.ok) {
        throw new Error(`Gemini batch embedding failed with status ${res.status}`);
      }

      const data = await res.json();
      results.push(
        ...data.embeddings.map((e: { values: number[] }) => validateEmbedding(e.values)),
      );
    }

    return results;
  }
}
