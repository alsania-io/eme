/**
 * API Key Authentication Middleware for EME MCP Server
 * 
 * Validates API keys before processing tool calls.
 * Supports two key types:
 * - User keys: Rate-limited, monetized
 * - Admin keys: Unrestricted (for Alsania internal use)
 * 
 * Admin keys can be:
 *   - Set via EME_ADMIN_KEY environment variable
 *   - Or a specific prefix like "sk-admin-"
 */

import { apiKeyManager } from "./api-keys.js";

export interface AuthResult {
  authenticated: boolean;
  tier?: string;
  isAdmin?: boolean;
  error?: string;
  keyId?: string;
}

// Admin keys can be:
// 1. Environment variable EME_ADMIN_KEY
// 2. Hardcoded Alsania master key (for fallback)
// 3. Keys with prefix "sk-admin-"
const ADMIN_KEY = process.env.EME_ADMIN_KEY || "";
const ADMIN_KEY_PREFIX = "sk-admin-";

// Alsania internal service keys (for Nyx, Aegis, Echo)
// These are unrestricted and bypass rate limits
const INTERNAL_SERVICE_KEYS = new Set([
  // Add specific internal keys here, or use environment variable
]);

export function isAdminKey(apiKey: string): boolean {
  if (ADMIN_KEY && apiKey === ADMIN_KEY) return true;
  if (apiKey.startsWith(ADMIN_KEY_PREFIX)) return true;
  if (INTERNAL_SERVICE_KEYS.has(apiKey)) return true;
  return false;
}

export async function validateRequest(
  apiKey: string | undefined,
  toolName: string,
  tokensUsed: number = 0
): Promise<AuthResult> {
  // No key provided
  if (!apiKey) {
    return {
      authenticated: false,
      error: "Missing API key. Provide via 'x-api-key' header.",
    };
  }

  // Check for admin key first (unrestricted)
  if (isAdminKey(apiKey)) {
    return {
      authenticated: true,
      isAdmin: true,
      tier: "admin",
    };
  }

  // Validate user key
  const validation = await apiKeyManager.validateKey(apiKey);
  if (!validation.valid) {
    return {
      authenticated: false,
      error: validation.error || "Invalid API key",
    };
  }

  const apiKeyObj = validation.apiKey!;

  // Check if key is enabled
  if (!apiKeyObj.enabled) {
    return {
      authenticated: false,
      error: "API key has been revoked",
    };
  }

  // Check expiration
  if (apiKeyObj.expiresAt && apiKeyObj.expiresAt < Date.now()) {
    return {
      authenticated: false,
      error: "API key has expired",
    };
  }

  // Record usage (async, don't block)
  apiKeyManager.recordUsage(apiKey, toolName, tokensUsed, 0, true).catch(console.error);

  return {
    authenticated: true,
    isAdmin: false,
    tier: apiKeyObj.tier,
    keyId: apiKeyObj.id,
  };
}

// Helper to get API key from various sources
export function extractApiKey(
  headers: Record<string, string | undefined>,
  connectionInfo?: { params?: Record<string, string> }
): string | undefined {
  // Check Authorization header (Bearer token)
  const authHeader = headers["authorization"];
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.substring(7);
  }

  // Check x-api-key header
  if (headers["x-api-key"]) {
    return headers["x-api-key"];
  }

  // Check query parameter (for GET requests)
  if (connectionInfo?.params?.["api_key"]) {
    return connectionInfo.params["api_key"];
  }

  return undefined;
}
