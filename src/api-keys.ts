/**
 * API Key Management for EME
 * 
 * Monetization layer for EME MCP server.
 * Provides:
 * - API key generation (OpenAI-compatible format: sk-xxx)
 * - Key validation and rate limiting
 * - Usage tracking per key
 * - Key revocation
 * - Tier-based access control
 */

import { randomUUID } from "crypto";
import * as fs from "fs/promises";
import * as path from "path";

// OpenAI-compatible key format: sk-[A-Za-z0-9_-]{48}
function generateKeySegment(length: number = 48): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function generateApiKey(): string {
  return `sk-${generateKeySegment(48)}`;
}

export interface ApiKey {
  id: string;
  key: string;           // Full key (sk-xxx)
  keyHash: string;       // SHA-256 hash for lookup (never store plaintext keys)
  name: string;          // Human-readable name
  tier: "free" | "basic" | "pro" | "enterprise";
  owner: string;         // Owner identifier (email or user ID)
  createdAt: number;
  expiresAt: number | null;  // null = never expires
  lastUsedAt: number | null;
  usageCount: number;
  totalTokens: number;
  rateLimit: {
    requestsPerMinute: number;
    tokensPerMinute: number;
  };
  enabled: boolean;
  metadata?: Record<string, any>;
}

export interface UsageRecord {
  id: string;
  keyId: string;
  timestamp: number;
  endpoint: string;
  tokensUsed: number;
  durationMs: number;
  success: boolean;
  error?: string;
}

export interface TierConfig {
  name: string;
  requestsPerMinute: number;
  tokensPerMinute: number;
  maxMemoryEntries: number;
  maxDocuments: number;
  pricePer1kTokens: number;  // in USD cents
  features: string[];
}

export const TIER_CONFIGS: Record<string, TierConfig> = {
  free: {
    name: "Free",
    requestsPerMinute: 10,
    tokensPerMinute: 10000,
    maxMemoryEntries: 100,
    maxDocuments: 5,
    pricePer1kTokens: 0,
    features: ["basic memory", "session cache", "graph search"],
  },
  basic: {
    name: "Basic",
    requestsPerMinute: 50,
    tokensPerMinute: 50000,
    maxMemoryEntries: 1000,
    maxDocuments: 50,
    pricePer1kTokens: 0.01,
    features: ["basic memory", "session cache", "graph search", "document ingestion", "snapshots"],
  },
  pro: {
    name: "Pro",
    requestsPerMinute: 200,
    tokensPerMinute: 250000,
    maxMemoryEntries: 10000,
    maxDocuments: 500,
    pricePer1kTokens: 0.005,
    features: ["all basic features", "advanced search", "vector embeddings", "batch operations", "priority support"],
  },
  enterprise: {
    name: "Enterprise",
    requestsPerMinute: 1000,
    tokensPerMinute: 1000000,
    maxMemoryEntries: 100000,
    maxDocuments: 5000,
    pricePer1kTokens: 0.002,
    features: ["all pro features", "custom rate limits", "dedicated support", "SLA", "on-premise deployment"],
  },
};

export class ApiKeyManager {
  private keys: Map<string, ApiKey> = new Map();  // keyHash -> ApiKey
  private usage: Map<string, UsageRecord[]> = new Map();  // keyId -> usage records
  private rateLimitCache: Map<string, { requests: number[]; tokens: number[] }> = new Map();
  private storagePath: string;

  constructor(storagePath: string = "./storage/api-keys.json") {
    this.storagePath = storagePath;
  }

  private async hashKey(key: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(key);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  }

  async createKey(
    name: string,
    owner: string,
    tier: ApiKey["tier"] = "free",
    expiresAt: number | null = null,
    metadata?: Record<string, any>
  ): Promise<{ key: string; apiKey: ApiKey }> {
    const rawKey = generateApiKey();
    const keyHash = await this.hashKey(rawKey);
    
    const apiKey: ApiKey = {
      id: randomUUID(),
      key: rawKey,  // Only returned once, not stored
      keyHash,
      name,
      tier,
      owner,
      createdAt: Date.now(),
      expiresAt,
      lastUsedAt: null,
      usageCount: 0,
      totalTokens: 0,
      rateLimit: {
        requestsPerMinute: TIER_CONFIGS[tier].requestsPerMinute,
        tokensPerMinute: TIER_CONFIGS[tier].tokensPerMinute,
      },
      enabled: true,
      metadata,
    };
    
    // Store only the hash, not the raw key
    const { key, ...storageKey } = apiKey;
    this.keys.set(keyHash, storageKey as ApiKey);
    await this.persist();
    
    return { key: rawKey, apiKey };
  }

  async validateKey(rawKey: string): Promise<{ valid: boolean; apiKey?: ApiKey; error?: string }> {
    const keyHash = await this.hashKey(rawKey);
    const apiKey = this.keys.get(keyHash);
    
    if (!apiKey) {
      return { valid: false, error: "Invalid API key" };
    }
    
    if (!apiKey.enabled) {
      return { valid: false, error: "API key has been revoked" };
    }
    
    if (apiKey.expiresAt && apiKey.expiresAt < Date.now()) {
      return { valid: false, error: "API key has expired" };
    }
    
    // Rate limiting check
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    const cacheKey = keyHash;
    let records = this.rateLimitCache.get(cacheKey);
    
    if (!records) {
      records = { requests: [], tokens: [] };
      this.rateLimitCache.set(cacheKey, records);
    }
    
    // Clean old records
    records.requests = records.requests.filter(t => t > oneMinuteAgo);
    records.tokens = records.tokens.filter(t => t > oneMinuteAgo);
    
    if (records.requests.length >= apiKey.rateLimit.requestsPerMinute) {
      return { valid: false, error: "Rate limit exceeded: too many requests" };
    }
    
    return { valid: true, apiKey };
  }

  async recordUsage(
    rawKey: string,
    endpoint: string,
    tokensUsed: number,
    durationMs: number,
    success: boolean,
    error?: string
  ): Promise<void> {
    const keyHash = await this.hashKey(rawKey);
    const apiKey = this.keys.get(keyHash);
    
    if (!apiKey) return;
    
    // Update rate limit cache
    const now = Date.now();
    let records = this.rateLimitCache.get(keyHash);
    if (!records) {
      records = { requests: [], tokens: [] };
      this.rateLimitCache.set(keyHash, records);
    }
    records.requests.push(now);
    records.tokens.push(now);
    
    // Update key stats
    apiKey.lastUsedAt = now;
    apiKey.usageCount++;
    apiKey.totalTokens += tokensUsed;
    
    // Store usage record
    const usageRecord: UsageRecord = {
      id: randomUUID(),
      keyId: apiKey.id,
      timestamp: now,
      endpoint,
      tokensUsed,
      durationMs,
      success,
      error,
    };
    
    if (!this.usage.has(apiKey.id)) {
      this.usage.set(apiKey.id, []);
    }
    this.usage.get(apiKey.id)!.push(usageRecord);
    
    // Trim old usage records (keep last 1000)
    const usageRecords = this.usage.get(apiKey.id)!;
    if (usageRecords.length > 1000) {
      this.usage.set(apiKey.id, usageRecords.slice(-1000));
    }
    
    await this.persist();
  }

  async revokeKey(rawKeyOrId: string): Promise<boolean> {
    // Try by hash first
    let keyHash = await this.hashKey(rawKeyOrId);
    let apiKey = this.keys.get(keyHash);
    
    // If not found, try by ID
    if (!apiKey) {
      for (const [hash, key] of this.keys.entries()) {
        if (key.id === rawKeyOrId) {
          apiKey = key;
          keyHash = hash;
          break;
        }
      }
    }
    
    if (!apiKey) return false;
    
    apiKey.enabled = false;
    await this.persist();
    return true;
  }

  async listKeys(owner?: string): Promise<ApiKey[]> {
    let keys = Array.from(this.keys.values());
    if (owner) {
      keys = keys.filter(k => k.owner === owner);
    }
    return keys;
  }

  async getUsage(keyId: string, limit: number = 100): Promise<UsageRecord[]> {
    const records = this.usage.get(keyId) || [];
    return records.slice(-limit);
  }

  async getStats(): Promise<{
    totalKeys: number;
    totalRequests: number;
    totalTokens: number;
    activeKeys: number;
  }> {
    const keys = Array.from(this.keys.values());
    const totalTokens = keys.reduce((sum, k) => sum + k.totalTokens, 0);
    const totalRequests = keys.reduce((sum, k) => sum + k.usageCount, 0);
    
    return {
      totalKeys: keys.length,
      totalRequests,
      totalTokens,
      activeKeys: keys.filter(k => k.enabled).length,
    };
  }

  async persist(): Promise<void> {
    const dir = path.dirname(this.storagePath);
    await fs.mkdir(dir, { recursive: true });
    
    const data = {
      keys: Array.from(this.keys.entries()),
      usage: Array.from(this.usage.entries()),
      version: 1,
    };
    await fs.writeFile(this.storagePath, JSON.stringify(data, null, 2));
  }

  async load(): Promise<void> {
    try {
      const data = JSON.parse(await fs.readFile(this.storagePath, "utf-8"));
      this.keys = new Map(data.keys);
      this.usage = new Map(data.usage);
    } catch (error) {
      // File doesn't exist yet - starting fresh
      console.error("[ApiKeyManager] No existing data found, starting fresh");
    }
  }
}

// Singleton instance
export const apiKeyManager = new ApiKeyManager();
