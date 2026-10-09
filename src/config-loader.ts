import type { Config } from "./types.js";
import * as fs from "fs";
import * as path from "path";

// Minimal defaults - NO circular dependency with index.ts
export const minimalDefaults: Config = {
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
  qdrantVectorName: undefined,

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

  // Enhanced Protocol — tier configuration
  tierHotLimit: 100,
  tierWarmLimit: 500,
  snapshotIntervalMs: 300000,
  sessionContinuityEnabled: true,
};

/**
 * Validates a Config object and returns an array of warning messages.
 */
export function validateConfig(config: Config): string[] {
  const warnings: string[] = [];

  if (config.embeddingDimension <= 0 || isNaN(config.embeddingDimension)) {
    warnings.push(`Invalid embeddingDimension: ${config.embeddingDimension}. Must be a positive integer.`);
  }

  const validModels = ["local", "openai", "cohere", "huggingface", "openrouter"];
  if (!validModels.includes(config.embeddingModel)) {
    warnings.push(`Unknown embeddingModel: "${config.embeddingModel}". Valid: ${validModels.join(", ")}`);
  }

  if (config.embeddingModel === "openrouter" && !config.openRouterApiKey) {
    warnings.push('embeddingModel is "openrouter" but no openRouterApiKey provided. Will fall back to local.');
  }

  if (config.similarityThreshold < 0 || config.similarityThreshold > 1) {
    warnings.push(`similarityThreshold ${config.similarityThreshold} is outside [0, 1] range.`);
  }

  if (config.memoryGateThreshold < 0 || config.memoryGateThreshold > 1) {
    warnings.push(`memoryGateThreshold ${config.memoryGateThreshold} is outside [0, 1] range.`);
  }

  // Enhanced Protocol — tier validation
  if (!Number.isInteger(config.tierHotLimit) || config.tierHotLimit < 1) {
    warnings.push(`Invalid tierHotLimit: ${config.tierHotLimit}. Must be a positive integer.`);
  }
  if (!Number.isInteger(config.tierWarmLimit) || config.tierWarmLimit < 1) {
    warnings.push(`Invalid tierWarmLimit: ${config.tierWarmLimit}. Must be a positive integer.`);
  }
  if (config.tierWarmLimit < config.tierHotLimit) {
    warnings.push(`tierWarmLimit (${config.tierWarmLimit}) is smaller than tierHotLimit (${config.tierHotLimit}). Warm should exceed hot.`);
  }
  if (!Number.isInteger(config.snapshotIntervalMs) || config.snapshotIntervalMs < 1000) {
    warnings.push(`Invalid snapshotIntervalMs: ${config.snapshotIntervalMs}. Must be an integer >= 1000.`);
  }

  return warnings;
}

export function loadConfig(configPath?: string): Config {
  // Priority: defaults < default file < explicit file < env vars
  // Env vars have HIGHEST priority (last spread wins)
  let config: Partial<Config> = { ...minimalDefaults };

  // 1. Load from default config file. Prefer project-root eme-config.json,
  //    fall back to storage/eme-config.json (where setup writes it).
  const candidatePaths = [
    path.join(process.cwd(), "eme-config.json"),
    path.join(process.cwd(), "storage", "eme-config.json"),
  ];
  const defaultConfigPath = candidatePaths.find((p) => fs.existsSync(p));
  if (defaultConfigPath) {
    const fileConfig = loadFromFile(defaultConfigPath);
    config = { ...config, ...fileConfig };
  }

  // 2. Load from specified config file if provided (overrides default file)
  if (configPath && fs.existsSync(configPath)) {
    const fileConfig = loadFromFile(configPath);
    config = { ...config, ...fileConfig };
  }

  // 3. Environment variables have HIGHEST priority
  config = { ...config, ...loadFromEnv() };

  // Validate and warn
  const warnings = validateConfig(config as Config);
  for (const w of warnings) {
    console.warn(`[Config] ${w}`);
  }

  return config as Config;
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
    const parsed = parseInt(process.env.EMBEDDING_DIMENSION, 10);
    if (!isNaN(parsed)) {
      config.embeddingDimension = parsed;
    } else {
      console.warn(`[Config] Invalid EMBEDDING_DIMENSION: "${process.env.EMBEDDING_DIMENSION}"`);
    }
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
    const parsed = parseInt(process.env.FALLBACK_EMBEDDING_DIMENSION, 10);
    if (!isNaN(parsed)) {
      config.fallbackEmbeddingDimension = parsed;
    }
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
  if (process.env.QDRANT_VECTOR_NAME) {
    config.qdrantVectorName = process.env.QDRANT_VECTOR_NAME;
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
    const parsed = parseFloat(process.env.MEMORY_GATE_THRESHOLD);
    if (!isNaN(parsed)) {
      config.memoryGateThreshold = parsed;
    }
  }

  // Security
  if (process.env.ENCRYPTION_KEY) {
    config.encryptionKey = process.env.ENCRYPTION_KEY;
  }

  // General configuration
  if (process.env.MAX_MEMORY_ENTRIES) {
    const parsed = parseInt(process.env.MAX_MEMORY_ENTRIES, 10);
    if (!isNaN(parsed)) {
      config.maxMemoryEntries = parsed;
    }
  }
  if (process.env.SIMILARITY_THRESHOLD) {
    const parsed = parseFloat(process.env.SIMILARITY_THRESHOLD);
    if (!isNaN(parsed)) {
      config.similarityThreshold = parsed;
    }
  }
  if (process.env.LOG_LEVEL) {
    config.logLevel = process.env.LOG_LEVEL as Config["logLevel"];
  }

  // Enhanced Protocol — tier configuration
  if (process.env.TIER_HOT_LIMIT) {
    const parsed = parseInt(process.env.TIER_HOT_LIMIT, 10);
    if (!isNaN(parsed)) {
      config.tierHotLimit = parsed;
    } else {
      console.warn(`[Config] Invalid TIER_HOT_LIMIT: "${process.env.TIER_HOT_LIMIT}"`);
    }
  }
  if (process.env.TIER_WARM_LIMIT) {
    const parsed = parseInt(process.env.TIER_WARM_LIMIT, 10);
    if (!isNaN(parsed)) {
      config.tierWarmLimit = parsed;
    } else {
      console.warn(`[Config] Invalid TIER_WARM_LIMIT: "${process.env.TIER_WARM_LIMIT}"`);
    }
  }
  if (process.env.SNAPSHOT_INTERVAL_MS) {
    const parsed = parseInt(process.env.SNAPSHOT_INTERVAL_MS, 10);
    if (!isNaN(parsed)) {
      config.snapshotIntervalMs = parsed;
    }
  }
  if (process.env.SESSION_CONTINUITY_ENABLED !== undefined) {
    config.sessionContinuityEnabled =
      process.env.SESSION_CONTINUITY_ENABLED.toLowerCase() === "true";
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
    path.join(__dirname, "mcp-server.js"),
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
        description: "Alsania's E.M.E. - Configurable memory system",
      },
    },
  };
}
