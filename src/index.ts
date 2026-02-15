import type { Config, MemoryGateFilter, SearchResult } from "./types.js";
import { createMemoryManager } from "./memory-manager.js";
import { EMEMCPServer } from "./mcp-server.js";
import { loadConfig } from "./config-loader.js";

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

// Default configuration
export const defaultConfig: Config = {
  // Embedding configuration
  embeddingModel: "local",
  embeddingDimension: 384, // BGE-small dimension

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
};

// Utility function to create and start MCP server
export async function startMCPServer(config?: Partial<Config>): Promise<void> {
  const server = new EMEMCPServer(config);
  await server.start();
}

// For backward compatibility with existing Python code
export class MemoryEngine {
  private manager: ReturnType<typeof createMemoryManager>;

  constructor(config?: Partial<Config>) {
    const fullConfig = { ...defaultConfig, ...config };
    this.manager = createMemoryManager(fullConfig);
  }

  async initialize(): Promise<void> {
    await this.manager.initialize();
  }

  async addMemory(
    text: string,
    agentId: string = "unknown",
    namespace: string = "default",
    tags: string[] = [],
    visibility: "private" | "shared" | "system" = "private",
    forceSave: boolean = false,
  ): Promise<{ id: string | null; filter: MemoryGateFilter }> {
    return await this.manager.addMemory(
      text,
      agentId,
      namespace,
      tags,
      visibility,
      forceSave,
    );
  }

  async search(
    query: string,
    limit: number = 5,
    namespace?: string,
    includeGraph: boolean = true,
  ): Promise<SearchResult[]> {
    return await this.manager.search(query, limit, namespace, includeGraph);
  }

  async close(): Promise<void> {
    await this.manager.close();
  }
}

// CLI support - Single entry point for all operations
if (require.main === module) {
  const command = process.argv[2];
  const args = process.argv.slice(3);

  // Parse CLI arguments including --config flag
  const parseCliArgs = (args: string[]): { configPath?: string; configOverrides: Partial<Config> } => {
    let configPath: string | undefined;
    const configOverrides: Partial<Config> = {};
    
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--config" && i + 1 < args.length) {
        configPath = args[i + 1];
        i++; // Skip the next argument (config path value)
      } else if (args[i].startsWith("--") && i + 1 < args.length) {
        const key = args[i].slice(2);
        const value = args[i + 1];
        i++; // Skip the next argument

        if (key === "embeddingDimension" || key === "maxMemoryEntries") {
          (configOverrides as any)[key] = parseInt(value, 10);
        } else if (
          key === "similarityThreshold" ||
          key === "memoryGateThreshold"
        ) {
          (configOverrides as any)[key] = parseFloat(value);
        } else if (key === "memoryGateEnabled") {
          (configOverrides as any)[key] = value.toLowerCase() === "true";
        } else {
          (configOverrides as any)[key] = value;
        }
      }
    }
    return { configPath, configOverrides };
  };

  switch (command) {
    case "start":
    case "server":
      (async () => {
        const { configPath, configOverrides } = parseCliArgs(args);
        // Load config from file if specified, then apply CLI overrides
        const loadedConfig = configPath ? loadConfig(configPath) : defaultConfig;
        const finalConfig = { ...loadedConfig, ...configOverrides };
        console.error(`[EME] Using vector store: ${finalConfig.vectorStore}`);
        await startMCPServer(finalConfig);
      })().catch(console.error);
      break;

    case "test":
      // Run basic tests
      (async () => {
        const engine = new MemoryEngine();
        await engine.initialize();

        console.log("🧪 Running EME basic tests...");

        const result = await engine.addMemory(
          "Test memory from CLI",
          "cli-test",
        );
        console.log("✅ Added memory:", result);

        const searchResults = await engine.search("test memory");
        console.log("✅ Search results:", searchResults.length, "matches");

        await engine.close();
        console.log("🎯 Test completed successfully");
      })().catch(console.error);
      break;

    case "config":
      console.log("📋 Current default configuration:");
      console.log(JSON.stringify(defaultConfig, null, 2));
      break;

    case "version":
      console.log("Alsania Echo Memory Engine (EME) - v1.0.0");
      console.log("Professional memory system for MCP ecosystem");
      break;

    case "help":
    default:
      console.log(`
╔══════════════════════════════════════════════════════════╗
║   Alsania Echo Memory Engine (EME) - Professional CLI    ║
╚══════════════════════════════════════════════════════════╝

📦 Commands:
  server    - Start MCP server (alias: start)
    Usage: node dist/index.js server [--key value]
    Example: node dist/index.js server --maxMemoryEntries 5000

  test      - Run basic functionality tests
    Usage: node dist/index.js test

  config    - Show default configuration
    Usage: node dist/index.js config

  version   - Show version information
    Usage: node dist/index.js version

  help      - Show this help message
    Usage: node dist/index.js help

🔧 Configuration options (for server command):
  --embeddingDimension    Vector dimension (default: 384)
  --maxMemoryEntries      Max entries per namespace (default: 10000)
  --similarityThreshold   Search threshold (default: 0.3)
  --memoryGateThreshold   Filter threshold (default: 0.7)
  --memoryGateEnabled     Enable memory filtering (default: true)
  --logLevel              Log level (default: "info")

🎯 Examples:
  node dist/index.js server
  node dist/index.js server --maxMemoryEntries 5000 --logLevel debug
  node dist/index.js test
  node dist/index.js config
      `);
      break;
  }
}
