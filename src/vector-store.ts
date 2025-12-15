import { MemoryEntry, Config } from './types.js';
import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import { randomUUID } from 'crypto';

interface VectorRow {
  id: string;
  text: string;
  embedding: Buffer; // Stored as BLOB
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
  add(entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<string>;
  search(queryEmbedding: number[], limit: number, namespace?: string): Promise<Array<{entry: MemoryEntry, score: number}>>;
  get(id: string): Promise<MemoryEntry | null>;
  update(id: string, updates: Partial<MemoryEntry>): Promise<boolean>;
  delete(id: string): Promise<boolean>;
  list(namespace?: string, limit?: number, offset?: number): Promise<MemoryEntry[]>;
  clear(): Promise<void>;
}

export class SQLiteVectorStore implements IVectorStore {
  private db: Database | null = null;
  private readonly tableName = 'memories';

  constructor(private config: Config) {}

  async initialize(): Promise<void> {
    this.db = await open({
      filename: ':memory:', // TODO: make configurable
      driver: sqlite3.Database
    });

    await this.db.exec(`
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

    // Create indexes for faster searches
    await this.db.exec(`CREATE INDEX IF NOT EXISTS idx_namespace ON ${this.tableName}(namespace)`);
    await this.db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_id ON ${this.tableName}(agent_id)`);
    await this.db.exec(`CREATE INDEX IF NOT EXISTS idx_timestamp ON ${this.tableName}(timestamp)`);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have the same length');
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

  async add(entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    if (!this.db) throw new Error('Database not initialized');
    
    const id = randomUUID();
    const now = new Date();
    const embeddingBuffer = Buffer.from(new Float32Array(entry.embedding).buffer);

    await this.db.run(
      `INSERT INTO ${this.tableName} (id, text, embedding, agent_id, namespace, tags, visibility, timestamp, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        entry.text,
        embeddingBuffer,
        entry.metadata.agentId,
        entry.metadata.namespace,
        JSON.stringify(entry.metadata.tags),
        entry.metadata.visibility,
        entry.metadata.timestamp,
        entry.metadata.version,
        now.toISOString(),
        now.toISOString()
      ]
    );

    return id;
  }

  async search(queryEmbedding: number[], limit: number = 5, namespace?: string): 
    Promise<Array<{entry: MemoryEntry, score: number}>> {
    
    if (!this.db) throw new Error('Database not initialized');

    const query = namespace 
      ? `SELECT * FROM ${this.tableName} WHERE namespace = ?`
      : `SELECT * FROM ${this.tableName}`;
    
    const params = namespace ? [namespace] : [];
    const rows = await this.db.all<VectorRow[]>(query, params);

    const results = await Promise.all(rows.map(async (row) => {
      const embeddingArray = Array.from(new Float32Array(row.embedding.buffer));
      const score = this.cosineSimilarity(queryEmbedding, embeddingArray);

      const entry: MemoryEntry = {
        id: row.id,
        text: row.text,
        embedding: embeddingArray,
        metadata: {
          agentId: row.agent_id,
          namespace: row.namespace,
          tags: JSON.parse(row.tags || '[]'),
          visibility: row.visibility as 'private' | 'shared' | 'system',
          timestamp: row.timestamp,
          version: row.version
        },
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at)
      };

      return { entry, score };
    }));

    // Sort by similarity score (descending) and return top results
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .filter(result => result.score >= (this.config.similarityThreshold || 0.3));
  }

  async get(id: string): Promise<MemoryEntry | null> {
    if (!this.db) throw new Error('Database not initialized');

    const row = await this.db.get<VectorRow>(`SELECT * FROM ${this.tableName} WHERE id = ?`, [id]);
    if (!row) return null;

    const embeddingArray = Array.from(new Float32Array(row.embedding.buffer));

    return {
      id: row.id,
      text: row.text,
      embedding: embeddingArray,
      metadata: {
        agentId: row.agent_id,
        namespace: row.namespace,
        tags: JSON.parse(row.tags || '[]'),
        visibility: row.visibility as 'private' | 'shared' | 'system',
        timestamp: row.timestamp,
        version: row.version
      },
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }

  async update(id: string, updates: Partial<MemoryEntry>): Promise<boolean> {
    if (!this.db) throw new Error('Database not initialized');

    const setClauses: string[] = [];
    const values: any[] = [];
    const now = new Date().toISOString();

    if (updates.text !== undefined) {
      setClauses.push('text = ?');
      values.push(updates.text);
    }

    if (updates.embedding !== undefined) {
      setClauses.push('embedding = ?');
      values.push(Buffer.from(new Float32Array(updates.embedding).buffer));
    }

    if (updates.metadata) {
      if (updates.metadata.agentId !== undefined) {
        setClauses.push('agent_id = ?');
        values.push(updates.metadata.agentId);
      }
      if (updates.metadata.namespace !== undefined) {
        setClauses.push('namespace = ?');
        values.push(updates.metadata.namespace);
      }
      if (updates.metadata.tags !== undefined) {
        setClauses.push('tags = ?');
        values.push(JSON.stringify(updates.metadata.tags));
      }
      if (updates.metadata.visibility !== undefined) {
        setClauses.push('visibility = ?');
        values.push(updates.metadata.visibility);
      }
      if (updates.metadata.timestamp !== undefined) {
        setClauses.push('timestamp = ?');
        values.push(updates.metadata.timestamp);
      }
      if (updates.metadata.version !== undefined) {
        setClauses.push('version = ?');
        values.push(updates.metadata.version);
      }
    }

    setClauses.push('updated_at = ?');
    values.push(now);

    if (setClauses.length === 0) {
      return false;
    }

    values.push(id);
    const result = await this.db.run(
      `UPDATE ${this.tableName} SET ${setClauses.join(', ')} WHERE id = ?`,
      values
    );

    return result.changes ? result.changes > 0 : false;
  }

  async delete(id: string): Promise<boolean> {
    if (!this.db) throw new Error('Database not initialized');

    const result = await this.db.run(`DELETE FROM ${this.tableName} WHERE id = ?`, [id]);
    return result.changes ? result.changes > 0 : false;
  }

  async list(namespace?: string, limit: number = 100, offset: number = 0): Promise<MemoryEntry[]> {
    if (!this.db) throw new Error('Database not initialized');

    const query = namespace 
      ? `SELECT * FROM ${this.tableName} WHERE namespace = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?`
      : `SELECT * FROM ${this.tableName} ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
    
    const params = namespace ? [namespace, limit, offset] : [limit, offset];
    const rows = await this.db.all<VectorRow[]>(query, params);

    return rows.map(row => {
      const embeddingArray = Array.from(new Float32Array(row.embedding.buffer));
      return {
        id: row.id,
        text: row.text,
        embedding: embeddingArray,
        metadata: {
          agentId: row.agent_id,
          namespace: row.namespace,
          tags: JSON.parse(row.tags || '[]'),
          visibility: row.visibility as 'private' | 'shared' | 'system',
          timestamp: row.timestamp,
          version: row.version
        },
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at)
      };
    });
  }

  async clear(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    await this.db.run(`DELETE FROM ${this.tableName}`);
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
    }
  }
}

// Factory function
export function createVectorStore(config: Config): IVectorStore {
  switch (config.vectorStore) {
    case 'sqlite':
      return new SQLiteVectorStore(config);
    case 'memory':
      // TODO: Implement in-memory store
      throw new Error('In-memory vector store not yet implemented');
    case 'faiss':
      // TODO: Implement FAISS store
      throw new Error('FAISS vector store not yet implemented');
    default:
      throw new Error(`Unsupported vector store type: ${config.vectorStore}`);
  }
}