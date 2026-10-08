/**
 * Authentication Middleware for EME
 * 
 * Design:
 * - Admin key (EME_ADMIN_KEY env var) for key management operations
 * - User API keys for regular operations
 * - Admin keys can be used for everything
 * 
 * Tool classification:
 * - ADMIN_TOOLS: require admin key (generate, revoke, list keys)
 * - PUBLIC_TOOLS: no key required (validate, tiers, health)
 * - PROTECTED_TOOLS: require valid user API key or admin key
 */

import { apiKeyManager } from "./api-keys.js";

// Admin key from environment
const ADMIN_KEY = process.env.EME_ADMIN_KEY || "";
// Trusted callers (Aegis, Echo, Sigma local) - bypass auth
const TRUSTED_CALLERS = new Set([
  "aegis",
  "echo",
  "sigma",
]);

function isTrustedCaller(): boolean {
  return TRUSTED_CALLERS.has(process.env.EME_TRUSTED_CALLER || "");
}

// Tools that require admin key
const ADMIN_TOOLS = new Set([
  "generate_api_key",
  "revoke_api_key",
  "list_api_keys",
  "get_api_key_usage",
]);

// Tools that are public (no key required)
const PUBLIC_TOOLS = new Set([
  "validate_api_key",
  "get_tiers",
]);

// All other tools are protected (require valid user key)

export interface AuthResult {
  authorized: boolean;
  isAdmin?: boolean;
  tier?: string;
  keyId?: string;
  error?: string;
}

/**
 * Check if a key is the admin key
 */
function isAdminKey(apiKey: string): boolean {
  if (!ADMIN_KEY) return false;
  return apiKey === ADMIN_KEY;
}

/**
 * Authorize a tool call
 */
export async function authorize(
  toolName: string,
  apiKey: string | undefined
): Promise<AuthResult> {
  // Admin tools require admin key
  if (ADMIN_TOOLS.has(toolName)) {
    if (!apiKey) {
    // Allow local development without key
    if (process.env.NODE_ENV === "development") {
      return { authorized: true, isAdmin: true };
    }
      return {
        authorized: false,
        error: "Admin API key required. Set EME_ADMIN_KEY environment variable.",
      };
    }
    if (!isAdminKey(apiKey)) {
      return {
        authorized: false,
        error: "Admin access required. Invalid admin key.",
      };
    }
    return {
      authorized: true,
      isAdmin: true,
    };
  }

  // Public tools - no key needed
  if (PUBLIC_TOOLS.has(toolName)) {
    return {
      authorized: true,
      isAdmin: false,
    };
  }

  // Protected tools - require valid user API key
  if (!apiKey) {
    // Allow local development without key
    if (process.env.NODE_ENV === "development") {
      return { authorized: true, isAdmin: true };
    }
    return {
      authorized: false,
      error: "API key required. Provide via 'x-api-key' header.",
    };
  }

  // Check if it's an admin key (admins can use protected tools too)
  if (isAdminKey(apiKey)) {
    return {
      authorized: true,
      isAdmin: true,
    };
  }

  // Validate user key
  const validation = await apiKeyManager.validateKey(apiKey);
  if (!validation.valid) {
    return {
      authorized: false,
      error: validation.error || "Invalid API key",
    };
  }

  const key = validation.apiKey!;

  // Check if key is enabled
  if (!key.enabled) {
    return {
      authorized: false,
      error: "API key has been revoked",
    };
  }

  // Check expiration
  if (key.expiresAt && key.expiresAt < Date.now()) {
    return {
      authorized: false,
      error: "API key has expired",
    };
  }

  return {
    authorized: true,
    isAdmin: false,
    tier: key.tier,
    keyId: key.id,
  };
}

/**
 * Record usage for a successful call
 */
export async function recordUsage(
  apiKey: string | undefined,
  toolName: string,
  tokensUsed: number = 0
): Promise<void> {
  if (!apiKey) return;
  if (isAdminKey(apiKey)) return; // Don't track admin usage
  
  await apiKeyManager.recordUsage(apiKey, toolName, tokensUsed, 0, true);
}

/**
 * Extract API key from various sources
 * For stdio MCP, we need to get it from environment or config
 * For HTTP, from headers
 */
export function extractApiKey(
  headers?: Record<string, string | undefined>,
  env?: Record<string, string | undefined>
): string | undefined {
  // Check headers first (for HTTP mode)
  if (headers) {
    const authHeader = headers["authorization"];
    if (authHeader && authHeader.startsWith("Bearer ")) {
      return authHeader.substring(7);
    }
    if (headers["x-api-key"]) {
      return headers["x-api-key"];
    }
  }

  // Check environment (for stdio mode)
  if (env) {
    if (env["EME_API_KEY"]) return env["EME_API_KEY"];
    if (env["API_KEY"]) return env["API_KEY"];
  }

  // Check process.env as fallback
  if (process.env.EME_API_KEY) return process.env.EME_API_KEY;
  if (process.env.API_KEY) return process.env.API_KEY;

  return undefined;
}

// Warn if no admin key is set
if (!ADMIN_KEY) {
  console.warn("[EME-AUTH] ⚠️  EME_ADMIN_KEY not set. Key management tools will be disabled.");
  console.warn("[EME-AUTH]    Set EME_ADMIN_KEY=sk-admin-your-secret-key to enable admin features.");
}

// Debug: Log key validation (remove in production)
console.error("[AUTH] EME_API_KEY present:", !!process.env.EME_API_KEY);
console.error("[AUTH] EME_ADMIN_KEY present:", !!process.env.EME_ADMIN_KEY);
