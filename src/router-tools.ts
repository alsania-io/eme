// EME Storage Router — Phase 2b tool-registrar seam (Amendment 2 §2).
// The router's MCP verbs live HERE, not hardcoded into mcp-server.ts. Core only
// mounts this registrar; adding a router feature never edits core. This is the
// `tool registrar` door named in Amendment 2.
//
// Verbs (docs/EME_ROUTER_MODEL_2a.md §5):
//   destination_list, destination_add, destination_test,
//   destination_remove, route_dryrun

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { Config, Destination } from "./types.js";
import { StorageRouter } from "./storage-router.js";

const schemaOptions = { target: "jsonSchema7" as const } as any;

export const DestinationListSchema = z.object({
  verbose: z.boolean().optional().default(false).describe("Include health detail"),
});

export const DestinationAddSchema = z.object({
  id: z.string().min(1).describe("Destination id, e.g. mega-pool"),
  kind: z.enum(["rclone", "ipfs", "qdrant", "local"]),
  role: z.enum(["immutable", "archive", "vector", "secret", "mirror", "disposable"]),
  remote: z.string().optional().describe("Single rclone remote, e.g. mega1:"),
  remotes: z.array(z.string()).optional().describe("Pool members"),
  poolStrategy: z.enum(["round-robin", "shard", "failover"]).optional(),
  url: z.string().optional(),
  path: z.string().optional(),
  config: z.record(z.any()).optional().describe("NON-SECRET options only"),
});

export const DestinationTestSchema = z.object({
  id: z.string().min(1).describe("Destination id to probe"),
});

export const DestinationRemoveSchema = z.object({
  id: z.string().min(1).describe("Destination id to remove (deprecates, never deletes data)"),
});

export const RouteDryrunSchema = z.object({
  text: z.string().optional(),
  tags: z.array(z.string()).optional(),
  namespace: z.string().optional(),
  visibility: z.enum(["private", "shared", "system"]).optional(),
  tier: z.enum(["hot", "warm", "cold"]).optional(),
  dataClass: z.enum(["immutable", "archive", "vector", "secret", "mirror", "disposable"]).optional(),
  key: z.string().optional(),
});

/** MCP tool definitions contributed by the storage router. */
export function routerToolDefinitions() {
  return [
    { name: "destination_list", description: "List storage destinations and their health.", inputSchema: zodToJsonSchema(DestinationListSchema, schemaOptions) },
    { name: "destination_add", description: "Add a storage destination (writes an EME-managed rclone remote or a ${VAR} ref). Never stores credentials inline.", inputSchema: zodToJsonSchema(DestinationAddSchema, schemaOptions) },
    { name: "destination_test", description: "Probe a destination (rclone about) and update its health.", inputSchema: zodToJsonSchema(DestinationTestSchema, schemaOptions) },
    { name: "destination_remove", description: "Remove a destination. Deprecates the route; never deletes remote data.", inputSchema: zodToJsonSchema(DestinationRemoveSchema, schemaOptions) },
    { name: "route_dryrun", description: "Show which destination a payload would route to, without writing anything.", inputSchema: zodToJsonSchema(RouteDryrunSchema, schemaOptions) },
  ];
}

/** Names this registrar owns — core uses this to route dispatch. */
export const ROUTER_TOOL_NAMES = [
  "destination_list",
  "destination_add",
  "destination_test",
  "destination_remove",
  "route_dryrun",
] as const;

/**
 * Dispatch a router verb. Returns MCP-shaped content, or null if the verb is
 * not owned by this registrar (so core can fall through).
 */
export async function dispatchRouterTool(
  name: string,
  args: any,
  router: StorageRouter,
): Promise<{ content: Array<{ type: "text"; text: string }> } | null> {
  switch (name) {
    case "destination_list": {
      const { verbose } = DestinationListSchema.parse(args ?? {});
      const list = router.registry.all().map((d) =>
        verbose
          ? d
          : { id: d.id, kind: d.kind, role: d.role, ok: d.health.ok },
      );
      return text({ destinations: list });
    }
    case "destination_add": {
      const parsed = DestinationAddSchema.parse(args);
      const dest: Destination = {
        id: parsed.id,
        kind: parsed.kind,
        role: parsed.role,
        remote: parsed.remote,
        remotes: parsed.remotes,
        poolStrategy: parsed.poolStrategy,
        url: parsed.url,
        path: parsed.path,
        health: { ok: false },
        config: parsed.config ?? {},
      };
      router.registry.add(dest);
      return text({ added: dest.id, health: dest.health });
    }
    case "destination_test": {
      const { id } = DestinationTestSchema.parse(args);
      const health = await router.testDestination(id);
      return text({ id, health });
    }
    case "destination_remove": {
      const { id } = DestinationRemoveSchema.parse(args);
      const removed = router.registry.remove(id);
      return text({ id, removed });
    }
    case "route_dryrun": {
      const input = RouteDryrunSchema.parse(args ?? {});
      const route = router.dryRun(input);
      return text({
        primary: route.primary.id,
        secondary: route.secondary.map((d) => d.id),
        verify: route.verify,
        encrypt: route.encrypt,
        ruleId: route.ruleId,
        reason: route.reason,
      });
    }
    default:
      return null;
  }
}

function text(obj: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] };
}
