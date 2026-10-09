import "dotenv/config";
import type { Config, MemoryGateFilter, SearchResult } from "./types.js";
import { createMemoryManager } from "./memory-manager.js";
import { EMEMCPServer } from "./mcp-server.js";
import { loadConfig, minimalDefaults } from "./config-loader.js";

export { MemoryManager, createMemoryManager } from "./memory-manager.js";
export { SQLiteVectorStore, createVectorStore } from "./vector-store.js";
export { SQLiteGraphStore, createGraphStore } from "./graph-store.js";
export type {
  MemoryEntry,
  GraphNode,
  GraphEdge,
  SearchResult,
  MemoryGateFilter,
  Config,
} from "./types.js";

export { EMEMCPServer } from "./mcp-server.js";
export { loadConfig } from "./config-loader.js";

// Default configuration.
// Derived from minimalDefaults so new Config keys never break this literal —
// only the Qdrant-specific overrides are spelled out here.
export const defaultConfig: Config = {
  ...minimalDefaults,
  // Vector store configuration - QDRANT
  vectorStore: "qdrant",
  qdrantUrl: "http://localhost:6333",
  qdrantCollection: "alsania-mem",
};

// Utility function to create and start MCP server
export async function startMCPServer(config?: Partial<Config>): Promise<void> {
  const fullConfig = { ...defaultConfig, ...config };
  console.error(
    `[EME] Initializing with vector store: ${fullConfig.vectorStore}`,
  );

  try {
    // Create and initialize the server
    const server = new EMEMCPServer(fullConfig);
    await server.initialize();
    await server.run();
  } catch (error) {
    console.error("[EME] Failed to start MCP server:", error);
    process.exit(1);
  }
}

// For backward compatibility with existing Python code
export class MemoryEngine {
  private manager: Awaited<ReturnType<typeof createMemoryManager>>;
  private initialized: boolean = false;
  private _config: Config;

  constructor(config?: Partial<Config>) {
    this._config = { ...defaultConfig, ...config };
    this.manager = null as any;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.manager = await createMemoryManager(this._config);
    this.initialized = true;
  }

  async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  async addMemory(
    text: string,
    agentId: string = "unknown",
    namespace: string = "default",
    tags: string[] = [],
    visibility: "private" | "shared" | "system" = "private",
  ): Promise<string> {
    await this.ensureInitialized();
    return await this.manager.addMemory(
      text,
      agentId,
      namespace,
      tags,
      visibility,
    );
  }

  async search(
    query: string,
    limit: number = 5,
    namespace?: string,
  ): Promise<SearchResult[]> {
    await this.ensureInitialized();
    return await this.manager.searchMemories(query, limit, namespace);
  }

  async close(): Promise<void> {
    if (this.initialized && this.manager) {
      // Add cleanup logic if needed
      this.initialized = false;
    }
  }
}

// CLI support - Single entry point for all operations
if (require.main === module) {
  const command = process.argv[2];
  const args = process.argv.slice(3);

  // Parse CLI arguments including --config flag
  const parseCliArgs = (
    args: string[],
  ): { configPath?: string; configOverrides: Partial<Config> } => {
    let configPath: string | undefined;
    const configOverrides: Partial<Config> = {};

    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--config" && i + 1 < args.length) {
        configPath = args[i + 1];
        i++;
      } else if (args[i].startsWith("--") && i + 1 < args.length) {
        const key = args[i].slice(2);
        const value = args[i + 1];
        i++;

        if (
          key === "embeddingDimension" ||
          key === "maxMemoryEntries"
        ) {
          (configOverrides as any)[key] = parseInt(value, 10);
        } else if (key === "similarityThreshold" || key === "memoryGateThreshold") {
          (configOverrides as any)[key] = parseFloat(value);
        } else if (
          key === "vectorStore" ||
          key === "graphStore" ||
          key === "snapshotStore"
        ) {
          (configOverrides as any)[key] = value;
        } else if (key === "embeddingModel") {
          (configOverrides as any)[key] = value as any;
        } else if (key === "logLevel") {
          (configOverrides as any)[key] = value as any;
        }
      }
    }

    return { configPath, configOverrides };
  };

  const { configPath, configOverrides } = parseCliArgs(args);
  // Load base config from file/env, then apply CLI overrides
  const baseConfig = loadConfig(configPath);
  const config = { ...baseConfig, ...configOverrides };

  // Support multiple command aliases
  const serverCommands = ["start-server", "server", "start", "run", "s"];

  if (!command) {
    console.log("EME - Echo Memory Engine");
    console.log("");
    console.log("Usage:");
    console.log("  node dist/index.js server     Start MCP server");
    console.log("  node dist/index.js help       Show this help");
    console.log("");
    console.log("Options:");
    console.log("  --vectorStore <type>    sqlite|memory|qdrant");
    console.log("  --graphStore <type>     memory|sqlite");
    console.log("  --logLevel <level>      debug|info|warn|error");
    console.log("  --config <path>         Load config from file");
    process.exit(0);
  }

  if (serverCommands.includes(command)) {
    startMCPServer(config).catch(console.error);
  } else if (command === "help" || command === "--help" || command === "-h") {
    console.log("EME - Echo Memory Engine");
    console.log("");
    console.log("Usage:");
    console.log("  node dist/index.js server     Start MCP server");
    console.log("  node dist/index.js help       Show this help");
    console.log("");
    console.log("Options:");
    console.log("  --vectorStore <type>    sqlite|memory|qdrant");
    console.log("  --graphStore <type>     memory|sqlite");
    console.log("  --logLevel <level>      debug|info|warn|error");
    console.log("  --config <path>         Load config from file");
  } else {
    console.error("Unknown command:", command);
    console.error("Run 'node dist/index.js help' for usage information");
    process.exit(1);
  }
}
