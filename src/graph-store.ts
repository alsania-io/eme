import { GraphNode, GraphEdge, GraphStats } from "./types.js";
import { randomUUID } from "crypto";

// Type alias for better-sqlite3 Database instance (dynamically imported)
type SQLiteDatabase = InstanceType<typeof import("better-sqlite3")>;

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

  // Enhanced Methods (from graph-store-enhanced.ts)
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

export class SQLiteGraphStore implements IGraphStore {
  private db: SQLiteDatabase | null = null;
  private readonly nodesTable = "graph_nodes";
  private readonly edgesTable = "graph_edges";

  constructor() {}

  async initialize(): Promise<void> {
    const Database = (await import("better-sqlite3")).default;
    this.db = new Database(":memory:");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${this.nodesTable} (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        properties TEXT NOT NULL,
        namespace TEXT DEFAULT 'default',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${this.edgesTable} (
        id TEXT PRIMARY KEY,
        from_node TEXT NOT NULL,
        to_node TEXT NOT NULL,
        type TEXT NOT NULL,
        weight REAL DEFAULT 1.0,
        properties TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (from_node) REFERENCES ${this.nodesTable}(id),
        FOREIGN KEY (to_node) REFERENCES ${this.nodesTable}(id)
      )
    `);

    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_node_type ON ${this.nodesTable}(type)`,
    );
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_node_name ON ${this.nodesTable}(name)`,
    );
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_node_namespace ON ${this.nodesTable}(namespace)`,
    );
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_edge_from ON ${this.edgesTable}(from_node)`,
    );
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_edge_to ON ${this.edgesTable}(to_node)`,
    );
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_edge_type ON ${this.edgesTable}(type)`,
    );

    console.log("[SQLiteGraph] Database initialized");
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.db) {
      await this.initialize();
    }
  }

  async addNode(
    node: Omit<GraphNode, "id" | "createdAt" | "updatedAt">,
  ): Promise<string> {
    await this.ensureInitialized();
    if (!this.db) throw new Error("Database not initialized");

    const id = randomUUID();
    const now = new Date();
    const namespace = node.properties?.namespace || "default";

    const stmt = this.db.prepare(
      `INSERT INTO ${this.nodesTable} (id, type, name, properties, namespace, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    stmt.run(
      id,
      node.type,
      node.name,
      JSON.stringify({ ...node.properties, namespace }),
      namespace,
      now.toISOString(),
      now.toISOString(),
    );

    return id;
  }

  async addEdge(edge: Omit<GraphEdge, "id" | "createdAt">): Promise<string> {
    await this.ensureInitialized();
    if (!this.db) throw new Error("Database not initialized");

    const id = randomUUID();
    const now = new Date();

    const stmt = this.db.prepare(
      `INSERT INTO ${this.edgesTable} (id, from_node, to_node, type, weight, properties, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    stmt.run(
      id,
      edge.from,
      edge.to,
      edge.type,
      edge.weight,
      JSON.stringify(edge.properties),
      now.toISOString(),
    );

    return id;
  }

  async getNode(id: string): Promise<GraphNode | null> {
    await this.ensureInitialized();
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare(
      `SELECT * FROM ${this.nodesTable} WHERE id = ?`,
    );
    const row = stmt.get(id) as any;

    if (!row) return null;

    return {
      id: row.id,
      type: row.type as GraphNode["type"],
      name: row.name,
      properties: JSON.parse(row.properties),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  async getEdge(id: string): Promise<GraphEdge | null> {
    await this.ensureInitialized();
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare(
      `SELECT * FROM ${this.edgesTable} WHERE id = ?`,
    );
    const row = stmt.get(id) as any;

    if (!row) return null;

    return {
      id: row.id,
      from: row.from_node,
      to: row.to_node,
      type: row.type as GraphEdge["type"],
      weight: row.weight,
      properties: JSON.parse(row.properties),
      createdAt: new Date(row.created_at),
    };
  }

  async getAllNodes(): Promise<GraphNode[]> {
    await this.ensureInitialized();
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare(`SELECT * FROM ${this.nodesTable}`);
    const rows = stmt.all() as any[];

    return rows.map((row) => ({
      id: row.id,
      type: row.type as GraphNode["type"],
      name: row.name,
      properties: JSON.parse(row.properties),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }));
  }

  async getAllEdges(): Promise<GraphEdge[]> {
    await this.ensureInitialized();
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare(`SELECT * FROM ${this.edgesTable}`);
    const rows = stmt.all() as any[];

    return rows.map((row) => ({
      id: row.id,
      from: row.from_node,
      to: row.to_node,
      type: row.type as GraphEdge["type"],
      weight: row.weight,
      properties: JSON.parse(row.properties),
      createdAt: new Date(row.created_at),
    }));
  }

  async getGraph(): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
    const [nodes, edges] = await Promise.all([
      this.getAllNodes(),
      this.getAllEdges(),
    ]);
    return { nodes, edges };
  }

  async getGraphStats(): Promise<GraphStats> {
    await this.ensureInitialized();
    if (!this.db) throw new Error("Database not initialized");

    const nodes = await this.getAllNodes();
    const edges = await this.getAllEdges();

    const nodeTypes = new Map<string, number>();
    nodes.forEach((node) => {
      nodeTypes.set(node.type, (nodeTypes.get(node.type) || 0) + 1);
    });

    const edgeTypes = new Map<string, number>();
    edges.forEach((edge) => {
      edgeTypes.set(edge.type, (edgeTypes.get(edge.type) || 0) + 1);
    });

    const namespaces = new Map<string, number>();
    nodes.forEach((node) => {
      const ns = node.properties.namespace || "default";
      namespaces.set(ns, (namespaces.get(ns) || 0) + 1);
    });

    const totalNodes = nodes.length;
    const totalEdges = edges.length;
    const density =
      totalNodes > 1 ? totalEdges / (totalNodes * (totalNodes - 1)) : 0;

    return {
      totalNodes,
      totalEdges,
      nodeTypes: Array.from(nodeTypes.entries()).map(([type, count]) => ({
        type,
        count,
      })),
      edgeTypes: Array.from(edgeTypes.entries()).map(([type, count]) => ({
        type,
        count,
      })),
      namespaces: Array.from(namespaces.entries()).map(
        ([namespace, count]) => ({ namespace, count }),
      ),
      density,
      lastUpdated: new Date(),
    };
  }

  async findNodes(
    type?: string,
    properties?: Record<string, any>,
  ): Promise<GraphNode[]> {
    await this.ensureInitialized();
    if (!this.db) throw new Error("Database not initialized");

    if (properties) {
      const stmt = this.db.prepare(
        `SELECT * FROM ${this.nodesTable} WHERE type = ? OR type IS NOT NULL`,
      );
      const nodeRows = (type ? stmt.all(type) : stmt.all()) as any[];
      return nodeRows
        .map((row) => ({
          id: row.id,
          type: row.type as GraphNode["type"],
          name: row.name,
          properties: JSON.parse(row.properties),
          createdAt: new Date(row.created_at),
          updatedAt: new Date(row.updated_at),
        }))
        .filter((node) => {
          return Object.entries(properties).every(
            ([key, value]) => node.properties[key] === value,
          );
        });
    }

    let query = `SELECT * FROM ${this.nodesTable}`;
    const params: any[] = [];

    if (type) {
      query += " WHERE type = ?";
      params.push(type);
    }

    const stmt = this.db.prepare(query);
    const rows = (
      params.length > 0 ? stmt.all(...params) : stmt.all()
    ) as any[];

    return rows.map((row) => ({
      id: row.id,
      type: row.type as GraphNode["type"],
      name: row.name,
      properties: JSON.parse(row.properties),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }));
  }

  async findEdges(
    from?: string,
    to?: string,
    type?: string,
  ): Promise<GraphEdge[]> {
    await this.ensureInitialized();
    if (!this.db) throw new Error("Database not initialized");

    const conditions: string[] = [];
    const params: any[] = [];

    if (from) {
      conditions.push("from_node = ?");
      params.push(from);
    }
    if (to) {
      conditions.push("to_node = ?");
      params.push(to);
    }
    if (type) {
      conditions.push("type = ?");
      params.push(type);
    }

    let query = `SELECT * FROM ${this.edgesTable}`;
    if (conditions.length > 0) {
      query += " WHERE " + conditions.join(" AND ");
    }

    const stmt = this.db.prepare(query);
    const rows = (
      params.length > 0 ? stmt.all(...params) : stmt.all()
    ) as any[];

    return rows.map((row) => ({
      id: row.id,
      from: row.from_node,
      to: row.to_node,
      type: row.type as GraphEdge["type"],
      weight: row.weight,
      properties: JSON.parse(row.properties),
      createdAt: new Date(row.created_at),
    }));
  }

  async getNeighbors(
    nodeId: string,
    edgeType?: string,
  ): Promise<{ node: GraphNode; edge: GraphEdge }[]> {
    await this.ensureInitialized();
    if (!this.db) throw new Error("Database not initialized");

    let query = `
      SELECT e.*, n.*
      FROM ${this.edgesTable} e
      JOIN ${this.nodesTable} n ON e.to_node = n.id
      WHERE e.from_node = ?
    `;
    const params: any[] = [nodeId];

    if (edgeType) {
      query += " AND e.type = ?";
      params.push(edgeType);
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as any[];

    return rows.map((row) => ({
      edge: {
        id: row.id,
        from: row.from_node,
        to: row.to_node,
        type: row.type as GraphEdge["type"],
        weight: row.weight,
        properties: JSON.parse(row.properties),
        createdAt: new Date(row.created_at),
      },
      node: {
        id: row.id,
        type: row.type as GraphNode["type"],
        name: row.name,
        properties: JSON.parse(row.properties),
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
      },
    }));
  }

  async updateNode(id: string, updates: Partial<GraphNode>): Promise<boolean> {
    await this.ensureInitialized();
    if (!this.db) throw new Error("Database not initialized");

    const setClauses: string[] = [];
    const values: any[] = [];
    const now = new Date().toISOString();

    if (updates.type !== undefined) {
      setClauses.push("type = ?");
      values.push(updates.type);
    }
    if (updates.name !== undefined) {
      setClauses.push("name = ?");
      values.push(updates.name);
    }
    if (updates.properties !== undefined) {
      setClauses.push("properties = ?");
      values.push(JSON.stringify(updates.properties));
    }

    setClauses.push("updated_at = ?");
    values.push(now);

    if (setClauses.length === 0) return false;

    values.push(id);
    const stmt = this.db.prepare(
      `UPDATE ${this.nodesTable} SET ${setClauses.join(", ")} WHERE id = ?`,
    );
    const result = stmt.run(...values);

    return result.changes > 0;
  }

  async updateEdge(id: string, updates: Partial<GraphEdge>): Promise<boolean> {
    await this.ensureInitialized();
    if (!this.db) throw new Error("Database not initialized");

    const setClauses: string[] = [];
    const values: any[] = [];

    if (updates.from !== undefined) {
      setClauses.push("from_node = ?");
      values.push(updates.from);
    }
    if (updates.to !== undefined) {
      setClauses.push("to_node = ?");
      values.push(updates.to);
    }
    if (updates.type !== undefined) {
      setClauses.push("type = ?");
      values.push(updates.type);
    }
    if (updates.weight !== undefined) {
      setClauses.push("weight = ?");
      values.push(updates.weight);
    }
    if (updates.properties !== undefined) {
      setClauses.push("properties = ?");
      values.push(JSON.stringify(updates.properties));
    }

    if (setClauses.length === 0) return false;

    values.push(id);
    const stmt = this.db.prepare(
      `UPDATE ${this.edgesTable} SET ${setClauses.join(", ")} WHERE id = ?`,
    );
    const result = stmt.run(...values);

    return result.changes > 0;
  }

  async deleteNode(id: string): Promise<boolean> {
    await this.ensureInitialized();
    if (!this.db) throw new Error("Database not initialized");

    const deleteEdgesStmt = this.db.prepare(
      `DELETE FROM ${this.edgesTable} WHERE from_node = ? OR to_node = ?`,
    );
    deleteEdgesStmt.run(id, id);

    const stmt = this.db.prepare(`DELETE FROM ${this.nodesTable} WHERE id = ?`);
    const result = stmt.run(id);

    return result.changes > 0;
  }

  async deleteEdge(id: string): Promise<boolean> {
    await this.ensureInitialized();
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare(`DELETE FROM ${this.edgesTable} WHERE id = ?`);
    const result = stmt.run(id);

    return result.changes > 0;
  }

  async clear(): Promise<void> {
    await this.ensureInitialized();
    if (!this.db) throw new Error("Database not initialized");

    this.db.exec(`DELETE FROM ${this.edgesTable}`);
    this.db.exec(`DELETE FROM ${this.nodesTable}`);
  }

  // ========== ENHANCED METHODS ==========

  async clearNamespace(namespace: string): Promise<number> {
    await this.ensureInitialized();
    if (!this.db) throw new Error("Database not initialized");

    const nodesStmt = this.db.prepare(
      `SELECT id FROM ${this.nodesTable} WHERE namespace = ?`,
    );
    const nodes = nodesStmt.all(namespace) as any[];

    if (nodes.length === 0) return 0;

    const nodeIds = nodes.map((row: any) => row.id);

    const deleteEdgesStmt = this.db.prepare(
      `DELETE FROM ${this.edgesTable} WHERE from_node IN (${nodeIds.map(() => "?").join(", ")}) OR to_node IN (${nodeIds.map(() => "?").join(", ")})`,
    );
    deleteEdgesStmt.run([...nodeIds, ...nodeIds]);

    const deleteNodesStmt = this.db.prepare(
      `DELETE FROM ${this.nodesTable} WHERE id IN (${nodeIds.map(() => "?").join(", ")})`,
    );
    deleteNodesStmt.run(nodeIds);

    return nodeIds.length;
  }

  async findNodesByNamespace(namespace: string): Promise<GraphNode[]> {
    await this.ensureInitialized();
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare(
      `SELECT * FROM ${this.nodesTable} WHERE namespace = ?`,
    );
    const rows = stmt.all(namespace) as any[];

    return rows.map((row) => ({
      id: row.id,
      type: row.type as GraphNode["type"],
      name: row.name,
      properties: JSON.parse(row.properties),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }));
  }

  async batchAddNodes(
    nodes: Omit<GraphNode, "id" | "createdAt" | "updatedAt">[],
  ): Promise<string[]> {
    await this.ensureInitialized();
    if (!this.db) throw new Error("Database not initialized");
    if (nodes.length === 0) return [];

    const ids: string[] = [];
    const now = new Date().toISOString();

    const insertStmt = this.db.prepare(
      `INSERT INTO ${this.nodesTable} (id, type, name, properties, namespace, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );

    const insertMany = this.db.transaction((nodeList: any[]) => {
      for (const node of nodeList) {
        const id = randomUUID();
        const namespace = node.properties?.namespace || "default";

        insertStmt.run(
          id,
          node.type,
          node.name,
          JSON.stringify({ ...node.properties, namespace }),
          namespace,
          now,
          now,
        );

        ids.push(id);
      }
    });

    insertMany(nodes);
    return ids;
  }

  async batchAddEdges(
    edges: Omit<GraphEdge, "id" | "createdAt">[],
  ): Promise<string[]> {
    await this.ensureInitialized();
    if (!this.db) throw new Error("Database not initialized");
    if (edges.length === 0) return [];

    const ids: string[] = [];
    const now = new Date().toISOString();

    const insertStmt = this.db.prepare(
      `INSERT INTO ${this.edgesTable} (id, from_node, to_node, type, weight, properties, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );

    const insertMany = this.db.transaction((edgeList: any[]) => {
      for (const edge of edgeList) {
        const id = randomUUID();

        insertStmt.run(
          id,
          edge.from,
          edge.to,
          edge.type,
          edge.weight,
          JSON.stringify(edge.properties),
          now,
        );

        ids.push(id);
      }
    });

    insertMany(edges);
    return ids;
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
    }
  }
}

// Import memory store
import {
  MemoryGraphStore,
  createMemoryGraphStore,
} from "./graph-store-memory.js";

// Factory function - supports both memory and SQLite modes
export function createGraphStore(useMemory: boolean = false): IGraphStore {
  if (useMemory) {
    return createMemoryGraphStore();
  }
  return new SQLiteGraphStore();
}

// Re-export for convenience
export { MemoryGraphStore, createMemoryGraphStore };
