import { MemoryEntry, Config } from "./types.js";
import { randomUUID } from "crypto";
import { QdrantClient } from "@qdrant/js-client-rest";

// Type alias for better-sqlite3 Database instance (dynamically imported)
type SQLiteDatabase = InstanceType<typeof import("better-sqlite3")>;

// Simple LRU cache for embeddings
class LRUCache<K, V> {
  private cache = new Map<K, V>();
  private capacity: number;

  constructor(capacity: number = 1000) {
    this.capacity = capacity;
  }

  get(key: K): V | undefined {
    if (!this.cache.has(key)) return undefined;

    const value = this.cache.get(key)!;
    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.capacity) {
      // Remove least recently used (first key)
      const firstKey = this.cache.keys().next().value as K;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  clear(): void {
    this.cache.clear();
  }

  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  get size(): number {
    return this.cache.size;
  }
}

interface VectorRow {
  id: string;
  text: string;
  embedding: Buffer;
  agent_id: string;
  namespace: string;
  tags: string;
  visibility: string;
  timestamp: number;
  version: number;
  created_at: string;
  updated_at: string;
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

/**
 * SQLiteVectorStore - Vector store implementation using SQLite with better-sqlite3
 */
export class SQLiteVectorStore implements IVectorStore {
  private db: SQLiteDatabase | null = null;
  private readonly tableName = "memories";
  private embeddingCache: LRUCache<string, number[]>;

  constructor(private config: Config) {
    const cacheSize = (config as any).cacheSize || 1000;
    this.embeddingCache = new LRUCache<string, number[]>(cacheSize);
  }

  async initialize(): Promise<void> {
    this.embeddingCache.clear();
    const dbPath = this.config.vectorStorePath || ":memory:";

    const Database = (await import("better-sqlite3")).default;
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");

    console.log(`[SQLite] Database initialized at: ${dbPath}`);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        embedding BLOB NOT NULL,
        agent_id TEXT NOT NULL,
        namespace TEXT NOT NULL,
        tags TEXT,
        visibility TEXT CHECK(visibility IN ('private', 'shared', 'system')),
        timestamp INTEGER NOT NULL,
        version INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_namespace ON ${this.tableName}(namespace)`,
    );
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_agent_id ON ${this.tableName}(agent_id)`,
    );
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_timestamp ON ${this.tableName}(timestamp)`,
    );
  }

  private getEmbeddingFromRow(
    row: { embedding: Buffer },
    id: string,
  ): number[] {
    const cached = this.embeddingCache.get(id);
    if (cached) {
      return cached;
    }

    const embeddingArray = Array.from(new Float32Array(row.embedding.buffer));
    this.embeddingCache.set(id, embeddingArray);
    return embeddingArray;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error("Vectors must have the same length");
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (normA * normB);
  }

  async add(
    entry: Omit<MemoryEntry, "id" | "createdAt" | "updatedAt">,
  ): Promise<string> {
    if (!this.db) throw new Error("Database not initialized");

    // Validate embedding dimension matches config
    if (entry.embedding.length > 0 && entry.embedding.length !== this.config.embeddingDimension) {
      throw new Error(
        `[SQLite] Embedding dimension mismatch: got ${entry.embedding.length}, expected ${this.config.embeddingDimension}. ` +
        `Set EMBEDDING_DIMENSION to match your embedding model output.`
      );
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const embeddingBuffer = Buffer.from(
      new Float32Array(entry.embedding).buffer,
    );

    const stmt = this.db.prepare(
      `INSERT INTO ${this.tableName} (id, text, embedding, agent_id, namespace, tags, visibility, timestamp, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    stmt.run(
      id,
      entry.text,
      embeddingBuffer,
      entry.metadata.agentId,
      entry.metadata.namespace,
      JSON.stringify(entry.metadata.tags),
      entry.metadata.visibility,
      entry.metadata.timestamp,
      entry.metadata.version,
      now,
      now,
    );

    this.embeddingCache.set(id, entry.embedding);

    return id;
  }

  async getAll(): Promise<MemoryEntry[]> {
    if (!this.db) throw new Error("Database not initialized");

    const rows = this.db
      .prepare(`SELECT * FROM ${this.tableName}`)
      .all() as VectorRow[];

    return rows.map((row) => {
      const embeddingArray = this.getEmbeddingFromRow(row, row.id);
      return {
        id: row.id,
        text: row.text,
        embedding: embeddingArray,
        metadata: {
          agentId: row.agent_id,
          namespace: row.namespace,
          tags: JSON.parse(row.tags || "[]"),
          visibility: row.visibility as "private" | "shared" | "system",
          timestamp: row.timestamp,
          version: row.version,
        },
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
      };
    });
  }

  async search(
    queryEmbedding: number[],
    limit: number = 5,
    namespace?: string,
  ): Promise<Array<{ entry: MemoryEntry; score: number }>> {
    if (!this.db) throw new Error("Database not initialized");

    const candidateQuery = namespace
      ? `SELECT id, embedding FROM ${this.tableName} WHERE namespace = ? LIMIT ?`
      : `SELECT id, embedding FROM ${this.tableName} LIMIT ?`;

    const candidateParams = namespace ? [namespace, limit * 10] : [limit * 10];

    const candidateRows = namespace
      ? (this.db.prepare(candidateQuery).all(...candidateParams) as {
          id: string;
          embedding: Buffer;
        }[])
      : (this.db.prepare(candidateQuery).all(candidateParams[0]) as {
          id: string;
          embedding: Buffer;
        }[]);

    const scoredCandidates = candidateRows.map((row) => {
      const embeddingArray = this.getEmbeddingFromRow(row, row.id);
      const score = this.cosineSimilarity(queryEmbedding, embeddingArray);
      return { id: row.id, score };
    });

    const topIds = scoredCandidates
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((candidate) => candidate.id);

    if (topIds.length === 0) {
      return [];
    }

    const placeholders = topIds.map(() => "?").join(",");
    const finalQuery = `SELECT * FROM ${this.tableName} WHERE id IN (${placeholders})`;
    const finalRows = this.db.prepare(finalQuery).all(...topIds) as VectorRow[];

    const results = finalRows.map((row) => {
      const embeddingArray = this.getEmbeddingFromRow(row, row.id);
      const score = this.cosineSimilarity(queryEmbedding, embeddingArray);

      const entry: MemoryEntry = {
        id: row.id,
        text: row.text,
        embedding: embeddingArray,
        metadata: {
          agentId: row.agent_id,
          namespace: row.namespace,
          tags: JSON.parse(row.tags || "[]"),
          visibility: row.visibility as "private" | "shared" | "system",
          timestamp: row.timestamp,
          version: row.version,
        },
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
      };

      return { entry, score };
    });

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .filter(
        (result) => result.score >= (this.config.similarityThreshold || 0.3),
      );
  }

  async get(id: string): Promise<MemoryEntry | null> {
    if (!this.db) throw new Error("Database not initialized");

    const row = this.db
      .prepare(`SELECT * FROM ${this.tableName} WHERE id = ?`)
      .get(id) as VectorRow | undefined;

    if (!row) return null;

    const embeddingArray = this.getEmbeddingFromRow(row, row.id);

    return {
      id: row.id,
      text: row.text,
      embedding: embeddingArray,
      metadata: {
        agentId: row.agent_id,
        namespace: row.namespace,
        tags: JSON.parse(row.tags || "[]"),
        visibility: row.visibility as "private" | "shared" | "system",
        timestamp: row.timestamp,
        version: row.version,
      },
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  async update(id: string, updates: Partial<MemoryEntry>): Promise<boolean> {
    if (!this.db) throw new Error("Database not initialized");

    const setClauses: string[] = [];
    const values: any[] = [];
    const now = new Date().toISOString();

    if (updates.text !== undefined) {
      setClauses.push("text = ?");
      values.push(updates.text);
    }

    if (updates.embedding !== undefined) {
      setClauses.push("embedding = ?");
      values.push(Buffer.from(new Float32Array(updates.embedding).buffer));
      this.embeddingCache.set(id, updates.embedding);
    }

    if (updates.metadata) {
      if (updates.metadata.agentId !== undefined) {
        setClauses.push("agent_id = ?");
        values.push(updates.metadata.agentId);
      }
      if (updates.metadata.namespace !== undefined) {
        setClauses.push("namespace = ?");
        values.push(updates.metadata.namespace);
      }
      if (updates.metadata.tags !== undefined) {
        setClauses.push("tags = ?");
        values.push(JSON.stringify(updates.metadata.tags));
      }
      if (updates.metadata.visibility !== undefined) {
        setClauses.push("visibility = ?");
        values.push(updates.metadata.visibility);
      }
      if (updates.metadata.timestamp !== undefined) {
        setClauses.push("timestamp = ?");
        values.push(updates.metadata.timestamp);
      }
      if (updates.metadata.version !== undefined) {
        setClauses.push("version = ?");
        values.push(updates.metadata.version);
      }
    }

    setClauses.push("updated_at = ?");
    values.push(now);

    if (setClauses.length === 0) {
      return false;
    }

    values.push(id);
    const stmt = this.db.prepare(
      `UPDATE ${this.tableName} SET ${setClauses.join(", ")} WHERE id = ?`,
    );
    const result = stmt.run(...values);

    return result.changes > 0;
  }

  async delete(id: string): Promise<boolean> {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare(`DELETE FROM ${this.tableName} WHERE id = ?`);
    const result = stmt.run(id);

    this.embeddingCache.delete(id);

    return result.changes > 0;
  }

  async list(
    namespace?: string,
    limit: number = 100,
    offset: number = 0,
  ): Promise<MemoryEntry[]> {
    if (!this.db) throw new Error("Database not initialized");

    const query = namespace
      ? `SELECT * FROM ${this.tableName} WHERE namespace = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?`
      : `SELECT * FROM ${this.tableName} ORDER BY timestamp DESC LIMIT ? OFFSET ?`;

    const params = namespace ? [namespace, limit, offset] : [limit, offset];
    const rows = (
      namespace
        ? this.db.prepare(query).all(...params)
        : this.db.prepare(query).all(params[0])
    ) as VectorRow[];

    return rows.map((row) => {
      const embeddingArray = this.getEmbeddingFromRow(row, row.id);
      return {
        id: row.id,
        text: row.text,
        embedding: embeddingArray,
        metadata: {
          agentId: row.agent_id,
          namespace: row.namespace,
          tags: JSON.parse(row.tags || "[]"),
          visibility: row.visibility as "private" | "shared" | "system",
          timestamp: row.timestamp,
          version: row.version,
        },
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
      };
    });
  }

  async clear(): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");
    this.db.prepare(`DELETE FROM ${this.tableName}`).run();
    this.embeddingCache.clear();
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
    }
  }
}

/**
 * QdrantVectorStore - Vector store implementation using Qdrant
 */
export class QdrantVectorStore implements IVectorStore {
  private client: QdrantClient;
  private collectionName: string;
  private embeddingDimension: number;
  private similarityThreshold: number;
  private vectorName: string;

  constructor(config: Config) {
    this.collectionName = config.qdrantCollection || "alsania-mem";
    this.embeddingDimension = config.embeddingDimension || 1536;
    this.similarityThreshold = config.similarityThreshold || 0.3;
    this.vectorName = config.qdrantVectorName || "";

    const qdrantUrl = config.qdrantUrl || "http://localhost:6333";
    this.client = new QdrantClient({ url: qdrantUrl });
    if (this.vectorName) {
      console.log(`[Qdrant] Using named vector: ${this.vectorName}`);
    }
  }

  async initialize(): Promise<void> {
    try {
      const collections = await this.client.getCollections();
      const exists = collections.collections.some(
        (c: any) => c.name === this.collectionName,
      );

      if (!exists) {
        // Create collection with proper vector config (named or unnamed)
        const vectorConfig: any = this.vectorName
          ? { [this.vectorName]: { size: this.embeddingDimension, distance: "Cosine" } }
          : { size: this.embeddingDimension, distance: "Cosine" };

        await this.client.createCollection(this.collectionName, {
          vectors: vectorConfig,
        });
        console.log(
          `[Qdrant] Created collection: ${this.collectionName} ` +
          `(dimension: ${this.embeddingDimension}${this.vectorName ? `, named: ${this.vectorName}` : ''})`
        );
      } else {
        // Verify existing collection dimensions match config
        try {
          const info = await this.client.getCollection(this.collectionName);
          const collectionVectors = info.config?.params?.vectors;
          if (collectionVectors) {
            let existingSize: number | undefined;
            if (typeof collectionVectors === 'object' && 'size' in collectionVectors) {
              // Unnamed vector
              existingSize = collectionVectors.size as number;
            } else if (this.vectorName && typeof collectionVectors === 'object' && this.vectorName in collectionVectors) {
              // Named vector
              existingSize = (collectionVectors as any)[this.vectorName]?.size;
            }

            if (existingSize && existingSize !== this.embeddingDimension) {
              console.warn(
                `[Qdrant] WARNING: Collection "${this.collectionName}" has dimension ${existingSize} ` +
                `but config specifies ${this.embeddingDimension}. ` +
                `New inserts may fail. Consider clearing the collection or updating EMBEDDING_DIMENSION.`
              );
            }
          }
        } catch (checkError) {
          console.warn('[Qdrant] Could not verify collection dimensions:', checkError);
        }
      }

      console.log(`[Qdrant] Connected to collection: ${this.collectionName}`);
    } catch (error) {
      console.error(`[Qdrant] Initialization error:`, error);
      throw error;
    }
  }

  async add(
    entry: Omit<MemoryEntry, "id" | "createdAt" | "updatedAt">,
  ): Promise<string> {
    const id = randomUUID();
    const now = new Date().toISOString();

    // Validate embedding dimension matches expected
    if (entry.embedding.length > 0 && entry.embedding.length !== this.embeddingDimension) {
      throw new Error(
        `[Qdrant] Embedding dimension mismatch: got ${entry.embedding.length}, expected ${this.embeddingDimension}. ` +
        `Set EMBEDDING_DIMENSION to match your embedding model output.`
      );
    }

    try {
      // Prepare vector based on whether we're using named vectors
      let vector: any;
      if (this.vectorName) {
        // Named vector - Qdrant expects an object with vector names as keys
        vector = { [this.vectorName]: entry.embedding };
      } else {
        // Single vector - use array directly
        vector = entry.embedding;
      }

      // @ts-ignore - Qdrant accepts named vectors in object format
      await this.client.upsert(this.collectionName, {
        wait: true,
        points: [
          {
            id,
            vector,
            payload: {
              text: entry.text,
              agentId: entry.metadata.agentId,
              namespace: entry.metadata.namespace,
              tags: entry.metadata.tags,
              visibility: entry.metadata.visibility,
              timestamp: entry.metadata.timestamp,
              version: entry.metadata.version,
              createdAt: now,
              updatedAt: now,
            },
          },
        ],
      });

      return id;
    } catch (error) {
      console.error(`[Qdrant] Error adding vector:`, error);
      throw error;
    }
  }

  async getAll(): Promise<MemoryEntry[]> {
    try {
      const results = await this.client.scroll(this.collectionName, {
        limit: 1000,
        with_payload: true,
        with_vector: false,
      });

      return results.points.map((point: any) => {
        const payload = point.payload || {};
        return {
          id: point.id as string,
          text: payload.text as string,
          embedding: [],
          metadata: {
            agentId: payload.agentId as string,
            namespace: payload.namespace as string,
            tags: (payload.tags as string[]) || [],
            visibility:
              (payload.visibility as "private" | "shared" | "system") ||
              "private",
            timestamp: (payload.timestamp as number) || Date.now(),
            version: (payload.version as number) || 1,
          },
          createdAt: new Date(payload.createdAt as string),
          updatedAt: new Date(payload.updatedAt as string),
        };
      });
    } catch (error) {
      console.error(`[Qdrant] GetAll error:`, error);
      return [];
    }
  }

  async search(
    queryEmbedding: number[],
    limit: number = 5,
    namespace?: string,
  ): Promise<Array<{ entry: MemoryEntry; score: number }>> {
    try {
      const filter = namespace
        ? {
            must: [
              {
                key: "namespace",
                match: { value: namespace },
              },
            ],
          }
        : undefined;

      // Prepare search vector based on whether we're using named vectors
      const searchVector: any = this.vectorName
        ? { [this.vectorName]: queryEmbedding }
        : queryEmbedding;

      const results = await this.client.search(this.collectionName, {
        vector: searchVector,
        limit: limit * 2,
        filter,
        with_payload: true,
        with_vector: true,
      });

      const memories = results
        .filter((r: any) => r.score >= this.similarityThreshold)
        .slice(0, limit)
        .map((r: any) => {
          const payload = r.payload || {};

          // Unwrap stored embedding (handles both named and unnamed vectors)
          let storedEmbedding: number[] = [];
          if (r.vector) {
            if (Array.isArray(r.vector)) {
              storedEmbedding = r.vector;
            } else if (typeof r.vector === 'object') {
              if (this.vectorName && this.vectorName in r.vector) {
                storedEmbedding = r.vector[this.vectorName];
              } else {
                const firstKey = Object.keys(r.vector)[0];
                if (firstKey) storedEmbedding = r.vector[firstKey];
              }
            }
          }

          const entry: MemoryEntry = {
            id: r.id as string,
            text: payload.text as string,
            embedding: storedEmbedding,
            metadata: {
              agentId: payload.agentId as string,
              namespace: payload.namespace as string,
              tags: (payload.tags as string[]) || [],
              visibility:
                (payload.visibility as "private" | "shared" | "system") ||
                "private",
              timestamp: (payload.timestamp as number) || Date.now(),
              version: (payload.version as number) || 1,
            },
            createdAt: new Date(payload.createdAt as string),
            updatedAt: new Date(payload.updatedAt as string),
          };
          return { entry, score: r.score };
        });

      return memories;
    } catch (error) {
      console.error(`[Qdrant] Search error:`, error);
      throw error;
    }
  }

  async get(id: string): Promise<MemoryEntry | null> {
    try {
      const result = await this.client.retrieve(this.collectionName, {
        ids: [id],
        with_payload: true,
        with_vector: true,
      });

      if (!result || result.length === 0) {
        return null;
      }

      const point = result[0];
      const payload = point.payload || {};

      // Unwrap named vectors properly
      let embedding: number[] = [];
      if (point.vector) {
        if (Array.isArray(point.vector)) {
          embedding = point.vector as number[];
        } else if (typeof point.vector === 'object') {
          // Named vector: { "v2048": [...], ... }
          if (this.vectorName && this.vectorName in point.vector) {
            embedding = (point.vector as any)[this.vectorName];
          } else {
            // Take first named vector if our name isn't found
            const firstKey = Object.keys(point.vector)[0];
            if (firstKey) {
              embedding = (point.vector as any)[firstKey];
            }
          }
        }
      }

      return {
        id: point.id as string,
        text: payload.text as string,
        embedding,
        metadata: {
          agentId: payload.agentId as string,
          namespace: payload.namespace as string,
          tags: (payload.tags as string[]) || [],
          visibility:
            (payload.visibility as "private" | "shared" | "system") ||
            "private",
          timestamp: (payload.timestamp as number) || Date.now(),
          version: (payload.version as number) || 1,
        },
        createdAt: new Date(payload.createdAt as string),
        updatedAt: new Date(payload.updatedAt as string),
      };
    } catch (error) {
      console.error(`[Qdrant] Get error:`, error);
      return null;
    }
  }

  async update(id: string, updates: Partial<MemoryEntry>): Promise<boolean> {
    try {
      const existing = await this.get(id);
      if (!existing) {
        return false;
      }

      const updatedPayload: Record<string, any> = {
        ...existing.metadata,
        text: updates.text ?? existing.text,
        tags: updates.metadata?.tags ?? existing.metadata.tags,
        visibility:
          updates.metadata?.visibility ?? existing.metadata.visibility,
        namespace: updates.metadata?.namespace ?? existing.metadata.namespace,
        agentId: updates.metadata?.agentId ?? existing.metadata.agentId,
        timestamp: updates.metadata?.timestamp ?? existing.metadata.timestamp,
        version: updates.metadata?.version ?? existing.metadata.version,
        updatedAt: new Date().toISOString(),
      };

      const vector = updates.embedding ?? existing.embedding;

      // Wrap vector in named format if using named vectors
      const upsertVector: any = this.vectorName
        ? { [this.vectorName]: vector }
        : vector;

      await this.client.upsert(this.collectionName, {
        wait: true,
        points: [
          {
            id,
            vector: upsertVector,
            payload: updatedPayload,
          },
        ],
      });

      return true;
    } catch (error) {
      console.error(`[Qdrant] Update error:`, error);
      return false;
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      await this.client.delete(this.collectionName, {
        wait: true,
        points: [id],
      });
      return true;
    } catch (error) {
      console.error(`[Qdrant] Delete error:`, error);
      return false;
    }
  }

  async list(
    namespace?: string,
    limit: number = 100,
    offset: number = 0,
  ): Promise<MemoryEntry[]> {
    try {
      const filter = namespace
        ? {
            must: [
              {
                key: "namespace",
                match: { value: namespace },
              },
            ],
          }
        : undefined;

      const results = await this.client.scroll(this.collectionName, {
        limit,
        offset,
        with_payload: true,
        with_vector: false,
        filter,
      });

      return results.points.map((point: any) => {
        const payload = point.payload || {};
        return {
          id: point.id as string,
          text: payload.text as string,
          embedding: [],
          metadata: {
            agentId: payload.agentId as string,
            namespace: payload.namespace as string,
            tags: (payload.tags as string[]) || [],
            visibility:
              (payload.visibility as "private" | "shared" | "system") ||
              "private",
            timestamp: (payload.timestamp as number) || Date.now(),
            version: (payload.version as number) || 1,
          },
          createdAt: new Date(payload.createdAt as string),
          updatedAt: new Date(payload.updatedAt as string),
        };
      });
    } catch (error) {
      console.error(`[Qdrant] List error:`, error);
      return [];
    }
  }

  async clear(): Promise<void> {
    try {
      await this.client.delete(this.collectionName, {
        wait: true,
        filter: {
          must: [],
        },
      });
      console.log(`[Qdrant] Cleared collection: ${this.collectionName}`);
    } catch (error) {
      console.error(`[Qdrant] Clear error:`, error);
      throw error;
    }
  }
}

/**
 * InMemoryVectorStore - Simple in-memory vector store for testing
 */
export class InMemoryVectorStore implements IVectorStore {
  private memories: Map<string, MemoryEntry> = new Map();
  private similarityThreshold: number;

  constructor(config: Config) {
    this.similarityThreshold = config.similarityThreshold || 0.3;
  }

  async initialize(): Promise<void> {
    console.log(`[Memory] Initialized in-memory vector store`);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error(
        `[Memory] Vector dimension mismatch: query=${a.length}, stored=${b.length}. ` +
        `This usually means the embedding model changed. Clear the vector store or re-embed.`
      );
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (normA * normB);
  }

  async add(
    entry: Omit<MemoryEntry, "id" | "createdAt" | "updatedAt">,
  ): Promise<string> {
    const id = randomUUID();
    const now = new Date();

    const memory: MemoryEntry = {
      id,
      text: entry.text,
      embedding: entry.embedding,
      metadata: entry.metadata,
      createdAt: now,
      updatedAt: now,
    };

    this.memories.set(id, memory);
    return id;
  }

  async getAll(): Promise<MemoryEntry[]> {
    return Array.from(this.memories.values());
  }

  async search(
    queryEmbedding: number[],
    limit: number = 5,
    namespace?: string,
  ): Promise<Array<{ entry: MemoryEntry; score: number }>> {
    const results: Array<{ entry: MemoryEntry; score: number }> = [];

    for (const memory of this.memories.values()) {
      if (namespace && memory.metadata.namespace !== namespace) {
        continue;
      }

      const score = this.cosineSimilarity(queryEmbedding, memory.embedding);
      if (score >= this.similarityThreshold) {
        results.push({ entry: memory, score });
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  async get(id: string): Promise<MemoryEntry | null> {
    return this.memories.get(id) || null;
  }

  async update(id: string, updates: Partial<MemoryEntry>): Promise<boolean> {
    const existing = this.memories.get(id);
    if (!existing) return false;

    const updated: MemoryEntry = {
      ...existing,
      text: updates.text ?? existing.text,
      embedding: updates.embedding ?? existing.embedding,
      metadata: {
        ...existing.metadata,
        ...updates.metadata,
      },
      updatedAt: new Date(),
    };

    this.memories.set(id, updated);
    return true;
  }

  async delete(id: string): Promise<boolean> {
    return this.memories.delete(id);
  }

  async list(
    namespace?: string,
    limit: number = 100,
    offset: number = 0,
  ): Promise<MemoryEntry[]> {
    let results = Array.from(this.memories.values());

    if (namespace) {
      results = results.filter((m) => m.metadata.namespace === namespace);
    }

    results.sort((a, b) => b.metadata.timestamp - a.metadata.timestamp);

    return results.slice(offset, offset + limit);
  }

  async clear(): Promise<void> {
    this.memories.clear();
  }
}

// Factory function
export async function createVectorStore(config: Config): Promise<IVectorStore> {
  console.log(`[EME] Using vector store: ${config.vectorStore}`);

  switch (config.vectorStore) {
    case "sqlite": {
      const store = new SQLiteVectorStore(config);
      await store.initialize();
      return store;
    }
    case "qdrant": {
      const store = new QdrantVectorStore(config);
      await store.initialize();
      return store;
    }
    case "memory": {
      const store = new InMemoryVectorStore(config);
      await store.initialize();
      return store;
    }
    case "postgres":
    case "lancedb":
    case "faiss":
      console.warn(
        `[EME] ${config.vectorStore} vector store not yet implemented, falling back to SQLite`,
      );
      const store = new SQLiteVectorStore(config);
      await store.initialize();
      return store;
    default:
      throw new Error(`Unsupported vector store type: ${config.vectorStore}`);
  }
}
