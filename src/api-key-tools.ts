/**
 * API Key Management Tools for EME MCP Server
 * 
 * Provides monetization endpoints:
 * - generate_api_key: Create new API key
 * - validate_api_key: Check key validity
 * - revoke_api_key: Disable a key
 * - list_api_keys: List keys for owner
 * - api_key_usage: Get usage statistics
 * - api_key_stats: Get global stats
 */

import { z } from "zod";
import { apiKeyManager, TIER_CONFIGS } from "./api-keys.js";

// Schema definitions
export const GenerateApiKeySchema = z.object({
  name: z.string().min(1).describe("Human-readable name for this API key"),
  owner: z.string().min(1).describe("Owner identifier (email or user ID)"),
  tier: z
    .enum(["free", "basic", "pro", "enterprise"])
    .optional()
    .default("free")
    .describe("Access tier"),
  expires_in_days: z
    .number()
    .int()
    .min(1)
    .max(365)
    .optional()
    .describe("Expiration in days (null = never expires)"),
  metadata: z.record(z.any()).optional().describe("Additional metadata"),
});

export const ValidateApiKeySchema = z.object({
  api_key: z.string().min(1).describe("API key to validate"),
});

export const RevokeApiKeySchema = z.object({
  api_key_or_id: z.string().min(1).describe("API key or key ID to revoke"),
});

export const ListApiKeysSchema = z.object({
  owner: z.string().optional().describe("Filter by owner"),
});

export const GetApiKeyUsageSchema = z.object({
  key_id: z.string().min(1).describe("API key ID"),
  limit: z.number().int().min(1).max(500).optional().default(100),
});

export const GetTiersSchema = z.object({}).describe("Get available tier configurations");

// Admin-only tools (require master key)
export const GetGlobalStatsSchema = z.object({});

// Tool handlers
export class ApiKeyToolHandlers {
  private masterKey: string;

  constructor(masterKey?: string) {
    this.masterKey = masterKey || process.env.EME_MASTER_KEY || "";
  }

  async handleGenerate(args: unknown): Promise<any> {
    const parsed = GenerateApiKeySchema.parse(args);
    const expiresAt = parsed.expires_in_days
      ? Date.now() + (parsed.expires_in_days * 24 * 60 * 60 * 1000)
      : null;
    
    const { key, apiKey } = await apiKeyManager.createKey(
      parsed.name,
      parsed.owner,
      parsed.tier,
      expiresAt,
      parsed.metadata
    );
    
    return {
      api_key: key,
      id: apiKey.id,
      name: apiKey.name,
      tier: apiKey.tier,
      expires_at: apiKey.expiresAt,
      warning: "Store this key securely. It will not be shown again.",
    };
  }

  async handleValidate(args: unknown): Promise<any> {
    const parsed = ValidateApiKeySchema.parse(args);
    const result = await apiKeyManager.validateKey(parsed.api_key);
    
    if (!result.valid) {
      return { valid: false, error: result.error };
    }
    
    return {
      valid: true,
      tier: result.apiKey!.tier,
      name: result.apiKey!.name,
      rate_limit: result.apiKey!.rateLimit,
    };
  }

  async handleRevoke(args: unknown): Promise<any> {
    const parsed = RevokeApiKeySchema.parse(args);
    const success = await apiKeyManager.revokeKey(parsed.api_key_or_id);
    
    if (!success) {
      throw new Error(`Key not found: ${parsed.api_key_or_id}`);
    }
    
    return { success: true, message: "API key revoked" };
  }

  async handleList(args: unknown): Promise<any> {
    const parsed = ListApiKeysSchema.parse(args);
    const keys = await apiKeyManager.listKeys(parsed.owner);
    
    // Never return the actual keys, just metadata
    return {
      keys: keys.map(k => ({
        id: k.id,
        name: k.name,
        tier: k.tier,
        owner: k.owner,
        created_at: k.createdAt,
        expires_at: k.expiresAt,
        last_used_at: k.lastUsedAt,
        usage_count: k.usageCount,
        total_tokens: k.totalTokens,
        enabled: k.enabled,
      })),
      count: keys.length,
    };
  }

  async handleGetUsage(args: unknown): Promise<any> {
    const parsed = GetApiKeyUsageSchema.parse(args);
    const usage = await apiKeyManager.getUsage(parsed.key_id, parsed.limit);
    
    return {
      key_id: parsed.key_id,
      usage: usage.map(u => ({
        timestamp: u.timestamp,
        endpoint: u.endpoint,
        tokens_used: u.tokensUsed,
        duration_ms: u.durationMs,
        success: u.success,
        error: u.error,
      })),
      count: usage.length,
    };
  }

  async handleGetTiers(args: unknown): Promise<any> {
    return {
      tiers: Object.entries(TIER_CONFIGS).map(([id, config]) => ({
        id,
        ...config,
      })),
    };
  }

  async handleGetGlobalStats(args: unknown): Promise<any> {
    // Require master key for admin access
    // This would be checked by the caller
    const stats = await apiKeyManager.getStats();
    return stats;
  }
}

// Initialize on module load
apiKeyManager.load().catch(console.error);
