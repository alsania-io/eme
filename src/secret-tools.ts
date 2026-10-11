// EME Storage Router — Phase 3: secret tool-registrar seam.
// Contributes the `read_secret` MCP verb via the same Amendment-2 seam as
// router-tools.ts. ACL is Phase 4: the canAccess hook defaults to DENY.
//
// Redaction rules: on DENY, return a generic error with NO metadata leak. On
// ALLOW, return the value to the calling agent ONLY.

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { SecretStore } from "./secret-store.js";

const schemaOptions = { target: "jsonSchema7" as const } as any;

export const ReadSecretSchema = z.object({
  name: z.string().min(1).describe("Secret name, e.g. MY_API_KEY"),
  namespace: z.string().optional().default("default"),
  agentId: z.string().optional().describe("Calling agent id, checked against the ACL hook"),
});

export function secretToolDefinitions() {
  return [
    {
      name: "read_secret",
      description:
        "Read a secret by name. Deny-by-default (ACL hook). On allow returns the decrypted value to the calling agent only; never logged or indexed.",
      inputSchema: zodToJsonSchema(ReadSecretSchema, schemaOptions),
    },
  ];
}

export const SECRET_TOOL_NAMES = ["read_secret"] as const;

/**
 * Async post-step: walk a config object and resolve any UNRESOLVED `${NAME}`
 * tokens from the SecretStore. Env expansion is expected to have already run,
 * so any token still shaped like `${...}` here is a candidate secret reference.
 * Env values (already substituted) win because they are no longer `${...}`.
 *
 * Kept out of loadConfig() to preserve its sync contract. Returns a deep copy.
 */
export async function resolveConfigSecrets<T>(
  config: T,
  store: SecretStore,
): Promise<T> {
  const walk = async (v: any): Promise<any> => {
    if (typeof v === "string") return store.resolve(v);
    if (Array.isArray(v)) {
      const out: any[] = [];
      for (const item of v) out.push(await walk(item));
      return out;
    }
    if (v && typeof v === "object") {
      const out: Record<string, any> = {};
      for (const [k, val] of Object.entries(v)) out[k] = await walk(val);
      return out;
    }
    return v;
  };
  return (await walk(config)) as T;
}

/**
 * Dispatch the read_secret verb. Returns MCP-shaped content, or null if the
 * verb isn't owned here (core falls through).
 *
 * ACL: we consult the store's canAccess hook BEFORE fetching. Default deny.
 * On deny we return a generic error — no name echo, no existence disclosure.
 */
export async function dispatchSecretTool(
  name: string,
  args: any,
  store: SecretStore,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean } | null> {
  if (name !== "read_secret") return null;
  const { name: secretName, namespace, agentId } = ReadSecretSchema.parse(args ?? {});

  // Single ACL choke point (deny-by-default). Deny-nonexistent and deny-denied
  // return the SAME generic message so we never disclose whether a secret exists.
  const allowed = await store.checkAccess(secretName, namespace, agentId);
  if (!allowed) {
    return {
      isError: true,
      content: [{ type: "text", text: JSON.stringify({ error: "access denied" }) }],
    };
  }

  const value = await store.get(secretName, { namespace });
  if (value === null) {
    return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: "access denied" }) }] };
  }
  // Value returned to the caller only. Callers MUST NOT log this.
  return { content: [{ type: "text", text: JSON.stringify({ name: secretName, namespace, value }) }] };
}
