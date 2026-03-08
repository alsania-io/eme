import { GraphNode, GraphEdge, GraphStats } from "./types.js";
import { IGraphStore } from "./graph-store.js";
import { randomUUID } from "crypto";

export class MemoryGraphStore implements IGraphStore {
  private nodes: Map<string, GraphNode> = new Map();
  private edges: Map<string, GraphEdge> = new Map();

  async initialize(): Promise<void> {
    console.log("[MemoryGraph] Initialized in-memory graph store");
  }

  async addNode(
    node: Omit<GraphNode, "id" | "createdAt" | "updatedAt">,
  ): Promise<string> {
    const id = randomUUID();
    const now = new Date();
    const newNode: GraphNode = {
      id,
      ...node,
      createdAt: now,
      updatedAt: now,
    };

    this.nodes.set(id, newNode);
    return id;
  }

  async addEdge(edge: Omit<GraphEdge, "id" | "createdAt">): Promise<string> {
    const id = randomUUID();
    const now = new Date();
    const newEdge: GraphEdge = {
      id,
      ...edge,
      createdAt: now,
    };

    this.edges.set(id, newEdge);
    return id;
  }

  async getNode(id: string): Promise<GraphNode | null> {
    return this.nodes.get(id) || null;
  }

  async getEdge(id: string): Promise<GraphEdge | null> {
    return this.edges.get(id) || null;
  }

  async getAllNodes(): Promise<GraphNode[]> {
    return Array.from(this.nodes.values());
  }

  async getAllEdges(): Promise<GraphEdge[]> {
    return Array.from(this.edges.values());
  }

  async getGraph(): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
    return {
      nodes: await this.getAllNodes(),
      edges: await this.getAllEdges(),
    };
  }

  async getGraphStats(): Promise<GraphStats> {
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
    let results = Array.from(this.nodes.values());

    if (type) {
      results = results.filter((node) => node.type === type);
    }

    if (properties) {
      results = results.filter((node) => {
        return Object.entries(properties).every(
          ([key, value]) => node.properties[key] === value,
        );
      });
    }

    return results;
  }

  async findEdges(
    from?: string,
    to?: string,
    type?: string,
  ): Promise<GraphEdge[]> {
    let results = Array.from(this.edges.values());

    if (from) {
      results = results.filter((edge) => edge.from === from);
    }
    if (to) {
      results = results.filter((edge) => edge.to === to);
    }
    if (type) {
      results = results.filter((edge) => edge.type === type);
    }

    return results;
  }

  async getNeighbors(
    nodeId: string,
    edgeType?: string,
  ): Promise<{ node: GraphNode; edge: GraphEdge }[]> {
    const results: { node: GraphNode; edge: GraphEdge }[] = [];
    const edges = await this.findEdges(nodeId, undefined, edgeType);

    for (const edge of edges) {
      const node = await this.getNode(edge.to);
      if (node) {
        results.push({ node, edge });
      }
    }

    return results;
  }

  async updateNode(id: string, updates: Partial<GraphNode>): Promise<boolean> {
    const existing = this.nodes.get(id);
    if (!existing) return false;

    const updated: GraphNode = {
      ...existing,
      ...updates,
      updatedAt: new Date(),
    };

    this.nodes.set(id, updated);
    return true;
  }

  async updateEdge(id: string, updates: Partial<GraphEdge>): Promise<boolean> {
    const existing = this.edges.get(id);
    if (!existing) return false;

    const updated: GraphEdge = {
      ...existing,
      ...updates,
    };

    this.edges.set(id, updated);
    return true;
  }

  async deleteNode(id: string): Promise<boolean> {
    const edgesToDelete = Array.from(this.edges.values())
      .filter((edge) => edge.from === id || edge.to === id)
      .map((edge) => edge.id);

    for (const edgeId of edgesToDelete) {
      this.edges.delete(edgeId);
    }

    return this.nodes.delete(id);
  }

  async deleteEdge(id: string): Promise<boolean> {
    return this.edges.delete(id);
  }

  async clear(): Promise<void> {
    this.nodes.clear();
    this.edges.clear();
  }

  // ========== ENHANCED METHODS ==========

  async clearNamespace(namespace: string): Promise<number> {
    const nodesInNamespace = Array.from(this.nodes.values()).filter(
      (node) => node.properties.namespace === namespace,
    );

    for (const node of nodesInNamespace) {
      await this.deleteNode(node.id);
    }

    return nodesInNamespace.length;
  }

  async findNodesByNamespace(namespace: string): Promise<GraphNode[]> {
    return Array.from(this.nodes.values()).filter(
      (node) => node.properties.namespace === namespace,
    );
  }

  async batchAddNodes(
    nodes: Omit<GraphNode, "id" | "createdAt" | "updatedAt">[],
  ): Promise<string[]> {
    const ids: string[] = [];
    for (const node of nodes) {
      const id = await this.addNode(node);
      ids.push(id);
    }
    return ids;
  }

  async batchAddEdges(
    edges: Omit<GraphEdge, "id" | "createdAt">[],
  ): Promise<string[]> {
    const ids: string[] = [];
    for (const edge of edges) {
      const id = await this.addEdge(edge);
      ids.push(id);
    }
    return ids;
  }

  async close(): Promise<void> {
    // Nothing to close for memory store
  }
}

export function createMemoryGraphStore(): IGraphStore {
  return new MemoryGraphStore();
}
