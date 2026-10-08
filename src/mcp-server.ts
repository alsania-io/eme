import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { createMemoryManager, MemoryManager } from "./memory-manager.js";
import type { Config } from "./types.js";
import { LocalRAG } from "./local-rag.js";
import { LargeFileHandler } from "./large-file.js";

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
  format: z
    .enum(["lean", "full"])
    .optional()
    .default("lean")
    .describe(
      "Result verbosity. 'lean' (default) returns id/text/namespace/tags/score only " +
        "(drops embedding + timestamps) — token-lean recall. 'full' returns whole entries.",
    ),
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

// Local-RAG Schemas
const QueryDocumentsSchema = z.object({
  query: z.string().min(1).describe("Search query. Include specific terms and add context if needed."),
  limit: z.number().int().min(1).max(50).optional().default(10).describe("Maximum number of results"),
});

const IngestFileSchema = z.object({
  filePath: z.string().describe("Absolute path to the file to ingest"),
});

const IngestDataSchema = z.object({
  content: z.string().describe("The content to ingest"),
  metadata: z.object({
    source: z.string().describe("Source identifier"),
    format: z.enum(["text", "html", "markdown"]).describe("Content format"),
  }).describe("Metadata for the ingested data"),
});

const DeleteDocumentSchema = z.object({
  filePath: z.string().optional().describe("Absolute path to the file"),
  source: z.string().optional().describe("Source identifier"),
});

const ListFilesSchema = z.object({}).describe("List all ingested files");

const LocalRAGStatusSchema = z.object({}).describe("Get system status");

// Doctor / self-check schema (see memo-master 'doctor' ergonomics; EME stays the memory system)
const DoctorSchema = z
  .object({
    verbose: z
      .boolean()
      .optional()
      .describe("Include per-check detail (default false: summary only)"),
  })
  .describe("Run a self-check of EME health: memory counts, graph, RAG, config, Qdrant reachability");

// Large-File Schemas
const ReadLargeFileChunkSchema = z.object({
  filePath: z.string().describe("Absolute path to the file"),
  chunkIndex: z.number().int().min(0).optional().default(0).describe("Zero-based chunk index"),
  linesPerChunk: z.number().int().min(1).optional().describe("Number of lines per chunk"),
  includeLineNumbers: z.boolean().optional().default(false).describe("Include line numbers"),
});

const SearchInLargeFileSchema = z.object({
  filePath: z.string().describe("Absolute path to the file"),
  pattern: z.string().describe("Search pattern"),
  caseSensitive: z.boolean().optional().default(false).describe("Case sensitive search"),
  regex: z.boolean().optional().default(false).describe("Use regex pattern"),
  maxResults: z.number().int().min(1).max(1000).optional().default(100).describe("Maximum results"),
  contextBefore: z.number().int().min(0).optional().default(2).describe("Context lines before"),
  contextAfter: z.number().int().min(0).optional().default(2).describe("Context lines after"),
  startLine: z.number().int().min(1).optional().describe("Start searching from line"),
  endLine: z.number().int().min(1).optional().describe("End searching at line"),
});

const GetFileStructureSchema = z.object({
  filePath: z.string().describe("Absolute path to the file"),
});

const NavigateToLineSchema = z.object({
  filePath: z.string().describe("Absolute path to the file"),
  lineNumber: z.number().int().min(1).describe("Line number to navigate to (1-indexed)"),
  contextLines: z.number().int().min(0).optional().default(5).describe("Context lines before and after"),
});

const GetFileSummarySchema = z.object({
  filePath: z.string().describe("Absolute path to the file"),
});

const StreamLargeFileSchema = z.object({
  filePath: z.string().describe("Absolute path to the file"),
  chunkSize: z.number().int().min(1024).optional().default(65536).describe("Chunk size in bytes"),
  startOffset: z.number().int().min(0).optional().default(0).describe("Starting byte offset"),
  maxBytes: z.number().int().min(1).optional().describe("Maximum bytes to stream"),
  maxChunks: z.number().int().min(1).optional().default(10).describe("Maximum number of chunks"),
});

// Options for zodToJsonSchema
const schemaOptions = {
  $refStrategy: "none" as const,
  target: "jsonSchema7" as const,
  definitions: {},
  errorMessages: false,
};

export class EMEMCPServer {
  private server: Server;
  private memoryManager: MemoryManager | null = null;
  private localRAG: LocalRAG | null = null;
  private largeFileHandler: LargeFileHandler | null = null;
  private config: Config;

  // Keys that require full reinitialize when changed
  private static readonly REINIT_KEYS = new Set([
    'embeddingModel', 'embeddingModelPath', 'embeddingDimension',
    'vectorStore', 'vectorStorePath', 'qdrantUrl', 'qdrantCollection', 'qdrantVectorName',
    'graphStore', 'graphStorePath',
    'snapshotStore', 'snapshotPath',
  ]);

  // Keys that should never be exposed via get_config
  private static readonly SECRET_KEYS = new Set([
    'encryptionKey', 'openRouterApiKey',
  ]);

  // Keys that are safe to update at runtime without reinit
  private static readonly RUNTIME_SAFE_KEYS = new Set([
    'memoryGateEnabled', 'memoryGateThreshold',
    'maxMemoryEntries', 'similarityThreshold', 'logLevel',
    'openRouterReferer', 'openRouterTitle',
  ]);

  constructor(config: Config) {
    this.config = config;
    this.server = new Server(
      {
        name: "eme-mcp-server",
        version: "1.1.0",
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
          // Existing EME tools
          { name: "add_memory", description: "Add a new memory entry", inputSchema: zodToJsonSchema(AddMemorySchema, schemaOptions) },
          { name: "search_memories", description: "Search memories by query", inputSchema: zodToJsonSchema(SearchMemorySchema, schemaOptions) },
          { name: "get_memory", description: "Get a specific memory by ID", inputSchema: zodToJsonSchema(GetMemorySchema, schemaOptions) },
          { name: "update_memory", description: "Update an existing memory", inputSchema: zodToJsonSchema(UpdateMemorySchema, schemaOptions) },
          { name: "delete_memory", description: "Delete a memory by ID", inputSchema: zodToJsonSchema(DeleteMemorySchema, schemaOptions) },
          { name: "create_entities", description: "Create multiple new entities in the knowledge graph", inputSchema: zodToJsonSchema(CreateEntitiesSchema, schemaOptions) },
          { name: "create_relations", description: "Create multiple new relations between entities", inputSchema: zodToJsonSchema(CreateRelationsSchema, schemaOptions) },
          { name: "add_observations", description: "Add new observations to existing entities", inputSchema: zodToJsonSchema(AddObservationsSchema, schemaOptions) },
          { name: "delete_entities", description: "Delete multiple entities and their associated relations", inputSchema: zodToJsonSchema(DeleteEntitiesSchema, schemaOptions) },
          { name: "delete_observations", description: "Delete specific observations from entities", inputSchema: zodToJsonSchema(DeleteObservationsSchema, schemaOptions) },
          { name: "delete_relations", description: "Delete multiple relations from the knowledge graph", inputSchema: zodToJsonSchema(DeleteRelationsSchema, schemaOptions) },
          { name: "read_graph", description: "Read the entire knowledge graph", inputSchema: zodToJsonSchema(z.object({}), schemaOptions) },
          { name: "search_nodes", description: "Search for nodes in the knowledge graph", inputSchema: zodToJsonSchema(z.object({ query: z.string() }), schemaOptions) },
          { name: "open_nodes", description: "Open specific nodes in the knowledge graph", inputSchema: zodToJsonSchema(OpenNodesSchema, schemaOptions) },
          { name: "get_graph", description: "Get the complete knowledge graph", inputSchema: zodToJsonSchema(GetGraphSchema, schemaOptions) },
          { name: "get_graph_stats", description: "Get statistics about the knowledge graph", inputSchema: zodToJsonSchema(GetGraphStatsSchema, schemaOptions) },
          { name: "create_snapshot", description: "Create a snapshot of memories or graph", inputSchema: zodToJsonSchema(CreateSnapshotSchema, schemaOptions) },
          { name: "list_snapshots", description: "List all available snapshots", inputSchema: zodToJsonSchema(ListSnapshotsSchema, schemaOptions) },
          { name: "load_snapshot", description: "Load a snapshot by ID", inputSchema: zodToJsonSchema(LoadSnapshotSchema, schemaOptions) },
          { name: "delete_snapshot", description: "Delete a snapshot by ID", inputSchema: zodToJsonSchema(DeleteSnapshotSchema, schemaOptions) },
          { name: "get_config", description: "Get current configuration", inputSchema: zodToJsonSchema(GetConfigSchema, schemaOptions) },
          { name: "update_config", description: "Update configuration value", inputSchema: zodToJsonSchema(UpdateConfigSchema, schemaOptions) },
          // Local-RAG tools
          { name: "query_documents", description: "Search ingested documents. Your query words are matched exactly (keyword search). Your query meaning is matched semantically (vector search).", inputSchema: zodToJsonSchema(QueryDocumentsSchema, schemaOptions) },
          { name: "ingest_file", description: "Ingest a document file (PDF, DOCX, TXT, MD) into the vector database for semantic search.", inputSchema: zodToJsonSchema(IngestFileSchema, schemaOptions) },
          { name: "ingest_data", description: "Ingest content as a string, not from a file. Use for fetched web pages, copied text, or markdown strings.", inputSchema: zodToJsonSchema(IngestDataSchema, schemaOptions) },
          { name: "delete_file", description: "Delete a previously ingested file or data from the vector database.", inputSchema: zodToJsonSchema(DeleteDocumentSchema, schemaOptions) },
          { name: "list_files", description: "List all files and show which are ingested into the vector database.", inputSchema: zodToJsonSchema(ListFilesSchema, schemaOptions) },
          { name: "local_rag_status", description: "Get system status including total documents, total chunks, database size.", inputSchema: zodToJsonSchema(LocalRAGStatusSchema, schemaOptions) },
          // Doctor / self-check
          { name: "doctor", description: "Run a self-check of EME health: memory counts, knowledge graph, RAG index, config, and Qdrant reachability. Returns { ok, checks[] }.", inputSchema: zodToJsonSchema(DoctorSchema, schemaOptions) },
          // Large-File tools
          { name: "read_large_file_chunk", description: "Read a specific chunk of a large file with intelligent chunking based on file type.", inputSchema: zodToJsonSchema(ReadLargeFileChunkSchema, schemaOptions) },
          { name: "search_in_large_file", description: "Search for a pattern in a large file with context lines. Supports regex and case-sensitive search.", inputSchema: zodToJsonSchema(SearchInLargeFileSchema, schemaOptions) },
          { name: "get_file_structure", description: "Analyze file structure and get comprehensive metadata including line statistics, recommended chunk size, and samples.", inputSchema: zodToJsonSchema(GetFileStructureSchema, schemaOptions) },
          { name: "navigate_to_line", description: "Jump to a specific line in a large file with surrounding context lines.", inputSchema: zodToJsonSchema(NavigateToLineSchema, schemaOptions) },
          { name: "get_file_summary", description: "Get comprehensive statistical summary of a file including line stats, character stats, and word count.", inputSchema: zodToJsonSchema(GetFileSummarySchema, schemaOptions) },
          { name: "stream_large_file", description: "Stream a large file in chunks. Returns multiple chunks for processing very large files efficiently.", inputSchema: zodToJsonSchema(StreamLargeFileSchema, schemaOptions) },
        ],
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      return this.dispatchTool(request.params.name, request.params.arguments ?? {});
    });
  }

  /**
   * Core tool dispatch — shared by the MCP CallTool handler and the HTTP
   * server's executeTool(). Returns MCP-shaped { content: [{type:'text',text}] }.
   */
  async dispatchTool(name: string, args: any): Promise<any> {
    {
      try {
        if (!this.memoryManager) {
          throw new Error("Memory manager not initialized");
        }

        if (!this.localRAG && this.memoryManager) {
          // Initialize localRAG with the vector store and embedding function from memoryManager
          const vectorStore = this.memoryManager.getVectorStore();
          const embedFn = (text: string) => this.memoryManager!.embed(text);
          this.localRAG = new LocalRAG(vectorStore, embedFn);
        }

        if (!this.largeFileHandler) {
          this.largeFileHandler = new LargeFileHandler();
        }

        switch (name) {
        // EME Core Memory Cases
        case "add_memory": {
          const { text, agentId, namespace, tags, visibility } = AddMemorySchema.parse(args);
          const id = await this.memoryManager.addMemory(text, agentId, namespace, tags, visibility);
          return { content: [{ type: "text", text: JSON.stringify({ id, success: true }) }] };
        }

        case "search_memories": {
          const { query, limit, namespace, includeGraph, format } = SearchMemorySchema.parse(args);
          const results = await this.memoryManager.searchMemories(query, limit, namespace);

          // Lean recall (memo-master ergonomics): project to id/text/namespace/tags/score,
          // dropping embedding + timestamps. 'full' preserves prior behavior.
          const projected =
            format === "lean"
              ? results.map((r: any) => {
                  const entry = r.memory ?? r.entry ?? r;
                  return {
                    id: entry.id,
                    text: entry.text,
                    namespace: entry.metadata?.namespace,
                    tags: entry.metadata?.tags,
                    score: r.score,
                  };
                })
              : results;

          let graphData = null;
          if (includeGraph) {
            const graph = await this.memoryManager.getGraph();
            graphData = graph;
          }
          return { content: [{ type: "text", text: JSON.stringify({ results: projected, graph: graphData }, null, 2) }] };
        }

        case "get_memory": {
          const { id } = GetMemorySchema.parse(args);
          const memory = await this.memoryManager.getMemory(id);
          return { content: [{ type: "text", text: JSON.stringify(memory, null, 2) }] };
        }

        case "update_memory": {
          const { id, text, tags } = UpdateMemorySchema.parse(args);
          // Merge tags into EXISTING metadata rather than replacing it wholesale
          // (old code set metadata={tags}, destroying agentId/namespace/visibility).
          const existing = await this.memoryManager.getMemory(id);
          if (!existing) {
            return { content: [{ type: "text", text: JSON.stringify({ success: false, error: `Memory ${id} not found` }) }], isError: true };
          }
          const updates: Partial<any> = {};
          if (text !== undefined) updates.text = text;
          if (tags !== undefined) updates.metadata = { ...existing.metadata, tags };
          const ok = await this.memoryManager.updateMemory(id, updates);
          if (ok === false) {
            return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "Update failed (see server logs)" }) }], isError: true };
          }
          return { content: [{ type: "text", text: JSON.stringify({ success: true, id }) }] };
        }

        case "delete_memory": {
          const { id } = DeleteMemorySchema.parse(args);
          await this.memoryManager.deleteMemory(id);
          return { content: [{ type: "text", text: JSON.stringify({ success: true }) }] };
        }

        case "get_graph": {
          const graph = await this.memoryManager.getGraph();
          return { content: [{ type: "text", text: JSON.stringify(graph, null, 2) }] };
        }

        case "get_graph_stats": {
          const stats = await this.memoryManager.getGraphStats();
          return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
        }

        case "create_snapshot": {
          const { name, type, description } = CreateSnapshotSchema.parse(args);
          const snapshot = await this.memoryManager.createSnapshot(name, type, description);
          return { content: [{ type: "text", text: JSON.stringify(snapshot, null, 2) }] };
        }

        case "list_snapshots": {
          const { type } = ListSnapshotsSchema.parse(args);
          const snapshots = await this.memoryManager.listSnapshots(type);
          return { content: [{ type: "text", text: JSON.stringify(snapshots, null, 2) }] };
        }

        case "load_snapshot": {
          const { id } = LoadSnapshotSchema.parse(args);
          const snapshot = await this.memoryManager.loadSnapshot(id);
          return { content: [{ type: "text", text: JSON.stringify(snapshot, null, 2) }] };
        }

        case "delete_snapshot": {
          const { id } = DeleteSnapshotSchema.parse(args);
          await this.memoryManager.deleteSnapshot(id);
          return { content: [{ type: "text", text: JSON.stringify({ success: true }) }] };
        }

        case "get_config": {
          // Strip secrets before returning config
          const safeConfig = { ...this.config } as Record<string, any>;
          for (const key of EMEMCPServer.SECRET_KEYS) {
            if (safeConfig[key]) {
              safeConfig[key] = '***REDACTED***';
            }
          }
          return { content: [{ type: "text", text: JSON.stringify(safeConfig, null, 2) }] };
        }

        case "update_config": {
          const { key, value } = UpdateConfigSchema.parse(args);

          // Validate key exists on Config type
          if (!(key in this.config)) {
            throw new Error(`Unknown config key: "${key}". Valid keys: ${Object.keys(this.config).join(', ')}`);
          }

          // Block secret key modification via update_config
          if (EMEMCPServer.SECRET_KEYS.has(key)) {
            throw new Error(`Cannot modify "${key}" via update_config for security reasons. Use environment variables.`);
          }

          // Type coercion for known numeric fields
          let coercedValue: any = value;
          if (['embeddingDimension', 'maxMemoryEntries'].includes(key)) {
            coercedValue = Number(value);
            if (isNaN(coercedValue)) throw new Error(`${key} must be a number`);
          } else if (['similarityThreshold', 'memoryGateThreshold'].includes(key)) {
            coercedValue = Number(value);
            if (isNaN(coercedValue)) throw new Error(`${key} must be a number`);
          }

          // Apply the change
          (this.config as any)[key] = coercedValue;

          // If this key affects core subsystems, reinitialize
          if (EMEMCPServer.REINIT_KEYS.has(key) && this.memoryManager) {
            console.error(`[EME-MCP] Config key "${key}" requires reinitialize. Rebuilding subsystems...`);
            // Reset lazy-init caches
            this.localRAG = null;
            this.largeFileHandler = null;
            await this.memoryManager.reinitialize(this.config);
            console.error('[EME-MCP] Reinitialize complete.');
          }

          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: true,
                key,
                value: EMEMCPServer.SECRET_KEYS.has(key) ? '***REDACTED***' : coercedValue,
                reinitialized: EMEMCPServer.REINIT_KEYS.has(key),
              }),
            }],
          };
        }

        case "create_entities": {
          const { entities } = CreateEntitiesSchema.parse(args);
          const results = await this.memoryManager.createEntities(entities);
          return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
        }

        case "create_relations": {
          const { relations } = CreateRelationsSchema.parse(args);
          const results = await this.memoryManager.createRelations(relations);
          return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
        }

        case "add_observations": {
          const { observations } = AddObservationsSchema.parse(args);
          const results = await this.memoryManager.addObservations(observations);
          return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
        }

        case "delete_entities": {
          const { entityNames } = DeleteEntitiesSchema.parse(args);
          const results = await this.memoryManager.deleteEntities(entityNames);
          return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
        }

        case "delete_observations": {
          const { deletions } = DeleteObservationsSchema.parse(args);
          const results = await this.memoryManager.deleteObservations(deletions);
          return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
        }

        case "delete_relations": {
          const { relations } = DeleteRelationsSchema.parse(args);
          const results = await this.memoryManager.deleteRelations(relations);
          return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
        }

        case "read_graph": {
          const graph = await this.memoryManager.getGraph();
          return { content: [{ type: "text", text: JSON.stringify(graph, null, 2) }] };
        }

        case "search_nodes": {
          const { query } = args as { query: string };
          const results = await this.memoryManager.searchNodes(query);
          return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
        }

        case "open_nodes": {
          const { names } = OpenNodesSchema.parse(args);
          const results = await this.memoryManager.openNodes(names);
          return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
        }

        // Local-RAG cases
        case "query_documents": {
          const { query, limit } = QueryDocumentsSchema.parse(args);
          const results = await this.localRAG!.queryDocuments(query, limit);
          return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
        }

        case "ingest_file": {
          const { filePath } = IngestFileSchema.parse(args);
          const result = await this.localRAG!.ingestFile(filePath);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "ingest_data": {
          const parsed = IngestDataSchema.parse(args);
          const result = await this.localRAG!.ingestData(parsed.content, { source: parsed.metadata.source, format: parsed.metadata.format });
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "delete_file": {
          const { filePath, source } = DeleteDocumentSchema.parse(args);
          if (filePath) {
            const result = await this.localRAG!.deleteDocument(filePath);
            return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
          } else if (source) {
            // Handle deletion by source identifier
            const result = await this.localRAG!.deleteDocument(source);
            return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
          }
          throw new Error("Either filePath or source must be provided");
        }

        case "list_files": {
          const files = this.localRAG!.listDocuments();
          return { content: [{ type: "text", text: JSON.stringify(files, null, 2) }] };
        }

        case "local_rag_status": {
          const status = this.localRAG!.getStatus();
          return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }] };
        }

        // Doctor / self-check (memo-master 'doctor' ergonomics)
        case "doctor": {
          const { verbose } = DoctorSchema.parse(args ?? {});
          const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];

          // 1. Memory manager present + vector store reachable (Qdrant)
          try {
            const store = this.memoryManager.getVectorStore();
            const all = await store.getAll();
            checks.push({ name: "vector_store", ok: true, detail: `${all.length} memories` });
          } catch (e: any) {
            checks.push({ name: "vector_store", ok: false, detail: e.message });
          }

          // 2. Knowledge graph
          try {
            const g = await this.memoryManager.getGraphStats();
            checks.push({ name: "graph", ok: true, detail: `${g.totalNodes} nodes / ${g.totalEdges} edges` });
          } catch (e: any) {
            checks.push({ name: "graph", ok: false, detail: e.message });
          }

          // 3. RAG index
          try {
            if (!this.localRAG) {
              const vectorStore = this.memoryManager.getVectorStore();
              const embedFn = (text: string) => this.memoryManager!.embed(text);
              this.localRAG = new LocalRAG(vectorStore, embedFn);
            }
            const s = this.localRAG.getStatus();
            checks.push({ name: "rag", ok: true, detail: `${s.totalDocuments} docs / ${s.totalChunks} chunks` });
          } catch (e: any) {
            checks.push({ name: "rag", ok: false, detail: e.message });
          }

          // 4. Config loaded
          checks.push({
            name: "config",
            ok: !!this.config && Object.keys(this.config).length > 0,
            detail: `${Object.keys(this.config || {}).length} keys`,
          });

          const ok = checks.every((c) => c.ok);
          const report = verbose
            ? { ok, checks }
            : { ok, failed: checks.filter((c) => !c.ok).map((c) => c.name), checks: checks.map((c) => ({ name: c.name, ok: c.ok })) };
          return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
        }

        // Large-File cases
        case "read_large_file_chunk": {
          const { filePath, chunkIndex, linesPerChunk, includeLineNumbers } = ReadLargeFileChunkSchema.parse(args);
          const result = await this.largeFileHandler!.readChunk(filePath, chunkIndex, linesPerChunk, includeLineNumbers);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "search_in_large_file": {
          const { filePath, pattern, caseSensitive, regex, maxResults, contextBefore, contextAfter, startLine, endLine } = SearchInLargeFileSchema.parse(args);
          const results = await this.largeFileHandler!.searchInFile(filePath, pattern, caseSensitive, regex, maxResults, contextBefore, contextAfter, startLine, endLine);
          return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
        }

        case "get_file_structure": {
          const { filePath } = GetFileStructureSchema.parse(args);
          const structure = await this.largeFileHandler!.getFileStructure(filePath);
          return { content: [{ type: "text", text: JSON.stringify(structure, null, 2) }] };
        }

        case "navigate_to_line": {
          const { filePath, lineNumber, contextLines } = NavigateToLineSchema.parse(args);
          const result = await this.largeFileHandler!.navigateToLine(filePath, lineNumber, contextLines);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_file_summary": {
          const { filePath } = GetFileSummarySchema.parse(args);
          const summary = await this.largeFileHandler!.getFileSummary(filePath);
          return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
        }

        case "stream_large_file": {
          const { filePath, chunkSize, startOffset, maxBytes, maxChunks } = StreamLargeFileSchema.parse(args);
          const result = await this.largeFileHandler!.streamFile(filePath, chunkSize, startOffset, maxBytes, maxChunks);
          // Convert buffers to base64 for JSON serialization
          const chunks = result.chunks.map(chunk => chunk.toString('base64'));
          return { content: [{ type: "text", text: JSON.stringify({ ...result, chunks }, null, 2) }] };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error: any) {
        // Provide user-friendly error messages
        const message = error?.message || String(error);
        console.error(`[EME-MCP] Tool "${name}" error:`, message);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ error: message, tool: name }),
          }],
          isError: true,
        };
      }
    }
  }

  /**
   * Direct tool execution for non-MCP callers (e.g. the HTTP GUI server).
   * Unwraps the MCP content envelope and returns the raw JSON result.
   */
  async executeTool(name: string, args: any): Promise<any> {
    const res = await this.dispatchTool(name, args);
    try {
      const text = res?.content?.[0]?.text;
      if (typeof text === "string") {
        const parsed = JSON.parse(text);
        // Preserve error signaling for HTTP callers
        if (res.isError) {
          throw new Error(parsed?.error || `Tool ${name} failed`);
        }
        return parsed;
      }
    } catch (e: any) {
      if (e?.message) throw e;
    }
    return res;
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

  // NOTE: session/API-key tools (session_push, generate_api_key, etc.) live in
  // mcp-server-auth.ts. They were never registered in this server's ListTools
  // handler and had no callers — the executeTool bridge below was orphaned from
  // a partial refactor and referenced undefined handlers. Removed 2026-09-24 to
  // restore compilation. If session/API-key support is wanted here, port the
  // imports, fields, constructor init, and tool registrations from
  // mcp-server-auth.ts together — not just the bridge method.

  async close(): Promise<void> {
    if (this.memoryManager) {
      await this.memoryManager.close();
    }
    await this.server.close();
  }
}
