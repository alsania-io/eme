// EME Storage Router — Phase 2b core.
// Reads a Destination registry + RoutingRules from Config and routes a payload
// to the correct destination(s) with verification. Local-first: tests run
// against `local:` rclone remotes. No live cloud remotes are required here.
//
// Reconciliation note (see .tasks/002 + docs/EME_ROUTER_MODEL_2a.md):
// - snapshot-store.ts / ipfs-store.ts are NOT refactored. Their existing config
//   options are registered as built-in destinations so snapshots route through
//   the same registry (Phase 2 reconciles, does not fork).
// - 2a type shapes win; Task 002 structure (registry + pool + rules) implemented.

import {
  Config,
  DataClass,
  Destination,
  DestinationHealth,
  PoolStrategy,
  ResolvedRoute,
  RoutingRule,
  Tier,
} from "./types.js";

/** Minimal shape the router needs from a payload to make a routing decision. */
export interface RouteInput {
  /** Free text of the memory (for content heuristics). */
  text?: string;
  tags?: string[];
  namespace?: string;
  visibility?: "private" | "shared" | "system";
  tier?: Tier;
  /** Pre-classified data class, if the caller already ran the classifier. */
  dataClass?: DataClass;
  /** Stable key for shard routing (usually the memory id). */
  key?: string;
}

/**
 * Default routing rules (v1), seeded when Config.routing is empty.
 * Mirrors docs/EME_ROUTER_MODEL_2a.md §4 and .tasks/002 Phase 3.3.
 * MEGA/Filebase destinations are declared but stay health.ok=false until their
 * remotes are provisioned; tests use `local:` destinations instead.
 */
export const DEFAULT_ROUTING_RULES: RoutingRule[] = [
  { id: "immutable", match: { dataClass: "immutable" }, primary: "filebase-pin", secondary: ["mega-pool"], verify: "hash", encrypt: false },
  { id: "archive", match: { dataClass: "archive" }, primary: "mega-pool", verify: "hash", encrypt: false },
  { id: "vector", match: { dataClass: "vector" }, primary: "qdrant", verify: "none", encrypt: false },
  { id: "secret", match: { dataClass: "secret" }, primary: "secret", verify: "hash", encrypt: true },
  { id: "mirror", match: { dataClass: "mirror" }, primary: "ext-hd", secondary: ["mega-pool"], verify: "hash", encrypt: false },
  { id: "tier-hotwarm", match: { tier: "hot" }, primary: "in-process", verify: "none", encrypt: false },
  { id: "tier-warm", match: { tier: "warm" }, primary: "in-process", verify: "none", encrypt: false },
  { id: "tier-cold", match: { tier: "cold" }, primary: "qdrant", verify: "none", encrypt: false },
];

/**
 * Destination registry. Loads destinations from Config and indexes them by id.
 * Also reconciles the legacy snapshotStore config option into a built-in
 * destination so nothing that used the old surface breaks (Phase 2 contract).
 */
export class DestinationRegistry {
  private byId = new Map<string, Destination>();

  constructor(config: Config) {
    const configured = config.destinations ?? [];
    for (const d of configured) this.byId.set(d.id, d);

    // Reconciliation: surface the existing snapshotStore as a built-in
    // destination only if the user hasn't already declared one with that id.
    const legacyId = "legacy-snapshot";
    if (!this.byId.has(legacyId)) {
      this.byId.set(legacyId, {
        id: legacyId,
        kind: config.snapshotStore === "ipfs" || config.snapshotStore === "filebase" ? "ipfs" : "local",
        role: "archive",
        path: config.snapshotPath,
        health: { ok: true },
        config: { reconciledFrom: "snapshotStore", snapshotStore: config.snapshotStore },
      });
    }
  }

  get(id: string): Destination | undefined {
    return this.byId.get(id);
  }

  all(): Destination[] {
    return Array.from(this.byId.values());
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  /** Register (or replace) a destination. Used by destination_add. */
  add(dest: Destination): void {
    this.byId.set(dest.id, dest);
  }

  /**
   * Remove a destination from the registry. NOTE: this only deregisters the
   * route; remote data is never touched (additive-only / never-delete rule).
   */
  remove(id: string): boolean {
    return this.byId.delete(id);
  }

  /** Update a destination's health in place (mutates registry entry). */
  setHealth(id: string, health: DestinationHealth): void {
    const d = this.byId.get(id);
    if (d) d.health = health;
  }
}

/**
 * Resolves which remote in a pool a destination should target.
 * - round-robin: rotate index (persisted in-memory per resolver instance;
 *   callers may persist the index externally for restart-stability).
 * - shard: deterministic hash of key -> remote index (stable for same key).
 * - failover: try remotes in order; caller advances on error/latency.
 */
export class PoolResolver {
  private rrIndex = 0;

  /** List of remotes for a destination, or a single remote as a 1-item pool. */
  poolOf(dest: Destination): string[] {
    if (dest.remotes?.length) return dest.remotes;
    if (dest.remote) return [dest.remote];
    return [];
  }

  /**
   * Select a remote for the given key using the destination's pool strategy.
   * Returns undefined if the destination has no remotes (e.g. qdrant/local).
   */
  select(dest: Destination, key?: string): string | undefined {
    const pool = this.poolOf(dest);
    if (pool.length === 0) return undefined;
    if (pool.length === 1) return pool[0];

    const strategy: PoolStrategy = dest.poolStrategy ?? "round-robin";
    switch (strategy) {
      case "round-robin": {
        const pick = pool[this.rrIndex % pool.length];
        this.rrIndex = (this.rrIndex + 1) % pool.length;
        return pick;
      }
      case "shard": {
        const idx = this.hashKey(key ?? "") % pool.length;
        return pool[idx];
      }
      case "failover":
        // Without a failure signal, return the first; advance via nextFailover().
        return pool[0];
      default:
        return pool[0];
    }
  }

  /** For failover: given the failed remote, return the next candidate. */
  nextFailover(dest: Destination, failed: string): string | undefined {
    const pool = this.poolOf(dest);
    const i = pool.indexOf(failed);
    if (i === -1 || i === pool.length - 1) return undefined;
    return pool[i + 1];
  }

  /** Deterministic non-negative hash of a string key. */
  private hashKey(key: string): number {
    let h = 0;
    for (let i = 0; i < key.length; i++) {
      h = (h * 31 + key.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
  }
}

import { classifyCapture } from "./capture-classifier.js";

/**
 * Resolve which destination(s) a payload routes to. First matching rule wins,
 * evaluated most-specific-first:
 *   1. explicit route:* tag
 *   2. dataClass (caller-supplied, else derived via capture-classifier)
 *   3. namespace / visibility match
 *   4. tier (hot/warm/cold)
 */
export function resolveRoute(
  input: RouteInput,
  rules: RoutingRule[],
  registry: DestinationRegistry,
): ResolvedRoute {
  const dataClass = input.dataClass ?? deriveDataClass(input);
  const routeTag = (input.tags ?? []).find((t) => t.startsWith("route:"));
  const tagTarget = routeTag ? routeTag.slice("route:".length) : undefined;

  // Ordered candidate matches: tag override first, then dataClass, namespace,
  // visibility, tier. Within a group the first rule whose match fits wins.
  const ordered = prioritizeRules(rules);

  for (const rule of ordered) {
    if (routeTag && rule.match.tagsAny?.includes(routeTag)) {
      return materialize(rule, registry, `tag ${routeTag}`);
    }
    if (rule.match.dataClass && rule.match.dataClass === dataClass) {
      return materialize(rule, registry, `dataClass=${dataClass}`);
    }
    if (rule.match.namespace && rule.match.namespace === input.namespace) {
      return materialize(rule, registry, `namespace=${input.namespace}`);
    }
    if (rule.match.visibility && rule.match.visibility === input.visibility) {
      return materialize(rule, registry, `visibility=${input.visibility}`);
    }
    if (rule.match.tier && rule.match.tier === input.tier) {
      return materialize(rule, registry, `tier=${input.tier}`);
    }
  }

  // Fallback: the legacy reconciled destination, or the first registered one.
  const fallback =
    registry.get("legacy-snapshot") ?? registry.all()[0];
  if (!fallback) {
    throw new Error("StorageRouter: no destinations registered and no route matched");
  }
  return {
    primary: fallback,
    secondary: [],
    verify: "none",
    encrypt: false,
    ruleId: "fallback",
    reason: `fallback to ${fallback.id}`,
  };
}

/** Derive a data class from content when the caller didn't supply one. */
function deriveDataClass(input: RouteInput): DataClass {
  const cls = classifyCapture({
    text: input.text ?? "",
    tags: input.tags,
    namespace: input.namespace,
    visibility: input.visibility,
  });
  return cls.dataClass;
}

/**
 * Sort rules so more specific matches win: a rule with dataClass beats one that
 * only matches tier; explicit tag rules beat everything.
 */
function prioritizeRules(rules: RoutingRule[]): RoutingRule[] {
  const score = (r: RoutingRule): number => {
    let s = 0;
    if (r.match.tagsAny?.length) s += 100;
    if (r.match.dataClass) s += 50;
    if (r.match.namespace) s += 20;
    if (r.match.visibility) s += 10;
    if (r.match.tier) s += 5;
    return s;
  };
  return [...rules].sort((a, b) => score(b) - score(a));
}

/** Turn a matched rule into a ResolvedRoute with concrete destinations. */
function materialize(
  rule: RoutingRule,
  registry: DestinationRegistry,
  reason: string,
): ResolvedRoute {
  const primary = registry.get(rule.primary);
  if (!primary) {
    throw new Error(
      `StorageRouter: rule '${rule.id}' references unknown destination '${rule.primary}'`,
    );
  }
  const secondary = (rule.secondary ?? [])
    .map((id) => registry.get(id))
    .filter((d): d is Destination => !!d);
  return {
    primary,
    secondary,
    verify: rule.verify,
    encrypt: rule.encrypt,
    ruleId: rule.id,
    reason: `rule=${rule.id} via ${reason}`,
  };
}

import { RcloneBackend, RcloneCopyOptions } from "./rclone-backend.js";

export interface RouteWriteResult {
  route: ResolvedRoute;
  chosenRemote?: string;
  copied: boolean;
  verified: boolean;
  error?: string;
}

/**
 * StorageRouter — the router surface. Owns a registry, pool resolver, rules and
 * an rclone backend. `routeWrite` copies a local path to the resolved remote
 * (ADDITIVE copy, never sync) and optionally hash-verifies.
 */
export class StorageRouter {
  readonly registry: DestinationRegistry;
  readonly pool = new PoolResolver();
  private rules: RoutingRule[];
  private rclone: RcloneBackend;
  private rcloneConfigPath?: string;

  constructor(
    config: Config,
    deps: { rclone?: RcloneBackend } = {},
  ) {
    this.registry = new DestinationRegistry(config);
    this.rules =
      config.routing && config.routing.length > 0
        ? config.routing
        : DEFAULT_ROUTING_RULES;
    this.rcloneConfigPath = config.rcloneConfigPath;
    // Pin the EME-managed config path into the backend so EVERY rclone call
    // honors it — including a caller-injected bare backend (withConfig).
    const base = deps.rclone ?? new RcloneBackend();
    this.rclone =
      typeof (base as any).withConfig === "function"
        ? (base as any).withConfig(this.rcloneConfigPath)
        : base;
  }

  /** Which destination a payload would hit — no side effects (route_dryrun). */
  dryRun(input: RouteInput): ResolvedRoute {
    return resolveRoute(input, this.rules, this.registry);
  }

  /**
   * Copy a local path to the resolved primary (and secondary) destination(s).
   * Returns the concrete remote chosen for the primary, and verification status.
   */
  async routeWrite(
    input: RouteInput,
    localPath: string,
    remoteSubpath = "",
    copyOpts: RcloneCopyOptions = {},
  ): Promise<RouteWriteResult> {
    const route = this.dryRun(input);
    const remote = this.pool.select(route.primary, input.key);
    if (!remote) {
      return {
        route,
        copied: false,
        verified: false,
        error: `destination '${route.primary.id}' has no rclone remote to write to`,
      };
    }

    const dst = remoteSubpath ? `${remote}${remoteSubpath}` : remote;
    const copy = await this.rclone.copy(localPath, dst, copyOpts);
    if (!copy.ok) {
      return { route, chosenRemote: remote, copied: false, verified: false, error: copy.stderr.trim() };
    }

    let verified = route.verify === "none";
    if (route.verify === "hash") {
      const chk = await this.rclone.check(localPath, dst);
      verified = chk.ok;
    }

    // Replicate to secondary destinations (best-effort, additive).
    for (const sec of route.secondary) {
      const secRemote = this.pool.select(sec, input.key);
      if (secRemote) {
        await this.rclone.copy(localPath, secRemote, copyOpts);
      }
    }

    return { route, chosenRemote: remote, copied: true, verified };
  }

  /** Probe a destination's health via rclone about (rclone-kind only). */
  async testDestination(id: string): Promise<DestinationHealth> {
    const dest = this.registry.get(id);
    if (!dest) return { ok: false };
    const remote = this.pool.poolOf(dest)[0];
    if (!remote) {
      // Non-rclone destination: presence is its own health signal for now.
      const h = { ok: true, lastCheck: Date.now() };
      this.registry.setHealth(id, h);
      return h;
    }
    const start = Date.now();
    const about = await this.rclone.about(remote);
    const h: DestinationHealth = {
      ok: about.ok,
      lastCheck: Date.now(),
      latencyMs: Date.now() - start,
      freeBytes: about.freeBytes,
    };
    this.registry.setHealth(id, h);
    return h;
  }

  /** Current rules (seeded defaults if config had none). */
  getRules(): RoutingRule[] {
    return this.rules;
  }
}
