import type { EmbeddingProvider } from '../../types';
import { validateEmbedding } from './validate';

const DEFAULT_MODEL = 'text-embedding-3-large';
const VECTOR_DIMENSIONS = 3072;

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model?: string) {
    this.apiKey = apiKey;
    this.model = model ?? DEFAULT_MODEL;
  }

  async embed(text: string): Promise<number[]> {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: text,
        dimensions: VECTOR_DIMENSIONS,
      }),
    });

    if (!res.ok) {
      throw new Error(`OpenAI embedding failed with status ${res.status}`);
    }

    const data = await res.json();
    return validateEmbedding(data.data[0].embedding);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
        dimensions: VECTOR_DIMENSIONS,
      }),
    });

    if (!res.ok) {
      throw new Error(`OpenAI batch embedding failed with status ${res.status}`);
    }

    const data = await res.json();
    return data.data
      .sort((a: { index: number }, b: { index: number }) => a.index - b.index)
      .map((item: { embedding: number[] }) => validateEmbedding(item.embedding));
  }
}
