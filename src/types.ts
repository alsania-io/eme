export interface MemoryEntry {
  id: string;
  text: string;
  embedding: number[];
  metadata: {
    agentId: string;
    namespace: string;
    tags: string[];
    visibility: 'private' | 'shared' | 'system';
    timestamp: number;
    version: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface GraphNode {
  id: string;
  type: 'concept' | 'event' | 'person' | 'tool' | 'task' | 'entity' | 'project' | 'state';
  name: string;
  properties: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  type: 'related_to' | 'is' | 'part_of' | 'changed_from' | 'updated_on' | 'owned_by' | 'assigned_to';
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
}

export interface MemoryGateFilter {
  prototypeSimilarity: number; // 0-1
  tfidfRelevance: number; // 0-1
  llmCompression?: string; // compressed/summarized version
  shouldSave: boolean;
}

export interface Config {
  embeddingModel: string;
  vectorStore: 'sqlite' | 'faiss' | 'memory';
  graphEnabled: boolean;
  snapshotPath: string;
  encryptionKey?: string;
  maxMemoryEntries: number;
  similarityThreshold: number;
}