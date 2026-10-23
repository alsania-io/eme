#!/bin/bash
# Clean patch to add API key tools to mcp-server.ts

MCP_SERVER="/home/sigma/Desktop/echo-lab/eme/src/mcp-server.ts"
BACKUP="$MCP_SERVER.api-backup"

cp "$MCP_SERVER" "$BACKUP"

echo "Adding API key imports..."
# Add after session tools imports
awk '
/import { SessionToolHandlers } from \".\/session-tools.js\";/ {
    print
    print "import { ApiKeyToolHandlers } from \"./api-key-tools.js\";"
    print "import {"
    print "  GenerateApiKeySchema,"
    print "  ValidateApiKeySchema,"
    print "  RevokeApiKeySchema,"
    print "  ListApiKeysSchema,"
    print "  GetApiKeyUsageSchema,"
    print "  GetTiersSchema,"
    print "  GetGlobalStatsSchema,"
    print "} from \"./api-key-tools.js\";"
    next
}
1' "$MCP_SERVER" > "$MCP_SERVER.tmp" && mv "$MCP_SERVER.tmp" "$MCP_SERVER"

echo "Adding apiKeyToolHandlers property..."
awk '/private sessionToolHandlers: SessionToolHandlers | null = null;/ {
    print
    print "  private apiKeyToolHandlers: ApiKeyToolHandlers | null = null;"
    next
}
1' "$MCP_SERVER" > "$MCP_SERVER.tmp" && mv "$MCP_SERVER.tmp" "$MCP_SERVER"

echo "Initializing apiKeyToolHandlers in constructor..."
awk '/this.sessionToolHandlers = new SessionToolHandlers();/ {
    print
    print "    this.apiKeyToolHandlers = new ApiKeyToolHandlers();"
    next
}
1' "$MCP_SERVER" > "$MCP_SERVER.tmp" && mv "$MCP_SERVER.tmp" "$MCP_SERVER"

echo "Adding API key tools to tools array..."
# Find line with session_info and add after it
sed -i '/{ name: "session_info"/a\          { name: "generate_api_key", description: "Generate a new API key", inputSchema: zodToJsonSchema(GenerateApiKeySchema, schemaOptions) },\
          { name: "validate_api_key", description: "Validate an API key", inputSchema: zodToJsonSchema(ValidateApiKeySchema, schemaOptions) },\
          { name: "revoke_api_key", description: "Revoke an API key", inputSchema: zodToJsonSchema(RevokeApiKeySchema, schemaOptions) },\
          { name: "list_api_keys", description: "List API keys for owner", inputSchema: zodToJsonSchema(ListApiKeysSchema, schemaOptions) },\
          { name: "get_api_key_usage", description: "Get API key usage stats", inputSchema: zodToJsonSchema(GetApiKeyUsageSchema, schemaOptions) },\
          { name: "get_tiers", description: "Get available tiers", inputSchema: zodToJsonSchema(GetTiersSchema, schemaOptions) },' "$MCP_SERVER"

echo "Adding case handlers..."
# Find the session_info case and add API cases after it
sed -i '/case "session_info": {/a\
        case "generate_api_key": {\
          const result = await this.apiKeyToolHandlers!.handleGenerate(args);\
          return { content: [{ type: "text", text: JSON.stringify(result) }] };\
        }\
        case "validate_api_key": {\
          const result = await this.apiKeyToolHandlers!.handleValidate(args);\
          return { content: [{ type: "text", text: JSON.stringify(result) }] };\
        }\
        case "revoke_api_key": {\
          const result = await this.apiKeyToolHandlers!.handleRevoke(args);\
          return { content: [{ type: "text", text: JSON.stringify(result) }] };\
        }\
        case "list_api_keys": {\
          const result = await this.apiKeyToolHandlers!.handleList(args);\
          return { content: [{ type: "text", text: JSON.stringify(result) }] };\
        }\
        case "get_api_key_usage": {\
          const result = await this.apiKeyToolHandlers!.handleGetUsage(args);\
          return { content: [{ type: "text", text: JSON.stringify(result) }] };\
        }\
        case "get_tiers": {\
          const result = await this.apiKeyToolHandlers!.handleGetTiers(args);\
          return { content: [{ type: "text", text: JSON.stringify(result) }] };\
        }' "$MCP_SERVER"

echo "Done! Run: cd /home/sigma/Desktop/echo-lab/eme && npm run build"
