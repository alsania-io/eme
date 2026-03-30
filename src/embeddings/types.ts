/**
 * Embedding provider interface — all providers must implement this.
 * All implementations MUST return number[] from embed().
 */
export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch?(texts: string[]): Promise<number[][]>;
  getDimension(): number;
}
