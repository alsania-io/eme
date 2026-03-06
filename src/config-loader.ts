import type { Config } from "./types.js";
import * as fs from "fs";
import * as path from "path";

// Minimal defaults - NO circular dependency with index.ts
const minimalDefaults: Config = {
  // Embedding configuration
  embeddingModel: "local",
  embeddingModelPath: undefined,
  embeddingDimension: 384,

  // OpenRouter specific
  openRouterApiKey: undefined,
  openRouterReferer: undefined,
  openRouterTitle: undefined,

  // Fallback embedding config
  fallbackEmbeddingModel: "local",
  fallbackEmbeddingDimension: 384,

  // Vector store configuration
  vectorStore: "memory",
  vectorStorePath: undefined,
  postgresConnection: undefined,
  qdrantUrl: "http://localhost:6333",
  qdrantCollection: "alsania-mem",

  // Graph store configuration
  graphStore: "memory",
  graphStorePath: undefined,

  // Snapshot configuration
  snapshotStore: "filesystem",
  snapshotPath: "./storage/snapshots",
  snapshotConfig: undefined,

  // Memory gate configuration
  memoryGateEnabled: true,
  memoryGateThreshold: 0.3,

  // Security
  encryptionKey: undefined,

  // General configuration
  maxMemoryEntries: 10000,
  similarityThreshold: 0.3,
  logLevel: "info",
};

export function loadConfig(configPath?: string): Config {
  let config: Partial<Config> = {};

  // 1. Load from environment variables first (highest priority)
  config = { ...config, ...loadFromEnv() };

  // 2. Load from specified config file if provided
  if (configPath && fs.existsSync(configPath)) {
    const fileConfig = loadFromFile(configPath);
    config = { ...config, ...fileConfig };
  }

  // 3. Load from default config file in project root
  const defaultConfigPath = path.join(process.cwd(), "eme-config.json");
  if (fs.existsSync(defaultConfigPath)) {
    const fileConfig = loadFromFile(defaultConfigPath);
    config = { ...config, ...fileConfig };
  }

  // 4. Merge with minimal defaults (lowest priority)
  return { ...minimalDefaults, ...config };
}

/**
 * Recursively resolve ${VAR} environment variable references in config objects
 */
function resolveEnvVars(obj: any): any {
  if (typeof obj === "string") {
    // Handle ${VAR} syntax for environment variable expansion
    if (obj.startsWith("${") && obj.endsWith("}")) {
      const key = obj.slice(2, -1);
      return process.env[key] || obj;
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(resolveEnvVars);
  }

  if (typeof obj === "object" && obj !== null) {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = resolveEnvVars(value);
    }
    return result;
  }

  return obj;
}

function loadFromEnv(): Partial<Config> {
  const config: Partial<Config> = {};

  // Embedding configuration
  if (process.env.EMBEDDING_MODEL) {
    config.embeddingModel = process.env
      .EMBEDDING_MODEL as Config["embeddingModel"];
  }
  if (process.env.EMBEDDING_MODEL_PATH) {
    config.embeddingModelPath = process.env.EMBEDDING_MODEL_PATH;
  }
  if (process.env.EMBEDDING_DIMENSION) {
    config.embeddingDimension = parseInt(process.env.EMBEDDING_DIMENSION, 10);
  }

  // OpenRouter specific
  if (process.env.OPENROUTER_API_KEY) {
    config.openRouterApiKey = process.env.OPENROUTER_API_KEY;
  }
  if (process.env.OPENROUTER_REFERER) {
    config.openRouterReferer = process.env.OPENROUTER_REFERER;
  }
  if (process.env.OPENROUTER_TITLE) {
    config.openRouterTitle = process.env.OPENROUTER_TITLE;
  }

  // Fallback embedding config
  if (process.env.FALLBACK_EMBEDDING_MODEL) {
    config.fallbackEmbeddingModel = process.env
      .FALLBACK_EMBEDDING_MODEL as Config["embeddingModel"];
  }
  if (process.env.FALLBACK_EMBEDDING_DIMENSION) {
    config.fallbackEmbeddingDimension = parseInt(
      process.env.FALLBACK_EMBEDDING_DIMENSION,
      10,
    );
  }

  // Vector store configuration
  if (process.env.VECTOR_STORE) {
    config.vectorStore = process.env.VECTOR_STORE as Config["vectorStore"];
  }
  if (process.env.VECTOR_STORE_PATH) {
    config.vectorStorePath = process.env.VECTOR_STORE_PATH;
  }
  if (process.env.POSTGRES_CONNECTION) {
    config.postgresConnection = process.env.POSTGRES_CONNECTION;
  }
  if (process.env.QDRANT_URL) {
    config.qdrantUrl = process.env.QDRANT_URL;
  }
  if (process.env.QDRANT_COLLECTION) {
    config.qdrantCollection = process.env.QDRANT_COLLECTION;
  }

  // Graph store configuration
  if (process.env.GRAPH_STORE) {
    config.graphStore = process.env.GRAPH_STORE as Config["graphStore"];
  }
  if (process.env.GRAPH_STORE_PATH) {
    config.graphStorePath = process.env.GRAPH_STORE_PATH;
  }

  // Snapshot configuration
  if (process.env.SNAPSHOT_STORE) {
    config.snapshotStore = process.env
      .SNAPSHOT_STORE as Config["snapshotStore"];
  }
  if (process.env.SNAPSHOT_PATH) {
    config.snapshotPath = process.env.SNAPSHOT_PATH;
  }

  // Memory gate configuration
  if (process.env.MEMORY_GATE_ENABLED !== undefined) {
    config.memoryGateEnabled =
      process.env.MEMORY_GATE_ENABLED.toLowerCase() === "true";
  }
  if (process.env.MEMORY_GATE_THRESHOLD) {
    config.memoryGateThreshold = parseFloat(process.env.MEMORY_GATE_THRESHOLD);
  }

  // Security
  if (process.env.ENCRYPTION_KEY) {
    config.encryptionKey = process.env.ENCRYPTION_KEY;
  }

  // General configuration
  if (process.env.MAX_MEMORY_ENTRIES) {
    config.maxMemoryEntries = parseInt(process.env.MAX_MEMORY_ENTRIES, 10);
  }
  if (process.env.SIMILARITY_THRESHOLD) {
    config.similarityThreshold = parseFloat(process.env.SIMILARITY_THRESHOLD);
  }
  if (process.env.LOG_LEVEL) {
    config.logLevel = process.env.LOG_LEVEL as Config["logLevel"];
  }

  return config;
}

function loadFromFile(filePath: string): Partial<Config> {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(content);
    // Resolve ${VAR} environment variable references
    return resolveEnvVars(parsed);
  } catch (error) {
    console.error(`Failed to load config from ${filePath}:`, error);
    return {};
  }
}

export function createNyxConfig(config: Config): any {
  const args: string[] = [
    "/home/sigma/Desktop/echo-lab/memory-engine/dist/mcp-server.js",
  ];

  // Add vector store args
  if (config.vectorStore) {
    args.push("--vectorStore", config.vectorStore);
  }
  if (config.vectorStorePath) {
    args.push("--vectorStorePath", config.vectorStorePath);
  }
  if (config.postgresConnection) {
    args.push("--postgresConnection", config.postgresConnection);
  }
  if (config.qdrantUrl) {
    args.push("--qdrantUrl", config.qdrantUrl);
  }
  if (config.qdrantCollection) {
    args.push("--qdrantCollection", config.qdrantCollection);
  }

  // Add graph store args
  if (config.graphStore) {
    args.push("--graphStore", config.graphStore);
  }
  if (config.graphStorePath) {
    args.push("--graphStorePath", config.graphStorePath);
  }

  // Add memory gate args
  args.push(
    "--memoryGateEnabled",
    config.memoryGateEnabled.toString(),
    "--memoryGateThreshold",
    config.memoryGateThreshold.toString(),
  );

  // Add embedding args
  if (config.embeddingModel) {
    args.push("--embeddingModel", config.embeddingModel);
  }
  if (config.embeddingDimension) {
    args.push("--embeddingDimension", config.embeddingDimension.toString());
  }
  if (config.embeddingModelPath) {
    args.push("--embeddingModelPath", config.embeddingModelPath);
  }

  // Filter out empty args
  const filteredArgs = args.filter((arg) => arg !== "");

  return {
    mcpServers: {
      eme: {
        command: "node",
        args: filteredArgs,
        env: {
          NODE_ENV: "production",
          EME_STORAGE_PATH: "./storage",
          EME_ENCRYPTION_KEY: config.encryptionKey || "",
          // Pass OpenRouter config via env if set
          ...(config.openRouterApiKey && {
            OPENROUTER_API_KEY: config.openRouterApiKey,
          }),
          ...(config.openRouterReferer && {
            OPENROUTER_REFERER: config.openRouterReferer,
          }),
          ...(config.openRouterTitle && {
            OPENROUTER_TITLE: config.openRouterTitle,
          }),
        },
        description: "Alsania Echo Memory Engine - Configurable memory system",
      },
    },
  };
}
