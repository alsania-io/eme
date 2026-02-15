import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { createMemoryManager } from "./memory-manager.js";
import { Config } from "./types.js";

// MCP Tool schemas
const AddMemorySchema = z.object({
  text: z.string(),
  agentId: z.string().optional().default("unknown"),
  namespace: z.string().optional().default("default"),
  tags: z.array(z.string()).optional().default([]),
  visibility: z
    .enum(["private", "shared", "system"] as const)
    .optional()
    .default("private"),
  forceSave: z.boolean().optional().default(false),
});

const SearchMemorySchema = z.object({
  query: z.string(),
  limit: z.number().optional().default(5),
  namespace: z.string().optional(),
  includeGraph: z.boolean().optional().default(true),
});

const UpdateMemorySchema = z.object({
  id: z.string(),
  text: z.string().optional(),
  tags: z.array(z.string()).optional(),
  visibility: z.enum(["private", "shared", "system"] as const).optional(),
});

const DeleteMemorySchema = z.object({
  id: z.string(),
});

const ListMemoriesSchema = z.object({
  namespace: z.string().optional(),
  limit: z.number().optional().default(100),
  offset: z.number().optional().default(0),
});

const GraphAddNodeSchema = z.object({
  type: z.enum(["concept", "event", "person", "tool", "task", "entity", "project", "state"] as const),
  name: z.string(),
  properties: z.record(z.string(), z.any()).optional().default({}),
});

const GraphAddEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  type: z.enum(["related_to", "is", "part_of", "changed_from", "updated_on", "owned_by", "assigned_to"] as const),
  weight: z.number().optional().default(1.0),
  properties: z.record(z.string(), z.any()).optional().default({}),
});

const SnapshotSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
});

const GraphReadSchema = z.object({
  includeStats: z.boolean().optional().default(true),
});

const BatchAddMemoriesSchema = z.object({
  memories: z.array(
    z.object({
      text: z.string(),
      agentId: z.string().optional().default("unknown"),
      namespace: z.string().optional().default("default"),
      tags: z.array(z.string()).optional().default([]),
      visibility: z
        .enum(["private", "shared", "system"] as const)
        .optional()
        .default("private"),
      forceSave: z.boolean().optional().default(false),
    }),
  ),
});

const ClearNamespaceSchema = z.object({
  namespace: z.string(),
  confirm: z.boolean().optional().default(false),
});
const LoadSnapshotSchema = z.object({
  snapshotId: z.string(),
});

export class EMEMCPServer {
  private server: Server;
  private memoryManager: ReturnType<typeof createMemoryManager>;
  private config: Config;

  constructor(config?: Partial<Config>) {
    this.config = {
      // Embedding configuration
      embeddingModel: "local",
      embeddingDimension: 384,

      // Vector store configuration
      vectorStore: "sqlite",
      vectorStorePath: "./storage/vectors.db",

      // Graph store configuration
      graphStore: "jsonl",
      graphStorePath: "./storage/graph.jsonl",

      // Snapshot configuration
      snapshotStore: "filesystem",
      snapshotPath: "./storage/snapshots",

      // Memory gate configuration
      memoryGateEnabled: true,
      memoryGateThreshold: 0.3,

      // General configuration
      maxMemoryEntries: 10000,
      similarityThreshold: 0.3,
      logLevel: "info",
      ...config,
    };

    this.memoryManager = createMemoryManager(this.config);
    this.server = new Server(
      {
        name: "alsania-eme",
        version: "0.1.0",
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    this.setupToolHandlers();
    this.setupErrorHandling();
  }

  private setupToolHandlers(): void {
    // Tool 1: add
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "add_memory",
          description: "Add a new memory entry",
          inputSchema: {
            type: "object",
            properties: {
              text: { type: "string", description: "The memory text content" },
              agentId: {
                type: "string",
                description: "ID of the agent creating the memory",
              },
              namespace: {
                type: "string",
                description: "Namespace for the memory",
              },
              tags: {
                type: "array",
                items: { type: "string" },
                description: "Tags for categorization",
              },
              visibility: {
                type: "string",
                enum: ["private", "shared", "system"],
                description: "Visibility level",
              },
              forceSave: {
                type: "boolean",
                description: "Force save even if memory gate rejects",
              },
            },
            required: ["text"],
          },
        },
        {
          name: "search_memory",
          description: "Search memories using semantic and graph search",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", description: "Search query" },
              limit: {
                type: "number",
                description: "Maximum results to return",
              },
              namespace: { type: "string", description: "Filter by namespace" },
              includeGraph: {
                type: "boolean",
                description: "Include graph context in results",
              },
            },
            required: ["query"],
          },
        },
        {
          name: "update_memory",
          description: "Update an existing memory entry",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string", description: "Memory ID to update" },
              text: { type: "string", description: "New text content" },
              tags: {
                type: "array",
                items: { type: "string" },
                description: "New tags",
              },
              visibility: {
                type: "string",
                enum: ["private", "shared", "system"],
                description: "New visibility level",
              },
            },
            required: ["id"],
          },
        },
        {
          name: "delete_memory",
          description: "Delete a memory entry (soft delete)",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string", description: "Memory ID to delete" },
            },
            required: ["id"],
          },
        },
        {
          name: "list_memories",
          description: "List memories with optional filtering",
          inputSchema: {
            type: "object",
            properties: {
              namespace: { type: "string", description: "Filter by namespace" },
              limit: {
                type: "number",
                description: "Maximum results to return",
              },
              offset: { type: "number", description: "Pagination offset" },
            },
          },
        },
        {
          name: "graph_add_node",
          description: "Add a node to the knowledge graph",
          inputSchema: {
            type: "object",
            properties: {
              type: {
                type: "string",
                enum: [
                  "concept",
                  "event",
                  "person",
                  "tool",
                  "task",
                  "entity",
                  "project",
                  "state",
                ],
                description: "Node type",
              },
              name: { type: "string", description: "Node name" },
              properties: {
                type: "object",
                description: "Additional properties",
              },
            },
            required: ["type", "name"],
          },
        },
        {
          name: "graph_add_edge",
          description: "Add an edge between graph nodes",
          inputSchema: {
            type: "object",
            properties: {
              from: { type: "string", description: "Source node ID" },
              to: { type: "string", description: "Target node ID" },
              type: {
                type: "string",
                enum: [
                  "related_to",
                  "is",
                  "part_of",
                  "changed_from",
                  "updated_on",
                  "owned_by",
                  "assigned_to",
                ],
                description: "Edge type",
              },
              weight: { type: "number", description: "Edge weight" },
              properties: {
                type: "object",
                description: "Additional properties",
              },
            },
            required: ["from", "to", "type"],
          },
        },
        {
          name: "snapshot_save",
          description: "Create a memory snapshot",
          inputSchema: {
            type: "object",
            properties: {
              name: { type: "string", description: "Snapshot name" },
              description: {
                type: "string",
                description: "Snapshot description",
              },
            },
            required: ["name"],
          },
        },
        {
          name: "snapshot_load",
          description: "Load a memory snapshot",
          inputSchema: {
            type: "object",
            properties: {
              snapshotId: {
                type: "string",
                description: "Snapshot ID to load",
              },
            },
            required: ["snapshotId"],
          },
        },
        {
          name: "moderation_review",
          description: "Review and moderate shared memory entries (Admin only)",
          inputSchema: {
            type: "object",
            properties: {
              action: {
                type: "string",
                enum: ["approve", "reject", "promote"],
                description: "Action to take",
              },
              memoryId: {
                type: "string",
                description: "Memory ID to moderate",
              },
              reason: { type: "string", description: "Reason for action" },
            },
            required: ["action", "memoryId"],
          },
        },
        {
          name: "graph_read",
          description: "Read entire graph structure with nodes and edges",
          inputSchema: {
            type: "object",
            properties: {
              includeStats: {
                type: "boolean",
                description: "Include graph statistics",
              },
            },
          },
        },
        {
          name: "batch_add_memories",
          description: "Add multiple memories at once for batch operations",
          inputSchema: {
            type: "object",
            properties: {
              memories: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    text: { type: "string" },
                    agentId: { type: "string" },
                    namespace: { type: "string" },
                    tags: { type: "array", items: { type: "string" } },
                    visibility: {
                      type: "string",
                      enum: ["private", "shared", "system"],
                    },
                    forceSave: { type: "boolean" },
                  },
                  required: ["text"],
                },
              },
            },
            required: ["memories"],
          },
        },
        {
          name: "clear_namespace",
          description: "Clear all nodes and edges in a namespace (daily reset)",
          inputSchema: {
            type: "object",
            properties: {
              namespace: { type: "string", description: "Namespace to clear" },
              confirm: { type: "boolean", description: "Safety confirmation" },
            },
            required: ["namespace"],
          },
        },
      ],
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "add_memory": {
            const params = AddMemorySchema.parse(args);
            const result = await this.memoryManager.addMemory(
              params.text,
              params.agentId,
              params.namespace,
              params.tags,
              params.visibility,
              params.forceSave,
            );

            return {
              content: [
                {
                  type: "text",
                  text: result.id
                    ? `Memory added with ID: ${result.id}\nFilter results: ${JSON.stringify(result.filter, null, 2)}`
                    : `Memory rejected by gate. Filter results: ${JSON.stringify(result.filter, null, 2)}`,
                },
              ],
            };
          }

          case "search_memory": {
            const params = SearchMemorySchema.parse(args);
            const results = await this.memoryManager.search(
              params.query,
              params.limit,
              params.namespace,
              params.includeGraph,
            );

            const formattedResults = results
              .map(
                (result, index) =>
                  `Result ${index + 1} (Score: ${result.score.toFixed(3)}):\n` +
                  `Memory: ${result.memory.text.substring(0, 100)}...\n` +
                  `Agent: ${result.memory.metadata.agentId}, Namespace: ${result.memory.metadata.namespace}\n` +
                  (result.graphContext?.length
                    ? `Graph Context: ${result.graphContext.length} related nodes\n`
                    : ""),
              )
              .join("\n---\n");

            return {
              content: [
                {
                  type: "text",
                  text:
                    results.length > 0
                      ? `Found ${results.length} memories:\n\n${formattedResults}`
                      : "No memories found matching your query.",
                },
              ],
            };
          }

          case "update_memory": {
            const params = UpdateMemorySchema.parse(args);
            const updates: any = {};

            if (params.text) updates.text = params.text;
            if (params.tags) updates.metadata = { tags: params.tags };
            if (params.visibility)
              updates.metadata = {
                ...updates.metadata,
                visibility: params.visibility,
              };

            const success = await this.memoryManager.updateMemory(
              params.id,
              updates,
            );

            return {
              content: [
                {
                  type: "text",
                  text: success
                    ? `Memory ${params.id} updated successfully`
                    : `Failed to update memory ${params.id} (not found or no changes)`,
                },
              ],
            };
          }

          case "delete_memory": {
            const params = DeleteMemorySchema.parse(args);
            const success = await this.memoryManager.deleteMemory(params.id);

            return {
              content: [
                {
                  type: "text",
                  text: success
                    ? `Memory ${params.id} deleted successfully`
                    : `Failed to delete memory ${params.id} (not found)`,
                },
              ],
            };
          }

          case "list_memories": {
            const params = ListMemoriesSchema.parse(args);
            const memories = await this.memoryManager.listMemories(
              params.namespace,
              params.limit,
              params.offset,
            );

            const formattedMemories = memories
              .map(
                (memory, index) =>
                  `${index + 1}. ${memory.id}: ${memory.text.substring(0, 80)}...\n` +
                  `   Agent: ${memory.metadata.agentId}, Created: ${memory.createdAt.toISOString()}`,
              )
              .join("\n");

            return {
              content: [
                {
                  type: "text",
                  text:
                    memories.length > 0
                      ? `Found ${memories.length} memories:\n\n${formattedMemories}`
                      : "No memories found.",
                },
              ],
            };
          }

          case "graph_add_node": {
            GraphAddNodeSchema.parse(args); // TODO: Implement graph node addition
            return {
              content: [
                {
                  type: "text",
                  text: "Graph node addition not yet implemented",
                },
              ],
            };
          }

          case "graph_add_edge": {
            GraphAddEdgeSchema.parse(args); // TODO: Implement graph edge addition
            return {
              content: [
                {
                  type: "text",
                  text: "Graph edge addition not yet implemented",
                },
              ],
            };
          }

          case "snapshot_save": {
            const params = SnapshotSchema.parse(args);
            const snapshotId = await this.memoryManager.createSnapshot(
              params.name,
              params.description,
            );

            return {
              content: [
                {
                  type: "text",
                  text: `Snapshot created with ID: ${snapshotId}`,
                },
              ],
            };
          }

          case "snapshot_load": {
            const params = LoadSnapshotSchema.parse(args);
            const success = await this.memoryManager.loadSnapshot(
              params.snapshotId,
            );

            return {
              content: [
                {
                  type: "text",
                  text: success
                    ? `Snapshot ${params.snapshotId} loaded successfully`
                    : `Failed to load snapshot ${params.snapshotId}`,
                },
              ],
            };
          }

          case "moderation_review": {
            // TODO: Implement moderation
            return {
              content: [
                {
                  type: "text",
                  text: "Memory moderation not yet implemented",
                },
              ],
            };
          }

          case "graph_read": {
            const params = GraphReadSchema.parse(args);

            // Get all nodes and edges
            const graphStore = this.memoryManager.getGraphStore();
            const nodes = await graphStore.findNodes();
            const edges = await graphStore.findEdges();

            // Calculate statistics
            const nodeTypes: Record<string, number> = {};
            const edgeTypes: Record<string, number> = {};
            const namespaces: Record<string, number> = {};

            nodes.forEach((node) => {
              nodeTypes[node.type] = (nodeTypes[node.type] || 0) + 1;
              if (node.properties.namespace) {
                namespaces[node.properties.namespace] =
                  (namespaces[node.properties.namespace] || 0) + 1;
              }
            });

            edges.forEach((edge) => {
              edgeTypes[edge.type] = (edgeTypes[edge.type] || 0) + 1;
            });

            let response =
              "Graph contains " +
              nodes.length +
              " nodes and " +
              edges.length +
              " edges";

            if (params.includeStats) {
              const stats = {
                totalNodes: nodes.length,
                totalEdges: edges.length,
                nodeTypes: Object.entries(nodeTypes).map(([type, count]) => ({
                  type,
                  count,
                })),
                edgeTypes: Object.entries(edgeTypes).map(([type, count]) => ({
                  type,
                  count,
                })),
                namespaces: Object.entries(namespaces).map(
                  ([namespace, count]) => ({ namespace, count }),
                ),
                density: nodes.length > 0 ? edges.length / nodes.length : 0,
                lastUpdated: new Date(),
              };
              response += "\n\nStatistics:\n" + JSON.stringify(stats, null, 2);
            }

            // Show sample data
            if (nodes.length > 0) {
              response += "\n\nSample nodes (first 3):";
              nodes.slice(0, 3).forEach((node, idx) => {
                response +=
                  "\n" + (idx + 1) + ". " + node.type + ": " + node.name;
                if (node.properties.namespace) {
                  response += " (namespace: " + node.properties.namespace + ")";
                }
              });
            }

            if (edges.length > 0) {
              response += "\n\nSample edges (first 3):";
              edges.slice(0, 3).forEach((edge, idx) => {
                response +=
                  "\n" +
                  (idx + 1) +
                  ". " +
                  edge.from +
                  " → " +
                  edge.to +
                  " (" +
                  edge.type +
                  ")";
              });
            }

            return {
              content: [
                {
                  type: "text",
                  text: response,
                },
              ],
            };
          }

          case "batch_add_memories": {
            const params = BatchAddMemoriesSchema.parse(args);

            const results = {
              successful: 0,
              failed: 0,
              memoryIds: [] as string[],
              errors: [] as Array<{ index: number; error: string }>,
            };

            // Process memories sequentially
            for (let i = 0; i < params.memories.length; i++) {
              const memory = params.memories[i];
              try {
                const result = await this.memoryManager.addMemory(
                  memory.text,
                  memory.agentId || "unknown",
                  memory.namespace || "default",
                  memory.tags || [],
                  memory.visibility || "private",
                  memory.forceSave || false,
                );

                if (result.id) {
                  results.successful++;
                  results.memoryIds.push(result.id);
                } else {
                  results.failed++;
                  results.errors.push({
                    index: i,
                    error:
                      "Memory rejected by gate: " +
                      JSON.stringify(result.filter),
                  });
                }
              } catch (error) {
                results.failed++;
                results.errors.push({
                  index: i,
                  error: error instanceof Error ? error.message : String(error),
                });
              }
            }

            return {
              content: [
                {
                  type: "text",
                  text:
                    "Batch add completed:\n" +
                    "• Successful: " +
                    results.successful +
                    "\n" +
                    "• Failed: " +
                    results.failed +
                    "\n" +
                    (results.errors.length > 0
                      ? "\nErrors:\n" + JSON.stringify(results.errors, null, 2)
                      : ""),
                },
              ],
            };
          }

          case "clear_namespace": {
            const params = ClearNamespaceSchema.parse(args);

            if (!params.confirm) {
              return {
                content: [
                  {
                    type: "text",
                    text:
                      "⚠️ Safety check required\n" +
                      'Add "confirm: true" to clear namespace: "' +
                      params.namespace +
                      '"\n' +
                      "This will delete ALL nodes and edges in this namespace.",
                  },
                ],
              };
            }

            // Get all nodes in the namespace
            const graphStore = this.memoryManager.getGraphStore();
            const allNodes = await graphStore.findNodes();
            const nodesInNamespace = allNodes.filter(
              (node) => node.properties.namespace === params.namespace,
            );

            let edgesCleared = 0;

            // Delete nodes and their edges
            for (const node of nodesInNamespace) {
              // Find edges where this node is source or target
              const edgesFrom = await graphStore.findEdges(
                node.id,
                undefined,
                undefined,
              );
              const edgesTo = await graphStore.findEdges(
                undefined,
                node.id,
                undefined,
              );

              // Delete edges
              for (const edge of [...edgesFrom, ...edgesTo]) {
                await graphStore.deleteEdge(edge.id);
                edgesCleared++;
              }

              // Delete node
              await graphStore.deleteNode(node.id);
            }

            // Note: Vector store namespace clearing would need vector store method
            // For now, we clear graph only

            return {
              content: [
                {
                  type: "text",
                  text:
                    '✅ Namespace cleared: "' +
                    params.namespace +
                    '"\n' +
                    "• Nodes deleted: " +
                    nodesInNamespace.length +
                    "\n" +
                    "• Edges deleted: " +
                    edgesCleared +
                    "\n" +
                    "\nNote: Vector memories in this namespace are not cleared (requires vector store method).",
                },
              ],
            };
          }

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        if (error instanceof z.ZodError) {
          const zodError = error as any;
          const errorMessages = zodError.errors.map((err: any) => `${err.path}: ${err.message}`);
          throw new Error(
            `Invalid parameters: ${errorMessages.join(", ")}`,
          );
        }
        throw error;
      }
    });
  }

  private setupErrorHandling(): void {
    this.server.onerror = (error) => {
      console.error("[EME MCP Server Error]", error);
    };

    process.on("SIGINT", async () => {
      await this.cleanup();
      process.exit(0);
    });
  }

  async start(): Promise<void> {
    try {
      await this.memoryManager.initialize();
      console.error("Alsania EME MCP Server starting...");

      const transport = new StdioServerTransport();
      await this.server.connect(transport);

      console.error("Alsania EME MCP Server ready");
    } catch (error) {
      console.error("Failed to start EME MCP Server:", error);
      await this.cleanup();
      process.exit(1);
    }
  }

  async cleanup(): Promise<void> {
    try {
      await this.memoryManager.close();
      console.error("EME MCP Server cleanup completed");
    } catch (error) {
      console.error("Error during cleanup:", error);
    }
  }
}

// Note: CLI logic moved to src/index.ts for single entry point
// This file is now a pure MCP server class implementation
