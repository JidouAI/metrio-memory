export function validateEmbedding(values: unknown): number[] {
  if (!Array.isArray(values)) {
    throw new Error('Invalid embedding: expected an array');
  }

  return values.map((v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) {
      throw new Error('Invalid embedding: contains non-finite value');
    }
    return n;
  });
}
