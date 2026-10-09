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

import { EmbeddingProvider } from './embeddings/types.js';
import { OpenRouterEmbeddingProvider } from './embeddings/openrouter.js';
import { TierStore, PruneReport, TierEntry } from './tier-store.js';
import { classifyCapture } from './capture-classifier.js';
import type { CaptureRequest, CaptureClassification } from './types.js';

/**
 * Local embedding model — hash-based fallback.
 * Dimension is configurable via constructor to match config.embeddingDimension.
 */
class LocalEmbeddingModel implements EmbeddingProvider {
  private readonly dim: number;

  constructor(dimension: number = 384) {
    this.dim = dimension;
  }

  async embed(text: string): Promise<number[]> {
    const words = text.toLowerCase().split(/\s+/);
    const embedding = new Array(this.dim).fill(0);
    words.forEach((word, idx) => {
      const hash = this.hashString(word);
      const position = hash % this.dim;
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
    return this.dim;
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

/**
 * EmbeddingModel wraps a primary provider with fallback and dimension validation.
 */
class EmbeddingModel {
  private provider: EmbeddingProvider;
  private config: Config;
  private fallbackProvider: LocalEmbeddingModel;

  constructor(config: Config) {
    this.config = config;
    this.fallbackProvider = new LocalEmbeddingModel(this.config.embeddingDimension);
    this.provider = this.createProvider();
  }

  /**
   * Recreate the provider from current config.
   * Call this after config changes to swap embedding model at runtime.
   */
  reconfigure(config: Config): void {
    this.config = config;
    this.fallbackProvider = new LocalEmbeddingModel(this.config.embeddingDimension);
    this.provider = this.createProvider();
  }

  private createProvider(): EmbeddingProvider {
    // Try to use configured provider
    if (this.config.embeddingModel === 'openrouter' && this.config.openRouterApiKey) {
      try {
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

        // Pad or truncate to match expected dimension
        if (embedding.length < this.config.embeddingDimension) {
          const padded = new Array(this.config.embeddingDimension).fill(0);
          for (let i = 0; i < embedding.length; i++) padded[i] = embedding[i];
          return padded;
        } else {
          return embedding.slice(0, this.config.embeddingDimension);
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

  /** Returns true if the current provider is the local fallback */
  isUsingFallback(): boolean {
    return this.provider === this.fallbackProvider;
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
  updateMemory(id: string, updates: Partial<MemoryEntry>): Promise<boolean>;
  deleteMemory(id: string): Promise<void>;

  // Vector Store Access
  getVectorStore(): IVectorStore;

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

  // Reconfiguration — allows swapping embedding model/dimension at runtime
  reinitialize(config: Config): Promise<void>;

  // Expose embedding for consumers like LocalRAG
  embed(text: string): Promise<number[]>;

  // --- Enhanced Protocol (Phase 1) ---
  /** Classify + store in one call. Returns classification and stored id (or null). */
  capture(
    req: CaptureRequest,
  ): Promise<{ classification: CaptureClassification; id: string | null }>;
  /** Entries within the last `hours`, newest first (spans all tiers). */
  getRecent(hours: number, limit: number): TierEntry[];
  /** Re-enforce tier bounds. Never deletes. Returns what moved. */
  prune(): PruneReport;
  tierHotCount(): number;
  tierWarmCount(): number;
  tierColdCount(): number;
}

class MemoryManagerImpl implements MemoryManager {
  private vectorStore!: IVectorStore;
  private graphStore!: IGraphStore;
  private snapshotStore!: ISnapshotStore;
  private embeddingModel: EmbeddingModel;
  private config: Config;
  private initialized: boolean = false;
  private tiers: TierStore;
  /** Last assigned timestamp — guarantees strictly increasing order within a run. */
  private lastTimestamp: number = 0;

  constructor(config: Config) {
    this.config = config;
    this.embeddingModel = new EmbeddingModel(this.config);
    this.tiers = new TierStore({
      hotLimit: config.tierHotLimit ?? 100,
      warmLimit: config.tierWarmLimit ?? 500,
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.vectorStore = await createVectorStore(this.config);
    this.graphStore = createGraphStore(this.config.graphStore === "memory");
    this.snapshotStore = await createSnapshotStore(this.config);

    if ("initialize" in this.graphStore) {
      await (this.graphStore as any).initialize();
    }

    this.initialized = true;
  }

  /**
   * Reinitialize with a new config.
   * Closes existing stores and recreates everything.
   * WARNING: If embedding dimension changed, existing data may be incompatible.
   */
  async reinitialize(config: Config): Promise<void> {
    const oldDimension = this.config.embeddingDimension;
    const newDimension = config.embeddingDimension;
    const dimensionChanged = oldDimension !== newDimension;

    // Close existing stores
    if (this.initialized) {
      await this.close();
    }

    // Update config
    this.config = config;
    this.embeddingModel.reconfigure(config);

    if (dimensionChanged) {
      console.warn(
        `[MemoryManager] Embedding dimension changed from ${oldDimension} to ${newDimension}. ` +
        `Existing stored vectors may be incompatible. Consider clearing the vector store.`
      );
    }

    // Reinitialize stores
    await this.initialize();
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
    // Monotonic timestamp: two adds in the same millisecond must still order.
    const now = Date.now();
    this.lastTimestamp = now > this.lastTimestamp ? now : this.lastTimestamp + 1;
    const metadata = {
      agentId,
      namespace,
      tags,
      visibility,
      timestamp: this.lastTimestamp,
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

    // Enhanced Protocol: place into the in-process tier store. Placement is a
    // cache/priority concern only — durability is the vector store's job.
    this.tiers.put({
      id,
      text: filter.llmCompression || text,
      namespace,
      tags,
      priority: "medium",
      timestamp: metadata.timestamp,
      tier: "hot",
    });

    return id;
  }

  /**
   * Strip the raw embedding vector from a memory entry before it crosses the
   * manager boundary. Embeddings are an internal concern — callers that need
   * one must use embed(). Returning 2048-float vectors to MCP clients is pure
   * token waste (a single search could otherwise emit ~20k tokens of floats).
   *
   * NOTE: This is the boundary policy: no raw vectors leave MemoryManager.
   * If a future store returns vectors lazily, that is a store-level concern.
   */
  private stripEmbedding(entry: MemoryEntry | null): MemoryEntry | null {
    if (!entry) return null;
    const { embedding: _embedding, ...rest } = entry;
    return { ...rest, embedding: [] } as MemoryEntry;
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
      memory: this.stripEmbedding(result.entry)!,
      score: result.score,
    }));
  }

  async getMemory(id: string): Promise<MemoryEntry | null> {
    await this.ensureInitialized();
    return this.stripEmbedding(await this.vectorStore.get(id));
  }

  async updateMemory(id: string, updates: Partial<MemoryEntry>): Promise<boolean> {
    await this.ensureInitialized();
    return await this.vectorStore.update(id, updates);
  }

  async deleteMemory(id: string): Promise<void> {
    await this.ensureInitialized();
    await this.vectorStore.delete(id);
  }

  getVectorStore(): IVectorStore {
    if (!this.vectorStore) {
      throw new Error("Vector store not initialized");
    }
    return this.vectorStore;
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

    const graph = await this.graphStore.getGraph();
    for (const name of entityNames) {
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

    const graph = await this.graphStore.getGraph();
    for (const relation of relations) {
      if (!relation.from || !relation.to) continue;
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

  // --- Enhanced Protocol (Phase 1) ---

  async capture(
    req: CaptureRequest,
  ): Promise<{ classification: CaptureClassification; id: string | null }> {
    await this.ensureInitialized();
    const classification = classifyCapture(req);
    if (!classification.shouldSave || !req.text || req.text.trim().length === 0) {
      return { classification, id: null };
    }
    const id = await this.addMemory(
      req.text,
      req.agentId ?? "unknown",
      req.namespace ?? "default",
      req.tags ?? [],
      req.visibility ?? "shared",
    );
    // Apply the classifier's priority to the just-placed hot entry.
    const placed = this.tiers.get(id);
    if (placed) {
      placed.priority = classification.priority;
      this.tiers.prune();
    }
    return { classification, id };
  }

  getRecent(hours: number = 24, limit: number = 20): TierEntry[] {
    return this.tiers.getRecent(hours, limit);
  }

  prune(): PruneReport {
    return this.tiers.prune();
  }

  tierHotCount(): number {
    return this.tiers.hotCount();
  }

  tierWarmCount(): number {
    return this.tiers.warmCount();
  }

  tierColdCount(): number {
    return this.tiers.coldCount();
  }

  /** Expose embedding computation for consumers like LocalRAG */
  async embed(text: string): Promise<number[]> {
    return this.embeddingModel.embed(text);
  }
}

export async function createMemoryManager(
  config: Config,
): Promise<MemoryManager> {
  const manager = new MemoryManagerImpl(config);
  await manager.initialize();
  return manager;
}
