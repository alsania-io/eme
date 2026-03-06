import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { createMemoryManager, MemoryManager } from "./memory-manager.js";
import type { Config, SearchResult } from "./types.js";
import { randomUUID } from "crypto";

// Schema definitions with proper validation
const AddMemorySchema = z.object({
  text: z.string().min(1).describe("The memory text to store"),
  agentId: z
    .string()
    .optional()
    .default("unknown")
    .describe("ID of the agent creating the memory"),
  namespace: z
    .string()
    .optional()
    .default("default")
    .describe("Namespace for the memory"),
  tags: z
    .array(z.string())
    .optional()
    .default([])
    .describe("Tags to categorize the memory"),
  visibility: z
    .enum(["private", "shared", "system"])
    .optional()
    .default("private")
    .describe("Visibility level of the memory"),
});

const SearchMemorySchema = z.object({
  query: z.string().min(1).describe("Search query text"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(5)
    .describe("Maximum number of results"),
  namespace: z.string().optional().describe("Filter by namespace"),
  includeGraph: z
    .boolean()
    .optional()
    .default(true)
    .describe("Include graph context in results"),
});

const GetMemorySchema = z.object({
  id: z.string().uuid().describe("ID of the memory to retrieve"),
});

const UpdateMemorySchema = z.object({
  id: z.string().uuid().describe("ID of the memory to update"),
  text: z.string().optional().describe("Updated memory text"),
  tags: z.array(z.string()).optional().describe("Updated tags"),
});

const DeleteMemorySchema = z.object({
  id: z.string().uuid().describe("ID of the memory to delete"),
});

const GetGraphSchema = z
  .object({})
  .describe("Get the complete knowledge graph");
const GetGraphStatsSchema = z
  .object({})
  .describe("Get statistics about the knowledge graph");

const CreateSnapshotSchema = z.object({
  name: z.string().min(1).describe("Name for the snapshot"),
  type: z
    .enum(["memory", "graph", "full"])
    .optional()
    .default("full")
    .describe("Type of snapshot"),
  description: z.string().optional().describe("Optional description"),
});

const ListSnapshotsSchema = z.object({
  type: z
    .enum(["memory", "graph", "full"])
    .optional()
    .describe("Filter by snapshot type"),
});

const LoadSnapshotSchema = z.object({
  id: z.string().uuid().describe("ID of the snapshot to load"),
});

const DeleteSnapshotSchema = z.object({
  id: z.string().uuid().describe("ID of the snapshot to delete"),
});

const GetConfigSchema = z.object({}).describe("Get current configuration");

const UpdateConfigSchema = z.object({
  key: z.string().describe("Configuration key to update"),
  value: z.any().describe("New value"),
});

// Memory-Cache Compatible Schemas
const CreateEntitiesSchema = z.object({
  entities: z
    .array(
      z.object({
        name: z.string().min(1),
        entityType: z.string(),
        observations: z.array(z.string()).optional().default([]),
      }),
    )
    .describe("Array of entities to create"),
});

const CreateRelationsSchema = z.object({
  relations: z
    .array(
      z.object({
        from: z.string().min(1),
        to: z.string().min(1),
        relationType: z.string().min(1),
      }),
    )
    .describe("Array of relations to create"),
});

const AddObservationsSchema = z.object({
  observations: z
    .array(
      z.object({
        entityName: z.string().min(1),
        contents: z.array(z.string()),
      }),
    )
    .describe("Array of observations to add"),
});

const DeleteEntitiesSchema = z.object({
  entityNames: z.array(z.string()).describe("Array of entity names to delete"),
});

const DeleteObservationsSchema = z.object({
  deletions: z
    .array(
      z.object({
        entityName: z.string().min(1),
        observations: z.array(z.string()),
      }),
    )
    .describe("Array of observations to delete"),
});

const DeleteRelationsSchema = z.object({
  relations: z
    .array(
      z.object({
        from: z.string().min(1),
        to: z.string().min(1),
        relationType: z.string().min(1),
      }),
    )
    .describe("Array of relations to delete"),
});

const OpenNodesSchema = z.object({
  names: z.array(z.string()).describe("Array of entity names to retrieve"),
});

// Options for zodToJsonSchema to include descriptions and proper formatting
const schemaOptions = {
  $refStrategy: "none" as const,
  target: "jsonSchema7" as const,
  definitions: {},
  errorMessages: false,
};

export class EMEMCPServer {
  private server: Server;
  private memoryManager: MemoryManager | null = null;
  private config: Config;
  private tools: Map<string, any> = new Map();

  constructor(config: Config) {
    this.config = config;
    this.server = new Server(
      {
        name: "eme-mcp-server",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );
    this.setupToolHandlers();
  }

  private setupToolHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "add_memory",
            description: "Add a new memory entry",
            inputSchema: zodToJsonSchema(AddMemorySchema, schemaOptions),
          },
          {
            name: "search_memories",
            description: "Search memories by query",
            inputSchema: zodToJsonSchema(SearchMemorySchema, schemaOptions),
          },
          {
            name: "get_memory",
            description: "Get a specific memory by ID",
            inputSchema: zodToJsonSchema(GetMemorySchema, schemaOptions),
          },
          {
            name: "update_memory",
            description: "Update an existing memory",
            inputSchema: zodToJsonSchema(UpdateMemorySchema, schemaOptions),
          },
          {
            name: "delete_memory",
            description: "Delete a memory by ID",
            inputSchema: zodToJsonSchema(DeleteMemorySchema, schemaOptions),
          },
          {
            name: "create_entities",
            description: "Create multiple new entities in the knowledge graph",
            inputSchema: zodToJsonSchema(CreateEntitiesSchema, schemaOptions),
          },
          {
            name: "create_relations",
            description:
              "Create multiple new relations between entities in the knowledge graph. Relations should be in active voice",
            inputSchema: zodToJsonSchema(CreateRelationsSchema, schemaOptions),
          },
          {
            name: "add_observations",
            description:
              "Add new observations to existing entities in the knowledge graph",
            inputSchema: zodToJsonSchema(AddObservationsSchema, schemaOptions),
          },
          {
            name: "delete_entities",
            description:
              "Delete multiple entities and their associated relations from the knowledge graph",
            inputSchema: zodToJsonSchema(DeleteEntitiesSchema, schemaOptions),
          },
          {
            name: "delete_observations",
            description:
              "Delete specific observations from entities in the knowledge graph",
            inputSchema: zodToJsonSchema(
              DeleteObservationsSchema,
              schemaOptions,
            ),
          },
          {
            name: "delete_relations",
            description: "Delete multiple relations from the knowledge graph",
            inputSchema: zodToJsonSchema(DeleteRelationsSchema, schemaOptions),
          },
          {
            name: "read_graph",
            description: "Read the entire knowledge graph",
            inputSchema: zodToJsonSchema(
              z.object({}).describe("Read the entire knowledge graph"),
              schemaOptions,
            ),
          },
          {
            name: "search_nodes",
            description:
              "Search for nodes in the knowledge graph based on a query",
            inputSchema: zodToJsonSchema(
              z.object({
                query: z
                  .string()
                  .min(1)
                  .describe(
                    "The search query to match against entity names, types, and observation content",
                  ),
              }),
              schemaOptions,
            ),
          },
          {
            name: "open_nodes",
            description:
              "Open specific nodes in the knowledge graph by their names",
            inputSchema: zodToJsonSchema(OpenNodesSchema, schemaOptions),
          },
          {
            name: "get_graph",
            description: "Get the complete knowledge graph",
            inputSchema: zodToJsonSchema(GetGraphSchema, schemaOptions),
          },
          {
            name: "get_graph_stats",
            description: "Get statistics about the knowledge graph",
            inputSchema: zodToJsonSchema(GetGraphStatsSchema, schemaOptions),
          },
          {
            name: "create_snapshot",
            description: "Create a snapshot of memories or graph",
            inputSchema: zodToJsonSchema(CreateSnapshotSchema, schemaOptions),
          },
          {
            name: "list_snapshots",
            description: "List all available snapshots",
            inputSchema: zodToJsonSchema(ListSnapshotsSchema, schemaOptions),
          },
          {
            name: "load_snapshot",
            description: "Load a snapshot by ID",
            inputSchema: zodToJsonSchema(LoadSnapshotSchema, schemaOptions),
          },
          {
            name: "delete_snapshot",
            description: "Delete a snapshot by ID",
            inputSchema: zodToJsonSchema(DeleteSnapshotSchema, schemaOptions),
          },
          {
            name: "get_config",
            description: "Get current configuration",
            inputSchema: zodToJsonSchema(GetConfigSchema, schemaOptions),
          },
          {
            name: "update_config",
            description: "Update configuration value",
            inputSchema: zodToJsonSchema(UpdateConfigSchema, schemaOptions),
          },
        ],
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      if (!this.memoryManager) {
        throw new Error("Memory manager not initialized");
      }

      switch (name) {
        case "add_memory": {
          const { text, agentId, namespace, tags, visibility } =
            AddMemorySchema.parse(args);
          const id = await this.memoryManager.addMemory(
            text,
            agentId || "unknown",
            namespace || "default",
            tags || [],
            visibility || "private",
          );
          return {
            content: [
              { type: "text", text: JSON.stringify({ id, success: true }) },
            ],
          };
        }

        case "search_memories": {
          const { query, limit, namespace, includeGraph } =
            SearchMemorySchema.parse(args);
          const results = await this.memoryManager.searchMemories(
            query,
            limit,
            namespace,
          );
          let graphData = null;
          if (includeGraph) {
            const graph = await this.memoryManager.getGraph();
            graphData = graph;
          }
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ results, graph: graphData }, null, 2),
              },
            ],
          };
        }

        case "get_memory": {
          const { id } = GetMemorySchema.parse(args);
          const memory = await this.memoryManager.getMemory(id);
          return {
            content: [{ type: "text", text: JSON.stringify(memory, null, 2) }],
          };
        }

        case "update_memory": {
          const { id, text, tags } = UpdateMemorySchema.parse(args);
          const updates: Partial<any> = {};
          if (text) updates.text = text;
          if (tags) updates.metadata = { tags };
          const success = await this.memoryManager.updateMemory(id, updates);
          return {
            content: [{ type: "text", text: JSON.stringify({ success }) }],
          };
        }

        case "delete_memory": {
          const { id } = DeleteMemorySchema.parse(args);
          const success = await this.memoryManager.deleteMemory(id);
          return {
            content: [{ type: "text", text: JSON.stringify({ success }) }],
          };
        }

        case "get_graph": {
          const graph = await this.memoryManager.getGraph();
          return {
            content: [{ type: "text", text: JSON.stringify(graph, null, 2) }],
          };
        }

        case "get_graph_stats": {
          const stats = await this.memoryManager.getGraphStats();
          return {
            content: [{ type: "text", text: JSON.stringify(stats, null, 2) }],
          };
        }

        case "create_snapshot": {
          const { name, type, description } = CreateSnapshotSchema.parse(args);
          const snapshot = await this.memoryManager.createSnapshot(
            name,
            type,
            description,
          );
          return {
            content: [
              { type: "text", text: JSON.stringify(snapshot, null, 2) },
            ],
          };
        }

        case "list_snapshots": {
          const { type } = ListSnapshotsSchema.parse(args);
          const snapshots = await this.memoryManager.listSnapshots(type);
          return {
            content: [
              { type: "text", text: JSON.stringify(snapshots, null, 2) },
            ],
          };
        }

        case "load_snapshot": {
          const { id } = LoadSnapshotSchema.parse(args);
          const snapshot = await this.memoryManager.loadSnapshot(id);
          return {
            content: [
              { type: "text", text: JSON.stringify(snapshot, null, 2) },
            ],
          };
        }

        case "delete_snapshot": {
          const { id } = DeleteSnapshotSchema.parse(args);
          const success = await this.memoryManager.deleteSnapshot(id);
          return {
            content: [{ type: "text", text: JSON.stringify({ success }) }],
          };
        }

        case "get_config": {
          return {
            content: [
              { type: "text", text: JSON.stringify(this.config, null, 2) },
            ],
          };
        }

        case "update_config": {
          const { key, value } = UpdateConfigSchema.parse(args);
          (this.config as any)[key] = value;
          return {
            content: [
              { type: "text", text: JSON.stringify({ success: true }) },
            ],
          };
        }

        case "create_entities": {
          const { entities } = CreateEntitiesSchema.parse(args);
          const results = await this.memoryManager.createEntities(entities);
          return {
            content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
          };
        }

        case "create_relations": {
          const { relations } = CreateRelationsSchema.parse(args);
          const results = await this.memoryManager.createRelations(relations);
          return {
            content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
          };
        }

        case "add_observations": {
          const { observations } = AddObservationsSchema.parse(args);
          const results =
            await this.memoryManager.addObservations(observations);
          return {
            content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
          };
        }

        case "delete_entities": {
          const { entityNames } = DeleteEntitiesSchema.parse(args);
          const results = await this.memoryManager.deleteEntities(entityNames);
          return {
            content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
          };
        }

        case "delete_observations": {
          const { deletions } = DeleteObservationsSchema.parse(args);
          const results =
            await this.memoryManager.deleteObservations(deletions);
          return {
            content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
          };
        }

        case "delete_relations": {
          const { relations } = DeleteRelationsSchema.parse(args);
          const results = await this.memoryManager.deleteRelations(relations);
          return {
            content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
          };
        }

        case "read_graph": {
          const graph = await this.memoryManager.getGraph();
          return {
            content: [{ type: "text", text: JSON.stringify(graph, null, 2) }],
          };
        }

        case "search_nodes": {
          const { query } = args as { query: string };
          const results = await this.memoryManager.searchNodes(query);
          return {
            content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
          };
        }

        case "open_nodes": {
          const { names } = OpenNodesSchema.parse(args);
          const results = await this.memoryManager.openNodes(names);
          return {
            content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
          };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    });
  }

  async initialize(): Promise<void> {
    this.memoryManager = await createMemoryManager(this.config);
    console.error("[EME-MCP] Memory manager initialized");
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("[EME-MCP] Server running on stdio");
  }

  async close(): Promise<void> {
    if (this.memoryManager) {
      await this.memoryManager.close();
    }
    await this.server.close();
  }
}
