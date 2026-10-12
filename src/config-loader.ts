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

  // Storage Router (Phase 2b) — empty on fresh install (Amd 1 §2)
  destinations: [],
  routing: [],
  rcloneConfigPath: "./storage/rclone.conf",
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

  // Storage Router (Phase 2b)
  if (config.destinations !== undefined && !Array.isArray(config.destinations)) {
    warnings.push(`destinations must be an array (got ${typeof config.destinations}).`);
  }
  if (config.routing !== undefined && !Array.isArray(config.routing)) {
    warnings.push(`routing must be an array (got ${typeof config.routing}).`);
  }
  const destIds = new Set((config.destinations ?? []).map((d: any) => d?.id).filter(Boolean));
  for (const rule of config.routing ?? []) {
    if (rule?.primary && !destIds.has(rule.primary) && destIds.size > 0) {
      warnings.push(`routing rule '${rule.id}' references unknown destination '${rule.primary}'.`);
    }
    // No credential material may live inline on a rule/destination.
    if (rule && "password" in rule) {
      warnings.push(`routing rule '${rule.id}' contains a 'password' field — credentials are not allowed inline.`);
    }
  }
  for (const d of config.destinations ?? []) {
    if (d && ("password" in d || "token" in d || "apiKey" in d)) {
      warnings.push(`destination '${d.id}' contains inline credential material — not allowed. Use rclone.conf or \${VAR}.`);
    }
  }

  return warnings;
}

/**
 * Reconcile a file's namespaced `storageRouter` block into the flat router
 * fields. Applied PER FILE LOAD so config precedence is correct: a higher-
 * precedence file's flat `destinations` must beat a lower-precedence file's
 * `storageRouter` block (the earlier single-shot reconcile clobbered it).
 * Returns a shallow copy with the namespaced block removed.
 */
function reconcileStorageRouter(fileConfig: any): Partial<Config> {
  if (!fileConfig || typeof fileConfig !== "object") return fileConfig;
  const out: any = { ...fileConfig };
  const sr = out.storageRouter;
  delete out.storageRouter;
  if (sr && typeof sr === "object") {
    // A namespaced block only fills fields the SAME file didn't already set flat.
    if (out.destinations === undefined && Array.isArray(sr.destinations) && sr.destinations.length > 0) {
      out.destinations = sr.destinations;
    }
    if (out.routing === undefined && Array.isArray(sr.rules) && sr.rules.length > 0) {
      out.routing = sr.rules;
    }
    if (out.rcloneConfigPath === undefined && typeof sr.rcloneConfigPath === "string") {
      out.rcloneConfigPath = sr.rcloneConfigPath;
    }
  }
  return out;
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
    config = { ...config, ...reconcileStorageRouter(fileConfig) };
  }

  // 2. Load from specified config file if provided (overrides default file)
  if (configPath && fs.existsSync(configPath)) {
    const fileConfig = loadFromFile(configPath);
    config = { ...config, ...reconcileStorageRouter(fileConfig) };
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

/**
 * Persist a Config back to disk. Phase 2b addition: EME's config was read-only;
 * `destination_add` now needs durable persistence (design §2). Rules honored:
 * - Atomic: temp file + rename. Never a partial config.
 * - Never delete: backs up the prior file to `<path>.bak-<ts>` first.
 * - ONE config system: writes the same file loadConfig() prefers.
 *
 * The on-disk shape keeps the flat `destinations`/`routing`/`rcloneConfigPath`
 * fields (loadConfig reconciles BOTH spellings), so no migration is required.
 */
export function saveConfig(config: Config, configPath?: string): { ok: boolean; path?: string; backup?: string | null; error?: string } {
  try {
    // Resolve target: explicit path > first existing candidate > project root.
    // An explicit path wins outright (created if absent). Otherwise prefer an
    // existing candidate, then fall back to the standard storage location.
    let target: string;
    if (configPath) {
      target = configPath;
    } else {
      const candidates = [
        path.join(process.cwd(), "eme-config.json"),
        path.join(process.cwd(), "storage", "eme-config.json"),
      ];
      target = candidates.find((p) => fs.existsSync(p)) ?? path.join(process.cwd(), "storage", "eme-config.json");
    }

    const dir = path.dirname(target);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // Backup before overwrite (never delete).
    let backup: string | null = null;
    if (fs.existsSync(target)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      backup = `${target}.bak-${stamp}`;
      fs.copyFileSync(target, backup);
    }

    // SECRET SAFETY (critical): never serialize env-resolved values back to
    // disk. loadConfig() expands ${VAR} and merges env vars IN MEMORY; dumping
    // the in-memory config would write resolved secrets in plaintext. Instead,
    // start from the ON-DISK JSON (which keeps ${VAR} placeholders) and apply
    // ONLY the router-managed patch keys on top. All other keys are untouched.
    let onDisk: Record<string, any> = {};
    if (fs.existsSync(target)) {
      try { onDisk = JSON.parse(fs.readFileSync(target, "utf-8")); } catch { onDisk = {}; }
    }
    const PATCH_KEYS = ["destinations", "routing", "rcloneConfigPath"] as const;
    const merged: Record<string, any> = { ...onDisk };
    delete merged.storageRouter; // flat fields are authoritative on write
    for (const k of PATCH_KEYS) {
      if ((config as any)[k] !== undefined) merged[k] = (config as any)[k];
    }

    const tmp = path.join(dir, `.eme-config.tmp-${process.pid}-${Date.now()}`);
    fs.writeFileSync(tmp, JSON.stringify(merged, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, target);
    return { ok: true, path: target, backup };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}