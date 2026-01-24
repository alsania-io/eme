import { Config } from "./types.js";
import { defaultConfig } from "./index.js";
import * as fs from "fs";
import * as path from "path";

export function loadConfig(configPath?: string): Config {
  let config: Partial<Config> = {};

  // 1. Load from environment variables first
  config = loadFromEnv();

  // 2. Load from config file if specified
  if (configPath && fs.existsSync(configPath)) {
    const fileConfig = loadFromFile(configPath);
    config = { ...config, ...fileConfig };
  }

  // 3. Load from default config file
  const defaultConfigPath = path.join(process.cwd(), "eme-config.json");
  if (fs.existsSync(defaultConfigPath)) {
    const fileConfig = loadFromFile(defaultConfigPath);
    config = { ...config, ...fileConfig };
  }

  // 4. Merge with defaults
  return { ...defaultConfig, ...config };
}

function loadFromEnv(): Partial<Config> {
  const config: Partial<Config> = {};

  // Embedding configuration
  if (process.env.EMBEDDING_MODEL) {
    config.embeddingModel = process.env
      .EMBEDDING_MODEL as Config["embeddingModel"];
  }
  if (process.env.EMBEDDING_DIMENSION) {
    config.embeddingDimension = parseInt(process.env.EMBEDDING_DIMENSION, 10);
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
  if (process.env.MEMORY_GATE_ENABLED) {
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
    return JSON.parse(content);
  } catch (error) {
    console.error(`Failed to load config from ${filePath}:`, error);
    return {};
  }
}

export function createNyxConfig(config: Config): any {
  return {
    mcpServers: {
      "memory-engine": {
        command: "node",
        args: [
          "/home/sigma/Desktop/echo-lab/memory-engine/dist/mcp-server.js",
          "--vectorStore",
          config.vectorStore,
          "--vectorStorePath",
          config.vectorStorePath || "",
          "--postgresConnection",
          config.postgresConnection || "",
          "--graphStore",
          config.graphStore,
          "--memoryGateEnabled",
          config.memoryGateEnabled.toString(),
          "--memoryGateThreshold",
          config.memoryGateThreshold.toString(),
        ].filter((arg) => arg !== ""),
        env: {
          NODE_ENV: "production",
          EME_STORAGE_PATH: "./storage",
          EME_ENCRYPTION_KEY: config.encryptionKey || "",
        },
        description: "Alsania Echo Memory Engine - Configurable memory system",
      },
    },
  };
}
