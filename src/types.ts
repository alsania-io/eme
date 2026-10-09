export interface MemoryEntry {
  id: string;
  text: string;
  embedding: number[];
  metadata: {
    agentId: string;
    namespace: string;
    tags: string[];
    visibility: "private" | "shared" | "system";
    timestamp: number;
    version: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface GraphNode {
  id: string;
  type:
    | "concept"
    | "event"
    | "person"
    | "tool"
    | "task"
    | "entity"
    | "project"
    | "state";
  name: string;
  properties: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  type:
    | "related_to"
    | "is"
    | "part_of"
    | "changed_from"
    | "updated_on"
    | "owned_by"
    | "assigned_to";
  weight: number;
  properties: Record<string, any>;
  createdAt: Date;
}

export interface SearchResult {
  memory: MemoryEntry;
  score: number;
  graphContext?: GraphNode[];
}

export interface Snapshot {
  id: string;
  name: string;
  description?: string;
  tags: string[];
  timestamp: number;
  size: number;
  checksum: string;
  cid?: string;
}

export interface SnapshotMetadata {
  id: string;
  name: string;
  description?: string;
  timestamp: number;
  cid?: string;
  size: number;
  type: "memory" | "graph" | "full";
}

export interface MemoryGateFilter {
  prototypeSimilarity: number;
  tfidfRelevance: number;
  llmCompression?: string;
  shouldSave: boolean;
}

export interface GraphStats {
  totalNodes: number;
  totalEdges: number;
  nodeTypes: Array<{ type: string; count: number }>;
  edgeTypes: Array<{ type: string; count: number }>;
  namespaces: Array<{ namespace: string; count: number }>;
  density: number;
  lastUpdated: Date;
}

export interface IGraphStore {
  // Core Node Methods
  addNode(
    node: Omit<GraphNode, "id" | "createdAt" | "updatedAt">,
  ): Promise<string>;
  getNode(id: string): Promise<GraphNode | null>;
  updateNode(id: string, updates: Partial<GraphNode>): Promise<boolean>;
  deleteNode(id: string): Promise<boolean>;

  // Core Edge Methods
  addEdge(edge: Omit<GraphEdge, "id" | "createdAt">): Promise<string>;
  getEdge(id: string): Promise<GraphEdge | null>;
  updateEdge(id: string, updates: Partial<GraphEdge>): Promise<boolean>;
  deleteEdge(id: string): Promise<boolean>;

  // Query Methods
  findNodes(
    type?: string,
    properties?: Record<string, any>,
  ): Promise<GraphNode[]>;
  findEdges(from?: string, to?: string, type?: string): Promise<GraphEdge[]>;
  getNeighbors(
    nodeId: string,
    edgeType?: string,
  ): Promise<{ node: GraphNode; edge: GraphEdge }[]>;

  // Graph Methods
  getAllNodes(): Promise<GraphNode[]>;
  getAllEdges(): Promise<GraphEdge[]>;
  getGraph(): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }>;
  getGraphStats(): Promise<GraphStats>;
  clear(): Promise<void>;

  // Enhanced Methods (Creator Workflow)
  clearNamespace(namespace: string): Promise<number>;
  findNodesByNamespace(namespace: string): Promise<GraphNode[]>;
  batchAddNodes(
    nodes: Omit<GraphNode, "id" | "createdAt" | "updatedAt">[],
  ): Promise<string[]>;
  batchAddEdges(
    edges: Omit<GraphEdge, "id" | "createdAt">[],
  ): Promise<string[]>;

  // Optional Lifecycle
  createSnapshot?(
    name: string,
  ): Promise<{ id: string; cid?: string; size: number }>;
  close?(): Promise<void>;
}

export interface IVectorStore {
  add(
    entry: Omit<MemoryEntry, "id" | "createdAt" | "updatedAt">,
  ): Promise<string>;
  search(
    queryEmbedding: number[],
    limit: number,
    namespace?: string,
  ): Promise<Array<{ entry: MemoryEntry; score: number }>>;
  get(id: string): Promise<MemoryEntry | null>;
  update(id: string, updates: Partial<MemoryEntry>): Promise<boolean>;
  delete(id: string): Promise<boolean>;
  list(
    namespace?: string,
    limit?: number,
    offset?: number,
  ): Promise<MemoryEntry[]>;
  getAll(): Promise<MemoryEntry[]>;
  clear(): Promise<void>;
  close?(): Promise<void>;
}

export interface ISnapshotStore {
  saveSnapshot(
    name: string,
    data: any,
    type: "memory" | "graph" | "full",
    description?: string,
    metadata?: Record<string, any>,
  ): Promise<{ id: string; cid?: string; size: number }>;
  loadSnapshot(id: string): Promise<any | null>;
  listSnapshots(
    type?: "memory" | "graph" | "full",
  ): Promise<SnapshotMetadata[]>;
  deleteSnapshot(id: string): Promise<boolean>;
  getStats(): Promise<{
    snapshotCount: number;
    totalSize: number;
    [key: string]: any;
  }>;
  close(): Promise<void>;
}

export interface IPFSConfig {
  heliaConfig?: Record<string, any>;
  ipfsGateway?: string;
  ipfsToken?: string;
  ipfsPinningService?: string;
  ipfsPinToken?: string;
  namespace?: string;
}

export interface Config {
  // Embedding configuration
  embeddingModel: "local" | "openai" | "cohere" | "huggingface" | "openrouter";
  embeddingModelPath?: string;
  embeddingDimension: number;

  // Vector store configuration
  vectorStore:
    | "sqlite"
    | "postgres"
    | "qdrant"
    | "lancedb"
    | "memory"
    | "faiss";
  vectorStorePath?: string;
  postgresConnection?: string;
  qdrantUrl?: string;
  qdrantCollection?: string;
  qdrantVectorName?: string; // Named vector for multivector collections (default: uses single vector)

  // Graph store configuration
  graphStore: "sqlite" | "jsonl" | "memory";
  graphStorePath?: string;

  // Snapshot configuration
  snapshotStore: "filesystem" | "ipfs" | "drive" | "s3" | "filebase";
  snapshotPath?: string;
  snapshotConfig?: IPFSConfig;

  // Memory gate configuration
  memoryGateEnabled: boolean;
  memoryGateThreshold: number;

  // Security
  encryptionKey?: string;

  // General configuration
  maxMemoryEntries: number;
  similarityThreshold: number;
  logLevel: "debug" | "info" | "warn" | "error";

  // OpenRouter
  openRouterApiKey?: string;
  openRouterReferer?: string;
  openRouterTitle?: string;

  // Fallback embeddings
  fallbackEmbeddingModel?:
    | "local"
    | "openai"
    | "cohere"
    | "huggingface"
    | "openrouter";
  fallbackEmbeddingDimension?: number;

  // Enhanced Protocol — tier configuration
  tierHotLimit: number;
  tierWarmLimit: number;
  snapshotIntervalMs: number;
  sessionContinuityEnabled: boolean;
}

// --- Enhanced Protocol types (Phase 1) ---

/** Memory tier. hot = in-process Map; warm = SQLite; cold = Qdrant only. */
export type Tier = "hot" | "warm" | "cold";

/**
 * Data classes routed by the storage router.
 * Phase 1 only classifies; Phase 2+ routes to backends.
 */
export type DataClass =
  | "immutable"
  | "archive"
  | "vector"
  | "secret"
  | "mirror"
  | "disposable";

/** Auto-capture request — maps onto addMemory with a classified data class. */
export interface CaptureRequest {
  text: string;
  context?: string;
  priority?: "high" | "medium" | "low";
  tags?: string[];
  namespace?: string;
  agentId?: string;
  visibility?: "private" | "shared" | "system";
}

/** Result of classifying a capture request. */
export interface CaptureClassification {
  dataClass: DataClass;
  tier: Tier;
  priority: "high" | "medium" | "low";
  shouldSave: boolean;
  reason: string;
}

/** A tier-aware search result carries which tier it came from. */
export interface TieredSearchResult extends SearchResult {
  tier: Tier;
}

// MCP Server Request/Response Types
export interface GraphReadResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: GraphStats;
}

export interface BatchMemoryRequest {
  memories: Array<{
    text: string;
    agentId?: string;
    namespace?: string;
    tags?: string[];
    visibility?: "private" | "shared" | "system";
    forceSave?: boolean;
  }>;
}

export interface BatchAddResponse {
  successful: number;
  failed: number;
  memoryIds: string[];
  errors: Array<{ index: number; error: string }>;
}

export interface NamespaceClearRequest {
  namespace: string;
  confirm?: boolean;
}

export interface NamespaceClearResponse {
  clearedNodes: number;
  clearedEdges: number;
  namespace: string;
  timestamp: Date;
}
