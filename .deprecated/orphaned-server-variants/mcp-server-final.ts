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
import { SessionToolHandlers } from "./session-tools.js";
import {
  SessionPushSchema,
  SessionGetSchema,
  SessionAckSchema,
  SessionClearSchema,
  SessionCheckpointSchema,
  SessionRestoreSchema,
  SessionListCheckpointsSchema,
  SessionInfoSchema,
} from "./session-tools.js";
import { ApiKeyToolHandlers } from "./api-key-tools.js";
import {
  GenerateApiKeySchema,
  ValidateApiKeySchema,
  RevokeApiKeySchema,
  ListApiKeysSchema,
  GetApiKeyUsageSchema,
  GetTiersSchema,
} from "./api-key-tools.js";

// Existing schemas (keeping all original ones)
const AddMemorySchema = z.object({
  text: z.string().min(1),
  agentId: z.string().optional().default("unknown"),
  namespace: z.string().optional().default("default"),
  tags: z.array(z.string()).optional().default([]),
  visibility: z.enum(["private", "shared", "system"]).optional().default("private"),
});

const SearchMemorySchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(100).optional().default(5),
  namespace: z.string().optional(),
  includeGraph: z.boolean().optional().default(true),
});

const GetMemorySchema = z.object({ id: z.string().uuid() });
const UpdateMemorySchema = z.object({ id: z.string().uuid(), text: z.string().optional(), tags: z.array(z.string()).optional() });
const DeleteMemorySchema = z.object({ id: z.string().uuid() });
const GetGraphSchema = z.object({});
const GetGraphStatsSchema = z.object({});
const CreateSnapshotSchema = z.object({ name: z.string().min(1), type: z.enum(["memory", "graph", "full"]).optional().default("full"), description: z.string().optional() });
const ListSnapshotsSchema = z.object({ type: z.enum(["memory", "graph", "full"]).optional() });
const LoadSnapshotSchema = z.object({ id: z.string().uuid() });
const DeleteSnapshotSchema = z.object({ id: z.string().uuid() });
const GetConfigSchema = z.object({});
const UpdateConfigSchema = z.object({ key: z.string(), value: z.any() });

const CreateEntitiesSchema = z.object({ entities: z.array(z.object({ name: z.string().min(1), entityType: z.string(), observations: z.array(z.string()).optional().default([]) })) });
const CreateRelationsSchema = z.object({ relations: z.array(z.object({ from: z.string().min(1), to: z.string().min(1), relationType: z.string().min(1) })) });
const AddObservationsSchema = z.object({ observations: z.array(z.object({ entityName: z.string().min(1), contents: z.array(z.string()) })) });
const DeleteEntitiesSchema = z.object({ entityNames: z.array(z.string()) });
const DeleteObservationsSchema = z.object({ deletions: z.array(z.object({ entityName: z.string().min(1), observations: z.array(z.string()) })) });
const DeleteRelationsSchema = z.object({ relations: z.array(z.object({ from: z.string().min(1), to: z.string().min(1), relationType: z.string().min(1) })) });
const OpenNodesSchema = z.object({ names: z.array(z.string()) });

const QueryDocumentsSchema = z.object({ query: z.string().min(1), limit: z.number().int().min(1).max(50).optional().default(10) });
const IngestFileSchema = z.object({ filePath: z.string() });
const IngestDataSchema = z.object({ content: z.string(), metadata: z.object({ source: z.string(), format: z.enum(["text", "html", "markdown"]) }) });
const DeleteDocumentSchema = z.object({ filePath: z.string().optional(), source: z.string().optional() });
const ListFilesSchema = z.object({});
const LocalRAGStatusSchema = z.object({});

const ReadLargeFileChunkSchema = z.object({ filePath: z.string(), chunkIndex: z.number().int().min(0).optional().default(0), linesPerChunk: z.number().int().min(1).optional(), includeLineNumbers: z.boolean().optional().default(false) });
const SearchInLargeFileSchema = z.object({ filePath: z.string(), pattern: z.string(), caseSensitive: z.boolean().optional().default(false), regex: z.boolean().optional().default(false), maxResults: z.number().int().min(1).max(1000).optional().default(100), contextBefore: z.number().int().min(0).optional().default(2), contextAfter: z.number().int().min(0).optional().default(2), startLine: z.number().int().min(1).optional(), endLine: z.number().int().min(1).optional() });
const GetFileStructureSchema = z.object({ filePath: z.string() });
const NavigateToLineSchema = z.object({ filePath: z.string(), lineNumber: z.number().int().min(1), contextLines: z.number().int().min(0).optional().default(5) });
const GetFileSummarySchema = z.object({ filePath: z.string() });
const StreamLargeFileSchema = z.object({ filePath: z.string(), chunkSize: z.number().int().min(1024).optional().default(65536), startOffset: z.number().int().min(0).optional().default(0), maxBytes: z.number().int().min(1).optional(), maxChunks: z.number().int().min(1).optional().default(10) });

const schemaOptions = { $refStrategy: "none" as const, target: "jsonSchema7" as const, definitions: {}, errorMessages: false };

export class EMEMCPServer {
  private server: Server;
  private memoryManager: MemoryManager | null = null;
  private localRAG: LocalRAG | null = null;
  private largeFileHandler: LargeFileHandler | null = null;
  private sessionToolHandlers: SessionToolHandlers | null = null;
  private apiKeyToolHandlers: ApiKeyToolHandlers | null = null;
  private config: Config;

  private static readonly REINIT_KEYS = new Set(['embeddingModel', 'embeddingModelPath', 'embeddingDimension', 'vectorStore', 'vectorStorePath', 'qdrantUrl', 'qdrantCollection', 'qdrantVectorName', 'graphStore', 'graphStorePath', 'snapshotStore', 'snapshotPath']);
  private static readonly SECRET_KEYS = new Set(['encryptionKey', 'openRouterApiKey']);

  constructor(config: Config) {
    this.config = config;
    this.sessionToolHandlers = new SessionToolHandlers();
    this.apiKeyToolHandlers = new ApiKeyToolHandlers();
    this.server = new Server({ name: "eme-mcp-server", version: "1.1.8" }, { capabilities: { tools: {} } });
    this.setupToolHandlers();
  }

  private setupToolHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        { name: "add_memory", description: "Add a new memory entry", inputSchema: zodToJsonSchema(AddMemorySchema, schemaOptions) },
        { name: "search_memories", description: "Search memories by query", inputSchema: zodToJsonSchema(SearchMemorySchema, schemaOptions) },
        { name: "get_memory", description: "Get a specific memory by ID", inputSchema: zodToJsonSchema(GetMemorySchema, schemaOptions) },
        { name: "update_memory", description: "Update an existing memory", inputSchema: zodToJsonSchema(UpdateMemorySchema, schemaOptions) },
        { name: "delete_memory", description: "Delete a memory by ID", inputSchema: zodToJsonSchema(DeleteMemorySchema, schemaOptions) },
        { name: "create_entities", description: "Create entities in knowledge graph", inputSchema: zodToJsonSchema(CreateEntitiesSchema, schemaOptions) },
        { name: "create_relations", description: "Create relations between entities", inputSchema: zodToJsonSchema(CreateRelationsSchema, schemaOptions) },
        { name: "add_observations", description: "Add observations to entities", inputSchema: zodToJsonSchema(AddObservationsSchema, schemaOptions) },
        { name: "delete_entities", description: "Delete entities", inputSchema: zodToJsonSchema(DeleteEntitiesSchema, schemaOptions) },
        { name: "delete_observations", description: "Delete observations", inputSchema: zodToJsonSchema(DeleteObservationsSchema, schemaOptions) },
        { name: "delete_relations", description: "Delete relations", inputSchema: zodToJsonSchema(DeleteRelationsSchema, schemaOptions) },
        { name: "read_graph", description: "Read the entire knowledge graph", inputSchema: zodToJsonSchema(z.object({}), schemaOptions) },
        { name: "search_nodes", description: "Search for nodes", inputSchema: zodToJsonSchema(z.object({ query: z.string() }), schemaOptions) },
        { name: "open_nodes", description: "Open specific nodes", inputSchema: zodToJsonSchema(OpenNodesSchema, schemaOptions) },
        { name: "get_graph", description: "Get complete knowledge graph", inputSchema: zodToJsonSchema(GetGraphSchema, schemaOptions) },
        { name: "get_graph_stats", description: "Get graph statistics", inputSchema: zodToJsonSchema(GetGraphStatsSchema, schemaOptions) },
        { name: "create_snapshot", description: "Create a snapshot", inputSchema: zodToJsonSchema(CreateSnapshotSchema, schemaOptions) },
        { name: "list_snapshots", description: "List snapshots", inputSchema: zodToJsonSchema(ListSnapshotsSchema, schemaOptions) },
        { name: "load_snapshot", description: "Load a snapshot", inputSchema: zodToJsonSchema(LoadSnapshotSchema, schemaOptions) },
        { name: "delete_snapshot", description: "Delete a snapshot", inputSchema: zodToJsonSchema(DeleteSnapshotSchema, schemaOptions) },
        { name: "get_config", description: "Get configuration", inputSchema: zodToJsonSchema(GetConfigSchema, schemaOptions) },
        { name: "update_config", description: "Update configuration", inputSchema: zodToJsonSchema(UpdateConfigSchema, schemaOptions) },
        { name: "query_documents", description: "Search ingested documents", inputSchema: zodToJsonSchema(QueryDocumentsSchema, schemaOptions) },
        { name: "ingest_file", description: "Ingest a document file", inputSchema: zodToJsonSchema(IngestFileSchema, schemaOptions) },
        { name: "ingest_data", description: "Ingest content as string", inputSchema: zodToJsonSchema(IngestDataSchema, schemaOptions) },
        { name: "delete_file", description: "Delete ingested file", inputSchema: zodToJsonSchema(DeleteDocumentSchema, schemaOptions) },
        { name: "list_files", description: "List ingested files", inputSchema: zodToJsonSchema(ListFilesSchema, schemaOptions) },
        { name: "local_rag_status", description: "Get RAG system status", inputSchema: zodToJsonSchema(LocalRAGStatusSchema, schemaOptions) },
        { name: "read_large_file_chunk", description: "Read chunk of large file", inputSchema: zodToJsonSchema(ReadLargeFileChunkSchema, schemaOptions) },
        { name: "search_in_large_file", description: "Search in large file", inputSchema: zodToJsonSchema(SearchInLargeFileSchema, schemaOptions) },
        { name: "get_file_structure", description: "Get file structure", inputSchema: zodToJsonSchema(GetFileStructureSchema, schemaOptions) },
        { name: "navigate_to_line", description: "Navigate to line in file", inputSchema: zodToJsonSchema(NavigateToLineSchema, schemaOptions) },
        { name: "get_file_summary", description: "Get file summary", inputSchema: zodToJsonSchema(GetFileSummarySchema, schemaOptions) },
        { name: "stream_large_file", description: "Stream large file", inputSchema: zodToJsonSchema(StreamLargeFileSchema, schemaOptions) },
        { name: "session_push", description: "Store instruction for session", inputSchema: zodToJsonSchema(SessionPushSchema, schemaOptions) },
        { name: "session_get", description: "Get context for current turn", inputSchema: zodToJsonSchema(SessionGetSchema, schemaOptions) },
        { name: "session_ack", description: "Acknowledge instructions", inputSchema: zodToJsonSchema(SessionAckSchema, schemaOptions) },
        { name: "session_clear", description: "Clear session cache", inputSchema: zodToJsonSchema(SessionClearSchema, schemaOptions) },
        { name: "session_checkpoint", description: "Save session checkpoint", inputSchema: zodToJsonSchema(SessionCheckpointSchema, schemaOptions) },
        { name: "session_restore", description: "Restore from checkpoint", inputSchema: zodToJsonSchema(SessionRestoreSchema, schemaOptions) },
        { name: "session_list_checkpoints", description: "List checkpoints", inputSchema: zodToJsonSchema(SessionListCheckpointsSchema, schemaOptions) },
        { name: "session_info", description: "Get session info", inputSchema: zodToJsonSchema(SessionInfoSchema, schemaOptions) },
        { name: "generate_api_key", description: "Generate a new API key", inputSchema: zodToJsonSchema(GenerateApiKeySchema, schemaOptions) },
        { name: "validate_api_key", description: "Validate an API key", inputSchema: zodToJsonSchema(ValidateApiKeySchema, schemaOptions) },
        { name: "revoke_api_key", description: "Revoke an API key", inputSchema: zodToJsonSchema(RevokeApiKeySchema, schemaOptions) },
        { name: "list_api_keys", description: "List API keys for owner", inputSchema: zodToJsonSchema(ListApiKeysSchema, schemaOptions) },
        { name: "get_api_key_usage", description: "Get API key usage stats", inputSchema: zodToJsonSchema(GetApiKeyUsageSchema, schemaOptions) },
        { name: "get_tiers", description: "Get available tiers", inputSchema: zodToJsonSchema(GetTiersSchema, schemaOptions) },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      try {
        if (!this.memoryManager) throw new Error("Memory manager not initialized");
        if (!this.localRAG && this.memoryManager) {
          this.localRAG = new LocalRAG(this.memoryManager.getVectorStore(), (text: string) => this.memoryManager!.embed(text));
        }
        if (!this.largeFileHandler) this.largeFileHandler = new LargeFileHandler();

        switch (name) {
          case "add_memory": { const { text, agentId, namespace, tags, visibility } = AddMemorySchema.parse(args); const id = await this.memoryManager.addMemory(text, agentId, namespace, tags, visibility); return { content: [{ type: "text", text: JSON.stringify({ id, success: true }) }] }; }
          case "search_memories": { const { query, limit, namespace, includeGraph } = SearchMemorySchema.parse(args); const results = await this.memoryManager.searchMemories(query, limit, namespace); let graphData = null; if (includeGraph) graphData = await this.memoryManager.getGraph(); return { content: [{ type: "text", text: JSON.stringify({ results, graph: graphData }, null, 2) }] }; }
          case "get_memory": { const { id } = GetMemorySchema.parse(args); const memory = await this.memoryManager.getMemory(id); return { content: [{ type: "text", text: JSON.stringify(memory, null, 2) }] }; }
          case "update_memory": { const { id, text, tags } = UpdateMemorySchema.parse(args); const updates: any = {}; if (text) updates.text = text; if (tags) updates.metadata = { tags }; await this.memoryManager.updateMemory(id, updates); return { content: [{ type: "text", text: JSON.stringify({ success: true }) }] }; }
          case "delete_memory": { const { id } = DeleteMemorySchema.parse(args); await this.memoryManager.deleteMemory(id); return { content: [{ type: "text", text: JSON.stringify({ success: true }) }] }; }
          case "get_graph": { const graph = await this.memoryManager.getGraph(); return { content: [{ type: "text", text: JSON.stringify(graph, null, 2) }] }; }
          case "get_graph_stats": { const stats = await this.memoryManager.getGraphStats(); return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] }; }
          case "create_snapshot": { const parsed = CreateSnapshotSchema.parse(args); const snapshot = await this.memoryManager.createSnapshot(parsed.name, parsed.type, parsed.description); return { content: [{ type: "text", text: JSON.stringify(snapshot, null, 2) }] }; }
          case "list_snapshots": { const parsed = ListSnapshotsSchema.parse(args); const snapshots = await this.memoryManager.listSnapshots(parsed.type); return { content: [{ type: "text", text: JSON.stringify(snapshots, null, 2) }] }; }
          case "load_snapshot": { const parsed = LoadSnapshotSchema.parse(args); const snapshot = await this.memoryManager.loadSnapshot(parsed.id); return { content: [{ type: "text", text: JSON.stringify(snapshot, null, 2) }] }; }
          case "delete_snapshot": { const parsed = DeleteSnapshotSchema.parse(args); await this.memoryManager.deleteSnapshot(parsed.id); return { content: [{ type: "text", text: JSON.stringify({ success: true }) }] }; }
          case "get_config": { const safeConfig = { ...this.config }; for (const key of EMEMCPServer.SECRET_KEYS) if (safeConfig[key]) safeConfig[key] = '***REDACTED***'; return { content: [{ type: "text", text: JSON.stringify(safeConfig, null, 2) }] }; }
          case "update_config": { const { key, value } = UpdateConfigSchema.parse(args); if (!(key in this.config)) throw new Error(`Unknown config key: ${key}`); if (EMEMCPServer.SECRET_KEYS.has(key)) throw new Error(`Cannot modify ${key}`); (this.config as any)[key] = value; if (EMEMCPServer.REINIT_KEYS.has(key) && this.memoryManager) { this.localRAG = null; this.largeFileHandler = null; await this.memoryManager.reinitialize(this.config); } return { content: [{ type: "text", text: JSON.stringify({ success: true, key }) }] }; }
          case "create_entities": { const parsed = CreateEntitiesSchema.parse(args); const results = await this.memoryManager.createEntities(parsed.entities); return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] }; }
          case "create_relations": { const parsed = CreateRelationsSchema.parse(args); const results = await this.memoryManager.createRelations(parsed.relations); return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] }; }
          case "add_observations": { const parsed = AddObservationsSchema.parse(args); const results = await this.memoryManager.addObservations(parsed.observations); return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] }; }
          case "delete_entities": { const parsed = DeleteEntitiesSchema.parse(args); const results = await this.memoryManager.deleteEntities(parsed.entityNames); return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] }; }
          case "delete_observations": { const parsed = DeleteObservationsSchema.parse(args); const results = await this.memoryManager.deleteObservations(parsed.deletions); return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] }; }
          case "delete_relations": { const parsed = DeleteRelationsSchema.parse(args); const results = await this.memoryManager.deleteRelations(parsed.relations); return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] }; }
          case "read_graph": { const graph = await this.memoryManager.getGraph(); return { content: [{ type: "text", text: JSON.stringify(graph, null, 2) }] }; }
          case "search_nodes": { const { query } = args as { query: string }; const results = await this.memoryManager.searchNodes(query); return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] }; }
          case "open_nodes": { const parsed = OpenNodesSchema.parse(args); const results = await this.memoryManager.openNodes(parsed.names); return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] }; }
          case "query_documents": { const parsed = QueryDocumentsSchema.parse(args); const results = await this.localRAG!.queryDocuments(parsed.query, parsed.limit); return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] }; }
          case "ingest_file": { const parsed = IngestFileSchema.parse(args); const result = await this.localRAG!.ingestFile(parsed.filePath); return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }; }
          case "ingest_data": { const parsed = IngestDataSchema.parse(args); const result = await this.localRAG!.ingestData(parsed.content, { source: parsed.metadata.source, format: parsed.metadata.format }); return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }; }
          case "delete_file": { const parsed = DeleteDocumentSchema.parse(args); const result = parsed.filePath ? await this.localRAG!.deleteDocument(parsed.filePath) : await this.localRAG!.deleteDocument(parsed.source); return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }; }
          case "list_files": { const files = this.localRAG!.listDocuments(); return { content: [{ type: "text", text: JSON.stringify(files, null, 2) }] }; }
          case "local_rag_status": { const status = this.localRAG!.getStatus(); return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }] }; }
          case "read_large_file_chunk": { const parsed = ReadLargeFileChunkSchema.parse(args); const result = await this.largeFileHandler!.readChunk(parsed.filePath, parsed.chunkIndex, parsed.linesPerChunk, parsed.includeLineNumbers); return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }; }
          case "search_in_large_file": { const parsed = SearchInLargeFileSchema.parse(args); const results = await this.largeFileHandler!.searchInFile(parsed.filePath, parsed.pattern, parsed.caseSensitive, parsed.regex, parsed.maxResults, parsed.contextBefore, parsed.contextAfter, parsed.startLine, parsed.endLine); return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] }; }
          case "get_file_structure": { const parsed = GetFileStructureSchema.parse(args); const structure = await this.largeFileHandler!.getFileStructure(parsed.filePath); return { content: [{ type: "text", text: JSON.stringify(structure, null, 2) }] }; }
          case "navigate_to_line": { const parsed = NavigateToLineSchema.parse(args); const result = await this.largeFileHandler!.navigateToLine(parsed.filePath, parsed.lineNumber, parsed.contextLines); return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }; }
          case "get_file_summary": { const parsed = GetFileSummarySchema.parse(args); const summary = await this.largeFileHandler!.getFileSummary(parsed.filePath); return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] }; }
          case "stream_large_file": { const parsed = StreamLargeFileSchema.parse(args); const result = await this.largeFileHandler!.streamFile(parsed.filePath, parsed.chunkSize, parsed.startOffset, parsed.maxBytes, parsed.maxChunks); const chunks = result.chunks.map((c: Buffer) => c.toString('base64')); return { content: [{ type: "text", text: JSON.stringify({ ...result, chunks }, null, 2) }] }; }
          case "session_push": { const result = await this.sessionToolHandlers!.handlePush(args); return { content: [{ type: "text", text: JSON.stringify(result) }] }; }
          case "session_get": { const result = await this.sessionToolHandlers!.handleGet(args); return { content: [{ type: "text", text: JSON.stringify(result) }] }; }
          case "session_ack": { const result = await this.sessionToolHandlers!.handleAck(args); return { content: [{ type: "text", text: JSON.stringify(result) }] }; }
          case "session_clear": { const result = await this.sessionToolHandlers!.handleClear(args); return { content: [{ type: "text", text: JSON.stringify(result) }] }; }
          case "session_checkpoint": { const result = await this.sessionToolHandlers!.handleCheckpoint(args); return { content: [{ type: "text", text: JSON.stringify(result) }] }; }
          case "session_restore": { const result = await this.sessionToolHandlers!.handleRestore(args); return { content: [{ type: "text", text: JSON.stringify(result) }] }; }
          case "session_list_checkpoints": { const result = await this.sessionToolHandlers!.handleListCheckpoints(args); return { content: [{ type: "text", text: JSON.stringify(result) }] }; }
          case "session_info": { const result = await this.sessionToolHandlers!.handleInfo(args); return { content: [{ type: "text", text: JSON.stringify(result) }] }; }
          case "generate_api_key": { const result = await this.apiKeyToolHandlers!.handleGenerate(args); return { content: [{ type: "text", text: JSON.stringify(result) }] }; }
          case "validate_api_key": { const result = await this.apiKeyToolHandlers!.handleValidate(args); return { content: [{ type: "text", text: JSON.stringify(result) }] }; }
          case "revoke_api_key": { const result = await this.apiKeyToolHandlers!.handleRevoke(args); return { content: [{ type: "text", text: JSON.stringify(result) }] }; }
          case "list_api_keys": { const result = await this.apiKeyToolHandlers!.handleList(args); return { content: [{ type: "text", text: JSON.stringify(result) }] }; }
          case "get_api_key_usage": { const result = await this.apiKeyToolHandlers!.handleGetUsage(args); return { content: [{ type: "text", text: JSON.stringify(result) }] }; }
          case "get_tiers": { const result = await this.apiKeyToolHandlers!.handleGetTiers(args); return { content: [{ type: "text", text: JSON.stringify(result) }] }; }
          default: throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error: any) {
        return { content: [{ type: "text", text: JSON.stringify({ error: error.message, tool: name }) }], isError: true };
      }
    });
  }

  async initialize(): Promise<void> {
    this.memoryManager = await createMemoryManager(this.config);
    if (this.sessionToolHandlers) this.sessionToolHandlers.setMemoryManager(this.memoryManager);
    console.error("[EME-MCP] Memory manager initialized");
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("[EME-MCP] Server running on stdio");
  }

  async executeTool(name: string, args: any): Promise<any> {
    if (!this.memoryManager) throw new Error("Memory manager not initialized");
    if (!this.localRAG && this.memoryManager) {
      this.localRAG = new LocalRAG(this.memoryManager.getVectorStore(), (text: string) => this.memoryManager!.embed(text));
    }
    if (!this.largeFileHandler) this.largeFileHandler = new LargeFileHandler();

    const schemaOptions = { $refStrategy: "none" as const, target: "jsonSchema7" as const, definitions: {}, errorMessages: false };
    const { zodToJsonSchema } = await import("zod-to-json-schema");
    const { z } = await import("zod");

    // Define schemas inline for tool validation
    const schemas: Record<string, any> = {
      add_memory: z.object({ text: z.string().min(1), agentId: z.string().optional().default("unknown"), namespace: z.string().optional().default("default"), tags: z.array(z.string()).optional().default([]), visibility: z.enum(["private", "shared", "system"]).optional().default("private") }),
      search_memories: z.object({ query: z.string().min(1), limit: z.number().int().min(1).max(100).optional().default(5), namespace: z.string().optional(), includeGraph: z.boolean().optional().default(true) }),
      get_memory: z.object({ id: z.string().uuid() }),
      update_memory: z.object({ id: z.string().uuid(), text: z.string().optional(), tags: z.array(z.string()).optional() }),
      delete_memory: z.object({ id: z.string().uuid() }),
      get_graph: z.object({}),
      get_graph_stats: z.object({}),
      create_snapshot: z.object({ name: z.string().min(1), type: z.enum(["memory", "graph", "full"]).optional().default("full"), description: z.string().optional() }),
      list_snapshots: z.object({ type: z.enum(["memory", "graph", "full"]).optional() }),
      load_snapshot: z.object({ id: z.string().uuid() }),
      delete_snapshot: z.object({ id: z.string().uuid() }),
      get_config: z.object({}),
      update_config: z.object({ key: z.string(), value: z.any() }),
      create_entities: z.object({ entities: z.array(z.object({ name: z.string().min(1), entityType: z.string(), observations: z.array(z.string()).optional().default([]) })) }),
      create_relations: z.object({ relations: z.array(z.object({ from: z.string().min(1), to: z.string().min(1), relationType: z.string().min(1) })) }),
      add_observations: z.object({ observations: z.array(z.object({ entityName: z.string().min(1), contents: z.array(z.string()) })) }),
      delete_entities: z.object({ entityNames: z.array(z.string()) }),
      delete_observations: z.object({ deletions: z.array(z.object({ entityName: z.string().min(1), observations: z.array(z.string()) })) }),
      delete_relations: z.object({ relations: z.array(z.object({ from: z.string().min(1), to: z.string().min(1), relationType: z.string().min(1) })) }),
      search_nodes: z.object({ query: z.string() }),
      open_nodes: z.object({ names: z.array(z.string()) }),
      query_documents: z.object({ query: z.string().min(1), limit: z.number().int().min(1).max(50).optional().default(10) }),
      ingest_file: z.object({ filePath: z.string() }),
      ingest_data: z.object({ content: z.string(), metadata: z.object({ source: z.string(), format: z.enum(["text", "html", "markdown"]) }) }),
      delete_file: z.object({ filePath: z.string().optional(), source: z.string().optional() }),
      list_files: z.object({}),
      local_rag_status: z.object({}),
      read_large_file_chunk: z.object({ filePath: z.string(), chunkIndex: z.number().int().min(0).optional().default(0), linesPerChunk: z.number().int().min(1).optional(), includeLineNumbers: z.boolean().optional().default(false) }),
      search_in_large_file: z.object({ filePath: z.string(), pattern: z.string(), caseSensitive: z.boolean().optional().default(false), regex: z.boolean().optional().default(false), maxResults: z.number().int().min(1).max(1000).optional().default(100), contextBefore: z.number().int().min(0).optional().default(2), contextAfter: z.number().int().min(0).optional().default(2), startLine: z.number().int().min(1).optional(), endLine: z.number().int().min(1).optional() }),
      get_file_structure: z.object({ filePath: z.string() }),
      navigate_to_line: z.object({ filePath: z.string(), lineNumber: z.number().int().min(1), contextLines: z.number().int().min(0).optional().default(5) }),
      get_file_summary: z.object({ filePath: z.string() }),
      stream_large_file: z.object({ filePath: z.string(), chunkSize: z.number().int().min(1024).optional().default(65536), startOffset: z.number().int().min(0).optional().default(0), maxBytes: z.number().int().min(1).optional(), maxChunks: z.number().int().min(1).optional().default(10) }),
    };

    const schema = schemas[name];
    if (schema) {
      schema.parse(args);
    }

    switch (name) {
      case "add_memory": { const { text, agentId, namespace, tags, visibility } = args; const id = await this.memoryManager.addMemory(text, agentId, namespace, tags, visibility); return { id, success: true }; }
      case "search_memories": { const { query, limit, namespace, includeGraph } = args; const results = await this.memoryManager.searchMemories(query, limit, namespace); let graphData = null; if (includeGraph) graphData = await this.memoryManager.getGraph(); return { results, graph: graphData }; }
      case "get_memory": { const { id } = args; const memory = await this.memoryManager.getMemory(id); return memory; }
      case "update_memory": { const { id, text, tags } = args; const updates: any = {}; if (text) updates.text = text; if (tags) updates.metadata = { tags }; await this.memoryManager.updateMemory(id, updates); return { success: true }; }
      case "delete_memory": { const { id } = args; await this.memoryManager.deleteMemory(id); return { success: true }; }
      case "get_graph": { const graph = await this.memoryManager.getGraph(); return graph; }
      case "get_graph_stats": { const stats = await this.memoryManager.getGraphStats(); return stats; }
      case "create_snapshot": { const snapshot = await this.memoryManager.createSnapshot(args.name, args.type, args.description); return snapshot; }
      case "list_snapshots": { const snapshots = await this.memoryManager.listSnapshots(args.type); return snapshots; }
      case "load_snapshot": { const snapshot = await this.memoryManager.loadSnapshot(args.id); return snapshot; }
      case "delete_snapshot": { await this.memoryManager.deleteSnapshot(args.id); return { success: true }; }
      case "get_config": { const safeConfig = { ...this.config }; const secretKeys = ['encryptionKey', 'openRouterApiKey', 'postgresConnection']; for (const key of secretKeys) if (safeConfig[key as keyof Config]) (safeConfig as any)[key] = '***REDACTED***'; return safeConfig; }
      case "update_config": { const { key, value } = args; if (!(key in this.config)) throw new Error(`Unknown config key: ${key}`); const secretKeys = ['encryptionKey', 'openRouterApiKey', 'postgresConnection']; if (secretKeys.includes(key)) throw new Error(`Cannot modify ${key}`); (this.config as any)[key] = value; const reinitKeys = new Set(['embeddingModel', 'embeddingModelPath', 'embeddingDimension', 'vectorStore', 'vectorStorePath', 'qdrantUrl', 'qdrantCollection', 'qdrantVectorName', 'graphStore', 'graphStorePath', 'snapshotStore', 'snapshotPath']); if (reinitKeys.has(key) && this.memoryManager) { this.localRAG = null; this.largeFileHandler = null; await this.memoryManager.reinitialize(this.config); } return { success: true, key }; }
      case "create_entities": { const results = await this.memoryManager.createEntities(args.entities); return results; }
      case "create_relations": { const results = await this.memoryManager.createRelations(args.relations); return results; }
      case "add_observations": { const results = await this.memoryManager.addObservations(args.observations); return results; }
      case "delete_entities": { const results = await this.memoryManager.deleteEntities(args.entityNames); return results; }
      case "delete_observations": { const results = await this.memoryManager.deleteObservations(args.deletions); return results; }
      case "delete_relations": { const results = await this.memoryManager.deleteRelations(args.relations); return results; }
      case "search_nodes": { const results = await this.memoryManager.searchNodes(args.query); return results; }
      case "open_nodes": { const results = await this.memoryManager.openNodes(args.names); return results; }
      case "query_documents": { const results = await this.localRAG!.queryDocuments(args.query, args.limit); return results; }
      case "ingest_file": { const result = await this.localRAG!.ingestFile(args.filePath); return result; }
      case "ingest_data": { const result = await this.localRAG!.ingestData(args.content, { source: args.metadata.source, format: args.metadata.format }); return result; }
      case "delete_file": { const result = args.filePath ? await this.localRAG!.deleteDocument(args.filePath) : await this.localRAG!.deleteDocument(args.source); return result; }
      case "list_files": { const files = this.localRAG!.listDocuments(); return files; }
      case "local_rag_status": { const status = this.localRAG!.getStatus(); return status; }
      case "read_large_file_chunk": { const result = await this.largeFileHandler!.readChunk(args.filePath, args.chunkIndex, args.linesPerChunk, args.includeLineNumbers); return result; }
      case "search_in_large_file": { const results = await this.largeFileHandler!.searchInFile(args.filePath, args.pattern, args.caseSensitive, args.regex, args.maxResults, args.contextBefore, args.contextAfter, args.startLine, args.endLine); return results; }
      case "get_file_structure": { const structure = await this.largeFileHandler!.getFileStructure(args.filePath); return structure; }
      case "navigate_to_line": { const result = await this.largeFileHandler!.navigateToLine(args.filePath, args.lineNumber, args.contextLines); return result; }
      case "get_file_summary": { const summary = await this.largeFileHandler!.getFileSummary(args.filePath); return summary; }
      case "stream_large_file": { const result = await this.largeFileHandler!.streamFile(args.filePath, args.chunkSize, args.startOffset, args.maxBytes, args.maxChunks); const chunks = result.chunks.map((c: Buffer) => c.toString('base64')); return { ...result, chunks }; }
      default: throw new Error(`Unknown tool: ${name}`);
    }
  }

  async close(): Promise<void> {
    if (this.memoryManager) await this.memoryManager.close();
    await this.server.close();
  }
}
