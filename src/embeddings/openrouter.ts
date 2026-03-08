import OpenAI from 'openai';
import { EmbeddingProvider, EmbeddingResult } from './types.js';

export class OpenRouterEmbeddingProvider implements EmbeddingProvider {
  private client: OpenAI;
  private model: string;
  private dimension: number;

  constructor(config: {
    apiKey?: string;
    model?: string;
    dimension?: number;
    referer?: string;
    title?: string;
  }) {
    // Get API key from config or environment
    const apiKey = config.apiKey || process.env.OPENROUTER_API_KEY;
    
    if (!apiKey) {
      throw new Error('OpenRouter API key is required. Set OPENROUTER_API_KEY in .env or pass it in config.');
    }
    
    this.client = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: apiKey,
      defaultHeaders: {
        'HTTP-Referer': config.referer || process.env.OPENROUTER_REFERER || 'https://alsania-io.com',
        'X-Title': config.title || process.env.OPENROUTER_TITLE || 'Echo Memory Engine',
      },
    });
    this.model = config.model || 'nvidia/llama-nemotron-embed-vl-1b-v2:free';
    this.dimension = config.dimension || 1024; // Nvidia model uses 1024 dimensions
    console.log('[OpenRouter] Initialized with dimension:', this.dimension, 'model:', this.model);
  }

  async embed(text: string): Promise<number[]> {
    try {
      console.log('[OpenRouter] Sending request with model:', this.model);
      const response = await this.client.embeddings.create({
        model: this.model,
        input: text,
        encoding_format: 'float'
      });
      
      console.log('[OpenRouter] Response received:', {
        hasData: !!response.data,
        dataLength: response.data?.length,
        model: response.model
      });

      if (!response.data || !response.data[0]) {
        console.error('[OpenRouter] Invalid response structure:', JSON.stringify(response, null, 2));
        throw new Error('Invalid response from OpenRouter');
      }

      return response.data[0].embedding;
    } catch (error) {
      console.error('[OpenRouter] Embedding error:', error);
      throw new Error(`OpenRouter embedding failed: ${error.message}`);
    }
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    try {
      const response = await this.client.embeddings.create({
        model: this.model,
        input: texts,
      });

      return response.data.map(item => item.embedding);
    } catch (error) {
      throw new Error(`OpenRouter batch embedding failed: ${error.message}`);
    }
  }

  getDimension(): number {
    return this.dimension;
  }
}