#!/bin/bash
# Patch script to add session tools to mcp-server.ts

MCP_SERVER="/home/sigma/Desktop/echo-lab/eme/src/mcp-server.ts"

# Backup original
cp "$MCP_SERVER" "$MCP_SERVER.backup"

echo "Adding session tools imports..."
# Add imports after line 12 (after LargeFileHandler import)
sed -i '/import { LargeFileHandler } from "\.\/large-file\.js";/a\
import { SessionToolHandlers } from "./session-tools.js";\
import {\
  SessionPushSchema,\
  SessionGetSchema,\
  SessionAckSchema,\
  SessionClearSchema,\
  SessionCheckpointSchema,\
  SessionRestoreSchema,\
  SessionListCheckpointsSchema,\
  SessionInfoSchema,\
} from "./session-tools.js";' "$MCP_SERVER"

echo "Adding sessionToolHandlers property..."
# Add property after largeFileHandler
sed -i '/private largeFileHandler: LargeFileHandler | null = null;/a\  private sessionToolHandlers: SessionToolHandlers | null = null;' "$MCP_SERVER"

echo "Initializing sessionToolHandlers in constructor..."
# Add initialization after this.config = config;
sed -i '/this.config = config;/a\    this.sessionToolHandlers = new SessionToolHandlers();' "$MCP_SERVER"

echo "Setting memoryManager in initialize()..."
# Add setMemoryManager call after memoryManager creation
sed -i '/this.memoryManager = await createMemoryManager(this.config);/a\    if (this.sessionToolHandlers) {\
      this.sessionToolHandlers.setMemoryManager(this.memoryManager);\
    }' "$MCP_SERVER"

echo "Adding session tools to tools array..."
# Find the line with "stream_large_file" and add session tools after it
sed -i '/{ name: "stream_large_file"/a\          { name: "session_push", description: "Store an instruction for the current session", inputSchema: zodToJsonSchema(SessionPushSchema, schemaOptions) },\
          { name: "session_get", description: "Retrieve context for current turn", inputSchema: zodToJsonSchema(SessionGetSchema, schemaOptions) },\
          { name: "session_ack", description: "Mark instructions as acknowledged", inputSchema: zodToJsonSchema(SessionAckSchema, schemaOptions) },\
          { name: "session_clear", description: "Clear session cache", inputSchema: zodToJsonSchema(SessionClearSchema, schemaOptions) },\
          { name: "session_checkpoint", description: "Save session state snapshot", inputSchema: zodToJsonSchema(SessionCheckpointSchema, schemaOptions) },\
          { name: "session_restore", description: "Restore session from checkpoint", inputSchema: zodToJsonSchema(SessionRestoreSchema, schemaOptions) },\
          { name: "session_list_checkpoints", description: "List all checkpoints", inputSchema: zodToJsonSchema(SessionListCheckpointsSchema, schemaOptions) },\
          { name: "session_info", description: "Get session statistics", inputSchema: zodToJsonSchema(SessionInfoSchema, schemaOptions) },' "$MCP_SERVER"

echo "Adding session case handlers..."
# Add case handlers before the default case
sed -i '/default:/i\
        case "session_push": {\
          const result = await this.sessionToolHandlers!.handlePush(args);\
          return { content: [{ type: "text", text: JSON.stringify(result) }] };\
        }\
        case "session_get": {\
          const result = await this.sessionToolHandlers!.handleGet(args);\
          return { content: [{ type: "text", text: JSON.stringify(result) }] };\
        }\
        case "session_ack": {\
          const result = await this.sessionToolHandlers!.handleAck(args);\
          return { content: [{ type: "text", text: JSON.stringify(result) }] };\
        }\
        case "session_clear": {\
          const result = await this.sessionToolHandlers!.handleClear(args);\
          return { content: [{ type: "text", text: JSON.stringify(result) }] };\
        }\
        case "session_checkpoint": {\
          const result = await this.sessionToolHandlers!.handleCheckpoint(args);\
          return { content: [{ type: "text", text: JSON.stringify(result) }] };\
        }\
        case "session_restore": {\
          const result = await this.sessionToolHandlers!.handleRestore(args);\
          return { content: [{ type: "text", text: JSON.stringify(result) }] };\
        }\
        case "session_list_checkpoints": {\
          const result = await this.sessionToolHandlers!.handleListCheckpoints(args);\
          return { content: [{ type: "text", text: JSON.stringify(result) }] };\
        }\
        case "session_info": {\
          const result = await this.sessionToolHandlers!.handleInfo(args);\
          return { content: [{ type: "text", text: JSON.stringify(result) }] };\
        }\
' "$MCP_SERVER"

echo "Done! Run: cd /home/sigma/Desktop/echo-lab/eme && npm run build"
