import {
  MemoryEntry,
  GraphNode,
  GraphEdge,
  SearchResult,
  MemoryGateFilter,
  Config,
  SnapshotMetadata,
  GraphStats,
} from "./types.js";
import { IVectorStore, createVectorStore } from "./vector-store.js";
import { IGraphStore, createGraphStore } from "./graph-store.js";
import { createSnapshotStore, ISnapshotStore } from "./snapshot-store.js";
import { randomUUID } from "crypto";

// Simple local embedding model simulation
// Remove duplicate import - already imported via openrouter
import { EmbeddingProvider as IEmbeddingProvider } from './embeddings/types.js';

class LocalEmbeddingModel implements IEmbeddingProvider {
  async embed(text: string): Promise<number[]> {
    const words = text.toLowerCase().split(/\s+/);
    const embedding = new Array(384).fill(0);
    words.forEach((word, idx) => {
      const hash = this.hashString(word);
      const position = hash % embedding.length;
      embedding[position] += 1 / (idx + 1);
    });

    const norm = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    if (norm > 0) {
      return embedding.map((val) => val / norm);
    }
    return embedding;
  }

  embedBatch?(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map(t => this.embed(t)));
  }

  getDimension(): number {
    return 384;
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }
}

import { OpenRouterEmbeddingProvider } from './embeddings/openrouter.js';

interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch?(texts: string[]): Promise<number[][]>;
  getDimension(): number;
}

class EmbeddingModel {
  private provider: EmbeddingProvider;
  private config: Config;
  private fallbackProvider: LocalEmbeddingModel;

  constructor(config: Config) {
    this.config = config;
    console.log('[EmbeddingModel] Config:', JSON.stringify({
      model: config.embeddingModel,
      dimension: config.embeddingDimension,
      hasApiKey: !!config.openRouterApiKey,
      modelPath: config.embeddingModelPath
    }, null, 2));
    this.fallbackProvider = new LocalEmbeddingModel();
    this.provider = this.createProvider();
    console.log('[EmbeddingModel] Using provider type:', this.provider.constructor.name);
  }

  private createProvider(): EmbeddingProvider {
    // Try to use configured provider
    if (this.config.embeddingModel === ('openrouter' as any) && this.config.openRouterApiKey) {
      try {
        console.log('[Embedding] Initializing OpenRouter provider');
        return new OpenRouterEmbeddingProvider({
          apiKey: this.config.openRouterApiKey,
          model: this.config.embeddingModelPath,
          dimension: this.config.embeddingDimension,
          referer: this.config.openRouterReferer,
          title: this.config.openRouterTitle,
        });
      } catch (error) {
        console.error('[Embedding] Failed to initialize OpenRouter, falling back to local:', error);
        return this.fallbackProvider;
      }
    }
    
    // Default to local
    console.log('[Embedding] Using local embedding model');
    return this.fallbackProvider;
  }

  async embed(text: string): Promise<number[]> {
    try {
      const embedding = await this.provider.embed(text);
      
      // Verify dimension matches config
      if (embedding.length !== this.config.embeddingDimension) {
        console.warn(`[Embedding] Dimension mismatch: got ${embedding.length}, expected ${this.config.embeddingDimension}`);
        
        // Try fallback if configured
        if (this.config.fallbackEmbeddingModel === 'local' && this.provider !== this.fallbackProvider) {
          console.log('[Embedding] Falling back to local model');
          return this.fallbackProvider.embed(text);
        }
      }
      
      return embedding;
    } catch (error) {
      console.error('[Embedding] Provider failed, using fallback:', error);
      return this.fallbackProvider.embed(text);
    }
  }

  getDimension(): number {
    return this.config.embeddingDimension;
  }
}

export interface MemoryManager {
  // Core Memory Methods
  addMemory(
    text: string,
    agentId: string,
    namespace: string,
    tags: string[],
    visibility: "private" | "shared" | "system",
  ): Promise<string>;
  searchMemories(
    query: string,
    limit: number,
    namespace?: string,
  ): Promise<SearchResult[]>;
  getMemory(id: string): Promise<MemoryEntry | null>;
  updateMemory(id: string, updates: Partial<MemoryEntry>): Promise<void>;
  deleteMemory(id: string): Promise<void>;

  // Graph Methods
  getGraph(): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }>;
  getGraphStats(): Promise<GraphStats>;

  // Entity & Relation Methods (Match MCP Server types)
  createEntities(
    entities: Array<{
      name?: string;
      observations?: string[];
      entityType?: string;
    }>,
  ): Promise<{ id: string; name: string }[]>;
  deleteEntities(entityNames: string[]): Promise<{ deleted: number }>;
  createRelations(
    relations: Array<{
      from?: string;
      to?: string;
      relationType?: string;
    }>,
  ): Promise<{ id: string }[]>;
  deleteRelations(
    relations: Array<{
      from?: string;
      to?: string;
      relationType?: string;
    }>,
  ): Promise<{ deleted: number }>;
  searchNodes(query: string, limit?: number): Promise<GraphNode[]>;
  openNodes(names: string[]): Promise<GraphNode[]>;

  // Observation Methods (Match MCP Server types)
  addObservations(
    observations: Array<{
      entityName?: string;
      contents?: string[];
    }>,
  ): Promise<string[]>;
  deleteObservations(
    deletions: Array<{
      observations?: string[];
      entityName?: string;
    }>,
  ): Promise<{ deleted: number }>;

  // Snapshot Methods
  createSnapshot(
    name: string,
    type: "memory" | "graph" | "full",
    description?: string,
  ): Promise<{ id: string; cid?: string; size: number }>;
  listSnapshots(
    type?: "memory" | "graph" | "full",
  ): Promise<SnapshotMetadata[]>;
  loadSnapshot(id: string): Promise<any | null>;
  deleteSnapshot(id: string): Promise<void>;

  // Lifecycle
  close(): Promise<void>;
}

class MemoryManagerImpl implements MemoryManager {
  private vectorStore: IVectorStore;
  private graphStore: IGraphStore;
  private snapshotStore: ISnapshotStore;
  private embeddingModel: EmbeddingModel;
  private config: Config;
  private initialized: boolean = false;

  constructor(config: Config) {
    this.config = config;
    this.embeddingModel = new EmbeddingModel(this.config);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.vectorStore = await createVectorStore(this.config);
    this.graphStore = createGraphStore();
    this.snapshotStore = await createSnapshotStore(this.config);

    if ("initialize" in this.graphStore) {
      await (this.graphStore as any).initialize();
    }

    this.initialized = true;
    console.log("[MemoryManager] Initialized with all stores");
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  private async memoryGateFilter(
    text: string,
    embedding: number[],
    metadata: {
      agentId: string;
      namespace: string;
      tags: string[];
      visibility: "private" | "shared" | "system";
    },
  ): Promise<MemoryGateFilter> {
    if (!this.config.memoryGateEnabled) {
      return {
        prototypeSimilarity: 1.0,
        tfidfRelevance: 1.0,
        shouldSave: true,
      };
    }
    const prototypeSimilarity = this.calculatePrototypeSimilarity(
      text,
      metadata,
    );
    const tfidfRelevance = await this.calculateTfidfRelevance(
      text,
      metadata.namespace,
    );
    const score = (prototypeSimilarity + tfidfRelevance) / 2;

    return {
      prototypeSimilarity,
      tfidfRelevance,
      shouldSave: score >= this.config.memoryGateThreshold,
    };
  }

  private calculatePrototypeSimilarity(
    text: string,
    metadata: { agentId: string },
  ): number {
    const ourPrototypes = [
      "sigma",
      "aegis",
      "shield",
      "working",
      "operational",
      "guardian",
      "creator",
      "user",
      "memory-cache",
      "ipfs",
      "helia",
      "cid",
      "ipns",
      "pin",
      "decentralized",
    ];
    const textLower = text.toLowerCase();
    let matches = 0;
    ourPrototypes.forEach((proto) => {
      if (textLower.includes(proto.toLowerCase())) {
        matches++;
      }
    });

    const creatorBoost =
      metadata.agentId === "aegis" || metadata.agentId === "sigma" ? 0.3 : 0;

    return Math.min(1.0, matches / ourPrototypes.length + creatorBoost);
  }

  private async calculateTfidfRelevance(
    _text: string,
    _namespace: string,
  ): Promise<number> {
    return 0.8;
  }

  async addMemory(
    text: string,
    agentId: string,
    namespace: string = "default",
    tags: string[] = [],
    visibility: "private" | "shared" | "system" = "shared",
  ): Promise<string> {
    await this.ensureInitialized();
    const embedding = await this.embeddingModel.embed(text);
    const metadata = {
      agentId,
      namespace,
      tags,
      visibility,
      timestamp: Date.now(),
      version: 1,
    };

    const filter = await this.memoryGateFilter(text, embedding, metadata);

    if (!filter.shouldSave) {
      throw new Error("Memory rejected by memory gate");
    }

    const id = await this.vectorStore.add({
      text: filter.llmCompression || text,
      embedding,
      metadata,
    });

    await this.graphStore.addNode({
      type: "entity",
      name: text.substring(0, 50) + (text.length > 50 ? "..." : ""),
      properties: {
        memoryId: id,
        text: filter.llmCompression || text,
        agentId,
        namespace,
        tags,
        visibility,
        timestamp: metadata.timestamp,
      },
    });

    return id;
  }

  async searchMemories(
    query: string,
    limit: number = 5,
    namespace?: string,
  ): Promise<SearchResult[]> {
    await this.ensureInitialized();
    const queryEmbedding = await this.embeddingModel.embed(query);
    const results = await this.vectorStore.search(
      queryEmbedding,
      limit,
      namespace,
    );

    return results.map((result) => ({
      memory: result.entry,
      score: result.score,
    }));
  }

  async getMemory(id: string): Promise<MemoryEntry | null> {
    await this.ensureInitialized();
    return this.vectorStore.get(id);
  }

  async updateMemory(id: string, updates: Partial<MemoryEntry>): Promise<void> {
    await this.ensureInitialized();
    await this.vectorStore.update(id, updates);
  }

  async deleteMemory(id: string): Promise<void> {
    await this.ensureInitialized();
    await this.vectorStore.delete(id);
  }

  async getGraph(): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
    await this.ensureInitialized();
    return this.graphStore.getGraph();
  }

  async getGraphStats(): Promise<GraphStats> {
    await this.ensureInitialized();
    return this.graphStore.getGraphStats();
  }

  // --- MCP Server Compatible Methods ---

  async createEntities(
    entities: Array<{
      name?: string;
      observations?: string[];
      entityType?: string;
    }>,
  ): Promise<{ id: string; name: string }[]> {
    await this.ensureInitialized();
    const results: { id: string; name: string }[] = [];

    for (const entity of entities) {
      const id = randomUUID();
      const name = entity.name || `entity-${id.substring(0, 8)}`;

      // Fix: Cast entityType to GraphNode["type"] to satisfy strict union type
      const type = (entity.entityType || "entity") as GraphNode["type"];

      await this.graphStore.addNode({
        type,
        name,
        properties: entity.observations
          ? { observations: entity.observations }
          : {},
      });
      results.push({ id, name });
    }

    return results;
  }

  async createRelations(
    relations: Array<{
      from?: string;
      to?: string;
      relationType?: string;
    }>,
  ): Promise<{ id: string }[]> {
    await this.ensureInitialized();
    const results: { id: string }[] = [];

    for (const relation of relations) {
      if (!relation.from || !relation.to) continue;
      const id = randomUUID();
      await (this.graphStore as any).addEdge({
        id,
        from: relation.from,
        to: relation.to,
        type: relation.relationType || "related",
        properties: {},
      });
      results.push({ id });
    }

    return results;
  }

  async addObservations(
    observations: Array<{
      entityName?: string;
      contents?: string[];
    }>,
  ): Promise<string[]> {
    await this.ensureInitialized();
    const ids: string[] = [];

    for (const obs of observations) {
      if (!obs.contents || obs.contents.length === 0) continue;
      for (const content of obs.contents) {
        const id = await this.addMemory(
          content,
          "mcp-server",
          obs.entityName || "observations",
          [],
          "shared",
        );
        ids.push(id);
      }
    }

    return ids;
  }

  async deleteEntities(entityNames: string[]): Promise<{ deleted: number }> {
    await this.ensureInitialized();
    let deleted = 0;

    for (const name of entityNames) {
      const graph = await this.graphStore.getGraph();
      const node = graph.nodes.find((n) => n.name === name);
      if (node) {
        await (this.graphStore as any).deleteNode(name);
        deleted++;
      }
    }

    return { deleted };
  }

  async deleteObservations(
    deletions: Array<{
      observations?: string[];
      entityName?: string;
    }>,
  ): Promise<{ deleted: number }> {
    await this.ensureInitialized();
    let deleted = 0;

    for (const deletion of deletions) {
      if (deletion.observations) {
        for (const obsId of deletion.observations) {
          try {
            await this.deleteMemory(obsId);
            deleted++;
          } catch {
            // Memory may not exist
          }
        }
      }
    }

    return { deleted };
  }

  async deleteRelations(
    relations: Array<{
      from?: string;
      to?: string;
      relationType?: string;
    }>,
  ): Promise<{ deleted: number }> {
    await this.ensureInitialized();
    let deleted = 0;

    for (const relation of relations) {
      if (!relation.from || !relation.to) continue;
      const graph = await this.graphStore.getGraph();
      const edge = graph.edges.find(
        (e) =>
          e.from === relation.from &&
          e.to === relation.to &&
          (!relation.relationType || e.type === relation.relationType),
      );
      if (edge) {
        await (this.graphStore as any).deleteEdge(edge.id);
        deleted++;
      }
    }

    return { deleted };
  }

  async searchNodes(query: string, limit: number = 10): Promise<GraphNode[]> {
    await this.ensureInitialized();
    const graph = await this.graphStore.getGraph();

    const queryLower = query.toLowerCase();
    const matches = graph.nodes.filter(
      (node) =>
        node.name.toLowerCase().includes(queryLower) ||
        JSON.stringify(node.properties).toLowerCase().includes(queryLower),
    );

    return matches.slice(0, limit);
  }

  async openNodes(names: string[]): Promise<GraphNode[]> {
    await this.ensureInitialized();
    const graph = await this.graphStore.getGraph();

    return graph.nodes.filter((node) => names.includes(node.name));
  }

  // --- Snapshot Methods ---

  async createSnapshot(
    name: string,
    type: "memory" | "graph" | "full",
    description?: string,
  ): Promise<{ id: string; cid?: string; size: number }> {
    await this.ensureInitialized();
    let data: any;
    if (type === "memory") {
      data = await this.vectorStore.getAll();
    } else if (type === "graph") {
      data = await this.graphStore.getGraph();
    } else {
      data = {
        memories: await this.vectorStore.getAll(),
        graph: await this.graphStore.getGraph(),
      };
    }

    return this.snapshotStore.saveSnapshot(name, data, type, description);
  }

  async listSnapshots(
    type?: "memory" | "graph" | "full",
  ): Promise<SnapshotMetadata[]> {
    await this.ensureInitialized();
    return this.snapshotStore.listSnapshots(type);
  }

  async loadSnapshot(id: string): Promise<any | null> {
    await this.ensureInitialized();
    return this.snapshotStore.loadSnapshot(id);
  }

  async deleteSnapshot(id: string): Promise<void> {
    await this.ensureInitialized();
    await this.snapshotStore.deleteSnapshot(id);
  }

  async close(): Promise<void> {
    if (this.vectorStore && "close" in this.vectorStore) {
      await this.vectorStore.close?.();
    }
    if (this.graphStore && "close" in this.graphStore) {
      await (this.graphStore as any).close?.();
    }
    if (this.snapshotStore) {
      await this.snapshotStore.close();
    }
    this.initialized = false;
  }
}

export async function createMemoryManager(
  config: Config,
): Promise<MemoryManager> {
  const manager = new MemoryManagerImpl(config);
  await manager.initialize();
  return manager;
}
