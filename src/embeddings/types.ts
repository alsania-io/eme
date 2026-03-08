export interface EmbeddingResult {
  vector: number[];
  dimension: number;
  model: string;
  provider: string;
  index?: number;
}

export interface EmbeddingProvider {
  embed(text: string): Promise<EmbeddingResult | number[]>;
  embedBatch?(texts: string[]): Promise<(EmbeddingResult | number[])[]>;
  getDimension(): number;
}