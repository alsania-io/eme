// ENHANCED TYPES - CREATOR WORKFLOW SUPPORT

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

export interface GraphStats {
  totalNodes: number;
  totalEdges: number;
  nodeTypes: Array<{ type: string; count: number }>;
  edgeTypes: Array<{ type: string; count: number }>;
  namespaces: Array<{ namespace: string; count: number }>;
  density: number; // edges / possible edges
  lastUpdated: Date;
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
}

export interface MemoryGateFilter {
  prototypeSimilarity: number;
  tfidfRelevance: number;
  llmCompression?: string;
  shouldSave: boolean;
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

export interface NamespaceClearRequest {
  namespace: string;
  confirm?: boolean;
}

export interface Config {
  // Embedding configuration
  embeddingModel: "local" | "openai" | "cohere" | "huggingface";
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

  // Graph store configuration
  graphStore: "sqlite" | "jsonl" | "memory";
  graphStorePath?: string;

  // Snapshot configuration
  snapshotStore: "filesystem" | "ipfs" | "drive" | "s3";
  snapshotPath: string;
  snapshotConfig?: Record<string, any>;

  // Memory gate configuration
  memoryGateEnabled: boolean;
  memoryGateThreshold: number;

  // Security
  encryptionKey?: string;

  // General configuration
  maxMemoryEntries: number;
  similarityThreshold: number;
  logLevel: "debug" | "info" | "warn" | "error";
}

export interface GraphReadResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: GraphStats;
}

export interface BatchAddResponse {
  successful: number;
  failed: number;
  memoryIds: string[];
  errors: Array<{ index: number; error: string }>;
}

export interface NamespaceClearResponse {
  clearedNodes: number;
  clearedEdges: number;
  namespace: string;
  timestamp: Date;
}
